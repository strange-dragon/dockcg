import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import yaml from "yaml";
import { dockerExec } from "./docker-cli";
import { log } from "./log";
import { Registry } from "./models/registry";
import { decryptSecret } from "./secret-box";

/*
 * Image update detection.
 *
 * Two kinds of subject: Dockcg's own container, and every image a stack
 * declares. Both come down to the same question - does the digest the registry
 * serves now differ from the digest this host already has - so both share one
 * registry client. Nothing is pulled here; this module only answers "is there
 * something newer".
 */

const MANIFEST_ACCEPT = [
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

const REQUEST_TIMEOUT_MS = 20000;
const CONCURRENCY = 4;
const COMPOSE_FILES = [ "compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml" ];

export type ImageUpdateState = "current" | "outdated" | "unknown";

export interface ImageUpdateEntry {
    id : string;
    kind : "self" | "stack";
    name : string;
    image : string;
    stacks : string[];
    currentDigest : string;
    remoteDigest : string;
    state : ImageUpdateState;
    note : string;
}

export interface ParsedImage {
    /** Registry that will be asked for the manifest */
    apiHost : string;
    /** Registry as the user writes it, used to find stored credentials */
    host : string;
    repository : string;
    tag : string;
    /** Digest written inline (`image@sha256:...`), if any */
    digest : string;
}

/**
 * `ghcr.io/a/b:1.2` -> { apiHost: "ghcr.io", host: "ghcr.io", repo: "a/b", tag: "1.2" }
 * `nginx` -> Docker Hub, `library/nginx:latest`
 */
export function parseImage(image : string) : ParsedImage | null {
    let ref = String(image || "").trim();

    if (!ref) {
        return null;
    }

    let digest = "";
    const at = ref.indexOf("@");
    if (at !== -1) {
        digest = ref.slice(at + 1);
        ref = ref.slice(0, at);
    }

    let tag = "";
    const lastSlash = ref.lastIndexOf("/");
    const lastColon = ref.lastIndexOf(":");
    if (lastColon > lastSlash) {
        tag = ref.slice(lastColon + 1);
        ref = ref.slice(0, lastColon);
    }

    let host = "docker.io";
    let repository = ref;
    const firstSlash = ref.indexOf("/");
    if (firstSlash !== -1) {
        const head = ref.slice(0, firstSlash);
        if (head.includes(".") || head.includes(":") || head === "localhost") {
            host = head;
            repository = ref.slice(firstSlash + 1);
        }
    }

    if (!repository) {
        return null;
    }

    if (host === "docker.io" && !repository.includes("/")) {
        repository = `library/${repository}`;
    }

    return {
        apiHost: host === "docker.io" ? "registry-1.docker.io" : host,
        host,
        repository,
        tag: tag || "latest",
        digest,
    };
}

function parseChallenge(header : string) : Record<string, string> {
    const params : Record<string, string> = {};

    for (const match of header.matchAll(/([a-zA-Z]+)="([^"]*)"/g)) {
        params[match[1]] = match[2];
    }

    return params;
}

async function fetchWithTimeout(url : string, init : RequestInit = {}) : Promise<Response> {
    return fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
}

/**
 * Basic auth for a registry, from the entries the user saved in Dockcg.
 * Missing credentials are not an error: public images need none.
 */
async function getCredentials(host : string, jwtSecret : string) : Promise<{ username : string, password : string } | null> {
    if (!jwtSecret) {
        return null;
    }

    // Public images resolve with an anonymous token, so a missing database or a
    // broken record must not stop the check.
    try {
        const list = await Registry.getRegistryList();

        for (const bean of list) {
            const raw = String(bean.url || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "");
            if (raw !== host || !bean.username) {
                continue;
            }
            try {
                return {
                    username: bean.username,
                    password: decryptSecret(bean.password, jwtSecret),
                };
            } catch (e) {
                log.warn("image-updates", `Unable to decrypt credentials for ${host}`);
            }
        }
    } catch (e) {
        log.debug("image-updates", "Registry credentials unavailable");
    }

    return null;
}

