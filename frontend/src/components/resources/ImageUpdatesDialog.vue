<template>
    <div ref="modal" class="modal fade" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">{{ $t("imageUpdates") }}</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" />
                </div>
                <div class="modal-body">
                    <ImageUpdates
                        v-if="opened" ref="panel" :endpoint="endpoint" hide-title
                        @checked="$emit('checked', $event)" @updated="$emit('updated', $event)"
                    />
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { Modal } from "bootstrap";
import ImageUpdates from "./ImageUpdates.vue";

export default {
    components: {
        ImageUpdates,
    },

    props: {
        endpoint: {
            type: String,
            default: "",
        },
    },

    emits: [ "checked", "updated" ],

    data() {
        return {
            modal: null,
            /** The panel mounts on first open, so the check runs when it is actually seen */
            opened: false,
        };
    },

    mounted() {
        this.modal = new Modal(this.$refs.modal);
    },

    beforeUnmount() {
        this.modal?.dispose();
        this.modal = null;
    },

    methods: {
        show() {
            this.opened = true;
            this.$nextTick(() => this.modal?.show());
        },

        hide() {
            this.modal?.hide();
        },
    },
};
</script>
