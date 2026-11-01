import { promises as fsAsync } from "node:fs";
import type { DockcgServer } from "./dockcg-server";
import { Stack } from "./stack";
import { dockerExec } from "./docker-cli";
import { listContainers } from "./docker-resources";
import { createContainerComposeDraft } from "./container-compose-draft";
import { DockcgSocket, ValidationError } from "./util-server";
import { log } from "./log";

export interface ContainerAdoptionResult {
    stackName : string;
    composeYAML : string;
    warnings : string[];
}

/** Dockge stack names only accept [a-z0-9_-], so a container name has to be folded into that. */
export function toStackName(value : string) : string {
    const name = value
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^[-_]+/, "")
        .replace(/[-_]+$/, "");
    return name === "" ? "migrated" : name.substring(0, 60);
}

/**
 * Take a container that no compose file owns and hand it to a stack.
 *
 * The compose file is written first, then the old container is stopped so the
 * new one can bind the same ports, and only after `up -d` succeeded is the old
 * container removed. If the deploy fails the old container is started again and
 * the stack folder is removed, so a failed adoption leaves nothing behind.
 */
export async function adoptContainerToStack(
    server : DockcgServer,
    socket : DockcgSocket,
    containerId : unknown,
    stackName : unknown,
) : Promise<ContainerAdoptionResult> {
    if (typeof containerId !== "string" || !/^[a-f0-9]{12,64}$/.test(containerId)) {
        throw new ValidationError("Invalid container ID");
    }

    const containers = await listContainers();
    const container = containers.find((item) => item.id === containerId || item.id.startsWith(containerId));
    if (!container) {
        throw new ValidationError("Container not found");
    }
    if (container.stack) {
        throw new ValidationError("This container already belongs to a Compose stack");
    }

    const name = toStackName(typeof stackName === "string" && stackName.trim() !== "" ? stackName.trim() : container.name);
    const draft = await createContainerComposeDraft(container.id);

    // save(true) refuses to reuse an existing stack name, which also prevents
    // writing into a folder that is already managed by someone else.
    const stack = new Stack(server, name, draft.composeYAML, "", false);
    await stack.save(true);

    await dockerExec([ "stop", container.id ]);

    try {
        await stack.start(socket);
    } catch (e) {
        // Roll back: the container the user already had keeps running.
        await dockerExec([ "start", container.id ]);
        await fsAsync.rm(stack.path, {
            recursive: true,
            force: true,
        });
        throw e;
    }

    const removed = await dockerExec([ "rm", container.id ]);
    if (removed.exitCode !== 0) {
        log.warn("container-adoption", `Unable to remove the old container ${container.name}: ${removed.stderr.trim()}`);
    }

    return {
        stackName: name,
        composeYAML: draft.composeYAML,
        warnings: draft.warnings,
    };
}
