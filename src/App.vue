<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";
const colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6"];
const accent = colors[Math.floor(Math.random() * colors.length)];
</script>

<template>
  <div class="app" :style="{ '--accent': accent }">
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">Cat Android Box</div>
        <nav class="nav">
          <RouterLink to="/">首页</RouterLink>
          <RouterLink to="/devices">当前设备</RouterLink>
        </nav>
      </div>
    </header>
    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<style>
body {
  margin: 0;
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
  display: flex;
  align-items: center;
  gap: 32px;
  height: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
}

.brand {
  font-weight: 600;
  white-space: nowrap;
  color: #fff;
}

.nav {
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

.nav a.router-link-exact-active::after {
  position: absolute;
  right: 12px;
  bottom: 0;
  left: 12px;
  height: 2px;
  background: #fff;
  content: "";
}

.content {
  flex: 1;
  box-sizing: border-box;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
}
</style>
