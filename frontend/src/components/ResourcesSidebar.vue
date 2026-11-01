<template>
    <aside class="resource-sidebar">
        <select v-if="hasMultipleEndpoints" v-model="endpointLocal" class="form-select form-select-sm">
            <option v-for="(agent, agentEndpoint) in $root.agentList" :key="agentEndpoint" :value="agentEndpoint">
                {{ (agent.name !== '') ? agent.name : (agent.url || $t("currentEndpoint")) }}
            </option>
        </select>

        <!-- One row of top-level lists. Containers are not one of them: a stack
             owns its containers, so they live under their stack below. -->
        <div class="seg">
            <button
                v-for="tab in tabs" :key="tab.key" class="seg-item"
                :class="{ active: activeTab === tab.key }" type="button"
                @click="go(tab.key)"
            >
                {{ $t(tab.label) }}
            </button>
        </div>

        <div class="panel">
            <div class="panel-head">
                <div class="search">
                    <font-awesome-icon icon="search" class="search-icon" />
                    <input
                        v-model="search" class="search-input" type="search"
                        :placeholder="searchPlaceholder" autocomplete="off"
                    />
                    <button v-if="search !== ''" class="search-clear" type="button" :title="$t('cancel')" @click="search = ''">
                        <font-awesome-icon icon="times" />
                    </button>
                </div>

                <!-- New stacks still start from a compose file; resource lists are read-only -->
                <button
                    v-if="activeTab === 'stacks' || activeTab === 'overview'" class="icon-btn"
                    type="button" :title="$t('compose')" @click="$router.push('/compose')"
                >
                    <font-awesome-icon icon="plus" />
                </button>
            </div>

            <div class="panel-body">
                <!-- STACKS: a stack is a compose project, so its containers are its children -->
                <template v-if="activeTab === 'stacks' || activeTab === 'overview'">
                    <div v-for="(group, index) in stackGroups" :key="group.endpoint" class="stack-group">
                        <div v-if="hasMultipleEndpoints" class="group-label" :class="{ separated: index > 0 }">{{ group.label }}</div>

                        <template v-for="stack in group.stacks" :key="stackKey(stack)">
                            <div class="row stack-row" :class="{ sel: isCurrentStack(stack) }">
                                <button
                                    class="caret" :class="{ open: isOpen(stack) }" type="button"
                                    :title="$t('containers')" @click="toggle(stack)"
                                >
                                    <font-awesome-icon icon="chevron-down" />
                                </button>
                                <router-link :to="stackUrl(stack)" class="row-name">{{ stack.name }}</router-link>
                                <span v-if="containerCount(stack) > 0" class="row-count">{{ containerCount(stack) }}</span>
                                <Uptime :stack="stack" />
                            </div>

                            <div v-if="isOpen(stack)" class="children">
                                <button
                                    v-for="container in containersOf(stack)" :key="container.id" class="row child"
                                    :class="{ sel: container.id === selectedContainerId }" type="button"
                                    :title="`${container.image} · ${container.state}`" @click="openContainer(container)"
                                >
                                    <span class="dot" :class="{ on: container.state === 'running' }"></span>
                                    <span class="row-name">{{ container.service || container.name }}</span>
                                </button>
                                <div v-if="containersOf(stack).length === 0" class="hint">{{ $t("noResources") }}</div>
                            </div>
                        </template>
                    </div>

                    <div v-if="stackGroups.length === 0" class="empty">
                        {{ search !== "" ? $t("noResources") : $t("noStacks") }}
                    </div>

                    <!-- Containers that no compose file owns -->
                    <div v-if="unmanaged.length > 0" class="stack-group">
                        <div class="group-label separated">
                            {{ $t("unmanaged") }} <span class="row-count">{{ unmanaged.length }}</span>
                        </div>
                        <button
                            v-for="container in unmanaged" :key="container.id" class="row child"
                            :class="{ sel: container.id === selectedContainerId }" type="button"
                            :title="`${container.image} · ${container.state}`" @click="openContainer(container)"
                        >
                            <span class="dot" :class="{ on: container.state === 'running' }"></span>
                            <span class="row-name">{{ container.name }}</span>
                        </button>
                    </div>
                </template>

                <!-- IMAGES / VOLUMES / NETWORKS -->
                <template v-else>
                    <button
                        v-for="row in loading || loadError ? [] : rows" :key="row.key" class="row resource-row"
                        :class="{ sel: row.key === selectedKey }" type="button"
                        @click="openRow(row)"
                    >
                        <span class="badge" :class="row.badgeClass">{{ $t(row.badge) }}</span>
                        <span class="row-name">{{ row.label }}<span v-if="row.tag" class="tag">{{ row.tag }}</span></span>
                    </button>

                    <div v-if="loading" class="empty" role="status">{{ $t("loadingResources") }}</div>
                    <div v-else-if="loadError" class="empty error">{{ $t("resourceLoadFailed") }} {{ loadError }}</div>
                    <div v-else-if="rows.length === 0" class="empty">{{ $t("noResources") }}</div>
                </template>
            </div>

            <div class="panel-foot">
                <router-link to="/resources" class="foot-link" :class="{ active: activeTab === 'overview' }">
                    {{ $t("overview") }}
                </router-link>
                <button class="foot-refresh" type="button" :disabled="loading" :title="$t('refresh')" @click="refresh">
                    <font-awesome-icon icon="arrows-rotate" :spin="loading" />
                </button>
            </div>
        </div>
    </aside>
