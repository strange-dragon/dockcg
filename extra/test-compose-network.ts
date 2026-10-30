import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";
import { addServiceNetwork, saveServiceNetwork } from "../backend/compose-network-association";

const target = { name: "shared_proxy",
    stack: "other",
    composeNetwork: "default" };

const implicit = "# retained comment\nservices:\n  web:\n    image: nginx # image comment\n";
const implicitResult = addServiceNetwork(implicit, "webapp", "web", target);
const implicitParsed = yaml.parse(implicitResult);
assert.deepEqual(implicitParsed.services.web.networks, [ "default", "shared_proxy" ]);
assert.deepEqual(implicitParsed.networks.shared_proxy, { external: true,
    name: "shared_proxy" });
assert.match(implicitResult, /# retained comment/);
assert.match(implicitResult, /# image comment/);
assert.equal(addServiceNetwork(implicitResult, "webapp", "web", target), implicitResult);

const list = "services:\n  web:\n    image: nginx\n    networks:\n      - private\nnetworks:\n  private: {}\n";
const listParsed = yaml.parse(addServiceNetwork(list, "webapp", "web", target));
assert.deepEqual(listParsed.services.web.networks, [ "private", "shared_proxy" ]);

const mapping = "services:\n  web:\n    image: nginx\n    networks:\n      private:\n        aliases: [site]\nnetworks:\n  private: {}\n";
const mappingParsed = yaml.parse(addServiceNetwork(mapping, "webapp", "web", target));
assert.deepEqual(mappingParsed.services.web.networks.private.aliases, [ "site" ]);
assert.equal(mappingParsed.services.web.networks.shared_proxy, null);

const existingAlias = "services:\n  web:\n    image: nginx\nnetworks:\n  proxy:\n    external: true\n    name: shared_proxy\n";
const aliasParsed = yaml.parse(addServiceNetwork(existingAlias, "webapp", "web", target));
assert.deepEqual(aliasParsed.services.web.networks, [ "default", "proxy" ]);
assert.equal(aliasParsed.networks.shared_proxy, undefined);

const ownNetwork = { name: "webapp_internal",
    stack: "webapp",
    composeNetwork: "internal" };
const ownCompose = "services:\n  web:\n    image: nginx\nnetworks:\n  internal: {}\n";
const ownParsed = yaml.parse(addServiceNetwork(ownCompose, "webapp", "web", ownNetwork));
assert.deepEqual(ownParsed.services.web.networks, [ "default", "internal" ]);
assert.deepEqual(ownParsed.networks.internal, {});
assert.throws(() => addServiceNetwork(implicit, "webapp", "web", ownNetwork), /not declared/);

assert.equal(addServiceNetwork(implicit, "webapp", "web", { name: "webapp_default",
    stack: "webapp",
    composeNetwork: "default" }), implicit);
assert.throws(() => addServiceNetwork("services:\n  web:\n    network_mode: host\n", "webapp", "web", target), /network_mode/);
assert.throws(() => addServiceNetwork(implicit, "webapp", "missing", target), /not declared/);

const tempDir = await mkdtemp(join(tmpdir(), "dockcg-compose-network-"));
const filePath = join(tempDir, "compose.yaml");
await writeFile(filePath, implicit);
await saveServiceNetwork(filePath, implicit, implicitResult);
assert.equal(await readFile(filePath, "utf8"), implicitResult);
await assert.rejects(saveServiceNetwork(filePath, implicit, list), /changed while connecting/);
assert.equal(await readFile(filePath, "utf8"), implicitResult);
await rm(tempDir, { recursive: true,
    force: true });

console.log("Compose network association tests passed");
