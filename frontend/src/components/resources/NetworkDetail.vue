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
                <button class="btn btn-danger" :disabled="network.used || network.builtIn || busy" :title="deleteTitle" @click="$refs.confirm.show()">
                    <font-awesome-icon icon="trash" /> {{ $t("delete") }}
                </button>
            </div>
            <div class="note">{{ $t("networkDetailNote") }}</div>

            <section>
                <h2 class="section-title">{{ $t("topology") }}</h2>
                <div class="card topology-card">
                    <svg viewBox="0 0 880 268" role="img" :aria-label="$t('topology')">
                        <!-- host -->
                        <rect x="372" y="10" width="136" height="42" rx="10" class="node" />
                        <text x="440" y="28" text-anchor="middle" class="node-title">docker host</text>
                        <text x="440" y="43" text-anchor="middle" class="node-sub">unix:///var/run</text>

                        <!-- host -> other networks -->
                        <path
                            v-for="other in topology.others" :key="`l-${other.name}`"
                            :d="`M440 52 C440 82 ${other.x + (other.w / 2)} 74 ${other.x + (other.w / 2)} 102`"
                            fill="none" stroke="#2f3b49" stroke-width="1.3" stroke-dasharray="4 4"
                        />
                        <path d="M440 52 L440 98" fill="none" stroke="#74c2ff" stroke-width="1.8" />

                        <!-- other networks -->
                        <g v-for="other in topology.others" :key="`n-${other.name}`" opacity=".62">
                            <rect :x="other.x" y="102" :width="other.w" height="44" rx="9" class="node-dim" />
                            <text :x="other.x + (other.w / 2)" y="121" text-anchor="middle" class="node-title">{{ other.label }}</text>
                            <text :x="other.x + (other.w / 2)" y="136" text-anchor="middle" class="node-sub">{{ other.subnet || $t("unused") }}</text>
                        </g>

                        <!-- current network -->
                        <rect x="356" y="98" width="168" height="52" rx="10" fill="rgba(116,194,255,.10)" stroke="#74c2ff" stroke-width="1.6" />
                        <text x="440" y="118" text-anchor="middle" fill="#8fc9ff" font-size="12.5" font-weight="600">{{ network.name }}</text>
                        <text x="440" y="133" text-anchor="middle" fill="#6f93ad" font-size="9.5" class="mono">{{ network.driver }} · {{ network.subnet || "-" }}</text>
                        <rect x="424" y="86" width="52" height="16" rx="50" fill="#74c2ff" />
                        <text x="450" y="97.5" text-anchor="middle" fill="#020b05" font-size="9.5" font-weight="700">{{ $t("current") }}</text>

                        <!-- containers -->
                        <path
                            v-for="container in topology.containers" :key="`cl-${container.name}`"
                            :d="`M440 150 C440 178 ${container.center} 172 ${container.center} 196`"
                            fill="none" stroke="#74c2ff" stroke-width="1.6" opacity=".8"
                        />
                        <g v-for="container in topology.containers" :key="`c-${container.name}`">
                            <rect :x="container.x" y="196" :width="container.w" height="52" rx="9" class="node" />
                            <text :x="container.center" y="216" text-anchor="middle" class="node-title">{{ container.name }}</text>
                            <text :x="container.center" y="231" text-anchor="middle" class="node-sub">{{ container.stack || container.service || "-" }}</text>
                        </g>
                    </svg>

                    <div class="topology-legend">
                        <span><i class="line current"></i>{{ $t("currentNetwork") }}</span>
                        <span><i class="line host"></i>{{ $t("hostToOtherNetworks") }}</span>
                        <span><i class="line none"></i>{{ $t("noContainersAttached") }}</span>
                    </div>
                </div>
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
                                    <span class="badge" :class="container.state === 'running' ? 'bg-primary' : 'bg-secondary'">{{ container.state }}</span>
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
            busy: false,
            merging: false,
            showMerge: false,
            showSnippet: false,
            mergeSelection: [],
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
            return this.network.used ? this.$t("networkAttachedMsg") : this.$t("delete");
        },

        mergeCandidates() {
            if (!this.network) {
                return [];
            }
            return this.networks.filter((item) => item.name !== this.network.name && !item.builtIn && item.used);
        },

        topology() {
            const others = this.networks
                .filter((item) => this.network && item.name !== this.network.name)
                .slice(0, 4);

            const slots = [
                { x: 34,
                    w: 108 },
                { x: 180,
                    w: 112 },
                { x: 596,
                    w: 144 },
                { x: 736,
                    w: 112 },
            ];

            const otherNodes = others.map((item, index) => ({
                name: item.name,
                label: item.name.length > 18 ? `${item.name.substring(0, 17)}…` : item.name,
                subnet: item.subnet,
                x: slots[index].x,
                w: slots[index].w,
            }));

            const containers = (this.network ? this.network.containers : []).slice(0, 3);
            const widths = [ 150, 160, 150 ];
            const starts = [ 298, 458, 634 ];

            const containerNodes = containers.map((container, index) => ({
                name: container.name.length > 20 ? `${container.name.substring(0, 19)}…` : container.name,
                stack: container.stack,
                service: container.service,
                x: starts[index],
                w: widths[index],
                center: starts[index] + (widths[index] / 2),
            }));

            return {
                others: otherNodes,
                containers: containerNodes,
            };
        },

        providerSnippet() {
            const name = this.network ? this.network.name : "network";
            const driver = this.network ? this.network.driver : "bridge";
            return `networks:\n  ${name}:\n    driver: ${driver}\n    name: ${name}`;
        },

        consumerSnippet() {
            const name = this.network ? this.network.name : "network";
            return `networks:\n  ${name}:\n    external: true`;
        },
    },

    watch: {
        name() {
            this.load();
        },
        endpoint() {
            this.load();
        },
    },

    mounted() {
        this.load();
    },

    methods: {
        load() {
            this.loading = true;

            this.$root.emitAgent(this.endpoint, "getDockerNetworkResourceList", (res) => {
                this.loading = false;

                if (res.ok) {
                    this.networks = res.networks;
                } else {
                    this.$root.toastRes(res);
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
                    this.mergeSelection = [];
                    this.showSnippet = true;
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

.topology-card {
    padding: 14px 10px 6px;

    svg {
        width: 100%;
        height: auto;
        display: block;
    }
}

.node {
    fill: #161b22;
    stroke: #2a3441;
}

.node-dim {
    fill: #0d1117;
    stroke: #24303d;
}

.node-title {
    fill: #dbe3eb;
    font-size: 11.5px;
}

.node-sub {
    fill: #5f6b76;
    font-size: 9.5px;
    font-family: "JetBrains Mono", Menlo, monospace;
}

.topology-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-top: 8px;
    font-size: 11.5px;
    color: var(--muted);

    .line {
        display: inline-block;
        width: 18px;
        height: 0;
        margin-right: 6px;
        vertical-align: middle;
        border-top: 2px solid #2f3b49;

        &.current {
            border-color: #74c2ff;
        }

        &.host {
            border-top-style: dashed;
        }

        &.none {
            border-top-style: dashed;
            opacity: 0.5;
        }
    }
}

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
