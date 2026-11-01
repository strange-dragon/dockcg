<template>
    <div class="resource-detail">
        <template v-if="volume">
            <div class="detail-head">
                <span class="badge" :class="volume.used ? 'bg-primary' : volume.stack ? 'bg-secondary' : 'bg-warning'">
                    {{ volume.used ? $t("mounted") : volume.stack ? $t("composeOwned") : $t("orphaned") }}
                </span>
                <h1 class="detail-title">{{ volume.name }}</h1>
            </div>

            <div class="actions">
                <button class="btn btn-normal" :disabled="busy" @click="load">
                    <font-awesome-icon icon="arrows-rotate" :spin="busy" /> {{ $t("refresh") }}
                </button>
                <button class="btn btn-danger" :disabled="volume.used || volume.stack || busy" :title="volume.stack ? $t('composeVolumeProtected') : volume.used ? $t('volumeMountedMsg') : $t('delete')" @click="$refs.confirm.show()">
                    <font-awesome-icon icon="trash" /> {{ $t("delete") }}
                </button>
            </div>
            <div class="note">{{ $t("volumeDetailNote") }}</div>

            <div class="detail-grid">
                <div class="col">
                    <section>
                        <h2 class="section-title h5">{{ $t("containers") }}</h2>
                        <div class="shadow-box">
                            <div v-for="container in volume.containers" :key="container.id" class="crow">
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
                            <div v-if="volume.containers.length === 0" class="crow">
                                <div class="crow-sub">{{ $t("noContainerUsesVolume") }}</div>
                            </div>
                        </div>
                    </section>

                    <section>
                        <h2 class="section-title h5">{{ $t("inComposeYaml") }}</h2>
                        <div class="shadow-box">
                            <pre class="snippet">{{ composeSnippet }}</pre>
                            <button class="btn btn-normal btn-sm mt-2" type="button" @click="copy(composeSnippet)">
                                <font-awesome-icon icon="copy" /> {{ $t("copy") }}
                            </button>
                        </div>
                    </section>
                </div>

                <div class="col">
                    <section>
                        <h2 class="section-title h5">{{ $t("details") }}</h2>
                        <div class="shadow-box">
                            <div class="kv-row"><div class="kv-k">{{ $t("name") }}</div><div class="kv-v mono">{{ volume.name }}</div></div>
                            <div class="kv-row"><div class="kv-k">{{ $t("driver") }}</div><div class="kv-v">{{ volume.driver }}</div></div>
                            <div class="kv-row"><div class="kv-k">{{ $t("mountpoint") }}</div><div class="kv-v mono">{{ volume.mountpoint || "-" }}</div></div>
                            <div class="kv-row"><div class="kv-k">{{ $t("scope") }}</div><div class="kv-v">{{ volume.scope }}</div></div>
                            <div class="kv-row">
                                <div class="kv-k">{{ $t("composeProject") }}</div>
                                <div class="kv-v">
                                    <template v-if="volume.stack">
                                        {{ volume.stack }} <span v-if="volume.composeVolume" class="muted">/ {{ $t("volume") }}: {{ volume.composeVolume }}</span>
                                    </template>
                                    <template v-else>-</template>
                                </div>
                            </div>
                            <div class="kv-row"><div class="kv-k">{{ $t("created") }}</div><div class="kv-v">{{ volume.createdText || "-" }}</div></div>
                            <div class="kv-row">
                                <div class="kv-k">{{ $t("diskUsage") }}</div>
                                <div class="kv-v">
                                    {{ usageText || $t("notCalculated") }}
                                    <button class="btn btn-link btn-sm" :disabled="usageLoading" @click="loadUsage">{{ $t("calculate") }}</button>
                                </div>
                            </div>
                            <div class="kv-row"><div class="kv-k">{{ $t("labels") }}</div><div class="kv-v mono">{{ labelText }}</div></div>
                        </div>
                    </section>
                </div>
            </div>
        </template>

        <div v-else-if="!loading" class="empty-state">{{ $t("selectVolumeHint") }}</div>

        <Confirm ref="confirm" :yes-text="$t('yes')" :no-text="$t('no')" btn-style="btn-danger" @yes="doRemove">
            {{ $t("confirmRemoveVolume") }}
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
            requestId: 0,
            busy: false,
            usageLoading: false,
            usageText: "",
        };
    },

    computed: {
        name() {
            return this.$route.query.name || "";
        },

        volume() {
            if (!this.name) {
                return null;
            }
            return this.volumes.find((item) => item.name === this.name) || null;
        },

        labelText() {
            if (!this.volume || !this.volume.labels) {
                return "-";
            }
            const entries = Object.entries(this.volume.labels);
            if (entries.length === 0) {
                return "-";
            }
            return entries.map(([ key, value ]) => `${key}=${value}`).join("\n");
        },

        composeSnippet() {
            if (!this.volume) {
                return "";
            }

            const volumeKey = this.volume.composeVolume || this.volume.name;

            if (this.volume.stack && this.volume.composeVolume) {
                return `# ${this.volume.stack}/compose.yaml\nservices:\n  <service>:\n    volumes:\n      - ${volumeKey}:/data\n\nvolumes:\n  ${volumeKey}:\n    name: ${this.volume.name}`;
            }

            return `# any stack can join it with external\nservices:\n  <service>:\n    volumes:\n      - ${volumeKey}:/data\n\nvolumes:\n  ${volumeKey}:\n    external: true\n    name: ${this.volume.name}`;
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
        loadUsage() {
            if (!this.volume) {
                return;
            }
            this.usageLoading = true;
            this.$root.emitAgent(this.endpoint, "getDockerVolumeUsage", this.volume.name, (res) => {
                this.usageLoading = false;
                if (res?.ok) {
                    this.usageText = res.sizeText;
                } else {
                    this.$root.toastRes(res);
                }
            });
        },
        load() {
            const requestId = ++this.requestId;
            this.loading = true;
            this.volumes = [];

            this.$root.emitAgent(this.endpoint, "getDockerVolumeList", (res) => {
                if (requestId !== this.requestId) {
                    return;
                }
                this.loading = false;

                if (res.ok) {
                    this.volumes = res.volumes;
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        doRemove() {
            if (!this.volume) {
                return;
            }

            this.busy = true;

            this.$root.emitAgent(this.endpoint, "removeDockerVolume", this.volume.name, (res) => {
                this.busy = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.$router.push("/resources/volumes");
                } else {
                    this.load();
                }
            });
        },

        copy(text) {
            navigator.clipboard?.writeText(text);
            this.$root.toastSuccess?.(this.$t("copied"));
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../../styles/resource-detail.scss";

.snippet {
    margin: 0;
    font-family: "JetBrains Mono", Menlo, monospace;
    font-size: var(--rd-fs-small);
    line-height: 1.6;
    color: var(--strong);
    white-space: pre-wrap;
}

.notice {
    display: flex;
    align-items: center;
    padding: var(--rd-2) var(--rd-3);
    border-radius: var(--rd-radius-sm);
    border: 1px solid rgba(248, 163, 6, 0.4);
    background: rgba(248, 163, 6, 0.08);
    color: $warning;
    font-size: var(--rd-fs-small);
}

.muted {
    color: var(--muted);
}
</style>
