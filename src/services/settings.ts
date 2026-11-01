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
}

const STORAGE_KEY = "cat-android-box-settings";

const defaults: AppSettings = {
  accent: "random",
  downloadDirectory: "",
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
    };
  } catch {
    return { ...defaults };
  }
}

export const settings = reactive<AppSettings>(load());

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
