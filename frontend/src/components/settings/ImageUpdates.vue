<template>
    <section class="shadow-box image-updates mb-4">
        <div class="iu-header">
            <div class="iu-title">
                <h2 class="h5">{{ $t("imageUpdates") }}</h2>
                <p class="iu-hint">{{ $t("imageUpdatesHint") }}</p>
            </div>
            <button class="btn btn-sm btn-normal" :disabled="checking || updating" @click="check">
                <font-awesome-icon icon="arrows-rotate" :spin="checking" class="me-1" />
                {{ checking ? $t("checkingImageUpdates") : $t("checkImageUpdates") }}
            </button>
        </div>

        <p v-if="error" class="iu-error mb-2">{{ error }}</p>

        <div v-if="checking && entries.length === 0" class="iu-empty" role="status">
            {{ $t("checkingImageUpdates") }}…
        </div>

        <div v-else-if="!hasChecked" class="iu-empty">{{ $t("imageUpdatesIdle") }}</div>

        <template v-else-if="entries.length > 0">
            <div class="iu-list">
                <label
                    v-for="entry in entries" :key="entry.id" class="iu-item"
                    :class="{ 'is-selected': isSelected(entry), 'is-muted': entry.state === 'unknown' }"
                    :title="digestTitle(entry)"
                >
                    <input
                        v-if="entry.state !== 'current'" v-model="selected" class="form-check-input iu-check"
                        type="checkbox" :value="entry.id" :disabled="updating"
                    />
                    <span v-else class="iu-check-spacer"></span>

                    <span class="iu-dot" :class="entry.state"></span>

                    <div class="iu-body">
                        <span class="iu-name">{{ entry.image }}</span>
                        <span class="iu-meta">{{ metaOf(entry) }}</span>
                    </div>

                    <span class="iu-state" :class="entry.state">{{ stateLabel(entry) }}</span>
                </label>
            </div>

            <div class="iu-footer">
                <span class="iu-count">{{ $t("imagesSelected", { n: selected.length }) }}</span>
                <button class="btn btn-sm btn-normal" :disabled="updating || selectable.length === 0" @click="toggleAll">
                    {{ allSelected ? $t("selectNone") : $t("selectAll") }}
                </button>
                <button class="btn btn-sm btn-primary" :disabled="updating || selected.length === 0" @click="apply">
                    <font-awesome-icon v-if="updating" icon="rotate" spin class="me-1" />
                    {{ updating ? $t("pullingImages") : $t("pullAndRecreate") }}
                </button>
            </div>
        </template>

        <div v-else class="iu-empty">{{ $t("imageUpdatesNone") }}</div>
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
            entries: [],
            selected: [],
            checking: false,
            updating: false,
            hasChecked: false,
            error: "",
        };
    },

    computed: {
        selectable() {
            return this.entries.filter((entry) => entry.state !== "current");
        },
        allSelected() {
            return this.selectable.length > 0 && this.selected.length === this.selectable.length;
        },
    },

    methods: {
        isSelected(entry) {
            return this.selected.includes(entry.id);
        },

        stateLabel(entry) {
            if (entry.state === "outdated") {
                return this.$t("imageStateOutdated");
            }
            if (entry.state === "current") {
                return this.$t("imageStateCurrent");
            }
            return this.$t("imageStateUnknown");
        },

        metaOf(entry) {
            if (entry.note === "Image not pulled locally") {
                return this.$t("imageNotPulled");
            }
            if (entry.kind === "self") {
                return this.$t("imageSelfMeta");
            }
            if (entry.stacks && entry.stacks.length > 0) {
                return `${this.$t("imageUsedBy")} ${entry.stacks.join("、")}`;
            }
            return this.$t("imageNoStack");
        },

        digestTitle(entry) {
            const short = (digest) => (digest ? digest.replace(/^sha256:/, "").slice(0, 12) : "-");
            return `${entry.image}\nlocal: ${short(entry.currentDigest)}\nremote: ${short(entry.remoteDigest)}`;
        },

        check() {
            this.checking = true;
            this.error = "";

            this.$root.emitAgent(this.endpoint, "checkImageUpdates", (res) => {
                this.checking = false;
                this.hasChecked = true;

                if (res?.ok) {
                    this.entries = res.entries || [];
                    // Pre-select what actually needs work; unknowns need a look first.
                    this.selected = this.entries.filter((entry) => entry.state === "outdated").map((entry) => entry.id);
                } else {
                    this.entries = [];
                    this.selected = [];
                    this.error = res?.msg || this.$t("unknownError");
                }
            });
        },

        toggleAll() {
            this.selected = this.allSelected ? [] : this.selectable.map((entry) => entry.id);
        },

        apply() {
            this.updating = true;
            this.error = "";

            this.$root.emitAgent(this.endpoint, "updateImages", { images: this.selected }, (res) => {
                this.updating = false;

                if (!res?.ok) {
                    this.error = res?.msg || this.$t("unknownError");
                    return;
                }

                const needsRestart = (res.skipped || []).some((item) => item.reason === "selfRestartManually");
                const skipped = (res.skipped || []).filter((item) => item.reason !== "selfRestartManually");
                const pulled = res.updated || [];
                let done = this.$t("imageUpdateDone");
                if (pulled.length > 0) {
                    done = `${done} (${pulled.length})`;
                }
                if (skipped.length > 0) {
                    done = `${done} · ${this.$t("imageUpdateSkipped")} ${skipped.length}`;
                }
                if (needsRestart) {
                    done = `${done} · ${this.$t("imageSelfNeedsRestart")}`;
                }
                this.$root.toastSuccess(done);

                this.selected = [];
                this.check();
            });
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../../styles/vars.scss";

.image-updates {
    padding: 16px 18px;
}

.iu-header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 10px;
}

.iu-title {
    flex: 1 1 auto;
    min-width: 0;

    h2 {
        margin-bottom: 2px;
    }
}

.iu-hint {
    margin: 0;
    font-size: 12px;
    color: $dark-font-color3;
}

.iu-error {
    font-size: 12px;
    color: $warning;
}

.iu-empty {
    padding: 14px 2px 6px;
    font-size: 13px;
    color: $dark-font-color3;
}

.iu-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.iu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 6px 8px;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.15s ease-in-out;

    &:hover {
        background: #f6f8fa;
    }

    .dark &:hover {
        background: $dark-header-bg;
    }

    &.is-selected {
        background: rgba($primary, 0.1);
    }

    &.is-muted .iu-name {
        opacity: 0.55;
    }
}

.iu-check {
    flex: 0 0 auto;
    margin: 0;
}

.iu-check-spacer {
    flex: 0 0 auto;
    width: 16px;
}

.iu-dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #adb5bd;

    &.outdated {
        background: $warning;
    }

    &.current {
        background: #4caf50;
    }
}

.iu-body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.3;
}

.iu-name {
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.iu-meta {
    font-size: 12px;
    color: $dark-font-color3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.iu-state {
    flex: 0 0 auto;
    padding: 2px 8px;
    border-radius: 7px;
    font-size: 12px;
    background: rgba(0, 0, 0, 0.04);
    color: $dark-font-color3;

    &.outdated {
        background: rgba($warning, 0.16);
        color: #8a5a00;
    }

    &.current {
        background: rgba(76, 175, 80, 0.14);
        color: #1d6b23;
    }

    .dark &.outdated {
        color: $warning;
    }

    .dark &.current {
        color: #6ddc74;
    }
}

.iu-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(0, 0, 0, 0.06);

    .dark & {
        border-top-color: $dark-border-color;
    }
}

.iu-count {
    flex: 1 1 auto;
    font-size: 12px;
    color: $dark-font-color3;
}
</style>
