import { reactive, watch } from "vue";

export const ACCENT_COLORS = [
  { name: "红", value: "#ef4444" },
  { name: "橙", value: "#f97316" },
  { name: "黄", value: "#eab308" },
  { name: "绿", value: "#22c55e" },
  { name: "蓝", value: "#3b82f6" },
] as const;

export interface AppSettings {
  accent: string;
  downloadDirectory: string;
  scanTarget: string;
}

const STORAGE_KEY = "cat-android-box-settings";
export const APRIL_FOOLS_OPTOUT_KEY =
  "cat-android-box-april-fools-optout";

const defaults: AppSettings = {
  accent: "random",
  downloadDirectory: "",
  scanTarget: "127.0.0.1",
};

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...defaults };
    }
    const saved = JSON.parse(raw) as Partial<AppSettings>;
    return {
      accent: saved.accent ?? defaults.accent,
      downloadDirectory: saved.downloadDirectory ?? defaults.downloadDirectory,
      scanTarget: saved.scanTarget ?? defaults.scanTarget,
    };
  } catch {
    return { ...defaults };
  }
}

export const settings = reactive<AppSettings>(load());

// 恢复主题、下载目录和 ADB 扫描地址，并清除今日愚人节屏蔽
export function resetSettings() {
  Object.assign(settings, defaults);
  try {
    localStorage.removeItem(APRIL_FOOLS_OPTOUT_KEY);
  } catch {
    // 忽略存储失败
  }
}

watch(
  settings,
  (value) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  },
  { deep: true },
);

// 解析主题色；random 表示每次启动随机取一个
export function resolveAccent(): string {
  if (settings.accent !== "random") {
    return settings.accent;
  }
  const colors = ACCENT_COLORS.map((color) => color.value);
  return colors[Math.floor(Math.random() * colors.length)];
}
