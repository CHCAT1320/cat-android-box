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
    }
  ],
});

router.afterEach((to) => {
  const title = to.meta.title as string | undefined;
  document.title = title ? `${title} - Cat Android Box` : "Cat Android Box";
});

export default router;
