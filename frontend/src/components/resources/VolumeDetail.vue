<template>
    <div class="resource-detail">
        <template v-if="volume">
            <div class="detail-head">
                <span class="badge badge-lg" :class="volume.used ? 'bg-primary' : 'bg-warning'">
                    {{ volume.used ? $t("mounted") : $t("orphaned") }}
                </span>
                <h1 class="detail-title">{{ volume.name }}</h1>
            </div>

            <div class="actions">
                <button class="btn btn-dark" :disabled="busy" @click="openMigrate">
                    <font-awesome-icon icon="right-left" /> {{ $t("migrate") }}
                </button>
                <button class="btn btn-dark" :disabled="busy" @click="load">
                    <font-awesome-icon icon="arrows-rotate" :spin="busy" /> {{ $t("refresh") }}
                </button>
                <button class="btn btn-danger" :disabled="volume.used || busy" :title="volume.used ? $t('volumeMountedMsg') : $t('delete')" @click="$refs.confirm.show()">
                    <font-awesome-icon icon="trash" /> {{ $t("delete") }}
                </button>
            </div>
            <div class="note">{{ $t("volumeDetailNote") }}</div>

            <div class="detail-grid">
                <div class="col">
                    <section>
                        <h2 class="section-title">{{ $t("containers") }}</h2>
                        <div class="card">
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
                                    <span class="badge" :class="container.state === 'running' ? 'bg-primary' : 'bg-secondary'">{{ container.state }}</span>
                                </div>
                            </div>
                            <div v-if="volume.containers.length === 0" class="crow">
                                <div class="crow-sub">{{ $t("noContainerUsesVolume") }}</div>
                            </div>
                        </div>
                    </section>

                    <section>
                        <h2 class="section-title">{{ $t("inComposeYaml") }}</h2>
                        <div class="card" style="padding:12px">
                            <pre class="snippet">{{ composeSnippet }}</pre>
                            <button class="btn btn-dark btn-sm mt-2" type="button" @click="copy(composeSnippet)">
                                <font-awesome-icon icon="copy" /> {{ $t("copy") }}
                            </button>
                        </div>
                    </section>
                </div>

                <div class="col">
                    <section>
                        <h2 class="section-title">{{ $t("details") }}</h2>
                        <div class="card">
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
                            <div class="kv-row"><div class="kv-k">{{ $t("labels") }}</div><div class="kv-v mono">{{ labelText }}</div></div>
                        </div>
                    </section>

                    <section>
                        <h2 class="section-title">{{ $t("migration") }}</h2>
                        <div class="card" style="padding:12px">
                            <div class="muted small mb-2">{{ $t("migrationHint") }}</div>
                            <button class="btn btn-dark btn-sm" type="button" @click="openMigrate">
                                {{ $t("startMigration") }}
                            </button>
                        </div>
                    </section>
                </div>
            </div>
        </template>

        <div v-else-if="!loading" class="empty-state">{{ $t("selectVolumeHint") }}</div>

        <!-- Migration -->
        <BModal v-model="showMigrate" :title="$t('migrateVolumeTitle')" :ok-title="$t('startMigration')" :ok-disabled="migrating" @ok="doMigrate">
            <p class="small text-muted">{{ $t("migrateVolumeHint") }}</p>

            <label class="form-label">{{ $t("targetVolume") }}</label>
            <input v-model="migrateForm.target" class="form-control mb-2" autocomplete="off" />
            <div class="form-check mb-2">
                <input id="keep-source" v-model="migrateForm.keepSource" class="form-check-input" type="checkbox" />
                <label class="form-check-label" for="keep-source">{{ $t("keepSource") }}</label>
            </div>

            <div v-if="volume && volume.used" class="notice">
                <font-awesome-icon icon="circle-info" class="me-2" />
                {{ $t("volumeInUseMigration") }}
            </div>
        </BModal>

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
            busy: false,
            migrating: false,
            showMigrate: false,
            migrateForm: {
                target: "",
                keepSource: true,
            },
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
        load() {
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

        openMigrate() {
            if (!this.volume) {
                return;
            }
            this.migrateForm.target = `${this.volume.name}_v2`;
            this.showMigrate = true;
        },

        doMigrate() {
            if (!this.volume) {
                return;
            }

            this.migrating = true;

            this.$root.emitAgent(this.endpoint, "migrateDockerVolume", {
                source: this.volume.name,
                target: this.migrateForm.target,
                keepSource: this.migrateForm.keepSource,
                driver: this.volume.driver,
            }, (res) => {
                this.migrating = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.showMigrate = false;
                    this.load();
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
    font-size: 12px;
    line-height: 1.6;
    color: var(--strong);
    white-space: pre-wrap;
}

.notice {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid rgba(248, 163, 6, 0.4);
    background: rgba(248, 163, 6, 0.08);
    color: #f8a306;
    font-size: 12.5px;
}

.muted {
    color: var(--muted);
}
</style>
