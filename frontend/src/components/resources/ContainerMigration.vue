<template>
    <div class="resource-detail">
        <div class="detail-head"><h1 class="detail-title">{{ $t("containerMigration") }}</h1></div>
        <p class="note">{{ $t("containerMigrationHint") }}</p>
        <button class="btn btn-dark mb-3" :disabled="loading" @click="load">{{ $t("refresh") }}</button>
        <router-link v-if="selectedId" class="btn btn-link mb-3" to="/resources/containers">{{ $t("viewAll") }}</router-link>
        <div v-if="error" class="alert alert-danger">{{ error }}</div>
        <div v-if="loading">{{ $t("loadingResources") }}</div>
        <div v-for="container in visibleContainers" :key="container.id" class="card mb-2 p-3 d-flex flex-row justify-content-between align-items-center gap-2">
            <div>
                <strong>{{ container.name }}</strong>
                <div class="small text-muted">{{ container.image }} · {{ container.state }} <span v-if="container.stack">· {{ container.stack }}/{{ container.service }}</span></div>
            </div>
            <button class="btn btn-primary btn-sm" :disabled="loadingDraft" @click="draft(container)">{{ $t("generateComposeDraft") }}</button>
        </div>
        <div v-if="!loading && !error && containers.length === 0" class="note">{{ $t("noResources") }}</div>

        <BModal v-model="showDraft" :title="$t('composeDraft')" :ok-title="$t('reviewInCompose')" @ok="review">
            <p class="small">{{ $t("containerMigrationReviewHint") }}</p>
            <ul class="small text-warning"><li v-for="warning in warnings" :key="warning">{{ $t(warning) }}</li></ul>
            <pre class="snippet migration-preview">{{ composeYAML }}</pre>
        </BModal>
    </div>
</template>

<script>
export default {
    props: { endpoint: { type: String,
        default: "" } },
    data() {
        return { containers: [],
            loading: false,
            loadingDraft: false,
            error: "",
            showDraft: false,
            composeYAML: "",
            warnings: [],
            requestId: 0 };
    },
    computed: {
        selectedId() {
            return this.$route.query.name || "";
        },
        visibleContainers() {
            return this.selectedId ? this.containers.filter((container) => container.id === this.selectedId) : this.containers;
        },
    },
    watch: { endpoint() {
        this.load();
    } },
    mounted() {
        this.load();
    },
    methods: {
        load() {
            const id = ++this.requestId;
            this.loading = true;
            this.error = "";
            this.$root.emitAgent(this.endpoint, "getDockerContainerMigrationList", (res) => {
                if (id !== this.requestId) {
                    return;
                }
                this.loading = false;
                if (res?.ok) {
                    this.containers = res.containers;
                } else {
                    this.error = res?.msg || this.$t("unknownError");
                }
            });
        },
        draft(container) {
            this.loadingDraft = true;
            this.$root.emitAgent(this.endpoint, "getDockerContainerComposeDraft", container.id, (res) => {
                this.loadingDraft = false;
                if (!res?.ok) {
                    this.$root.toastRes(res);
                    return;
                }
                this.composeYAML = res.composeYAML;
                this.warnings = res.warnings;
                this.showDraft = true;
            });
        },
        review() {
            this.$root.composeTemplate = this.composeYAML;
            this.$root.composeTemplateEndpoint = this.endpoint;
            this.$router.push("/compose");
        },
    },
};
</script>

<style scoped>
@import "../../styles/resource-detail.scss";
.migration-preview { max-height: 45vh; overflow: auto; }
</style>
