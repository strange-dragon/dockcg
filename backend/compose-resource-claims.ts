import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";

/** Names still declared by a managed Compose file, even when the stack is down. */
export async function getComposeResourceClaims(stacksDir : string) : Promise<{ volumes : Set<string>, networks : Set<string> }> {
    const volumes = new Set<string>();
    const networks = new Set<string>();
    const root = await realpath(stacksDir);
    const entries = await readdir(root, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory() || !/^[A-Za-z0-9_-]+$/.test(entry.name)) {
            continue;
        }
        const dir = path.join(root, entry.name);
        if (path.dirname(await realpath(dir)) !== root) {
            continue;
        }
        for (const filename of [ "compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml" ]) {
            let source : string;
            try {
                source = await readFile(path.join(dir, filename), "utf8");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                    continue;
                }
                throw error;
            }
            const document = yaml.parseDocument(source);
            if (document.errors.length) {
                throw new Error(`Cannot inspect Compose resources in ${entry.name}/${filename}`);
            }
            const data = document.toJS() as Record<string, unknown>;
            const projectName = typeof data.name === "string" ? data.name : entry.name;
            for (const [ kind, destination ] of [[ "volumes", volumes ], [ "networks", networks ]] as const) {
                const declarations = data[kind];
                if (!declarations || typeof declarations !== "object" || Array.isArray(declarations)) {
                    continue;
                }
                for (const [ key, definition ] of Object.entries(declarations)) {
                    const options = definition && typeof definition === "object" ? definition as Record<string, unknown> : {};
                    const external = options.external && typeof options.external === "object" ? options.external as Record<string, unknown> : null;
                    const name = typeof options.name === "string" ? options.name
                        : typeof external?.name === "string" ? external.name
                            : options.external ? key : `${projectName}_${key}`;
                    if (name.includes("${")) {
                        throw new Error(`Cannot resolve Compose resource name in ${entry.name}/${filename}`);
                    }
                    destination.add(name);
                }
            }
            break;
        }
    }
    return { volumes,
        networks };
}
