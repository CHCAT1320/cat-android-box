<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useConnectedDevice } from "../composables/useConnectedDevice";
import {
  checksumFile,
  compressPaths,
  copyRemotePath,
  createRemoteDirectory,
  deleteRemotePath,
  extractArchive,
  formatBytes,
  joinLocalPath,
  joinRemotePath,
  listDirectory,
  moveRemotePath,
  pickDirectory,
  pickFiles,
  pullFile,
  pushFiles,
  readDeviceFile,
  renameRemotePath,
  writeDeviceFile,
  type FileChecksums,
  type FileEntry,
} from "../services/adb";
import { settings } from "../services/settings";

const { serial, onlineDevices, mode, modeLabel, connected, select } =
  useConnectedDevice();

const path = ref("/sdcard");
const pathInput = ref("/sdcard");
const entries = ref<FileEntry[]>([]);
const listing = ref(false);
const message = ref("");
const error = ref("");
const working = ref<string | null>(null);
const selected = ref<Set<string>>(new Set());
const search = ref("");
const batchProgress = ref({ done: 0, total: 0 });
const bookmarks = ref<string[]>(loadBookmarks());
const previewOpen = ref(false);
const previewEntry = ref<FileEntry | null>(null);
const previewKind = ref<"image" | "text" | "none">("none");
const previewImage = ref("");
const previewText = ref("");
const previewLoading = ref(false);
const previewError = ref("");
const rootMode = ref(false);
const previewChecksums = ref<FileChecksums | null>(null);
const previewSaving = ref(false);

const BOOKMARK_KEY = "cat-android-box-file-bookmarks";

function loadBookmarks(): string[] {
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveBookmarks() {
  localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks.value));
}

const visibleEntries = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (term === "") {
    return entries.value;
  }
  return entries.value.filter((entry) =>
    entry.name.toLowerCase().includes(term),
  );
});

function toggleSelect(path: string) {
  if (selected.value.has(path)) {
    selected.value.delete(path);
  } else {
    selected.value.add(path);
  }
  selected.value = new Set(selected.value);
}

function toggleAll() {
  if (selected.value.size === visibleEntries.value.length) {
    selected.value = new Set();
  } else {
    selected.value = new Set(visibleEntries.value.map((entry) => entry.path));
  }
}

function selectedEntries() {
  return entries.value.filter((entry) => selected.value.has(entry.path));
}

const segments = computed(() => {
  const parts = path.value.split("/").filter((part) => part !== "");
  const result = [{ label: "根目录", path: "/" }];
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    result.push({ label: part, path: current });
  }
  return result;
});

async function reload() {
  const target = serial.value;
  if (!target || !connected.value) {
    entries.value = [];
    return;
  }
  listing.value = true;
  error.value = "";
  try {
    entries.value = await listDirectory(target, path.value, rootMode.value);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "读取目录失败";
    entries.value = [];
  } finally {
    listing.value = false;
  }
}

async function openPath(next: string) {
  path.value = next;
  pathInput.value = next;
  selected.value = new Set();
  await reload();
}

watch(
  () => [serial.value, connected.value] as const,
  () => {
    path.value = "/sdcard";
    pathInput.value = "/sdcard";
    void reload();
  },
);

watch(rootMode, () => {
  if (connected.value) {
    void reload();
  }
});

function goUp() {
  if (path.value === "/" || path.value === "") {
    return;
  }
  const parts = path.value.split("/").filter((part) => part !== "");
  parts.pop();
  void openPath(`/${parts.join("/")}`);
}

async function upload() {
  const target = serial.value;
  if (!target) {
    return;
  }
  const paths = await pickFiles("选择要上传的文件", []);
  if (!paths || paths.length === 0) {
    return;
  }
  working.value = "upload";
  error.value = "";
  try {
    message.value = await pushFiles(target, paths, path.value);
    await reload();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "上传失败";
  } finally {
    working.value = null;
  }
}