</template>

<script>
import { RUNNING } from "../../../common/util-common";
import Uptime from "./Uptime.vue";

const TABS = [
    { key: "stacks",
        label: "stacks" },
    { key: "images",
        label: "images" },
    { key: "volumes",
        label: "volumes" },
    { key: "networks",
        label: "networks" },
];

/** Stacks keep Dockge's ordering: managed first, then running, then by name. */
function compareStacks(m1, m2) {
    if (m1.isManagedByDockcg && !m2.isManagedByDockcg) {
        return -1;
    }
    if (!m1.isManagedByDockcg && m2.isManagedByDockcg) {
        return 1;
    }
    if (m1.status !== m2.status) {
        if (m2.status === RUNNING) {
            return 1;
        }
        if (m1.status === RUNNING) {
            return -1;
        }
    }
    return m1.name.localeCompare(m2.name);
}

export default {
    components: {
        Uptime,
    },

    props: {
        endpoint: {
            type: String,
            default: "",
        },
    },

    emits: [ "update:endpoint" ],

    data() {
        return {
            tabs: TABS,
            search: "",
            loading: false,
            loadError: "",
            requestId: 0,
            images: [],
            containers: [],
            volumes: [],
            networks: [],
            openStacks: {},
        };
    },

    computed: {
        activeTab() {
            const path = this.$route.path;

            if (path.startsWith("/resources/images")) {
                return "images";
            }
            if (path.startsWith("/resources/volumes")) {
                return "volumes";
            }
            if (path.startsWith("/resources/networks")) {
                return "networks";
            }
            if (path === "/resources") {
                return "overview";
            }
            return "stacks";
        },

        searchPlaceholder() {
            if (this.activeTab === "stacks" || this.activeTab === "overview") {
                return `${this.$t("search")} — ${this.$t("stacks")} / ${this.$t("containers")}`;
            }
            return this.$t("search");
        },

        hasMultipleEndpoints() {
            return Object.keys(this.$root.agentList || {}).length > 1;
        },

        endpointLocal: {
            get() {
                return this.endpoint;
            },
            set(value) {
                this.$emit("update:endpoint", value);
            },
        },

        /** Selected item in the resource lists (also drives the detail pages) */
        selectedKey() {
            return this.$route.query.name || "";
        },

        /** A container detail page is open when the route points at one */
        selectedContainerId() {
            return this.$route.path.startsWith("/resources/containers") ? (this.$route.query.name || "") : "";
        },

        allStacks() {
            return Object.values(this.$root.completeStackList || {});
        },

        /* Stacks, filtered by their own name or by any of their containers */
        filteredStacks() {
            const keyword = this.search.trim().toLowerCase();

            if (keyword === "") {
                return [ ...this.allStacks ].sort(compareStacks);
            }

            return this.allStacks.filter((stack) => {
                if (stack.name.toLowerCase().includes(keyword)) {
                    return true;
                }
                return this.containersOf(stack).some((container) => String(container.name).toLowerCase().includes(keyword)
                    || String(container.service).toLowerCase().includes(keyword)
                    || String(container.image).toLowerCase().includes(keyword));
            }).sort(compareStacks);
        },

        /* Same endpoint grouping Dockge uses, with the local endpoint first */
        stackGroups() {
            const groups = new Map();

            for (const stack of this.filteredStacks) {
                const endpoint = stack.endpoint || "current";
                if (!groups.has(endpoint)) {
                    groups.set(endpoint, []);
                }
                groups.get(endpoint).push(stack);
            }

            return [ ...groups.entries() ].map(([ endpoint, stacks ]) => ({
                endpoint,
                label: endpoint === "current" ? this.$t("currentEndpoint") : endpoint,
                stacks,
            })).sort((a, b) => {
                if (a.endpoint === "current" && b.endpoint !== "current") {
                    return -1;
                }
                if (a.endpoint !== "current" && b.endpoint === "current") {
                    return 1;
                }
                return a.endpoint.localeCompare(b.endpoint);
            });
        },

        /* Containers no compose file claims — they get their own small group */
        unmanaged() {
            const keyword = this.search.trim().toLowerCase();

            return this.containers.filter((container) => {
                if (container.stack) {
                    return false;
                }
                if (keyword === "") {
                    return true;
                }
                return String(container.name).toLowerCase().includes(keyword)
                    || String(container.image).toLowerCase().includes(keyword);
            });
        },

        rows() {
            const keyword = this.search.trim().toLowerCase();
            const match = (text) => !keyword || String(text).toLowerCase().includes(keyword);

            if (this.activeTab === "images") {
                return this.images
                    .filter((image) => match(`${image.repository}:${image.tag}`) || match(image.shortID))
                    .map((image) => ({
                        key: image.dangling ? `<none>:<none>@${image.id}` : `${image.repository}:${image.tag}`,
                        label: image.dangling ? "<none>" : image.repository,
                        tag: image.dangling ? "" : `:${image.tag}`,
                        badge: image.used ? "inUse" : (image.dangling ? "dangling" : "unused"),
                        badgeClass: image.used ? "bg-primary" : (image.dangling ? "bg-warning" : "bg-secondary"),
                        type: "images",
                        query: image.dangling ? image.id : `${image.repository}:${image.tag}`,
                    }));
            }

            if (this.activeTab === "volumes") {
                return this.volumes
                    .filter((volume) => match(volume.name))
                    .map((volume) => ({
                        key: volume.name,
                        label: volume.name,
                        tag: "",
                        badge: volume.used ? "mounted" : "orphaned",
                        badgeClass: volume.used ? "bg-primary" : "bg-warning",
                        type: "volumes",
                        query: volume.name,
                    }));
            }

            if (this.activeTab === "networks") {
                return this.networks
                    .filter((network) => match(network.name))
                    .map((network) => ({
                        key: network.name,
                        label: network.name,
                        tag: "",
                        badge: network.builtIn ? "builtIn" : (network.used ? "inUse" : "unused"),
                        badgeClass: network.builtIn ? "bg-secondary" : (network.used ? "bg-primary" : "bg-secondary"),
                        type: "networks",
                        query: network.name,
                    }));
            }

            return [];
        },
    },

    watch: {
        activeTab() {
            this.search = "";
            this.refresh();
        },
        endpoint() {
            this.refresh();
        },
        "$root.agentList"() {
            this.refresh();
        },
        "$root.socketIO.connected"(connected) {
            if (connected) {
                this.refresh();
            }
        },
        "$route.params.stackName"() {
            this.expandCurrentStack();
        },
    },

    mounted() {
        this.expandCurrentStack();
        this.refresh();
    },

    methods: {
        go(tab) {
            if (tab === "stacks") {
                this.$router.push("/");
            } else {
                this.$router.push(`/resources/${tab}`);
            }
        },

        stackKey(stack) {
            return `${stack.name}_${stack.endpoint || "current"}`;
        },

        stackUrl(stack) {
            if (stack.endpoint) {
                return `/compose/${stack.name}/${stack.endpoint}`;
            }
            return `/compose/${stack.name}`;
        },

        isCurrentStack(stack) {
            return this.$route.params.stackName === stack.name;
        },

        isOpen(stack) {
            return this.openStacks[this.stackKey(stack)] === true;
        },

        toggle(stack) {
            const key = this.stackKey(stack);
            this.openStacks[key] = !this.openStacks[key];
        },

        /** Keep the stack you are editing open, so its containers are visible */
        expandCurrentStack() {
            const name = this.$route.params.stackName;
            if (!name) {
                return;
            }
            const endpoint = this.$route.params.endpoint || "current";
            this.openStacks[`${name}_${endpoint}`] = true;
        },

        /**
         * Containers of a stack. Containers are listed for the selected agent
         * only, so a stack that belongs to another agent has no children here.
         */
        containersOf(stack) {
            const stackEndpoint = stack.endpoint || "current";
            if (this.hasMultipleEndpoints && stackEndpoint !== (this.endpoint || "current")) {
                return [];
            }
            return this.containers.filter((container) => container.stack === stack.name);
        },

        containerCount(stack) {
            return this.containersOf(stack).length;
        },

        openContainer(container) {
            this.$router.push({ path: "/resources/containers",
                query: { name: container.id } });
        },

        openRow(row) {
            this.$router.push({ path: `/resources/${row.type}`,
                query: { name: row.query } });
        },

        refresh() {
            const requestId = ++this.requestId;
            const done = (res, apply) => {
                if (requestId !== this.requestId) {
                    return;
                }
                this.loading = false;
                if (res && res.ok) {
                    apply(res);
                } else {
                    this.loadError = res?.msg || this.$t("unknownError");
                }
            };

            this.loadError = "";
            this.loading = true;

            if (this.activeTab === "images") {
                this.$root.emitAgent(this.endpoint, "getDockerImageList", (res) => done(res, (r) => {
                    this.images = r.images;
                }));
                return;
            }

            if (this.activeTab === "volumes") {
                this.$root.emitAgent(this.endpoint, "getDockerVolumeList", (res) => done(res, (r) => {
                    this.volumes = r.volumes;
                }));
                return;
            }

            if (this.activeTab === "networks") {
                this.$root.emitAgent(this.endpoint, "getDockerNetworkResourceList", (res) => done(res, (r) => {
                    this.networks = r.networks;
                }));
                return;
            }

            // Stacks: the container list tells us what each stack is running
            this.$root.emitAgent(this.endpoint, "getDockerContainerMigrationList", (res) => done(res, (r) => {
                this.containers = r.containers;
            }));
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../styles/vars.scss";
@import "../styles/resource-tokens.scss";

.resource-sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--rd-2);
}

/* Top-level lists: one quiet track, one filled pill. Never wraps. */
.seg {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: var(--rd-radius);
    background: #eceff3;

    .dark & {
        background: $dark-header-bg;
    }
}

.seg-item {
    flex: 1 1 0;
    min-width: 0;
    padding: 6px 4px;
    border: 0;
    border-radius: var(--rd-radius-sm);
    background: transparent;
    color: #5c6773;
    font-size: var(--rd-fs-small);
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    transition: background 0.1s ease-in-out, color 0.1s ease-in-out;

    &:hover {
        color: #111;
        background: rgba(0, 0, 0, 0.04);
    }

    .dark & {
        color: $dark-font-color;
    }

    .dark &:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.04);
    }

    &.active {
        background: $primary;
        color: #0b1a26;
        font-weight: 600;

        .dark & {
            background: $primary;
            color: #071a27;
        }
    }
}

.panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: calc(100vh - 190px);
    position: sticky;
    top: 10px;
    border: 1px solid var(--card-border);
    border-radius: var(--rd-radius);
    background: #fff;
    overflow: hidden;

    .dark & {
        background: $dark-bg;
    }
}

.panel-head {
    display: flex;
    align-items: center;
    gap: var(--rd-2);
    padding: var(--rd-2);
    border-bottom: 1px solid var(--card-border);

    .dark & {
        background: $dark-header-bg;
    }
}

.search {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
}

.search-icon {
    position: absolute;
    left: 9px;
    color: var(--dim);
    font-size: 12px;
    pointer-events: none;
}

.search-input {
    width: 100%;
    height: 30px;
    padding: 0 26px;
    border: 1px solid var(--card-border);
    border-radius: var(--rd-radius-sm);
    background: var(--panel-bg);
    color: inherit;
    font-size: var(--rd-fs-small);
    line-height: 30px;
    outline: none;

    &::placeholder {
        color: var(--dim);
    }

    &::-webkit-search-cancel-button {
        display: none;
    }

    &:focus {
        border-color: $primary;
        background: transparent;
    }

    .dark & {
        background: $dark-bg2;
    }
}

.search-clear {
    position: absolute;
    right: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--dim);
    font-size: 10px;
    cursor: pointer;

    &:hover {
        color: var(--strong);
    }
}

