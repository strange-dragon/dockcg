<template>
    <section class="shadow-box big-padding home-registries">
        <div class="section-heading">
            <h2>{{ $t("registries") }}</h2>
            <router-link class="btn btn-normal btn-sm" :to="{ path: '/settings/registries', query: { endpoint } }">{{ $t("manageRegistries") }}</router-link>
        </div>

        <div v-if="loading" class="text-muted" role="status">{{ $t("loadingResources") }}</div>
        <div v-else-if="error" class="text-danger" role="alert">{{ error }}</div>
        <div v-else class="row g-0 source-row">
            <div class="col-12 col-lg-4 source-group">
                <h3>{{ $t("savedRegistries") }}</h3>
                <div class="source-values">
                    <code v-for="registry in registries" :key="registry.id" :title="registry.name || registry.url">{{ registry.url }}</code>
                    <span v-if="registries.length === 0" class="text-muted">{{ $t("noneConfigured") }}</span>
                </div>
            </div>
            <div class="col-12 col-lg-4 source-group">
                <h3>{{ $t("dockerLoginSources") }}</h3>
                <div class="source-values">
                    <code v-for="name in sources.loginRegistries" :key="name">{{ name }}</code>
                    <span v-if="sources.loginRegistries.length === 0" class="text-muted">{{ $t("noneConfigured") }}</span>
                </div>
            </div>
            <div class="col-12 col-lg-4 source-group">
                <h3>{{ $t("dockerRegistryMirrors") }}</h3>
                <div class="source-values">
                    <code v-for="mirror in sources.mirrors" :key="mirror">{{ mirror }}</code>
                    <span v-if="sources.mirrors.length === 0" class="text-muted">{{ $t("noneConfigured") }}</span>
                </div>
            </div>
        </div>

        <p v-if="sources.configError" class="small text-warning mt-2 mb-0">{{ $t("dockerConfigReadFailed") }}</p>
        <p v-if="sources.daemonError" class="small text-warning mt-2 mb-0">{{ $t("dockerMirrorReadFailed") }}</p>
    </section>
</template>

<script>
export default {
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
            loading: false,
            error: "",
            requestId: 0,
        };
    },
    watch: {
        endpoint() {
            this.load();
        },
        "$root.socketIO.connected"(connected) {
            if (connected) {
                this.load();
            }
        },
    },
    mounted() {
        this.load();
    },
    methods: {
        load() {
            const requestId = ++this.requestId;
            this.loading = true;
            this.error = "";
            this.$root.emitAgent(this.endpoint, "getRegistryList", (res) => {
                if (requestId !== this.requestId) {
                    return;
                }
                this.loading = false;
                if (res?.ok) {
                    this.registries = res.registries || [];
                    this.sources = res.sources || { loginRegistries: [],
                        mirrors: [],
                        configError: "",
                        daemonError: "" };
                } else {
                    this.error = res?.msg || this.$t("unknownError");
                }
            });
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../../styles/vars.scss";

.section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
}

.section-heading h2 {
    margin: 0;
    font-size: 1.5rem;
}

.source-group {
    min-width: 0;
    padding: 0 16px;
    border-left: 1px solid #dee2e6;

    &:first-child {
        padding-left: 0;
        border-left: 0;
    }

    .dark & {
        border-color: $dark-border-color;
    }

    @media (max-width: 991px) {
        padding: 12px 0;
        border-left: 0;
        border-top: 1px solid #dee2e6;

        &:first-child {
            padding-top: 0;
            border-top: 0;
        }

        .dark & {
            border-color: $dark-border-color;
        }
    }
}

.source-group h3 {
    margin: 0 0 10px;
    font-size: 14px;
    font-weight: 600;
    color: #6c757d;

    .dark & {
        color: $dark-font-color;
    }
}

.source-values {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 13px;
}

.source-values code {
    max-width: 100%;
    overflow-wrap: anywhere;
    padding: 4px 7px;
    border-radius: 5px;
    background: #f1f3f5;
    color: inherit;

    .dark & {
        background: $dark-header-bg;
    }
}
</style>
