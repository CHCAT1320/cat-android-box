<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";

const GITHUB_URL = "https://github.com/CHCAT1320/cat-android-box";

async function openGithub() {
  try {
    await openUrl(GITHUB_URL);
  } catch {
    window.open(GITHUB_URL, "_blank", "noopener,noreferrer");
  }
}

const tips = [
  "连接设备前，请确保手机已开启 USB 调试并授权本电脑。",
  "右侧设备列表支持多设备切换，所有操作都会自动带上当前设备的序列号。",
  "执行 adb / fastboot 命令后，输出可以在弹窗里一键复制。",
  "快捷重启里的 FastBoot 会重启到 bootloader，9008 适用于高通机型。",
  "安装 APK 失败时，可以先卸载旧版本再重新安装。",
  "截图会以 PNG 格式保存到你选择的电脑目录。",
  "网络调试默认使用 5555 端口，手机和电脑需要处于同一局域网。",
  "清空账号、清除设备管理员等操作风险较高，执行前请先备份。",
  "页面隐藏时会暂停设备轮询，回到页面后会自动刷新。",
  "修改 DPI 前建议记住原数值，方便随时恢复。",
  "设备显示为 unauthorized 时，请在手机上点允许 USB 调试。",
  "FastBoot 模式下 adb 不可用，右侧设备列表会自动识别 FastBoot 设备。",
  "刷入镜像前请确认文件与机型匹配，刷错分区可能导致无法开机。",
  "重新锁定 Bootloader 通常会清除数据，操作前请务必备份。",
  "恢复模式下可以直接删除设备管理员策略文件。",
  "推送文件会保持原文件名，并且支持一次选择多个文件。",
  "绿色守护、黑阈、Shizuku 等脚本激活前，需要先在手机上安装并打开一次对应应用。",
  "DPM 类激活要求设备上没有其他账号、多用户和应用双开。",
  "激活冰箱、小黑屋等应用失败时，失败原因会显示在弹窗输出里。",
  "修改 DPI 后如果界面异常，可以用原数值恢复或直接重启设备。",
  "9008 模式无法通过 adb 检测，需要在设备管理器里确认端口。",
  "截图前请确认保存目录在电脑上真实存在。",
  "执行耗时操作时请保持数据线连接稳定。",
  "使用 adb connect 前，先在设备上开启网络调试并确认 IP 地址。",
  "adb disconnect 会断开所有网络调试连接，请谨慎执行。",
  "同时连接多台设备时，先确认右侧高亮的设备再执行操作。",
  "命令输出里的 [exit code: 0] 表示命令执行成功。",
  "刷机或系统更新过程中不要拔出数据线。",
  "授权电脑后仍无法识别设备时，可以尝试重新插拔 USB 或重启 adb 服务。",
];

const tip = ref(tips[Math.floor(Math.random() * tips.length)]);
let timer: number | undefined;

// 随机切换到另一条提示，避免连续显示同一条
function nextTip() {
  const current = tips.indexOf(tip.value);
  const offset = 1 + Math.floor(Math.random() * (tips.length - 1));
  tip.value = tips[(current + offset) % tips.length];
}

onMounted(() => {
  timer = window.setInterval(nextTip, 5000);
});

onBeforeUnmount(() => {
  window.clearInterval(timer);
});
</script>

<template>
  <section class="page">
    <h1 class="muted">欢迎使用 Cat Android Box</h1>
    <div class="tipsDiv">
      <span class="tips-label">↓TIPS↓</span>
      <p :key="tip" class="tips-text">Tips: {{ tip }}</p>
    </div>
    <div class="selfInfo">
      <h2>关于 Cat Android Box (p≧w≦q)</h2>
      <p>
        Cat Android Box 是一个面向 Android 设备的桌面工具箱，基于 Tauri + Vue 3 +
        TypeScript 构建，内置 adb 与 fastboot，无需额外配置环境。
      </p>
      <p>
        连接设备后，可以在一个窗口里查看设备信息、切换多台设备、快捷重启、安装
        APK、截图保存、推送文件、修改 DPI、开启网络调试，并按系统 / 恢复模式 /
        FastBoot 显示对应操作。所有命令都在本机执行，输出可一键复制。
      </p>
      <p class="selfInfo-tech">Tauri 2 · Rust · Vue 3 · TypeScript · Vite</p>
    </div>

    <div class="selfInfo-links">
      <div
        class="contact-card contact-card-link"
        role="link"
        tabindex="0"
        @click="openGithub"
        @keydown.enter="openGithub"
        @keydown.space.prevent="openGithub"
      >
        <div class="contact-icon-wrap">
          <svg class="contact-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
            />
          </svg>
        </div>
        <div class="contact-body">
          <span class="contact-label">GitHub</span>
          <span class="contact-value">cat-android-box</span>
        </div>
      </div>
      <div class="contact-card">
        <div class="contact-icon-wrap">
          <svg class="contact-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z"
            />
          </svg>
        </div>
        <div class="contact-body">
          <span class="contact-label">QQ</span>
          <span class="contact-value">1095216448</span>
        </div>
      </div>
    </div>

    <p class="copyright">
      Copyright © 2026 Cat Android Box · CHCAT1320. All rights reserved.
    </p>
  </section>
</template>

<style scoped>
  .page {
    text-align: center;
  }
  .tipsDiv {
    width: fit-content;
    max-width: 560px;
    margin: 32px auto 0;
    padding: 16px 20px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #fff;
    text-align: left;
  }
  .tips-label {
    display: block;
    color: var(--accent);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-align: center;
  }
  .selfInfo {
    width: 100%;
    max-width: 720px;
    margin: 20px auto 0;
    padding: 20px 24px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #fff;
    text-align: left;
  }
  .selfInfo h2 {
    margin: 0 0 10px;
    color: var(--accent);
    font-size: 16px;
  }
  .selfInfo p {
    margin: 0 0 10px;
    color: #4b5563;
    font-size: 14px;
    line-height: 1.7;
  }
  .selfInfo p:last-child {
    margin-bottom: 0;
  }
  .selfInfo p.selfInfo-tech {
    color: #9ca3af;
    font-size: 12px;
  }
  .selfInfo-links {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    width: 100%;
    max-width: 720px;
    margin: 12px auto 0;
  }
  .contact-card {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 64px;
    padding: 12px 16px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #fafafa;
    text-align: left;
  }
  .contact-card-link {
    cursor: pointer;
    user-select: none;
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }
  .contact-card-link:hover {
    border-color: var(--accent);
    background: #fff;
  }
  .contact-card-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .contact-icon-wrap {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    flex: none;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #fff;
    color: var(--accent);
  }
  .contact-icon {
    display: block;
    width: 20px;
    height: 20px;
  }
  .contact-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .contact-label {
    color: #6b7280;
    font-size: 12px;
  }
  .contact-value {
    color: var(--accent);
    font-size: 15px;
    font-weight: 500;
    word-break: break-all;
  }
  @media (max-width: 560px) {
    .selfInfo-links {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .copyright {
    margin: 20px 0 24px;
    color: #9ca3af;
    font-size: 12px;
  }
  .tips-text {
    margin: 8px 0 0;
    color: #4b5563;
    font-size: 14px;
    line-height: 1.6;
    animation: tip-in 0.32s ease;
  }
  @keyframes tip-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
