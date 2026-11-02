<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useConnectedDevice } from "../composables/useConnectedDevice";
import {
  clearPackageData,
  forceStopPackage,
  getAppMetadata,
  getPackageDetails,
  installApk,
  installPackage,
  joinLocalPath,
  listPackages,
  pickDirectory,
  pickFile,
  pullFile,
  runningInTauri,
  setPackageEnabled,
  uninstallPackage,
  type AppEntry,
  type AppMetadata,
} from "../services/adb";
import { describePermission } from "../services/permissions";
import { settings } from "../services/settings";

const { serial, onlineDevices, mode, modeLabel, connected, select } =
  useConnectedDevice();

const apps = ref<AppEntry[]>([]);
const appsLoading = ref(false);
const keyword = ref("");
const filter = ref<"all" | "user" | "system">("all");
const message = ref("");
const error = ref("");
const working = ref<string | null>(null);
const metadata = ref<Record<string, AppMetadata>>({});
const batchProgress = ref({ done: 0, total: 0 });
const detailApp = ref<AppEntry | null>(null);
const detailText = ref("");
const detailLoading = ref(false);
const detailError = ref("");
const detailTab = ref<"info" | "permissions">("info");
const detailOpen = ref(false);
const detailWorking = ref(false);
let unlistenDrag: (() => void) | null = null;

const detailInfo = computed(() => {
  const text = detailText.value;
  const field = (pattern: RegExp) => text.match(pattern)?.[1] ?? "-";
  const permissions = new Map<string, boolean>();
  for (const match of text.matchAll(
    /^\s+(android\.permission\.[\w.]+): granted=(true|false)/gm,
  )) {
    permissions.set(match[1], match[2] === "true");
  }
  for (const match of text.matchAll(
    /^\s+(android\.permission\.[\w.]+)\s*$/gm,
  )) {
    if (!permissions.has(match[1])) {
      permissions.set(match[1], false);
    }
  }
  return {
    versionName: field(/versionName=(\S+)/),
    versionCode: field(/versionCode=(\d+)/),
    minSdk: field(/minSdk=(\d+)/),
    targetSdk: field(/targetSdk=(\d+)/),
    dataDir: field(/dataDir=(\S+)/),
    uid: field(/userId=(\d+)/),
    permissions: [...permissions.entries()],
  };
});

const metadataLoading = new Set<string>();
const metadataQueue: string[] = [];
let pumpingMetadata = false;
const rowElements = new Map<string, Element>();
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        continue;
      }
      const packageName = (entry.target as HTMLElement).dataset.package;
      if (packageName) {
        loadMetadata(packageName);
      }
    }
  },
  { rootMargin: "240px" },
);

function setRowRef(packageName: string, el: unknown) {
  const previous = rowElements.get(packageName);
  if (previous === el) {
    return;
  }
  if (previous) {
    observer.unobserve(previous);
    rowElements.delete(packageName);
  }
  if (el instanceof HTMLElement) {
    el.dataset.package = packageName;
    rowElements.set(packageName, el);
    observer.observe(el);
  }
}

function loadMetadata(packageName: string) {
  if (
    !serial.value ||
    metadata.value[packageName] ||
    metadataLoading.has(packageName)
  ) {
    return;
  }
  metadataLoading.add(packageName);
  metadataQueue.push(packageName);
  void pumpMetadataQueue();
}

// 最多同时读取 3 个应用，避免大量 adb 进程拖慢设备
async function pumpMetadataQueue() {
  if (pumpingMetadata) {
    return;
  }
  pumpingMetadata = true;
  try {
    while (metadataQueue.length > 0) {
      const batch = metadataQueue
        .splice(0, 3)
        .map((packageName) => fetchMetadata(packageName));
      await Promise.all(batch);
    }
  } finally {
    pumpingMetadata = false;
  }
}

async function fetchMetadata(packageName: string) {
  const target = serial.value;
  const app = apps.value.find((item) => item.packageName === packageName);
  if (!target || !app) {
    metadataLoading.delete(packageName);
    return;
  }
  try {
    const data = await getAppMetadata(target, app.apkPath);
    if (serial.value === target) {
      metadata.value = { ...metadata.value, [packageName]: data };
    }
  } catch {
    // 读取失败时保留包名和占位图标
  } finally {
    metadataLoading.delete(packageName);
  }
}

function appMeta(packageName: string) {
  return metadata.value[packageName];
}