.icon-btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: var(--rd-radius-sm);
    background: $primary;
    color: #08202e;
    font-size: 13px;
    cursor: pointer;
    transition: filter 0.1s ease-in-out;

    &:hover {
        filter: brightness(1.08);
    }
}

.panel-body {
    flex: 1 1 auto;
    min-height: 0;
    padding: var(--rd-1) var(--rd-2) var(--rd-2);
    overflow-y: auto;
}

.row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 6px;
    border: 0;
    border-radius: var(--rd-radius-sm);
    background: transparent;
    color: inherit;
    text-align: left;
    font-size: var(--rd-fs-small);
    line-height: 1.4;
    cursor: pointer;
    transition: background 0.1s ease-in-out;

    &:hover {
        background: var(--panel-bg);
    }

    .dark &:hover {
        background: $dark-header-bg;
    }

    &.sel {
        background: rgba($primary, 0.18);

        .dark & {
            background: rgba($primary, 0.14);
        }
    }
}

.row-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.stack-row .row-name {
    color: inherit;
    text-decoration: none;
    font-weight: 500;

    &:hover {
        color: $primary;
    }
}

.row-count {
    flex: 0 0 auto;
    color: var(--dim);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
}

.stack-row .badge {
    flex: 0 0 auto;
    min-width: 56px;
    font-weight: 500;
}

