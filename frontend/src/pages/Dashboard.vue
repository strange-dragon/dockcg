<template>
    <div class="container-fluid">
        <div class="row">
            <div class="col-12 col-md-4 col-xl-3 mb-3">
                <ResourcesSidebar v-model:endpoint="endpoint" />
            </div>

            <div ref="container" class="col-12 col-md-8 col-xl-9 mb-3">
                <!-- Add :key to disable vue router re-use the same component -->
                <router-view :key="$route.fullPath" :endpoint="endpoint" :calculatedHeight="height" />
            </div>
        </div>
    </div>
</template>

<script>

import ResourcesSidebar from "../components/ResourcesSidebar.vue";

export default {
    components: {
        ResourcesSidebar,
    },
    data() {
        return {
            height: 0,
            endpoint: localStorage.resourcesEndpoint || "",
        };
    },
    watch: {
        endpoint() {
            localStorage.resourcesEndpoint = this.endpoint;
        },

        "$root.agentList"() {
            const list = this.$root.agentList || {};

            // Reset when the selected agent disappeared
            if (this.endpoint && Object.keys(list).length > 0 && !list[this.endpoint]) {
                this.endpoint = "";
            }
        },
    },
    mounted() {
        this.height = this.$refs.container.offsetHeight;
    },
};
</script>

<style lang="scss" scoped>
.container-fluid {
    width: 98%;
}
</style>