function iconStyle(packageName: string) {
  const background = metadata.value[packageName]?.iconBackground;
  if (background && /^#[0-9a-f]{3,8}$/i.test(background)) {
    return { backgroundColor: background };
  }
  return {};
}

function fallbackLetter(packageName: string) {
  const last = packageName.split(".").pop() || packageName;
  return last.charAt(0).toUpperCase();
}

onBeforeUnmount(() => {
  observer.disconnect();
  if (unlistenDrag) {
    unlistenDrag();
    unlistenDrag = null;
  }
});

const filteredApps = computed(() => {
  const term = keyword.value.trim().toLowerCase();
  return apps.value.filter((app) => {
    if (filter.value === "user" && app.system) {
      return false;
    }
    if (filter.value === "system" && !app.system) {
      return false;
    }
    if (term === "") {
      return true;
    }
    const label = metadata.value[app.packageName]?.label ?? "";
    return (
      app.packageName.toLowerCase().includes(term) ||
      label.toLowerCase().includes(term)
    );
  });
});

async function reload() {
  const target = serial.value;
  if (!target || !connected.value) {
    apps.value = [];
    return;
  }
  appsLoading.value = true;
  error.value = "";
  try {
    apps.value = await listPackages(target);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "读取应用列表失败";
  } finally {
    appsLoading.value = false;
  }
}

watch(
  () => [serial.value, connected.value] as const,
  () => {
    void reload();
  },
);

watch(serial, (next, previous) => {
  if (next !== previous) {
    metadata.value = {};
    metadataLoading.clear();
    metadataQueue.length = 0;
  }
});

async function installOne(target: string, path: string) {
  if (/\.apk$/i.test(path)) {
    return installApk(target, path);
  }
  return installPackage(target, path);
}

async function installPath(path: string) {
  const target = serial.value;
  if (!target) {
    error.value = "没有可用设备";
    return;
  }
  message.value = "安装中...";
  error.value = "";
  try {
    message.value = await installOne(target, path);
    await reload();
  } catch (caught) {
    message.value = "";
    error.value = caught instanceof Error ? caught.message : "安装失败";
  }
}

async function handleInstall() {
  const path = await pickFile("选择安装包", ["apk", "apks", "xapk", "zip"]);
  if (path) {
    await installPath(path);
  }
}

async function batchInstall() {
  if (onlineDevices.value.length === 0) {
    return;
  }
  const path = await pickFile("选择安装包", ["apk", "apks", "xapk", "zip"]);
  if (!path) {
    return;
  }
  const lines: string[] = [];
  error.value = "";
  const total = onlineDevices.value.length;
  batchProgress.value = { done: 0, total };
  for (const device of onlineDevices.value) {
    try {
      const output = await installOne(device.serial, path);
      lines.push(`${device.serial}: ${output}`);
    } catch (caught) {
      lines.push(
        `${device.serial}: ${caught instanceof Error ? caught.message : "失败"}`,
      );
    }
    batchProgress.value.done += 1;
  }
  batchProgress.value = { done: 0, total: 0 };
  message.value = lines.join("\n");
  await reload();
}

async function openDetails(app: AppEntry) {
  const target = serial.value;
  if (!target) {
    return;
  }
  detailApp.value = app;
  detailText.value = "";
  detailError.value = "";
  detailTab.value = "info";
  detailOpen.value = true;
  detailLoading.value = true;
  try {
    detailText.value = await getPackageDetails(target, app.packageName);
  } catch (caught) {
    detailError.value =
      caught instanceof Error ? caught.message : "读取应用详情失败";
  } finally {
    detailLoading.value = false;
  }
}

function closeDetails() {
  detailOpen.value = false;
  detailApp.value = null;
  detailText.value = "";
}

async function clearData() {
  const target = serial.value;
  const app = detailApp.value;
  if (!target || !app) {
    return;
  }
  if (!window.confirm(`确定清除 ${app.packageName} 的全部数据吗？`)) {
    return;
  }
  detailWorking.value = true;
  detailError.value = "";
  try {
    message.value = await clearPackageData(target, app.packageName);
  } catch (caught) {
    detailError.value =
      caught instanceof Error ? caught.message : "清除数据失败";
  } finally {
    detailWorking.value = false;
  }
}

