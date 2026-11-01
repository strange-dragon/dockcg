<template>
    <div class="resource-sidebar">
        <router-link to="/" class="overview-link" :class="{ active: activeTab === 'stacks' }">
            <font-awesome-icon icon="layer-group" /> {{ $t("stacks") }}
        </router-link>
        <router-link to="/resources" class="overview-link" :class="{ active: activeTab === 'overview' }">
            <font-awesome-icon icon="server" /> {{ $t("dockerResources") }}
        </router-link>
        <!-- Segmented tabs: the list below swaps with the tab, exactly like the sidebar of a desktop app -->
        <div class="seg">
            <button
                v-for="tab in tabs" :key="tab.key" class="seg-item"
                :class="{ active: activeTab === tab.key }" type="button"
                @click="go(tab.key)"
            >
                {{ $t(tab.label) }}
            </button>
        </div>

        <!-- New stacks still start from a compose file; the resource tabs are read-only -->
        <div v-if="activeTab === 'stacks'" class="side-action">
            <button class="btn btn-primary w-100" type="button" @click="$router.push('/compose')">
                <font-awesome-icon icon="plus" /> {{ $t("compose") }}
            </button>
        </div>

        <select v-if="hasMultipleEndpoints" v-model="endpointLocal" class="form-select form-select-sm mb-2">
            <option v-for="(agent, agentEndpoint) in $root.agentList" :key="agentEndpoint" :value="agentEndpoint">
                {{ (agent.name !== '') ? agent.name : (agent.url || $t("currentEndpoint")) }}
            </option>
        </select>

        <!-- Stacks keep the original Dockcg list, with its own search box -->
        <StackList v-if="activeTab === 'stacks'" :scrollbar="true" />

        <!-- Resource lists: compact rows, one badge + one name, click opens the detail page -->
        <div v-else-if="activeTab !== 'overview'" class="shadow-box resource-list-box">
            <div class="search-wrapper mb-2">
                <input v-model="search" class="form-control search-input" :placeholder="$t('search')" autocomplete="off" />
            </div>

            <div class="resource-rows">
                <button
                    v-for="row in loading || loadError ? [] : rows" :key="row.key" class="resource-row"
                    :class="{ sel: row.key === selectedKey }" type="button"
                    @click="openRow(row)"
                >
                    <span class="badge" :class="row.badgeClass">{{ $t(row.badge) }}</span>
                    <span class="resource-name">{{ row.label }}<span v-if="row.tag" class="tag">{{ row.tag }}</span></span>
                </button>

                <div v-if="loading" class="empty" role="status">{{ $t("loadingResources") }}</div>
                <div v-else-if="loadError" class="empty text-danger">{{ $t("resourceLoadFailed") }} {{ loadError }}</div>
                <div v-else-if="rows.length === 0" class="empty">{{ $t("noResources") }}</div>
            </div>

            <div class="resource-footer">
                <button class="btn btn-link btn-sm p-0" type="button" :disabled="loading" @click="refresh">
                    <font-awesome-icon icon="arrows-rotate" :spin="loading" /> {{ $t("refresh") }}
                </button>
            </div>
        </div>
    </div>
</template>

<script>
import StackList from "./StackList.vue";

const TABS = [
    { key: "containers",
        label: "containers" },
    { key: "images",
        label: "images" },
    { key: "volumes",
        label: "volumes" },
    { key: "networks",
        label: "networks" },
];

