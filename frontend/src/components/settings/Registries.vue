<template>
    <div>
        <!-- Toolbar -->
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
            <select v-if="hasMultipleEndpoints" v-model="selectedEndpoint" class="form-select registry-endpoint" :aria-label="$t('dockerHost')">
                <option v-for="(agent, agentEndpoint) in $root.agentList" :key="agentEndpoint" :value="agentEndpoint">
                    {{ agent.name || agent.url || $t("currentEndpoint") }}
                </option>
            </select>
            <button class="btn btn-normal btn-sm" :disabled="loading" @click="loadRegistries">
                <font-awesome-icon icon="arrows-rotate" :spin="loading" class="me-1" />
                {{ $t("refresh") }}
            </button>

            <button class="btn btn-normal btn-sm" :disabled="syncingAll || registries.length === 0" @click="reloginAll">
                <font-awesome-icon icon="rotate" :spin="syncingAll" class="me-1" />
                {{ $t("reloginAll") }}
            </button>

            <div class="ms-auto">
                <button v-if="!showForm" class="btn btn-primary btn-sm" @click="showForm = true">
                    <font-awesome-icon icon="plus" class="me-1" />
                    {{ $t("addRegistry") }}
                </button>
            </div>
        </div>

        <p class="registries-hint">{{ $t("registriesHint") }}</p>

        <section class="shadow-box configured-sources mb-4">
            <h2>{{ $t("configuredDockerSources") }}</h2>
            <p class="registries-hint">{{ $t("configuredDockerSourcesHint") }}</p>
            <p class="registries-hint">{{ $t("configuredSourceUnverified") }}</p>
            <div v-if="loading" class="text-muted" role="status">{{ $t("loadingResources") }}</div>
            <div v-else-if="loadError" class="text-danger">{{ loadError }}</div>
            <template v-else>
                <div class="source-group">
                    <strong>{{ $t("dockerLoginSources") }}</strong>
                    <span v-if="sources.loginRegistries.length === 0" class="text-muted">{{ $t("noDockerLoginSources") }}</span>
                    <code v-for="name in sources.loginRegistries" :key="name" class="source-chip">{{ name }}</code>
                </div>
                <div class="source-group">
                    <strong>{{ $t("dockerRegistryMirrors") }}</strong>
                    <span v-if="sources.mirrors.length === 0" class="text-muted">{{ $t("noDockerRegistryMirrors") }}</span>
                    <code v-for="mirror in sources.mirrors" :key="mirror" class="source-chip">{{ mirror }}</code>
                </div>
                <p v-if="sources.configError" class="text-warning small mb-0">{{ $t("dockerConfigReadFailed") }}</p>
                <p v-if="sources.daemonError" class="text-warning small mb-0">{{ $t("dockerMirrorReadFailed") }} {{ sources.daemonError }}</p>
            </template>
        </section>

        <!-- Add / edit form -->
        <div v-if="showForm" class="shadow-box add-form mb-3">
            <form @submit.prevent="saveRegistry">
                <div class="row">
                    <div class="col-md-6 mb-3">
                        <label class="form-label" for="registry-url">{{ $t("registryUrl") }}</label>
                        <input id="registry-url" v-model="form.url" class="form-control" placeholder="ghcr.io" required autocomplete="off" spellcheck="false" />
                    </div>
                    <div class="col-md-6 mb-3">
                        <label class="form-label" for="registry-name">{{ $t("registryName") }}</label>
                        <input id="registry-name" v-model="form.name" class="form-control" :placeholder="$t('optional')" autocomplete="off" />
                    </div>
                    <div class="col-md-6 mb-3">
                        <label class="form-label" for="registry-username">{{ $t("Username") }}</label>
                        <input id="registry-username" v-model="form.username" class="form-control" required autocomplete="off" spellcheck="false" />
                    </div>
                    <div class="col-md-6 mb-3">
                        <label class="form-label" for="registry-password">{{ $t("tokenOrPassword") }}</label>
                        <input
                            id="registry-password"
                            v-model="form.password"
                            type="password"
                            class="form-control"
                            :placeholder="form.id ? $t('leaveEmptyToKeep') : ''"
                            :required="!form.id"
                            autocomplete="new-password"
                        />
                    </div>
                </div>

                <div class="d-flex gap-2">
                    <button type="submit" class="btn btn-primary" :disabled="saving">
                        <font-awesome-icon v-if="saving" icon="spinner" spin class="me-1" />
                        {{ $t("Save") }}
                    </button>
                    <button type="button" class="btn btn-normal" @click="cancelForm">{{ $t("cancel") }}</button>
                </div>
            </form>
        </div>

        <!-- List -->
        <div class="table-responsive">
            <table class="table table-sm table-hover align-middle resources-table">
                <thead>
                    <tr>
                        <th>{{ $t("registry") }}</th>
                        <th>{{ $t("url") }}</th>
                        <th>{{ $t("Username") }}</th>
                        <th>{{ $t("created") }}</th>
                        <th class="text-end">{{ $t("actions") }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="registry in registries" :key="registry.id">
                        <td>{{ registry.name }}</td>
                        <td><code>{{ registry.url }}</code></td>
                        <td>{{ registry.username }}</td>
                        <td class="text-nowrap text-muted">{{ formatDate(registry.createdDate) }}</td>
                        <td class="text-end text-nowrap">
                            <button
                                class="btn btn-sm btn-normal me-1"
                                :disabled="syncingId === registry.id"
                                :title="$t('relogin')"
                                @click="relogin(registry)"
                            >
                                <font-awesome-icon icon="rotate" :spin="syncingId === registry.id" />
                            </button>
                            <button class="btn btn-sm btn-normal me-1" :title="$t('Edit')" @click="editRegistry(registry)">
                                <font-awesome-icon icon="pen" />
                            </button>
                            <button class="btn btn-sm btn-outline-danger" :title="$t('delete')" @click="askRemove(registry)">
                                <font-awesome-icon icon="trash" />
                            </button>
                        </td>
                    </tr>
                    <tr v-if="!loading && registries.length === 0">
                        <td colspan="5" class="text-center text-muted py-4">{{ $t("registriesEmpty") }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <Confirm ref="confirmRemove" :yes-text="$t('yes')" :no-text="$t('no')" btn-style="btn-danger" @yes="doRemove">
            <p class="mb-1">{{ $t("confirmDeleteRegistry") }}</p>
            <code v-if="pendingRegistry">{{ pendingRegistry.url }}</code>
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
            registries: [],
            sources: { loginRegistries: [],
                mirrors: [],
                configError: "",
                daemonError: "" },
            selectedEndpoint: this.$route.query.endpoint || this.endpoint,
            loadError: "",
            requestId: 0,
            loading: false,
            saving: false,
            syncingAll: false,
            syncingId: null,
            showForm: false,
            pendingRegistry: null,
            form: {
                id: null,
                name: "",
                url: "",
                username: "",
                password: "",
            },
        };
    },

    computed: {
        hasMultipleEndpoints() {
            return Object.keys(this.$root.agentList || {}).length > 1;
        },
    },

    watch: {
        selectedEndpoint() {
            this.cancelForm();
            this.registries = [];
            this.loadRegistries();
        },
    },

    mounted() {
        this.loadRegistries();
    },

    methods: {
        loadRegistries() {
            const requestId = ++this.requestId;
            this.loading = true;
            this.loadError = "";

            this.$root.emitAgent(this.selectedEndpoint, "getRegistryList", (res) => {
                if (requestId !== this.requestId) {
                    return;
                }
                this.loading = false;

                if (res?.ok) {
                    this.registries = res.registries;
                    this.sources = res.sources || { loginRegistries: [],
                        mirrors: [],
                        configError: "",
                        daemonError: "" };
                } else {
                    this.registries = [];
                    this.sources = { loginRegistries: [],
                        mirrors: [],
                        configError: "",
                        daemonError: "" };
                    this.loadError = res?.msg || this.$t("unknownError");
                }
            });
        },

        formatDate(value) {
            if (!value) {
                return this.$t("notAvailableShort");
            }

            const date = new Date(value);

            if (Number.isNaN(date.getTime())) {
                return value;
            }

            return date.toLocaleDateString();
        },

        cancelForm() {
            this.showForm = false;
            this.form = {
                id: null,
                name: "",
                url: "",
                username: "",
                password: "",
            };
        },

        editRegistry(registry) {
            this.form = {
                id: registry.id,
                name: registry.name,
                url: registry.url,
                username: registry.username,
                password: "",
            };
            this.showForm = true;
        },

        saveRegistry() {
            this.saving = true;

            this.$root.emitAgent(this.selectedEndpoint, "saveRegistry", { ...this.form }, (res) => {
                this.saving = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.cancelForm();
                    this.loadRegistries();
                }
            });
        },

        relogin(registry) {
            this.syncingId = registry.id;

            this.$root.emitAgent(this.selectedEndpoint, "reloginRegistry", registry.id, (res) => {
                this.syncingId = null;
                this.$root.toastRes(res);
                if (res.ok) {
                    this.loadRegistries();
                }
            });
        },

        reloginAll() {
            this.syncingAll = true;

            this.$root.emitAgent(this.selectedEndpoint, "reloginAllRegistries", (res) => {
                this.syncingAll = false;
                this.$root.toastRes(res);
                if (res.ok) {
                    this.loadRegistries();
                }
            });
        },

        askRemove(registry) {
            this.pendingRegistry = registry;
            this.$refs.confirmRemove.show();
        },

        doRemove() {
            if (!this.pendingRegistry) {
                return;
            }

            const registry = this.pendingRegistry;
            this.pendingRegistry = null;

            this.$root.emitAgent(this.selectedEndpoint, "deleteRegistry", registry.id, (res) => {
                this.$root.toastRes(res);
                this.loadRegistries();
            });
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../../styles/vars.scss";

.registries-hint {
    font-size: 14px;
    opacity: 0.7;
}

.registry-endpoint { width: auto; min-width: 180px; }
.configured-sources { padding: 16px 18px; }
.configured-sources h2 { font-size: 17px; margin-bottom: 4px; }
.source-group { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; font-size: 14px; }
.source-group strong { min-width: 145px; }
.source-chip { padding: 5px 9px; border-radius: 7px; background: #f1f3f5; overflow-wrap: anywhere; }
.dark .source-chip { background: $dark-bg2; }

.add-form {
    padding: 18px 20px;
}

.resources-table {
    font-size: 14px;

    th {
        font-weight: 600;
        white-space: nowrap;
    }
}
</style>
