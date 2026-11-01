import { dockerExec } from "./docker-cli";
import { ValidationError } from "./util-server";

/**
 * Read-only helpers for the System Resources pages.
 *
 * Creating volumes, networks or pulling images is deliberately absent here:
 * new objects only ever come from a compose file, so this module can only
 * inspect what already exists. Deletion and pruning live in docker-resources.ts.
 */

export interface ImageDetail {
    reference : string;
    id : string;
    shortID : string;
    size : number;
    digest : string;
    created : string;
    platform : string;
    entrypoint : string;
    cmd : string;
    exposed : string[];
    layerCount : number;
    tags : string[];
}

interface RawImageInspect {
    Id? : string;
    Size? : number;
    Created? : string;
    Architecture? : string;
    Os? : string;
    RepoTags? : string[];
    RepoDigests? : string[];
    Config? : {
        Entrypoint? : string[] | null;
        Cmd? : string[] | null;
        ExposedPorts? : Record<string, unknown> | null;
    };
    RootFS? : { Layers? : string[] };
}

function joinCommand(parts : string[] | null | undefined) : string {
    if (!parts || parts.length === 0) {
        return "";
    }
    return parts.join(" ");
}

/**
 * Inspect a single image so the detail page can show digest, platform,
 * entrypoint, exposed ports and the layer chain.
 */
export async function inspectImage(reference : string) : Promise<ImageDetail> {
    const target = reference.trim();

    if (target === "" || target.length > 255) {
        throw new ValidationError("Invalid image reference");
    }

    const res = await dockerExec([ "image", "inspect", target ]);

    if (res.exitCode !== 0) {
        throw new Error(res.stderr || `Unable to inspect image ${target}`);
    }

    let raw : RawImageInspect;

    try {
        const parsed = JSON.parse(res.stdout) as RawImageInspect[];
        raw = parsed[0];
    } catch (e) {
        throw new Error("Unable to parse `docker image inspect` output");
    }

    if (!raw || !raw.Id) {
        throw new Error(`Image ${target} not found`);
    }

    const id = raw.Id;
    const repoDigest = (raw.RepoDigests || []).find((item) => item.includes("@")) || "";
    const exposedPorts = Object.keys(raw.Config?.ExposedPorts || {});

    return {
        reference: target,
        id,
        shortID: id.replace(/^sha256:/, "").substring(0, 12),
        size: raw.Size || 0,
        digest: repoDigest.includes("@") ? repoDigest.split("@")[1] : "",
        created: raw.Created || "",
        platform: [ raw.Os, raw.Architecture ].filter((item) => !!item).join("/"),
        entrypoint: joinCommand(raw.Config?.Entrypoint),
        cmd: joinCommand(raw.Config?.Cmd),
        exposed: exposedPorts,
        layerCount: raw.RootFS?.Layers?.length || 0,
        tags: raw.RepoTags || [],
    };
}