export default {
    components: {
        StackList,
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
            if (path.startsWith("/resources/containers")) {
                return "containers";
            }
            if (path === "/resources") {
                return "overview";
            }
            return "stacks";
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

        selectedKey() {
            return this.$route.query.name || "";
        },

        rows() {
            const keyword = this.search.trim().toLowerCase();
            const match = (text) => !keyword || String(text).toLowerCase().includes(keyword);

            if (this.activeTab === "containers") {
                return this.containers
                    .filter((container) => match(container.name) || match(container.image) || match(container.id))
                    .map((container) => ({
                        key: container.id,
                        label: container.name,
                        tag: ` · ${container.image}`,
                        badge: container.state === "running" ? "runningContainer" : "stoppedContainer",
                        badgeClass: container.state === "running" ? "bg-primary" : "bg-secondary",
                        type: "containers",
                        query: container.id,
                    }));
            }

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
    },

    mounted() {
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

        openRow(row) {
            this.$router.push({ path: `/resources/${row.type}`,
                query: { name: row.query } });
        },

        refresh() {
            const requestId = ++this.requestId;
            this.loadError = "";
            if (this.activeTab === "containers") {
                this.loading = true;
                this.$root.emitAgent(this.endpoint, "getDockerContainerMigrationList", (res) => {
                    if (requestId !== this.requestId) {
                        return;
                    }
                    this.loading = false;
                    if (res?.ok) {
                        this.containers = res.containers;
                    } else {
                        this.loadError = res?.msg || this.$t("unknownError");
                    }
                });
                return;
            }
            if (this.activeTab === "images") {
                this.loading = true;
                this.$root.emitAgent(this.endpoint, "getDockerImageList", (res) => {
                    if (requestId !== this.requestId) {
                        return;
                    }
                    this.loading = false;
                    if (res.ok) {
                        this.images = res.images;
                    } else {
                        this.loadError = res?.msg || this.$t("unknownError");
                    }
                });
                return;
            }

            if (this.activeTab === "volumes") {
                this.loading = true;
                this.$root.emitAgent(this.endpoint, "getDockerVolumeList", (res) => {
                    if (requestId !== this.requestId) {
                        return;
                    }
                    this.loading = false;
                    if (res.ok) {
                        this.volumes = res.volumes;
                    } else {
                        this.loadError = res?.msg || this.$t("unknownError");
                    }
                });
                return;
            }

            if (this.activeTab === "networks") {
                this.loading = true;
                this.$root.emitAgent(this.endpoint, "getDockerNetworkResourceList", (res) => {
                    if (requestId !== this.requestId) {
                        return;
                    }
                    this.loading = false;
                    if (res.ok) {
                        this.networks = res.networks;
                    } else {
                        this.loadError = res?.msg || this.$t("unknownError");
                    }
                });
                return;
            }
            this.loading = false;
        },

    },
};
</script>

<style lang="scss" scoped>
@import "../styles/vars.scss";
@import "../styles/resource-tokens.scss";

.overview-link {
    display: block;
    padding: var(--rd-2) var(--rd-3);
    margin-bottom: var(--rd-2);
    border-radius: var(--rd-radius);
    color: #343a40;
    text-decoration: none;
    font-size: var(--rd-fs-body);
    font-weight: 600;

    &:hover, &.active { background: #eef4fa; color: #246ca0; }
    .dark & { color: $dark-font-color; }
    .dark &:hover, .dark &.active { background: $dark-header-bg; color: $primary; }
}

.seg {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--rd-1);
    padding: var(--rd-1);
    margin-bottom: var(--rd-2);
    border-radius: var(--rd-radius);
    background: #f1f3f5;

    .dark & {
        background: $dark-header-bg;
    }
}

.seg-item {
    flex: 1;
    padding: 6px var(--rd-1);
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: #495057;
    font-size: var(--rd-fs-small);
    line-height: 1.2;
    cursor: pointer;
    transition: all 0.1s ease-in-out;
    white-space: nowrap;

    &:hover { color: #246ca0; background: #e7edf3; }
    .dark & { color: $dark-font-color; }
    .dark &:hover { color: #fff; background: $dark-bg; }

    &.active {
        background: #fff;
        color: #246ca0;
        font-weight: 600;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);

        .dark & { background: $dark-bg; color: $primary; }
    }
}

.side-action {
    margin-bottom: var(--rd-2);
}

.resource-list-box {
    padding: var(--rd-3);
    border-radius: var(--rd-radius);
}

.resource-rows {
    max-height: calc(100vh - 340px);
    overflow-y: auto;
}

.resource-row {
    display: flex;
    align-items: center;
    gap: var(--rd-2);
    width: 100%;
    padding: var(--rd-2) var(--rd-3);
    border: 0;
    border-radius: var(--rd-radius-sm);
    background: transparent;
    color: inherit;
    text-align: left;
    font-size: var(--rd-fs-body);
    cursor: pointer;
    transition: background 0.1s ease-in-out;

    &:hover {
        background: #f1f3f5;
        .dark & { background: $dark-header-bg; }
    }

    /* Sunken selection instead of a highlighted border */
    &.sel {
        background: #e7f2fb;
        color: #185a87;
        .dark & { background: $dark-bg2; color: $primary; }
    }

    .badge {
        flex: 0 0 auto;
    }

    .resource-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .tag {
        color: var(--muted);
    }
}

.empty {
    padding: var(--rd-4) var(--rd-2);
    text-align: center;
    color: var(--muted);
    font-size: var(--rd-fs-small);
}

.resource-footer {
    padding-top: 6px;
    text-align: right;

    .btn-link {
        color: var(--muted);
        text-decoration: none;
        font-size: var(--rd-fs-small);
    }
}

.search-input {
    font-size: var(--rd-fs-small);
}
</style>
