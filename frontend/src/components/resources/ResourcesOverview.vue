<template>
    <div class="resource-detail resources-overview">
        <div class="overview-heading">
            <div>
                <h1>{{ $t("dockerResources") }}</h1>
                <p>{{ $t("resourceOverviewHint") }}</p>
            </div>
            <button class="btn btn-outline-normal" type="button" :disabled="loading" @click="load">
                <font-awesome-icon icon="arrows-rotate" :spin="loading" /> {{ $t("refresh") }}
            </button>
        </div>

        <div v-if="error" class="alert alert-danger" role="alert">
            {{ $t("resourceLoadFailed") }} {{ error }}
        </div>
        <div v-else-if="loading && !loaded" class="overview-status" role="status">{{ $t("loadingResources") }}</div>
        <div class="d-flex flex-wrap gap-2 mb-3">
            <button class="btn btn-normal btn-sm" @click="preview('images', 'dangling')">{{ $t("pruneDanglingImages") }}</button>
            <button class="btn btn-normal btn-sm" @click="preview('images', 'unused')">{{ $t("pruneUnusedImages") }}</button>
            <button class="btn btn-normal btn-sm" @click="preview('volumes')">{{ $t("pruneVolumes") }}</button>
            <button class="btn btn-normal btn-sm" @click="preview('networks')">{{ $t("pruneNetworks") }}</button>
        </div>
        <div v-if="pruneFailures.length" class="alert alert-warning small">
            <div v-for="failure in pruneFailures" :key="failure.name">{{ failure.name }}: {{ failure.error }}</div>
        </div>
        <BModal v-model="showPrune" :title="$t('prunePreview')" :ok-title="$t('cleanUp')" :ok-disabled="pruning || candidates.length === 0" @ok="prune">
            <p class="small text-muted">{{ $t('prunePreviewHint') }}</p>
            <div v-if="previewing">{{ $t("loadingResources") }}</div>
            <div v-else-if="candidates.length === 0">{{ $t("nothingToPrune") }}</div>
            <ul v-else class="prune-list"><li v-for="candidate in candidates" :key="candidate.name">{{ candidate.name }}</li></ul>
            <p v-if="pruneKind === 'volumes'" class="text-warning small">{{ $t('pruneDataWarning') }}</p>
            <div v-if="pruneFailures.length" class="alert alert-warning small">
                <div v-for="failure in pruneFailures" :key="failure.name">{{ failure.name }}: {{ failure.error }}</div>
            </div>
        </BModal>

        <div v-if="loaded" class="overview-grid">
            <section v-for="group in groups" :key="group.type" class="shadow-box overview-card">
                <div class="card-heading">
                    <div>
                        <h2 class="h5">{{ $t(group.title) }}</h2>
                        <span class="card-count">{{ group.count }}</span>
                    </div>
                    <router-link :to="`/resources/${group.type}`">{{ $t("viewAll") }} →</router-link>
                </div>
                <div v-if="group.count === 0" class="empty-list">{{ $t("noResources") }}</div>
                <router-link
                    v-for="item in group.items" :key="item.name"
                    class="overview-item" :to="{ path: `/resources/${group.type}`, query: { name: item.query || item.name } }"
                    :title="item.name"
                >
                    <span class="item-name">{{ item.name }}</span>
                    <span class="badge" :class="item.builtIn ? 'bg-secondary' : item.used ? 'bg-primary' : 'bg-warning'">
                        {{ $t(group.type === "containers" ? (item.used ? "runningContainer" : "stoppedContainer") : item.builtIn ? "builtIn" : item.used ? "inUse" : "unused") }}
                    </span>
                </router-link>
                <div v-if="group.count > group.items.length" class="more-count">{{ $t("moreResources", [ group.count - group.items.length ]) }}</div>
            </section>
        </div>
    </div>
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
            loading: false,
            loaded: false,
            error: "",
            resources: { containers: [],
                images: [],
                volumes: [],
                networks: [] },
            summary: { containerCount: 0,
                imageCount: 0,
                volumeCount: 0,
                networkCount: 0 },
            requestId: 0,
            showPrune: false,
            previewing: false,
            pruning: false,
            pruneKind: "",
            pruneMode: "dangling",
            candidates: [],
            pruneFailures: [],
        };
    },
    computed: {
        groups() {
            return [
                { type: "containers",
                    title: "containers",
                    count: this.summary.containerCount,
                    items: this.resources.containers || [] },
                { type: "images",
                    title: "images",
                    count: this.summary.imageCount,
                    items: this.resources.images },
                { type: "volumes",
                    title: "volumes",
                    count: this.summary.volumeCount,
                    items: this.resources.volumes },
                { type: "networks",
                    title: "networks",
                    count: this.summary.networkCount,
                    items: this.resources.networks },
            ];
        },
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
        preview(kind, mode = "dangling") {
            this.pruneKind = kind;
            this.pruneMode = mode;
            this.candidates = [];
            this.pruneFailures = [];
            this.previewing = true;
            this.showPrune = true;
            this.$root.emitAgent(this.endpoint, "previewDockerResourcePrune", { kind,
                mode }, (res) => {
                this.previewing = false;
                if (res?.ok) {
                    this.candidates = res.candidates;
                } else {
                    this.$root.toastRes(res);
                }
            });
        },
        prune() {
            const event = { images: "pruneDockerImages",
                volumes: "pruneDockerVolumes",
                networks: "pruneDockerNetworks" }[this.pruneKind];
            if (!event || this.candidates.length === 0) {
                return;
            }
            this.pruning = true;
            this.$root.emitAgent(this.endpoint, event, this.pruneKind === "images" ? this.pruneMode : false, (res) => {
                this.pruning = false;
                if (res?.ok) {
                    this.pruneFailures = res.failed || [];
                    this.$root.toastRes({ ok: true,
                        msgi18n: true,
                        msg: { key: "pruneResult",
                            values: [ res.removed.length, res.reclaimedText ] } });
                    this.showPrune = this.pruneFailures.length > 0;
                    this.load();
                } else {
                    this.$root.toastRes(res);
                }
            });
        },
        load() {
            const requestId = ++this.requestId;
            this.loading = true;
            this.error = "";
            this.loaded = false;
            this.$root.emitAgent(this.endpoint, "getDockerResourceSummary", (res) => {
                if (requestId !== this.requestId) {
                    return;
                }
                this.loading = false;
                if (res?.ok && res.resources) {
                    this.resources = res.resources;
                    this.summary = res.summary;
                    this.loaded = true;
                } else {
                    this.error = res?.msg || this.$t("unknownError");
                }
            });
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../../styles/resource-detail.scss";

.overview-heading,
.card-heading,
.overview-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--rd-3);
}

.overview-heading {
    align-items: flex-start;
    margin-bottom: var(--rd-5);

    h1 { margin: 0 0 6px; line-height: 1.3; }
    p { color: var(--muted); margin: 0; font-size: var(--rd-fs-small); }
}

.overview-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: var(--rd-4);
}

.overview-card { padding: var(--rd-4); min-width: 0; }
.card-heading { margin-bottom: var(--rd-3); }
.card-heading h2 { display: inline; margin: 0; }
.card-heading a { font-size: var(--rd-fs-small); white-space: nowrap; }
.card-count { margin-left: var(--rd-2); color: var(--muted); font-size: var(--rd-fs-small); }
.overview-item {
    padding: var(--rd-2) 0;
    border-top: 1px solid var(--card-border);
    text-decoration: none;
}
.item-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.overview-item .badge { flex: 0 0 auto; }
.empty-list, .more-count, .overview-status { padding: var(--rd-3) 0; color: var(--muted); font-size: var(--rd-fs-small); }
.prune-list { max-height: 35vh; overflow: auto; overflow-wrap: anywhere; }
</style>
