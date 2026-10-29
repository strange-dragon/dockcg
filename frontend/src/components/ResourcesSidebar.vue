<template>
    <div class="resource-sidebar">
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

        <div class="side-action">
            <button class="btn btn-primary w-100" type="button" @click="primaryAction">
                <font-awesome-icon :icon="actionIcon" /> {{ $t(actionLabel) }}
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
        <div v-else class="shadow-box resource-list-box">
            <div class="search-wrapper mb-2">
                <input v-model="search" class="form-control search-input" :placeholder="$t('search')" autocomplete="off" />
            </div>

            <div class="resource-rows">
                <button
                    v-for="row in rows" :key="row.key" class="resource-row"
                    :class="{ sel: row.key === selectedKey }" type="button"
                    @click="openRow(row)"
                >
                    <span class="badge" :class="row.badgeClass">{{ $t(row.badge) }}</span>
                    <span class="resource-name">{{ row.label }}<span v-if="row.tag" class="tag">{{ row.tag }}</span></span>
                </button>

                <div v-if="!loading && rows.length === 0" class="empty">{{ $t("noResources") }}</div>
            </div>

            <div class="resource-footer">
                <button class="btn btn-link btn-sm p-0" type="button" :disabled="loading" @click="refresh">
                    <font-awesome-icon icon="arrows-rotate" :spin="loading" /> {{ $t("refresh") }}
                </button>
            </div>
        </div>

        <!-- Pull image -->
        <BModal v-model="showPull" :title="$t('pullImage')" :ok-title="$t('pull')" @ok="doPull">
            <p class="small text-muted">{{ $t("pullImageHint") }}</p>
            <input v-model="pullReference" class="form-control" :placeholder="$t('imageReferencePlaceholder')" autocomplete="off" spellcheck="false" />
            <Terminal v-if="showPullTerminal" :name="pullTerminalName" :endpoint="endpoint" :rows="6" class="mt-3" />
        </BModal>

        <!-- Create volume -->
        <BModal v-model="showCreateVolume" :title="$t('createVolume')" :ok-title="$t('create')" @ok="doCreateVolume">
            <p class="small text-muted">{{ $t("createVolumeHint") }}</p>
            <label class="form-label">{{ $t("name") }}</label>
            <input v-model="volumeForm.name" class="form-control mb-2" placeholder="shared_uploads" autocomplete="off" />
            <label class="form-label">{{ $t("driver") }}</label>
            <select v-model="volumeForm.driver" class="form-select">
                <option value="local">local</option>
                <option value="nfs">nfs</option>
            </select>
        </BModal>

        <!-- Create network -->
        <BModal v-model="showCreateNetwork" :title="$t('createNetwork')" :ok-title="$t('create')" @ok="doCreateNetwork">
            <p class="small text-muted">{{ $t("createNetworkHint") }}</p>
            <label class="form-label">{{ $t("name") }}</label>
            <input v-model="networkForm.name" class="form-control mb-2" placeholder="proxy_network" autocomplete="off" />
            <label class="form-label">{{ $t("driver") }}</label>
            <select v-model="networkForm.driver" class="form-select mb-2">
                <option value="bridge">bridge</option>
                <option value="overlay">overlay</option>
                <option value="macvlan">macvlan</option>
            </select>
            <div class="form-check">
                <input id="net-internal" v-model="networkForm.internal" class="form-check-input" type="checkbox" />
                <label class="form-check-label" for="net-internal">{{ $t("networkInternal") }}</label>
            </div>
        </BModal>
    </div>
</template>

<script>
import StackList from "./StackList.vue";
import Terminal from "./Terminal.vue";
import { getImagePullTerminalName } from "../../../common/util-common";

const TABS = [
    { key: "stacks",
        label: "stacks",
        action: "compose",
        icon: "plus" },
    { key: "images",
        label: "images",
        action: "pullImage",
        icon: "cloud-arrow-down" },
    { key: "volumes",
        label: "volumes",
        action: "createVolume",
        icon: "plus" },
    { key: "networks",
        label: "networks",
        action: "createNetwork",
        icon: "plus" },
];

