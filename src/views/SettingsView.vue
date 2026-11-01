<script setup lang="ts">
import { ref } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getDeviceStatus, getToolVersions, pickDirectory, restartAdb } from "../services/adb";
import { ACCENT_COLORS, settings } from "../services/settings";
import { version } from "../../package.json";

const checkingEnv = ref(false);
const envAdb = ref("");
const envFastboot = ref("");
const envDevices = ref("");
const envError = ref("");
const restartingAdb = ref(false);
const adbMessage = ref("");

async function restartAdbService() {
  restartingAdb.value = true;
  envError.value = "";
  adbMessage.value = "";
  try {
    adbMessage.value = await restartAdb();
    await checkEnvironment();
  } catch (caught) {
    envError.value =
      caught instanceof Error ? caught.message : "重启 ADB 失败";
  } finally {
    restartingAdb.value = false;
  }
}

const updateState = ref<"idle" | "checking" | "current" | "found" | "error">(
  "idle",
);
const updateMessage = ref("");

const GITHUB_RELEASES =
  "https://github.com/CHCAT1320/cat-android-box/releases";

async function chooseDirectory() {
  const picked = await pickDirectory("选择默认下载目录");
  if (picked) {
    settings.downloadDirectory = picked;
  }
}

function chooseAccent(value: string) {
  settings.accent = value;
}

async function checkEnvironment() {
  checkingEnv.value = true;
  envError.value = "";
  try {
    const [versions, status] = await Promise.all([
      getToolVersions(),
      getDeviceStatus(null),
    ]);
    envAdb.value = versions.adb;
    envFastboot.value = versions.fastboot;
    const online = status.devices.filter(
      (device) => device.state === "device",
    ).length;
    envDevices.value = `${online} 台在线 / ${status.devices.length} 台可见`;
  } catch (caught) {
    envError.value =
      caught instanceof Error ? caught.message : "环境检测失败";
  } finally {
    checkingEnv.value = false;
  }
}

async function checkUpdate() {
  updateState.value = "checking";
  updateMessage.value = "";
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) {
      updateState.value = "found";
      updateMessage.value = `发现新版本 ${update.version}，正在下载并安装...`;
      await update.downloadAndInstall();
      updateState.value = "found";
      updateMessage.value = `新版本 ${update.version} 已安装，请重新启动应用。`;
    } else {
      updateState.value = "current";
      updateMessage.value = `当前已是最新版本 v${version}。`;
    }
  } catch (caught) {
    updateState.value = "error";
    const detail =
      typeof caught === "string"
        ? caught
        : caught instanceof Error
          ? caught.message
          : String(caught ?? "未知错误");
    updateMessage.value =
      /404|valid release JSON|not found|failed to fetch/i.test(detail)
        ? "当前没有可用的已发布更新（latest.json 不存在），请先发布 GitHub Release。"
        : `检查更新失败：${detail}`;
  }
}

