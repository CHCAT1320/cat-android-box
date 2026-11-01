import type { ToolName } from "./adb";

export type ActionInput = "none" | "file" | "files" | "directory" | "text";

export interface ActionArgs {
  path: string;
  paths: string[];
}

export interface DeviceAction {
  id: string;
  label: string;
  mode: "system" | "recovery" | "fastboot";
  input: ActionInput;
  description: string;
  tool: ToolName;
  fileExtensions?: string[];
  screenshot?: boolean;
  // 输入框提示文字
  placeholder?: string;
  // 不附加 -s 序列号（例如 adb connect / disconnect）
  noSerial?: boolean;
  // 执行完成后刷新设备状态
  refreshAfter?: boolean;
  // 危险操作，执行前需要用户勾选确认
  dangerous?: boolean;
  args?: (args: ActionArgs) => string[];
}

const sh = (command: string): string[] => ["shell", command];

const fastbootActions: DeviceAction[] = [
  {
    id: "fastboot-flash-boot",
    label: "刷入Boot.img",
    mode: "fastboot",
    input: "file",
    description: "选择 boot 镜像，执行 fastboot flash boot。",
    tool: "fastboot",
    fileExtensions: ["img"],
    args: ({ path }) => ["flash", "boot", path],
  },
  {
    id: "fastboot-flash-recovery",
    label: "刷入REC",
    mode: "fastboot",
    input: "file",
    description: "选择 recovery 镜像，执行 fastboot flash recovery。",
    tool: "fastboot",
    fileExtensions: ["img"],
    args: ({ path }) => ["flash", "recovery", path],
  },
  {
    id: "fastboot-lock",
    label: "加上BL锁",
    mode: "fastboot",
    input: "none",
    description: "执行 fastboot flashing lock，重新锁定 Bootloader。",
    tool: "fastboot",
    args: () => ["flashing", "lock"],
  },
];

const recoveryActions: DeviceAction[] = [
  {
    id: "recovery-clear-admin",
    label: "清除设备管理员",
    mode: "recovery",
    input: "none",
    description: "删除设备管理员策略文件，重启后生效。",
    tool: "adb",
    args: () =>
      sh(
        "rm -f /data/system/device_policies.xml /data/system/users/0/device_policies.xml",
      ),
  },
  {
    id: "recovery-push",
    label: "推送文件到手机主目录",
    mode: "recovery",
    input: "files",
    description: "选择一个或多个文件，推送到 /sdcard/。",
    tool: "adb",
    args: ({ paths }) => ["push", ...paths, "/sdcard/"],
  },
];