export default {
    components: {
        StackList,
        Terminal,
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
            images: [],
            volumes: [],
            networks: [],
            showPull: false,
            showPullTerminal: false,
            pullReference: "",
            showCreateVolume: false,
            showCreateNetwork: false,
            volumeForm: {
                name: "",
                driver: "local",
            },
            networkForm: {
                name: "",
                driver: "bridge",
                internal: false,
            },
        };
    },

    computed: {
        pullTerminalName() {
            return getImagePullTerminalName(this.endpoint);
        },

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
            return "stacks";
        },

        actionLabel() {
            return this.tabs.find((tab) => tab.key === this.activeTab)?.action || "compose";
        },

        actionIcon() {
            return this.tabs.find((tab) => tab.key === this.activeTab)?.icon || "plus";
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

        primaryAction() {
            if (this.activeTab === "images") {
                this.showPull = true;
                return;
            }
            if (this.activeTab === "volumes") {
                this.showCreateVolume = true;
                return;
            }
            if (this.activeTab === "networks") {
                this.showCreateNetwork = true;
                return;
            }
            this.$router.push("/compose");
        },

        refresh() {
            if (this.activeTab === "images") {
                this.loading = true;
                this.$root.emitAgent(this.endpoint, "getDockerImageList", (res) => {
                    this.loading = false;
                    if (res.ok) {
                        this.images = res.images;
                    } else {
                        this.$root.toastRes(res);
                    }
                });
                return;
            }

            if (this.activeTab === "volumes") {
                this.loading = true;
                this.$root.emitAgent(this.endpoint, "getDockerVolumeList", (res) => {
                    this.loading = false;
                    if (res.ok) {
                        this.volumes = res.volumes;
                    } else {
                        this.$root.toastRes(res);
                    }
                });
                return;
            }

            if (this.activeTab === "networks") {
                this.loading = true;
                this.$root.emitAgent(this.endpoint, "getDockerNetworkResourceList", (res) => {
                    this.loading = false;
                    if (res.ok) {
                        this.networks = res.networks;
                    } else {
                        this.$root.toastRes(res);
                    }
                });
            }
        },

        doPull() {
            const reference = this.pullReference.trim();

            if (!reference) {
                return;
            }

            this.showPullTerminal = true;

            this.$root.emitAgent(this.endpoint, "pullDockerImage", reference, (res) => {
                this.$root.toastRes(res);
                this.pullReference = "";
                this.refresh();
            });
        },

        doCreateVolume() {
            this.$root.emitAgent(this.endpoint, "createDockerVolume", this.volumeForm, (res) => {
                this.$root.toastRes(res);

                if (res.ok) {
                    this.volumeForm.name = "";
                    this.refresh();
                }
            });
        },

        doCreateNetwork() {
            this.$root.emitAgent(this.endpoint, "createDockerNetwork", this.networkForm, (res) => {
                this.$root.toastRes(res);

                if (res.ok) {
                    this.networkForm.name = "";
                    this.refresh();
                }
            });
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../styles/vars.scss";

.seg {
    display: flex;
    gap: 4px;
    padding: 4px;
    margin-bottom: 10px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.04);

    .dark & {
        background: $dark-header-bg;
    }
}

.seg-item {
    flex: 1;
    padding: 6px 4px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: $dark-font-color;
    font-size: 12.5px;
    line-height: 1.2;
    cursor: pointer;
    transition: all 0.1s ease-in-out;
    white-space: nowrap;

    &:hover {
        color: #fff;
    }

    &.active {
        background: rgba(116, 194, 255, 0.16);
        color: $primary;
        font-weight: 600;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }
}

.side-action {
    margin-bottom: 10px;
}

.resource-list-box {
    padding: 10px;
    border-radius: 10px;
}

.resource-rows {
    max-height: calc(100vh - 340px);
    overflow-y: auto;
}

.resource-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 9px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    text-align: left;
    font-size: 13.5px;
    cursor: pointer;
    transition: background 0.1s ease-in-out;

    &:hover {
        background: rgba(255, 255, 255, 0.04);
    }

    /* Sunken selection instead of a highlighted border */
    &.sel {
        background: $dark-bg2;
        box-shadow: inset 0 2px 7px rgba(0, 0, 0, 0.72);
    }

    .badge {
        flex: 0 0 auto;
        font-size: 10.5px;
        font-weight: 600;
        padding: 3px 7px;
    }

    .resource-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .tag {
        color: $dark-font-color3;
    }
}

.empty {
    padding: 18px 8px;
    text-align: center;
    color: $dark-font-color3;
    font-size: 13px;
}

.resource-footer {
    padding-top: 6px;
    text-align: right;

    .btn-link {
        color: $dark-font-color3;
        text-decoration: none;
        font-size: 12px;
    }
}

.search-input {
    font-size: 13px;
}
</style>
