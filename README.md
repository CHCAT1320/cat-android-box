<p align="center">
  <img src="src/assets/app-icon.svg" width="112" alt="Cat Android Box" />
</p>

<h1 align="center">Cat Android Box</h1>

<p align="center">A Windows desktop toolbox for Android devices</p>

<p align="center">
  English · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/CHCAT1320/cat-android-box">GitHub</a> ·
  <a href="#origin">Origin</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#features">Features</a> ·
  <a href="#development">Development</a> ·
  <a href="#license">License</a>
</p>

---

Cat Android Box is an Android device toolbox built with **Tauri 2 + Vue 3 + TypeScript + Rust**. It bundles `adb` and `fastboot`, so once a phone is connected you can inspect device information, switch between devices, reboot, install APKs, push files, take screenshots, debug over the network, and more — all in one window.

Every command runs locally; nothing is sent to a server. Results are shown in a dialog and can be copied with one click.

## Origin

[AutumnBox](https://github.com/zsh2401/AutumnBox) is an excellent graphical ADB toolbox, but the original project has been archived and is no longer maintained. Cat Android Box was created as a replacement to keep a similar device-management experience alive, taking inspiration from AutumnBox for its interface structure and feature organization.

This project is a fresh implementation with Tauri, Vue 3, and Rust. In addition to device connection, mode detection, DPM / script activation, and flashing tools, it adds multi-device switching, theming, copyable command output, and other quality-of-life features.

Thanks to AutumnBox and its author for their contributions to this space.

## Features

### Devices

- Detects ADB and FastBoot devices automatically; supports a multi-device list and switching
- Shows manufacturer, model, codename, storage, memory, resolution, DPI, Android version, root status, battery, battery temperature, serial number, CPU, IP address, uptime, load, CPU usage, memory usage, and network rate
- Detects whether the device is in system / recovery / FastBoot mode
- Pauses polling when the page is hidden and refreshes immediately when it returns
- Stops the adb server automatically when the app exits (window close or Ctrl+C)

### App management

- Lists user and system apps with real names and icons (read from the APK on demand; the full installer is not downloaded)
- Search by package name or app name, plus type filtering
- App details, permissions with Chinese descriptions, clear data, force stop
- Install APK / APKS / XAPK; drag-and-drop and batch installation
- Uninstall, disable, or enable apps
- Export APKs to the PC

### File management

- Browse device directories with path navigation and breadcrumbs
- Upload files, or upload in batch to every online device
- Download, rename, delete, and create folders
- Multi-select batch download / copy / move / delete
- Image and text previews, current-directory search, and directory bookmarks

### Logs

- Real-time Logcat stream with pause and clear
- Filter by level, keyword, PID, and tag
- Error / Fatal highlighted in red, Warn in yellow
- Copy or export logs to the PC

### Screen and commands

- Screen preview (about 1.2 s refresh) with tap, swipe, long-press, Back / Home / Recents keys, and text input
- Record up to 180 seconds of screen and save it to the PC (15-second quick recording in the UI)
- Bundled scrcpy (v5.0.1) for one-click screen mirroring — no separate download
- Command panel: run adb shell commands on the current device or all online devices
- Command history, up to 20 entries
- CMD / PowerShell launchers on the right, with `tools` added to `PATH` automatically

### Settings and updates

- Accent color (with a smooth transition) and default download directory
- Environment check: adb / fastboot versions and device count, plus a one-click ADB service restart
- Auto-update powered by `tauri-plugin-updater`

### Quick reboot

Reboot to:

- System
- Recovery
- FastBoot (bootloader)
- 9008 (EDL, for Qualcomm devices)

Every reboot asks for confirmation first.

### Mode-specific actions

**System mode**

- Install APK (file picker)
- Screenshot and save to the PC (directory picker)
- Force-clear all accounts / users (requires root)
- Greenify non-root mode
- Activate ShizukuManager, Brevent, MaxFreeze, and IceBox
- Activate FreezeYou, AirConditionDog, BlackHole, TaiChi, and Island
- Change DPI
- Unlock the system partition
- Activate a second space
- Remove device administrators
- Push files to the device home directory
- And more

**Recovery mode**

- Remove device administrators
- Push files to the device home directory

**FastBoot mode**

- Flash Boot.img
- Flash Recovery
- Re-lock the bootloader

### Network debugging

- Connect a new device by IP:port (`adb connect`)
- Enable network debugging on the current device (`adb tcpip 5555`)
- Disconnect network debugging (`adb disconnect`)
- Android 11+ wireless pairing (`adb pair`)

### FastBoot and backups

- View FastBoot variables (`fastboot getvar all`)
- Auto-detect partitions and back up any partition to an img file via root

### Interaction

- Every action has a confirmation or argument dialog
- Dangerous operations require an explicit checkbox before execution
- Dialogs show the command, stdout, stderr, and exit code, with one-click copy
- Native system pickers for files, multiple files, and directories (inside the Tauri window)
- Regular commands time out after 600 seconds; screenshots after 30 seconds, so the UI cannot hang

## Quick start

### Requirements

- Windows 10 / 11
- [Bun](https://bun.sh/) or npm
- Rust (the toolchain required by Tauri 2)
- WebView2 to run the Tauri app (usually preinstalled on Windows 10/11)

### Install dependencies

```bash
bun install
```

### Run the dev environment

```bash
bun run tauri dev
```

Frontend-only development:

```bash
bun run dev
```

In browser mode, adb is called through a Vite middleware using `tools/adb.exe`, but native file pickers are unavailable, so paths must be entered manually.

### Build

```bash
bun run tauri build
```

Build artifacts are written to `src-tauri/target/release/bundle`.

### Bump the version

```bash
npm run version:set -- 0.1.5
```

This updates `package.json`, `tauri.conf.json`, `Cargo.toml`, and `Cargo.lock`.

## Before use

1. Enable Developer options and USB debugging on the phone.
2. Connect the phone to the PC and allow this computer to debug it.
3. Open the app and confirm the device appears on the Current device page.
4. With multiple devices, select the target device in the right-hand list first.

> If the device shows as `unauthorized`, confirm the authorization prompt on the phone.

## Caveats

The following operations may cause data loss or prevent the device from booting. Always back up first:

- Clearing accounts / users
- Removing device administrators
- Re-locking the bootloader
- Flashing Boot / Recovery images
- Modifying system partitions, DPI, or unlocking the system partition

Other notes:

- DPM activation requires no other accounts, multi-user sessions, or app cloning on the device.
- Script-based activation usually requires installing and opening the target app once on the phone first.
- 9008 mode cannot be detected through adb; check the port in Device Manager.
- Third-party DPM / script commands live in `src/services/deviceActions.ts`; edit them if they do not match your app version.
- The project targets Windows; the `tools` directory contains Windows builds of adb and fastboot.

## Development

### Stack

- Tauri 2
- Vue 3 + TypeScript
- Vite 6
- Rust
- adb / fastboot

### Project layout

```text
.
├─ src/                      # Frontend
│  ├─ composables/
│  │  └─ useConnectedDevice.ts # Shared device polling for new pages
│  ├─ services/
│  │  ├─ adb.ts              # Device status, output parsing, command calls
│  │  ├─ deviceActions.ts    # Mode-specific actions and commands
│  │  ├─ permissions.ts      # Chinese permission descriptions
│  │  └─ settings.ts         # Accent color, default download directory
│  ├─ views/
│  │  ├─ HomeView.vue        # Home, TIPS, project intro
│  │  ├─ DevicesView.vue     # Device page, device list, action dialogs
│  │  ├─ AppsView.vue        # App management
│  │  ├─ FilesView.vue       # File management
│  │  ├─ LogsView.vue        # Logcat
│  │  └─ SettingsView.vue    # Settings, environment check, updates
│  ├─ App.vue                # Top bar, route transitions
│  └─ router/
├─ src-tauri/                # Tauri / Rust
│  ├─ src/
│  │  ├─ adb.rs              # adb / fastboot execution, timeouts, allowlist, screenshots
│  │  └─ lib.rs              # File pickers, command registration, exit cleanup
│  ├─ icons/                 # App icons
│  └─ tauri.conf.json
├─ tools/                    # Bundled adb / fastboot / scrcpy
└─ vite.config.ts            # Browser dev-mode API
```

### Auto-update

The project uses `tauri-plugin-updater` with a GitHub Releases `latest.json` endpoint.

1. The local signing key is at `.tauri/cat-android-box.key` (ignored by git); its public key is stored in `tauri.conf.json`.
2. Add these GitHub Actions secrets to the repository:
   - `TAURI_SIGNING_PRIVATE_KEY`: contents of the private key file
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: key password (leave empty if none)
3. Pushing a `v*` tag enables update signing and uploads `latest.json` plus `.sig` files.
4. Without keys, installers still build, but auto-update is unavailable.

> If the private key is lost, updates for existing versions can no longer be published. Back it up safely.

### Command execution path

- Inside the Tauri window: frontend `invoke` → Rust `run_device_tool` → `tools/adb.exe` / `fastboot.exe`
- Browser dev mode: frontend `fetch` → Vite middleware `/api/adb/exec` → local tools
- Both paths validate allowed subcommands and attach the current device serial (`-s <serial>`)

## Contact

- GitHub: [CHCAT1320/cat-android-box](https://github.com/CHCAT1320/cat-android-box)
- QQ: 1095216448

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 CHCAT1320