async function requestToken(
    challenge : Record<string, string>,
    parsed : ParsedImage,
    credentials : { username : string, password : string } | null
) : Promise<string> {
    const realm = challenge.realm;

    if (!realm) {
        return "";
    }

    const url = new URL(realm);
    if (challenge.service) {
        url.searchParams.set("service", challenge.service);
    }
    url.searchParams.set("scope", challenge.scope || `repository:${parsed.repository}:pull`);

    const headers : Record<string, string> = {};
    if (credentials) {
        headers.Authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;
    }

    const res = await fetchWithTimeout(url.toString(), { headers });
    if (!res.ok) {
        throw new Error(`Token request failed (${res.status})`);
    }

    const data = await res.json() as { token? : string, access_token? : string };
    return data.token || data.access_token || "";
}

/**
 * Digest the registry currently serves for this reference.
 * For a multi-arch image this is the index digest, which is what `docker pull`
 * compares against as well.
 */
export async function getRemoteDigest(image : string, jwtSecret : string) : Promise<string> {
    const parsed = parseImage(image);

    if (!parsed) {
        throw new Error("Unparsable image reference");
    }

    // `image@sha256:...` is pinned; there is nothing newer to find.
    if (parsed.digest) {
        return parsed.digest;
    }

    const manifestUrl = `https://${parsed.apiHost}/v2/${parsed.repository}/manifests/${parsed.tag}`;
    const accept = { Accept: MANIFEST_ACCEPT };

    let res = await fetchWithTimeout(manifestUrl, { headers: accept,
        method: "GET" });

    if (res.status === 401) {
        const challenge = parseChallenge(res.headers.get("www-authenticate") || "");
        const credentials = await getCredentials(parsed.host, jwtSecret);
        const token = await requestToken(challenge, parsed, credentials);

        if (!token) {
            throw new Error("Registry requires authentication");
        }

        res = await fetchWithTimeout(manifestUrl, {
            headers: {
                ...accept,
                Authorization: `Bearer ${token}`,
            },
            method: "GET",
        });
    }

    if (!res.ok) {
        throw new Error(`Registry responded ${res.status}`);
    }

    const header = res.headers.get("docker-content-digest");
    if (header) {
        return header;
    }

    // Some registries omit the header; the digest is still the body's hash.
    const body = Buffer.from(await res.arrayBuffer());
    return `sha256:${crypto.createHash("sha256").update(body).digest("hex")}`;
}

/** Digest this host already holds for the image, or "" when it was never pulled. */
export async function getLocalDigest(image : string) : Promise<string> {
    const parsed = parseImage(image);

    if (!parsed) {
        return "";
    }

    const res = await dockerExec([ "image", "inspect", image, "--format", "{{json .RepoDigests}}" ]);
    if (res.exitCode !== 0) {
        return "";
    }

    let digests : string[] = [];
    try {
        digests = JSON.parse(res.stdout || "[]") as string[];
    } catch (e) {
        return "";
    }

    const expected = `${parsed.host}/${parsed.repository}`;
    const match = digests.find((entry) => {
        const at = entry.indexOf("@");
        const repo = at === -1 ? entry : entry.slice(0, at);
        return repo === expected || repo === parsed.repository || repo.endsWith(`/${parsed.repository}`);
    });

    if (match) {
        return match.slice(match.indexOf("@") + 1);
    }

    return "";
}

export interface SelfContainer {
    image : string;
    labels : Record<string, string>;
}

/**
 * The container Dockcg itself runs in, read from the daemon.
 * Usable because docker.sock is mounted; returns null when Dockcg runs bare.
 */
export async function getSelfContainer() : Promise<SelfContainer | null> {
    const hostname = os.hostname();
    const res = await dockerExec([ "inspect", hostname ]);

    if (res.exitCode !== 0) {
        return null;
    }

    try {
        const data = JSON.parse(res.stdout) as Array<{
            Config? : { Image? : string, Labels? : Record<string, string> },
        }>;
        const info = data[0];
        const image = info?.Config?.Image || "";

        if (!image) {
            return null;
        }

        return {
            image,
            labels: info?.Config?.Labels || {},
        };
    } catch (e) {
        return null;
    }
}

/** Compose invocation that recreates the container Dockcg itself runs in. */
export function getSelfComposeTarget(self : SelfContainer | null) : { project : string, files : string[] } | null {
    const project = self?.labels["com.docker.compose.project"] || "";
    const rawFiles = self?.labels["com.docker.compose.project.config_files"] || "";

    if (!project || !rawFiles) {
        return null;
    }

    const files = rawFiles.split(",").map((file) => file.trim()).filter(Boolean);

    // The files live on the host; only usable if the same path exists in here.
    if (files.length === 0 || !files.every((file) => fs.existsSync(file))) {
        return null;
    }

    return {
        project,
        files,
    };
}

