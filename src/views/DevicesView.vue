<template>
    <div class="devices-layout">
        <section class="page">
            <h1 v-if="isDevicesLink">当前设备已连接</h1>
            <h1 v-if="!isDevicesLink">当前未连接设备</h1>
            <p class="muted" v-if="!isDevicesLink">请确保设备已连接并授权。</p>
            <p v-if="isDevicesLink">
                当前设备处于
                <span class="device-mode">{{ deviceModeLabel }}</span>
                状态
            </p>
            <div
                v-if="isDevicesLink && deviceMode !== 'fastboot'"
                class="deviceInfo"
            >
                <p
                    v-for="row in infoRows"
                    :key="row.label"
                    class="deviceInfo-item"
                >
                    <span class="deviceInfo-label">{{ row.label }}</span>
                    <span class="deviceInfo-value">{{ row.value }}</span>
                </p>
            </div>
            <div v-if="isDevicesLink" class="rebotActions">
                <p>快捷重启</p>
                <button
                    v-for="action in rebootActions"
                    :key="action.label"
                    @click="openDialog(action)"
                >
                    {{ action.label }}
                </button>
            </div>
            <div v-if="isDevicesLink" class="whenDeviceInMode">
                <p>
                    ↓设备处于
                    <span class="device-mode">{{ deviceModeLabel }}</span>
                    状态时可用以下功能↓
                </p>
            </div>
            <div v-if="modeActions.length > 0" class="modeActions">
                <button
                    v-for="action in modeActions"
                    :key="action.id"
                    class="mode-action"
                    @click="openAction(action)"
                >
                    {{ action.label }}
                </button>
            </div>

            <div v-if="pending" class="dialog-mask" @click.self="closeDialog">
                <div class="dialog" role="dialog" aria-modal="true">
                    <h2>确认重启</h2>
                    <p>是否将设备重启到“{{ pending.label }}”？</p>
                    <p v-if="rebootError" class="dialog-error">
                        {{ rebootError }}
                    </p>
                    <div class="dialog-actions">
                        <button
                            class="dialog-cancel"
                            :disabled="rebooting"
                            @click="closeDialog"
                        >
                            取消
                        </button>
                        <button
                            class="dialog-confirm"
                            :disabled="rebooting"
                            @click="confirmReboot"
                        >
                            {{ rebooting ? "重启中..." : "确定重启" }}
                        </button>
                    </div>
                </div>
            </div>

            <div v-if="activeAction" class="dialog-mask" @click.self="closeAction">
                <div class="dialog action-dialog" role="dialog" aria-modal="true">
                    <h2>{{ activeAction.label }}</h2>
                    <p class="action-desc">{{ activeAction.description }}</p>

                    <div
                        v-if="
                            activeAction.input !== 'none' &&
                            activeAction.input !== 'files'
                        "
                        class="action-input"
                    >
                        <input
                            v-model="actionPath"
                            :placeholder="inputPlaceholder"
                            :disabled="actionRunning"
                        />
                        <button
                            v-if="runningInTauri && activeAction.input !== 'text'"
                            class="action-pick"
                            :disabled="actionRunning"
                            @click="selectPath"
                        >
                            {{
                                activeAction.input === "directory"
                                    ? "选择目录"
                                    : "选择文件"
                            }}
                        </button>
                    </div>

                    <div
                        v-if="activeAction.input === 'files'"
                        class="action-input"
                    >
                        <textarea
                            v-model="actionPathsText"
                            rows="3"
                            placeholder="每行一个文件路径"
                            :disabled="actionRunning"
                        ></textarea>
                        <button
                            v-if="runningInTauri"
                            class="action-pick"
                            :disabled="actionRunning"
                            @click="selectPaths"
                        >
                            选择文件
                        </button>
                    </div>

                    <div v-if="actionOutput" class="output-panel">
                        <pre>{{ actionOutput }}</pre>
                        <button class="copy-button" @click="copyOutput">
                            复制输出
                        </button>
                    </div>

                    <div class="dialog-actions">
                        <button
                            class="dialog-cancel"
                            :disabled="actionRunning"
                            @click="closeAction"
                        >
                            关闭
                        </button>
                        <button
                            class="dialog-confirm"
                            :disabled="!canRunAction"
                            @click="runAction"
                        >
                            {{ actionRunning ? "执行中..." : "执行" }}
                        </button>
                    </div>
                </div>
            </div>
            <div v-if="showTerminalHelp" class="dialog-mask" @click.self="showTerminalHelp = false">
                <div class="dialog" role="dialog" aria-modal="true">
                    <h2>命令行</h2>
                    <p class="help-text">
                        CMD 和 PowerShell 会分别打开一个新的命令行窗口，并自动把
                        tools 目录加入 PATH。你可以直接输入 adb、fastboot
                        等命令，操作结果会显示在窗口里。
                    </p>
                    <div class="dialog-actions">
                        <button
                            class="dialog-confirm"
                            @click="showTerminalHelp = false"
                        >
                            知道了
                        </button>
                    </div>
                </div>
            </div>
        </section>

        <aside class="sidebar">
            <div class="sidebar-title">设备列表</div>
            <div class="sidebar-devices">
                <p v-if="deviceEntries.length === 0" class="sidebar-empty">
                    没有设备连接
                </p>
                <template v-else>
                    <button
                        v-for="entry in deviceEntries"
                        :key="entry.key"
                        class="device-entry"
                        :class="{ active: entry.key === activeSerial }"
                        @click="selectDevice(entry)"
                    >
                        <span class="device-entry-name">{{
                            entry.serial
                        }}</span>
                        <span class="device-entry-kind">{{
                            entry.kind === "fastboot" ? "FastBoot" : "ADB"
                        }}</span>
                    </button>
                </template>
            </div>
            <div class="sidebar-divider"></div>
            <div class="sidebar-network">
                <button
                    class="network-connect"
                    @click="openAction(networkConnectAction)"
                >
                    网络连接新设备
                </button>
                <button
                    class="network-action"
                    :disabled="!isAdbConnected"
                    @click="openAction(networkTcpipAction)"
                >
                    开启当前设备网络调试
                </button>
                <button
                    class="network-action"
                    :disabled="!isDevicesLink"
                    @click="openAction(networkDisconnectAction)"
                >
                    断开当前设备网络连接
                </button>
            </div>
            <div class="sidebar-divider"></div>
            <div class="sidebar-terminal">
                <div class="terminal-title">
                    <span>命令行</span>
                    <button
                        class="terminal-help"
                        type="button"
                        aria-label="命令行说明"
                        @click="showTerminalHelp = true"
                    >
                        ?
                    </button>
                </div>
                <div class="terminal-actions">
                    <button
                        class="terminal-button"
                        :disabled="!runningInTauri"
                        @click="launchTerminal('cmd')"
                    >
                        CMD
                    </button>
                    <button
                        class="terminal-button"
                        :disabled="!runningInTauri"
                        @click="launchTerminal('powershell')"
                    >
                        PowerShell
                    </button>
                </div>
                <p v-if="terminalError" class="terminal-error">
                    {{ terminalError }}
                </p>
            </div>
        </aside>
    </div>
