<template>
    <div :key="$route.fullPath" class="resource-detail">
        <template v-if="image">
            <div class="detail-head">
                <span class="badge badge-lg" :class="stateClass">{{ $t(stateLabel) }}</span>
                <h1 class="detail-title">
                    <span v-if="image.dangling" class="mono">&lt;none&gt;:&lt;none&gt;</span>
                    <template v-else>{{ image.repository }}<span class="tag">:{{ image.tag }}</span></template>
                </h1>
            </div>

            <div class="actions">
                <button class="btn btn-dark" :disabled="busy || image.dangling" @click="pullLatest">
                    <font-awesome-icon icon="cloud-arrow-down" /> {{ $t("pullLatest") }}
                </button>
                <button class="btn btn-dark" :disabled="busy" @click="load">
                    <font-awesome-icon icon="arrows-rotate" :spin="busy" /> {{ $t("refresh") }}
                </button>
                <button class="btn btn-danger" :disabled="image.used || busy" :title="image.used ? $t('imageInUseMsg') : $t('delete')" @click="$refs.confirm.show()">
                    <font-awesome-icon icon="trash" /> {{ $t("delete") }}
                </button>
            </div>
            <div class="note">{{ $t("imageDetailNote") }}</div>

            <div class="detail-grid">
                <div class="col">
                    <section>
                        <h2 class="section-title">{{ $t("containers") }}</h2>
                        <div class="card">
                            <div v-for="container in image.containers" :key="container.id" class="crow">
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
                            <div v-if="image.containers.length === 0" class="crow">
                                <div class="crow-sub">{{ $t("noContainerUsesImage") }}</div>
                            </div>
                        </div>
                    </section>

                    <section>
                        <h2 class="section-title">{{ $t("tags") }}</h2>
                        <div class="card" style="padding:12px">
                            <span v-for="tagName in siblingTags" :key="tagName" class="chip">{{ tagName }}</span>
                            <span v-if="siblingTags.length === 0" class="chip">&lt;none&gt;</span>
                        </div>
                    </section>
                </div>

                <div class="col">
                    <section>
                        <h2 class="section-title">{{ $t("details") }}</h2>
                        <div class="card">
                            <div class="kv-row"><div class="kv-k">{{ $t("size") }}</div><div class="kv-v">{{ formatBytes(image.size) }}</div></div>
                            <div class="kv-row"><div class="kv-k">{{ $t("imageID") }}</div><div class="kv-v mono">sha256:{{ image.shortID }}</div></div>
                            <div class="kv-row"><div class="kv-k">{{ $t("digest") }}</div><div class="kv-v mono">{{ detail.digest || "-" }}</div></div>
                            <div class="kv-row"><div class="kv-k">{{ $t("created") }}</div><div class="kv-v">{{ image.createdText || "-" }}</div></div>
                            <div class="kv-row"><div class="kv-k">{{ $t("platform") }}</div><div class="kv-v">{{ detail.platform || "-" }}</div></div>
                            <div class="kv-row"><div class="kv-k">{{ $t("entrypoint") }}</div><div class="kv-v mono">{{ detail.entrypoint || "-" }}</div></div>
                            <div class="kv-row"><div class="kv-k">{{ $t("cmd") }}</div><div class="kv-v mono">{{ detail.cmd || "-" }}</div></div>
                            <div class="kv-row">
                                <div class="kv-k">{{ $t("exposedPorts") }}</div>
                                <div class="kv-v">
                                    <span v-for="port in detail.exposed" :key="port" class="chip">{{ port }}</span>
                                    <span v-if="detail.exposed.length === 0">-</span>
                                </div>
                            </div>
                            <div class="kv-row"><div class="kv-k">{{ $t("layers") }}</div><div class="kv-v">{{ detail.layerCount }}</div></div>
                        </div>
                    </section>
                </div>
            </div>
        </template>

        <div v-else-if="!loading" class="empty-state">{{ $t("selectImageHint") }}</div>

        <Confirm ref="confirm" :yes-text="$t('yes')" :no-text="$t('no')" btn-style="btn-danger" @yes="doRemove">
            {{ $t("confirmRemoveImage") }}
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
            images: [],
            loading: false,
            busy: false,
            detail: {
                digest: "",
                platform: "",
                entrypoint: "",
                cmd: "",
                exposed: [],
                layerCount: 0,
            },
        };
    },

    computed: {
        reference() {
            return this.$route.query.name || "";
        },

        image() {
            if (!this.reference) {
                return null;
            }

            const byReference = this.images.find((item) => `${item.repository}:${item.tag}` === this.reference);
            return byReference || this.images.find((item) => item.id === this.reference);
        },

        stateLabel() {
            if (!this.image) {
                return "";
            }
            if (this.image.used) {
                return "inUse";
            }
            return this.image.dangling ? "dangling" : "unused";
        },

        stateClass() {
            if (!this.image) {
                return "";
            }
            if (this.image.used) {
                return "bg-primary";
            }
            return this.image.dangling ? "bg-warning" : "bg-secondary";
        },

        siblingTags() {
            if (!this.image) {
                return [];
            }
            return this.images
                .filter((item) => item.id === this.image.id && !item.dangling)
                .map((item) => `${item.repository}:${item.tag}`);
        },
    },

    watch: {
        reference() {
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
        formatBytes(bytes) {
            if (!bytes) {
                return "-";
            }
            const units = [ "B", "kB", "MB", "GB", "TB" ];
            let value = bytes;
            let unit = 0;
            while (value >= 1000 && unit < units.length - 1) {
                value /= 1000;
                unit += 1;
            }
            return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
        },

        load() {
            this.loading = true;

            this.$root.emitAgent(this.endpoint, "getDockerImageList", (res) => {
                this.loading = false;

                if (!res.ok) {
                    this.$root.toastRes(res);
                    return;
                }

                this.images = res.images;

                if (this.image) {
                    this.loadDetail();
                }
            });
        },

        loadDetail() {
            const target = this.image.dangling ? this.image.id : `${this.image.repository}:${this.image.tag}`;

            this.$root.emitAgent(this.endpoint, "getDockerImageDetail", target, (res) => {
                if (res.ok) {
                    this.detail = res.detail;
                }
            });
        },

        pullLatest() {
            if (!this.image || this.image.dangling) {
                return;
            }

            this.busy = true;

            this.$root.emitAgent(this.endpoint, "pullDockerImage", `${this.image.repository}:${this.image.tag}`, (res) => {
                this.busy = false;
                this.$root.toastRes(res);
                this.load();
            });
        },

        doRemove() {
            if (!this.image) {
                return;
            }

            this.busy = true;

            this.$root.emitAgent(this.endpoint, "removeDockerImage", this.image.id, (res) => {
                this.busy = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.$router.push("/resources/images");
                } else {
                    this.load();
                }
            });
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../../styles/resource-detail.scss";
</style>