async function batchUpload() {
  if (onlineDevices.value.length === 0) {
    return;
  }
  const paths = await pickFiles("选择要上传的文件", []);
  if (!paths || paths.length === 0) {
    return;
  }
  const lines: string[] = [];
  error.value = "";
  for (const device of onlineDevices.value) {
    try {
      const output = await pushFiles(device.serial, paths, path.value);
      lines.push(`${device.serial}: ${output}`);
    } catch (caught) {
      lines.push(
        `${device.serial}: ${caught instanceof Error ? caught.message : "失败"}`,
      );
    }
  }
  message.value = lines.join("\n");
  await reload();
}

async function download(entry: FileEntry) {
  const target = serial.value;
  if (!target || entry.isDir) {
    return;
  }
  let directory = settings.downloadDirectory;
  if (directory.trim() === "") {
    const picked = await pickDirectory("选择下载目录");
    if (!picked) {
      return;
    }
    directory = picked;
  }
  working.value = entry.path;
  error.value = "";
  try {
    message.value = await pullFile(
      target,
      entry.path,
      joinLocalPath(directory, entry.name),
    );
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "下载失败";
  } finally {
    working.value = null;
  }
}

async function makeDirectory() {
  const target = serial.value;
  if (!target) {
    return;
  }
  const name = window.prompt("新建文件夹名称");
  if (!name || name.includes("/")) {
    return;
  }
  working.value = "mkdir";
  error.value = "";
  try {
    message.value = await createRemoteDirectory(
      target,
      joinRemotePath(path.value, name),
    );
    await reload();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "创建失败";
  } finally {
    working.value = null;
  }
}

async function rename(entry: FileEntry) {
  const target = serial.value;
  if (!target) {
    return;
  }
  const name = window.prompt("新的名称", entry.name);
  if (!name || name === entry.name || name.includes("/")) {
    return;
  }
  working.value = entry.path;
  error.value = "";
  try {
    message.value = await renameRemotePath(
      target,
      entry.path,
      joinRemotePath(path.value, name),
    );
    await reload();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "重命名失败";
  } finally {
    working.value = null;
  }
}

async function remove(entry: FileEntry) {
  const target = serial.value;
  if (!target) {
    return;
  }
  if (!window.confirm(`确定要删除 ${entry.name} 吗？文件夹会连同内容一起删除。`)) {
    return;
  }
  working.value = entry.path;
  error.value = "";
  try {
    message.value = await deleteRemotePath(target, entry.path);
    await reload();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "删除失败";
  } finally {
    working.value = null;
  }
}

function submitPath() {
  const next = pathInput.value.trim();
  if (next !== "") {
    void openPath(next.startsWith("/") ? next : `/${next}`);
  }
}

async function batchDelete() {
  const target = serial.value;
  const items = selectedEntries();
  if (!target || items.length === 0) {
    return;
  }
  if (
    !window.confirm(
      `确定删除选中的 ${items.length} 项吗？文件夹会连同内容一起删除。`,
    )
  ) {
    return;
  }
  batchProgress.value = { done: 0, total: items.length };
  error.value = "";
  try {
    for (const entry of items) {
      await deleteRemotePath(target, entry.path);
      batchProgress.value.done += 1;
    }
    message.value = `已删除 ${items.length} 项`;
    selected.value = new Set();
    await reload();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "批量删除失败";
  } finally {
    batchProgress.value = { done: 0, total: 0 };
  }
}

async function batchDownload() {
  const target = serial.value;
  const items = selectedEntries().filter((entry) => !entry.isDir);
  if (!target || items.length === 0) {
    return;
  }
  let directory = settings.downloadDirectory;
  if (directory.trim() === "") {
    const picked = await pickDirectory("选择批量下载目录");
    if (!picked) {
      return;
    }
    directory = picked;
  }
  batchProgress.value = { done: 0, total: items.length };
  error.value = "";
  try {
    for (const entry of items) {
      await pullFile(
        target,
        entry.path,
        joinLocalPath(directory, entry.name),
      );
      batchProgress.value.done += 1;
    }
    message.value = `已下载 ${items.length} 个文件到 ${directory}`;
    selected.value = new Set();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "批量下载失败";
  } finally {
    batchProgress.value = { done: 0, total: 0 };
  }
}

