<template>
    <div>
        <!-- Toolbar -->
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
            <div class="search-wrapper">
                <input v-model="search" class="form-control form-control-sm search-input" :placeholder="$t('search')" autocomplete="off" />
            </div>

            <button class="btn btn-normal btn-sm" :disabled="loading" @click="loadVolumes">
                <font-awesome-icon icon="arrows-rotate" :spin="loading" class="me-1" />
                {{ $t("refresh") }}
            </button>

            <div class="ms-auto">
                <button class="btn btn-normal btn-sm" :disabled="pruning" @click="askPrune">
                    <font-awesome-icon icon="trash" class="me-1" />
                    {{ $t("pruneUnusedVolumes") }}
                </button>
            </div>
        </div>

        <!-- Summary -->
        <div class="resources-summary mb-2">
            <span>{{ $t("volumeCount", [ volumes.length ]) }}</span>
            <span class="ms-3">{{ $t("unusedCount", [ unusedCount ]) }}</span>
        </div>

        <!-- List -->
        <div class="table-responsive">
            <table class="table table-sm table-hover align-middle resources-table">
                <thead>
                    <tr>
                        <th>{{ $t("volumeName") }}</th>
                        <th>{{ $t("driver") }}</th>
                        <th>{{ $t("created") }}</th>
                        <th>{{ $t("usedBy") }}</th>
                        <th class="text-end">{{ $t("actions") }}</th>
                    </tr>
                </thead>
                <tbody>
                    <template v-for="volume in filteredVolumes" :key="volume.name">
                        <tr class="volume-row" @click="toggle(volume.name)">
                            <td>
                                <font-awesome-icon :icon="expanded.has(volume.name) ? 'chevron-circle-down' : 'chevron-circle-right'" class="me-2 text-muted" />
                                <code>{{ volume.name }}</code>
                            </td>
                            <td>{{ volume.driver }}</td>
                            <td class="text-nowrap text-muted">{{ formatDate(volume.createdText) }}</td>
                            <td>
                                <template v-if="volume.used">
                                    <span
                                        v-for="container in volume.containers"
                                        :key="container.id"
                                        class="badge bg-primary me-1"
                                        :title="container.name"
                                    >
                                        {{ container.stack || $t("noStack") }}<template v-if="container.service"> / {{ container.service }}</template>
                                    </span>
                                </template>
                                <span v-else class="badge bg-secondary">{{ $t("unused") }}</span>
                            </td>
                            <td class="text-end" @click.stop>
                                <button
                                    class="btn btn-sm btn-outline-danger"
                                    :disabled="volume.used || pruning"
                                    :title="volume.used ? $t('volumeInUseMsg') : $t('delete')"
                                    @click="askRemove(volume)"
                                >
                                    <font-awesome-icon icon="trash" />
                                </button>
                            </td>
                        </tr>

                        <!-- Detail -->
                        <tr v-if="expanded.has(volume.name)" class="detail-row">
                            <td colspan="5">
                                <div class="detail-grid">
                                    <div class="detail-label">{{ $t("mountpoint") }}</div>
                                    <div><code>{{ volume.mountpoint || notAvailable }}</code></div>

                                    <div class="detail-label">{{ $t("scope") }}</div>
                                    <div>{{ volume.scope }}</div>

                                    <div class="detail-label">{{ $t("composeProject") }}</div>
                                    <div>
                                        <span v-if="volume.stack" class="badge bg-dark">{{ volume.stack }}</span>
                                        <span v-else class="text-muted">{{ notAvailable }}</span>
                                        <span v-if="volume.composeVolume" class="ms-2 text-muted">({{ volume.composeVolume }})</span>
                                    </div>

                                    <div class="detail-label">{{ $t("containersUsing") }}</div>
                                    <div>
                                        <span v-if="volume.containers.length === 0" class="text-muted">{{ $t("unused") }}</span>
                                        <span v-for="container in volume.containers" :key="container.id" class="me-3">
                                            <code>{{ container.name }}</code>
                                            <span class="text-muted">({{ container.state }})</span>
                                        </span>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </template>
                    <tr v-if="!loading && filteredVolumes.length === 0">
                        <td colspan="5" class="text-center text-muted py-4">{{ $t("noResources") }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Remove confirm -->
        <Confirm ref="confirmRemove" :yes-text="$t('yes')" :no-text="$t('no')" btn-style="btn-danger" @yes="doRemove">
            <p class="mb-1">{{ $t("confirmRemoveVolume") }}</p>
            <code v-if="pendingVolume">{{ pendingVolume.name }}</code>
        </Confirm>

        <!-- Prune confirm -->
        <Confirm ref="confirmPrune" :yes-text="$t('yes')" :no-text="$t('no')" btn-style="btn-danger" @yes="doPrune">
            <p class="mb-2">{{ $t("confirmPruneVolumes") }}</p>

            <div class="form-check">
                <input id="includeComposeVolumes" v-model="includeCompose" class="form-check-input" type="checkbox" />
                <label class="form-check-label" for="includeComposeVolumes">{{ $t("includeComposeResources") }}</label>
            </div>

            <p class="small text-danger mt-2 mb-2">{{ $t("pruneDataWarning") }}</p>
            <p v-if="pruneCandidates.length > 0" class="small text-muted mb-0">{{ pruneCandidates.join(", ") }}</p>
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
            volumes: [],
            loading: false,
            pruning: false,
            search: "",
            expanded: new Set(),
            includeCompose: false,
            pendingVolume: null,
        };
    },

    computed: {
        notAvailable() {
            return this.$t("notAvailableShort");
        },

        filteredVolumes() {
            const keyword = this.search.trim().toLowerCase();

            if (!keyword) {
                return this.volumes;
            }

            return this.volumes.filter((volume) =>
                volume.name.toLowerCase().includes(keyword) ||
                (volume.stack || "").toLowerCase().includes(keyword)
            );
        },

        unusedCount() {
            return this.volumes.filter((volume) => !volume.used).length;
        },

        pruneCandidates() {
            return this.volumes
                .filter((volume) => !volume.used && (this.includeCompose || !volume.stack))
                .map((volume) => volume.name);
        },
    },

    mounted() {
        this.loadVolumes();
    },

    methods: {
        loadVolumes() {
            this.loading = true;

            this.$root.emitAgent(this.endpoint, "getDockerVolumeList", (res) => {
                this.loading = false;

                if (res.ok) {
                    this.volumes = res.volumes;
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        toggle(name) {
            if (this.expanded.has(name)) {
                this.expanded.delete(name);
            } else {
                this.expanded.add(name);
            }
        },

        formatDate(value) {
            if (!value) {
                return this.notAvailable;
            }

            const date = new Date(value);

            if (Number.isNaN(date.getTime())) {
                return value;
            }

            return date.toLocaleString();
        },

        askRemove(volume) {
            this.pendingVolume = volume;
            this.$refs.confirmRemove.show();
        },

        doRemove() {
            if (!this.pendingVolume) {
                return;
            }

            const volume = this.pendingVolume;
            this.pendingVolume = null;
            this.pruning = true;

            this.$root.emitAgent(this.endpoint, "removeDockerVolume", volume.name, (res) => {
                this.pruning = false;
                this.$root.toastRes(res);
                this.loadVolumes();
            });
        },

        askPrune() {
            this.$refs.confirmPrune.show();
        },

        doPrune() {
            this.pruning = true;

            this.$root.emitAgent(this.endpoint, "pruneDockerVolumes", this.includeCompose, (res) => {
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

                this.loadVolumes();
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

    .volume-row {
        cursor: pointer;
    }

    .detail-row td {
        background: rgba(0, 0, 0, 0.02);
        padding: 14px 20px;

        .dark & {
            background: $dark-header-bg;
        }
    }
}

.detail-grid {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: 6px 12px;
    font-size: 13px;
    word-break: break-all;
}

.detail-label {
    font-weight: 600;
    opacity: 0.7;
}
</style>
