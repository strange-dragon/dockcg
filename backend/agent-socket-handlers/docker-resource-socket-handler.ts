import { AgentSocketHandler } from "../agent-socket-handler";
import { DockcgServer } from "../dockcg-server";
import { callbackError, callbackResult, checkLogin, DockcgSocket, ValidationError } from "../util-server";
import { AgentSocket } from "../../common/agent-socket";
import { getImagePullTerminalName } from "../../common/util-common";
import { Terminal } from "../terminal";
import { R } from "redbean-node";
import { Registry } from "../models/registry";
import { decryptSecret, encryptSecret } from "../secret-box";
import { dockerExec } from "../docker-cli";
import { getDockerRegistrySources } from "../docker-registry-sources";
import { addServiceNetwork, saveServiceNetwork } from "../compose-network-association";
import { Stack } from "../stack";
import { realpath } from "node:fs/promises";
import path from "node:path";
import {
    getSnapshot,
    getVolumeUsage,
    listImages,
    listContainers,
    listNetworks,
    listVolumes,
    pruneImages,
    pruneNetworks,
    pruneVolumes,
    previewPrune,
    removeImage,
    removeNetwork,
    removeVolume
} from "../docker-resources";
import {
    createNetwork,
    createVolume,
    inspectImage,
    migrateVolume
} from "../docker-resource-actions";
import { log } from "../log";
import { createContainerComposeDraft } from "../container-compose-draft";
import { createHash } from "node:crypto";

const IMAGE_REFERENCE_REGEX = /^[A-Za-z0-9][A-Za-z0-9._\-/:@]*$/;
const REGISTRY_URL_REGEX = /^[A-Za-z0-9._\-:/]+$/;

function requireString(value : unknown, fieldName : string) : string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new ValidationError(`${fieldName} must be a non-empty string`);
    }
    return value.trim();
}

function requireBoolean(value : unknown, fieldName : string) : boolean {
    if (typeof value !== "boolean") {
        throw new ValidationError(`${fieldName} must be a boolean`);
    }
    return value;
}

function composeHash(source : string) : string {
    return createHash("sha256").update(source).digest("hex");
}

/**
 * Read-only Docker resource management (images / volumes / networks)
 * plus private registry credentials.
 *
 * This handler runs on the instance that owns the docker daemon, so it also
 * works transparently through Dockcg agents.
 */