.caret {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--dim);
    font-size: 10px;
    cursor: pointer;

    svg {
        transition: transform 0.12s ease-in-out;
        transform: rotate(-90deg);
    }

    &.open svg {
        transform: rotate(0deg);
    }

    &:hover {
        color: var(--strong);
        background: var(--panel-bg);

        .dark & {
            background: $dark-bg2;
        }
    }
}

.children {
    padding-left: 18px;
}

.child {
    padding-left: 6px;
    color: var(--muted);
}

.dot {
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--dim);

    &.on {
        background: $primary;
    }
}

.group-label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 6px 4px;
    color: var(--muted);
    font-size: 12px;
    letter-spacing: 0.02em;

    &.separated {
        margin-top: var(--rd-1);
        border-top: 1px solid var(--card-border);
    }
}

.hint {
    padding: 2px 6px 6px;
    color: var(--dim);
    font-size: 12px;
}

.resource-row .badge {
    flex: 0 0 auto;
}

.resource-row .tag {
    color: var(--muted);
}

.empty {
    padding: var(--rd-5) var(--rd-2);
    text-align: center;
    color: var(--muted);
    font-size: var(--rd-fs-small);

    &.error {
        color: $danger;
    }
}

.panel-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px var(--rd-2);
    border-top: 1px solid var(--card-border);

    .dark & {
        background: $dark-header-bg;
    }
}

.foot-link {
    padding: 3px 6px;
    border-radius: var(--rd-radius-sm);
    color: var(--muted);
    font-size: var(--rd-fs-small);
    text-decoration: none;

    &:hover,
    &.active {
        color: $primary;
    }
}

.foot-refresh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--rd-radius-sm);
    background: transparent;
    color: var(--muted);
    font-size: 11px;
    cursor: pointer;

    &:hover:not(:disabled) {
        color: $primary;
    }

    &:disabled {
        opacity: 0.6;
    }
}
</style>