</template>
<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, ref } from "vue";
    import {
        getDeviceInfo,
        getDeviceStatus,
        openTerminal,
        pickDirectory,
        pickFile,
        pickFiles,
        rebootDevice,
        runDeviceTool,
        runningInTauri,
        takeScreenshot,
        type AdbDevice,
        type DeviceInfo,
        type DeviceMode,
        type RebootMode,
        type ToolOutput,
    } from "../services/adb";
    import {
        actionsForMode,
        networkConnectAction,
        networkDisconnectAction,
        networkTcpipAction,
        type DeviceAction,
    } from "../services/deviceActions";

    // 轮询间隔：连接后更快，未连接时放慢
    const POLL_CONNECTED = 2000;
    const POLL_DISCONNECTED = 3000;

    // 是否检测到可操作的设备（含 fastboot）
    const isDevicesLink = ref(false);
    // adb 是否连接（fastboot 下为 false）
    const isAdbConnected = ref(false);
    // 设备当前所处的启动模式
    const deviceMode = ref<DeviceMode>("unknown");
    // 当前操作的 adb / fastboot 序列号
    const activeSerial = ref<string | null>(null);
    // 用户选中的设备，下一次轮询优先返回它
    const preferredSerial = ref<string | null>(null);
    // 最近一次轮询到的设备列表
    const statusDevices = ref<AdbDevice[]>([]);
    const fastbootDevices = ref<string[]>([]);
    // 设备硬件与系统信息，按序列号只获取一次
    const deviceInfo = ref<DeviceInfo | null>(null);
    const deviceInfoSerial = ref<string | null>(null);

    let timer: number | undefined;
    let stopped = true;
    // 防止上一次检测未返回时重复发起请求
    let refreshing = false;

    // 模式标识对应的展示文案
    const MODE_LABELS: Record<DeviceMode, string> = {
        system: "系统",
        recovery: "恢复模式",
        fastboot: "FastBoot",
        "9008": "9008",
        unknown: "未知",
    };

    const deviceModeLabel = computed(
        () => MODE_LABELS[deviceMode.value] ?? deviceMode.value,
    );

    interface DeviceEntry {
        key: string;
        serial: string;
        kind: "adb" | "fastboot";
    }

    // 右侧设备列表：在线 adb 设备 + fastboot 设备
    const deviceEntries = computed<DeviceEntry[]>(() => [
        ...statusDevices.value
            .filter((device) => device.state === "device")
            .map((device) => ({
                key: device.serial,
                serial: device.serial,
                kind: "adb" as const,
            })),
        ...fastbootDevices.value.map((serial) => ({
            key: serial,
            serial,
            kind: "fastboot" as const,
        })),
    ]);

    // 当前模式可用的功能按钮
    const modeActions = computed(() => actionsForMode(deviceMode.value));

    // 按三列布局展示的设备信息
    const infoRows = computed(() => {
        const info = deviceInfo.value;
        return [
            { label: "厂商", value: info?.manufacturer ?? "-" },
            { label: "存储分区", value: info?.storage ?? "-" },
            { label: "Root", value: info?.root ?? "-" },
            { label: "型号", value: info?.model ?? "-" },
            { label: "运行内存", value: info?.memory ?? "-" },
            { label: "Android", value: info?.android ?? "-" },
            { label: "代号", value: info?.codename ?? "-" },
            { label: "分辨率", value: info?.resolution ?? "-" },
            { label: "DPI", value: info?.dpi ?? "-" },
        ];
    });

    interface RebootAction {
        label: string;
        mode: RebootMode;
    }

    // 按钮对应的 adb reboot 目标
    const rebootActions: RebootAction[] = [
        { label: "系统", mode: "" },
        { label: "恢复模式", mode: "recovery" },
        { label: "FastBoot", mode: "bootloader" },
        { label: "9008", mode: "edl" },
    ];

    // 待确认的重启动作，非空时显示弹窗
    const pending = ref<RebootAction | null>(null);
    const rebooting = ref(false);
    const rebootError = ref("");
    const terminalError = ref("");
    const showTerminalHelp = ref(false);

    // 打开带 tools 目录的交互式终端
    async function launchTerminal(shell: "cmd" | "powershell") {
        terminalError.value = "";
        try {
            await openTerminal(shell);
        } catch (error) {
            terminalError.value =
                error instanceof Error ? error.message : "打开终端失败";
        }
    }

    async function refresh() {
        if (refreshing) {
            return;
        }
        refreshing = true;
        try {
            const status = await getDeviceStatus(preferredSerial.value);
            activeSerial.value = status.serial ?? status.fastbootSerial;
            preferredSerial.value = activeSerial.value;
            statusDevices.value = status.devices;
            fastbootDevices.value = status.fastbootDevices;
            isAdbConnected.value = status.serial !== null;
            deviceMode.value = status.mode;
            isDevicesLink.value =
                status.serial !== null || status.mode === "fastboot";

            if (status.serial) {
                // 只在设备序列号变化时重新获取信息，失败则下次轮询重试
                if (deviceInfoSerial.value !== status.serial) {
                    deviceInfo.value = null;
                    deviceInfoSerial.value = null;
                    try {
                        deviceInfo.value = await getDeviceInfo(status.serial);
                        deviceInfoSerial.value = status.serial;
                    } catch {
                        // 保持为空，下次轮询重试
                    }
                }
            } else {
                deviceInfo.value = null;
                deviceInfoSerial.value = null;
            }
        } catch {
            // adb 不可用或执行失败时按未连接处理
            isDevicesLink.value = false;
            isAdbConnected.value = false;
            deviceMode.value = "unknown";
            activeSerial.value = null;
            preferredSerial.value = null;
            statusDevices.value = [];
            fastbootDevices.value = [];
            deviceInfo.value = null;
            deviceInfoSerial.value = null;
        } finally {
            refreshing = false;
        }
    }

    async function selectDevice(entry: DeviceEntry) {
        preferredSerial.value = entry.serial;
        await refresh();
    }

    async function tick() {
        await refresh();
        if (stopped) {
            return;
        }
        timer = window.setTimeout(
            tick,
            isDevicesLink.value ? POLL_CONNECTED : POLL_DISCONNECTED,
        );
    }

    function stopPolling() {
        stopped = true;
        if (timer !== undefined) {
            window.clearTimeout(timer);
            timer = undefined;
        }
    }

    function startPolling() {
        stopPolling();
        stopped = false;
        tick();
    }

    function handleVisibilityChange() {
        // 页面隐藏时停止轮询，回到页面时立即刷新
        if (document.hidden) {
            stopPolling();
        } else {
            startPolling();
        }
    }

    function openDialog(action: RebootAction) {
        rebootError.value = "";
        pending.value = action;
    }

    function closeDialog() {
        if (!rebooting.value) {
            pending.value = null;
        }
    }

    async function confirmReboot() {
        if (!pending.value || rebooting.value) {
            return;
        }
        rebooting.value = true;
        rebootError.value = "";
        try {
            await rebootDevice(
                activeSerial.value,
                pending.value.mode,
                deviceMode.value === "fastboot",
            );
            pending.value = null;
        } catch (error) {
            rebootError.value =
                error instanceof Error ? error.message : "重启失败";
        } finally {
            rebooting.value = false;
        }
    }

    // 正在执行的功能动作，非空时显示动作弹窗
    const activeAction = ref<DeviceAction | null>(null);
    const actionPath = ref("");
    const actionPathsText = ref("");
    const actionRunning = ref(false);
    const actionOutput = ref("");

    const inputPlaceholder = computed(() => {
        const action = activeAction.value;
        if (!action) {
            return "";
        }
        if (action.placeholder) {
            return action.placeholder;
        }
        if (action.input === "directory") {
            return "保存目录路径";
        }
        return action.input === "text" ? "输入内容" : "文件路径";
    });

    const canRunAction = computed(() => {
        const action = activeAction.value;
        if (!action || actionRunning.value) {
            return false;
        }
        if (
            action.input === "file" ||
            action.input === "directory" ||
            action.input === "text"
        ) {
            return actionPath.value.trim() !== "";
        }
        if (action.input === "files") {
            return actionPathsText.value
                .split(/\r?\n/)
                .some((line) => line.trim() !== "");
        }
        return true;
    });

    function openAction(action: DeviceAction) {
        actionPath.value = "";
        actionPathsText.value = "";
        actionOutput.value = "";
        activeAction.value = action;
    }

    function closeAction() {
        if (!actionRunning.value) {
            activeAction.value = null;
        }
    }

    async function selectPath() {
        const action = activeAction.value;
        if (!action || !runningInTauri) {
            return;
        }
        if (action.input === "directory") {
            const path = await pickDirectory(action.label);
            if (path) {
                actionPath.value = path;
            }
            return;
        }
        if (action.input === "file") {
            const path = await pickFile(
                action.label,
                action.fileExtensions ?? [],
            );
            if (path) {
                actionPath.value = path;
            }
        }
    }

    async function selectPaths() {
        const action = activeAction.value;
        if (!action || !runningInTauri) {
            return;
        }
        const paths = await pickFiles(
            action.label,
            action.fileExtensions ?? [],
        );
        if (paths && paths.length > 0) {
            actionPathsText.value = paths.join("\n");
        }
    }

    function formatOutput(
        action: DeviceAction,
        args: string[],
        result: ToolOutput,
    ): string {
        const parts = [`$ ${action.tool} ${args.join(" ")}`.trim()];
        if (result.stdout.trim() !== "") {
            parts.push("", result.stdout.trimEnd());
        }
        if (result.stderr.trim() !== "") {
            parts.push("", "[stderr]", result.stderr.trimEnd());
        }
        if (result.code !== null) {
            parts.push("", `[exit code: ${result.code}]`);
        }
        return parts.join("\n");
    }

    async function runAction() {
        const action = activeAction.value;
        if (!action || !canRunAction.value) {
            return;
        }

        actionRunning.value = true;
        actionOutput.value = "";
        const paths = actionPathsText.value
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line !== "");

        try {
            if (action.screenshot) {
                const serial = action.noSerial ? null : activeSerial.value;
                const savedPath = await takeScreenshot(
                    serial,
                    actionPath.value.trim(),
                );
                actionOutput.value = `已保存截图：${savedPath}`;
            } else {
                const baseArgs = action.args
                    ? action.args({ path: actionPath.value.trim(), paths })
                    : [];
                const args =
                    action.noSerial || !activeSerial.value
                        ? baseArgs
                        : ["-s", activeSerial.value, ...baseArgs];
                const result = await runDeviceTool(action.tool, args);
                actionOutput.value = formatOutput(action, args, result);
            }

            if (action.refreshAfter) {
                await refresh();
            }
        } catch (error) {
            actionOutput.value =
                error instanceof Error ? error.message : "执行失败";
        } finally {
            actionRunning.value = false;
        }
    }

    async function copyOutput() {
        const text = actionOutput.value;
        if (text === "") {
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // 剪贴板 API 不可用时退回 textarea 复制
            const area = document.createElement("textarea");
            area.value = text;
            area.style.position = "fixed";
            area.style.opacity = "0";
            document.body.appendChild(area);
            area.select();
            document.execCommand("copy");
            area.remove();
        }
    }

    onMounted(() => {
        startPolling();
        document.addEventListener("visibilitychange", handleVisibilityChange);
    });

    onBeforeUnmount(() => {
        stopPolling();
        document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange,
        );
    });