export class DockerResourceSocketHandler extends AgentSocketHandler {
    create(socket : DockcgSocket, server : DockcgServer, agentSocket : AgentSocket) {
        // Do not call super.create()

        agentSocket.on("getDockerContainerMigrationList", async (callback) => {
            try {
                checkLogin(socket);
                const containers = await listContainers();
                callbackResult({ ok: true,
                    containers }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("getDockerContainerComposeDraft", async (id : unknown, callback) => {
            try {
                checkLogin(socket);
                const result = await createContainerComposeDraft(requireString(id, "Container ID"));
                callbackResult({ ok: true,
                    ...result }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("previewDockerResourcePrune", async (payload : unknown, callback) => {
            try {
                checkLogin(socket);
                const data = payload as { kind? : unknown, mode? : unknown };
                if (!data || ![ "images", "volumes", "networks" ].includes(String(data.kind))) {
                    throw new ValidationError("Invalid resource kind");
                }
                const mode = data.mode === "unused" ? "unused" : "dangling";
                const candidates = await previewPrune(data.kind as "images" | "volumes" | "networks", server.stacksDir, mode);
                callbackResult({ ok: true,
                    candidates }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // ***************************
        // Images
        // ***************************

        agentSocket.on("getDockerImageList", async (callback) => {
            try {
                checkLogin(socket);
                const containers = await listContainers();
                const images = await listImages(containers);
                callbackResult({ ok: true,
                    images }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Pre-pull an image so users can warm the cache before editing a compose file
        agentSocket.on("pullDockerImage", async (imageReference : unknown, callback) => {
            try {
                checkLogin(socket);

                const reference = requireString(imageReference, "Image reference");

                if (reference.length > 255 || !IMAGE_REFERENCE_REGEX.test(reference)) {
                    throw new ValidationError("Invalid image reference");
                }

                let exitCode : number;

                try {
                    exitCode = await Terminal.exec(
                        server,
                        socket,
                        getImagePullTerminalName(socket.endpoint),
                        "docker",
                        [ "pull", reference ],
                        server.stacksDir
                    );
                } catch (e) {
                    // Terminal.exec() rejects with a plain string when a terminal is already running
                    throw new Error(e instanceof Error ? e.message : String(e));
                }

                if (exitCode !== 0) {
                    throw new Error("Failed to pull the image, please check the terminal output.");
                }

                callbackResult({ ok: true,
                    msg: "Image pulled successfully" }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("removeDockerImage", async (imageId : unknown, callback) => {
            try {
                checkLogin(socket);
                await removeImage(requireString(imageId, "Image ID"));
                callbackResult({ ok: true,
                    msg: "Image removed" }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("pruneDockerImages", async (mode : unknown, callback) => {
            try {
                checkLogin(socket);

                if (mode !== "dangling" && mode !== "unused") {
                    throw new ValidationError("Mode must be either 'dangling' or 'unused'");
                }

                const result = await pruneImages(mode);
                callbackResult({ ok: true,
                    ...result }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("getDockerImageDetail", async (imageReference : unknown, callback) => {
            try {
                checkLogin(socket);
                const reference = requireString(imageReference, "Image reference");
                const detail = await inspectImage(reference);
                callbackResult({ ok: true,
                    detail }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // ***************************
        // Volumes
        // ***************************

        agentSocket.on("getDockerVolumeList", async (callback) => {
            try {
                checkLogin(socket);
                const containers = await listContainers();
                const volumes = await listVolumes(containers);
                callbackResult({ ok: true,
                    volumes }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("getDockerVolumeUsage", async (name : unknown, callback) => {
            try {
                checkLogin(socket);
                const sizeText = await getVolumeUsage(requireString(name, "Volume name"));
                callbackResult({ ok: true,
                    sizeText }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("removeDockerVolume", async (name : unknown, callback) => {
            try {
                checkLogin(socket);
                await removeVolume(requireString(name, "Volume name"), server.stacksDir);
                callbackResult({ ok: true,
                    msg: "Volume removed" }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("pruneDockerVolumes", async (includeCompose : unknown, callback) => {
            try {
                checkLogin(socket);
                const include = requireBoolean(includeCompose, "includeCompose");
                const result = await pruneVolumes(include, server.stacksDir);
                callbackResult({ ok: true,
                    ...result }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("createDockerVolume", async (payload : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof payload !== "object" || payload === null) {
                    throw new ValidationError("Invalid volume data");
                }

                const data = payload as { name? : unknown, driver? : unknown };
                const driver = typeof data.driver === "string" && data.driver !== "" ? data.driver : "local";
                const name = await createVolume(requireString(data.name, "Volume name"), driver);

                callbackResult({ ok: true,
                    msg: `Volume ${name} created`,
                    name }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Migrate copies data between volumes; it never touches compose files, the
        // user switches compose.yaml over to the new volume afterwards.
        agentSocket.on("migrateDockerVolume", async (payload : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof payload !== "object" || payload === null) {
                    throw new ValidationError("Invalid migration data");
                }

                const data = payload as {
                    source? : unknown,
                    target? : unknown,
                    keepSource? : unknown,
                    driver? : unknown,
                };

                const source = requireString(data.source, "Source volume");
                const target = requireString(data.target, "Target volume");
                const keepSource = typeof data.keepSource === "boolean" ? data.keepSource : true;
                const driver = typeof data.driver === "string" && data.driver !== "" ? data.driver : "local";

                // Refuse while a container still mounts the source: the copy would be inconsistent
                const containers = await listContainers();
                const volumes = await listVolumes(containers);
                const sourceInfo = volumes.find((volume) => volume.name === source);

                if (!sourceInfo) {
                    throw new ValidationError("Source volume not found");
                }
                if (sourceInfo.used) {
                    throw new ValidationError("A container is still mounting this volume. Stop the stack first.");
                }

                const result = await migrateVolume(source, target, { keepSource,
                    driver });

                callbackResult({ ok: true,
                    msg: `Data copied to ${result.target}`,
                    ...result }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // ***************************
        // Networks
        // ***************************

        agentSocket.on("getDockerNetworkResourceList", async (callback) => {
            try {
                checkLogin(socket);
                const containers = await listContainers();
                const networks = await listNetworks(containers);
                callbackResult({ ok: true,
                    networks }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("connectDockerContainerNetwork", async (payload : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof payload !== "object" || payload === null) {
                    throw new ValidationError("Invalid network connection data");
                }

                const data = payload as { network? : unknown, containerId? : unknown, apply? : unknown, expectedHash? : unknown };
                const networkName = requireString(data.network, "Network name");
                const containerId = requireString(data.containerId, "Container ID");

                if (!/^[a-f0-9]{12,64}$/.test(containerId)) {
                    throw new ValidationError("Invalid container ID");
                }

                const containers = await listContainers();
                const matches = containers.filter((item) => item.id === containerId || item.id.startsWith(containerId));
                const container = matches.length === 1 ? matches[0] : null;
                const networks = await listNetworks(containers);
                const network = networks.find((item) => item.name === networkName);

                if (!container || !network) {
                    throw new ValidationError("Container or network not found");
                }
                if (network.builtIn) {
                    throw new ValidationError("Built-in networks cannot be configured here");
                }
                if (network.containers.some((item) => container.id.startsWith(item.id))) {
                    throw new ValidationError("Container is already connected to this network");
                }

                let stack : Stack | null = null;
                let originalYAML = "";
                let updatedYAML = "";

                if (container.stack && container.service && /^[a-z0-9_-]+$/.test(container.stack)
                    && await Stack.composeFileExists(server.stacksDir, container.stack)) {
                    const rootPath = await realpath(server.stacksDir);
                    const stackPath = await realpath(path.join(server.stacksDir, container.stack));

                    if (path.dirname(stackPath) === rootPath) {
                        stack = await Stack.getStack(server, container.stack);
                        originalYAML = stack.composeYAML;
                        updatedYAML = addServiceNetwork(originalYAML, container.stack, container.service, network);
                    }
                }

                if (!stack) {
                    throw new ValidationError("This container has no managed Compose file. Use the generated external network snippet in its own Compose project.");
                }
                if (data.apply === true && data.expectedHash !== composeHash(originalYAML)) {
                    throw new ValidationError("Compose file changed after the preview. Preview it again.");
                }
                if (data.apply === true && updatedYAML !== originalYAML) {
                    await saveServiceNetwork(stack.composeFilePath, originalYAML, updatedYAML, true);
                    server.sendStackList().catch((e) => log.warn("network", `Unable to refresh stack list: ${String(e)}`));
                }

                callbackResult({ ok: true,
                    msg: data.apply === true ? "networkComposeSynced" : "networkComposePreview",
                    msgi18n: true,
                    composeSynced: data.apply === true,
                    stack: container.stack,
                    composeHash: composeHash(originalYAML),
                    composeYAML: updatedYAML }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("getDockerResourceSummary", async (callback) => {
            try {
                checkLogin(socket);
                const snapshot = await getSnapshot();
                callbackResult({
                    ok: true,
                    summary: {
                        containerCount: snapshot.containers.length,
                        imageCount: snapshot.images.length,
                        unusedImageCount: snapshot.images.filter((image) => !image.used).length,
                        volumeCount: snapshot.volumes.length,
                        unusedVolumeCount: snapshot.volumes.filter((volume) => !volume.used).length,
                        networkCount: snapshot.networks.length,
                        unusedNetworkCount: snapshot.networks.filter((network) => !network.builtIn && !network.used).length,
                    },
                    resources: {
                        containers: snapshot.containers.slice(0, 8).map((container) => ({
                            name: container.name,
                            query: container.id,
                            used: container.state === "running",
                        })),
                        images: snapshot.images.slice(0, 8).map((image) => ({
                            name: image.reference,
                            used: image.used,
                        })),
                        volumes: snapshot.volumes.slice(0, 8).map((volume) => ({
                            name: volume.name,
                            used: volume.used,
                        })),
                        networks: snapshot.networks.slice(0, 8).map((network) => ({
                            name: network.name,
                            used: network.used,
                            builtIn: network.builtIn,
                        })),
                    },
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("removeDockerNetwork", async (id : unknown, callback) => {
            try {
                checkLogin(socket);
                await removeNetwork(requireString(id, "Network ID"), server.stacksDir);
                callbackResult({ ok: true,
                    msg: "Network removed" }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("pruneDockerNetworks", async (includeCompose : unknown, callback) => {
            try {
                checkLogin(socket);
                const include = requireBoolean(includeCompose, "includeCompose");
                const result = await pruneNetworks(include, server.stacksDir);
                callbackResult({ ok: true,
                    ...result }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("createDockerNetwork", async (payload : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof payload !== "object" || payload === null) {
                    throw new ValidationError("Invalid network data");
                }

                const data = payload as { name? : unknown, driver? : unknown, internal? : unknown };
                const driver = typeof data.driver === "string" && data.driver !== "" ? data.driver : "bridge";
                const internal = data.internal === true;
                const name = await createNetwork(requireString(data.name, "Network name"), driver, internal);

                callbackResult({ ok: true,
                    msg: `Network ${name} created`,
                    name }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Build Compose changes for every managed service on the selected source networks.
        agentSocket.on("mergeDockerNetworks", async (payload : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof payload !== "object" || payload === null) {
                    throw new ValidationError("Invalid merge data");
                }
                const data = payload as { target? : unknown, sources? : unknown, apply? : unknown, expectedHashes? : unknown };
                const targetName = requireString(data.target, "Target network");
                if (!Array.isArray(data.sources) || data.sources.length === 0 || !data.sources.every((item) => typeof item === "string")) {
                    throw new ValidationError("Select at least one network to merge");
                }
                const sourceNames = data.sources as string[];
                const containers = await listContainers();
                const networks = await listNetworks(containers);
                const target = networks.find((item) => item.name === targetName);
                if (!target || target.builtIn) {
                    throw new ValidationError("Target network is unavailable");
                }
                const selected = networks.filter((item) => sourceNames.includes(item.name) && item.name !== targetName);
                if (selected.length !== new Set(sourceNames).size) {
                    throw new ValidationError("Source network is unavailable");
                }
                const members = new Map<string, typeof containers[number]>();
                for (const source of selected) {
                    for (const member of containers.filter((item) => item.networks.includes(source.name))) {
                        members.set(member.id, member);
                    }
                }
                const plans : { stack : string, original : string, updated : string, filePath : string }[] = [];
                for (const member of members.values()) {
                    if (!member.stack || !member.service || !/^[a-z0-9_-]+$/.test(member.stack)
                        || !await Stack.composeFileExists(server.stacksDir, member.stack)) {
                        throw new ValidationError(`Container ${member.name} is not in a managed Compose stack`);
                    }
                    const rootPath = await realpath(server.stacksDir);
                    const stackPath = await realpath(path.join(server.stacksDir, member.stack));
                    if (path.dirname(stackPath) !== rootPath) {
                        throw new ValidationError("Invalid stack path");
                    }
                    let plan = plans.find((item) => item.stack === member.stack);
                    if (!plan) {
                        const stack = await Stack.getStack(server, member.stack);
                        plan = { stack: member.stack,
                            original: stack.composeYAML,
                            updated: stack.composeYAML,
                            filePath: stack.composeFilePath };
                        plans.push(plan);
                    }
                    plan.updated = addServiceNetwork(plan.updated, member.stack, member.service, target);
                }
                if (data.apply === true) {
                    const expected = data.expectedHashes as Record<string, string> | null;
                    if (!expected || plans.some((plan) => expected[plan.stack] !== composeHash(plan.original))) {
                        throw new ValidationError("A Compose file changed after the preview. Preview the changes again.");
                    }
                    for (const plan of plans) {
                        await saveServiceNetwork(plan.filePath, plan.original, plan.updated, true);
                    }
                    server.sendStackList().catch((e) => log.warn("network", String(e)));
                }
                callbackResult({ ok: true,
                    msg: data.apply === true ? "networkComposeSynced" : "networkComposePreview",
                    msgi18n: true,
                    plans: plans.map(({ stack, original, updated }) => ({ stack,
                        composeHash: composeHash(original),
                        composeYAML: updated })) }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // ***************************
        // Registries
        // ***************************

        agentSocket.on("getRegistryList", async (callback) => {
            try {
                checkLogin(socket);
                const list = await Registry.getRegistryList();
                const sources = await getDockerRegistrySources();
                callbackResult({
                    ok: true,
                    registries: list.map((registry) => registry.toJSON()),
                    sources,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("saveRegistry", async (data : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof data !== "object" || data === null) {
                    throw new ValidationError("Invalid registry data");
                }

                const payload = data as {
                    id? : unknown,
                    name? : unknown,
                    url? : unknown,
                    username? : unknown,
                    password? : unknown,
                };

                const url = normalizeRegistryUrl(requireString(payload.url, "Registry URL"));

                if (url.length > 255 || !REGISTRY_URL_REGEX.test(url)) {
                    throw new ValidationError("Invalid registry URL");
                }

                const username = requireString(payload.username, "Username");
                let name = typeof payload.name === "string" ? payload.name.trim() : "";

                if (!name) {
                    name = url;
                }

                let bean : Registry | null = null;

                if (payload.id !== undefined && payload.id !== null && payload.id !== "") {
                    const registryId = Number(payload.id);

                    if (!Number.isInteger(registryId) || registryId <= 0) {
                        throw new ValidationError("Invalid registry id");
                    }

                    bean = await R.findOne("registry", " id = ? ", [ registryId ]) as Registry | null;

                    if (!bean) {
                        throw new ValidationError("Registry not found");
                    }
                }

                // Keep the previous password when the field is left empty while editing
                let password = typeof payload.password === "string" ? payload.password : "";

                if (!password && bean) {
                    password = decryptSecret(bean.password, server.jwtSecret);
                }

                if (!password) {
                    throw new ValidationError("Password or access token is required");
                }

                await dockerLogin(url, username, password);

                if (!bean) {
                    bean = R.dispense("registry") as Registry;
                    bean.createdDate = new Date().toISOString();
                }

                bean.name = name;
                bean.url = url;
                bean.username = username;
                bean.password = encryptSecret(password, server.jwtSecret);

                await R.store(bean);

                callbackResult({
                    ok: true,
                    msg: "Saved",
                    msgi18n: true,
                    registry: bean.toJSON(),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("deleteRegistry", async (id : unknown, callback) => {
            try {
                checkLogin(socket);

                const bean = await R.findOne("registry", " id = ? ", [ Number(id) ]) as Registry | null;

                if (!bean) {
                    throw new ValidationError("Registry not found");
                }

                // Best effort: drop the stored docker credential as well
                const logoutRes = await dockerExec([ "logout", bean.url ]);

                if (logoutRes.exitCode !== 0) {
                    log.warn("registry", `docker logout ${bean.url} failed: ${logoutRes.stderr}`);
                }

                await R.trash(bean);

                callbackResult({ ok: true,
                    msg: "Deleted",
                    msgi18n: true }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Re-run `docker login` after a container restart, when ~/.docker/config.json is gone
        agentSocket.on("reloginRegistry", async (id : unknown, callback) => {
            try {
                checkLogin(socket);

                const bean = await R.findOne("registry", " id = ? ", [ Number(id) ]) as Registry | null;

                if (!bean) {
                    throw new ValidationError("Registry not found");
                }

                await dockerLogin(bean.url, bean.username, decryptSecret(bean.password, server.jwtSecret));

                callbackResult({ ok: true,
                    msg: "Logged in successfully" }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("reloginAllRegistries", async (callback) => {
            try {
                checkLogin(socket);

                const list = await Registry.getRegistryList();
                const failed : { url : string, error : string }[] = [];

                for (const bean of list) {
                    try {
                        await dockerLogin(bean.url, bean.username, decryptSecret(bean.password, server.jwtSecret));
                    } catch (e) {
                        if (e instanceof Error) {
                            failed.push({ url: bean.url,
                                error: e.message });
                        }
                    }
                }

                callbackResult({
                    ok: failed.length === 0,
                    msg: failed.length === 0 ? "All registries are logged in" : `Failed: ${failed.map((item) => item.url).join(", ")}`,
                    failed,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });
    }
}

/**
 * Strip the protocol and trailing slashes, `docker login` expects a host (or host/path).
 */
export function normalizeRegistryUrl(url : string) : string {
    let normalized = url.trim().replace(/^https?:\/\//i, "");

    if (normalized.endsWith("/v1/")) {
        normalized = normalized.substring(0, normalized.length - 1);
    }

    return normalized.replace(/\/+$/, "");
}

/**
 * Run `docker login` with the password on stdin, so it never shows up in the process list.
 */
export async function dockerLogin(url : string, username : string, password : string) : Promise<void> {
    const res = await dockerExec([ "login", url, "-u", username, "--password-stdin" ], password);

    if (res.exitCode !== 0) {
        throw new Error(res.stderr || "docker login failed");
    }
}
