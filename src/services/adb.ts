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
  "echo DISK:$(df -k /data | tail -n 1)",
  "echo SU:$(which su)",
  "echo UID:$(id -u)",
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
    case "":
    case "unknown":
      // 部分设备的 ro.bootmode 固定返回 unknown，用开机完成标记兜底
      return bootCompleted.trim() === "1" ? "system" : "unknown";
    default:
      return "unknown";
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
  };
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

// 一次轮询获取 adb 设备、当前设备和启动模式
export async function getDeviceStatus(
  preferredSerial: string | null = null,
): Promise<DeviceStatus> {
  const adbResult = await runDeviceTool("adb", ["devices"]);
  const devices = parseAdbDevices(adbResult.stdout);
  const onlineDevices = devices.filter((device) => device.state === "device");
  const online =
    onlineDevices.find((device) => device.serial === preferredSerial) ??
    onlineDevices[0] ??
    null;

  if (online) {
    const props = await runDeviceTool("adb", [
      "-s",
      online.serial,
      "shell",
      "getprop ro.bootmode; getprop sys.boot_completed",
    ]);
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

export async function rebootDevice(
  serial: string | null,
  mode: RebootMode,
): Promise<void> {
  const args = [
    ...(serial ? ["-s", serial] : []),
    "reboot",
    ...(mode ? [mode] : []),
  ];
  const result = await runDeviceTool("adb", args);
  if (result.code !== 0) {
    throw new Error(
      (result.stderr || result.stdout).trim() || "重启失败",
    );
  }
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
