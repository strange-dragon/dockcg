import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { dockerExec } from "./docker-cli";
import { log } from "./log";

export interface DockerRegistrySources {
    loginRegistries : string[];
    /** Entries backed by a registry saved in Dockcg, so they can be removed here. */
    managedLogins : { id : string; label : string }[];
    mirrors : string[];
    configError : string;
    daemonError : string;
    /** Where the login list was read from, so the UI can say it out loud. */
    configPath : string;
    /** Set when an external credential helper owns the secrets. */
    credsStore : string;
}

/** Docker Hub is the built-in registry: always listed, never removable. */
export const DEFAULT_REGISTRY = "docker.io";

function publicEndpoint(value : string) : string {
    try {
        const url = new URL(value);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
    } catch (e) {
        return value.includes("@") ? value.substring(value.lastIndexOf("@") + 1) : value;
    }
}

/** Comparison key: no scheme, no trailing slash, lower case. */
export function registryKey(value : string) : string {
    return publicEndpoint(value)
        .replace(/^[a-z]+:\/\//i, "")
        .replace(/\/+$/, "")
        .toLowerCase();
}

/**
 * Short label for the UI. Docker Hub answers on several host names and
 * everyone calls it docker.io, so they collapse into one entry.
 */
export function displayRegistryName(value : string) : string {
    const key = registryKey(value);
    if ([ "docker.io", "index.docker.io", "index.docker.io/v1", "registry-1.docker.io" ].includes(key)) {
        return "docker.io";
    }
    return key;
}

/* Every docker CLI version stores the mirrors under a slightly different key,
 * so instead of hard-coding one path we look for the key itself. */
const MIRROR_KEYS = [ "mirrors", "registrymirrors", "registry-mirrors" ];

/**
 * Find the mirror array inside `docker info` JSON.
 * `null` means "this output does not carry the mirrors at all", which is
 * different from an empty array ("the daemon really has no mirror").
 */
function findMirrors(node : unknown, depth = 0) : string[] | null {
    if (depth > 4 || node === null || typeof node !== "object" || Array.isArray(node)) {
        return null;
    }

    const record = node as Record<string, unknown>;

    for (const [ key, value ] of Object.entries(record)) {
        if (MIRROR_KEYS.includes(key.toLowerCase()) && Array.isArray(value)) {
            return value.filter((item) : item is string => typeof item === "string");
        }
    }

    for (const value of Object.values(record)) {
        const found = findMirrors(value, depth + 1);
        if (found) {
            return found;
        }
    }

    return null;
}

/**
 * Last resort: the human-readable output. `--format` can reject a field on some
 * CLI versions (`can't evaluate field RegistryMirrors in type system.dockerInfo`),
 * but the plain text keeps printing a `Registry Mirrors:` block.
 */
function parseTextMirrors(output : string) : string[] | null {
    const lines = output.split(/\r?\n/);
    const mirrors : string[] = [];
    let inSection = false;

    for (const line of lines) {
        if (/^\s*Registry Mirrors:\s*$/i.test(line)) {
            inSection = true;
            continue;
        }
        if (!inSection) {
            continue;
        }
        if (line.trim() === "") {
            continue;
        }
        if (!/^\s{2,}\S/.test(line)) {
            break;
        }
        mirrors.push(publicEndpoint(line.trim()));
    }

    return inSection ? mirrors : null;
}

/**
 * Ask the daemon for its registry mirrors.
 * Returns the raw reasons too, so the caller can report a read failure instead
 * of silently claiming "no mirror configured".
 */
async function readDaemonMirrors() : Promise<{ mirrors : string[]; error : string }> {
    const info = await dockerExec([ "info", "--format", "{{json .}}" ]);

    if (info.exitCode === 0) {
        try {
            const mirrors = findMirrors(JSON.parse(info.stdout) as unknown);
            if (mirrors) {
                return {
                    mirrors: mirrors.map(publicEndpoint),
                    error: "",
                };
            }
            log.debug("docker-registry-sources", "docker info JSON carries no registry mirrors, reading the text output");
        } catch (e) {
            log.warn("docker-registry-sources", `Unable to parse docker info JSON: ${String(e)}`);
        }
    } else {
        log.warn("docker-registry-sources", `docker info --format failed: ${info.stderr.trim()}`);
    }

    const plain = await dockerExec([ "info" ]);
    if (plain.exitCode === 0) {
        // No `Registry Mirrors:` block simply means the daemon has none.
        return {
            mirrors: parseTextMirrors(plain.stdout) ?? [],
            error: "",
        };
    }

    log.warn("docker-registry-sources", `docker info failed: ${plain.stderr.trim()}`);
    return {
        mirrors: [],
        error: "Unable to read Docker registry mirrors",
    };
}

/** Read registry names only. Docker auth and credential-helper values stay on the server. */
export async function getDockerRegistrySources() : Promise<DockerRegistrySources> {
    const loginRegistries = new Map<string, string>();
    const configDir = process.env.DOCKER_CONFIG || join(homedir(), ".docker");
    const configPath = join(configDir, "config.json");
    let configError = "";
    let credsStore = "";

    try {
        const config = JSON.parse(await readFile(configPath, "utf8")) as {
            auths? : Record<string, unknown>;
            credHelpers? : Record<string, unknown>;
            credsStore? : unknown;
        };

        for (const name of Object.keys(config.auths || {})) {
            loginRegistries.set(registryKey(name), displayRegistryName(name));
        }
        for (const name of Object.keys(config.credHelpers || {})) {
            loginRegistries.set(registryKey(name), displayRegistryName(name));
        }

        if (typeof config.credsStore === "string") {
            // The secrets live in an external helper, so config.json carries no
            // per-registry keys at all. Say so instead of showing an empty list.
            credsStore = config.credsStore;
        }
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
            log.warn("docker-registry-sources", `Unable to read Docker config: ${String(e)}`);
            configError = "Unable to read Docker config";
        }
    }

    const { mirrors, error: daemonError } = await readDaemonMirrors();
    const names = Array.from(loginRegistries.values()).sort();

    return {
        loginRegistries: [ DEFAULT_REGISTRY, ...names.filter((name) => name !== DEFAULT_REGISTRY) ],
        managedLogins: [],
        mirrors,
        configError,
        daemonError,
        configPath,
        credsStore,
    };
}
