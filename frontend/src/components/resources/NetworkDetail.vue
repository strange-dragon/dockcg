<template>
    <div class="resource-detail">
        <template v-if="network">
            <div class="detail-head">
                <span class="badge badge-lg" :class="stateClass">{{ $t(stateLabel) }}</span>
                <h1 class="detail-title">{{ network.name }}</h1>
            </div>

            <div class="actions">
                <button class="btn btn-dark" :disabled="busy || mergeCandidates.length === 0" @click="showMerge = true">
                    <font-awesome-icon icon="code-branch" /> {{ $t("mergeNetworks") }}
                </button>
                <button class="btn btn-primary" :disabled="busy" @click="showSnippet = true">
                    <font-awesome-icon icon="share-nodes" /> {{ $t("shareAcrossStacks") }}
                </button>
                <button class="btn btn-dark" :disabled="busy" @click="load">
                    <font-awesome-icon icon="arrows-rotate" :spin="busy" /> {{ $t("refresh") }}
                </button>
                <button class="btn btn-danger" :disabled="network.used || network.builtIn || !!network.stack || busy" :title="deleteTitle" @click="$refs.confirm.show()">
                    <font-awesome-icon icon="trash" /> {{ $t("delete") }}
                </button>
            </div>
            <div class="note">{{ $t("networkDetailNote") }}</div>

            <section class="relation-section">
                <h2 class="section-title">{{ $t("networkRelations") }}</h2>
                <p class="note">{{ $t("networkRelationHint") }}</p>
                <div class="relation-grid">
                    <div class="card relation-panel">
                        <h3>{{ $t("availableContainers") }}</h3>
                        <p class="relation-help">{{ $t("dragContainerHint") }}</p>
                        <div v-if="availableContainers.length === 0" class="relation-empty">{{ $t("noAvailableContainers") }}</div>
                        <div v-for="entry in availableContainers" :key="entry.id" class="relation-container" draggable="true" @dragstart="onDragStart($event, entry)" @dragend="onDragEnd">
                            <div class="relation-name">{{ entry.name }}</div>
                            <div class="relation-sub">{{ entry.source }}<span v-if="entry.stack"> · {{ entry.stack }}</span></div>
                            <button class="btn btn-sm btn-outline-primary" type="button" :disabled="busy || network.builtIn" @click="entry.stack && entry.service ? connectContainer(entry.id) : showSnippet = true">
                                {{ $t(entry.stack && entry.service ? "previewComposeChange" : "viewComposeSnippet") }}
                            </button>
                        </div>
                    </div>
                    <div class="card relation-panel relation-target" :class="{ 'drag-over': dragOver && !network.builtIn }" @dragover.prevent="onDragOver" @dragleave="dragOver = false" @drop.prevent="onDrop">
                        <h3>{{ network.name }}</h3>
                        <p class="relation-help">{{ $t(network.builtIn ? "builtInNetworkMsg" : "dropContainerHint") }}</p>
                        <div v-if="network.containers.length === 0" class="relation-empty">{{ $t("noContainerUsesNetwork") }}</div>
                        <div v-for="container in network.containers" :key="container.id" class="relation-container attached">
                            <div class="relation-name">{{ container.name }}</div>
                            <div class="relation-sub">{{ container.stack || $t("noStack") }}<span v-if="container.service"> / {{ container.service }}</span></div>
                        </div>
                    </div>
                </div>
                <p class="relation-warning">{{ $t("networkAutoComposeHint") }}</p>
                <p v-if="lastConnection !== null" class="relation-warning text-success">
                    {{ $t("networkComposeSynced") }}
                </p>
            </section>

            <div class="detail-grid">
                <div class="col">
                    <section>
                        <h2 class="section-title">{{ $t("connectedContainers") }}</h2>
                        <div class="card">
                            <div v-for="container in network.containers" :key="container.id" class="crow">
                                <div class="crow-main">
                                    <div class="crow-name">{{ container.name }}</div>
                                    <div class="crow-sub">
                                        <span v-if="container.stack">{{ container.stack }}</span>
                                        <span v-if="container.stack && container.service"> / </span>
                                        <span v-if="container.service">{{ container.service }}</span>
                                    </div>
                                </div>
                                <div class="crow-right">
                                    <span class="badge" :class="container.state === 'running' ? 'bg-primary' : 'bg-secondary'">{{ $te(`dockerState.${container.state}`) ? $t(`dockerState.${container.state}`) : container.state }}</span>
                                </div>
                            </div>
                            <div v-if="network.containers.length === 0" class="crow">
                                <div class="crow-sub">{{ $t("noContainerUsesNetwork") }}</div>
                            </div>
                        </div>
                    </section>
                </div>

                <div class="col">
                    <section>
                        <h2 class="section-title">{{ $t("details") }}</h2>
                        <div class="card">
                            <div class="kv-row"><div class="kv-k">{{ $t("driver") }}</div><div class="kv-v">{{ network.driver }}</div></div>
                            <div class="kv-row"><div class="kv-k">{{ $t("subnet") }}</div><div class="kv-v mono">{{ network.subnet || "-" }}</div></div>
                            <div class="kv-row"><div class="kv-k">{{ $t("scope") }}</div><div class="kv-v">{{ network.scope }}</div></div>
                            <div class="kv-row"><div class="kv-k">{{ $t("internal") }}</div><div class="kv-v">{{ network.internal ? $t("yes") : $t("no") }}</div></div>
                            <div class="kv-row">
                                <div class="kv-k">{{ $t("composeProject") }}</div>
                                <div class="kv-v">
                                    <template v-if="network.stack">
                                        {{ network.stack }} <span v-if="network.composeNetwork" class="muted">/ {{ $t("network") }}: {{ network.composeNetwork }}</span>
                                    </template>
                                    <template v-else>-</template>
                                </div>
                            </div>
                            <div class="kv-row"><div class="kv-k">{{ $t("networkID") }}</div><div class="kv-v mono">{{ network.id }}</div></div>
                        </div>
                    </section>
                </div>
            </div>
        </template>

        <div v-else-if="!loading" class="empty-state">{{ $t("selectNetworkHint") }}</div>

        <!-- Merge -->
        <BModal v-model="showMerge" :title="$t('mergeNetworksInto', [ network ? network.name : '' ])" :ok-title="$t('merge')" :ok-disabled="merging" @ok="doMerge">
            <p class="small text-muted">{{ $t("mergeHint") }}</p>

            <label v-for="candidate in mergeCandidates" :key="candidate.name" class="merge-item">
                <input v-model="mergeSelection" type="checkbox" :value="candidate.name" />
                <div>
                    <div>{{ candidate.name }}</div>
                    <div class="small text-muted">{{ candidate.containers.length }} {{ $t("containers") }} · {{ candidate.subnet || "-" }}</div>
                </div>
            </label>
        </BModal>

        <!-- Snippet -->
        <BModal v-model="showSnippet" :title="$t('shareAcrossStacks')" :ok-title="$t('copyBoth')" @ok="copyBoth">
            <p class="small text-muted">{{ $t("snippetHint") }}</p>
            <div class="small text-muted mt-2">{{ $t("provider") }}</div>
            <pre class="snippet">{{ providerSnippet }}</pre>
            <div class="small text-muted mt-2">{{ $t("consumer") }}</div>
            <pre class="snippet">{{ consumerSnippet }}</pre>
        </BModal>

        <BModal v-model="showComposePreview" :title="$t('networkComposePreview')" :ok-title="$t('saveComposeChanges')" :ok-disabled="busy" @ok="applyComposeChange">
            <p class="small text-muted">{{ $t('networkComposeDeployHint') }}</p>
            <div v-for="plan in composePlans" :key="plan.stack">
                <strong>{{ plan.stack }}/compose.yaml</strong>
                <pre class="snippet migration-preview">{{ plan.composeYAML }}</pre>
            </div>
        </BModal>

        <Confirm ref="confirm" :yes-text="$t('yes')" :no-text="$t('no')" btn-style="btn-danger" @yes="doRemove">
            {{ $t("confirmRemoveNetwork") }}
        </Confirm>
    </div>
