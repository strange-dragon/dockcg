/**
 * End-to-end test for the Resources feature (images / volumes / networks / registries).
 *
 * What it does:
 *   1. deploys a real Caddy compose stack into a temporary stacks dir,
 *   2. boots a real Dockcg server against a temporary data dir,
 *   3. logs in over socket.io exactly like the frontend does and calls the
 *      same agent events the Resources pages use,
 *   4. asserts the inventory attributes the stack correctly and that cleanup
 *      never touches resources that are still in use or owned by compose.
 *
 * Usage: npx tsx extra/test-resources.ts
 * Requires: docker + compose plugin, and a built frontend-dist (npm run build:frontend).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { io, Socket } from "socket.io-client";
import { DockcgServer } from "../backend/dockcg-server";
import {
    DockerImageInfo,
    DockerNetworkInfo,
    DockerVolumeInfo
} from "../backend/docker-resources";

const execFileP = promisify(execFile);

const PORT = 5098;
const STACK_NAME = "caddy-e2e";
const CADDY_PORT = 18081;
const REGISTRY_PORT = 5555;
const REGISTRY_CONTAINER = "dockcg-e2e-registry";
const USERNAME = "e2e";
const PASSWORD = "e2ePassword123";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dockcg-e2e-"));
const dataDir = path.join(tmpRoot, "data");
const stacksDir = path.join(tmpRoot, "stacks");
const stackDir = path.join(stacksDir, STACK_NAME);

process.env.DOCKCG_DATA_DIR = dataDir;
process.env.DOCKCG_STACKS_DIR = stacksDir;
process.env.DOCKCG_PORT = String(PORT);

interface RegistryJson {
    id : number;
    name : string;
    url : string;
    username : string;
    createdDate? : string;
    hasPassword : boolean;
}

interface ResourceResponse {
    ok? : boolean;
    msg? : string;
    images? : DockerImageInfo[];
    volumes? : DockerVolumeInfo[];
    networks? : DockerNetworkInfo[];
    registries? : RegistryJson[];
    registry? : RegistryJson;
    removed? : string[];
    reclaimedText? : string;
    summary? : Record<string, number>;
}

interface LoginResponse {
    ok? : boolean;
    token? : string;
    msg? : string;
}

let failed = 0;
let passed = 0;

function ok(name : string, extra = "") {
    passed++;
    console.log(`  \u2713 ${name}${extra ? " \u2014 " + extra : ""}`);
}

function fail(name : string, detail : unknown) {
    failed++;
    const msg = detail instanceof Error ? detail.message : String(detail);
    console.log(`  \u2717 ${name} \u2014 ${msg}`);
}

function assert(name : string, condition : boolean, detail : unknown = "") {
    if (condition) {
        ok(name);
    } else {
        fail(name, detail || "assertion failed");
    }
}

function section(title : string) {
    console.log(`\n== ${title} ==`);
}

async function sh(command : string, args : string[], cwd? : string) : Promise<string> {
    const res = await execFileP(command, args, {
        cwd,
        maxBuffer: 32 * 1024 * 1024,
    });
    return res.stdout;
}

async function waitFor(label : string, timeoutMs : number, probe : () => Promise<boolean>) {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
        try {
            if (await probe()) {
                return;
            }
        } catch (e) {
            // keep polling
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(`timeout waiting for ${label}`);
}

function emitP<T>(socket : Socket, event : string, ...args : unknown[]) : Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout on event "${event}"`)), 180000);
        socket.emit(event, ...args, (res : T) => {
            clearTimeout(timer);
            resolve(res);
        });
    });
}

async function main() {
    // ---------------------------------------------------------------- fixtures
    console.log(`temp dir: ${tmpRoot}`);

    fs.mkdirSync(stackDir, {
        recursive: true,
    });
    fs.writeFileSync(path.join(stackDir, "compose.yaml"), `services:
  caddy:
    image: caddy:2-alpine
    restart: "no"
    ports:
      - "${CADDY_PORT}:80"
    volumes:
      - caddy_data:/data
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
volumes:
  caddy_data:
`);
    fs.writeFileSync(path.join(stackDir, "Caddyfile"), `:80 {
    respond "hello from dockcg e2e"
}
`);

    section("deploy a real caddy stack");
    await sh("docker", [ "compose", "up", "-d" ], stackDir);
    await waitFor("caddy to answer on its published port", 120000, async () => {
        const res = await fetch(`http://127.0.0.1:${CADDY_PORT}/`);
        return res.ok && (await res.text()).includes("dockcg e2e");
    });
    ok("caddy stack is serving traffic", `port ${CADDY_PORT}`);

    await sh("docker", [ "run", "-d", "--rm", "--name", REGISTRY_CONTAINER,
        "-p", `${REGISTRY_PORT}:5000`, "registry:2" ]);
    await waitFor("local registry", 120000, async () => {
        const res = await fetch(`http://127.0.0.1:${REGISTRY_PORT}/v2/`);
        return res.status === 200;
    });
    ok("local registry is up", `port ${REGISTRY_PORT}`);

    // ------------------------------------------------------------------ server
    section("boot dockcg and log in over socket.io");
    const server = new DockcgServer();
    await server.serve();

    await waitFor("dockcg http", 60000, async () => {
        const res = await fetch(`http://127.0.0.1:${PORT}/`);
        return res.status === 200;
    });
    ok("dockcg is listening", `port ${PORT}`);

    const socket = io(`http://127.0.0.1:${PORT}`, {
        transports: [ "websocket" ],
        reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("socket.io connect timeout")), 30000);
        socket.on("connect", () => {
            clearTimeout(timer);
            resolve();
        });
        socket.on("connect_error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });

    const setupRes = await emitP<ResourceResponse>(socket, "setup", USERNAME, PASSWORD);
    assert("first-time setup accepted", setupRes?.ok === true, setupRes?.msg);

    const loginRes = await emitP<LoginResponse>(socket, "login", {
        username: USERNAME,
        password: PASSWORD,
        token: "",
    });
    assert("login accepted", loginRes?.ok === true, loginRes?.msg);

    // Same envelope the frontend uses: emit("agent", endpoint, event, ...args, callback)
    const agent = (event : string, ...args : unknown[]) => emitP<ResourceResponse>(socket, "agent", "", event, ...args);

    // ------------------------------------------------------------------ images
    section("images");
    const imageList = await agent("getDockerImageList");
    const images : DockerImageInfo[] = imageList.images || [];
    const caddyImage = images.find((image) => image.reference.includes("caddy"));

    assert("image list returned data", images.length > 0, `count=${images.length}`);
    assert("caddy image is listed", !!caddyImage, `references=${images.map((image) => image.reference).join(",")}`);
    assert("caddy image is marked as used", caddyImage?.used === true, JSON.stringify(caddyImage?.containers));
    assert(`caddy image is attributed to stack "${STACK_NAME}"`,
        (caddyImage?.stacks || []).includes(STACK_NAME), JSON.stringify(caddyImage?.stacks));
    assert("image entries carry a human readable size",
        typeof caddyImage?.sizeText === "string" && caddyImage.sizeText.length > 0, caddyImage?.sizeText);

    if (caddyImage) {
        const removeImageRes = await agent("removeDockerImage", caddyImage.id);
        assert("removing an in-use image is refused", removeImageRes.ok === false, removeImageRes.msg);
    }

    // pre-pull goes through Terminal.exec, so this also covers the progress terminal
    const pullRes = await agent("pullDockerImage", "hello-world");
    assert("pre-pull succeeds", pullRes.ok === true, pullRes.msg);

    const afterPull = await agent("getDockerImageList");
    const pulledImage = (afterPull.images || []).find((image) => image.reference.includes("hello-world"));
    assert("pulled image shows up in the list", !!pulledImage);
    assert("pulled image is reported as unused", pulledImage?.used === false, JSON.stringify(pulledImage?.containers));

    if (pulledImage) {
        const removeUnusedRes = await agent("removeDockerImage", pulledImage.id);
        assert("removing an unused image succeeds", removeUnusedRes.ok === true, removeUnusedRes.msg);
        const afterRemove = await agent("getDockerImageList");
        assert("removed image is gone from the list",
            !(afterRemove.images || []).some((image) => image.reference.includes("hello-world")));
    }

    // ----------------------------------------------------------------- volumes
    section("volumes");
    const expectedVolume = `${STACK_NAME}_caddy_data`;
    const volumeList = await agent("getDockerVolumeList");
    const volumes : DockerVolumeInfo[] = volumeList.volumes || [];
    const caddyVolume = volumes.find((volume) => volume.name === expectedVolume);

    assert("caddy volume is listed", !!caddyVolume, `names=${volumes.map((volume) => volume.name).join(",")}`);
    assert("caddy volume is marked as used", caddyVolume?.used === true);
    assert(`caddy volume is attributed to stack "${STACK_NAME}"`, caddyVolume?.stack === STACK_NAME, caddyVolume?.stack);
    assert("caddy volume knows its compose volume name", caddyVolume?.composeVolume === "caddy_data", caddyVolume?.composeVolume);
    assert("caddy volume knows its service",
        (caddyVolume?.containers || []).some((container) => container.service === "caddy"),
        JSON.stringify(caddyVolume?.containers));
    assert("caddy volume has a mountpoint",
        typeof caddyVolume?.mountpoint === "string" && caddyVolume.mountpoint.startsWith("/"), caddyVolume?.mountpoint);

    if (caddyVolume) {
        const removeVolumeRes = await agent("removeDockerVolume", caddyVolume.name);
        assert("removing a mounted volume is refused", removeVolumeRes.ok === false, removeVolumeRes.msg);
    }

    // ----------------------------------------------------------------- networks
    section("networks");
    const expectedNetwork = `${STACK_NAME}_default`;
    const networkList = await agent("getDockerNetworkResourceList");
    const networks : DockerNetworkInfo[] = networkList.networks || [];
    const caddyNetwork = networks.find((network) => network.name === expectedNetwork);
    const bridge = networks.find((network) => network.name === "bridge");

    assert("caddy network is listed", !!caddyNetwork, `names=${networks.map((network) => network.name).join(",")}`);
    assert("caddy network is marked as used", caddyNetwork?.used === true);
    assert(`caddy network is attributed to stack "${STACK_NAME}"`, caddyNetwork?.stack === STACK_NAME, caddyNetwork?.stack);
    assert("caddy network is not flagged as built-in", caddyNetwork?.builtIn === false);
    assert("caddy network exposes a subnet",
        typeof caddyNetwork?.subnet === "string" && caddyNetwork.subnet.length > 0, caddyNetwork?.subnet);
    assert("built-in bridge network is flagged", bridge?.builtIn === true, JSON.stringify(bridge));

    if (bridge) {
        const removeBridgeRes = await agent("removeDockerNetwork", bridge.id);
        assert("removing a built-in network is refused", removeBridgeRes.ok === false, removeBridgeRes.msg);
    }

    // ----------------------------------------------------------------- summary
    section("summary");
    const summaryRes = await agent("getDockerResourceSummary");
    const summary = summaryRes.summary || {};
    assert("summary counts images", (summary.imageCount || 0) > 0, JSON.stringify(summary));
    assert("summary counts the caddy network", (summary.networkCount || 0) > 0, JSON.stringify(summary));

    // ---------------------------------------------- cleanup must not be greedy
    section("cleanup safety (stack still running)");
    const pruneVolumesBusy = await agent("pruneDockerVolumes", false);
    assert("prune skips the mounted caddy volume",
        !(pruneVolumesBusy.removed || []).includes(expectedVolume), JSON.stringify(pruneVolumesBusy.removed));

    const volumeAfterPrune = await agent("getDockerVolumeList");
    assert("caddy volume still exists after prune",
        (volumeAfterPrune.volumes || []).some((volume) => volume.name === expectedVolume) === true);

    const pruneNetworksBusy = await agent("pruneDockerNetworks", false);
    assert("prune skips the in-use caddy network",
        !(pruneNetworksBusy.removed || []).includes(expectedNetwork), JSON.stringify(pruneNetworksBusy.removed));

    const pruneImagesBusy = await agent("pruneDockerImages", "unused");
    assert("prune skips the in-use caddy image",
        !(pruneImagesBusy.removed || []).some((name) => name.includes("caddy")), JSON.stringify(pruneImagesBusy.removed));

    // orphan resources created outside compose must be reclaimable
    await sh("docker", [ "volume", "create", "dockcg-e2e-orphan" ]);
    await sh("docker", [ "network", "create", "dockcg-e2e-orphan-net" ]);

    const pruneOrphanVolumes = await agent("pruneDockerVolumes", false);
    assert("prune removes an orphan volume",
        (pruneOrphanVolumes.removed || []).includes("dockcg-e2e-orphan"), JSON.stringify(pruneOrphanVolumes.removed));

    const pruneOrphanNetworks = await agent("pruneDockerNetworks", false);
    assert("prune removes an orphan network",
        (pruneOrphanNetworks.removed || []).includes("dockcg-e2e-orphan-net"), JSON.stringify(pruneOrphanNetworks.removed));

    // --------------------------------------------------------- after stack down
    section("cleanup safety (stack stopped)");
    await sh("docker", [ "compose", "down" ], stackDir);
    await waitFor("caddy container to be gone", 60000, async () => {
        const out = await sh("docker", [ "ps", "-a", "--filter", `name=${STACK_NAME}`, "--format", "{{.Names}}" ]);
        return out.trim() === "";
    });

    const volumeAfterDown = (await agent("getDockerVolumeList")).volumes?.find((volume) => volume.name === expectedVolume);
    assert("caddy volume survives `compose down`", !!volumeAfterDown, "compose keeps named volumes");
    assert("caddy volume is now reported as unused", volumeAfterDown?.used === false, JSON.stringify(volumeAfterDown?.containers));

    const pruneComposeVolume = await agent("pruneDockerVolumes", false);
    assert("prune still skips compose-owned volumes by default",
        !(pruneComposeVolume.removed || []).includes(expectedVolume), JSON.stringify(pruneComposeVolume.removed));

    const pruneComposeVolumeOptIn = await agent("pruneDockerVolumes", true);
    assert("prune protects volumes still declared in managed Compose files even with legacy opt-in",
        !(pruneComposeVolumeOptIn.removed || []).includes(expectedVolume), JSON.stringify(pruneComposeVolumeOptIn.removed));

    // -------------------------------------------------------------- registries
    section("registries");
    const registryUrl = `127.0.0.1:${REGISTRY_PORT}`;

    const saveRes = await agent("saveRegistry", {
        name: "e2e local registry",
        url: `http://${registryUrl}/`,
        username: "e2e-user",
        password: "e2e-secret-token",
    });
    assert("registry saved and docker login ran", saveRes.ok === true, saveRes.msg);

    const savedRegistry = saveRes.registry;
    assert("registry url was normalized", savedRegistry?.url === registryUrl, savedRegistry?.url);
    assert("password is never returned to the client",
        !!savedRegistry && !("password" in savedRegistry), JSON.stringify(savedRegistry));

    const registryList = await agent("getRegistryList");
    const registries : RegistryJson[] = registryList.registries || [];
    assert("registry is listed", registries.length === 1, `count=${registries.length}`);
    assert("stored password is not exposed by the list endpoint",
        typeof registries[0]?.hasPassword === "boolean" && registries[0].hasPassword, JSON.stringify(registries[0]));

    if (savedRegistry) {
        const reloginRes = await agent("reloginRegistry", savedRegistry.id);
        assert("relogin with the stored credential works", reloginRes.ok === true, reloginRes.msg);

        const deleteRes = await agent("deleteRegistry", savedRegistry.id);
        assert("registry deleted", deleteRes.ok === true, deleteRes.msg);
        assert("registry list is empty afterwards", ((await agent("getRegistryList")).registries || []).length === 0);

        const missingRes = await agent("reloginRegistry", savedRegistry.id);
        assert("relogin for a deleted registry is rejected", missingRes.ok === false, missingRes.msg);
    }

    // ---------------------------------------------------------------- teardown
    section("teardown");
    await sh("docker", [ "compose", "down", "-v" ], stackDir).catch(() => undefined);
}

function report() {
    console.log(`\n${failed === 0 ? "\u2705 PASS" : "\u274c FAIL"} \u2014 ${passed} passed, ${failed} failed`);
}

main().catch((err) => {
    console.error("\n\u274c test crashed:", err);
    failed++;
}).finally(async () => {
    try {
        await execFileP("docker", [ "rm", "-f", REGISTRY_CONTAINER ]);
    } catch (e) {
        // registry container may never have started
    }
    fs.rmSync(tmpRoot, {
        recursive: true,
        force: true,
    });
    report();
    // let pino / socket.io flush, then hard exit
    setTimeout(() => process.exit(failed > 0 ? 1 : 0), 500);
});
