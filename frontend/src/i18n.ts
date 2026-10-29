// @ts-ignore Performance issue when using "vue-i18n", so we use "vue-i18n/dist/vue-i18n.esm-browser.prod.js", but typescript doesn't like that.
import { createI18n } from "vue-i18n/dist/vue-i18n.esm-browser.prod.js";
import en from "./lang/en.json";

const languageList = {
    // Dockcg ships with two languages only; "en" comes from the static import above.
    "zh-CN": "简体中文",
};

/** Locales offered in the UI. English first = default. */
export const SUPPORTED_LOCALES = [ "en", "zh-CN" ];


let messages = {
    en,
};

for (let lang in languageList) {
    messages[lang] = {
        languageName: languageList[lang]
    };
}

const rtlLangs = [ "fa", "ar-SY", "ur", "ar" ];

export const currentLocale = () => {
    const saved = typeof localStorage !== "undefined" ? localStorage.locale : "";

    // Default to English: the browser language is deliberately ignored so a
    // fresh install always starts in English until the user picks 简体中文.
    return SUPPORTED_LOCALES.includes(saved) ? saved : "en";
};

export const localeDirection = () => {
    return rtlLangs.includes(currentLocale()) ? "rtl" : "ltr";
};

export const i18n = createI18n({
    locale: currentLocale(),
    fallbackLocale: "en",
    silentFallbackWarn: true,
    silentTranslationWarn: true,
    messages: messages,
});
