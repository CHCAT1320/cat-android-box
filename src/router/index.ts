import { createRouter, createWebHashHistory } from "vue-router";
import HomeView from "../views/HomeView.vue";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: HomeView,
      meta: { title: "首页" },
    },
    {
      path: "/devices",
      name: "devices",
      component: () => import("../views/DevicesView.vue"),
      meta: { title: "当前设备" },
    },
    {
      path: "/apps",
      name: "apps",
      component: () => import("../views/AppsView.vue"),
      meta: { title: "应用管理" },
    },
    {
      path: "/files",
      name: "files",
      component: () => import("../views/FilesView.vue"),
      meta: { title: "文件管理" },
    },
    {
      path: "/logs",
      name: "logs",
      component: () => import("../views/LogsView.vue"),
      meta: { title: "日志" },
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("../views/SettingsView.vue"),
      meta: { title: "设置" },
    },
  ],
});

router.afterEach((to) => {
  const title = to.meta.title as string | undefined;
  document.title = title ? `${title} - Cat Android Box` : "Cat Android Box";
});

export default router;
