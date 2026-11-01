<template>
    <div class="resource-detail">
        <div class="detail-head"><h1 class="detail-title">{{ $t("containerMigration") }}</h1></div>
        <p class="note">{{ $t("containerMigrationHint") }}</p>

        <div v-if="error" class="alert alert-danger">{{ error }}</div>
        <div v-if="adoptError" class="alert alert-danger">{{ adoptError }}</div>
        <div v-if="loading" class="note" role="status">{{ $t("loadingResources") }}</div>
        <div v-else-if="unmanaged.length === 0" class="note">{{ $t("noUnmanagedContainers") }}</div>

        <div
            v-for="container in unmanaged" :key="container.id"
            class="shadow-box mb-2 p-3 d-flex flex-row justify-content-between align-items-center gap-2"
        >
            <div class="migration-row">
                <strong>{{ container.name }}</strong>
                <div class="small text-muted">{{ container.image }} · {{ container.state }}</div>
            </div>
            <button class="btn btn-primary btn-sm" :disabled="loadingDraft || adopting" @click="openAdopt(container)">
                {{ $t("adoptToStack") }}
            </button>
        </div>

        <!-- Before / after, then the file that will actually be written -->
        <BModal
            v-model="showAdopt" :title="$t('adoptContainerTitle')" :ok-title="$t('adoptConfirm')"
            :ok-disabled="adopting" size="lg" @ok="confirmAdopt"
        >
            <p class="small text-warning">{{ $t("adoptContainerWarn") }}</p>

            <label class="form-label small" for="adopt-stack-name">{{ $t("stackName") }}</label>
            <input
                id="adopt-stack-name" v-model="stackName" class="form-control form-control-sm mb-3"
                autocomplete="off" spellcheck="false"
            />

            <table class="table table-sm small migration-diff">
                <thead>
                    <tr>
                        <th scope="col"></th>
                        <th scope="col">{{ $t("migrationBefore") }}</th>
                        <th scope="col">{{ $t("migrationAfter") }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in diffRows" :key="row.label" :class="{ changed: row.changed }">
                        <th scope="row">{{ row.label }}</th>
                        <td>{{ row.before }}</td>
                        <td>{{ row.after }} <span v-if="row.changed" class="badge bg-primary">{{ $t("migrationChanged") }}</span></td>
                    </tr>
                </tbody>
            </table>

            <ul v-if="warnings.length" class="small text-warning">
                <li v-for="warning in warnings" :key="warning">{{ $t(warning) }}</li>
            </ul>

            <pre class="snippet migration-preview">{{ composeYAML }}</pre>
        </BModal>
    </div>
</template>

<script>
/** Mirrors backend/container-adoption.ts so the preview shows the real stack name. */
function toStackName(value) {
    const name = String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^[-_]+/, "")
        .replace(/[-_]+$/, "");
    return name === "" ? "migrated" : name.substring(0, 60);
}

export default {
    props: { endpoint: { type: String,
        default: "" } },
    data() {
        return {
            containers: [],
            loading: false,
            loadingDraft: false,
            adopting: false,
            error: "",
            adoptError: "",
            showAdopt: false,
            draftContainer: null,
            summary: null,
            composeYAML: "",
            warnings: [],
            stackName: "",
            requestId: 0,
        };
    },
    computed: {
        /** Only containers no compose file owns need a migration. */
        unmanaged() {
            return this.containers.filter((container) => !container.stack);
        },
        diffRows() {
            const summary = this.summary;
            if (!summary) {
                return [];
            }
            const join = (list) => (list && list.length ? list.join(", ") : "—");
            const rows = [
                {
                    label: this.$t("migrationManagement"),
                    before: "docker run",
                    after: `${this.stackName}/compose.yaml`,
                    changed: true,
                },
                {
                    label: this.$t("migrationContainerName"),
                    before: summary.name,
                    after: `${this.stackName}-${summary.service}-1`,
                    changed: true,
                },
                { label: this.$t("image"),
                    before: summary.image,
                    after: summary.image },
                { label: this.$t("ports"),
                    before: join(summary.ports),
                    after: join(summary.ports) },
                { label: this.$t("migrationMounts"),
                    before: join(summary.mounts),
                    after: join(summary.mounts) },
                { label: this.$t("networks"),
                    before: join(summary.networks),
                    after: join(summary.networks) },
                {
                    label: this.$t("environment"),
                    before: `${summary.envCount}`,
                    after: `${summary.envCount}`,
                },
                {
                    label: this.$t("migrationRestart"),
                    before: summary.restart || "—",
                    after: summary.restart || "—",
                },
            ];
            for (const row of rows) {
                if (row.changed === undefined) {
                    row.changed = row.before !== row.after;
                }
            }
            return rows;
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
        openAdopt(container) {
            this.loadingDraft = true;
            this.adoptError = "";
            this.$root.emitAgent(this.endpoint, "getDockerContainerComposeDraft", container.id, (res) => {
                this.loadingDraft = false;
                if (!res?.ok) {
                    this.$root.toastRes(res);
                    return;
                }
                this.draftContainer = container;
                this.summary = res.summary;
                this.composeYAML = res.composeYAML;
                this.warnings = (res.warnings || []).filter((warning) => warning !== "migrationAlreadyCompose");
                this.stackName = toStackName(container.name);
                this.showAdopt = true;
            });
        },
        confirmAdopt() {
            const container = this.draftContainer;
            if (!container) {
                return;
            }
            this.adopting = true;
            this.showAdopt = false;
            this.$root.emitAgent(
                this.endpoint, "adoptContainerToStack", { id: container.id,
                    stackName: this.stackName },
                (res) => {
                    this.adopting = false;
                    if (!res?.ok) {
                        this.adoptError = res?.msg || this.$t("unknownError");
                        return;
                    }
                    const path = this.endpoint ? `/compose/${res.stackName}/${this.endpoint}` : `/compose/${res.stackName}`;
                    this.$router.push(path);
                }
            );
        },
    },
};
</script>

<style scoped>
@import "../../styles/resource-detail.scss";
.migration-preview { max-height: 45vh; overflow: auto; }
.migration-row { min-width: 0; }
.migration-diff td { word-break: break-all; }
.migration-diff tr.changed td, .migration-diff tr.changed th { color: var(--strong); font-weight: 600; }
</style>
