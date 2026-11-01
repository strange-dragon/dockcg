<template>
    <div class="resource-detail network-detail">
        <template v-if="network">
            <div class="detail-head">
                <span class="badge" :class="stateClass">{{ $t(stateLabel) }}</span>
                <h1 class="detail-title">{{ network.name }}</h1>
            </div>

            <div class="actions">
                <button class="btn btn-normal" :disabled="busy || mergeCandidates.length === 0" @click="showMerge = true">
                    <font-awesome-icon icon="code-branch" /> {{ $t("mergeNetworks") }}
                </button>
                <button class="btn btn-normal" :disabled="busy" @click="showSnippet = true">
                    <font-awesome-icon icon="share-nodes" /> {{ $t("shareAcrossStacks") }}
                </button>
                <button class="btn btn-normal" :disabled="busy" @click="load">
                    <font-awesome-icon icon="arrows-rotate" :spin="busy" /> {{ $t("refresh") }}
                </button>
                <button class="btn btn-danger" :disabled="network.used || network.builtIn || !!network.stack || busy" :title="deleteTitle" @click="$refs.confirm.show()">
                    <font-awesome-icon icon="trash" /> {{ $t("delete") }}
                </button>
            </div>
            <div class="note">{{ $t("networkDetailNote") }}</div>

            <section class="relation-section">
                <h2 class="section-title h5">{{ $t("networkRelations") }}</h2>
                <p class="note">{{ $t("networkRelationHint") }}</p>

                <div class="rel-grid">
                    <!-- Drag a service from here onto the network, or press + -->
                    <div class="shadow-box rel-panel">
                        <div class="rel-head">
                            <span class="rel-title">{{ $t("availableContainers") }}</span>
                            <span class="rel-count">{{ availableContainers.length }}</span>
                        </div>
                        <div class="rel-list">
                            <div
                                v-for="entry in availableContainers" :key="entry.id" class="rel-item"
                                :class="{ disabled: network.builtIn }" :draggable="!network.builtIn"
                                :title="network.builtIn ? $t('builtInNetworkMsg') : $t('dragContainerHint')"
                                @dragstart="onDragStart($event, entry)" @dragend="onDragEnd"
                            >
                                <font-awesome-icon icon="grip-vertical" class="rel-grip" />
                                <div class="rel-main">
                                    <div class="rel-name">{{ entry.name }}</div>
                                    <div class="rel-sub">{{ entry.stack }} / {{ entry.service }}</div>
                                </div>
                                <button
                                    class="rel-add" type="button" :disabled="busy || network.builtIn"
                                    :title="$t('add')" @click="connectContainer(entry.id)"
                                >
                                    <font-awesome-icon icon="plus" />
                                </button>
                            </div>
                            <div v-if="availableContainers.length === 0" class="rel-empty">{{ $t("noAvailableContainers") }}</div>
                        </div>
                    </div>

                    <!-- Drop target: everything currently attached -->
                    <div
                        class="shadow-box rel-panel rel-target" :class="{ 'drag-over': dragOver && !network.builtIn }"
                        @dragover.prevent="onDragOver" @dragleave="dragOver = false" @drop.prevent="onDrop"
                    >
                        <div class="rel-head">
                            <span class="rel-title">{{ network.name }}</span>
                            <span class="rel-count">{{ network.containers.length }}</span>
                        </div>
                        <div class="rel-list">
                            <div v-for="container in network.containers" :key="container.id" class="rel-item attached">
                                <span class="dot" :class="{ on: container.state === 'running' }"></span>
                                <div class="rel-main">
                                    <div class="rel-name">{{ container.name }}</div>
                                    <div class="rel-sub">
                                        <template v-if="container.stack">{{ container.stack }}<span v-if="container.service"> / {{ container.service }}</span></template>
                                        <template v-else>{{ $t("unmanaged") }}</template>
                                    </div>
                                </div>
                            </div>
                            <div v-if="network.containers.length === 0" class="rel-empty">{{ $t("noContainerUsesNetwork") }}</div>
                        </div>
                        <div class="rel-foot">{{ $t(network.builtIn ? "builtInNetworkMsg" : "dropContainerHint") }}</div>
                    </div>
                </div>

                <p class="relation-warning">{{ $t("networkAutoComposeHint") }}</p>
                <p v-if="lastConnection !== null" class="relation-warning text-success">
                    {{ $t("networkComposeSynced") }}
                </p>
            </section>

            <section>
                <h2 class="section-title h5">{{ $t("details") }}</h2>
                <div class="shadow-box kv-grid">
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
            containers: [],
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

        /**
         * Services that can be moved onto this network: every Compose service
         * that is not attached yet. Plain `docker run` containers are hidden on
         * purpose — only a Compose file can record the change.
         */
        availableContainers() {
            if (!this.network) {
                return [];
            }

            const attached = this.network.containers.map((container) => container.id);
            const isAttached = (id) => attached.some((item) => item === id || id.startsWith(item) || item.startsWith(id));
            const seen = new Set();
            const list = [];

            for (const container of this.containers) {
                if (!container.stack || !container.service) {
                    continue;
                }
                if (isAttached(container.id) || seen.has(container.id.substring(0, 12))) {
                    continue;
                }
                seen.add(container.id.substring(0, 12));
                list.push({
                    id: container.id,
                    name: container.name,
                    stack: container.stack,
                    service: container.service,
                });
            }

            return list.sort((a, b) => a.stack.localeCompare(b.stack) || a.name.localeCompare(b.name));
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
                    this.containers = res.containers || [];
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        onDragStart(event, entry) {
            if (this.network?.builtIn) {
                event.preventDefault();
                return;
            }
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
            if (!this.network || this.network.builtIn || this.busy
                || !this.availableContainers.some((item) => item.id === containerId || item.id.startsWith(containerId))) {
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

/* Two compact lists side by side: what can join, and what already did. */
.rel-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--rd-3);

    @media (max-width: 900px) {
        grid-template-columns: 1fr;
    }
}

.rel-panel {
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
}

.rel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--rd-2);
    padding: var(--rd-2) var(--rd-3);
    border-bottom: 1px solid var(--card-border);
}

