<template>
    <transition ref="tableContainer" name="slide-fade" appear>
        <div v-if="$route.name === 'DashboardHome'">
            <h1 class="mb-3">
                {{ $t("home") }}
            </h1>

            <div class="shadow-box big-padding text-center mb-4">
                <div class="row">
                    <div class="col">
                        <h3>{{ $t("active") }}</h3>
                        <span class="num active">{{ activeNum }}</span>
                    </div>
                    <div class="col">
                        <h3>{{ $t("exited") }}</h3>
                        <span class="num exited">{{ exitedNum }}</span>
                    </div>
                    <div class="col">
                        <h3>{{ $t("inactive") }}</h3>
                        <span class="num inactive">{{ inactiveNum }}</span>
                    </div>
                </div>
            </div>

            <HomeRegistries :endpoint="endpoint" class="mb-4" />

            <section class="docker-converter">
                <h2 class="mb-3">{{ $t("Docker Run") }}</h2>
                <div class="mb-3">
                    <textarea id="docker-run-command" v-model="dockerRunCommand" class="form-control docker-run shadow-box" rows="3" placeholder="docker run ..."></textarea>
                </div>
                <button class="btn-normal btn mb-4" @click="convertDockerRun">{{ $t("Convert to Compose") }}</button>
            </section>
        </div>
    </transition>
    <router-view ref="child" />
</template>

<script>
import { statusNameShort } from "../../../common/util-common";
import HomeRegistries from "../components/resources/HomeRegistries.vue";

export default {
    components: {
        HomeRegistries,
    },
    props: {
        endpoint: {
            type: String,
            default: "",
        },
        calculatedHeight: {
            type: Number,
            default: 0,
        },
    },
    data() {
        return {
            dockerRunCommand: "",
        };
    },
    computed: {
        activeNum() {
            return this.getStatusNum("active");
        },
        inactiveNum() {
            return this.getStatusNum("inactive");
        },
        exitedNum() {
            return this.getStatusNum("exited");
        },
    },
    methods: {
        getStatusNum(statusName) {
            let num = 0;
            for (const stack of Object.values(this.$root.completeStackList || {})) {
                if (statusNameShort(stack.status) === statusName) {
                    num += 1;
                }
            }
            return num;
        },
        convertDockerRun() {
            if (this.dockerRunCommand.trim() === "docker run") {
                throw new Error("Please enter a docker run command");
            }
            this.$root.getSocket().emit("composerize", this.dockerRunCommand, (res) => {
                if (res.ok) {
                    this.$root.composeTemplate = res.composeTemplate;
                    this.$router.push("/compose");
                } else {
                    this.$root.toastRes(res);
                }
            });
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../styles/vars";

.num {
    display: block;
    font-size: 30px;
    font-weight: bold;

    &.active { color: $primary; }
    &.exited { color: $danger; }
}

.docker-run {
    border: none;
    font-family: 'JetBrains Mono', monospace;
    font-size: 15px;
}
</style>