async function copyOrMove(mode: "copy" | "move") {
  const target = serial.value;
  const items = selectedEntries();
  if (!target || items.length === 0) {
    return;
  }
  const destination = window.prompt(
    mode === "copy" ? "复制到目录" : "移动到目录",
    path.value,
  );
  if (!destination) {
    return;
  }
  batchProgress.value = { done: 0, total: items.length };
  error.value = "";
  try {
    for (const entry of items) {
      const targetPath = joinRemotePath(destination, entry.name);
      if (mode === "copy") {
        await copyRemotePath(target, entry.path, targetPath);
      } else {
        await moveRemotePath(target, entry.path, targetPath);
      }
      batchProgress.value.done += 1;
    }
    message.value = `${mode === "copy" ? "已复制" : "已移动"} ${items.length} 项`;
    selected.value = new Set();
    await reload();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "操作失败";
  } finally {
    batchProgress.value = { done: 0, total: 0 };
  }
}

function addBookmark() {
  if (!bookmarks.value.includes(path.value)) {
    bookmarks.value = [...bookmarks.value, path.value];
    saveBookmarks();
  }
}

function clearBookmarks() {
  bookmarks.value = [];
  saveBookmarks();
}

async function archiveSelected() {
  const target = serial.value;
  const items = selectedEntries();
  if (!target || items.length === 0) {
    return;
  }
  const name = window.prompt(
    "压缩包名称",
    `backup-${Date.now()}.tar`,
  );
  if (!name || name.includes("/")) {
    return;
  }
  working.value = "archive";
  error.value = "";
  try {
    message.value = await compressPaths(
      target,
      items.map((entry) => entry.path),
      joinRemotePath(path.value, name),
      rootMode.value,
    );
    await reload();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "打包失败";
  } finally {
    working.value = null;
  }
}

async function openPreview(entry: FileEntry) {
  const target = serial.value;
  if (!target || entry.isDir) {
    return;
  }
  previewEntry.value = entry;
  previewOpen.value = true;
  previewKind.value = "none";
  previewImage.value = "";
  previewText.value = "";
  previewError.value = "";
  previewChecksums.value = null;
  previewLoading.value = true;
  try {
    const result = await readDeviceFile(
      target,
      entry.path,
      8 * 1024 * 1024,
      rootMode.value,
    );
    if (result.mime.startsWith("image/")) {
      previewKind.value = "image";
      previewImage.value = `data:${result.mime};base64,${result.data}`;
    } else {
      previewKind.value = "text";
      const bytes = Uint8Array.from(atob(result.data), (char) =>
        char.charCodeAt(0),
      );
      previewText.value = new TextDecoder().decode(bytes);
    }
  } catch (caught) {
    previewError.value =
      caught instanceof Error ? caught.message : "预览失败";
  } finally {
    previewLoading.value = false;
  }
}

function closePreview() {
  previewOpen.value = false;
  previewEntry.value = null;
  previewImage.value = "";
  previewText.value = "";
  previewKind.value = "none";
  previewChecksums.value = null;
}

async function loadPreviewChecksums() {
  const target = serial.value;
  const entry = previewEntry.value;
  if (!target || !entry) {
    return;
  }
  previewError.value = "";
  try {
    previewChecksums.value = await checksumFile(
      target,
      entry.path,
      rootMode.value,
    );
  } catch (caught) {
    previewError.value =
      caught instanceof Error ? caught.message : "校验失败";
  }
}

