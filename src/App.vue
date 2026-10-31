<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";

const colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6"];
const accent = colors[Math.floor(Math.random() * colors.length)];

const route = useRoute();
const navRef = ref<HTMLElement | null>(null);
const indicator = ref({ left: 0, width: 0, ready: false });

// 根据当前激活的菜单项计算下划线位置，切换页面时平滑滑动
function updateIndicator() {
  const nav = navRef.value;
  if (!nav) {
    return;
  }
  const active = nav.querySelector<HTMLElement>(".router-link-exact-active");
  if (!active) {
    indicator.value = { left: 0, width: 0, ready: false };
    return;
  }
  const navRect = nav.getBoundingClientRect();
  const rect = active.getBoundingClientRect();
  indicator.value = {
    left: rect.left - navRect.left + 12,
    width: Math.max(rect.width - 24, 0),
    ready: true,
  };
}

watch(
  () => route.path,
  () => {
    nextTick(updateIndicator);
  },
);

onMounted(() => {
  nextTick(updateIndicator);
  window.addEventListener("resize", updateIndicator);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", updateIndicator);
});
</script>

<template>
  <div class="app" :style="{ '--accent': accent }">
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">Cat Android Box</div>
        <nav ref="navRef" class="nav">
          <RouterLink to="/">首页</RouterLink>
          <RouterLink to="/devices">当前设备</RouterLink>
          <span
            class="nav-indicator"
            aria-hidden="true"
            :style="{
              left: `${indicator.left}px`,
              width: `${indicator.width}px`,
              opacity: indicator.ready ? 1 : 0,
            }"
          ></span>
        </nav>
      </div>
    </header>
    <main class="content">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
  </div>
</template>

<style>
body {
  margin: 0;
  --page-gutter: clamp(16px, 2vw, 32px);
}

html {
  scrollbar-width: none;
}

html::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  height: 56px;
  background: var(--accent);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.45);
}

.topbar-inner {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 32px;
  height: 100%;
  width: 100%;
  margin: 0 auto;
  padding: 0 var(--page-gutter);
}

.brand {
  font-weight: 600;
  white-space: nowrap;
  color: #fff;
}

.nav {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 100%;
}

.nav a {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 100%;
  padding: 0 14px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 14px;
  text-decoration: none;
}

.nav a:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.15);
}

.nav a.router-link-exact-active {
  color: #fff;
}

.nav-indicator {
  position: absolute;
  bottom: 0;
  height: 2px;
  background: #fff;
  pointer-events: none;
  transition: left 0.25s ease, width 0.25s ease, opacity 0.2s ease;
}

.content {
  flex: 1;
  box-sizing: border-box;
  width: 100%;
  margin: 0 auto;
  padding: 0 var(--page-gutter);
}

.page-enter-active,
.page-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.page-enter-from {
  opacity: 0;
  transform: scale(0.995);
}

.page-leave-to {
  opacity: 0;
  transform: scale(0.995);
}
</style>
