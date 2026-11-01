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
            <h2 class="h5">
                {{ $t("configuredDockerSources") }}
                <font-awesome-icon icon="circle-info" class="src-info" :title="$t('configuredSourcesTooltip')" />
            </h2>
            <div v-if="loading" class="source-note" role="status">{{ $t("loadingResources") }}</div>
            <div v-else-if="loadError" class="text-danger">{{ loadError }}</div>
            <template v-else>
                <div class="src-group-title">{{ $t("dockerLoginSources") }}</div>
                <div class="src-list">
                    <div
                        v-for="name in sources.loginRegistries" :key="name" class="src-item"
                        :title="loginSourceTitle(name)"
                    >
                        <span class="src-mark" :style="{ background: sourceColor(name) }">{{ sourceInitial(name) }}</span>
                        <div class="src-body">
                            <span class="src-name">{{ name }}</span>
                            <span class="src-meta">{{ loginSourceMeta(name) }}</span>
                        </div>
                        <div class="src-actions">
                            <button
                                v-if="managedLogin(name)" class="btn btn-sm btn-normal" type="button"
                                :title="$t('removeSource')" @click="removeSource(managedLogin(name))"
                            >
                                <font-awesome-icon icon="times" />
                            </button>
                        </div>
                    </div>
                    <div v-if="sources.loginRegistries.length === 0" class="src-item is-empty">
                        <span class="src-mark is-empty"><font-awesome-icon icon="plus" /></span>
                        <div class="src-body">
                            <span class="src-name">{{ $t("noneConfigured") }}</span>
                            <span class="src-meta">{{ $t("sourceFromHostConfig") }}</span>
                        </div>
                        <div class="src-actions">
                            <button class="btn btn-sm btn-normal" type="button" @click="showForm = true">
                                <font-awesome-icon icon="plus" class="me-1" />{{ $t("addRegistry") }}
                            </button>
                        </div>
                    </div>
                </div>

                <div class="src-group-title">{{ $t("dockerRegistryMirrors") }}</div>
                <div class="src-list">
                    <div v-for="mirror in sources.mirrors" :key="mirror" class="src-item">
                        <span class="src-mark" :style="{ background: sourceColor(mirror) }">{{ sourceInitial(mirror) }}</span>
                        <div class="src-body">
                            <span class="src-name">{{ mirror }}</span>
                            <span class="src-meta">{{ $t("sourceDaemonMirror") }}</span>
                        </div>
                    </div>
                    <div v-if="sources.mirrors.length === 0 && !sources.daemonError" class="src-item is-empty">
                        <span class="src-mark is-empty"><font-awesome-icon icon="circle-info" /></span>
                        <div class="src-body">
                            <span class="src-name">{{ $t("noneConfigured") }}</span>
                            <span class="src-meta">{{ $t("mirrorConfigureInDaemon") }}</span>
                        </div>
                    </div>
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

        <!-- Saved registries, in the same row language as the stack list -->
        <div class="src-group-title saved-title">{{ $t("savedRegistries") }}</div>
        <div class="src-list saved-list">
            <div v-for="registry in registries" :key="registry.id" class="src-item">
                <span class="src-mark" :style="{ background: sourceColor(registry.url) }">{{ sourceInitial(registry.url) }}</span>
                <div class="src-body">
                    <span class="src-name">{{ registry.name || registry.url }}</span>
                    <span class="src-meta">
                        {{ registry.url }}<template v-if="registry.username"> · {{ registry.username }}</template> · {{ formatDate(registry.createdDate) }}
                    </span>
                </div>
                <div class="src-actions">
                    <button
                        class="btn btn-sm btn-normal"
                        :disabled="syncingId === registry.id"
                        :title="$t('relogin')"
                        @click="relogin(registry)"
                    >
                        <font-awesome-icon icon="rotate" :spin="syncingId === registry.id" />
                    </button>
                    <button class="btn btn-sm btn-normal" :title="$t('Edit')" @click="editRegistry(registry)">
                        <font-awesome-icon icon="pen" />
                    </button>
                    <button class="btn btn-sm btn-outline-danger" :title="$t('delete')" @click="askRemove(registry)">
                        <font-awesome-icon icon="trash" />
                    </button>
                </div>
            </div>
            <div v-if="!loading && registries.length === 0" class="src-item is-empty">
                <span class="src-mark is-empty"><font-awesome-icon icon="plus" /></span>
                <div class="src-body">
                    <span class="src-name">{{ $t("registriesEmpty") }}</span>
                </div>
                <div class="src-actions">
                    <button class="btn btn-sm btn-normal" type="button" @click="showForm = true">
                        <font-awesome-icon icon="plus" class="me-1" />{{ $t("addRegistry") }}
                    </button>
                </div>
            </div>
        </div>

        <Confirm ref="confirmRemove" :yes-text="$t('yes')" :no-text="$t('no')" btn-style="btn-danger" @yes="doRemove">
            <p class="mb-1">{{ $t("confirmDeleteRegistry") }}</p>
            <code v-if="pendingRegistry">{{ pendingRegistry.url }}</code>
        </Confirm>
    </div>
