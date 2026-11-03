import { invoke } from "@tauri-apps/api/core";

export interface AdbDevice {
  serial: string;
  state: string;
}

export type RebootMode = "" | "recovery" | "bootloader" | "edl";

export type DeviceMode =
  | "system"
  | "recovery"
  | "fastboot"
  | "9008"
  | "unknown";

export interface DeviceInfo {
  manufacturer: string;
  model: string;
  codename: string;
  storage: string;
  memory: string;
  resolution: string;
  root: string;
  android: string;
  dpi: string;
  battery: string;
  serialNumber: string;
  cpu: string;
  ip: string;
  batteryTemp: string;
  uptime: string;
  load: string;
  cores: string;
  cpuUsage: string;
  network: string;
  memoryUsage: string;
}

export interface AppEntry {
  packageName: string;
  apkPath: string;
  system: boolean;
  disabled: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: string;
}

export interface AppMetadata {
  label: string | null;
  icon: string | null;
  iconBackground: string | null;
}

export interface DeviceStatus {
  devices: AdbDevice[];
  fastbootDevices: string[];
  serial: string | null;
  fastbootSerial: string | null;
  mode: DeviceMode;
}

export type ToolName = "adb" | "fastboot";

export interface ToolOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

// 运行在 Tauri 窗口内时通过 Rust 命令调用 adb，浏览器开发环境下走 Vite 接口
const inTauri = "__TAURI_INTERNALS__" in window;

export const runningInTauri = inTauri;

// 一次 shell 调用采集设备信息，用前缀标记避免空值打乱行序
const DEVICE_INFO_SCRIPT = [
  "echo MFR:$(getprop ro.product.manufacturer)",
  "echo MODEL:$(getprop ro.product.model)",
  "echo CODENAME:$(getprop ro.product.device)",
  "echo ANDROID:$(getprop ro.build.version.release)",
  "echo SDK:$(getprop ro.build.version.sdk)",
  "echo RES:$(wm size | tail -n 1)",
  "echo DPI:$(wm density | tail -n 1)",
  "echo MEM:$(head -n 1 /proc/meminfo)",
  "echo MEMAVAIL:$(grep MemAvailable /proc/meminfo)",
  "echo DISK:$(df -k /data | tail -n 1)",
  "echo SU:$(which su)",
  "echo UID:$(id -u)",
  "echo BAT:$(dumpsys battery | grep -m 1 level)",
  "echo ABI:$(getprop ro.product.cpu.abi)",
  "echo SERIAL:$(getprop ro.serialno)",
  "echo IP:$(ip route 2>/dev/null | grep -m 1 'src ')",
  "echo BTEMP:$(dumpsys battery | grep -m 1 temperature)",
  "echo UPTIME:$(cat /proc/uptime)",
  "echo LOAD:$(cat /proc/loadavg)",
  "echo CORE:$(grep -c ^processor /proc/cpuinfo)",
  "echo STAT:$(head -n 1 /proc/stat)",
  "echo NET:$(cat /proc/net/dev)",
].join("; ");

// 解析 `adb devices` 输出，跳过标题行和守护进程提示
export function parseAdbDevices(output: string): AdbDevice[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line !== "" &&
        !line.startsWith("List of devices") &&
        !line.startsWith("*"),
    )
    .map((line) => {
      const [serial, state = "unknown"] = line.split(/\s+/);
      return { serial, state };
    });
}

function parseFastbootDevices(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => line.split(/\s+/)[0]);
}

// 归一化启动模式，无法判断时返回 unknown
function normalizeBootMode(rawMode: string, bootCompleted: string): DeviceMode {
  const mode = rawMode.trim().toLowerCase();

  switch (mode) {
    case "recovery":
      return "recovery";
    case "bootloader":
    case "fastboot":
      return "fastboot";
    case "edl":
    case "9008":
    case "qualcomm":
      return "9008";
    case "normal":
    case "system":
    case "android":
      return "system";
    default:
      // 部分设备的 ro.bootmode 会返回 unknown、wdgreboot 等厂商值，用开机完成标记兜底
      return bootCompleted.trim() === "1" ? "system" : "unknown";
  }
}

function readField(output: string, key: string): string {
  const prefix = `${key}:`;
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return "";
}

// 读取可能跨多行的字段（例如 /proc/net/dev）
function readBlock(output: string, key: string): string {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    line.trim().startsWith(`${key}:`),
  );
  if (start === -1) {
    return "";
  }
  const first = lines[start].trim().slice(key.length + 1);
  return [first, ...lines.slice(start + 1)].join("\n");
}

let lastCpuSample: { total: number; idle: number } | null = null;
let lastNetSample: { total: number; at: number } | null = null;

