import yaml from "yaml";
import { chmod, chown, lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { ValidationError } from "./util-server";
import path from "node:path";
import { dockerExec } from "./docker-cli";

export interface ComposeNetworkTarget {
    name : string;
    stack : string;
    composeNetwork : string;
}

/** Add one network to a service while retaining the document's comments and other fields. */
export function addServiceNetwork(composeYAML : string, stackName : string, serviceName : string, target : ComposeNetworkTarget) : string {
    const document = yaml.parseDocument(composeYAML);

    if (document.errors.length > 0) {
        throw new ValidationError("The Compose file contains invalid YAML");
    }

    const services = document.get("services", true);
    const service = yaml.isMap(services) ? services.get(serviceName, true) : null;

    if (!yaml.isMap(service)) {
        throw new ValidationError(`Service ${serviceName} is not declared in this Compose file`);
    }
    if (service.has("network_mode")) {
        throw new ValidationError(`Service ${serviceName} uses network_mode and cannot also declare networks`);
    }

    const serviceNetworks = service.get("networks", true);

    if (target.stack === stackName && target.composeNetwork === "default"
        && (serviceNetworks === undefined || serviceNetworks === null)) {
        return composeYAML;
    }

    let changed = false;
    let rootNetworks = document.get("networks", true);

    if (rootNetworks === undefined || rootNetworks === null) {
        document.set("networks", new yaml.YAMLMap());
        rootNetworks = document.get("networks", true);
        changed = true;
    }
    if (!yaml.isMap(rootNetworks)) {
        throw new ValidationError("Compose networks must be a mapping");
    }

    let key : string;

    if (target.stack === stackName && target.composeNetwork) {
        key = target.composeNetwork;
        if (key !== "default" && !rootNetworks.has(key)) {
            throw new ValidationError(`Network ${key} is not declared in this Compose file`);
        }
    } else {
        key = target.name;
        for (const pair of rootNetworks.items) {
            const alias = String(yaml.isScalar(pair.key) ? pair.key.value : pair.key);
            const entry = pair.value;

            if (yaml.isMap(entry) && entry.get("external") === true
                && (entry.get("name") || alias) === target.name) {
                key = alias;
                break;
            }
        }
        if (rootNetworks.has(key)) {
            const entry = rootNetworks.get(key, true);
            const isMatchingExternal = yaml.isMap(entry)
                && entry.get("external") === true
                && (entry.get("name") || key) === target.name;

            if (!isMatchingExternal) {
                const base = `dockcg_external_${target.name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
                key = base;
                let suffix = 2;
                while (rootNetworks.has(key)) {
                    key = `${base}_${suffix++}`;
                }
            }
        }
        if (!rootNetworks.has(key)) {
            rootNetworks.set(key, { external: true,
                name: target.name });
            changed = true;
        }
    }

    if (serviceNetworks === undefined || serviceNetworks === null) {
        // Explicit networks replace Compose's implicit default connection.
        service.set("networks", key === "default" ? [ "default" ] : [ "default", key ]);
        changed = true;
    } else if (yaml.isSeq(serviceNetworks)) {
        if (!serviceNetworks.items.some((item) => String(yaml.isScalar(item) ? item.value : item) === key)) {
            serviceNetworks.add(key);
            changed = true;
        }
    } else if (yaml.isMap(serviceNetworks)) {
        if (!serviceNetworks.has(key)) {
            serviceNetworks.set(key, null);
            changed = true;
        }
    } else {
        throw new ValidationError(`Service ${serviceName} has an unsupported networks definition`);
    }

    return changed ? document.toString() : composeYAML;
}

/** Atomically replace an unchanged Compose file, preserving its owner and mode. */
export async function saveServiceNetwork(filePath : string, original : string, updated : string, validateCompose = false) : Promise<void> {
    if (original === updated) {
        return;
    }

    const fileStat = await lstat(filePath);

    if (!fileStat.isFile()) {
        throw new ValidationError("Compose file must be a regular file");
    }

    const tempPath = `${filePath}.dockcg-${randomUUID()}.tmp`;

    try {
        await writeFile(tempPath, updated, { flag: "wx",
            mode: fileStat.mode & 0o777 });
        await chmod(tempPath, fileStat.mode & 0o777);

        if (fileStat.uid !== process.getuid?.() || fileStat.gid !== process.getgid?.()) {
            await chown(tempPath, fileStat.uid, fileStat.gid);
        }

        if (validateCompose) {
            const validation = await dockerExec([ "compose", "-f", tempPath, "--project-directory", path.dirname(filePath), "config", "-q" ]);
            if (validation.exitCode !== 0) {
                throw new ValidationError(validation.stderr || "Compose validation failed");
            }
        }

        if (await readFile(filePath, "utf8") !== original) {
            throw new ValidationError("Compose file changed while connecting the container. Please retry.");
        }

        await rename(tempPath, filePath);
    } finally {
        await unlink(tempPath).catch(() => {});
    }
}