.rel-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--strong);
    font-weight: 600;
}

.rel-count {
    flex: 0 0 auto;
    color: var(--dim);
    font-size: var(--rd-fs-small);
    font-variant-numeric: tabular-nums;
}

.rel-list {
    max-height: 300px;
    min-height: 60px;
    overflow-y: auto;
    padding: var(--rd-1);
}

.rel-item {
    display: flex;
    align-items: center;
    gap: var(--rd-2);
    padding: 5px var(--rd-2);
    border-radius: var(--rd-radius-sm);
    cursor: grab;
    transition: background 0.1s ease-in-out;

    &:hover {
        background: var(--panel-bg);
    }

    &.attached {
        cursor: default;
    }

    &.disabled {
        cursor: not-allowed;
    }

    &.disabled .rel-grip {
        opacity: 0.3;
    }
}

.rel-grip {
    flex: 0 0 auto;
    color: var(--dim);
    font-size: 11px;
}

.rel-main {
    flex: 1 1 auto;
    min-width: 0;
}

.rel-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--strong);
    font-size: var(--rd-fs-small);
}

.rel-sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: var(--rd-fs-small);
}

.rel-add {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--card-border);
    border-radius: var(--rd-radius-sm);
    background: transparent;
    color: var(--muted);
    font-size: 10px;
    cursor: pointer;

    &:hover:not(:disabled) {
        border-color: $primary;
        color: $primary;
    }

    &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
}

.rel-empty {
    padding: var(--rd-4) var(--rd-2);
    text-align: center;
    color: var(--dim);
    font-size: var(--rd-fs-small);
}

.rel-foot {
    padding: var(--rd-1) var(--rd-3) var(--rd-2);
    border-top: 1px solid var(--card-border);
    color: var(--dim);
    font-size: var(--rd-fs-small);
}

.rel-target {
    border-style: dashed;

    &.drag-over {
        border-color: $primary;
        background: var(--panel-bg);
    }
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

.relation-warning {
    margin: var(--rd-2) 0 0;
    color: var(--dim);
    font-size: var(--rd-fs-small);
}

.kv-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 var(--rd-5);

    @media (max-width: 900px) {
        grid-template-columns: 1fr;
    }
}

.merge-item {
    display: flex;
    align-items: center;
    gap: var(--rd-2);
    padding: var(--rd-2) var(--rd-3);
    margin-bottom: 6px;
    border: 1px solid var(--card-border);
    border-radius: var(--rd-radius-sm);
    cursor: pointer;
    font-size: var(--rd-fs-small);
}

.snippet {
    margin: var(--rd-1) 0 0;
    padding: var(--rd-3);
    border-radius: var(--rd-radius-sm);
    background: var(--mono-bg);
    border: 1px solid var(--card-border);
    font-family: "JetBrains Mono", Menlo, monospace;
    font-size: var(--rd-fs-small);
    line-height: 1.6;
    color: var(--strong);
    white-space: pre-wrap;
}

.muted {
    color: var(--muted);
}
</style>