function readCpuUsage(statLine: string): string {
  const values = statLine
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((value) => Number(value) || 0);
  if (values.length < 4) {
    return "-";
  }
  const idle = (values[3] ?? 0) + (values[4] ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!lastCpuSample || total <= lastCpuSample.total) {
    lastCpuSample = { total, idle };
    return "-";
  }
  const deltaTotal = total - lastCpuSample.total;
  const deltaIdle = idle - lastCpuSample.idle;
  lastCpuSample = { total, idle };
  const usage = ((deltaTotal - deltaIdle) / deltaTotal) * 100;
  return `${Math.max(0, Math.min(100, usage)).toFixed(1)}%`;
}

function readNetwork(netBlock: string): string {
  let total = 0;
  for (const line of netBlock.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:|]+):\s*(.+)$/);
    if (!match || match[1].trim() === "lo") {
      continue;
    }
    const fields = match[2].trim().split(/\s+/).map(Number);
    if (fields.length >= 9) {
      total += (fields[0] || 0) + (fields[8] || 0);
    }
  }
  const now = Date.now();
  if (!lastNetSample) {
    lastNetSample = { total, at: now };
    return "-";
  }
  const seconds = (now - lastNetSample.at) / 1000;
  const delta = Math.max(0, total - lastNetSample.total);
  lastNetSample = { total, at: now };
  if (seconds <= 0) {
    return "-";
  }
  return `${formatRate(delta / seconds)}/s`;
}

