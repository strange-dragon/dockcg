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

        <p class="page-hint small">{{ $t("registriesHint") }}</p>

        <section class="shadow-box configured-sources mb-4">
            <h2 class="h5">{{ $t("configuredDockerSources") }}</h2>
            <p class="source-note">{{ $t("configuredDockerSourcesHint") }}</p>
            <p class="source-note">{{ $t("configuredSourceUnverified") }}</p>
            <div v-if="loading" class="source-note" role="status">{{ $t("loadingResources") }}</div>
            <div v-else-if="loadError" class="text-danger">{{ loadError }}</div>
            <template v-else>
                <div class="source-item">
                    <div class="source-row">
                        <span class="source-label">{{ $t("dockerLoginSources") }}</span>
                        <div class="source-values">
                            <span
                                v-for="name in sources.loginRegistries" :key="name" class="source-chip"
                                :title="name === 'docker.io' ? $t('defaultRegistryHint') : (managedLogin(name) ? '' : $t('sourceFromDockerConfig'))"
                            >
                                {{ name }}
                                <span v-if="name === 'docker.io'" class="source-tag">{{ $t("defaultRegistry") }}</span>
                                <button
                                    v-else-if="managedLogin(name)" class="chip-remove" type="button"
                                    :title="$t('removeSource')" @click="removeSource(managedLogin(name))"
                                >
                                    <font-awesome-icon icon="times" />
                                </button>
                            </span>
                            <span v-if="sources.loginRegistries.length === 0" class="source-chip is-empty">{{ $t("noneConfigured") }}</span>
                            <button class="source-add" type="button" @click="showForm = true">
                                <font-awesome-icon icon="plus" />
                                <span>{{ $t("addRegistry") }}</span>
                            </button>
                        </div>
                    </div>
                    <p v-if="sources.loginRegistries.length === 0" class="source-note source-note-body">{{ $t("noDockerLoginSources") }}</p>
                </div>

                <div class="source-item">
                    <div class="source-row">
                        <span class="source-label">{{ $t("dockerRegistryMirrors") }}</span>
                        <div class="source-values">
                            <code v-for="mirror in sources.mirrors" :key="mirror" class="source-chip">{{ mirror }}</code>
                            <span v-if="sources.mirrors.length === 0 && !sources.daemonError" class="source-chip is-empty">{{ $t("noneConfigured") }}</span>
                        </div>
                    </div>
                    <p v-if="sources.mirrors.length === 0 && !sources.daemonError" class="source-note source-note-body">{{ $t("noDockerRegistryMirrors") }}</p>
                </div>

                <div v-if="sources.configPath" class="source-item">
                    <div class="source-row">
                        <span class="source-label">{{ $t("registrySourcePath") }}</span>
                        <div class="source-values">
                            <code class="source-chip">{{ sources.configPath }}</code>
                        </div>
                    </div>
                    <p v-if="sources.credsStore" class="source-note source-note-body">
                        {{ $t("credentialsManagedBy") }} <code class="source-chip">{{ sources.credsStore }}</code>
                    </p>
                </div>

                <p v-if="sources.configError" class="source-warn mb-0">{{ $t("dockerConfigReadFailed") }}</p>
                <p v-if="sources.daemonError" class="source-warn mb-0">{{ $t("dockerMirrorReadFailed") }}</p>
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
        <div class="table-responsive registry-table-wrap">
            <table class="table table-sm table-hover align-middle registry-table small">
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
                        <td colspan="5" class="table-empty">{{ $t("registriesEmpty") }}</td>
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
                managedLogins: [],
                mirrors: [],
                configError: "",
                daemonError: "",
                configPath: "",
                credsStore: "" },
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
        /** A chip that maps to a registry saved in Dockcg can be removed here. */
        managedLogin(name) {
            return (this.sources.managedLogins || []).find((item) => item.label === name) || null;
        },

        removeSource(entry) {
            const registry = this.registries.find((item) => String(item.id) === String(entry.id));

            if (registry) {
                this.askRemove(registry);
            }
        },

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
                        managedLogins: [],
                        mirrors: [],
                        configError: "",
                        daemonError: "",
                        configPath: "",
                        credsStore: "" };
                } else {
                    this.registries = [];
                    this.sources = { loginRegistries: [],
                        managedLogins: [],
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

.page-hint {
    color: #6c757d;

    .dark & {
        color: rgba($dark-font-color, 0.66);
    }
}

.registry-endpoint { width: auto; min-width: 180px; }

/* ---- Configured sources ---- */
.configured-sources {
    padding: 16px 18px;

    h2 {
        margin-bottom: 6px;
    }
}

.source-note {
    margin: 0 0 4px;
    color: #6c757d;
    font-size: 12px;
    line-height: 1.6;

    .dark & {
        color: rgba($dark-font-color, 0.62);
    }
}

/* A label + values pair, with an optional explanation underneath */
.source-item {
    padding: 12px 0;

    & + .source-item {
        border-top: 1px solid #dee2e6;

        .dark & {
            border-color: $dark-border-color;
        }
    }

    &:last-child {
        padding-bottom: 0;
    }
}

.source-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
}

.source-label {
    flex: 0 0 auto;
    width: 92px;
    font-size: var(--rd-fs-small);
    font-weight: 600;
}

.source-values {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-width: 0;
}

.source-note-body {
    margin: 6px 0 0 104px;
}

/* Chips and the add button share one height so nothing overlaps */
.source-chip {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 9px;
    border: 1px solid #dee2e6;
    border-radius: 6px;
    background: #f1f3f5;
    color: inherit;
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
    overflow-wrap: anywhere;

    .dark & {
        border-color: $dark-border-color;
        background: $dark-header-bg;
        color: $dark-font-color;
    }
}

.source-chip.is-empty {
    border-style: dashed;
    opacity: 0.6;
}

/* Docker Hub is built in: a badge instead of a remove button */
.source-tag {
    height: 17px;
    padding: 0 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.06);
    font-size: 11px;
    line-height: 17px;
    opacity: 0.8;

    .dark & {
        background: rgba(255, 255, 255, 0.1);
    }
}

.chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    font-size: 10px;
    opacity: 0.5;
    cursor: pointer;

    &:hover {
        background: rgba(0, 0, 0, 0.08);
        opacity: 1;

        .dark & {
            background: rgba(255, 255, 255, 0.14);
        }
    }
}

/* Dashed affordance: reads as "add", never as a chip that is already filled */
.source-add {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 10px;
    border: 1px dashed #ced4da;
    border-radius: 6px;
    background: transparent;
    color: #495057;
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    transition: border-color 0.15s ease, color 0.15s ease;

    &:hover {
        border-color: $primary;
        color: #2b7bb9;
    }

    .dark & {
        border-color: rgba(255, 255, 255, 0.18);
        color: rgba($dark-font-color, 0.9);

        &:hover {
            border-color: $primary;
            color: $primary;
        }
    }
}

.source-warn {
    margin-top: 10px;
    color: $warning;
    font-size: 12px;
}

.add-form {
    padding: 18px 20px;
}

/* ---- Registry list ---- */
.registry-table {
    margin-bottom: 0;

    thead th {
        padding: 8px 10px;
        border-bottom: 1px solid #dee2e6;
        color: #6c757d;
        font-weight: 600;
        white-space: nowrap;

        .dark & {
            border-bottom-color: $dark-border-color;
            color: rgba($dark-font-color, 0.62);
        }
    }

    tbody td {
        padding: 8px 10px;
        border-color: #e9ecef;

        .dark & {
            border-color: rgba($dark-border-color, 0.8);
        }
    }

    tbody tr:last-child td {
        border-bottom: 0;
    }

    code {
        background: none;
        padding: 0;
        font-size: 12px;
    }
}

.table-empty {
    padding: 22px 10px !important;
    border-bottom: 0 !important;
    color: #6c757d;
    text-align: center;

    .dark & {
        color: rgba($dark-font-color, 0.55);
    }
}
</style>