const systemActions: DeviceAction[] = [
  {
    id: "system-install-apk",
    label: "安装APK",
    mode: "system",
    input: "file",
    description: "选择 APK 文件，执行 adb install -r。",
    tool: "adb",
    fileExtensions: ["apk"],
    args: ({ path }) => ["install", "-r", path],
  },
  {
    id: "system-screenshot",
    label: "截图并保存到电脑",
    mode: "system",
    input: "directory",
    description: "选择保存目录，将当前屏幕截图保存为 PNG。",
    tool: "adb",
    screenshot: true,
  },
  {
    id: "system-clear-accounts",
    label: "暴力清空所有账号",
    mode: "system",
    input: "none",
    description: "删除账号数据库，需要 root 权限，操作前请自行备份。",
    tool: "adb",
    args: () =>
      sh(
        "rm -f /data/system/users/0/accounts.db /data/system/users/0/accounts.db-journal",
      ),
  },
  {
    id: "system-clear-users",
    label: "暴力清空所有用户",
    mode: "system",
    input: "none",
    description: "删除多用户数据，需要 root 权限，风险极高。",
    tool: "adb",
    args: () => sh("rm -rf /data/system/users/*"),
  },
  {
    id: "system-greenify",
    label: "绿色守护免ROOT模式",
    mode: "system",
    input: "none",
    description: "给绿色守护授予 WRITE_SECURE_SETTINGS 权限。",
    tool: "adb",
    args: () =>
      sh(
        "pm grant com.oasisfeng.greenify android.permission.WRITE_SECURE_SETTINGS",
      ),
  },
  {
    id: "system-shizuku",
    label: "激活ShizukuManage",
    mode: "system",
    input: "none",
    description: "运行 Shizuku 的 start.sh 启动脚本。",
    tool: "adb",
    args: () =>
      sh(
        "sh /sdcard/Android/data/moe.shizuku.privileged.api/start.sh",
      ),
  },
  {
    id: "system-stopapp-maxwell",
    label: "激活小黑屋麦克斯韦妖模式",
    mode: "system",
    input: "none",
    description: "运行小黑屋的 starter.sh，需先在应用内选择麦克斯韦妖模式。",
    tool: "adb",
    args: () =>
      sh(
        "sh /storage/emulated/0/Android/data/web1n.stopapp/files/starter.sh",
      ),
  },
  {
    id: "system-brevent",
    label: "激活黑阈",
    mode: "system",
    input: "none",
    description: "运行黑阈的 brevent.sh 激活脚本。",
    tool: "adb",
    args: () => sh("sh /data/data/me.piebridge.brevent/brevent.sh"),
  },
  {
    id: "system-dpi",
    label: "修改DPI",
    mode: "system",
    input: "text",
    description: "输入 DPI 数值，例如 420，执行 wm density。",
    tool: "adb",
    placeholder: "输入 DPI 数值，例如 420",
    args: ({ path }) => ["shell", "wm", "density", path],
  },
  {
    id: "system-unlock-system",
    label: "解锁系统分区",
    mode: "system",
    input: "none",
    description: "尝试以读写方式重新挂载 /system，需要 root 权限。",
    tool: "adb",
    args: () => sh("su -c 'mount -o remount,rw /system'"),
  },
  {
    id: "system-second-space",
    label: "激活第二空间",
    mode: "system",
    input: "none",
    description: "通过 pm create-user 创建第二空间用户。",
    tool: "adb",
    args: () => sh("pm create-user SecondSpace"),
  },
  {
    id: "system-freezeyou",
    label: "激活FreezeYou",
    mode: "system",
    input: "none",
    description: "将 FreezeYou 设为设备管理员（DPM 模式）。",
    tool: "adb",
    args: () =>
      sh(
        "dpm set-device-owner cf.playhi.freezeyou/.FDDeviceAdminReceiver",
      ),
  },
  {
    id: "system-airfrozen",
    label: "激活空调狗",
    mode: "system",
    input: "none",
    description: "将空调狗设为设备管理员（DPM 模式）。",
    tool: "adb",
    args: () =>
      sh(
        "dpm set-device-owner me.yourbay.airfrozen/.AdminReceiver",
      ),
  },
  {
    id: "system-blackhole",
    label: "激活黑洞",
    mode: "system",
    input: "none",
    description: "将黑洞设为设备管理员（DPM 模式）。",
    tool: "adb",
    args: () =>
      sh(
        "dpm set-device-owner com.hld.apurikakusu/.AdminReceiver",
      ),
  },
  {
    id: "system-taichi",
    label: "一键激活太极阴阳门",
    mode: "system",
    input: "none",
    description: "将太极设为设备管理员，激活阴阳门模式。",
    tool: "adb",
    args: () =>
      sh(
        "dpm set-device-owner me.weishu.exp/.TaiChiDeviceAdmin",
      ),
  },
  {
    id: "system-island",
    label: "一键激活岛",
    mode: "system",
    input: "none",
    description: "将岛设为设备管理员。",
    tool: "adb",
    args: () =>
      sh(
        "dpm set-device-owner com.oasisfeng.island/.IslandDeviceAdminReceiver",
      ),
  },
  {
    id: "system-icebox",
    label: "激活冰箱",
    mode: "system",
    input: "none",
    description: "运行冰箱的 start.sh 激活脚本。",
    tool: "adb",
    args: () =>
      sh(
        "sh /sdcard/Android/data/com.catchingnow.icebox/files/start.sh",
      ),
  },
  {
    id: "system-stopapp",
    label: "激活小黑屋",
    mode: "system",
    input: "none",
    description: "运行小黑屋的 starter.sh 激活脚本。",
    tool: "adb",
    args: () =>
      sh(
        "sh /storage/emulated/0/Android/data/web1n.stopapp/files/starter.sh",
      ),
  },
  {
    id: "system-clear-admin",
    label: "清除设备管理员",
    mode: "system",
    input: "none",
    description: "删除设备管理员策略文件，需要 root 权限。",
    tool: "adb",
    args: () =>
      sh(
        "su -c 'rm -f /data/system/device_policies.xml /data/system/users/0/device_policies.xml'",
      ),
  },
  {
    id: "system-push",
    label: "推送文件到手机主目录",
    mode: "system",
    input: "files",
    description: "选择一个或多个文件，推送到 /sdcard/。",
    tool: "adb",
    args: ({ paths }) => ["push", ...paths, "/sdcard/"],
  },
];

export const deviceActions: DeviceAction[] = [
  ...systemActions,
  ...recoveryActions,
  ...fastbootActions,
].map((action) =>
  [
    "fastboot-flash-boot",
    "fastboot-flash-recovery",
    "fastboot-lock",
    "recovery-clear-admin",
    "system-clear-admin",
    "system-clear-accounts",
    "system-clear-users",
    "system-unlock-system",
  ].includes(action.id)
    ? { ...action, dangerous: true }
    : action,
);

// 右侧栏的网络调试操作
export const networkConnectAction: DeviceAction = {
  id: "network-connect",
  label: "网络连接新设备",
  mode: "system",
  input: "text",
  description: "输入设备 IP 和端口，例如 192.168.1.100:5555。",
  tool: "adb",
  placeholder: "IP:端口，例如 192.168.1.100:5555",
  noSerial: true,
  refreshAfter: true,
  args: ({ path }) => ["connect", path.trim()],
};

export const networkTcpipAction: DeviceAction = {
  id: "network-tcpip",
  label: "开启当前设备网络调试",
  mode: "system",
  input: "none",
  description: "执行 adb tcpip 5555，将当前设备切换到网络调试模式。",
  tool: "adb",
  refreshAfter: true,
  args: () => ["tcpip", "5555"],
};

export const networkDisconnectAction: DeviceAction = {
  id: "network-disconnect",
  label: "断开当前设备网络连接",
  mode: "system",
  input: "none",
  description: "执行 adb disconnect，断开所有网络调试连接。",
  tool: "adb",
  noSerial: true,
  refreshAfter: true,
  args: () => ["disconnect"],
};

export function actionsForMode(mode: string): DeviceAction[] {
  return deviceActions.filter((action) => action.mode === mode);
}
