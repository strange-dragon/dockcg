import yaml from "yaml";
import { dockerExec } from "./docker-cli";
import { listContainers } from "./docker-resources";

interface InspectedContainer {
    Id : string;
    Name : string;
    Config? : { Image? : string, Env? : string[], WorkingDir? : string, User? : string, Labels? : Record<string, string> };
    HostConfig? : {
        NetworkMode? : string;
        RestartPolicy? : { Name? : string, MaximumRetryCount? : number };
        PortBindings? : Record<string, { HostIp? : string, HostPort? : string }[] | null>;
        Privileged? : boolean;
        Devices? : unknown[];
        Binds? : string[];
    };
    Mounts? : { Type? : string, Name? : string, Source? : string, Destination? : string, RW? : boolean }[];
    NetworkSettings? : { Networks? : Record<string, unknown> };
}

/** A read-only conversion. The resulting text must be reviewed before Compose deployment. */
export async function createContainerComposeDraft(containerId : string) : Promise<{ composeYAML : string, warnings : string[] }> {
    if (!/^[a-f0-9]{12,64}$/.test(containerId)) {
        throw new Error("Invalid container ID");
    }
    const matching = (await listContainers()).filter((item) => item.id === containerId || item.id.startsWith(containerId));
    if (matching.length !== 1) {
        throw new Error("Container not found");
    }
    const result = await dockerExec([ "container", "inspect", matching[0].id ]);
    if (result.exitCode !== 0) {
        throw new Error(result.stderr || "Unable to inspect container");
    }
    const list = JSON.parse(result.stdout) as InspectedContainer[];
    const source = list[0];
    if (!source || source.Id !== matching[0].id || !source.Config?.Image) {
        throw new Error("Incomplete container inspect result");
    }
    const name = (source.Name || matching[0].name).replace(/^\//, "");
    const key = name.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^[^A-Za-z]+/, "service_");
    const service : Record<string, unknown> = { image: source.Config.Image };
    const warnings : string[] = [];
    if (matching[0].stack) {
        warnings.push("migrationAlreadyCompose");
    }
    if (source.Config.Env?.length) {
        service.environment = source.Config.Env;
        warnings.push("migrationEnvWarning");
    }
    if (source.Config.WorkingDir) {
        service.working_dir = source.Config.WorkingDir;
    }
    if (source.Config.User) {
        service.user = source.Config.User;
    }
    const restart = source.HostConfig?.RestartPolicy;
    if (restart?.Name && restart.Name !== "no") {
        service.restart = restart.Name === "on-failure" && restart.MaximumRetryCount
            ? `on-failure:${restart.MaximumRetryCount}` : restart.Name;
    }
    const portBindings = source.HostConfig?.PortBindings || {};
    const ports : string[] = [];
    for (const [ containerPort, bindings ] of Object.entries(portBindings)) {
        for (const binding of bindings || []) {
            if (!binding.HostPort) {
                warnings.push("migrationPortWarning");
                continue;
            }
            const address = binding.HostIp?.includes(":") ? `[${binding.HostIp}]` : binding.HostIp;
            const host = address && address !== "0.0.0.0" ? `${address}:` : "";
            ports.push(`${host}${binding.HostPort}:${containerPort}`);
        }
    }
    if (ports.length) {
        service.ports = ports;
    }
    const volumes : Record<string, unknown> = {};
    const mounts : string[] = [];
    for (const mount of source.Mounts || []) {
        if (!mount.Destination) {
            continue;
        }
        const option = mount.RW === false ? ":ro" : "";
        if (mount.Type === "volume" && mount.Name) {
            const alias = `volume_${Object.keys(volumes).length + 1}`;
            volumes[alias] = { external: true,
                name: mount.Name };
            mounts.push(`${alias}:${mount.Destination}${option}`);
        } else if (mount.Type === "bind" && mount.Source) {
            mounts.push(`${mount.Source}:${mount.Destination}${option}`);
        } else {
            warnings.push("migrationMountWarning");
        }
    }
    if (mounts.length) {
        service.volumes = mounts;
    }
    const mode = source.HostConfig?.NetworkMode || "";
    const networks : Record<string, unknown> = {};
    if ([ "host", "none" ].includes(mode)) {
        service.network_mode = mode;
    } else if (mode.startsWith("container:")) {
        service.network_mode = mode;
        warnings.push("migrationNetworkModeWarning");
    } else {
        const names = Object.keys(source.NetworkSettings?.Networks || {}).filter((item) => item !== "bridge");
        for (const networkName of names) {
            const alias = `network_${Object.keys(networks).length + 1}`;
            networks[alias] = { external: true,
                name: networkName };
        }
        if (Object.keys(networks).length) {
            service.networks = Object.keys(networks);
        }
    }
    if (source.HostConfig?.Privileged || source.HostConfig?.Devices?.length) {
        warnings.push("migrationDeviceWarning");
    }
    warnings.push("migrationFinalWarning");
    const compose : Record<string, unknown> = { services: { [key]: service } };
    if (Object.keys(volumes).length) {
        compose.volumes = volumes;
    }
    if (Object.keys(networks).length) {
        compose.networks = networks;
    }
    return { composeYAML: yaml.stringify(compose),
        warnings };
}
