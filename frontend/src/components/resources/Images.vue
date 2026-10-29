<template>
    <div>
        <!-- Toolbar -->
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
            <div class="search-wrapper">
                <input v-model="search" class="form-control form-control-sm search-input" :placeholder="$t('search')" autocomplete="off" />
            </div>

            <button class="btn btn-normal btn-sm" :disabled="loading" @click="loadImages">
                <font-awesome-icon icon="arrows-rotate" :spin="loading" class="me-1" />
                {{ $t("refresh") }}
            </button>

            <div class="ms-auto d-flex flex-wrap gap-2">
                <button class="btn btn-normal btn-sm" :disabled="pruning" @click="askPrune('dangling')">
                    <font-awesome-icon icon="trash" class="me-1" />
                    {{ $t("pruneDanglingImages") }}
                </button>
                <button class="btn btn-normal btn-sm" :disabled="pruning" @click="askPrune('unused')">
                    <font-awesome-icon icon="trash" class="me-1" />
                    {{ $t("pruneUnusedImages") }}
                </button>
            </div>
        </div>

        <!-- Pre-pull -->
        <form class="input-group input-group-sm mb-3 pull-form" @submit.prevent="pullImage">
            <span class="input-group-text"><font-awesome-icon icon="cloud-arrow-down" /></span>
            <input
                v-model="pullReference"
                class="form-control"
                :placeholder="$t('imageReferencePlaceholder')"
                autocomplete="off"
                spellcheck="false"
            />
            <button class="btn btn-primary" type="submit" :disabled="pulling || !pullReference.trim()">
                <font-awesome-icon v-if="pulling" icon="spinner" spin class="me-1" />
                {{ $t("pull") }}
            </button>
        </form>

        <!-- Pull progress -->
        <Terminal v-if="showPullTerminal" :name="pullTerminalName" :endpoint="endpoint" :rows="8" class="mb-3 pull-terminal" />

        <!-- Summary -->
        <div class="resources-summary mb-2">
            <span>{{ $t("imageCount", [ images.length ]) }}</span>
            <span class="ms-3">{{ $t("unusedCount", [ unusedCount ]) }}</span>
            <span class="ms-3">{{ $t("totalSize") }}: {{ totalSizeText }}</span>
        </div>

        <!-- List -->
        <div class="table-responsive">
            <table class="table table-sm table-hover align-middle resources-table">
                <thead>
                    <tr>
                        <th>{{ $t("dockerImage") }}</th>
                        <th>ID</th>
                        <th>{{ $t("size") }}</th>
                        <th>{{ $t("created") }}</th>
                        <th>{{ $t("status") }}</th>
                        <th class="text-end">{{ $t("actions") }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="image in filteredImages" :key="image.id + '-' + image.tag">
                        <td class="image-name">
                            <template v-if="image.dangling">
                                <code class="text-muted">&lt;none&gt;:&lt;none&gt;</code>
                            </template>
                            <template v-else>
                                <code>{{ image.repository }}:{{ image.tag }}</code>
                            </template>
                        </td>
                        <td><code class="text-muted">{{ image.shortID }}</code></td>
                        <td class="text-nowrap">{{ image.sizeText || notAvailable }}</td>
                        <td class="text-nowrap text-muted">{{ image.createdText || notAvailable }}</td>
                        <td>
                            <span v-if="image.used" class="badge bg-primary me-1" :title="image.containers.map(c => c.name).join(', ')">
                                {{ $t("inUse") }}
                            </span>
                            <span v-else-if="image.dangling" class="badge bg-warning">{{ $t("dangling") }}</span>
                            <span v-else class="badge bg-secondary">{{ $t("unused") }}</span>

                            <span v-if="image.stacks.length > 0" class="stack-hint ms-2">
                                {{ image.stacks.join(", ") }}
                            </span>
                        </td>
                        <td class="text-end">
                            <button
                                class="btn btn-sm btn-outline-danger"
                                :disabled="image.used || pruning"
                                :title="image.used ? $t('imageInUseMsg') : $t('delete')"
                                @click="askRemove(image)"
                            >
                                <font-awesome-icon icon="trash" />
                            </button>
                        </td>
                    </tr>
                    <tr v-if="!loading && filteredImages.length === 0">
                        <td colspan="6" class="text-center text-muted py-4">{{ $t("noResources") }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Remove confirm -->
        <Confirm ref="confirmRemove" :yes-text="$t('yes')" :no-text="$t('no')" btn-style="btn-danger" @yes="doRemove">
            {{ $t("confirmRemoveImage") }}
        </Confirm>

        <!-- Prune confirm -->
        <Confirm ref="confirmPrune" :yes-text="$t('yes')" :no-text="$t('no')" btn-style="btn-danger" @yes="doPrune">
            <p class="mb-2">{{ pruneConfirmText }}</p>
            <p v-if="pruneCandidates.length > 0" class="mb-0 small text-muted">
                {{ pruneCandidates.join(", ") }}
            </p>
        </Confirm>
    </div>
</template>

<script>
import Confirm from "../Confirm.vue";
import Terminal from "../Terminal.vue";
import { getImagePullTerminalName } from "../../../../common/util-common";

export default {
    components: {
        Confirm,
        Terminal,
    },

    props: {
        endpoint: {
            type: String,
            default: "",
        },
    },

    data() {
        return {
            images: [],
            loading: false,
            pruning: false,
            search: "",
            pullReference: "",
            pulling: false,
            showPullTerminal: false,
            pendingImage: null,
            pendingMode: null,
        };
    },

    computed: {
        notAvailable() {
            return this.$t("notAvailableShort");
        },

        pullTerminalName() {
            return getImagePullTerminalName(this.endpoint);
        },

        filteredImages() {
            const keyword = this.search.trim().toLowerCase();

            if (!keyword) {
                return this.images;
            }

            return this.images.filter((image) =>
                image.repository.toLowerCase().includes(keyword) ||
                image.tag.toLowerCase().includes(keyword) ||
                image.shortID.toLowerCase().includes(keyword)
            );
        },

        unusedCount() {
            return this.images.filter((image) => !image.used).length;
        },

        totalSizeText() {
            const total = this.images.reduce((sum, image) => sum + (image.size || 0), 0);
            return this.formatBytes(total);
        },

        pruneCandidates() {
            if (this.pendingMode === "dangling") {
                return this.images.filter((image) => !image.used && image.dangling).map((image) => image.shortID);
            }
            if (this.pendingMode === "unused") {
                return this.images.filter((image) => !image.used && !image.dangling).map((image) => `${image.repository}:${image.tag}`);
            }
            return [];
        },

        pruneConfirmText() {
            if (this.pendingMode === "dangling") {
                return this.$t("confirmPruneDanglingImages");
            }
            return this.$t("confirmPruneUnusedImages");
        },
    },

    mounted() {
        this.loadImages();
    },

    methods: {
        loadImages() {
            this.loading = true;

            this.$root.emitAgent(this.endpoint, "getDockerImageList", (res) => {
                this.loading = false;

                if (res.ok) {
                    this.images = res.images;
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        pullImage() {
            const reference = this.pullReference.trim();

            if (!reference) {
                return;
            }

            this.pulling = true;
            this.showPullTerminal = true;

            this.$root.emitAgent(this.endpoint, "pullDockerImage", reference, (res) => {
                this.pulling = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.pullReference = "";
                }

                this.loadImages();
            });
        },

        askRemove(image) {
            this.pendingImage = image;
            this.$refs.confirmRemove.show();
        },

        doRemove() {
            if (!this.pendingImage) {
                return;
            }

            const image = this.pendingImage;
            this.pendingImage = null;
            this.pruning = true;

            this.$root.emitAgent(this.endpoint, "removeDockerImage", image.id, (res) => {
                this.pruning = false;
                this.$root.toastRes(res);
                this.loadImages();
            });
        },

        askPrune(mode) {
            this.pendingMode = mode;
            this.$refs.confirmPrune.show();
        },

        doPrune() {
            const mode = this.pendingMode;

            if (!mode) {
                return;
            }

            this.pruning = true;

            this.$root.emitAgent(this.endpoint, "pruneDockerImages", mode, (res) => {
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

                this.loadImages();
            });
        },

        formatBytes(bytes) {
            if (!bytes || bytes <= 0) {
                return "0 B";
            }

            const units = [ "B", "kB", "MB", "GB", "TB" ];
            let value = bytes;
            let index = 0;

            while (value >= 1000 && index < units.length - 1) {
                value /= 1000;
                index++;
            }

            return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
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

.pull-form {
    max-width: 620px;

    input {
        font-family: "JetBrains Mono", monospace;
    }
}

.pull-terminal {
    max-width: 100%;
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

    .image-name code {
        font-size: 13px;
    }
}

.stack-hint {
    font-size: 12px;
    opacity: 0.7;
}
</style>