async function savePreviewFile() {
  const target = serial.value;
  const entry = previewEntry.value;
  if (!target || !entry || previewKind.value !== "text" || previewSaving.value) {
    return;
  }
  previewSaving.value = true;
  previewError.value = "";
  try {
    await writeDeviceFile(
      target,
      entry.path,
      previewText.value,
      rootMode.value,
    );
    message.value = `已保存：${entry.path}`;
  } catch (caught) {
    previewError.value =
      caught instanceof Error ? caught.message : "保存失败";
  } finally {
    previewSaving.value = false;
  }
}

async function extractFile(entry: FileEntry) {
  const target = serial.value;
  if (!target) {
    return;
  }
  const destination = joinRemotePath(
    path.value,
    entry.name.replace(/\.(zip|jar)$/i, "") || "extracted",
  );
  working.value = entry.path;
  error.value = "";
  try {
    message.value = await extractArchive(
      target,
      entry.path,
      destination,
      rootMode.value,
    );
    await reload();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "解压失败";
  } finally {
    working.value = null;
  }
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h1>文件管理</h1>
        <p v-if="mode === 'fastboot'" class="muted">
          设备处于 FastBoot 模式，文件管理需要先进入系统。
          <RouterLink class="device-link" to="/devices">前往当前设备</RouterLink>
        </p>
        <p v-else-if="!connected" class="muted">
          请连接并授权设备，当前状态：{{ modeLabel }}
        </p>
        <p v-else class="muted">当前设备：<span class="serial">{{ serial }}</span></p>
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
      <button :disabled="path === '/'" @click="goUp">上一级</button>
      <input
        v-model="pathInput"
        class="path-input"
        placeholder="/sdcard"
        @keyup.enter="submitPath"
      />
      <button @click="submitPath">前往</button>
      <button :disabled="!connected || listing" @click="reload">刷新</button>
      <button :disabled="!connected" @click="makeDirectory">新建文件夹</button>
      <button :disabled="!connected" @click="upload">上传文件</button>
      <button :disabled="onlineDevices.length === 0" @click="batchUpload">
        批量上传
      </button>
      <button
        :class="{ active: rootMode }"
        :disabled="!connected"
        @click="rootMode = !rootMode"
      >
        {{ rootMode ? "退出 Root 浏览" : "Root 浏览" }}
      </button>
    </div>

    <div class="toolbar">
      <input
        v-model="search"
        class="path-input"
        placeholder="搜索当前目录"
      />
      <button @click="toggleAll">
        {{
          selected.size > 0 && selected.size === visibleEntries.length
            ? "取消全选"
            : "全选"
        }}
      </button>
      <span class="selection-count">已选 {{ selected.size }} 项</span>
      <button
        :disabled="selected.size === 0"
        @click="batchDownload"
      >
        批量下载
      </button>
      <button :disabled="selected.size === 0" @click="copyOrMove('copy')">
        复制到
      </button>
      <button :disabled="selected.size === 0" @click="copyOrMove('move')">
        移动到
      </button>
      <button :disabled="selected.size === 0" @click="archiveSelected">
        打包为 tar
      </button>
      <button
        class="danger"
        :disabled="selected.size === 0"
        @click="batchDelete"
      >
        批量删除
      </button>
      <button @click="addBookmark">收藏当前目录</button>
    </div>

    <div v-if="bookmarks.length > 0" class="bookmarks">
      <span class="bookmark-label">书签：</span>
      <button
        v-for="mark in bookmarks"
        :key="mark"
        class="bookmark"
        @click="openPath(mark)"
      >
        {{ mark }}
      </button>
      <button class="bookmark-clear" @click="clearBookmarks">清空</button>
    </div>

    <p v-if="batchProgress.total > 0" class="muted">
      批量进度：{{ batchProgress.done }} / {{ batchProgress.total }}
    </p>

    <div class="breadcrumb">
      <template v-for="(segment, index) in segments" :key="segment.path">
        <span v-if="index > 0" class="slash">/</span>
        <button class="crumb" @click="openPath(segment.path)">
          {{ segment.label }}
        </button>
      </template>
    </div>

    <p v-if="listing" class="muted">读取中...</p>
    <p v-if="error" class="message error">{{ error }}</p>
    <pre v-if="message" class="message output">{{ message }}</pre>

    <div v-if="connected" class="file-list">
      <p v-if="visibleEntries.length === 0 && !listing" class="muted empty">
        空目录
      </p>
      <div v-for="entry in visibleEntries" :key="entry.path" class="file-row">
        <input
          type="checkbox"
          class="file-check"
          :checked="selected.has(entry.path)"
          @change="toggleSelect(entry.path)"
        />
        <button
          class="file-name"
          :class="{ dir: entry.isDir }"
          @click="entry.isDir ? openPath(entry.path) : undefined"
          @dblclick="!entry.isDir && openPreview(entry)"
        >
          {{ entry.isDir ? "[目录]" : "[文件]" }} {{ entry.name }}
        </button>
        <span class="file-meta">
          {{ entry.isDir ? "-" : formatBytes(entry.size) }}
        </span>
        <span class="file-meta date">{{ entry.modified }}</span>
        <div class="file-actions">
          <button
            v-if="!entry.isDir"
            :disabled="working !== null"
            @click="openPreview(entry)"
          >
            预览
          </button>
          <button
            v-if="!entry.isDir"
            :disabled="working !== null"
            @click="download(entry)"
          >
            下载
          </button>
          <button
            v-if="!entry.isDir && /\.(zip|jar)$/i.test(entry.name)"
            :disabled="working !== null"
            @click="extractFile(entry)"
          >
            解压
          </button>
          <button :disabled="working !== null" @click="rename(entry)">重命名</button>
          <button
            class="danger"
            :disabled="working !== null"
            @click="remove(entry)"
          >
            删除
          </button>
        </div>
      </div>
    </div>
    <p v-else class="muted empty">
      {{
        mode === "fastboot"
          ? "设备处于 FastBoot 模式，无法浏览文件。"
          : "连接设备后可以浏览文件。"
      }}
    </p>

    <div v-if="previewOpen" class="dialog-mask" @click.self="closePreview">
      <div class="dialog preview-dialog" role="dialog" aria-modal="true">
        <h2>{{ previewEntry?.name }}</h2>
        <p v-if="previewLoading" class="muted">读取中...</p>
        <p v-if="previewError" class="dialog-error">{{ previewError }}</p>
        <img
          v-if="previewKind === 'image'"
          :src="previewImage"
          class="preview-image"
          alt="文件预览"
        />
        <textarea
          v-if="previewKind === 'text'"
          v-model="previewText"
          class="preview-editor"
        ></textarea>
        <div v-if="previewChecksums" class="checksum-box">
          <p>MD5: {{ previewChecksums.md5 }}</p>
          <p>SHA-256: {{ previewChecksums.sha256 }}</p>
        </div>
        <div class="dialog-actions">
          <button
            v-if="previewKind === 'text'"
            class="dialog-cancel"
            :disabled="previewSaving"
            @click="savePreviewFile"
          >
            {{ previewSaving ? "保存中..." : "保存" }}
          </button>
          <button
            v-if="previewEntry"
            class="dialog-cancel"
            @click="loadPreviewChecksums"
          >
            校验
          </button>
          <button class="dialog-confirm" @click="closePreview">关闭</button>
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
    gap: 8px;
    margin-top: 18px;
    padding: 12px;
    border: 1px solid #e5e7eb;
    background: #fff;
  }
  .toolbar button {
    padding: 8px 12px;
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
  .path-input {
    flex: 1;
    min-width: 220px;
    padding: 8px 10px;
    border: 1px solid #d1d5db;
    font-family: Consolas, monospace;
    font-size: 13px;
  }
  .breadcrumb {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    margin-top: 10px;
    color: #9ca3af;
    font-size: 12px;
  }
  .crumb {
    padding: 2px 4px;
    border: none;
    background: none;
    color: #4b5563;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .crumb:hover {
    color: var(--accent);
  }
  .slash {
    color: #d1d5db;
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
    max-height: 160px;
    overflow: auto;
  }
  .file-list {
    margin-top: 12px;
    border: 1px solid #e5e7eb;
    background: #fff;
  }
  .file-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid #f3f4f6;
  }
  .file-row:last-child {
    border-bottom: none;
  }
  .file-name {
    flex: 1;
    min-width: 0;
    padding: 2px 0;
    border: none;
    background: none;
    color: #1f2937;
    font-family: inherit;
    font-size: 13px;
    text-align: left;
    word-break: break-all;
    cursor: default;
  }
  .file-name.dir {
    color: var(--accent);
    cursor: pointer;
  }
  .file-name.dir:hover {
    text-decoration: underline;
  }
  .file-meta {
    flex: none;
    width: 86px;
    color: #6b7280;
    font-size: 12px;
    text-align: right;
  }
  .file-meta.date {
    width: 130px;
    color: #9ca3af;
  }
  .file-actions {
    display: flex;
    flex: none;
    gap: 6px;
  }
  .file-actions button {
    padding: 4px 9px;
    border: 1px solid #d1d5db;
    background: #fff;
    color: #374151;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .file-actions button:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .file-actions button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .file-actions .danger {
    color: #dc2626;
  }
  .file-actions .danger:hover:not(:disabled) {
    border-color: #dc2626;
  }
  .empty {
    padding: 24px;
    text-align: center;
  }
  .selection-count {
    align-self: center;
    color: #6b7280;
    font-size: 12px;
  }
  .toolbar .danger {
    border-color: #dc2626;
    color: #dc2626;
  }
  .bookmarks {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    font-size: 12px;
  }
  .bookmark-label {
    color: #6b7280;
  }
  .bookmark {
    max-width: 220px;
    padding: 3px 8px;
    overflow: hidden;
    border: 1px solid #e5e7eb;
    background: #f9fafb;
    color: #374151;
    font-family: Consolas, monospace;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .bookmark:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .bookmark-clear {
    padding: 3px 8px;
    border: 1px solid #e5e7eb;
    background: #fff;
    color: #6b7280;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .file-check {
    flex: none;
    width: 14px;
    height: 14px;
    margin: 0;
    accent-color: var(--accent);
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
    max-height: 84vh;
    padding: 22px 24px;
    overflow-y: auto;
    background: #fff;
    box-shadow: 0 20px 50px rgba(15, 23, 42, 0.3);
    text-align: center;
  }
  .dialog h2 {
    margin: 0 0 10px;
    color: var(--accent);
    font-size: 16px;
    word-break: break-all;
  }
  .dialog-actions {
    display: flex;
    justify-content: center;
    margin-top: 14px;
  }
  .dialog-actions button {
    min-width: 96px;
    padding: 8px 16px;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: #fff;
    font-family: inherit;
    font-size: 14px;
    cursor: pointer;
  }
  .dialog-error {
    margin: 10px 0 0;
    color: #dc2626;
    font-size: 13px;
    text-align: left;
  }
  .preview-dialog {
    width: min(820px, calc(100% - 32px));
  }
  .preview-image {
    display: block;
    max-width: 100%;
    max-height: 66vh;
    margin: 0 auto;
    object-fit: contain;
  }
  .preview-editor {
    box-sizing: border-box;
    width: 100%;
    min-height: 240px;
    max-height: 66vh;
    margin: 0;
    padding: 10px;
    overflow: auto;
    border: 1px solid #334155;
    background: #0f172a;
    color: #e2e8f0;
    font-family: Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    text-align: left;
    white-space: pre-wrap;
    word-break: break-all;
    resize: vertical;
  }
  .checksum-box {
    margin-top: 10px;
    padding: 8px 10px;
    border: 1px solid #e5e7eb;
    background: #f9fafb;
    text-align: left;
    font-family: Consolas, monospace;
    font-size: 11px;
    word-break: break-all;
  }
  .checksum-box p {
    margin: 2px 0;
  }
  .toolbar button.active {
    background: var(--accent);
    color: #fff;
  }
</style>