export interface StackImageGroup {
    images : string[];
    stacks : string[];
}

/**
 * Every image a stack declares in compose.yaml, grouped so one image used by
 * three stacks is checked once. Values still holding `${...}` are skipped: the
 * substitution needs the stack's env, which is compose's job, not ours.
 */
export function collectStackImages(stacksDir : string) : StackImageGroup[] {
    const groups = new Map<string, Set<string>>();

    let entries : fs.Dirent[] = [];
    try {
        entries = fs.readdirSync(stacksDir, { withFileTypes: true });
    } catch (e) {
        return [];
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const dir = path.join(stacksDir, entry.name);
        const composeFile = COMPOSE_FILES.map((name) => path.join(dir, name)).find((file) => fs.existsSync(file));

        if (!composeFile) {
            continue;
        }

        let services : Record<string, { image? : unknown }> = {};
        try {
            const doc = yaml.parse(fs.readFileSync(composeFile, "utf-8")) as { services? : Record<string, { image? : unknown }> };
            services = doc?.services || {};
        } catch (e) {
            log.warn("image-updates", `Unable to parse ${composeFile}`);
            continue;
        }

        for (const service of Object.values(services)) {
            const image = typeof service?.image === "string" ? service.image.trim() : "";

            if (!image || image.includes("${")) {
                continue;
            }

            const key = image;
            if (!groups.has(key)) {
                groups.set(key, new Set());
            }
            groups.get(key)?.add(entry.name);
        }
    }

    const result : StackImageGroup[] = [];
    for (const [ image, stacks ] of groups) {
        result.push({
            images: [ image ],
            stacks: Array.from(stacks),
        });
    }

    return result;
}

async function mapWithLimit<T, R>(items : T[], limit : number, worker : (item : T) => Promise<R>) : Promise<R[]> {
    const results : R[] = new Array(items.length);
    let cursor = 0;

    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await worker(items[index]);
        }
    });

    await Promise.all(runners);
    return results;
}

/**
 * Compare every image Dockcg knows about against the registry.
 * Entries are ordered: outdated first, then unknown, then up to date.
 */
export async function checkImageUpdates(stacksDir : string, jwtSecret : string) : Promise<ImageUpdateEntry[]> {
    const targets : Array<{ kind : "self" | "stack", name : string, image : string, stacks : string[] }> = [];

    const self = await getSelfContainer();
    if (self) {
        targets.push({
            kind: "self",
            name: "Dockcg",
            image: self.image,
            stacks: [],
        });
    }

    for (const group of collectStackImages(stacksDir)) {
        const image = group.images[0];
        targets.push({
            kind: "stack",
            name: group.stacks.join(", "),
            image,
            stacks: group.stacks,
        });
    }

    const entries = await mapWithLimit(targets, CONCURRENCY, async (target) : Promise<ImageUpdateEntry> => {
        const entry : ImageUpdateEntry = {
            id: target.image,
            kind: target.kind,
            name: target.name,
            image: target.image,
            stacks: target.stacks,
            currentDigest: "",
            remoteDigest: "",
            state: "unknown",
            note: "",
        };

        try {
            entry.currentDigest = await getLocalDigest(target.image);
        } catch (e) {
            entry.currentDigest = "";
        }

        try {
            entry.remoteDigest = await getRemoteDigest(target.image, jwtSecret);
        } catch (e) {
            entry.note = e instanceof Error ? e.message : String(e);
            return entry;
        }

        if (!entry.currentDigest) {
            entry.state = "unknown";
            entry.note = "Image not pulled locally";
        } else if (entry.currentDigest === entry.remoteDigest) {
            entry.state = "current";
        } else {
            entry.state = "outdated";
        }

        return entry;
    });

    const rank : Record<ImageUpdateState, number> = {
        outdated: 0,
        unknown: 1,
        current: 2,
    };

    return entries.sort((a, b) => {
        if (a.kind !== b.kind) {
            return a.kind === "self" ? -1 : 1;
        }
        return rank[a.state] - rank[b.state];
    });
}

/**
 * Pull a single image. Used for Dockcg's own container, which is not a stack
 * and therefore has no `compose pull` to run.
 */
export async function pullImage(image : string) : Promise<void> {
    const res = await dockerExec([ "pull", image ], undefined);

    if (res.exitCode !== 0) {
        throw new Error(res.stderr.trim() || `docker pull ${image} failed`);
    }
}
