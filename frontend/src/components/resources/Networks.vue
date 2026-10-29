<template>
    <div>
        <!-- Toolbar -->
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
            <div class="search-wrapper">
                <input v-model="search" class="form-control form-control-sm search-input" :placeholder="$t('search')" autocomplete="off" />
            </div>

            <button class="btn btn-normal btn-sm" :disabled="loading" @click="loadNetworks">
                <font-awesome-icon icon="arrows-rotate" :spin="loading" class="me-1" />
                {{ $t("refresh") }}
            </button>

            <div class="ms-auto">
                <button class="btn btn-normal btn-sm" :disabled="pruning" @click="askPrune">
                    <font-awesome-icon icon="trash" class="me-1" />
                    {{ $t("pruneUnusedNetworks") }}
                </button>
            </div>
        </div>

        <!-- Summary -->
        <div class="resources-summary mb-2">
            <span>{{ $t("networkCount", [ networks.length ]) }}</span>
            <span class="ms-3">{{ $t("unusedCount", [ unusedCount ]) }}</span>
        </div>

        <!-- List -->
        <div class="table-responsive">
            <table class="table table-sm table-hover align-middle resources-table">
                <thead>
                    <tr>
                        <th>{{ $t("networkName") }}</th>
                        <th>{{ $t("driver") }}</th>
                        <th>{{ $t("subnet") }}</th>
                        <th>{{ $t("stack") }}</th>
                        <th>{{ $t("status") }}</th>
                        <th class="text-end">{{ $t("actions") }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="network in filteredNetworks" :key="network.id">
                        <td>
                            <code>{{ network.name }}</code>
                            <span v-if="network.internal" class="badge bg-dark ms-2">{{ $t("internal") }}</span>
                        </td>
                        <td>{{ network.driver }} <span class="text-muted">/ {{ network.scope }}</span></td>
                        <td class="text-nowrap"><code class="text-muted">{{ network.subnet || notAvailable }}</code></td>
                        <td>
                            <span v-if="network.stack" class="badge bg-dark">{{ network.stack }}</span>
                            <span v-else-if="network.builtIn" class="text-muted">{{ $t("builtInNetwork") }}</span>
                            <span v-else class="text-muted">{{ $t("noStack") }}</span>
                        </td>
                        <td>
                            <span v-if="network.used" class="badge bg-primary" :title="network.containers.map(c => c.name).join(', ')">
                                {{ $t("containerCount", [ network.containers.length ]) }}
                            </span>
                            <span v-else class="badge bg-secondary">{{ $t("unused") }}</span>
                        </td>
                        <td class="text-end text-nowrap">
                            <button class="btn btn-sm btn-normal me-1" :title="$t('networkHelper')" @click="openHelper(network)">
                                <font-awesome-icon icon="link" />
                            </button>
                            <button
                                class="btn btn-sm btn-outline-danger"
                                :disabled="network.builtIn || network.used || pruning"
                                :title="network.builtIn ? $t('builtInNetwork') : (network.used ? $t('networkInUseMsg') : $t('delete'))"
                                @click="askRemove(network)"
                            >
                                <font-awesome-icon icon="trash" />
                            </button>
                        </td>
                    </tr>
                    <tr v-if="!loading && filteredNetworks.length === 0">
                        <td colspan="6" class="text-center text-muted py-4">{{ $t("noResources") }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Cross stack helper -->
        <BModal v-model="showHelper" :title="$t('networkHelper')" size="lg" hide-footer>
            <template v-if="selectedNetwork">
                <p class="small text-muted">{{ $t("networkHelperIntro") }}</p>

                <h6 class="mt-3">{{ $t("networkHelperOwner") }}</h6>
                <div class="snippet">
                    <pre>{{ ownerSnippet }}</pre>
                    <button class="btn btn-sm btn-normal snippet-copy" @click="copy(ownerSnippet)">
                        <font-awesome-icon icon="copy" />
                    </button>
                </div>

                <h6 class="mt-3">{{ $t("networkHelperConsumer") }}</h6>
                <div class="snippet">
                    <pre>{{ consumerSnippet }}</pre>
                    <button class="btn btn-sm btn-normal snippet-copy" @click="copy(consumerSnippet)">
                        <font-awesome-icon icon="copy" />
                    </button>
                </div>

                <p class="small text-muted mt-3 mb-0">
                    <font-awesome-icon icon="info-circle" class="me-1" />
                    {{ $t("networkHelperFooter") }}
                </p>
            </template>
        </BModal>

        <!-- Remove confirm -->
        <Confirm ref="confirmRemove" :yes-text="$t('yes')" :no-text="$t('no')" btn-style="btn-danger" @yes="doRemove">
            <p class="mb-1">{{ $t("confirmRemoveNetwork") }}</p>
            <code v-if="pendingNetwork">{{ pendingNetwork.name }}</code>
        </Confirm>

        <!-- Prune confirm -->
        <Confirm ref="confirmPrune" :yes-text="$t('yes')" :no-text="$t('no')" btn-style="btn-danger" @yes="doPrune">
            <p class="mb-2">{{ $t("confirmPruneNetworks") }}</p>

            <div class="form-check">
                <input id="includeComposeNetworks" v-model="includeCompose" class="form-check-input" type="checkbox" />
                <label class="form-check-label" for="includeComposeNetworks">{{ $t("includeComposeResources") }}</label>
            </div>

            <p v-if="pruneCandidates.length > 0" class="small text-muted mt-2 mb-0">{{ pruneCandidates.join(", ") }}</p>
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
            pruning: false,
            search: "",
            includeCompose: false,
            pendingNetwork: null,
            selectedNetwork: null,
            showHelper: false,
        };
    },

    computed: {
        notAvailable() {
            return this.$t("notAvailableShort");
        },

        filteredNetworks() {
            const keyword = this.search.trim().toLowerCase();

            if (!keyword) {
                return this.networks;
            }

            return this.networks.filter((network) =>
                network.name.toLowerCase().includes(keyword) ||
                (network.stack || "").toLowerCase().includes(keyword) ||
                (network.subnet || "").toLowerCase().includes(keyword)
            );
        },

        unusedCount() {
            return this.networks.filter((network) => !network.builtIn && !network.used).length;
        },

        pruneCandidates() {
            return this.networks
                .filter((network) => !network.builtIn && !network.used && network.scope === "local" && (this.includeCompose || !network.stack))
                .map((network) => network.name);
        },

        /**
         * Compose key of the network inside the owning stack (defaults to the docker name)
         */
        networkKey() {
            return this.selectedNetwork?.composeNetwork || this.selectedNetwork?.name || "";
        },

        ownerSnippet() {
            if (!this.selectedNetwork) {
                return "";
            }

            const key = this.networkKey;
            const lines = [ "networks:", `  ${key}:` ];

            if (this.selectedNetwork.stack && this.selectedNetwork.name !== `${this.selectedNetwork.stack}_${key}`) {
                lines.push(`    name: ${this.selectedNetwork.name}`);
            }

            lines.push("");
            lines.push("services:");
            lines.push("  your-service:");
            lines.push("    networks:");
            lines.push(`      - ${key}`);

            return lines.join("\n");
        },

        consumerSnippet() {
            if (!this.selectedNetwork) {
                return "";
            }

            const key = this.networkKey;
            const lines = [ "networks:", `  ${key}:`, "    external: true", `    name: ${this.selectedNetwork.name}` ];
            lines.push("");
            lines.push("services:");
            lines.push("  your-service:");
            lines.push("    networks:");
            lines.push(`      - ${key}`);

            return lines.join("\n");
        },
    },

    mounted() {
        this.loadNetworks();
    },

    methods: {
        loadNetworks() {
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

        openHelper(network) {
            this.selectedNetwork = network;
            this.showHelper = true;
        },

        async copy(text) {
            try {
                await navigator.clipboard.writeText(text);
                this.$root.toastRes({ ok: true,
                    msg: this.$t("copied") });
            } catch (e) {
                this.$root.toastRes({ ok: false,
                    msg: String(e) });
            }
        },

        askRemove(network) {
            this.pendingNetwork = network;
            this.$refs.confirmRemove.show();
        },

        doRemove() {
            if (!this.pendingNetwork) {
                return;
            }

            const network = this.pendingNetwork;
            this.pendingNetwork = null;
            this.pruning = true;

            this.$root.emitAgent(this.endpoint, "removeDockerNetwork", network.id, (res) => {
                this.pruning = false;
                this.$root.toastRes(res);
                this.loadNetworks();
            });
        },

        askPrune() {
            this.$refs.confirmPrune.show();
        },

        doPrune() {
            this.pruning = true;

            this.$root.emitAgent(this.endpoint, "pruneDockerNetworks", this.includeCompose, (res) => {
                this.pruning = false;

                if (!res.ok) {
                    this.$root.toastRes(res);
                } else if (res.removed.length === 0) {
                    this.$root.toastRes({ ok: true,
                        msg: this.$t("nothingToPrune") });
                } else {
                    this.$root.toastRes({
                        ok: true,
                        msg: this.$t("pruneResult", [ res.removed.length, res.reclaimedText ]),
                    });
                }

                this.loadNetworks();
            });
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../../styles/vars.scss";

.search-wrapper {
    .search-input {
        min-width: 220px;
    }
}

.resources-summary {
    font-size: 13px;
    opacity: 0.75;
}

.resources-table {
    font-size: 14px;

    th {
        font-weight: 600;
        white-space: nowrap;
    }
}

.snippet {
    position: relative;

    pre {
        background: rgba(0, 0, 0, 0.05);
        border-radius: 8px;
        padding: 12px 44px 12px 14px;
        margin: 0;
        font-size: 13px;
        font-family: "JetBrains Mono", monospace;

        .dark & {
            background: $dark-header-bg;
        }
    }

    .snippet-copy {
        position: absolute;
        top: 6px;
        right: 6px;
    }
}
</style>