async function forceStop() {
  const target = serial.value;
  const app = detailApp.value;
  if (!target || !app) {
    return;
  }
  detailWorking.value = true;
  detailError.value = "";
  try {
    message.value = await forceStopPackage(target, app.packageName);
  } catch (caught) {
    detailError.value =
      caught instanceof Error ? caught.message : "强制停止失败";
  } finally {
    detailWorking.value = false;
  }
}

onMounted(async () => {
  if (!runningInTauri) {
    return;
  }
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    unlistenDrag = await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") {
        return;
      }
      const path = event.payload.paths.find((item) =>
        /\.(apk|apks|xapk|zip)$/i.test(item),
      );
      if (path) {
        void installPath(path);
      }
    });
  } catch {
    // 忽略拖拽监听失败
  }
});

async function toggleApp(app: AppEntry) {
  const target = serial.value;
  if (!target) {
    return;
  }
  const action = app.disabled ? "启用" : "停用";
  if (!window.confirm(`确定要${action} ${app.packageName} 吗？`)) {
    return;
  }
  working.value = app.packageName;
  error.value = "";
  try {
    message.value = await setPackageEnabled(target, app.packageName, app.disabled);
    await reload();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : `${action}失败`;
  } finally {
    working.value = null;
  }
}

async function removeApp(app: AppEntry) {
  const target = serial.value;
  if (!target) {
    return;
  }
  const hint = app.system ? "（仅对当前用户卸载）" : "";
  if (!window.confirm(`确定要卸载 ${app.packageName}${hint} 吗？`)) {
    return;
  }
  working.value = app.packageName;
  error.value = "";
  try {
    message.value = await uninstallPackage(target, app);
    await reload();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "卸载失败";
  } finally {
    working.value = null;
  }
}

