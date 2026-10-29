import { currentLocale, SUPPORTED_LOCALES } from "../i18n";
import { setPageLocale } from "../util-frontend";
import { defineComponent } from "vue";
// Dockcg only ships English + Simplified Chinese, so only these two language
// packs are bundled. The other upstream translations stay in the repo but are
// never imported.
const langModules = import.meta.glob([ "../lang/en.json", "../lang/zh-CN.json" ]);

export default defineComponent({
    data() {
        return {
            language: currentLocale(),
        };
    },

    watch: {
        async language(lang) {
            await this.changeLang(lang);
        },
    },

    async created() {
        if (this.language !== "en") {
            await this.changeLang(this.language);
        }
    },

    methods: {
        /**
         * Change the application language
         * @param {string} lang Language code to switch to
         * @returns {Promise<void>}
         */
        async changeLang(lang : string) {
            const target = SUPPORTED_LOCALES.includes(lang) ? lang : "en";
            const loader = langModules["../lang/" + target + ".json"];

            if (!loader) {
                return;
            }

            const message = (await loader()).default;
            this.$i18n.setLocaleMessage(target, message);
            this.$i18n.locale = target;
            localStorage.locale = target;
            setPageLocale();
        }
    }
});