</script>
<style scoped>
    .devices-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 220px;
        gap: 24px;
        align-items: stretch;
        height: calc(100vh - 56px);
        min-height: 0;
        margin-inline: calc(-1 * var(--page-gutter));
        overflow: hidden;
    }
    .page {
        height: 100%;
        padding-inline: var(--page-gutter);
        overflow-y: auto;
        text-align: center;
        scrollbar-width: none;
    }
    .page::-webkit-scrollbar {
        width: 0;
        height: 0;
    }
    .device-mode {
        color: var(--accent);
    }
    .deviceInfo {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px 24px;
        width: 70%;
        max-width: 900px;
        margin: 16px auto 0;
        text-align: left;
    }
    .deviceInfo-item {
        display: flex;
        gap: 8px;
        margin: 0;
        font-size: 14px;
    }
    .deviceInfo-label {
        flex: none;
        min-width: 56px;
        color: #6b7280;
    }
    .deviceInfo-value {
        color: #1f2937;
    }
    .rebotActions {
        width: 60%;
        max-width: 760px;
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        align-items: center;
        gap: 10px;
        margin: 24px auto 0;
    }
    .rebotActions p {
        margin: 0;
    }
    .rebotActions button {
        padding: 8px 10px;
        border: none;
        color: var(--accent);
        line-height: 1.2;
        cursor: pointer;
        background: #fff;
        transition: background-color 0.15s ease;
    }
    .rebotActions button:active {
        background: #e5e7eb;
    }
    .whenDeviceInMode p {
        margin: 10px 0 0;
    }
    .modeActions {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 10px;
        width: 70%;
        margin: 12px auto 0;
    }
    .mode-action {
        padding: 10px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #fff;
        color: #1f2937;
        font-size: 14px;
        cursor: pointer;
        transition: border-color 0.15s ease, color 0.15s ease,
            background-color 0.15s ease;
    }
    .mode-action:hover {
        border-color: var(--accent);
        color: var(--accent);
    }
    .mode-action:active {
        background: #e5e7eb;
    }
    .sidebar {
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
        border: 1px solid #e5e7eb;
        background: #fff;
        box-shadow: 0 2px 10px rgba(15, 23, 42, 0.05);
    }
    .sidebar-title {
        flex: none;
        padding: 14px 16px;
        border-bottom: 1px solid #e5e7eb;
        color: var(--accent);
        font-size: 14px;
        font-weight: 600;
        text-align: center;
    }
    .sidebar-devices {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0;
        padding: 0;
        overflow-y: auto;
    }
    .sidebar-empty {
        margin: auto;
        color: var(--accent);
        font-size: 16px;
        text-align: center;
    }
    .device-entry {
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: 100%;
        padding: 10px 12px;
        border: 1px solid #e5e7eb;
        background: #fff;
        text-align: left;
        font-family: inherit;
        cursor: pointer;
        transition: border-color 0.15s ease, color 0.15s ease,
            background-color 0.15s ease;
    }
    .device-entry:hover {
        border-color: var(--accent);
    }
    .device-entry + .device-entry {
        border-top: none;
    }
    .device-entry.active {
        border-color: var(--accent);
        background: rgba(15, 23, 42, 0.04);
    }
    .device-entry-name {
        color: #1f2937;
        font-size: 13px;
        word-break: break-all;
    }
    .device-entry.active .device-entry-name {
        color: var(--accent);
        font-weight: 500;
    }
    .device-entry-kind {
        color: #9ca3af;
        font-size: 12px;
    }
    .sidebar-divider {
        height: 1px;
        background: #e5e7eb;
    }
    .sidebar-network {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        padding: 28px 20px;
    }
    .sidebar-network button {
        border: none;
        background: none;
        font-family: inherit;
        cursor: pointer;
    }
    .network-connect {
        color: var(--accent);
        font-size: 15px;
    }
    .network-connect:hover {
        opacity: 0.8;
    }
    .network-action {
        color: var(--accent);
        font-size: 13px;
        opacity: 0.55;
    }
    .network-action:hover:not(:disabled) {
        opacity: 0.85;
    }
    .network-action:disabled {
        color: var(--accent);
        opacity: 0.3;
        cursor: not-allowed;
    }
    .sidebar-terminal {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 16px 20px;
    }
    .terminal-title {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        color: var(--accent);
        font-size: 13px;
        font-weight: 600;
        text-align: center;
    }
    .terminal-help {
        display: grid;
        place-items: center;
        width: 16px;
        height: 16px;
        padding: 0;
        border: 1px solid currentColor;
        border-radius: 50%;
        background: none;
        color: var(--accent);
        font-family: inherit;
        font-size: 11px;
        line-height: 1;
        cursor: pointer;
    }
    .terminal-help:hover {
        background: rgba(59, 130, 246, 0.08);
    }
    .help-text {
        line-height: 1.6;
        text-align: left;
    }
    .terminal-actions {
        display: flex;
        gap: 10px;
    }
    .terminal-button {
        flex: 1;
        padding: 8px 6px;
        border: 1px solid #e5e7eb;
        background: #fff;
        color: var(--accent);
        font-family: inherit;
        font-size: 13px;
        cursor: pointer;
        transition: border-color 0.15s ease, background-color 0.15s ease;
    }
    .terminal-button:hover:not(:disabled) {
        border-color: var(--accent);
    }
    .terminal-button:active:not(:disabled) {
        background: #e5e7eb;
    }
    .terminal-button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
    .terminal-error {
        margin: 0;
        color: #dc2626;
        font-size: 12px;
        text-align: center;
    }
    .dialog-mask {
        position: fixed;
        inset: 0;
        z-index: 20;
        display: grid;
        place-items: center;
        background: rgba(15, 23, 42, 0.45);
    }
    .dialog {
        width: min(360px, calc(100% - 32px));
        padding: 20px;
        border-radius: 12px;
        background: #fff;
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.25);
        text-align: center;
    }
    .action-dialog {
        width: min(560px, calc(100% - 32px));
        max-height: 80vh;
        overflow-y: auto;
        text-align: left;
    }
    .dialog h2 {
        margin: 0 0 8px;
        font-size: 18px;
    }
    .dialog p {
        margin: 0;
        color: #4b5563;
    }
    .dialog p.dialog-error {
        margin-top: 8px;
        color: #dc2626;
        font-size: 13px;
    }
    .action-desc {
        margin-bottom: 12px !important;
        font-size: 13px;
    }
    .action-input {
        display: flex;
        gap: 8px;
        align-items: flex-start;
    }
    .action-input input,
    .action-input textarea {
        flex: 1;
        min-width: 0;
        padding: 8px 10px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-size: 13px;
        font-family: inherit;
        resize: vertical;
    }
    .action-input input:focus,
    .action-input textarea:focus {
        border-color: var(--accent);
        outline: none;
    }
    .action-pick {
        flex: none;
        padding: 8px 12px;
        border: 1px solid var(--accent);
        border-radius: 8px;
        background: #fff;
        color: var(--accent);
        font-size: 13px;
        cursor: pointer;
    }
    .action-pick:hover {
        background: rgba(59, 130, 246, 0.08);
    }
    .output-panel {
        margin-top: 12px;
    }
    .output-panel pre {
        max-height: 240px;
        margin: 0;
        padding: 10px;
        overflow: auto;
        border-radius: 8px;
        background: #0f172a;
        color: #e2e8f0;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-all;
    }
    .copy-button {
        margin-top: 8px;
        padding: 6px 12px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: #fff;
        color: #374151;
        font-size: 13px;
        cursor: pointer;
    }
    .copy-button:hover {
        background: #f3f4f6;
    }
    .dialog-actions {
        display: flex;
        justify-content: center;
        gap: 12px;
        margin-top: 20px;
    }
    .dialog-actions button {
        min-width: 96px;
        padding: 8px 16px;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        cursor: pointer;
        transition: background-color 0.15s ease, opacity 0.15s ease;
    }
    .dialog-cancel {
        color: #374151;
        background: #f3f4f6;
    }
    .dialog-cancel:hover {
        background: #e5e7eb;
    }
    .dialog-confirm {
        color: #fff;
        background: var(--accent);
    }
    .dialog-confirm:hover {
        filter: brightness(0.95);
    }
    .dialog-actions button:disabled {
        cursor: not-allowed;
        opacity: 0.6;
    }
    @media (max-width: 900px) {
        .devices-layout {
            grid-template-columns: minmax(0, 1fr);
            height: auto;
            overflow: visible;
        }
        .page {
            height: auto;
            overflow: visible;
        }
        .sidebar {
            min-height: 320px;
        }
    }
</style>