async function exportApk(app: AppEntry) {
  const target = serial.value;
  if (!target) {
    return;
  }
  let directory = settings.downloadDirectory;
  if (directory.trim() === "") {
    const picked = await pickDirectory("选择 APK 导出目录");
    if (!picked) {
      return;
    }
    directory = picked;
  }
  working.value = app.packageName;
  error.value = "";
  try {
    const localPath = joinLocalPath(directory, `${app.packageName}.apk`);
    message.value = await pullFile(target, app.apkPath, localPath);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "导出失败";
  } finally {
    working.value = null;
  }
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h1>应用管理</h1>
        <p v-if="mode === 'fastboot'" class="muted">
          设备处于 FastBoot 模式，应用管理需要先进入系统。
          <RouterLink class="device-link" to="/devices">前往当前设备</RouterLink>
        </p>
        <p v-else-if="!connected" class="muted">
          请连接并授权设备，当前状态：{{ modeLabel }}
        </p>
        <p v-else class="muted">
          当前设备：<span class="serial">{{ serial }}</span>
        </p>
      </div>
      <select
        v-if="onlineDevices.length > 1"
        class="device-select"
        :value="serial ?? ''"
        @change="select(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="device in onlineDevices" :key="device.serial" :value="device.serial">
          {{ device.serial }}
        </option>
      </select>
    </header>

    <div class="toolbar">
      <input v-model="keyword" class="search" placeholder="搜索名称或包名" />
      <select v-model="filter" class="filter">
        <option value="all">全部 ({{ apps.length }})</option>
        <option value="user">用户应用</option>
        <option value="system">系统应用</option>
      </select>
      <button :disabled="!connected || appsLoading" @click="reload">刷新</button>
      <button :disabled="!connected" @click="handleInstall">
        安装包（APK/APKS/XAPK）
      </button>
      <button :disabled="onlineDevices.length === 0" @click="batchInstall">
        批量安装
      </button>
    </div>

    <p v-if="batchProgress.total > 0" class="muted">
      批量安装进度：{{ batchProgress.done }} / {{ batchProgress.total }}
    </p>

    <p v-if="appsLoading" class="muted">读取中...</p>
    <p v-if="error" class="message error">{{ error }}</p>
    <pre v-if="message" class="message output">{{ message }}</pre>

    <div v-if="connected" class="app-list">
      <p v-if="filteredApps.length === 0 && !appsLoading" class="muted empty">
        没有匹配的应用
      </p>
      <div
        v-for="app in filteredApps"
        :key="app.packageName"
        :ref="(el) => setRowRef(app.packageName, el)"
        class="app-row"
      >
        <div class="app-icon" :style="iconStyle(app.packageName)">
          <img
            v-if="appMeta(app.packageName)?.icon"
            :src="appMeta(app.packageName)?.icon ?? ''"
            alt=""
          />
          <span v-else>{{ fallbackLetter(app.packageName) }}</span>
        </div>
        <div class="app-main">
          <span class="app-name">
            {{ appMeta(app.packageName)?.label || app.packageName }}
          </span>
          <span class="app-path">{{ app.packageName }}</span>
        </div>
        <span class="tag">{{ app.system ? "系统" : "用户" }}</span>
        <span v-if="app.disabled" class="tag warn">已停用</span>
        <div class="app-actions">
          <button :disabled="working !== null" @click="openDetails(app)">
            详情
          </button>
          <button
            :disabled="working !== null"
            @click="exportApk(app)"
          >
            导出
          </button>
          <button :disabled="working !== null" @click="toggleApp(app)">
            {{ app.disabled ? "启用" : "停用" }}
          </button>
          <button
            class="danger"
            :disabled="working !== null"
            @click="removeApp(app)"
          >
            卸载
          </button>
        </div>
      </div>
    </div>
    <p v-else class="muted empty">
      {{
        mode === "fastboot"
          ? "设备处于 FastBoot 模式，无法读取应用列表。"
          : "连接设备后可以管理应用。"
      }}
    </p>

    <div v-if="detailOpen" class="dialog-mask" @click.self="closeDetails">
      <div class="dialog" role="dialog" aria-modal="true">
        <h2>{{ detailApp?.packageName }}</h2>
        <div class="detail-tabs">
          <button
            :class="{ active: detailTab === 'info' }"
            @click="detailTab = 'info'"
          >
            信息
          </button>
          <button
            :class="{ active: detailTab === 'permissions' }"
            @click="detailTab = 'permissions'"
          >
            权限（{{ detailInfo.permissions.length }}）
          </button>
        </div>
        <p v-if="detailLoading" class="muted">读取中...</p>
        <p v-if="detailError" class="dialog-error">{{ detailError }}</p>
        <p v-if="detailTab === 'permissions'" class="perm-note">
          权限说明仅供参考，具体以系统实际行为为准。
        </p>
        <div v-if="detailTab === 'info'" class="detail-info">
          <p>
            <span>版本</span>
            {{ detailInfo.versionName }} ({{ detailInfo.versionCode }})
          </p>
          <p>
            <span>SDK</span>
            min {{ detailInfo.minSdk }} / target {{ detailInfo.targetSdk }}
          </p>
          <p><span>UID</span>{{ detailInfo.uid }}</p>
          <p><span>数据目录</span>{{ detailInfo.dataDir }}</p>
        </div>
        <div v-else class="detail-permissions">
          <p v-if="detailInfo.permissions.length === 0">
            没有读取到权限信息
          </p>
          <p
            v-for="[name, granted] in detailInfo.permissions"
            :key="name"
            class="perm-row"
          >
            <span class="perm-main">
              <span class="perm-name">{{ name }}</span>
              <span class="perm-desc">
                {{ describePermission(name) }}
              </span>
            </span>
            <span class="perm-state" :class="{ granted }">
              {{ granted ? "已授予" : "未授予" }}
            </span>
          </p>
        </div>
        <div class="dialog-actions">
          <button
            class="dialog-cancel"
            :disabled="detailWorking"
            @click="forceStop"
          >
            强制停止
          </button>
          <button
            class="dialog-cancel"
            :disabled="detailWorking"
            @click="clearData"
          >
            清除数据
          </button>
          <button class="dialog-confirm" @click="closeDetails">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
  .page {
    padding-top: 24px;
  }
  .page-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }
  h1 {
    margin: 0;
    color: var(--accent);
    font-size: 22px;
  }
  .muted {
    margin: 6px 0 0;
    color: #6b7280;
    font-size: 13px;
  }
  .serial {
    color: var(--accent);
  }
  .device-link {
    color: var(--accent);
  }
  .device-select {
    padding: 8px 10px;
    border: 1px solid #d1d5db;
    background: #fff;
    font-family: inherit;
    font-size: 13px;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
    padding: 12px;
    border: 1px solid #e5e7eb;
    background: #fff;
  }
  .search {
    flex: 1;
    min-width: 200px;
    padding: 8px 10px;
    border: 1px solid #d1d5db;
    font-family: inherit;
    font-size: 13px;
  }
  .filter {
    padding: 8px 10px;
    border: 1px solid #d1d5db;
    background: #fff;
    font-family: inherit;
    font-size: 13px;
  }
  .toolbar button {
    padding: 8px 14px;
    border: 1px solid var(--accent);
    background: #fff;
    color: var(--accent);
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .toolbar button:hover:not(:disabled) {
    background: rgba(59, 130, 246, 0.08);
  }
  .toolbar button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .message {
    margin: 12px 0 0;
    padding: 10px 12px;
    border: 1px solid #e5e7eb;
    background: #f9fafb;
    font-family: Consolas, monospace;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .message.error {
    color: #dc2626;
    border-color: #fecaca;
    background: #fef2f2;
  }
  .output {
    max-height: 180px;
    overflow: auto;
  }
  .app-list {
    margin-top: 14px;
    border: 1px solid #e5e7eb;
    background: #fff;
  }
  .app-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid #f3f4f6;
  }
  .app-row:last-child {
    border-bottom: none;
  }
  .app-icon {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    overflow: hidden;
    border: 1px solid #e5e7eb;
    background: #f3f4f6;
    color: #6b7280;
    font-size: 15px;
    font-weight: 600;
  }
  .app-icon img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .app-main {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .app-name {
    color: #1f2937;
    font-size: 14px;
    word-break: break-all;
  }
  .app-path {
    color: #9ca3af;
    font-size: 11px;
    word-break: break-all;
  }
  .tag {
    flex: none;
    padding: 2px 6px;
    border: 1px solid #e5e7eb;
    color: #6b7280;
    font-size: 11px;
  }
  .tag.warn {
    color: #b45309;
    border-color: #fde68a;
    background: #fffbeb;
  }
  .app-actions {
    display: flex;
    flex: none;
    gap: 6px;
  }
  .app-actions button {
    padding: 5px 10px;
    border: 1px solid #d1d5db;
    background: #fff;
    color: #374151;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .app-actions button:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .app-actions button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .app-actions .danger {
    color: #dc2626;
  }
  .app-actions .danger:hover:not(:disabled) {
    border-color: #dc2626;
    color: #dc2626;
  }
  .empty {
    padding: 24px;
    text-align: center;
  }
  .dialog-mask {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(15, 23, 42, 0.45);
  }
  .dialog {
    box-sizing: border-box;
    width: min(720px, calc(100% - 32px));
    max-height: 82vh;
    padding: 22px 24px;
    overflow-y: auto;
    background: #fff;
    box-shadow: 0 20px 50px rgba(15, 23, 42, 0.3);
    text-align: center;
  }
  .dialog h2 {
    margin: 0;
    color: var(--accent);
    font-size: 17px;
    word-break: break-all;
  }
  .dialog-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    margin-top: 16px;
  }
  .dialog-actions button {
    min-width: 96px;
    padding: 8px 16px;
    border: 1px solid var(--accent);
    background: #fff;
    color: var(--accent);
    font-family: inherit;
    font-size: 14px;
    cursor: pointer;
  }
  .dialog-actions button:hover:not(:disabled) {
    background: rgba(59, 130, 246, 0.08);
  }
  .dialog-actions button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .dialog-confirm {
    background: var(--accent);
    color: #fff;
  }
  .dialog-error {
    margin: 10px 0 0;
    color: #dc2626;
    font-size: 13px;
    text-align: left;
    word-break: break-all;
  }
  .detail-tabs {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin: 12px 0;
  }
  .detail-tabs button {
    padding: 5px 14px;
    border: 1px solid #d1d5db;
    background: #fff;
    color: #374151;
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .detail-tabs button.active {
    border-color: var(--accent);
    color: var(--accent);
  }
  .detail-info p,
  .detail-permissions p {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    margin: 6px 0;
    color: #1f2937;
    font-size: 13px;
    text-align: left;
    line-height: 1.5;
  }
  .detail-info span {
    flex: none;
    width: 80px;
    color: #6b7280;
  }
  .detail-permissions {
    max-height: 300px;
    padding: 8px 12px;
    overflow-y: auto;
    border: 1px solid #e5e7eb;
    text-align: left;
  }
  .perm-name {
    word-break: break-all;
  }
  .perm-note {
    margin: 0 0 8px;
    color: #6b7280;
    font-size: 12px;
    text-align: center;
  }
  .perm-row {
    align-items: flex-start;
  }
  .perm-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .perm-desc {
    color: #6b7280;
    font-size: 12px;
    line-height: 1.4;
  }
  .perm-state {
    flex: none;
    color: #b45309;
  }
  .perm-state.granted {
    color: #166534;
  }
</style>
