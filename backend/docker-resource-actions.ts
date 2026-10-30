import { dockerExec } from "./docker-cli";
import { log } from "./log";
import { ValidationError } from "./util-server";

/**
 * Write-side helpers for the System Resources pages.
 *
 * Everything here is deliberately narrow: it creates *shared* volumes and
 * networks that a compose file can join with `external: true`, and it copies /
 * re-attaches data that already exists. It never starts or stops a container on
 * its own, so the compose-only boundary stays intact.
 */

const NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const HELPER_IMAGE = "alpine:3";

export interface ImageDetail {
    reference : string;
    id : string;
    shortID : string;
    size : number;
    digest : string;
    created : string;
    platform : string;
    entrypoint : string;
    cmd : string;
    exposed : string[];
    layerCount : number;
    tags : string[];
}

interface RawImageInspect {
    Id? : string;
    Size? : number;
    Created? : string;
    Architecture? : string;
    Os? : string;
    RepoTags? : string[];
    RepoDigests? : string[];
    Config? : {
        Entrypoint? : string[] | null;
        Cmd? : string[] | null;
        ExposedPorts? : Record<string, unknown> | null;
    };
    RootFS? : { Layers? : string[] };
}

function assertName(value : string, fieldName : string) : string {
    const name = value.trim();

    if (name === "" || name.length > 128 || !NAME_REGEX.test(name)) {
        throw new ValidationError(`Invalid ${fieldName}`);
    }

    return name;
}

function joinCommand(parts : string[] | null | undefined) : string {
    if (!parts || parts.length === 0) {
        return "";
    }
    return parts.join(" ");
}

/**
 * Inspect a single image so the detail page can show digest, platform,
 * entrypoint, exposed ports and the layer chain.
 */
export async function inspectImage(reference : string) : Promise<ImageDetail> {
    const target = reference.trim();

    if (target === "" || target.length > 255) {
        throw new ValidationError("Invalid image reference");
    }

    const res = await dockerExec([ "image", "inspect", target ]);

    if (res.exitCode !== 0) {
        throw new Error(res.stderr || `Unable to inspect image ${target}`);
    }

    let raw : RawImageInspect;

    try {
        const parsed = JSON.parse(res.stdout) as RawImageInspect[];
        raw = parsed[0];
    } catch (e) {
        throw new Error("Unable to parse `docker image inspect` output");
    }

    if (!raw || !raw.Id) {
        throw new Error(`Image ${target} not found`);
    }

    const id = raw.Id;
    const repoDigest = (raw.RepoDigests || []).find((item) => item.includes("@")) || "";
    const exposedPorts = Object.keys(raw.Config?.ExposedPorts || {});

    return {
        reference: target,
        id,
        shortID: id.replace(/^sha256:/, "").substring(0, 12),
        size: raw.Size || 0,
        digest: repoDigest.includes("@") ? repoDigest.split("@")[1] : "",
        created: raw.Created || "",
        platform: [ raw.Os, raw.Architecture ].filter((item) => !!item).join("/"),
        entrypoint: joinCommand(raw.Config?.Entrypoint),
        cmd: joinCommand(raw.Config?.Cmd),
        exposed: exposedPorts,
        layerCount: raw.RootFS?.Layers?.length || 0,
        tags: raw.RepoTags || [],
    };
}

/**
 * Create a named volume that other stacks can reference with `external: true`.
 */
export async function createVolume(name : string, driver = "local") : Promise<string> {
    const volumeName = assertName(name, "volume name");
    const volumeDriver = driver === "" ? "local" : assertName(driver, "volume driver");

    const res = await dockerExec([ "volume", "create", "--driver", volumeDriver, volumeName ]);

    if (res.exitCode !== 0) {
        throw new Error(res.stderr || `Unable to create volume ${volumeName}`);
    }

    return volumeName;
}

/**
 * Create a network that other stacks can join with `external: true`.
 */
