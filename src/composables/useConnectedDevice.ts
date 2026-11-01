import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  type ComputedRef,
  type Ref,
} from "vue";
import {
  getDeviceStatus,
  type AdbDevice,
  type DeviceMode,
} from "../services/adb";

const MODE_LABELS: Record<DeviceMode, string> = {
  system: "系统",
  recovery: "恢复模式",
  fastboot: "FastBoot",
  "9008": "9008",
  unknown: "未知",
};

export interface ConnectedDevice {
  devices: Ref<AdbDevice[]>;
  onlineDevices: ComputedRef<AdbDevice[]>;
  serial: Ref<string | null>;
  mode: Ref<DeviceMode>;
  modeLabel: ComputedRef<string>;
  connected: ComputedRef<boolean>;
  loading: Ref<boolean>;
  refresh: (preferred?: string | null) => Promise<void>;
  select: (serial: string) => Promise<void>;
}

// 新页面共用：轮询 adb 设备并维护当前设备
export function useConnectedDevice(): ConnectedDevice {
  const devices = ref<AdbDevice[]>([]);
  const serial = ref<string | null>(null);
  const mode = ref<DeviceMode>("unknown");
  const loading = ref(false);

  let timer: number | undefined;
  let stopped = true;
  let busy = false;

  const onlineDevices = computed(() =>
    devices.value.filter((device) => device.state === "device"),
  );
  const modeLabel = computed(() => MODE_LABELS[mode.value] ?? mode.value);
  const connected = computed(
    () => serial.value !== null && mode.value === "system",
  );

  async function refresh(preferred: string | null = serial.value) {
    if (busy) {
      return;
    }
    busy = true;
    loading.value = true;
    try {
      const status = await getDeviceStatus(preferred);
      devices.value = status.devices;
      serial.value = status.serial;
      mode.value = status.mode;
    } catch {
      devices.value = [];
      serial.value = null;
      mode.value = "unknown";
    } finally {
      busy = false;
      loading.value = false;
    }
  }

  async function select(value: string) {
    serial.value = value;
    await refresh(value);
  }

  async function tick() {
    await refresh();
    if (stopped) {
      return;
    }
    timer = window.setTimeout(tick, 3000);
  }

  function stop() {
    stopped = true;
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  }

  function start() {
    stop();
    stopped = false;
    void tick();
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      stop();
    } else {
      start();
    }
  }

  function handlePageHide() {
    stop();
  }

  onMounted(() => {
    start();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
  });

  onBeforeUnmount(() => {
    stop();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pagehide", handlePageHide);
  });

  return {
    devices,
    onlineDevices,
    serial,
    mode,
    modeLabel,
    connected,
    loading,
    refresh,
    select,
  };
}