function formatRate(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes.toFixed(0)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readMemoryUsage(output: string): string {
  const total = Number(readField(output, "MEM").match(/(\d+)\s+kB/)?.[1]);
  const available = Number(
    readField(output, "MEMAVAIL").match(/(\d+)\s+kB/)?.[1],
  );
  if (!total || !available) {
    return "-";
  }
  return `${(((total - available) / total) * 100).toFixed(1)}%`;
}

function formatGibFromKb(token: string | undefined): string {
  const kb = Number(token);
  if (!Number.isFinite(kb) || kb <= 0) {
    return "-";
  }
  return `${(kb / 1024 / 1024).toFixed(2)}G`;
}

function afterColon(value: string): string {
  const parts = value.split(":");
  return parts[parts.length - 1]?.trim() || "-";
}

export function parseDeviceInfo(output: string): DeviceInfo {
  const release = readField(output, "ANDROID");
  const sdk = readField(output, "SDK");
  const su = readField(output, "SU");
  const uid = readField(output, "UID");
  const battery = readField(output, "BAT").match(/\d+/)?.[0];
  const batteryTemp = readField(output, "BTEMP").match(/\d+/)?.[0];
  const uptimeSeconds = Number(readField(output, "UPTIME").split(/\s+/)[0]);
  const load = readField(output, "LOAD")
    .split(/\s+/)
    .slice(0, 3)
    .join("/");
  const ip = readField(output, "IP").match(/src\s+(\S+)/)?.[1] ?? "";

  return {
    manufacturer: readField(output, "MFR") || "-",
    model: readField(output, "MODEL") || "-",
    codename: readField(output, "CODENAME") || "-",
    storage: formatGibFromKb(readField(output, "DISK").split(/\s+/)[1]),
    memory: formatGibFromKb(readField(output, "MEM").split(/\s+/)[1]),
    resolution: afterColon(readField(output, "RES")),
    root: su || uid === "0" ? "已Root" : "未Root",
    android: release ? (sdk ? `${release} (API ${sdk})` : release) : "-",
    dpi: afterColon(readField(output, "DPI")),
    battery: battery ? `${battery}%` : "-",
    serialNumber: readField(output, "SERIAL") || "-",
    cpu: readField(output, "ABI") || "-",
    ip: ip || "-",
    batteryTemp: batteryTemp
      ? `${(Number(batteryTemp) / 10).toFixed(1)} °C`
      : "-",
    uptime: formatUptime(uptimeSeconds),
    load: load || "-",
    cores: readField(output, "CORE") || "-",
    cpuUsage: readCpuUsage(readField(output, "STAT")),
    network: readNetwork(readBlock(output, "NET")),
    memoryUsage: readMemoryUsage(output),
  };
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "-";
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}天`);
  }
  if (hours > 0) {
    parts.push(`${hours}小时`);
  }
  parts.push(`${minutes}分`);
  return parts.join(" ");
}

// 给 adb shell 参数做单引号转义
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function joinRemotePath(directory: string, name: string): string {
  return directory.endsWith("/")
    ? `${directory}${name}`
    : `${directory}/${name}`;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

// 执行 adb / fastboot 命令，返回原始输出
export async function runDeviceTool(
  tool: ToolName,
  args: string[],
): Promise<ToolOutput> {
  if (inTauri) {
    return invoke<ToolOutput>("run_device_tool", { tool, args });
  }

  const response = await fetch("/api/adb/exec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, `执行失败: ${response.status}`));
  }
  return (await response.json()) as ToolOutput;
}

// 给 IPC 调用加超时，避免热更新后回调丢失导致页面一直停在“未连接”
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// 一次轮询获取 adb 设备、当前设备和启动模式
export async function getDeviceStatus(
  preferredSerial: string | null = null,
): Promise<DeviceStatus> {
  const adbResult = await withTimeout(
    runDeviceTool("adb", ["devices"]),
    10_000,
    "adb 响应超时，请重新加载应用",
  );
  const devices = parseAdbDevices(adbResult.stdout);
  const onlineDevices = devices.filter((device) => device.state === "device");
  const online =
    onlineDevices.find((device) => device.serial === preferredSerial) ??
    onlineDevices[0] ??
    null;

  if (online) {
    const props = await withTimeout(
      runDeviceTool("adb", [
        "-s",
        online.serial,
        "shell",
        "getprop ro.bootmode; getprop sys.boot_completed",
      ]),
      10_000,
      "读取设备状态超时",
    );
    const [rawMode = "", bootCompleted = ""] = props.stdout.split(/\r?\n/);
    return {
      devices,
      fastbootDevices: [],
      serial: online.serial,
      fastbootSerial: null,
      mode: normalizeBootMode(rawMode, bootCompleted),
    };
  }

  // adb 不可用时检查是否处于 fastboot
  let fastbootDevices: string[] = [];
  try {
    const fastboot = await runDeviceTool("fastboot", ["devices"]);
    fastbootDevices = parseFastbootDevices(fastboot.stdout);
  } catch {
    // fastboot 工具不可用时按未连接处理
  }

  const fastbootSerial =
    fastbootDevices.find((serial) => serial === preferredSerial) ??
    fastbootDevices[0] ??
    null;

  return {
    devices,
    fastbootDevices,
    serial: null,
    fastbootSerial,
    mode: fastbootSerial ? "fastboot" : "unknown",
  };
}

export async function getDeviceInfo(serial: string): Promise<DeviceInfo> {
  const result = await runDeviceTool("adb", [
    "-s",
    serial,
    "shell",
    DEVICE_INFO_SCRIPT,
  ]);
  return parseDeviceInfo(result.stdout);
}

const DEVICE_STATS_SCRIPT = [
  "echo BAT:$(dumpsys battery | grep -m 1 level)",
  "echo BTEMP:$(dumpsys battery | grep -m 1 temperature)",
  "echo LOAD:$(cat /proc/loadavg)",
  "echo STAT:$(head -n 1 /proc/stat)",
  "echo NET:$(cat /proc/net/dev)",
  "echo MEM:$(head -n 1 /proc/meminfo)",
  "echo MEMAVAIL:$(grep MemAvailable /proc/meminfo)",
  "echo UPTIME:$(cat /proc/uptime)",
].join("; ");

export type DeviceStats = Pick<
  DeviceInfo,
  | "battery"
  | "batteryTemp"
  | "load"
  | "uptime"
  | "cpuUsage"
  | "network"
  | "memoryUsage"
>;

export function parseDeviceStats(output: string): DeviceStats {
  const battery = readField(output, "BAT").match(/\d+/)?.[0];
  const batteryTemp = readField(output, "BTEMP").match(/\d+/)?.[0];
  const uptimeSeconds = Number(readField(output, "UPTIME").split(/\s+/)[0]);
  const load = readField(output, "LOAD")
    .split(/\s+/)
    .slice(0, 3)
    .join("/");
  return {
    battery: battery ? `${battery}%` : "-",
    batteryTemp: batteryTemp
      ? `${(Number(batteryTemp) / 10).toFixed(1)} °C`
      : "-",
    load: load || "-",
    uptime: formatUptime(uptimeSeconds),
    cpuUsage: readCpuUsage(readField(output, "STAT")),
    network: readNetwork(readBlock(output, "NET")),
    memoryUsage: readMemoryUsage(output),
  };
}

export async function getDeviceStats(serial: string): Promise<DeviceStats> {
  const result = await runDeviceTool("adb", [
    "-s",
    serial,
    "shell",
    DEVICE_STATS_SCRIPT,
  ]);
  return parseDeviceStats(result.stdout);
}

async function runChecked(
  serial: string | null,
  args: string[],
): Promise<ToolOutput> {
  const result = await runDeviceTool(
    "adb",
    serial ? ["-s", serial, ...args] : args,
  );
  if (result.code !== 0) {
    throw new Error(
      (result.stderr || result.stdout).trim() || "adb 命令执行失败",
    );
  }
  return result;
}

// 列出已安装应用（包含系统应用，由前端按需过滤）
export async function listPackages(serial: string): Promise<AppEntry[]> {
  const result = await runChecked(serial, ["shell", "pm list packages -f"]);
  const disabledResult = await runChecked(serial, [
    "shell",
    "pm list packages -d",
  ]);
  const disabled = new Set(
    disabledResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("package:"))
      .map((line) => line.slice("package:".length)),
  );
  const systemPrefixes = [
    "/system/",
    "/system_ext/",
    "/product/",
    "/vendor/",
    "/odm/",
    "/apex/",
  ];
  const apps: AppEntry[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^package:(.+)=([^=]+)$/);
    if (!match) {
      continue;
    }
    const [, apkPath, packageName] = match;
    apps.push({
      packageName,
      apkPath,
      system: systemPrefixes.some((prefix) => apkPath.startsWith(prefix)),
      disabled: disabled.has(packageName),
    });
  }
  return apps.sort((a, b) => a.packageName.localeCompare(b.packageName));
}

export async function installApk(
  serial: string,
  apkPath: string,
): Promise<string> {
  const result = await runChecked(serial, ["install", "-r", apkPath]);
  return result.stdout.trim() || result.stderr.trim() || "安装完成";
}

export async function uninstallPackage(
  serial: string,
  app: AppEntry,
): Promise<string> {
  const result = app.system
    ? await runChecked(serial, [
        "shell",
        `pm uninstall --user 0 ${shellQuote(app.packageName)}`,
      ])
    : await runChecked(serial, ["uninstall", app.packageName]);
  return result.stdout.trim() || result.stderr.trim() || "卸载完成";
}

export async function getAppMetadata(
  serial: string,
  apkPath: string,
): Promise<AppMetadata> {
  if (!inTauri) {
    return { label: null, icon: null, iconBackground: null };
  }
  return invoke<AppMetadata>("get_app_metadata", { serial, apkPath });
}

export async function setPackageEnabled(
  serial: string,
  packageName: string,
  enabled: boolean,
): Promise<string> {
  const command = enabled
    ? `pm enable ${shellQuote(packageName)}`
    : `pm disable-user --user 0 ${shellQuote(packageName)}`;
  const result = await runChecked(serial, ["shell", command]);
  return result.stdout.trim() || result.stderr.trim() || "操作完成";
}

export async function pullFile(
  serial: string,
  remotePath: string,
  localPath: string,
): Promise<string> {
  const result = await runChecked(serial, [
    "pull",
    remotePath,
    localPath,
  ]);
  return result.stdout.trim() || "下载完成";
}

export async function pushFiles(
  serial: string,
  paths: string[],
  remoteDirectory: string,
): Promise<string> {
  const result = await runChecked(serial, [
    "push",
    ...paths,
    remoteDirectory,
  ]);
  return result.stdout.trim() || "上传完成";
}

export function parseLsLine(
  line: string,
  directory: string,
): FileEntry | null {
  const match = line.match(
    /^([dl-])[rwx-]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(.+)$/,
  );
  if (!match) {
    return null;
  }
  const rest = match[3];
  const time = rest.match(/(\d{2}:\d{2})\s+(.*)$/);
  if (!time) {
    return null;
  }
  const name = time[2].split(" -> ")[0];
  if (name === "." || name === ".." || name === "") {
    return null;
  }
  return {
    name,
    path: joinRemotePath(directory, name),
    isDir: match[1] === "d",
    size: Number(match[2]),
    modified: rest.slice(0, rest.length - time[0].length).trim(),
  };
}

export async function listDirectory(
  serial: string,
  directory: string,
  root = false,
): Promise<FileEntry[]> {
  // 末尾加 /，确保符号链接目录（如 /sdcard）列出的是内容而不是链接本身
  const target = directory.endsWith("/") ? directory : `${directory}/`;
  const listing = `ls -laL ${shellQuote(target)}`;
  const result = await runChecked(serial, [
    "shell",
    root ? `su -c ${shellQuote(listing)}` : listing,
  ]);
  return result.stdout
    .split(/\r?\n/)
    .map((line) => parseLsLine(line, directory))
    .filter((entry): entry is FileEntry => entry !== null)
    .sort((a, b) => {
      if (a.isDir !== b.isDir) {
        return a.isDir ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
}

export async function deleteRemotePath(
  serial: string,
  path: string,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `rm -rf ${shellQuote(path)}`,
  ]);
  return result.stdout.trim() || "删除完成";
}

export async function renameRemotePath(
  serial: string,
  from: string,
  to: string,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `mv ${shellQuote(from)} ${shellQuote(to)}`,
  ]);
  return result.stdout.trim() || "重命名完成";
}

export async function createRemoteDirectory(
  serial: string,
  path: string,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `mkdir -p ${shellQuote(path)}`,
  ]);
  return result.stdout.trim() || "目录已创建";
}

export async function copyRemotePath(
  serial: string,
  from: string,
  to: string,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `cp -r ${shellQuote(from)} ${shellQuote(to)}`,
  ]);
  return result.stdout.trim() || "复制完成";
}

export async function moveRemotePath(
  serial: string,
  from: string,
  to: string,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `mv ${shellQuote(from)} ${shellQuote(to)}`,
  ]);
  return result.stdout.trim() || "移动完成";
}

export async function fetchLogcat(
  serial: string,
  lines: number,
): Promise<string> {
  const result = await runChecked(serial, [
    "logcat",
    "-d",
    "-v",
    "time",
    "-t",
    String(lines),
  ]);
  return result.stdout;
}

export async function pairDevice(
  address: string,
  code: string,
): Promise<string> {
  const result = await runChecked(null, ["pair", address.trim(), code.trim()]);
  return result.stdout.trim() || result.stderr.trim() || "配对完成";
}

export async function getToolVersions(): Promise<{
  adb: string;
  fastboot: string;
}> {
  const adb = await runDeviceTool("adb", ["version"]);
  const fastboot = await runDeviceTool("fastboot", ["--version"]);
  return {
    adb: (adb.stdout || adb.stderr).trim() || "不可用",
    fastboot: (fastboot.stdout || fastboot.stderr).trim() || "不可用",
  };
}

// 重启 adb 服务，用于连接异常后的恢复
export async function restartAdb(): Promise<string> {
  await runDeviceTool("adb", ["kill-server"]);
  const result = await runDeviceTool("adb", ["start-server"]);
  return (
    (result.stdout || result.stderr).trim() || "ADB 服务已重启"
  );
}

export async function saveTextFile(
  path: string,
  contents: string,
): Promise<string> {
  if (inTauri) {
    return invoke<string>("save_text_file", { path, contents });
  }
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = path.split(/[\\/]/).pop() || "logcat.txt";
  anchor.click();
  URL.revokeObjectURL(url);
  return path;
}

// 屏幕预览：返回可直接用于 <img> 的 data URL
export async function captureScreen(
  serial: string | null,
): Promise<string> {
  if (!inTauri) {
    throw new Error("浏览器开发模式不支持屏幕预览");
  }
  return invoke<string>("capture_screen", { serial });
}

export async function tapScreen(
  serial: string,
  x: number,
  y: number,
): Promise<void> {
  await runChecked(serial, [
    "shell",
    `input tap ${Math.round(x)} ${Math.round(y)}`,
  ]);
}

// 录屏指定秒数并保存到电脑
export async function recordScreen(
  serial: string,
  directory: string,
  seconds: number,
): Promise<string> {
  if (!inTauri) {
    throw new Error("浏览器开发模式不支持录屏");
  }
  return invoke<string>("record_screen", { serial, directory, seconds });
}

// 启动 scrcpy 投屏（需要 tools/scrcpy.exe）
export async function launchScrcpy(
  serial: string | null,
  recordPath: string | null = null,
): Promise<void> {
  if (!inTauri) {
    throw new Error("浏览器开发模式不支持 scrcpy");
  }
  await invoke("launch_scrcpy", { serial, recordPath });
}

// 安装 APK / APKS / XAPK
export async function installPackage(
  serial: string,
  path: string,
): Promise<string> {
  if (!inTauri) {
    throw new Error("浏览器开发模式不支持该安装方式");
  }
  return invoke<string>("install_package", { serial, path });
}

export interface FilePreview {
  mime: string;
  data: string;
  size: number;
}

// 预览设备文件（base64）
export async function readDeviceFile(
  serial: string,
  path: string,
  maxBytes = 8 * 1024 * 1024,
  root = false,
): Promise<FilePreview> {
  if (!inTauri) {
    throw new Error("浏览器开发模式不支持文件预览");
  }
  return invoke<FilePreview>("read_device_file", {
    serial,
    path,
    maxBytes,
    root,
  });
}

export async function startLogcat(serial: string): Promise<void> {
  if (!inTauri) {
    throw new Error("浏览器开发模式不支持实时日志");
  }
  await invoke("start_logcat", { serial });
}

export async function stopLogcat(): Promise<void> {
  if (!inTauri) {
    return;
  }
  await invoke("stop_logcat");
}

export async function getPackageDetails(
  serial: string,
  packageName: string,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `dumpsys package ${shellQuote(packageName)}`,
  ]);
  return result.stdout;
}

export async function clearPackageData(
  serial: string,
  packageName: string,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `pm clear ${shellQuote(packageName)}`,
  ]);
  return result.stdout.trim() || "已清除数据";
}

export async function forceStopPackage(
  serial: string,
  packageName: string,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `am force-stop ${shellQuote(packageName)}`,
  ]);
  return result.stdout.trim() || "已强制停止";
}

export async function getFastbootVariables(
  serial: string | null,
): Promise<string> {
  const result = await runDeviceTool("fastboot", [
    ...(serial ? ["-s", serial] : []),
    "getvar",
    "all",
  ]);
  return (result.stdout || result.stderr).trim() || "没有返回变量";
}

export async function backupPartition(
  serial: string,
  partition: string,
  directory: string,
): Promise<string> {
  if (!inTauri) {
    throw new Error("浏览器开发模式不支持分区备份");
  }
  return invoke<string>("backup_partition", {
    serial,
    partition,
    directory,
  });
}

// 自动读取设备分区名，优先 /dev/block/by-name
export async function listPartitions(serial: string): Promise<string[]> {
  const commands = [
    "ls /dev/block/by-name 2>/dev/null",
    "su -c 'ls /dev/block/by-name 2>/dev/null'",
    "ls /dev/block/mapper 2>/dev/null",
    "su -c 'ls /dev/block/mapper 2>/dev/null'",
  ];
  const names = new Set<string>();
  for (const command of commands) {
    try {
      const result = await runDeviceTool("adb", [
        "-s",
        serial,
        "shell",
        command,
      ]);
      if (result.code === 0) {
        for (const line of result.stdout.split(/\r?\n/)) {
          const name = line.trim();
          if (name && /^[A-Za-z0-9._-]+$/.test(name)) {
            names.add(name);
          }
        }
      }
    } catch {
      // 某些分区目录不可读时继续尝试下一种方式
    }
    if (names.size > 0 && command.includes("by-name")) {
      break;
    }
  }
  return [...names].sort();
}

export async function inputText(
  serial: string,
  text: string,
): Promise<void> {
  const encoded = text.replace(/ /g, "%s");
  await runChecked(serial, ["shell", `input text ${shellQuote(encoded)}`]);
}

export async function keyEvent(
  serial: string,
  key: string,
): Promise<void> {
  await runChecked(serial, ["shell", `input keyevent ${shellQuote(key)}`]);
}

export async function swipeScreen(
  serial: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  duration = 300,
): Promise<void> {
  await runChecked(serial, [
    "shell",
    `input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(
      x2,
    )} ${Math.round(y2)} ${duration}`,
  ]);
}

export interface ApkInfo {
  package: string;
  versionName: string;
  versionCode: string;
  label: string | null;
  sha256: string;
}

export async function inspectApk(path: string): Promise<ApkInfo> {
  if (!inTauri) {
    throw new Error("浏览器开发模式不支持 APK 检查");
  }
  return invoke<ApkInfo>("inspect_apk", { path });
}

export async function grantPermission(
  serial: string,
  packageName: string,
  permission: string,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `pm grant ${shellQuote(packageName)} ${shellQuote(permission)}`,
  ]);
  return result.stdout.trim() || "已授予";
}

export async function revokePermission(
  serial: string,
  packageName: string,
  permission: string,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `pm revoke ${shellQuote(packageName)} ${shellQuote(permission)}`,
  ]);
  return result.stdout.trim() || "已撤销";
}

export interface DeviceUser {
  id: string;
  name: string;
  current: boolean;
}

export async function listUsers(serial: string): Promise<DeviceUser[]> {
  const result = await runChecked(serial, ["shell", "pm list users"]);
  let current = "0";
  try {
    const currentResult = await runChecked(serial, [
      "shell",
      "am get-current-user",
    ]);
    current = currentResult.stdout.trim();
  } catch {
    // 旧系统可能不支持 get-current-user
  }
  const users: DeviceUser[] = [];
  for (const match of result.stdout.matchAll(/UserInfo\{(\d+):([^:}]+)/g)) {
    users.push({
      id: match[1],
      name: match[2],
      current: match[1] === current,
    });
  }
  return users;
}

export async function switchUser(
  serial: string,
  userId: string,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `am switch-user ${userId}`,
  ]);
  return result.stdout.trim() || `已切换到用户 ${userId}`;
}

export async function createUser(
  serial: string,
  name: string,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `pm create-user ${shellQuote(name)}`,
  ]);
  return result.stdout.trim() || "用户已创建";
}

export async function removeUser(
  serial: string,
  userId: string,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `pm remove-user ${userId}`,
  ]);
  return result.stdout.trim() || `已删除用户 ${userId}`;
}

export interface DisplaySettings {
  size: string;
  density: string;
  windowScale: string;
  transitionScale: string;
  animatorScale: string;
}

export async function getDisplaySettings(
  serial: string,
): Promise<DisplaySettings> {
  const script = [
    "echo __SIZE__",
    "wm size",
    "echo __DENSITY__",
    "wm density",
    "echo __W__",
    "settings get global window_animation_scale",
    "echo __T__",
    "settings get global transition_animation_scale",
    "echo __A__",
    "settings get global animator_duration_scale",
  ].join("; ");
  const result = await runChecked(serial, ["shell", script]);
  const output = result.stdout;
  const section = (key: string) => {
    const match = output.match(
      new RegExp(`__${key}__\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n__|$)`),
    );
    return match?.[1]?.trim() ?? "-";
  };
  return {
    size: section("SIZE"),
    density: section("DENSITY"),
    windowScale: section("W"),
    transitionScale: section("T"),
    animatorScale: section("A"),
  };
}

export async function setDisplaySize(
  serial: string,
  size: string | null,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `wm size ${size ?? "reset"}`,
  ]);
  return result.stdout.trim() || "显示分辨率已更新";
}

export async function setDisplayDensity(
  serial: string,
  density: string | null,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `wm density ${density ?? "reset"}`,
  ]);
  return result.stdout.trim() || "DPI 已更新";
}

export type AnimationScaleKey =
  | "window_animation_scale"
  | "transition_animation_scale"
  | "animator_duration_scale";

export async function setAnimationScale(
  serial: string,
  key: AnimationScaleKey,
  value: string,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `settings put global ${key} ${value}`,
  ]);
  return result.stdout.trim() || "动画缩放已更新";
}

export async function setStayAwake(
  serial: string,
  enabled: boolean,
): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    `svc power stayon ${enabled ? "true" : "false"}`,
  ]);
  return result.stdout.trim() || (enabled ? "已保持常亮" : "已取消常亮");
}

export async function screenOff(serial: string): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    "input keyevent 223",
  ]);
  return result.stdout.trim() || "屏幕已熄灭";
}

export async function forwardList(serial: string): Promise<string> {
  const result = await runDeviceTool("adb", [
    "-s",
    serial,
    "forward",
    "--list",
  ]);
  return (result.stdout || result.stderr).trim() || "没有端口转发规则";
}

export async function addForward(
  serial: string,
  localPort: string,
  remotePort: string,
): Promise<string> {
  const result = await runDeviceTool("adb", [
    "-s",
    serial,
    "forward",
    `tcp:${localPort}`,
    `tcp:${remotePort}`,
  ]);
  return commandResult(result, "端口转发已添加");
}

export async function removeForward(
  serial: string,
  localPort: string,
): Promise<string> {
  const result = await runDeviceTool("adb", [
    "-s",
    serial,
    "forward",
    "--remove",
    `tcp:${localPort}`,
  ]);
  return commandResult(result, "端口转发已移除");
}

export async function addReverse(
  serial: string,
  remotePort: string,
  localPort: string,
): Promise<string> {
  const result = await runDeviceTool("adb", [
    "-s",
    serial,
    "reverse",
    `tcp:${remotePort}`,
    `tcp:${localPort}`,
  ]);
  return commandResult(result, "反向转发已添加");
}

export async function removeReverse(
  serial: string,
  remotePort: string,
): Promise<string> {
  const result = await runDeviceTool("adb", [
    "-s",
    serial,
    "reverse",
    "--remove",
    `tcp:${remotePort}`,
  ]);
  return commandResult(result, "反向转发已移除");
}

export async function mdnsServices(): Promise<string> {
  const result = await runDeviceTool("adb", ["mdns", "services"]);
  return (result.stdout || result.stderr).trim() || "没有发现无线调试服务";
}

export async function connectDevice(address: string): Promise<string> {
  const result = await runDeviceTool("adb", ["connect", address.trim()]);
  return commandResult(result, "连接完成");
}

export async function getProxy(serial: string): Promise<string> {
  const result = await runChecked(serial, [
    "shell",
    "settings get global http_proxy",
  ]);
  const value = result.stdout.trim();
  return value === "" || value === "null" || value === ":0" ? "" : value;
}

export async function setProxy(
  serial: string,
  proxy: string | null,
): Promise<string> {
  const value = proxy && proxy.trim() !== "" ? proxy.trim() : ":0";
  const result = await runChecked(serial, [
    "shell",
    `settings put global http_proxy ${shellQuote(value)}`,
  ]);
  return result.stdout.trim() || (value === ":0" ? "代理已清除" : "代理已设置");
}

export interface FileChecksums {
  md5: string;
  sha256: string;
}

export async function checksumFile(
  serial: string,
  path: string,
  root = false,
): Promise<FileChecksums> {
  const command = `md5sum ${shellQuote(path)}; sha256sum ${shellQuote(path)}`;
  const result = await runChecked(serial, [
    "shell",
    root ? `su -c ${shellQuote(command)}` : command,
  ]);
  const md5 = result.stdout.match(/([a-f0-9]{32})/i)?.[1] ?? "-";
  const sha256 = result.stdout.match(/([a-f0-9]{64})/i)?.[1] ?? "-";
  return { md5, sha256 };
}

export async function writeDeviceFile(
  serial: string,
  path: string,
  content: string,
  root = false,
): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  const command = `echo ${shellQuote(base64)} | base64 -d > ${shellQuote(path)}`;
  const result = await runChecked(serial, [
    "shell",
    root ? `su -c ${shellQuote(command)}` : command,
  ]);
  return result.stdout.trim() || "已保存";
}

export async function extractArchive(
  serial: string,
  archivePath: string,
  destination: string,
  root = false,
): Promise<string> {
  const command = `unzip -o ${shellQuote(archivePath)} -d ${shellQuote(destination)}`;
  const result = await runChecked(serial, [
    "shell",
    root ? `su -c ${shellQuote(command)}` : command,
  ]);
  return result.stdout.trim() || "已解压";
}

export async function compressPaths(
  serial: string,
  paths: string[],
  archivePath: string,
  root = false,
): Promise<string> {
  if (paths.length === 0) {
    throw new Error("没有要打包的文件");
  }
  const files = paths.map((item) => shellQuote(item)).join(" ");
  const command = `tar -cf ${shellQuote(archivePath)} ${files}`;
  const result = await runChecked(serial, [
    "shell",
    root ? `su -c ${shellQuote(command)}` : command,
  ]);
  return result.stdout.trim() || "已打包";
}

function commandResult(
  result: { code: number | null; stdout: string; stderr: string },
  fallback: string,
): string {
  const output = (result.stdout || result.stderr).trim();
  if (result.code !== null && result.code !== 0) {
    throw new Error(output || fallback);
  }
  return output || fallback;
}

export function joinLocalPath(directory: string, name: string): string {
  if (directory.endsWith("\\") || directory.endsWith("/")) {
    return `${directory}${name}`;
  }
  return `${directory}\\${name}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "-";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(1)} ${units[index]}`;
}

export async function rebootDevice(
  serial: string | null,
  mode: RebootMode,
  fastboot = false,
): Promise<void> {
  const args = fastboot
    ? [
        ...(serial ? ["-s", serial] : []),
        ...(mode === "edl"
          ? ["oem", "edl"]
          : ["reboot", ...(mode ? [mode] : [])]),
      ]
    : [...(serial ? ["-s", serial] : []), "reboot", ...(mode ? [mode] : [])];
  const result = await runDeviceTool(fastboot ? "fastboot" : "adb", args);
  if (result.code !== 0) {
    throw new Error(
      (result.stderr || result.stdout).trim() || "重启失败",
    );
  }
}

// 打开带 tools 目录的 CMD / PowerShell 窗口
export async function openTerminal(
  shell: "cmd" | "powershell",
): Promise<void> {
  if (!inTauri) {
    throw new Error("仅桌面应用支持打开终端");
  }
  await invoke("open_terminal", { shell });
}

// 截图并保存到电脑上的指定目录
export async function takeScreenshot(
  serial: string | null,
  directory: string,
): Promise<string> {
  if (inTauri) {
    return invoke<string>("take_screenshot", { serial, directory });
  }

  const response = await fetch("/api/adb/screenshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serial, directory }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, `截图失败: ${response.status}`));
  }
  const data = (await response.json()) as { path: string };
  return data.path;
}

export async function pickFile(
  title: string,
  extensions: string[],
): Promise<string | null> {
  if (!inTauri) {
    return null;
  }
  return invoke<string | null>("pick_file", { title, extensions });
}

export async function pickFiles(
  title: string,
  extensions: string[],
): Promise<string[] | null> {
  if (!inTauri) {
    return null;
  }
  return invoke<string[] | null>("pick_files", { title, extensions });
}

export async function pickDirectory(title: string): Promise<string | null> {
  if (!inTauri) {
    return null;
  }
  return invoke<string | null>("pick_directory", { title });
}
