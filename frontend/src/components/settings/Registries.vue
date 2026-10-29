<template>
    <div>
        <!-- Toolbar -->
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
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

    mounted() {
        this.loadRegistries();
    },

    methods: {
        loadRegistries() {
            this.loading = true;

            this.$root.emitAgent(this.endpoint, "getRegistryList", (res) => {
                this.loading = false;

                if (res.ok) {
                    this.registries = res.registries;
                } else {
                    this.$root.toastRes(res);
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

            this.$root.emitAgent(this.endpoint, "saveRegistry", { ...this.form }, (res) => {
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

            this.$root.emitAgent(this.endpoint, "reloginRegistry", registry.id, (res) => {
                this.syncingId = null;
                this.$root.toastRes(res);
            });
        },

        reloginAll() {
            this.syncingAll = true;

            this.$root.emitAgent(this.endpoint, "reloginAllRegistries", (res) => {
                this.syncingAll = false;
                this.$root.toastRes(res);
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

            this.$root.emitAgent(this.endpoint, "deleteRegistry", registry.id, (res) => {
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
    font-size: 13px;
    opacity: 0.7;
}

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
