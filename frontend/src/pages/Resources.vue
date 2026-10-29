<template>
    <div>
        <h1 v-show="show" class="mb-3">
            {{ $t("resources") }}
        </h1>

        <div class="shadow-box shadow-box-resources">
            <div class="row">
                <div v-if="showSubMenu" class="resources-menu col-lg-3 col-md-5">
                    <router-link
                        v-for="(item, key) in subMenus"
                        :key="key"
                        :to="`/resources/${key}`"
                    >
                        <div class="menu-item">
                            <font-awesome-icon :icon="item.icon" class="me-2" />
                            {{ item.title }}
                        </div>
                    </router-link>

                    <div class="resources-hint">
                        {{ $t("resourcesHint") }}
                    </div>
                </div>
                <div class="resources-content col-lg-9 col-md-7">
                    <div v-if="currentPage" class="resources-content-header">
                        <span>{{ currentTitle }}</span>

                        <!-- Agent / endpoint selector -->
                        <select v-if="hasMultipleEndpoints" v-model="endpoint" class="form-select form-select-sm endpoint-select">
                            <option
                                v-for="(agent, agentEndpoint) in $root.agentList"
                                :key="agentEndpoint"
                                :value="agentEndpoint"
                            >
                                {{ (agent.name !== '') ? agent.name : (agent.url || $t("currentEndpoint")) }}
                            </option>
                        </select>
                    </div>
                    <div class="mx-3">
                        <router-view v-slot="{ Component }">
                            <transition name="slide-fade" appear>
                                <component :is="Component" :key="endpoint" :endpoint="endpoint" />
                            </transition>
                        </router-view>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { useRoute } from "vue-router";

export default {
    data() {
        return {
            show: true,
            endpoint: localStorage.resourcesEndpoint || "",
        };
    },

    computed: {
        currentPage() {
            let pathSplit = useRoute().path.split("/");
            let pathEnd = pathSplit[pathSplit.length - 1];
            if (!pathEnd || pathEnd === "resources") {
                return null;
            }
            return pathEnd;
        },

        showSubMenu() {
            if (this.$root.isMobile) {
                return !this.currentPage;
            } else {
                return true;
            }
        },

        currentTitle() {
            return this.subMenus[this.currentPage]?.title || "";
        },

        hasMultipleEndpoints() {
            return Object.keys(this.$root.agentList || {}).length > 1;
        },

        agentListLoaded() {
            return Object.keys(this.$root.agentList || {}).length > 0;
        },

        subMenus() {
            return {
                images: {
                    title: this.$t("images"),
                    icon: "images",
                },
                volumes: {
                    title: this.$t("volumes"),
                    icon: "database",
                },
                networks: {
                    title: this.$t("networks"),
                    icon: "network-wired",
                },
                registries: {
                    title: this.$t("registries"),
                    icon: "warehouse",
                },
            };
        },
    },

    watch: {
        endpoint() {
            localStorage.resourcesEndpoint = this.endpoint;
        },

        "$root.agentList"() {
            // Reset when the selected agent was removed
            if (this.endpoint && this.agentListLoaded && !this.$root.agentList[this.endpoint]) {
                this.endpoint = "";
            }
        },
    },

    mounted() {
        if (this.endpoint && this.agentListLoaded && !this.$root.agentList[this.endpoint]) {
            this.endpoint = "";
        }

        // Land on the images tab by default
        if (!this.currentPage && !this.$root.isMobile) {
            this.$router.push("/resources/images");
        }
    },
};
</script>

<style lang="scss" scoped>
@import "../styles/vars.scss";

.shadow-box-resources {
    padding: 20px;
    min-height: calc(100vh - 155px);
}

.resources-menu {
    a {
        text-decoration: none !important;
        color: inherit;
    }

    .menu-item {
        border-radius: 10px;
        margin: 0.5em;
        padding: 0.7em 1em;
        cursor: pointer;
        border-left-width: 0;
        transition: all ease-in-out 0.1s;
    }

    .menu-item:hover {
        background: $highlight-white;

        .dark & {
            background: $dark-header-bg;
        }
    }

    .active .menu-item {
        background: $highlight-white;
        border-left: 4px solid $primary;
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;

        .dark & {
            background: $dark-header-bg;
        }
    }

    .resources-hint {
        margin: 1em;
        font-size: 12px;
        line-height: 1.5;
        opacity: 0.6;
    }
}

.resources-content {
    .resources-content-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: calc(100% + 20px);
        border-bottom: 1px solid #dee2e6;
        border-radius: 0 10px 0 0;
        margin-top: -20px;
        margin-right: -20px;
        padding: 12.5px 1em;
        font-size: 26px;

        .dark & {
            background: $dark-header-bg;
            border-bottom: 0;
        }

        .mobile & {
            padding: 15px 0 0 0;

            .dark & {
                background-color: transparent;
            }
        }
    }

    .endpoint-select {
        max-width: 220px;
        font-size: 14px;
    }
}
</style>
