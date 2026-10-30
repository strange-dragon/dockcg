import { currentLocale, SUPPORTED_LOCALES } from "../i18n";
import { setPageLocale } from "../util-frontend";
import { defineComponent } from "vue";
export default defineComponent({
    data() {
        return {
            language: currentLocale(),
        };
    },

    watch: {
        language(lang) {
            this.changeLang(lang);
        },
    },

    created() {
        if (this.language !== "en") {
            this.changeLang(this.language);
        }
    },

    methods: {
        /**
         * Change the application language
         * @param {string} lang Language code to switch to
         * @returns {void}
         */
        changeLang(lang : string) {
            const target = SUPPORTED_LOCALES.includes(lang) ? lang : "en";
            this.$i18n.locale = target;
            localStorage.locale = target;
            setPageLocale();
        }
    }
});
