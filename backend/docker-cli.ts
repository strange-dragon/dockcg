import childProcessAsync from "promisify-child-process";
import { log } from "./log";

/**
 * Result of a docker CLI invocation.
 * A non-zero exit code is not thrown, so callers can decide how to react.
 */
export interface DockerExecResult {
    stdout : string;
    stderr : string;
    exitCode : number;
}

interface SpawnError extends Error {
    code? : number | string;
    stdout? : string | Buffer | null;
    stderr? : string | Buffer | null;
}

const MAX_BUFFER = 100 * 1024 * 1024;

function toText(value : string | Buffer | null | undefined) : string {
    if (value === null || value === undefined) {
        return "";
    }
    return value.toString();
}

/**
 * Run a docker command without a shell, so arguments are never interpreted.
 * @param args docker arguments, e.g. [ "image", "ls" ]
 * @param input optional stdin content (used by `docker login --password-stdin`)
 */
export async function dockerExec(args : string[], input? : string) : Promise<DockerExecResult> {
    try {
        const child = childProcessAsync.spawn("docker", args, {
            encoding: "utf-8",
            maxBuffer: MAX_BUFFER,
        });

        if (typeof input === "string") {
            child.stdin?.end(input);
        }

        const res = await child;

        return {
            stdout: toText(res.stdout),
            stderr: toText(res.stderr),
            exitCode: 0,
        };
    } catch (e) {
        const err = e as SpawnError;
        const exitCode = typeof err.code === "number" ? err.code : 1;
        const stderr = (toText(err.stderr) || err.message || "Unknown docker error").trim();

        log.debug("docker-cli", `docker ${args.join(" ")} -> exit ${exitCode}: ${stderr}`);

        return {
            stdout: toText(err.stdout),
            stderr,
            exitCode,
        };
    }
}

/**
 * Parse docker's newline-delimited JSON output (`--format '{{json .}}'`).
 */
export function parseJSONLines<T>(stdout : string) : T[] {
    const result : T[] = [];

    for (const line of stdout.split("\n")) {
        const trimmed = line.trim();

        if (!trimmed) {
            continue;
        }

        try {
            result.push(JSON.parse(trimmed) as T);
        } catch (e) {
            // Ignore partial lines and non-JSON output
        }
    }

    return result;
}

/**
 * Parse docker's human readable size ("1.09GB", "187MB", "5.6kB", "0B") into bytes.
 */
export function parseDockerSize(size : string | undefined | null) : number {
    if (!size) {
        return 0;
    }

    const match = String(size).trim().match(/^([\d.]+)\s*([a-zA-Z]*)$/);

    if (!match) {
        return 0;
    }

    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();

    const multipliers : Record<string, number> = {
        "": 1,
        "b": 1,
        "kb": 1000,
        "mb": 1000 * 1000,
        "gb": 1000 * 1000 * 1000,
        "tb": 1000 * 1000 * 1000 * 1000,
        "kib": 1024,
        "mib": 1024 * 1024,
        "gib": 1024 * 1024 * 1024,
        "tib": 1024 * 1024 * 1024 * 1024,
    };

    return Math.round(value * (multipliers[unit] ?? 1));
}

/**
 * Parse the comma separated label string that `docker ... ls --format '{{json .}}'` returns.
 * Example: "com.docker.compose.project=app,com.docker.compose.network=default"
 */
export function parseLabelString(labels : string | undefined | null) : Record<string, string> {
    const result : Record<string, string> = {};

    if (!labels) {
        return result;
    }

    for (const pair of labels.split(",")) {
        const index = pair.indexOf("=");

        if (index <= 0) {
            continue;
        }

        result[pair.substring(0, index).trim()] = pair.substring(index + 1).trim();
    }

    return result;
}

/**
 * Format bytes into a human readable string.
 */
export function formatBytes(bytes : number) : string {
    if (!bytes || bytes <= 0) {
        return "0 B";
    }

    const units = [ "B", "kB", "MB", "GB", "TB" ];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1000 && unitIndex < units.length - 1) {
        value /= 1000;
        unitIndex++;
    }

    return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
