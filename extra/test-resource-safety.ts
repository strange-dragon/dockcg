import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "yaml";
import { getComposeResourceClaims } from "../backend/compose-resource-claims";
import { createContainerComposeDraft } from "../backend/container-compose-draft";
import { getVolumeUsage, previewPrune, removeVolume } from "../backend/docker-resources";
import { migrateVolume } from "../backend/docker-resource-actions";

const root = await mkdtemp(path.join(os.tmpdir(), "dockcg-resource-test-"));
const stacks = path.join(root, "stacks");
const app = path.join(stacks, "app");
await mkdir(app, { recursive: true });
await writeFile(path.join(app, "compose.yaml"), "services:\n  web:\n    image: nginx\nvolumes:\n  data: {}\nnetworks:\n  shared:\n    name: proxy_network\n");
await mkdir(path.join(stacks, "external"));
await writeFile(path.join(stacks, "external", "compose.yml"), "name: custom\nservices:\n  web:\n    image: nginx\nvolumes:\n  cache: {}\n  shared:\n    external:\n      name: shared_data\n");
const claims = await getComposeResourceClaims(stacks);
assert(claims.volumes.has("app_data"));
assert(claims.volumes.has("custom_cache"));
assert(claims.volumes.has("shared_data"));
assert(claims.networks.has("proxy_network"));

const id = "a".repeat(64);
const docker = path.join(root, "docker");
await writeFile(docker, `#!/usr/bin/env node
const args = process.argv.slice(2);
const id = "${id}";
let value;
if (args[0] === "ps") value = process.env.DOCKCG_TEST_MODE === "down" ? "" : id + "\\n";
else if (args[0] === "container" && args[1] === "inspect") value = JSON.stringify([{Id:id,Name:"/legacy",Image:"sha256:abc",State:{Status:"running"},Config:{Image:"nginx:latest",Env:["APP_MODE=prod"]},HostConfig:{RestartPolicy:{Name:"unless-stopped"},PortBindings:{"80/tcp":[{HostIp:"",HostPort:"8080"}]}},Mounts:[{Type:"volume",Name:"app_data",Destination:"/data",RW:true}],NetworkSettings:{Networks:{bridge:{}}}}]);
else if (args[0] === "volume" && args[1] === "ls") value = JSON.stringify({Name:"app_data",Driver:"local",Scope:"local"}) + "\\n";
else if (args[0] === "volume" && args[1] === "inspect") {
  if (args[2] !== "app_data") process.exit(1);
  value = JSON.stringify([{Name:"app_data",Driver:"local",Scope:"local",Labels:{}}]);
}
else if (args[0] === "system" && args[1] === "df") value = "Local Volumes space usage:\\n\\nVOLUME NAME   LINKS   SIZE\\napp_data      0       24.5MB\\n\\nBuild cache usage:\\n";
else if (args[0] === "volume" && args[1] === "rm") { process.exit(99); }
else { process.stderr.write("unexpected docker command: " + args.join(" ")); process.exit(2); }
process.stdout.write(value);
`);
await chmod(docker, 0o755);
process.env.PATH = `${root}${path.delimiter}${process.env.PATH || ""}`;
process.env.DOCKCG_TEST_MODE = "down";

const candidates = await previewPrune("volumes", stacks);
assert.deepEqual(candidates, []);
assert.equal(await getVolumeUsage("app_data"), "24.5MB");
await assert.rejects(removeVolume("app_data", stacks), /Compose/);
await assert.rejects(migrateVolume("missing", "target"), /Source volume not found/);
process.env.DOCKCG_TEST_MODE = "active";
const draft = await createContainerComposeDraft(id);
const parsed = yaml.parse(draft.composeYAML);
assert.equal(parsed.services.legacy.image, "nginx:latest");
assert.deepEqual(parsed.services.legacy.ports, [ "8080:80/tcp" ]);
assert.equal(parsed.volumes.volume_1.name, "app_data");
assert(draft.warnings.length > 0);
process.stdout.write("resource safety and migration draft OK\n");