export async function createNetwork(name : string, driver = "bridge", internal = false) : Promise<string> {
    const networkName = assertName(name, "network name");
    const networkDriver = driver === "" ? "bridge" : assertName(driver, "network driver");
    const args = [ "network", "create", "--driver", networkDriver ];

    if (internal) {
        args.push("--internal");
    }

    args.push(networkName);

    const res = await dockerExec(args);

    if (res.exitCode !== 0) {
        throw new Error(res.stderr || `Unable to create network ${networkName}`);
    }

    return networkName;
}

async function ensureHelperImage() : Promise<void> {
    const check = await dockerExec([ "image", "inspect", HELPER_IMAGE ]);

    if (check.exitCode === 0) {
        return;
    }

    const pull = await dockerExec([ "pull", HELPER_IMAGE ]);

    if (pull.exitCode !== 0) {
        throw new Error(`Unable to pull ${HELPER_IMAGE}, which is required for the copy step: ${pull.stderr}`);
    }
}

/**
 * Copy the content of a volume into another (existing or freshly created) volume.
 * The source volume is always preserved so a failed or partial copy cannot destroy data.
 */
export async function migrateVolume(source : string, target : string, options : { keepSource? : boolean, driver? : string } = {}) : Promise<{ target : string, kept : boolean }> {
    const sourceName = assertName(source, "source volume");
    const targetName = assertName(target, "target volume");
    const driver = options.driver && options.driver !== "" ? assertName(options.driver, "volume driver") : "local";

    if (sourceName === targetName) {
        throw new ValidationError("The target volume must be different from the source");
    }

    if (options.keepSource === false) {
        throw new ValidationError("The source volume must be kept during migration");
    }

    const sourceInspect = await dockerExec([ "volume", "inspect", sourceName ]);
    if (sourceInspect.exitCode !== 0) {
        throw new ValidationError("Source volume not found");
    }
    const targetInspect = await dockerExec([ "volume", "inspect", targetName ]);
    if (targetInspect.exitCode === 0) {
        throw new ValidationError("Target volume already exists. Choose a new empty volume name.");
    }

    await ensureHelperImage();

    // Create the target if it does not exist yet; an existing one is reused on purpose
    const create = await dockerExec([ "volume", "create", "--driver", driver, targetName ]);

    if (create.exitCode !== 0) {
        throw new Error(create.stderr || `Unable to create volume ${targetName}`);
    }

    const copy = await dockerExec([
        "run", "--rm",
        "-v", `${sourceName}:/from:ro`,
        "-v", `${targetName}:/to`,
        HELPER_IMAGE,
        "sh", "-c", "set -e; cd /from; cp -a . /to/",
    ]);

    if (copy.exitCode !== 0) {
        throw new Error(copy.stderr || "Copy failed");
    }

    return ({
        target: targetName,
        kept: true,
    });
}

/**
 * Attach every container of the source networks to the target network.
 * The containers keep their old networks, so nothing is torn down here — the
 * compose snippet generated on the client side makes the change permanent.
 */
export async function connectContainers(target : string, containers : string[]) : Promise<{ connected : string[], skipped : string[] }> {
    const networkName = assertName(target, "network name");
    const connected : string[] = [];
    const skipped : string[] = [];

    for (const container of containers) {
        const name = container.trim();

        if (name === "") {
            continue;
        }

        const res = await dockerExec([ "network", "connect", networkName, name ]);

        if (res.exitCode === 0) {
            connected.push(name);
        } else {
            log.warn("docker-resource-actions", `network connect ${networkName} ${name}: ${res.stderr}`);
            skipped.push(name);
        }
    }

    return ({ connected,
        skipped });
}

/** Attach one existing container to one existing network. */
export async function connectContainerToNetwork(networkName : string, containerId : string) : Promise<void> {
    const network = assertName(networkName, "network name");
    const container = assertName(containerId, "container id");
    const res = await dockerExec([ "network", "connect", network, container ]);

    if (res.exitCode !== 0) {
        throw new Error(res.stderr || `Unable to connect ${container} to ${network}`);
    }
}
