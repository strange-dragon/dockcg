import { AgentSocketHandler } from "../agent-socket-handler";
import { DockgeServer } from "../dockge-server";
import { callbackError, callbackResult, checkLogin, DockgeSocket, ValidationError } from "../util-server";
import { AgentSocket } from "../../common/agent-socket";
import { getImagePullTerminalName } from "../../common/util-common";
import { Terminal } from "../terminal";
import { R } from "redbean-node";
import { Registry } from "../models/registry";
import { decryptSecret, encryptSecret } from "../secret-box";
import { dockerExec } from "../docker-cli";
import {
    getSnapshot,
    listImages,
    listContainers,
    listNetworks,
    listVolumes,
    pruneImages,
    pruneNetworks,
    pruneVolumes,
    removeImage,
    removeNetwork,
    removeVolume
} from "../docker-resources";
import { log } from "../log";

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

/**
 * Read-only Docker resource management (images / volumes / networks)
 * plus private registry credentials.
 *
 * This handler runs on the instance that owns the docker daemon, so it also
 * works transparently through Dockge agents.
 */
export class DockerResourceSocketHandler extends AgentSocketHandler {
    create(socket : DockgeSocket, server : DockgeServer, agentSocket : AgentSocket) {
        // Do not call super.create()

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

        agentSocket.on("removeDockerVolume", async (name : unknown, callback) => {
            try {
                checkLogin(socket);
                await removeVolume(requireString(name, "Volume name"));
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
                const result = await pruneVolumes(include);
                callbackResult({ ok: true,
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
                        networkCount: snapshot.networks.filter((network) => !network.builtIn).length,
                        unusedNetworkCount: snapshot.networks.filter((network) => !network.builtIn && !network.used).length,
                    },
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("removeDockerNetwork", async (id : unknown, callback) => {
            try {
                checkLogin(socket);
                await removeNetwork(requireString(id, "Network ID"));
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
                const result = await pruneNetworks(include);
                callbackResult({ ok: true,
                    ...result }, callback);
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
                callbackResult({
                    ok: true,
                    registries: list.map((registry) => registry.toJSON()),
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
