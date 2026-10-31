<p align="center">
  <img src="src/assets/app-icon.svg" width="112" alt="Cat Android Box" />
</p>

<h1 align="center">Cat Android Box</h1>

<p align="center">面向 Android 设备的 Windows 桌面工具箱</p>

<p align="center">
  <a href="https://github.com/CHCAT1320/cat-android-box">GitHub</a> ·
  <a href="#项目由来">项目由来</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#功能">功能</a> ·
  <a href="#开发">开发</a> ·
  <a href="#license">License</a>
</p>

---

Cat Android Box 是一个基于 **Tauri 2 + Vue 3 + TypeScript + Rust** 的 Android 设备工具箱，内置 `adb` 与 `fastboot`，连接手机后即可在同一个窗口里完成设备信息查看、多设备切换、快捷重启、安装 APK、文件推送、截图、网络调试等操作。

所有命令都在本机执行，不经过任何服务器；执行结果会在弹窗中显示，并可一键复制。

## 项目由来

[AutumnBox（秋之盒）](https://github.com/zsh2401/AutumnBox) 是一个优秀的图形化 ADB 工具箱，但原项目已经归档，不再继续维护。为了让类似的设备管理体验继续存在，Cat Android Box 作为替代品诞生，并在界面结构与功能组织上借鉴了 AutumnBox 的思路。

本项目使用 Tauri + Vue 3 + Rust 重新实现，除保留设备连接、模式识别、DPM / 脚本激活、刷机等常见能力外，还补充了多设备切换、主题化界面、可复制的命令输出等交互。

感谢 AutumnBox 及其作者为这个领域做出的贡献。

## 功能

### 设备

- 自动识别 ADB 设备与 FastBoot 设备，支持多设备列表与切换
- 显示厂商、型号、代号、存储、内存、分辨率、DPI、Android 版本、Root 状态
- 自动判断设备处于系统 / 恢复模式 / FastBoot
- 页面隐藏时暂停轮询，回到页面后立即刷新
- 退出应用（窗口叉号或 Ctrl+C）时自动停止 adb 服务

### 快捷重启

支持重启到：

- 系统
- 恢复模式（recovery）
- FastBoot（bootloader）
- 9008（EDL，适用于高通机型）

所有重启操作都会先弹出确认窗口。

### 按模式显示的功能

**系统模式**

- 安装 APK（文件选择）
- 截图并保存到电脑（目录选择）
- 暴力清空所有账号 / 用户（需要 root）
- 绿色守护免 ROOT 模式
- 激活 ShizukuManager、黑阈、小黑屋（麦克斯韦妖模式）、冰箱
- 激活 FreezeYou、空调狗、黑洞、太极阴阳门、岛
- 修改 DPI
- 解锁系统分区
- 激活第二空间
- 清除设备管理员
- 推送文件到手机主目录
- 更多

**恢复模式**

- 清除设备管理员
- 推送文件到手机主目录

**FastBoot 模式**

- 刷入 Boot.img
- 刷入 Recovery
- 重新锁定 Bootloader

### 网络调试

- 通过 IP:端口连接新设备（`adb connect`）
- 开启当前设备网络调试（`adb tcpip 5555`）
- 断开网络调试连接（`adb disconnect`）

### 交互

- 所有操作都有确认 / 参数弹窗
- 弹窗内展示命令、stdout、stderr、退出码，可一键复制
- 文件、多文件、保存目录使用系统原生选择框（Tauri 窗口内）
- 普通命令统一 600 秒超时、截图 30 秒超时，避免卡死

## 快速开始

### 环境要求

- Windows 10 / 11
- [Bun](https://bun.sh/) 或 npm
- Rust（安装 Tauri 2 所需工具链）
- 运行 Tauri 应用需要 WebView2（Windows 10/11 通常已自带）

### 安装依赖

```bash
bun install
```

### 启动开发环境

```bash
bun run tauri dev
```

只调试前端页面：

```bash
bun run dev
```

浏览器模式下会通过 Vite 中间件调用 `tools/adb.exe`，但原生文件选择框不可用，需要手动填写文件或目录路径。

### 构建

```bash
bun run tauri build
```

构建产物位于 `src-tauri/target/release/bundle`。

## 使用前准备

1. 在手机上开启「开发者选项」与「USB 调试」
2. 使用数据线连接电脑，并在手机上允许本电脑调试
3. 打开应用，在「当前设备」页确认设备已被识别
4. 多设备时，先在右侧设备列表选中要操作的设备

> 设备显示为 `unauthorized` 时，请在手机上确认授权弹窗。

## 注意事项

以下操作可能造成数据丢失或设备无法开机，请务必先备份：

- 清空账号 / 用户
- 清除设备管理员
- 重新锁定 Bootloader
- 刷入 Boot / Recovery 镜像
- 修改系统分区、DPI、解锁系统分区

其他说明：

- DPM 类激活要求设备上没有其他账号、多用户和应用双开
- 脚本类激活通常需要先在手机上安装并打开一次对应应用
- 9008 模式无法通过 adb 检测，需要在设备管理器中确认端口
- 第三方应用的 DPM / 脚本命令集中在 `src/services/deviceActions.ts`，如与你的应用版本不一致，可直接修改
- 目前主要面向 Windows，`tools` 目录内为 Windows 版 adb / fastboot

## 开发

### 技术栈

- Tauri 2
- Vue 3 + TypeScript
- Vite 6
- Rust
- adb / fastboot

### 目录结构

```text
.
├─ src/                      # 前端
│  ├─ services/
│  │  ├─ adb.ts              # 设备状态、输出解析、命令调用
│  │  └─ deviceActions.ts    # 各模式功能与命令定义
│  ├─ views/
│  │  ├─ HomeView.vue        # 首页、TIPS、项目介绍
│  │  └─ DevicesView.vue     # 设备页、设备列表、功能弹窗
│  ├─ App.vue                # 顶栏、路由切换动画
│  └─ router/
├─ src-tauri/                # Tauri / Rust
│  ├─ src/
│  │  ├─ adb.rs              # adb / fastboot 执行、超时、白名单、截图
│  │  └─ lib.rs              # 文件选择、命令注册、退出清理
│  ├─ icons/                 # 应用图标
│  └─ tauri.conf.json
├─ tools/                    # 内置 adb / fastboot
└─ vite.config.ts            # 浏览器开发模式接口
```

### 命令执行链路

- Tauri 窗口内：前端 `invoke` → Rust `run_device_tool` → `tools/adb.exe` / `fastboot.exe`
- 浏览器开发模式：前端 `fetch` → Vite 中间件 `/api/adb/exec` → 本机工具
- 两端都会校验允许的子命令，并附加当前设备序列号（`-s <serial>`）

## 联系

- GitHub：[CHCAT1320/cat-android-box](https://github.com/CHCAT1320/cat-android-box)
- QQ：1095216448

## License

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE)：

- 允许个人学习、研究、测试、业余项目，以及慈善、教育、公共研究、政府等非商业组织使用
- 禁止任何商业用途；商业授权请联系 QQ 1095216448

Copyright © 2026 Cat Android Box · CHCAT1320. All rights reserved.
