<template>
    <div class="agents-settings">
        <div class="d-flex justify-content-end mb-3">
            <button v-if="!showAdd" class="btn btn-primary btn-sm" type="button" @click="showAdd = true">
                <font-awesome-icon icon="plus" class="me-1" /> {{ $t("addAgent") }}
            </button>
        </div>

        <form v-if="showAdd" class="mb-4" autocomplete="off" @submit.prevent="addAgent">
            <div class="row g-3">
                <div class="col-md-6">
                    <label class="form-label" for="agent-url">{{ $t("dockcgURL") }}</label>
                    <input id="agent-url" v-model="form.url" class="form-control" type="url" required placeholder="http://">
                </div>
                <div class="col-md-6">
                    <label class="form-label" for="agent-name">{{ $t("Friendly Name") }}</label>
                    <input id="agent-name" v-model="form.name" class="form-control">
                </div>
                <div class="col-md-6">
                    <label class="form-label" for="agent-username">{{ $t("Username") }}</label>
                    <input id="agent-username" v-model="form.username" class="form-control" required>
                </div>
                <div class="col-md-6">
                    <label class="form-label" for="agent-password">{{ $t("Password") }}</label>
                    <input id="agent-password" v-model="form.password" class="form-control" type="password" required autocomplete="new-password">
                </div>
            </div>
            <div class="d-flex gap-2 mt-3">
                <button class="btn btn-primary" type="submit" :disabled="saving">{{ $t("connect") }}</button>
                <button class="btn btn-normal" type="button" @click="showAdd = false">{{ $t("cancel") }}</button>
            </div>
        </form>

        <div v-for="(agent, endpoint) in $root.agentList" :key="endpoint" class="agent-row">
            <div class="agent-main">
                <span class="badge me-2" :class="$root.agentStatusList[endpoint] === 'online' ? 'bg-primary' : 'bg-secondary'">
                    {{ $root.agentStatusList[endpoint] === 'online' ? $t("agentOnline") : $t("agentOffline") }}
                </span>
                <strong>{{ agent.name || agent.url || $t("currentEndpoint") }}</strong>
                <div v-if="agent.name && agent.url" class="small text-muted">{{ agent.url }}</div>
            </div>
            <div v-if="endpoint !== ''" class="d-flex gap-1">
                <button class="btn btn-normal btn-sm" type="button" :aria-label="$t('Edit')" @click="editAgent(agent)">
                    <font-awesome-icon icon="pen" />
                </button>
                <button class="btn btn-outline-danger btn-sm" type="button" :aria-label="$t('removeAgent')" @click="askRemove(agent)">
                    <font-awesome-icon icon="trash" />
                </button>
            </div>
        </div>

        <BModal v-model="showEdit" :title="$t('Update Name')" :ok-title="$t('Update Name')" @ok="updateName">
            <label class="form-label" for="agent-updated-name">{{ $t("Friendly Name") }}</label>
            <input id="agent-updated-name" v-model="updatedName" class="form-control">
        </BModal>
        <BModal v-model="showRemove" :title="$t('removeAgent')" :ok-title="$t('removeAgent')" ok-variant="danger" @ok="removeAgent">
            {{ $t("removeAgentMsg") }} <strong>{{ selectedAgent?.name || selectedAgent?.url }}</strong>
        </BModal>
    </div>
</template>

<script>
export default {
    data() {
        return {
            showAdd: false,
            saving: false,
            showEdit: false,
            showRemove: false,
            selectedAgent: null,
            updatedName: "",
            form: { url: "http://",
                username: "",
                password: "",
                name: "" },
        };
    },
    methods: {
        addAgent() {
            this.saving = true;
            this.$root.getSocket().emit("addAgent", this.form, (res) => {
                this.saving = false;
                this.$root.toastRes(res);
                if (res?.ok) {
                    this.showAdd = false;
                    this.form = { url: "http://",
                        username: "",
                        password: "",
                        name: "" };
                }
            });
        },
        editAgent(agent) {
            this.selectedAgent = agent;
            this.updatedName = agent.name || "";
            this.showEdit = true;
        },
        updateName() {
            if (!this.selectedAgent) {
                return;
            }
            this.$root.getSocket().emit("updateAgent", this.selectedAgent.url, this.updatedName, (res) => {
                this.$root.toastRes(res);
            });
        },
        askRemove(agent) {
            this.selectedAgent = agent;
            this.showRemove = true;
        },
        removeAgent() {
            if (!this.selectedAgent) {
                return;
            }
            const url = this.selectedAgent.url;
            this.$root.getSocket().emit("removeAgent", url, (res) => {
                this.$root.toastRes(res);
                if (res?.ok) {
                    delete this.$root.allAgentStackList[new URL(url).host];
                }
            });
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../../styles/vars.scss";

.agent-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-top: 1px solid #dee2e6;

    .dark & {
        border-color: $dark-border-color;
    }
}

.agent-main {
    min-width: 0;
    overflow-wrap: anywhere;
}
</style>
