import {
    dockerExec,
    formatBytes,
    parseDockerSize,
    parseJSONLines,
    parseLabelString
} from "./docker-cli";
import { getComposeResourceClaims } from "./compose-resource-claims";

/**
 * Dockcg resource inventory.
 *
 * Design rules:
 *  - Read only, plus explicit cleanup of nothing-but-unused resources.
 *  - Never creates containers / networks / volumes. Compose stays the single source of truth.
 */

export interface DockerContainerRef {
    id : string;
    name : string;
    stack : string;
    service : string;
    state : string;
}

export interface DockerContainerInfo extends DockerContainerRef {
    image : string;
    imageID : string;
    volumes : string[];
    networks : string[];
}

export interface DockerImageInfo {
    id : string;
    shortID : string;
    repository : string;
    tag : string;
    digest : string;
    reference : string;
    size : number;
    sizeText : string;
    createdText : string;
    dangling : boolean;
    used : boolean;
    containers : DockerContainerRef[];
    stacks : string[];
}

export interface DockerVolumeInfo {
    name : string;
    driver : string;
    mountpoint : string;
    scope : string;
    createdText : string;
    labels : Record<string, string>;
    stack : string;
    composeVolume : string;
    used : boolean;
    containers : DockerContainerRef[];
}

export interface DockerNetworkInfo {
    id : string;
    name : string;
    driver : string;
    scope : string;
    internal : boolean;
    attachable : boolean;
    subnet : string;
    labels : Record<string, string>;
    stack : string;
    composeNetwork : string;
    builtIn : boolean;
    used : boolean;
    containers : DockerContainerRef[];
    stacks : string[];
}

export interface DockerResourceSnapshot {
    images : DockerImageInfo[];
    volumes : DockerVolumeInfo[];
    networks : DockerNetworkInfo[];
    containers : DockerContainerInfo[];
}

export interface PruneResult {
    removed : string[];
    failed : { name : string, error : string }[];
    reclaimed : number;
    reclaimedText : string;
}

export interface PruneCandidate {
    name : string;
    size : number;
}

export async function previewPrune(kind : "images" | "volumes" | "networks", stacksDir : string, mode : "dangling" | "unused" = "dangling") : Promise<PruneCandidate[]> {
    const containers = await listContainers();
    if (kind === "images") {
        return (await listImages(containers))
            .filter((image) => !image.used && (mode === "unused" || image.dangling))
            .map((image) => ({ name: image.reference,
                size: image.size }));
    }
    const claims = await getComposeResourceClaims(stacksDir);
    if (kind === "volumes") {
        return (await listVolumes(containers))
            .filter((volume) => !volume.used && !volume.stack && !claims.volumes.has(volume.name) && volume.scope === "local")
            .map((volume) => ({ name: volume.name,
                size: 0 }));
    }
    return (await listNetworks(containers))
        .filter((network) => !network.used && !network.builtIn && !network.stack && !claims.networks.has(network.name) && network.scope === "local")
        .map((network) => ({ name: network.name,
            size: 0 }));
}

const BUILT_IN_NETWORKS = [ "bridge", "host", "none" ];

interface RawContainer {
    Id : string;
    Name : string;
    Image : string;
    State?: { Status? : string };
    Config?: {
        Image? : string;
        Labels? : Record<string, string> | null;
    };
    Mounts?: { Type? : string, Name? : string, Destination? : string }[];
    NetworkSettings?: { Networks? : Record<string, unknown> | null };
}

interface RawImageLine {
    ID : string;
    Repository : string;
    Tag : string;
    Digest? : string;
    Size? : string;
    CreatedSince? : string;
    CreatedAt? : string;
}

interface RawVolumeLine {
    Name : string;
    Driver? : string;
    Mountpoint? : string;
    Scope? : string;
    Labels? : string;
}

interface RawVolumeInspect {
    Name : string;
    Driver? : string;
    Mountpoint? : string;
    Scope? : string;
    CreatedAt? : string;
    Labels? : Record<string, string> | null;
}

