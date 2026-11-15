<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { listen } from "@tauri-apps/api/event";
import { useConnectedDevice } from "../composables/useConnectedDevice";
import {
  fetchLogcat,
  joinLocalPath,
  pickDirectory,
  runDeviceTool,
  runningInTauri,
  saveTextFile,
  shellQuote,
  startLogcat,
  stopLogcat,
} from "../services/adb";
import {
  countCrashMarkers,
  extractCrashes,
  extractWarnings,
  parseLogLine as parseLine,
  type CrashEvent,
  type WarningEvent,
} from "../services/logcat";
import { settings } from "../services/settings";

const { serial, mode, modeLabel, connected } = useConnectedDevice();

const rawLines = ref<string[]>([]);
const level = ref<"V" | "D" | "I" | "W" | "E" | "F">("V");
const keyword = ref("");
const pidFilter = ref("");
const tagFilter = ref("");
const crashOnly = ref(false);
const packageFilter = ref("");
const pidLoading = ref(false);
const streaming = ref(false);
const autoScroll = ref(true);
const error = ref("");
const message = ref("");
const logBox = ref<HTMLElement | null>(null);
const MAX_LINES = 3000;
const MAX_RENDER_LINES = 800;

let unlisten: (() => void) | null = null;
let fallbackTimer: number | undefined;

const LEVEL_ORDER: Record<string, number> = {
  V: 0,
  D: 1,
  I: 2,
  W: 3,
  E: 4,
  F: 5,
};