</template>

<script>
import Confirm from "../Confirm.vue";

export default {
    components: {
        Confirm,
    },

    props: {
        endpoint: {
            type: String,
            default: "",
        },
    },

    data() {
        return {
            networks: [],
            loading: false,
            requestId: 0,
            busy: false,
            merging: false,
            showMerge: false,
            showSnippet: false,
            mergeSelection: [],
            dragOver: false,
            lastConnection: null,
            showComposePreview: false,
            composePlans: [],
            pendingComposeAction: null,
        };
    },

    computed: {
        name() {
            return this.$route.query.name || "";
        },

        network() {
            if (!this.name) {
                return null;
            }
            return this.networks.find((item) => item.name === this.name) || null;
        },

        stateLabel() {
            if (!this.network) {
                return "";
            }
            if (this.network.builtIn) {
                return "builtIn";
            }
            return this.network.used ? "inUse" : "unused";
        },

        stateClass() {
            if (!this.network) {
                return "";
            }
            if (this.network.builtIn) {
                return "bg-secondary";
            }
            return this.network.used ? "bg-primary" : "bg-secondary";
        },

        deleteTitle() {
            if (!this.network) {
                return "";
            }
            if (this.network.builtIn) {
                return this.$t("builtInNetworkMsg");
            }
            if (this.network.stack) {
                return this.$t("composeNetworkProtected");
            }
            return this.network.used ? this.$t("networkAttachedMsg") : this.$t("delete");
        },

        mergeCandidates() {
            if (!this.network) {
                return [];
            }
            return this.networks.filter((item) => item.name !== this.network.name && !item.builtIn && item.used);
        },

        availableContainers() {
            if (!this.network) {
                return [];
            }

            const attached = new Set(this.network.containers.map((container) => container.id));
            const available = new Map();

            for (const network of this.networks) {
                if (network.name === this.network.name) {
                    continue;
                }
                for (const container of network.containers) {
                    if (!attached.has(container.id) && !available.has(container.id)) {
                        available.set(container.id, { ...container,
                            source: network.name });
                    }
                }
            }

            return Array.from(available.values()).sort((a, b) => a.name.localeCompare(b.name));
        },

        providerSnippet() {
            const name = this.network ? this.network.name : "network";
            const driver = this.network ? this.network.driver : "bridge";
            return `services:\n  <service>:\n    networks:\n      - ${name}\n\nnetworks:\n  ${name}:\n    driver: ${driver}\n    name: ${name}`;
        },

        consumerSnippet() {
            const name = this.network ? this.network.name : "network";
            return `services:\n  <service>:\n    networks:\n      - ${name}\n\nnetworks:\n  ${name}:\n    external: true\n    name: ${name}`;
        },
    },

    watch: {
        name() {
            this.load();
        },
        endpoint() {
            this.lastConnection = null;
            this.load();
        },
    },

    mounted() {
        this.load();
    },

    methods: {
        load() {
            const requestId = ++this.requestId;
            this.loading = true;
            this.networks = [];

            this.$root.emitAgent(this.endpoint, "getDockerNetworkResourceList", (res) => {
                if (requestId !== this.requestId) {
                    return;
                }
                this.loading = false;

                if (res.ok) {
                    this.networks = res.networks;
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        onDragStart(event, entry) {
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData("text/plain", entry.id);
        },

        onDragEnd() {
            this.dragOver = false;
        },

        onDragOver(event) {
            if (!this.network?.builtIn) {
                this.dragOver = true;
                event.dataTransfer.dropEffect = "copy";
            }
        },

        onDrop(event) {
            this.dragOver = false;
            if (!this.network?.builtIn) {
                this.connectContainer(event.dataTransfer.getData("text/plain"));
            }
        },

        connectContainer(containerId) {
            if (!this.network || this.network.builtIn || this.busy || !this.availableContainers.some((item) => item.id === containerId)) {
                return;
            }

            this.busy = true;
            this.$root.emitAgent(this.endpoint, "connectDockerContainerNetwork", {
                network: this.network.name,
                containerId,
            }, (res) => {
                this.busy = false;
                this.$root.toastRes(res);
                if (res.ok) {
                    this.pendingComposeAction = { event: "connectDockerContainerNetwork",
                        payload: { network: this.network.name,
                            containerId } };
                    this.composePlans = [{ stack: res.stack,
                        composeHash: res.composeHash,
                        composeYAML: res.composeYAML }];
                    this.showComposePreview = true;
                }
            });
        },

        doMerge() {
            if (!this.network || this.mergeSelection.length === 0) {
                return;
            }

            this.merging = true;

            this.$root.emitAgent(this.endpoint, "mergeDockerNetworks", {
                target: this.network.name,
                sources: this.mergeSelection,
            }, (res) => {
                this.merging = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.showMerge = false;
                    this.pendingComposeAction = { event: "mergeDockerNetworks",
                        payload: { target: this.network.name,
                            sources: [ ...this.mergeSelection ] } };
                    this.composePlans = res.plans;
                    this.showComposePreview = true;
                }
            });
        },

        applyComposeChange() {
            if (!this.pendingComposeAction) {
                return;
            }
            this.busy = true;
            const expectedHashes = Object.fromEntries(this.composePlans.map((plan) => [ plan.stack, plan.composeHash ]));
            this.$root.emitAgent(this.endpoint, this.pendingComposeAction.event, { ...this.pendingComposeAction.payload,
                apply: true,
                expectedHashes,
                expectedHash: this.composePlans[0]?.composeHash }, (res) => {
                this.busy = false;
                this.$root.toastRes(res);
                if (res.ok) {
                    this.showComposePreview = false;
                    this.mergeSelection = [];
                    this.lastConnection = true;
                    this.load();
                }
            });
        },

        doRemove() {
            if (!this.network) {
                return;
            }

            this.busy = true;

            this.$root.emitAgent(this.endpoint, "removeDockerNetwork", this.network.id, (res) => {
                this.busy = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.$router.push("/resources/networks");
                } else {
                    this.load();
                }
            });
        },

        copyBoth() {
            navigator.clipboard?.writeText(`${this.providerSnippet}\n\n${this.consumerSnippet}`);
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../../styles/resource-detail.scss";

.relation-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;

    @media (max-width: 760px) {
        grid-template-columns: 1fr;
    }
}

.relation-panel {
    min-width: 0;
    padding: 14px 16px;

    h3 {
        font-size: 17px;
        margin: 0 0 4px;
        color: var(--strong);
    }
}

.relation-help, .relation-empty, .relation-warning {
    font-size: 14px;
    color: var(--muted);
}

.relation-help { margin-bottom: 12px; }
.relation-empty { padding: 15px 0; }
.relation-warning { margin: 10px 0 0; }
.relation-target { border: 1px dashed var(--card-border); }
.relation-target.drag-over { border-color: #74c2ff; background: var(--panel-bg); }

.relation-container {
    position: relative;
    padding: 10px 12px;
    margin-top: 8px;
    border: 1px solid var(--card-border);
    border-radius: 8px;
    background: var(--panel-bg);
    cursor: grab;

    &.attached { cursor: default; }
    .btn { margin-top: 8px; }
}

.relation-name { font-size: 14px; font-weight: 600; color: var(--strong); word-break: break-all; }
.relation-sub { font-size: 13px; color: var(--muted); word-break: break-all; }

.merge-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    margin-bottom: 6px;
    border: 1px solid var(--card-border);
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
}

.snippet {
    margin: 4px 0 0;
    padding: 10px;
    border-radius: 8px;
    background: var(--mono-bg);
    border: 1px solid var(--card-border);
    font-family: "JetBrains Mono", Menlo, monospace;
    font-size: 12px;
    line-height: 1.6;
    color: var(--strong);
    white-space: pre-wrap;
}

.muted {
    color: var(--muted);
}
</style>
