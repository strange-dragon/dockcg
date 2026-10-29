import { createRouter, createWebHistory } from "vue-router";

import Layout from "./layouts/Layout.vue";
import Setup from "./pages/Setup.vue";
import Dashboard from "./pages/Dashboard.vue";
import DashboardHome from "./pages/DashboardHome.vue";
import Console from "./pages/Console.vue";
import Compose from "./pages/Compose.vue";
import ContainerTerminal from "./pages/ContainerTerminal.vue";

const Settings = () => import("./pages/Settings.vue");

// Resources - detail pages (the list itself lives in the sidebar)
const ImageDetail = () => import("./components/resources/ImageDetail.vue");
const VolumeDetail = () => import("./components/resources/VolumeDetail.vue");
const NetworkDetail = () => import("./components/resources/NetworkDetail.vue");
const ResourcesRegistries = () => import("./components/settings/Registries.vue");

// Settings - Sub Pages
import Appearance from "./components/settings/Appearance.vue";
import General from "./components/settings/General.vue";
const Security = () => import("./components/settings/Security.vue");
const GlobalEnv = () => import("./components/settings/GlobalEnv.vue");
import About from "./components/settings/About.vue";

const routes = [
    {
        path: "/empty",
        component: Layout,
        children: [
            {
                path: "",
                component: Dashboard,
                children: [
                    {
                        name: "DashboardHome",
                        path: "/",
                        component: DashboardHome,
                        children: [
                            {
                                path: "/compose",
                                component: Compose,
                            },
                            {
                                path: "/compose/:stackName/:endpoint",
                                component: Compose,
                            },
                            {
                                path: "/compose/:stackName",
                                component: Compose,
                            },
                            {
                                path: "/terminal/:stackName/:serviceName/:type",
                                component: ContainerTerminal,
                                name: "containerTerminal",
                            },
                            {
                                path: "/terminal/:stackName/:serviceName/:type/:endpoint",
                                component: ContainerTerminal,
                                name: "containerTerminalEndpoint",
                            },
                        ]
                    },
                    {
                        path: "/console",
                        component: Console,
                    },
                    {
                        path: "/console/:endpoint",
                        component: Console,
                    },
                    {
                        path: "/resources",
                        redirect: "/resources/images",
                    },
                    {
                        path: "/resources/images",
                        component: ImageDetail,
                    },
                    {
                        path: "/resources/volumes",
                        component: VolumeDetail,
                    },
                    {
                        path: "/resources/networks",
                        component: NetworkDetail,
                    },
                    {
                        path: "/settings",
                        component: Settings,
                        children: [
                            {
                                path: "general",
                                component: General,
                            },
                            {
                                path: "appearance",
                                component: Appearance,
                            },
                            {
                                path: "security",
                                component: Security,
                            },
                            {
                                path: "globalEnv",
                                component: GlobalEnv,
                            },
                            {
                                path: "registries",
                                component: ResourcesRegistries,
                            },
                            {
                                path: "about",
                                component: About,
                            },
                        ]
                    },
                ]
            },
        ]
    },
    {
        path: "/setup",
        component: Setup,
    },
];

export const router = createRouter({
    linkActiveClass: "active",
    history: createWebHistory(),
    routes,
});
