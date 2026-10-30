import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { dockerExec } from "./docker-cli";
import { log } from "./log";

export interface DockerRegistrySources {
    loginRegistries : string[];
    mirrors : string[];
    configError : string;
    daemonError : string;
}

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

/** Read registry names only. Docker auth and credential-helper values stay on the server. */
export async function getDockerRegistrySources() : Promise<DockerRegistrySources> {
    const loginRegistries = new Set<string>();
    const configDir = process.env.DOCKER_CONFIG || join(homedir(), ".docker");
    let configError = "";

    try {
        const config = JSON.parse(await readFile(join(configDir, "config.json"), "utf8")) as {
            auths? : Record<string, unknown>;
            credHelpers? : Record<string, unknown>;
        };

        for (const name of Object.keys(config.auths || {})) {
            loginRegistries.add(publicEndpoint(name));
        }
        for (const name of Object.keys(config.credHelpers || {})) {
            loginRegistries.add(publicEndpoint(name));
        }
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
            log.warn("docker-registry-sources", `Unable to read Docker config: ${String(e)}`);
            configError = "Unable to read Docker config";
        }
    }

    const info = await dockerExec([ "info", "--format", "{{json .RegistryMirrors}}" ]);
    let mirrors : string[] = [];
    let daemonError = "";

    if (info.exitCode === 0) {
        try {
            const parsed = JSON.parse(info.stdout) as unknown;
            if (Array.isArray(parsed)) {
                mirrors = parsed.filter((item) : item is string => typeof item === "string").map(publicEndpoint);
            }
        } catch (e) {
            daemonError = "Unable to read Docker registry mirrors";
        }
    } else {
        daemonError = info.stderr || "Unable to read Docker registry mirrors";
    }

    return {
        loginRegistries: Array.from(loginRegistries).sort(),
        mirrors,
        configError,
        daemonError,
    };
}