interface RawNetworkLine {
    ID : string;
    Name : string;
    Driver? : string;
    Scope? : string;
    Internal? : string | boolean;
    IPv6? : string | boolean;
    Labels? : string;
    CreatedAt? : string;
}

interface RawNetworkInspect {
    Id : string;
    Name : string;
    Driver? : string;
    Scope? : string;
    Internal? : boolean;
    Attachable? : boolean;
    Created? : string;
    Labels? : Record<string, string> | null;
    IPAM?: { Config?: { Subnet? : string }[] };
    Containers?: Record<string, { Name? : string }>;
}

function isTrue(value : unknown) : boolean {
    return value === true || value === "true";
}

function normalizeDate(value : string | undefined) : string {
    if (!value) {
        return "";
    }

    if (value.startsWith("0001-01-01")) {
        return "";
    }

    return value;
}

/**
 * List all containers (running and stopped) with the compose metadata Dockcg needs
 * to attribute images / volumes / networks to a stack and a service.
 */
export async function listContainers() : Promise<DockerContainerInfo[]> {
    const idRes = await dockerExec([ "ps", "-aq", "--no-trunc" ]);

    if (idRes.exitCode !== 0) {
        throw new Error(idRes.stderr || "Unable to list containers");
    }

    const ids = idRes.stdout.split("\n").map((line) => line.trim()).filter((id) => id !== "");

    if (ids.length === 0) {
        return [];
    }

    const inspectRes = await dockerExec([ "container", "inspect", ...ids ]);

    if (inspectRes.exitCode !== 0) {
        throw new Error(inspectRes.stderr || "Unable to inspect containers");
    }

    let rawList : RawContainer[];

    try {
        rawList = JSON.parse(inspectRes.stdout) as RawContainer[];
    } catch (e) {
        throw new Error("Failed to parse `docker container inspect` output");
    }

    return rawList.map((raw) => {
        const labels : Record<string, string> = raw.Config?.Labels || {};

        return {
            id: raw.Id,
            name: (raw.Name || "").replace(/^\//, ""),
            image: raw.Config?.Image || "",
            imageID: raw.Image || "",
            state: raw.State?.Status || "",
            stack: labels["com.docker.compose.project"] || "",
            service: labels["com.docker.compose.service"] || "",
            volumes: (raw.Mounts || [])
                .filter((mount) => mount.Type === "volume" && !!mount.Name)
                .map((mount) => String(mount.Name)),
            networks: Object.keys(raw.NetworkSettings?.Networks || {}),
        } as DockerContainerInfo;
    });
}

function toContainerRef(container : DockerContainerInfo) : DockerContainerRef {
    return {
        id: container.id.substring(0, 12),
        name: container.name,
        stack: container.stack,
        service: container.service,
        state: container.state,
    };
}

/**
 * List all images and mark which ones are used by a container.
 * @param containers result of listContainers()
 */
export async function listImages(containers : DockerContainerInfo[]) : Promise<DockerImageInfo[]> {
    const res = await dockerExec([ "image", "ls", "--all", "--no-trunc", "--format", "{{json .}}" ]);

    if (res.exitCode !== 0) {
        throw new Error(res.stderr || "Unable to list images");
    }

    const rawList = parseJSONLines<RawImageLine>(res.stdout);
    const imageList : DockerImageInfo[] = [];

    for (const raw of rawList) {
        if (!raw.ID) {
            continue;
        }

        const repository = raw.Repository || "<none>";
        const tag = raw.Tag || "<none>";
        const dangling = repository === "<none>" && tag === "<none>";

        const usedBy = containers.filter((container) => {
            if (container.imageID && container.imageID === raw.ID) {
                return true;
            }
            return !!container.image && container.image === `${repository}:${tag}`;
        });

        imageList.push({
            id: raw.ID,
            shortID: raw.ID.replace(/^sha256:/, "").substring(0, 12),
            repository,
            tag,
            digest: raw.Digest && raw.Digest !== "<none>" ? raw.Digest : "",
            reference: dangling ? raw.ID : `${repository}:${tag}`,
            size: parseDockerSize(raw.Size),
            sizeText: raw.Size || "",
            createdText: raw.CreatedSince || raw.CreatedAt || "",
            dangling,
            used: usedBy.length > 0,
            containers: usedBy.map(toContainerRef),
            stacks: Array.from(new Set(usedBy.map((container) => container.stack).filter((stack) => stack !== ""))),
        });
    }

    // Biggest first, unused before used
    imageList.sort((a, b) => b.size - a.size);

    return imageList;
}

/**
 * List all named volumes and their mount attribution.
 * @param containers result of listContainers()
 */
export async function listVolumes(containers : DockerContainerInfo[]) : Promise<DockerVolumeInfo[]> {
    const res = await dockerExec([ "volume", "ls", "--format", "{{json .}}" ]);

    if (res.exitCode !== 0) {
        throw new Error(res.stderr || "Unable to list volumes");
    }

    const rawList = parseJSONLines<RawVolumeLine>(res.stdout);
    const names = rawList.map((raw) => raw.Name).filter((name) => !!name);

    // `docker volume ls` has no stable CreatedAt, so inspect them in one batch
    const inspectMap = new Map<string, RawVolumeInspect>();

    if (names.length > 0) {
        const inspectRes = await dockerExec([ "volume", "inspect", ...names ]);

        if (inspectRes.exitCode !== 0) {
            throw new Error(inspectRes.stderr || "Unable to inspect volumes");
        }

        try {
            const inspected = JSON.parse(inspectRes.stdout) as RawVolumeInspect[];
            for (const item of inspected) {
                inspectMap.set(item.Name, item);
            }
        } catch (e) {
            throw new Error("Failed to parse `docker volume inspect` output");
        }
    }

    return rawList.map((raw) => {
        const inspected = inspectMap.get(raw.Name);
        const labels = inspected?.Labels || parseLabelString(raw.Labels);
        const usedBy = containers.filter((container) => container.volumes.includes(raw.Name));

        return {
            name: raw.Name,
            driver: inspected?.Driver || raw.Driver || "local",
            mountpoint: inspected?.Mountpoint || raw.Mountpoint || "",
            scope: inspected?.Scope || raw.Scope || "local",
            createdText: normalizeDate(inspected?.CreatedAt),
            labels,
            stack: labels["com.docker.compose.project"] || "",
            composeVolume: labels["com.docker.compose.volume"] || "",
            used: usedBy.length > 0,
            containers: usedBy.map(toContainerRef),
        } as DockerVolumeInfo;
    }).sort((a, b) => a.name.localeCompare(b.name));
}

/** Docker computes volume usage for `system df -v`; it may be slow on large hosts. */
export async function getVolumeUsage(name : string) : Promise<string> {
    const containers = await listContainers();
    if (!(await listVolumes(containers)).some((volume) => volume.name === name)) {
        throw new Error("Volume not found");
    }
    const result = await dockerExec([ "system", "df", "-v" ]);
    if (result.exitCode !== 0) {
        throw new Error(result.stderr || "Unable to calculate volume usage");
    }
    const section = result.stdout.split(/Local Volumes space usage:/i)[1]?.split(/Build cache usage:/i)[0] || "";
    for (const line of section.split("\n")) {
        const columns = line.trim().split(/\s{2,}/);
        if (columns[0] === name && columns.length >= 3) {
            return columns[columns.length - 1];
        }
    }
    throw new Error("Docker did not report usage for this volume");
}

/**
 * List all networks with stack attribution and attached containers.
 * @param containers result of listContainers()
 */
export async function listNetworks(containers : DockerContainerInfo[]) : Promise<DockerNetworkInfo[]> {
    const res = await dockerExec([ "network", "ls", "--format", "{{json .}}" ]);

    if (res.exitCode !== 0) {
        throw new Error(res.stderr || "Unable to list networks");
    }

    const rawList = parseJSONLines<RawNetworkLine>(res.stdout);
    const names = rawList.map((raw) => raw.Name).filter((name) => !!name);
    const inspectMap = new Map<string, RawNetworkInspect>();

    if (names.length > 0) {
        const inspectRes = await dockerExec([ "network", "inspect", ...names ]);

        if (inspectRes.exitCode !== 0) {
            throw new Error(inspectRes.stderr || "Unable to inspect networks");
        }

        try {
            const inspected = JSON.parse(inspectRes.stdout) as RawNetworkInspect[];
            for (const item of inspected) {
                inspectMap.set(item.Name, item);
            }
        } catch (e) {
            throw new Error("Failed to parse `docker network inspect` output");
        }
    }

    return rawList.map((raw) => {
        const inspected = inspectMap.get(raw.Name);
        const labels = inspected?.Labels || parseLabelString(raw.Labels);

        // Container side: config based (works for stopped containers too)
        const usedBy = containers.filter((container) => container.networks.includes(raw.Name));

        // Network side: authoritative list of currently attached containers
        const attachedMap : Record<string, { Name? : string }> = inspected?.Containers || {};
        const attachedNames = Object.values(attachedMap)
            .map((item) => item.Name || "")
            .filter((name) => name !== "");

        for (const name of attachedNames) {
            if (!usedBy.some((container) => container.name === name)) {
                const known = containers.find((container) => container.name === name);
                if (known) {
                    usedBy.push(known);
                }
            }
        }

        const subnet = inspected?.IPAM?.Config?.[0]?.Subnet || "";
        const stackSet = new Set<string>();

        if (labels["com.docker.compose.project"]) {
            stackSet.add(labels["com.docker.compose.project"]);
        }
        for (const container of usedBy) {
            if (container.stack) {
                stackSet.add(container.stack);
            }
        }

        return {
            id: raw.ID,
            name: raw.Name,
            driver: inspected?.Driver || raw.Driver || "bridge",
            scope: inspected?.Scope || raw.Scope || "local",
            internal: inspected ? !!inspected.Internal : isTrue(raw.Internal),
            attachable: !!inspected?.Attachable,
            subnet,
            labels,
            stack: labels["com.docker.compose.project"] || "",
            composeNetwork: labels["com.docker.compose.network"] || "",
            builtIn: BUILT_IN_NETWORKS.includes(raw.Name),
            used: usedBy.length > 0,
            containers: usedBy.map(toContainerRef),
            stacks: Array.from(stackSet),
        } as DockerNetworkInfo;
    }).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Full inventory snapshot.
 */
export async function getSnapshot() : Promise<DockerResourceSnapshot> {
    const containers = await listContainers();
    const [ images, volumes, networks ] = await Promise.all([
        listImages(containers),
        listVolumes(containers),
        listNetworks(containers),
    ]);

    return {
        images,
        volumes,
        networks,
        containers,
    };
}

function emptyPruneResult() : PruneResult {
    return {
        removed: [],
        failed: [],
        reclaimed: 0,
        reclaimedText: "0 B",
    };
}

function finalizePruneResult(result : PruneResult) : PruneResult {
    result.reclaimedText = formatBytes(result.reclaimed);
    return result;
}

/**
 * Remove unused images.
 * @param mode "dangling" only removes untagged images, "unused" removes any image not referenced by a container
 */
export async function pruneImages(mode : "dangling" | "unused") : Promise<PruneResult> {
    const result = emptyPruneResult();
    const containers = await listContainers();
    const images = await listImages(containers);

    const candidates = images.filter((image) => {
        if (image.used) {
            return false;
        }
        if (mode === "dangling") {
            return image.dangling;
        }
        return true;
    });

    for (const image of candidates) {
        const res = await dockerExec([ "image", "rm", image.reference ]);

        if (res.exitCode === 0) {
            result.removed.push(image.reference === image.id ? image.shortID : image.reference);
            result.reclaimed += image.size;
        } else {
            result.failed.push({
                name: image.reference === image.id ? image.shortID : image.reference,
                error: res.stderr,
            });
        }
    }

    return finalizePruneResult(result);
}

/**
 * Remove a single image. Refuses when a container still uses it.
 */
export async function removeImage(imageId : string) : Promise<void> {
    const containers = await listContainers();
    const images = await listImages(containers);
    const target = images.find((image) => image.id === imageId || image.id.startsWith(imageId) || image.reference === imageId);

    if (!target) {
        throw new Error("Image not found");
    }

    if (target.used) {
        throw new Error("This image is used by a running or stopped container. Remove the stack first.");
    }

    const res = await dockerExec([ "image", "rm", target.reference ]);

    if (res.exitCode !== 0) {
        throw new Error(res.stderr || "Failed to remove image");
    }
}

/**
 * Remove volumes that are not mounted by any container.
 * @param includeCompose legacy wire argument; Compose-owned volumes are always protected
 */
export async function pruneVolumes(includeCompose : boolean, stacksDir : string) : Promise<PruneResult> {
    void includeCompose;
    const result = emptyPruneResult();
    const containers = await listContainers();
    const volumes = await listVolumes(containers);
    const claims = await getComposeResourceClaims(stacksDir);

    const candidates = volumes.filter((volume) => {
        if (volume.used) {
            return false;
        }
        if (claims.volumes.has(volume.name) || volume.stack) {
            return false;
        }
        return volume.scope === "local";
    });

    for (const volume of candidates) {
        const res = await dockerExec([ "volume", "rm", volume.name ]);

        if (res.exitCode === 0) {
            result.removed.push(volume.name);
        } else {
            result.failed.push({
                name: volume.name,
                error: res.stderr,
            });
        }
    }

    return finalizePruneResult(result);
}

/**
 * Remove one volume. Refuses when it is still mounted.
 */
export async function removeVolume(name : string, stacksDir : string) : Promise<void> {
    const containers = await listContainers();
    const volumes = await listVolumes(containers);
    const target = volumes.find((volume) => volume.name === name);

    if (!target) {
        throw new Error("Volume not found");
    }

    if (target.used) {
        throw new Error("This volume is mounted by a container. Stop and remove the stack first.");
    }

    if (target.stack) {
        throw new Error("This volume belongs to a Compose project. Remove its declaration before deleting the volume.");
    }
    if ((await getComposeResourceClaims(stacksDir)).volumes.has(name)) {
        throw new Error("This volume is declared in a managed Compose file.");
    }

    const res = await dockerExec([ "volume", "rm", name ]);

    if (res.exitCode !== 0) {
        throw new Error(res.stderr || "Failed to remove volume");
    }
}

/**
 * Remove custom networks that are not used by any container.
 * @param includeCompose legacy wire argument; Compose-owned networks are always protected
 */
export async function pruneNetworks(includeCompose : boolean, stacksDir : string) : Promise<PruneResult> {
    void includeCompose;
    const result = emptyPruneResult();
    const containers = await listContainers();
    const networks = await listNetworks(containers);
    const claims = await getComposeResourceClaims(stacksDir);

    const candidates = networks.filter((network) => {
        if (network.builtIn || network.used) {
            return false;
        }
        if (network.scope !== "local") {
            return false;
        }
        if (claims.networks.has(network.name) || network.stack) {
            return false;
        }
        return true;
    });

    for (const network of candidates) {
        const res = await dockerExec([ "network", "rm", network.id ]);

        if (res.exitCode === 0) {
            result.removed.push(network.name);
        } else {
            result.failed.push({
                name: network.name,
                error: res.stderr,
            });
        }
    }

    return finalizePruneResult(result);
}

/**
 * Remove one network. Built-in networks and networks with attached containers are rejected.
 */
export async function removeNetwork(id : string, stacksDir : string) : Promise<void> {
    const containers = await listContainers();
    const networks = await listNetworks(containers);
    const target = networks.find((network) => network.id === id || network.id.startsWith(id) || network.name === id);

    if (!target) {
        throw new Error("Network not found");
    }

    if (target.builtIn) {
        throw new Error("Built-in docker networks cannot be removed.");
    }

    if (target.used) {
        throw new Error("This network is still used by a container. Remove the stack first.");
    }
    if (target.stack) {
        throw new Error("This network belongs to a Compose project. Remove its declaration before deleting the network.");
    }
    if ((await getComposeResourceClaims(stacksDir)).networks.has(target.name)) {
        throw new Error("This network is declared in a managed Compose file.");
    }

    const res = await dockerExec([ "network", "rm", target.id ]);

    if (res.exitCode !== 0) {
        throw new Error(res.stderr || "Failed to remove network");
    }
}