</template>

<script>
import Confirm from "../Confirm.vue";

/*
 * Every source gets a colour, and the same source always gets the same colour,
 * so a host is recognisable across the login list, the mirror list and the
 * saved list without reading the text.
 */
const KNOWN_SOURCE_COLORS = {
    "docker.io": "#1f8eed",
    "ghcr.io": "#8250df",
    "quay.io": "#e01f3d",
    "gcr.io": "#4285f4",
    "registry.gitlab.com": "#fc6d26",
    "public.ecr.aws": "#f7941d",
    "registry.k8s.io": "#326ce5",
    "ghcr.kuma.pet": "#8250df",
};

const SOURCE_PALETTE = [
    "#3b82f6",
    "#a855f7",
    "#ec4899",
    "#f59e0b",
    "#10b981",
    "#06b6d4",
    "#ef4444",
    "#84cc16",
];

/** Strips scheme, port-less path and trailing slash: `https://a.io/v2/` -> `a.io` */
export function sourceHost(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/^[a-z]+:\/\//, "")
        .replace(/\/.*$/, "")
        .replace(/^v1\./, "");
}

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
        /** Stable colour for a registry host, so one source always looks the same */
        sourceColor(value) {
            const host = sourceHost(value);

            if (KNOWN_SOURCE_COLORS[host]) {
                return KNOWN_SOURCE_COLORS[host];
            }

            let hash = 0;
            for (let i = 0; i < host.length; i++) {
                hash = (hash * 31 + host.charCodeAt(i)) % 100000;
            }
            return SOURCE_PALETTE[hash % SOURCE_PALETTE.length];
        },

        sourceInitial(value) {
            const host = sourceHost(value).replace(/^[^a-z0-9]+/, "");
            return (host[0] || "?").toUpperCase();
        },

        /** Why this host shows up here: built in, saved in Dockcg, or from config.json */
        loginSourceMeta(name) {
            if (name === "docker.io") {
                return this.$t("defaultRegistry");
            }
            if (this.managedLogin(name)) {
                return this.$t("sourceManagedInDockcg");
            }
            return this.$t("sourceConfigOnly");
        },

        loginSourceTitle(name) {
            if (name === "docker.io") {
                return this.$t("defaultRegistryHint");
            }
            return this.managedLogin(name) ? "" : this.$t("sourceFromDockerConfig");
        },

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
        display: flex;
        align-items: center;
        gap: 7px;
        margin-bottom: 2px;
    }
}

/* The long explanation lives in this tooltip instead of a paragraph */
.src-info {
    color: #adb5bd;
    font-size: 12px;
    cursor: help;

    .dark & {
        color: rgba($dark-font-color, 0.45);
    }

    &:hover {
        color: $primary;
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

/* Group heading, the way the stack list labels its sections */
.src-group-title {
    margin: 18px 0 2px;
    padding: 0 8px;
    color: #6c757d;
    font-size: 12px;
    font-weight: 600;

    .dark & {
        color: rgba($dark-font-color, 0.55);
    }
}

.saved-title {
    margin-top: 0;
}

.src-list {
    display: flex;
    flex-direction: column;
}

/* Row geometry follows the stack list: 52px tall, 10px radius, hover fill */
.src-item {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 6px 8px;
    border-radius: 10px;
    transition: background-color ease-in-out 0.15s;

    &:hover {
        background-color: $highlight-white;
    }

    .dark &:hover {
        background-color: $dark-bg2;
    }

    &.is-empty {
        opacity: 0.75;
    }
}

/* The colour block: same host, same colour, everywhere on the page */
.src-mark {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    line-height: 1;
    text-transform: uppercase;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
    user-select: none;

    &.is-empty {
        border: 1px dashed #ced4da;
        background: transparent;
        box-shadow: none;
        color: #adb5bd;
        font-size: 12px;

        .dark & {
            border-color: $dark-border-color;
            color: rgba($dark-font-color, 0.5);
        }
    }
}

.src-body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
}

.src-name {
    font-size: 14px;
    line-height: 1.35;
    overflow-wrap: anywhere;
}

.src-meta {
    color: #6c757d;
    font-size: 12px;
    line-height: 1.4;
    overflow-wrap: anywhere;

    .dark & {
        color: rgba($dark-font-color, 0.55);
    }
}

.src-actions {
    display: flex;
    flex: 0 0 auto;
    gap: 6px;
    margin-left: auto;
}

.source-warn {
    margin-top: 10px;
    color: $warning;
    font-size: 12px;
}

.add-form {
    padding: 18px 20px;
}
</style>