async function openReleases() {
  try {
    await openUrl(GITHUB_RELEASES);
  } catch {
    window.open(GITHUB_RELEASES, "_blank", "noopener,noreferrer");
  }
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <h1>设置</h1>
      <p class="muted">v{{ version }}</p>
    </header>

    <div class="card">
      <h2>外观</h2>
      <p class="hint">选择主题色，修改后会立即生效并保存。</p>
      <div class="colors">
        <button
          v-for="color in ACCENT_COLORS"
          :key="color.value"
          class="color-chip"
          :class="{ active: settings.accent === color.value }"
          :style="{ background: color.value }"
          :title="color.name"
          @click="chooseAccent(color.value)"
        />
        <button
          class="color-random"
          :class="{ active: settings.accent === 'random' }"
          @click="chooseAccent('random')"
        >
          随机
        </button>
      </div>
    </div>

    <div class="card">
      <h2>默认下载目录</h2>
      <p class="hint">截图、APK 导出、文件下载和日志导出都会优先使用此目录。</p>
      <div class="row">
        <input
          v-model="settings.downloadDirectory"
          class="text-input"
          placeholder="未设置时每次询问"
        />
        <button @click="chooseDirectory">选择目录</button>
      </div>
    </div>

    <div class="card">
      <h2>环境自检</h2>
      <p class="hint">检查 adb / fastboot 是否可用，并统计当前设备。</p>
      <button :disabled="checkingEnv" @click="checkEnvironment">
        {{ checkingEnv ? "检测中..." : "开始检测" }}
      </button>
      <button
        class="secondary"
        :disabled="restartingAdb"
        @click="restartAdbService"
      >
        {{ restartingAdb ? "重启中..." : "重启 ADB 服务" }}
      </button>
      <p v-if="envError" class="error">{{ envError }}</p>
      <p v-if="adbMessage" class="adb-message">{{ adbMessage }}</p>
      <div v-if="envAdb || envFastboot" class="env-result">
        <p><span>adb</span>{{ envAdb }}</p>
        <p><span>fastboot</span>{{ envFastboot }}</p>
        <p><span>设备</span>{{ envDevices }}</p>
      </div>
    </div>

    <div class="card">
      <h2>关于与更新</h2>
      <p class="hint">
        当前版本 v{{ version }}。自动更新需要已发布的 GitHub Release，并且其中包含
        latest.json 和签名文件。
      </p>
      <div class="row">
        <button :disabled="updateState === 'checking'" @click="checkUpdate">
          {{ updateState === "checking" ? "检查中..." : "检查更新" }}
        </button>
        <button class="secondary" @click="openReleases">打开发布页</button>
      </div>
      <p
        v-if="updateMessage"
        class="update-message"
        :class="{ error: updateState === 'error' }"
      >
        {{ updateMessage }}
      </p>
    </div>
  </section>
</template>

<style scoped>
  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: 24px 0 48px;
  }
  .page-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }
  h1 {
    margin: 0;
    color: var(--accent);
    font-size: 22px;
  }
  .muted {
    margin: 0;
    color: #6b7280;
    font-size: 13px;
  }
  .card {
    margin-top: 16px;
    padding: 16px 20px;
    border: 1px solid #e5e7eb;
    background: #fff;
  }
  h2 {
    margin: 0 0 6px;
    color: var(--accent);
    font-size: 15px;
  }
  .hint {
    margin: 0 0 12px;
    color: #6b7280;
    font-size: 13px;
    line-height: 1.6;
  }
  .colors {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .color-chip {
    width: 30px;
    height: 30px;
    border: 2px solid transparent;
    cursor: pointer;
  }
  .color-chip.active {
    border-color: #1f2937;
  }
  .color-random {
    padding: 6px 12px;
    border: 1px solid #d1d5db;
    background: #fff;
    color: #374151;
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .color-random.active {
    border-color: var(--accent);
    color: var(--accent);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .text-input {
    flex: 1;
    min-width: 240px;
    padding: 8px 10px;
    border: 1px solid #d1d5db;
    font-family: inherit;
    font-size: 13px;
  }
  .row button,
  .card > button {
    padding: 8px 14px;
    border: 1px solid var(--accent);
    background: #fff;
    color: var(--accent);
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .row button:hover:not(:disabled),
  .card > button:hover:not(:disabled) {
    background: rgba(59, 130, 246, 0.08);
  }
  .card > button + button {
    margin-left: 8px;
  }
  .row button:disabled,
  .card > button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .secondary {
    border-color: #d1d5db !important;
    color: #374151 !important;
  }
  .adb-message {
    margin: 10px 0 0;
    color: #166534;
    font-size: 13px;
  }
  .env-result {
    margin-top: 12px;
    padding: 10px 12px;
    border: 1px solid #e5e7eb;
    background: #f9fafb;
  }
  .env-result p {
    margin: 4px 0;
    color: #374151;
    font-family: Consolas, monospace;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .env-result span {
    display: inline-block;
    min-width: 72px;
    color: #6b7280;
  }
  .error {
    margin: 10px 0 0;
    color: #dc2626;
    font-size: 13px;
  }
  .update-message {
    margin: 10px 0 0;
    color: #166534;
    font-size: 13px;
  }
  .update-message.error {
    color: #dc2626;
  }
</style>