const filteredLines = computed(() => {
  const term = keyword.value.trim().toLowerCase();
  const pid = pidFilter.value.trim();
  const tag = tagFilter.value.trim().toLowerCase();
  const minimum = LEVEL_ORDER[level.value];
  return rawLines.value.filter((line) => {
    const info = parseLine(line);
    if (info.level && LEVEL_ORDER[info.level] < minimum) {
      return false;
    }
    if (pid !== "" && info.pid !== pid) {
      return false;
    }
    if (tag !== "" && !info.tag.toLowerCase().includes(tag)) {
      return false;
    }
    if (
      crashOnly.value &&
      !/FATAL EXCEPTION|AndroidRuntime|beginning of crash|Fatal signal|ANR in|pid:\s*\d+|PID:\s*\d+|Cmdline:|>>>|Process:.*PID:|\bat [\w.$]+\(/.test(
        line,
      )
    ) {
      return false;
    }
    return term === "" || line.toLowerCase().includes(term);
  });
});

const crashEvents = ref<CrashEvent[]>([]);
const crashMarkerCount = computed(() => countCrashMarkers(rawLines.value));
const seenCrashKeys = new Map<string, CrashEvent>();

function crashKey(event: CrashEvent): string {
  return event.time !== "" && event.pid !== ""
    ? `${event.time}|${event.pid}`
    : `${event.time}|${event.app}|${event.reason}`;
}

function mergeCrashEvents(events: CrashEvent[]) {
  for (const event of events) {
    const key = crashKey(event);
    const existing = seenCrashKeys.get(key);
    if (existing) {
      if (existing.app === "未知进程" && event.app !== "未知进程") {
        existing.app = event.app;
      }
      if (existing.pid === "" && event.pid !== "") {
        existing.pid = event.pid;
      }
      if (existing.reason === "ANR" && event.reason !== "ANR") {
        existing.reason = event.reason;
      }
      continue;
    }
    crashEvents.value.push(event);
    seenCrashKeys.set(
      key,
      crashEvents.value[crashEvents.value.length - 1],
    );
  }
  if (crashEvents.value.length > 200) {
    const removed = crashEvents.value.splice(
      0,
      crashEvents.value.length - 200,
    );
    for (const event of removed) {
      seenCrashKeys.delete(crashKey(event));
    }
  }
}

function resetCrashEvents() {
  crashEvents.value = [];
  seenCrashKeys.clear();
}

const warningEvents = ref<WarningEvent[]>([]);
const showWarnings = ref(false);
const seenWarningKeys = new Set<string>();

function mergeWarnings(warnings: WarningEvent[]) {
  for (const warning of warnings) {
    if (seenWarningKeys.has(warning.id)) {
      continue;
    }
    seenWarningKeys.add(warning.id);
    warningEvents.value.push(warning);
  }
  if (warningEvents.value.length > 200) {
    const removed = warningEvents.value.splice(
      0,
      warningEvents.value.length - 200,
    );
    for (const warning of removed) {
      seenWarningKeys.delete(warning.id);
    }
  }
}

function resetWarnings() {
  warningEvents.value = [];
  seenWarningKeys.clear();
  showWarnings.value = false;
}

function focusWarning(warning: WarningEvent) {
  const present = rawLines.value.some(
    (line) =>
      (warning.time !== "" && line.includes(warning.time)) ||
      (warning.time === "" && line.includes(warning.tag)),
  );
  if (!present) {
    message.value =
      "该警告摘要仍保留，但原始日志已超出 3000 行缓冲，无法再定位到具体行";
    return;
  }

  crashOnly.value = false;
  level.value = "W";
  pidFilter.value = warning.pid;
  tagFilter.value = warning.tag;
  message.value = `已筛选警告：${warning.tag || "未知 Tag"}`;
}

function focusCrash(crash: CrashEvent) {
  const present = rawLines.value.some(
    (line) =>
      (crash.time !== "" && line.includes(crash.time)) ||
      (crash.time === "" &&
        (line.includes(crash.app) ||
          (crash.pid !== "" && line.includes(crash.pid)))),
  );
  if (!present) {
    message.value =
      "该崩溃摘要仍保留，但原始日志已超出 3000 行缓冲，无法再定位到具体行";
    return;
  }

  crashOnly.value = true;
  if (crash.pid !== "") {
    pidFilter.value = crash.pid;
  } else if (crash.app !== "未知进程") {
    keyword.value = crash.app;
  }
  message.value =
    crash.app === "未知进程"
      ? "该崩溃未解析出进程，请继续复现或重新开始抓取"
      : `已筛选崩溃进程：${crash.app}${crash.pid ? `（PID ${crash.pid}）` : ""}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderLine(line: string) {
  const escaped = escapeHtml(line);
  const term = keyword.value.trim();
  if (term === "") {
    return escaped;
  }
  return escaped.replace(
    new RegExp(escapeRegExp(escapeHtml(term)), "gi"),
    (match) => `<mark>${match}</mark>`,
  );
}

async function lookupPid() {
  const target = serial.value;
  const packageName = packageFilter.value.trim();
  if (!target || packageName === "" || pidLoading.value) {
    return;
  }
  pidLoading.value = true;
  message.value = "";
  try {
    const result = await runDeviceTool("adb", [
      "-s",
      target,
      "shell",
      `pidof ${shellQuote(packageName)}`,
    ]);
    const pid = result.stdout.trim().split(/\s+/)[0];
    if (pid) {
      pidFilter.value = pid;
      message.value = `PID: ${pid}`;
    } else {
      message.value = "没有找到该应用的运行进程";
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "获取 PID 失败";
  } finally {
    pidLoading.value = false;
  }
}

const visibleLines = computed(() =>
  filteredLines.value.slice(-MAX_RENDER_LINES),
);

function levelClass(line: string) {
  const value = parseLine(line).level;
  if (value === "E" || value === "F") {
    return "error";
  }
  if (value === "W") {
    return "warn";
  }
  return "";
}

function appendBatch(batch: string[]) {
  if (batch.length === 0) {
    return;
  }
  const context = rawLines.value.slice(-40);
  const combined = rawLines.value.concat(batch);
  mergeCrashEvents(extractCrashes(context.concat(batch)));
  mergeWarnings(extractWarnings(batch));
  rawLines.value = combined.slice(-MAX_LINES);
  if (autoScroll.value) {
    void nextTick(() => {
      if (logBox.value) {
        logBox.value.scrollTop = logBox.value.scrollHeight;
      }
    });
  }
}

async function start() {
  const target = serial.value;
  if (!target || !connected.value || streaming.value) {
    return;
  }
  rawLines.value = [];
  resetCrashEvents();
  resetWarnings();
  error.value = "";
  message.value = "";
  streaming.value = true;

  if (!runningInTauri) {
    // 浏览器开发模式退回定时快照
    const poll = async () => {
      const targetSerial = serial.value;
      if (!targetSerial || !streaming.value) {
        return;
      }
      try {
        const text = await fetchLogcat(targetSerial, 1000);
        const lines = text.split(/\r?\n/).filter(Boolean);
        mergeCrashEvents(extractCrashes(lines));
        mergeWarnings(extractWarnings(lines));
        rawLines.value = lines.slice(-MAX_LINES);
      } catch (caught) {
        error.value = caught instanceof Error ? caught.message : "读取日志失败";
      }
    };
    await poll();
    fallbackTimer = window.setInterval(poll, 2000);
    return;
  }

  try {
    unlisten = await listen<string[]>("logcat-batch", (event) => {
      appendBatch(event.payload);
    });
    await startLogcat(target);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "启动日志失败";
    streaming.value = false;
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
  }
}

async function stop() {
  streaming.value = false;
  if (fallbackTimer !== undefined) {
    window.clearInterval(fallbackTimer);
    fallbackTimer = undefined;
  }
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  try {
    await stopLogcat();
  } catch {
    // 忽略停止失败
  }
}

function clearLog() {
  rawLines.value = [];
  resetCrashEvents();
  resetWarnings();
  message.value = "";
}

async function exportLog() {
  const content = filteredLines.value.join("\n");
  if (content === "") {
    return;
  }
  let directory = settings.downloadDirectory;
  if (directory.trim() === "") {
    const picked = await pickDirectory("选择日志保存目录");
    if (!picked) {
      return;
    }
    directory = picked;
  }
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  error.value = "";
  try {
    const saved = await saveTextFile(
      joinLocalPath(directory, `logcat-${stamp}.txt`),
      content,
    );
    message.value = `日志已保存：${saved}`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "保存失败";
  }
}

async function copyLog() {
  const content = filteredLines.value.join("\n");
  if (content === "") {
    return;
  }
  try {
    await navigator.clipboard.writeText(content);
    message.value = "已复制到剪贴板";
  } catch {
    message.value = "复制失败，请手动选择文本";
  }
}

watch(
  () => [serial.value, connected.value] as const,
  () => {
    if (streaming.value) {
      void stop();
    }
  },
);

onBeforeUnmount(() => {
  void stop();
  window.removeEventListener("pagehide", handlePageHide);
});

function handlePageHide() {
  void stop();
}

window.addEventListener("pagehide", handlePageHide);
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h1>日志</h1>
        <p v-if="mode === 'fastboot'" class="muted">
          设备处于 FastBoot 模式，日志需要先进入系统。
          <RouterLink class="device-link" to="/devices">前往当前设备</RouterLink>
        </p>
        <p v-else-if="!connected" class="muted">
          请连接并授权设备，当前状态：{{ modeLabel }}
        </p>
        <p v-else class="muted">
          当前设备：<span class="serial">{{ serial }}</span>
        </p>
      </div>
    </header>

    <div class="toolbar">
      <button
        :class="{ active: streaming }"
        :disabled="!connected"
        @click="streaming ? stop() : start()"
      >
        {{ streaming ? "停止实时" : "开始实时" }}
      </button>
      <button :disabled="rawLines.length === 0" @click="clearLog">清空</button>
      <select v-model="level" class="select">
        <option value="V">全部级别</option>
        <option value="D">Debug 及以上</option>
        <option value="I">Info 及以上</option>
        <option value="W">Warn 及以上</option>
        <option value="E">Error 及以上</option>
        <option value="F">Fatal</option>
      </select>
      <input v-model="keyword" class="search" placeholder="关键字" />
      <input v-model="pidFilter" class="small-input" placeholder="PID" />
      <input v-model="tagFilter" class="small-input" placeholder="Tag" />
      <input v-model="packageFilter" class="small-input" placeholder="包名取 PID" />
      <button :disabled="pidLoading" @click="lookupPid">
        {{ pidLoading ? "查询中..." : "取 PID" }}
      </button>
      <label class="switch">
        <input v-model="crashOnly" type="checkbox" />
        仅崩溃
      </label>
      <label class="switch">
        <input v-model="autoScroll" type="checkbox" />
        自动滚动
      </label>
      <button :disabled="filteredLines.length === 0" @click="copyLog">
        复制
      </button>
      <button :disabled="filteredLines.length === 0" @click="exportLog">
        导出
      </button>
    </div>

    <p v-if="error" class="message error">{{ error }}</p>
    <p v-if="message" class="message info">{{ message }}</p>
    <div v-if="crashEvents.length > 0" class="crash-summary">
      <div class="crash-title">
        检测到 {{ crashEvents.length }} 次崩溃，点击可筛选
      </div>
      <button
        v-for="crash in crashEvents"
        :key="crash.id"
        type="button"
        class="crash-item"
        @click="focusCrash(crash)"
      >
        <span class="crash-app">{{ crash.app }}</span>
        <span class="crash-meta">
          <template v-if="crash.pid">PID {{ crash.pid }}</template>
          <template v-if="crash.pid && crash.reason"> · </template>
          {{ crash.reason }}
        </span>
        <span v-if="crash.time" class="crash-time">{{ crash.time }}</span>
      </button>
    </div>
    <p v-else-if="crashMarkerCount > 0" class="message error">
      检测到 {{ crashMarkerCount }} 条崩溃标记，但当前日志中未解析出崩溃进程；请保持复现或重新开始抓取。
    </p>

    <div v-if="warningEvents.length > 0" class="warning-summary">
      <div class="warning-title">
        <span>已保留 {{ warningEvents.length }} 条警告（超出缓冲后仍会保留）</span>
        <button
          class="warning-toggle"
          type="button"
          @click="showWarnings = !showWarnings"
        >
          {{ showWarnings ? "收起" : "展开" }}
        </button>
      </div>
      <div v-if="showWarnings" class="warning-list">
        <button
          v-for="warning in warningEvents"
          :key="warning.id"
          type="button"
          class="warning-item"
          @click="focusWarning(warning)"
        >
          <span class="warning-time">{{ warning.time }}</span>
          <span class="warning-tag">{{ warning.tag }}</span>
          <span class="warning-message">{{ warning.message }}</span>
          <span v-if="warning.pid" class="warning-pid">
            PID {{ warning.pid }}
          </span>
        </button>
      </div>
    </div>
    <p v-if="!connected" class="muted empty">
      {{
        mode === "fastboot"
          ? "设备处于 FastBoot 模式，无法查看 Logcat。"
          : "连接设备后可以查看 Logcat。"
      }}
    </p>

    <div v-else ref="logBox" class="log-output">
      <div
        v-for="(line, index) in visibleLines"
        :key="index"
        class="log-line"
        :class="levelClass(line)"
        v-html="renderLine(line)"
      ></div>
      <p v-if="visibleLines.length === 0" class="log-placeholder">
        {{ streaming ? "等待日志..." : "点击「开始实时」后显示日志" }}
      </p>
    </div>
    <p class="log-meta">
      显示 {{ visibleLines.length }} / 筛选 {{ filteredLines.length }} / 共
      {{ rawLines.length }} 行
    </p>
  </section>
</template>

<style scoped>
  .page {
    display: flex;
    flex-direction: column;
    min-height: calc(100vh - 56px);
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
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 18px;
    padding: 12px;
    border: 1px solid #e5e7eb;
    background: #fff;
  }
  .toolbar button {
    height: var(--control-height);
    padding: 0 12px;
    border: 1px solid var(--accent);
    background: #fff;
    color: var(--accent);
    font-family: inherit;
    font-size: var(--control-font);
  }
  .toolbar button:hover:not(:disabled) {
    background: var(--control-hover);
  }
  .toolbar button.active {
    background: var(--accent);
    color: #fff;
  }
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #374151;
    font-size: 13px;
  }
  .select,
  .search,
  .small-input {
    box-sizing: border-box;
    height: var(--control-height);
    padding: 0 10px;
    border: 1px solid var(--control-border);
    background: #fff;
    color: var(--control-text);
    font-family: inherit;
    font-size: var(--control-font);
    outline: none;
  }
  .search {
    flex: 1;
    min-width: 160px;
  }
  .small-input {
    width: 110px;
  }
  .crash-summary {
    margin-top: 12px;
    padding: 10px 12px;
    border: 1px solid #fecaca;
    background: #fef2f2;
    text-align: left;
  }
  .crash-title {
    margin-bottom: 6px;
    color: #b91c1c;
    font-size: 13px;
  }
  .crash-item {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    align-items: baseline;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid transparent;
    background: transparent;
    color: #7f1d1d;
    font-family: inherit;
    text-align: left;
  }
  .crash-item:hover {
    border-color: #fecaca;
    background: #fff;
  }
  .crash-app {
    color: #b91c1c;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    word-break: break-all;
  }
  .crash-meta {
    color: #7f1d1d;
    font-family: var(--font-mono);
    font-size: 11px;
    word-break: break-all;
  }
  .crash-time {
    color: #991b1b;
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.7;
  }
  .warning-summary {
    margin-top: 10px;
    padding: 10px 12px;
    border: 1px solid #fde68a;
    background: #fffbeb;
    text-align: left;
  }
  .warning-title {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    color: #92400e;
    font-size: 13px;
  }
  .warning-toggle {
    padding: 0;
    border: none;
    background: none;
    color: #b45309;
    font-family: inherit;
    font-size: var(--control-font-sm);
    text-decoration: underline;
  }
  .warning-list {
    max-height: 260px;
    margin-top: 8px;
    overflow: auto;
  }
  .warning-item {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    align-items: baseline;
    width: 100%;
    padding: 5px 6px;
    border: 1px solid transparent;
    background: transparent;
    color: #78350f;
    font-family: inherit;
    text-align: left;
  }
  .warning-item:hover {
    border-color: #fde68a;
    background: #fff;
  }
  .warning-time,
  .warning-pid {
    color: #a16207;
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.8;
  }
  .warning-tag {
    color: #92400e;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
  }
  .warning-message {
    flex: 1 1 220px;
    color: #78350f;
    font-family: var(--font-mono);
    font-size: 11px;
    word-break: break-all;
  }
  .message {
    margin: 10px 0 0;
    padding: 8px 12px;
    border: 1px solid #e5e7eb;
    background: #f9fafb;
    font-size: 13px;
  }
  .message.error {
    color: #dc2626;
    border-color: #fecaca;
    background: #fef2f2;
  }
  .message.info {
    color: #166534;
    border-color: #bbf7d0;
    background: #f0fdf4;
  }
  .log-output {
    flex: 1;
    min-height: 320px;
    max-height: calc(100vh - 320px);
    margin-top: 12px;
    padding: 10px 12px;
    overflow: auto;
    border: 1px solid #1f2937;
    background: #0f172a;
    color: #e2e8f0;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
  }
  .log-line {
    white-space: pre-wrap;
    word-break: break-all;
  }
  .log-line.warn {
    color: #fbbf24;
  }
  .log-line.error {
    color: #f87171;
  }
  .log-line mark {
    padding: 0 1px;
    background: #facc15;
    color: #111827;
  }
  .log-placeholder {
    margin: 0;
    color: #64748b;
  }
  .log-meta {
    margin: 8px 0 24px;
    color: #9ca3af;
    font-size: 12px;
  }
  .empty {
    padding: 24px;
    text-align: center;
  }
</style>
