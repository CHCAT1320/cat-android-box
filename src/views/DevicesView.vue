<template>
    <div class="devices-layout">
        <section class="page">
            <h1 v-if="isDevicesLink">当前设备已连接</h1>
            <h1 v-if="!isDevicesLink">当前未连接设备</h1>
            <p class="muted" v-if="!isDevicesLink">请确保设备已连接并授权。</p>
            <p v-if="!isDevicesLink && connectionError" class="connection-error">
                {{ connectionError }}
            </p>
            <button
                v-if="!isDevicesLink"
                class="reload-button"
                @click="reloadApp"
            >
                重新加载页面
            </button>
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
            <div v-if="modeActions.length > 0 || isAdbConnected" class="modeActions">
                <button
                    v-for="action in modeActions"
                    :key="action.id"
                    class="mode-action"
                    @click="openAction(action)"
                >
                    {{ action.label }}
                </button>
                <button
                    v-if="isAdbConnected"
                    class="mode-action"
                    @click="openPreview"
                >
                    屏幕预览
                </button>
                <button
                    v-if="isAdbConnected"
                    class="mode-action"
                    @click="openCommandDialog"
                >
                    命令面板
                </button>
                <button
                    v-if="deviceMode === 'fastboot'"
                    class="mode-action"
                    @click="openFastbootVars"
                >
                    FastBoot 变量
                </button>
                <button
                    v-if="deviceMode === 'fastboot'"
                    class="mode-action"
                    @click="openFlashDialog"
                >
                    分区刷写
                </button>
                <button
                    v-if="isAdbConnected"
                    class="mode-action"
                    @click="openBackupDialog"
                >
                    分区备份
                </button>
                <button
                    v-if="isAdbConnected"
                    class="mode-action"
                    @click="openNetworkTools"
                >
                    网络工具
                </button>
                <button
                    v-if="isAdbConnected"
                    class="mode-action"
                    @click="openDeviceTools"
                >
                    设备工具
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

                    <label v-if="activeAction.dangerous" class="danger-confirm">
                        <input
                            v-model="actionConfirmed"
                            type="checkbox"
                            :disabled="actionRunning"
                        />
                        <span>我已了解风险，确认执行该操作</span>
                    </label>

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
            <div
                v-if="showPairDialog"
                class="dialog-mask"
                @click.self="closePairDialog"
            >
                <div class="dialog" role="dialog" aria-modal="true">
                    <h2>无线配对</h2>
                    <p class="help-text">
                        在手机「开发者选项 → 无线调试」里点击「使用配对码配对设备」，然后填写手机上显示的地址和六位配对码。
                    </p>
                    <div class="pair-form">
                        <input
                            v-model="pairAddress"
                            placeholder="IP:配对端口，例如 192.168.1.100:37123"
                            :disabled="pairRunning"
                        />
                        <input
                            v-model="pairCode"
                            placeholder="六位配对码"
                            :disabled="pairRunning"
                        />
                    </div>
                    <p v-if="pairError" class="dialog-error">{{ pairError }}</p>
                    <p v-if="pairMessage" class="pair-success">
                        {{ pairMessage }}
                    </p>
                    <div class="dialog-actions">
                        <button
                            class="dialog-cancel"
                            :disabled="pairRunning"
                            @click="closePairDialog"
                        >
                            关闭
                        </button>
                        <button
                            class="dialog-confirm"
                            :disabled="pairRunning"
                            @click="runPair"
                        >
                            {{ pairRunning ? "配对中..." : "开始配对" }}
                        </button>
                    </div>
                </div>
            </div>

            <div
                v-if="showCommandDialog"
                class="dialog-mask"
                @click.self="showCommandDialog = false"
            >
                <div class="dialog action-dialog" role="dialog" aria-modal="true">
                    <h2>命令面板</h2>
                    <p class="action-desc">
                        直接执行 adb shell 命令，可以选择当前设备或所有在线设备。
                    </p>
                    <div class="command-modes">
                        <label>
                            <input
                                v-model="commandTarget"
                                type="radio"
                                value="current"
                            />
                            当前设备
                        </label>
                        <label>
                            <input
                                v-model="commandTarget"
                                type="radio"
                                value="all"
                            />
                            所有在线设备
                        </label>
                    </div>
                    <div class="action-input">
                        <input
                            v-model="commandText"
                            placeholder="例如：pm list packages -3"
                            :disabled="commandRunning"
                            @keyup.enter="runCommand"
                        />
                        <button
                            class="action-pick"
                            :disabled="commandRunning"
                            @click="runCommand"
                        >
                            {{ commandRunning ? "执行中..." : "执行" }}
                        </button>
                        <button
                            class="action-pick"
                            :disabled="commandText.trim() === ''"
                            @click="toggleFavorite"
                        >
                            收藏
                        </button>
                    </div>
                    <p v-if="commandError" class="dialog-error">
                        {{ commandError }}
                    </p>
                    <p
                        v-if="commandRunning && commandProgress.total > 0"
                        class="muted"
                    >
                        进度：{{ commandProgress.done }} /
                        {{ commandProgress.total }}
                    </p>
                    <button
                        v-if="!commandRunning && failedSerials.length > 0"
                        class="copy-button"
                        @click="retryFailedCommands"
                    >
                        重试失败设备（{{ failedSerials.length }}）
                    </button>
                    <div v-if="commandHistory.length > 0" class="command-history">
                        <span>历史：</span>
                        <button
                            v-for="item in commandHistory"
                            :key="item"
                            :disabled="commandRunning"
                            @click="useCommand(item)"
                        >
                            {{ item }}
                        </button>
                    </div>
                    <div v-if="favorites.length > 0" class="command-history">
                        <span>收藏：</span>
                        <button
                            v-for="item in favorites"
                            :key="item"
                            :disabled="commandRunning"
                            @click="useCommand(item)"
                        >
                            {{ item }}
                        </button>
                    </div>

                    <h3 class="tool-section">脚本</h3>
                    <textarea
                        v-model="commandScript"
                        class="script-input"
                        placeholder="每行一条 adb shell 命令，以 # 开头为注释"
                        :disabled="commandRunning"
                    ></textarea>
                    <div class="action-input">
                        <input
                            v-model="scriptName"
                            placeholder="脚本名称"
                            :disabled="commandRunning"
                        />
                        <button
                            class="action-pick"
                            :disabled="commandRunning"
                            @click="saveCurrentScript"
                        >
                            保存脚本
                        </button>
                        <button
                            class="action-pick"
                            :disabled="commandRunning || commandScript.trim() === ''"
                            @click="runScript"
                        >
                            {{ commandRunning ? "执行中..." : "运行脚本" }}
                        </button>
                    </div>
                    <div
                        v-if="savedScripts.length > 0"
                        class="script-list"
                    >
                        <div
                            v-for="item in savedScripts"
                            :key="item.name"
                            class="script-item"
                        >
                            <button
                                class="script-load"
                                :disabled="commandRunning"
                                @click="loadScript(item)"
                            >
                                {{ item.name }}
                            </button>
                            <button
                                class="script-delete"
                                :disabled="commandRunning"
                                @click="deleteScript(item.name)"
                            >
                                删除
                            </button>
                        </div>
                    </div>
                    <pre v-if="commandOutput" class="command-output">{{ commandOutput }}</pre>
                    <div class="dialog-actions">
                        <button
                            class="dialog-cancel"
                            @click="showCommandDialog = false"
                        >
                            关闭
                        </button>
                    </div>
                </div>
            </div>

            <div v-if="showPreview" class="dialog-mask" @click.self="closePreview">
                <div
                    class="dialog action-dialog preview-dialog"
                    role="dialog"
                    aria-modal="true"
                >
                    <h2>屏幕预览</h2>
                    <p class="action-desc">
                        画面每 1.2 秒刷新一次，点击画面可以模拟触摸。
                    </p>
                    <img
                        v-if="previewImage"
                        :src="previewImage"
                        class="preview-image"
                        alt="设备屏幕"
                        draggable="false"
                        @pointerdown="previewPointerDown"
                        @pointerup="previewPointerUp"
                        @pointercancel="previewPointerCancel"
                    />
                    <p v-if="previewError" class="dialog-error">
                        {{ previewError }}
                    </p>
                    <p v-if="previewNotice" class="pair-success">
                        {{ previewNotice }}
                    </p>
                    <div v-if="isAdbConnected" class="preview-controls">
                        <button class="dialog-cancel" @click="sendKey('4')">
                            返回
                        </button>
                        <button class="dialog-cancel" @click="sendKey('3')">
                            主页
                        </button>
                        <button class="dialog-cancel" @click="sendKey('187')">
                            多任务
                        </button>
                        <input
                            v-model="previewText"
                            class="preview-text"
                            placeholder="先点手机里的输入框，再在这里输入"
                            @keyup.enter="sendPreviewText"
                        />
                        <button class="dialog-cancel" @click="sendPreviewText">
                            发送
                        </button>
                    </div>
                    <p v-if="isAdbConnected" class="preview-hint">
                        文本输入：先在预览画面点击设备上的输入框，再输入文字并点「发送」，相当于在设备上打字。受 Android 限制，暂不支持中文和表情，建议输入英文、数字和常用符号。
                    </p>
                    <div class="dialog-actions">
                        <button class="dialog-cancel" @click="closePreview">
                            关闭
                        </button>
                        <button class="dialog-cancel" @click="refreshPreview">
                            刷新
                        </button>
                        <button
                            class="dialog-cancel"
                            :disabled="previewRecording"
                            @click="recordPreview"
                        >
                            {{ previewRecording ? "录制中..." : "录制 15 秒" }}
                        </button>
                        <button class="dialog-cancel" @click="startScrcpy">
                            scrcpy
                        </button>
                        <button
                            class="dialog-cancel"
                            @click="startScrcpyRecording"
                        >
                            投屏并录制
                        </button>
                        <button class="dialog-confirm" @click="savePreview">
                            保存截图
                        </button>
                    </div>
                </div>
            </div>

            <div v-if="showFastbootVars" class="dialog-mask" @click.self="showFastbootVars = false">
                <div class="dialog action-dialog" role="dialog" aria-modal="true">
                    <h2>FastBoot 变量</h2>
                    <p class="action-desc">
                        读取当前 FastBoot 设备的 <code>getvar all</code> 输出。
                    </p>
                    <p v-if="fastbootVarsLoading" class="muted">读取中...</p>
                    <p v-if="fastbootVarsError" class="dialog-error">
                        {{ fastbootVarsError }}
                    </p>
                    <pre v-if="fastbootVars" class="command-output">{{ fastbootVars }}</pre>
                    <div class="dialog-actions">
                        <button
                            class="dialog-cancel"
                            @click="showFastbootVars = false"
                        >
                            关闭
                        </button>
                        <button
                            class="dialog-confirm"
                            :disabled="fastbootVarsLoading"
                            @click="loadFastbootVars"
                        >
                            刷新
                        </button>
                    </div>
                </div>
            </div>

            <div
                v-if="showBackupDialog"
                class="dialog-mask"
                @click.self="closeBackupDialog"
            >
                <div class="dialog" role="dialog" aria-modal="true">
                    <h2>分区备份</h2>
                    <p class="help-text">
                        通过 root 将
                        <code>/dev/block/by-name/&lt;分区&gt;</code>
                        备份为 img 文件，需要设备已 root。
                    </p>
                    <div class="pair-form">
                        <input
                            v-model="backupPartitionName"
                            list="backup-partition-options"
                            placeholder="分区名，例如 boot"
                            :disabled="backupRunning"
                        />
                        <datalist id="backup-partition-options">
                            <option
                                v-for="name in partitions"
                                :key="name"
                                :value="name"
                            ></option>
                        </datalist>
                        <p class="partition-hint">
                            <span v-if="partitionsLoading">
                                正在识别分区...
                            </span>
                            <span v-else-if="partitions.length > 0">
                                已识别 {{ partitions.length }} 个分区，可下拉选择
                            </span>
                            <span v-else>
                                {{ partitionsError || "未能自动识别分区" }}
                            </span>
                            <button
                                class="link-button"
                                :disabled="partitionsLoading || backupRunning"
                                @click="loadPartitions"
                            >
                                重新识别
                            </button>
                        </p>
                        <div class="action-input">
                            <input
                                v-model="backupDirectory"
                                placeholder="保存目录"
                                :disabled="backupRunning"
                            />
                            <button
                                class="action-pick"
                                :disabled="backupRunning"
                                @click="chooseBackupDirectory"
                            >
                                选择目录
                            </button>
                        </div>
                    </div>
                    <p v-if="backupError" class="dialog-error">
                        {{ backupError }}
                    </p>
                    <p v-if="backupNotice" class="pair-success">
                        {{ backupNotice }}
                    </p>
                    <div class="dialog-actions">
                        <button
                            class="dialog-cancel"
                            :disabled="backupRunning"
                            @click="closeBackupDialog"
                        >
                            关闭
                        </button>
                        <button
                            class="dialog-confirm"
                            :disabled="backupRunning"
                            @click="runBackup"
                        >
                            {{ backupRunning ? "备份中..." : "开始备份" }}
                        </button>
                    </div>
                </div>
            </div>

            <div v-if="showFlashDialog" class="dialog-mask" @click.self="showFlashDialog = false">
                <div class="dialog" role="dialog" aria-modal="true">
                    <h2>分区刷写</h2>
                    <p class="help-text">
                        通过 fastboot 刷入指定分区。请确认分区名和镜像完全匹配。
                    </p>
                    <div class="pair-form">
                        <input
                            v-model="flashPartition"
                            placeholder="分区名，例如 boot / recovery / vbmeta"
                            :disabled="flashRunning"
                        />
                        <div class="action-input">
                            <input
                                v-model="flashFilePath"
                                placeholder="镜像文件路径"
                                :disabled="flashRunning"
                            />
                            <button
                                class="action-pick"
                                :disabled="flashRunning"
                                @click="chooseFlashFile"
                            >
                                选择文件
                            </button>
                        </div>
                        <label class="danger-confirm">
                            <input
                                v-model="flashVbmeta"
                                type="checkbox"
                                :disabled="flashRunning"
                            />
                            <span>刷入 vbmeta 时同时禁用 verity / verification 校验</span>
                        </label>
                    </div>
                    <p v-if="flashError" class="dialog-error">{{ flashError }}</p>
                    <p v-if="flashNotice" class="pair-success">{{ flashNotice }}</p>
                    <div class="dialog-actions">
                        <button
                            class="dialog-cancel"
                            :disabled="flashRunning"
                            @click="showFlashDialog = false"
                        >
                            关闭
                        </button>
                        <button
                            class="dialog-confirm"
                            :disabled="flashRunning"
                            @click="runFlash"
                        >
                            {{ flashRunning ? "刷入中..." : "开始刷入" }}
                        </button>
                    </div>
                </div>
            </div>

            <div v-if="showNetworkTools" class="dialog-mask" @click.self="showNetworkTools = false">
                <div class="dialog action-dialog" role="dialog" aria-modal="true">
                    <h2>网络工具</h2>
                    <p class="action-desc">
                        端口转发、反向转发、无线调试服务发现与全局 HTTP 代理。
                    </p>
                    <p v-if="networkError" class="dialog-error">
                        {{ networkError }}
                    </p>
                    <p v-if="networkNotice" class="pair-success">
                        {{ networkNotice }}
                    </p>

                    <h3 class="tool-section">端口转发</h3>
                    <div class="action-input">
                        <input v-model="forwardLocal" placeholder="电脑端口" />
                        <input v-model="forwardRemote" placeholder="设备端口" />
                        <button
                            class="action-pick"
                            :disabled="networkBusy"
                            @click="addPortForward"
                        >
                            添加
                        </button>
                        <button
                            class="action-pick"
                            :disabled="networkBusy"
                            @click="removeForwardPrompt"
                        >
                            移除
                        </button>
                    </div>
                    <pre v-if="forwardRules" class="command-output">{{ forwardRules }}</pre>

                    <h3 class="tool-section">反向转发</h3>
                    <div class="action-input">
                        <input v-model="reverseRemote" placeholder="设备端口" />
                        <input v-model="reverseLocal" placeholder="电脑端口" />
                        <button
                            class="action-pick"
                            :disabled="networkBusy"
                            @click="addPortReverse"
                        >
                            添加
                        </button>
                        <button
                            class="action-pick"
                            :disabled="networkBusy"
                            @click="removeReversePrompt"
                        >
                            移除
                        </button>
                    </div>

                    <h3 class="tool-section">无线调试服务</h3>
                    <pre v-if="mdnsList" class="command-output">{{ mdnsList }}</pre>
                    <div class="action-input">
                        <input v-model="mdnsAddress" placeholder="IP:端口" />
                        <button
                            class="action-pick"
                            :disabled="networkBusy"
                            @click="connectMdns"
                        >
                            连接
                        </button>
                    </div>

                    <h3 class="tool-section">全局 HTTP 代理</h3>
                    <div class="action-input">
                        <input
                            v-model="proxyValue"
                            placeholder="host:port，留空表示清除"
                        />
                        <button
                            class="action-pick"
                            :disabled="networkBusy"
                            @click="applyProxy(false)"
                        >
                            设置
                        </button>
                        <button
                            class="action-pick"
                            :disabled="networkBusy"
                            @click="applyProxy(true)"
                        >
                            清除
                        </button>
                    </div>

                    <div class="dialog-actions">
                        <button
                            class="dialog-cancel"
                            :disabled="networkBusy"
                            @click="refreshNetworkTools"
                        >
                            刷新
                        </button>
                        <button
                            class="dialog-confirm"
                            @click="showNetworkTools = false"
                        >
                            关闭
                        </button>
                    </div>
                </div>
            </div>

            <div v-if="showDeviceTools" class="dialog-mask" @click.self="showDeviceTools = false">
                <div class="dialog action-dialog" role="dialog" aria-modal="true">
                    <h2>设备工具</h2>
                    <p class="action-desc">
                        显示参数、动画缩放、电源和多用户管理。
                    </p>
                    <p v-if="toolsError" class="dialog-error">
                        {{ toolsError }}
                    </p>
                    <p v-if="toolsNotice" class="pair-success">
                        {{ toolsNotice }}
                    </p>

                    <h3 class="tool-section">显示</h3>
                    <pre v-if="display" class="command-output">{{ display.size }}
{{ display.density }}</pre>
                    <div class="action-input">
                        <input
                            v-model="sizeOverride"
                            placeholder="分辨率，例如 1080x2400"
                        />
                        <button class="action-pick" :disabled="toolsBusy" @click="applyDisplaySize">
                            设置
                        </button>
                        <button
                            class="action-pick"
                            :disabled="toolsBusy"
                            @click="sizeOverride = ''; applyDisplaySize()"
                        >
                            恢复
                        </button>
                    </div>
                    <div class="action-input">
                        <input
                            v-model="densityOverride"
                            placeholder="DPI，例如 420"
                        />
                        <button class="action-pick" :disabled="toolsBusy" @click="applyDisplayDensity">
                            设置
                        </button>
                        <button
                            class="action-pick"
                            :disabled="toolsBusy"
                            @click="densityOverride = ''; applyDisplayDensity()"
                        >
                            恢复
                        </button>
                    </div>
                    <div class="action-input">
                        <input
                            v-model="animationValue"
                            placeholder="动画缩放，例如 1"
                        />
                        <button class="action-pick" :disabled="toolsBusy" @click="applyAnimationScale">
                            应用动画缩放
                        </button>
                    </div>
                    <div class="action-input">
                        <button class="action-pick" :disabled="toolsBusy" @click="toggleStayAwake(true)">
                            保持常亮
                        </button>
                        <button class="action-pick" :disabled="toolsBusy" @click="toggleStayAwake(false)">
                            取消常亮
                        </button>
                        <button class="action-pick" :disabled="toolsBusy" @click="sleepDeviceScreen">
                            熄灭屏幕
                        </button>
                    </div>

                    <h3 class="tool-section">用户</h3>
                    <div class="tool-list">
                        <div v-for="user in users" :key="user.id" class="tool-row">
                            <span>
                                {{ user.name }} ({{ user.id }})
                                <span v-if="user.current"> · 当前</span>
                            </span>
                            <span class="tool-row-actions">
                                <button
                                    class="action-pick"
                                    :disabled="toolsBusy || user.current"
                                    @click="switchDeviceUser(user.id)"
                                >
                                    切换
                                </button>
                                <button
                                    class="action-pick danger"
                                    :disabled="toolsBusy || user.current"
                                    @click="deleteDeviceUser(user)"
                                >
                                    删除
                                </button>
                            </span>
                        </div>
                    </div>
                    <div class="action-input">
                        <input v-model="newUserName" placeholder="新用户名称" />
                        <button class="action-pick" :disabled="toolsBusy" @click="addDeviceUser">
                            创建用户
                        </button>
                    </div>

                    <div class="dialog-actions">
                        <button
                            class="dialog-cancel"
                            :disabled="toolsBusy"
                            @click="refreshDeviceTools"
                        >
                            刷新
                        </button>
                        <button
                            class="dialog-confirm"
                            @click="showDeviceTools = false"
                        >
                            关闭
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
                    @click="openPairDialog"
                >
                    无线配对（Android 11+）
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
        getDeviceStats,
        getFastbootVariables,
        backupPartition,
        listPartitions,
        captureScreen,
        inputText,
        keyEvent,
        openTerminal,
        pairDevice,
        pickDirectory,
        pickFile,
        pickFiles,
        rebootDevice,
        recordScreen,
        launchScrcpy,
        swipeScreen,
        runDeviceTool,
        runningInTauri,
        takeScreenshot,
        tapScreen,
        addForward,
        addReverse,
        connectDevice,
        createUser,
        forwardList,
        getDisplaySettings,
        getProxy,
        listUsers,
        mdnsServices,
        removeForward,
        removeReverse,
        removeUser,
        screenOff,
        setAnimationScale,
        setDisplayDensity,
        setDisplaySize,
        setProxy,
        setStayAwake,
        switchUser,
        joinLocalPath,
        type AdbDevice,
        type DeviceInfo,
        type DeviceMode,
        type DeviceUser,
        type DisplaySettings,
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
    import { settings } from "../services/settings";

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
    const connectionError = ref("");

    function reloadApp() {
        window.location.reload();
    }

    let timer: number | undefined;
    let stopped = true;
    // 防止上一次检测未返回时重复发起请求
    let refreshing = false;
    let lastInfoAt = 0;

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
            { label: "电池", value: info?.battery ?? "-" },
            { label: "电池温度", value: info?.batteryTemp ?? "-" },
            { label: "序列号", value: info?.serialNumber ?? "-" },
            { label: "CPU", value: info?.cpu ?? "-" },
            { label: "IP 地址", value: info?.ip ?? "-" },
            { label: "运行时长", value: info?.uptime ?? "-" },
            { label: "负载 1/5/15分", value: info?.load ?? "-" },
            { label: "CPU 核心", value: info?.cores ?? "-" },
            { label: "CPU 使用率", value: info?.cpuUsage ?? "-" },
            { label: "内存占用", value: info?.memoryUsage ?? "-" },
            { label: "网络", value: info?.network ?? "-" },
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
            connectionError.value = "";

            if (status.serial) {
                // 序列号变化时立即刷新，之后每 10 秒更新一次实时信息
                if (
                    deviceInfoSerial.value !== status.serial ||
                    Date.now() - lastInfoAt > 10_000
                ) {
                    if (deviceInfoSerial.value !== status.serial) {
                        deviceInfo.value = null;
                        deviceInfoSerial.value = null;
                    }
                    try {
                        deviceInfo.value = await getDeviceInfo(status.serial);
                        deviceInfoSerial.value = status.serial;
                        lastInfoAt = Date.now();
                    } catch {
                        // 保持为空，下次轮询重试
                    }
                }
            } else {
                deviceInfo.value = null;
                deviceInfoSerial.value = null;
            }
        } catch (error) {
            // adb 不可用或执行失败时按未连接处理
            connectionError.value =
                error instanceof Error ? error.message : "连接检测失败";
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
        stopStats();
    }

    function startPolling() {
        stopPolling();
        stopped = false;
        tick();
        startStats();
    }

    const STATS_INTERVAL = 2000;
    let statsTimer: number | undefined;
    let statsBusy = false;

    async function refreshStats() {
        const target = activeSerial.value;
        if (
            !target ||
            deviceMode.value !== "system" ||
            statsBusy ||
            !deviceInfo.value
        ) {
            return;
        }
        statsBusy = true;
        try {
            const stats = await getDeviceStats(target);
            if (activeSerial.value === target && deviceInfo.value) {
                deviceInfo.value = { ...deviceInfo.value, ...stats };
            }
        } catch {
            // 状态读取失败时保留上一次数值
        } finally {
            statsBusy = false;
        }
    }

    function startStats() {
        stopStats();
        void refreshStats();
        statsTimer = window.setInterval(() => {
            void refreshStats();
        }, STATS_INTERVAL);
    }

    function stopStats() {
        if (statsTimer !== undefined) {
            window.clearInterval(statsTimer);
            statsTimer = undefined;
        }
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
    const actionConfirmed = ref(false);

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
        if (action.dangerous && !actionConfirmed.value) {
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
        actionConfirmed.value = false;
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

    // ---------- 无线配对 ----------
    const showPairDialog = ref(false);
    const pairAddress = ref("");
    const pairCode = ref("");
    const pairRunning = ref(false);
    const pairError = ref("");
    const pairMessage = ref("");

    function openPairDialog() {
        pairAddress.value = "";
        pairCode.value = "";
        pairError.value = "";
        pairMessage.value = "";
        showPairDialog.value = true;
    }

    function closePairDialog() {
        if (!pairRunning.value) {
            showPairDialog.value = false;
        }
    }

    async function runPair() {
        if (pairRunning.value) {
            return;
        }
        pairError.value = "";
        pairMessage.value = "";
        const address = pairAddress.value.trim();
        const code = pairCode.value.trim();
        if (address === "" || code === "") {
            pairError.value = "请填写配对地址和配对码";
            return;
        }
        pairRunning.value = true;
        try {
            pairMessage.value = await pairDevice(address, code);
            await refresh();
        } catch (error) {
            pairError.value =
                error instanceof Error ? error.message : "配对失败";
        } finally {
            pairRunning.value = false;
        }
    }

    // ---------- 命令面板 ----------
    const COMMAND_HISTORY_KEY = "cat-android-box-command-history";
    const showCommandDialog = ref(false);
    const commandTarget = ref<"current" | "all">("current");
    const commandText = ref("");
    const commandRunning = ref(false);
    const commandOutput = ref("");
    const commandError = ref("");
    const commandHistory = ref<string[]>(loadCommandHistory());
    const commandProgress = ref({ done: 0, total: 0 });
    const failedSerials = ref<string[]>([]);
    const lastCommand = ref("");

    function loadCommandHistory(): string[] {
        try {
            const raw = localStorage.getItem(COMMAND_HISTORY_KEY);
            return raw ? (JSON.parse(raw) as string[]) : [];
        } catch {
            return [];
        }
    }

    function rememberCommand(command: string) {
        const next = [
            command,
            ...commandHistory.value.filter((item) => item !== command),
        ].slice(0, 20);
        commandHistory.value = next;
        localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(next));
    }

    function openCommandDialog() {
        commandText.value = "";
        commandOutput.value = "";
        commandError.value = "";
        showCommandDialog.value = true;
    }

    async function runOnSerials(command: string, serials: string[]) {
        const parts: string[] = [];
        const failed: string[] = [];
        commandProgress.value = { done: 0, total: serials.length };
        for (const target of serials) {
            try {
                const result = await runDeviceTool("adb", [
                    "-s",
                    target,
                    "shell",
                    command,
                ]);
                const output =
                    (result.stdout || result.stderr).trim() ||
                    `[exit code: ${result.code ?? "-"}]`;
                parts.push(`# ${target}\n${output}`);
            } catch (error) {
                failed.push(target);
                parts.push(
                    `# ${target}\n${
                        error instanceof Error ? error.message : "执行失败"
                    }`,
                );
            }
            commandProgress.value.done += 1;
        }
        return { parts, failed };
    }

    async function runCommand() {
        const command = commandText.value.trim();
        if (command === "" || commandRunning.value) {
            return;
        }
        const serials =
            commandTarget.value === "all"
                ? statusDevices.value
                      .filter((device) => device.state === "device")
                      .map((device) => device.serial)
                : activeSerial.value
                  ? [activeSerial.value]
                  : [];
        if (serials.length === 0) {
            commandError.value = "没有可执行的设备";
            return;
        }
        commandRunning.value = true;
        commandOutput.value = "";
        commandError.value = "";
        failedSerials.value = [];
        lastCommand.value = command;
        try {
            const { parts, failed } = await runOnSerials(command, serials);
            commandOutput.value = parts.join("\n\n");
            failedSerials.value = failed;
            rememberCommand(command);
        } finally {
            commandRunning.value = false;
            commandProgress.value = { done: 0, total: 0 };
        }
    }

    async function retryFailedCommands() {
        if (
            commandRunning.value ||
            lastCommand.value === "" ||
            failedSerials.value.length === 0
        ) {
            return;
        }
        const retryList = [...failedSerials.value];
        commandRunning.value = true;
        commandOutput.value += `\n\n=== 重试 ${retryList.length} 台设备 ===`;
        try {
            const { parts, failed } = await runOnSerials(
                lastCommand.value,
                retryList,
            );
            commandOutput.value += `\n\n${parts.join("\n\n")}`;
            failedSerials.value = failed;
        } finally {
            commandRunning.value = false;
            commandProgress.value = { done: 0, total: 0 };
        }
    }

    function useCommand(command: string) {
        commandText.value = command;
    }

    // ---------- 脚本与收藏 ----------
    const SCRIPT_KEY = "cat-android-box-scripts";
    const FAVORITE_KEY = "cat-android-box-favorites";
    const commandScript = ref("");
    const scriptName = ref("");
    const savedScripts = ref<{ name: string; body: string }[]>(
        loadSavedScripts(),
    );
    const favorites = ref<string[]>(loadFavorites());

    function loadSavedScripts(): { name: string; body: string }[] {
        try {
            const raw = localStorage.getItem(SCRIPT_KEY);
            return raw ? (JSON.parse(raw) as { name: string; body: string }[]) : [];
        } catch {
            return [];
        }
    }

    function loadFavorites(): string[] {
        try {
            const raw = localStorage.getItem(FAVORITE_KEY);
            return raw ? (JSON.parse(raw) as string[]) : [];
        } catch {
            return [];
        }
    }

    function saveScripts() {
        localStorage.setItem(SCRIPT_KEY, JSON.stringify(savedScripts.value));
    }

    function saveCurrentScript() {
        const name = scriptName.value.trim();
        const body = commandScript.value.trim();
        if (name === "" || body === "") {
            commandError.value = "请填写脚本名称和内容";
            return;
        }
        const existing = savedScripts.value.find(
            (item) => item.name === name,
        );
        if (existing) {
            existing.body = body;
            savedScripts.value = [...savedScripts.value];
        } else {
            savedScripts.value = [...savedScripts.value, { name, body }];
        }
        saveScripts();
        commandError.value = "";
    }

    function loadScript(item: { name: string; body: string }) {
        scriptName.value = item.name;
        commandScript.value = item.body;
    }

    function deleteScript(name: string) {
        savedScripts.value = savedScripts.value.filter(
            (item) => item.name !== name,
        );
        saveScripts();
    }

    function toggleFavorite() {
        const command = commandText.value.trim();
        if (command === "") {
            return;
        }
        favorites.value = favorites.value.includes(command)
            ? favorites.value.filter((item) => item !== command)
            : [...favorites.value, command];
        localStorage.setItem(FAVORITE_KEY, JSON.stringify(favorites.value));
    }

    function scriptTargets(): string[] {
        return commandTarget.value === "all"
            ? statusDevices.value
                  .filter((device) => device.state === "device")
                  .map((device) => device.serial)
            : activeSerial.value
              ? [activeSerial.value]
              : [];
    }

    async function runScript() {
        if (commandRunning.value) {
            return;
        }
        const commands = commandScript.value
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line !== "" && !line.startsWith("#"));
        const targets = scriptTargets();
        if (commands.length === 0) {
            commandError.value = "脚本中没有可执行的命令";
            return;
        }
        if (targets.length === 0) {
            commandError.value = "没有可执行的设备";
            return;
        }
        commandRunning.value = true;
        commandOutput.value = "";
        commandError.value = "";
        failedSerials.value = [];
        commandProgress.value = {
            done: 0,
            total: commands.length * targets.length,
        };
        const parts: string[] = [];
        try {
            for (const target of targets) {
                parts.push(`# ${target}`);
                for (const command of commands) {
                    try {
                        const result = await runDeviceTool("adb", [
                            "-s",
                            target,
                            "shell",
                            command,
                        ]);
                        const output =
                            (result.stdout || result.stderr).trim() ||
                            `[exit code: ${result.code ?? "-"}]`;
                        parts.push(`$ ${command}\n${output}`);
                    } catch (error) {
                        failedSerials.value.push(target);
                        parts.push(
                            `$ ${command}\n${
                                error instanceof Error ? error.message : "执行失败"
                            }`,
                        );
                    }
                    commandProgress.value.done += 1;
                }
            }
            commandOutput.value = parts.join("\n");
        } finally {
            commandRunning.value = false;
            commandProgress.value = { done: 0, total: 0 };
        }
    }

    // ---------- 屏幕预览 ----------
    const showPreview = ref(false);
    const previewImage = ref("");
    const previewError = ref("");
    const previewNotice = ref("");
    const previewBusy = ref(false);
    const previewRecording = ref(false);
    let previewTimer: number | undefined;

    async function refreshPreview() {
        const target = activeSerial.value;
        if (!target || previewBusy.value || previewRecording.value) {
            return;
        }
        previewBusy.value = true;
        try {
            previewImage.value = await captureScreen(target);
            previewError.value = "";
        } catch (error) {
            previewError.value =
                error instanceof Error ? error.message : "获取屏幕失败";
        } finally {
            previewBusy.value = false;
        }
    }

    function openPreview() {
        if (!activeSerial.value) {
            return;
        }
        previewError.value = "";
        previewNotice.value = "";
        showPreview.value = true;
        void refreshPreview();
        previewTimer = window.setInterval(() => {
            void refreshPreview();
        }, 1200);
    }

    function closePreview() {
        clearPressTimer();
        showPreview.value = false;
        previewImage.value = "";
        if (previewTimer !== undefined) {
            window.clearInterval(previewTimer);
            previewTimer = undefined;
        }
    }

    const previewText = ref("");
    let pressTimer: number | undefined;
    let pressStart: {
        x: number;
        y: number;
        at: number;
    } | null = null;
    let longPressed = false;

    function mapPreviewPoint(
        image: HTMLImageElement,
        clientX: number,
        clientY: number,
    ) {
        const rect = image.getBoundingClientRect();
        const contentWidth = image.clientWidth;
        const contentHeight = image.clientHeight;
        const contentLeft = rect.left + image.clientLeft;
        const contentTop = rect.top + image.clientTop;
        const naturalWidth = image.naturalWidth;
        const naturalHeight = image.naturalHeight;
        if (naturalWidth === 0 || naturalHeight === 0) {
            return null;
        }
        // object-fit: contain 会留出黑边，需要先换算实际显示区域
        const scale = Math.min(
            contentWidth / naturalWidth,
            contentHeight / naturalHeight,
        );
        const offsetX = (contentWidth - naturalWidth * scale) / 2;
        const offsetY = (contentHeight - naturalHeight * scale) / 2;
        return {
            x: Math.min(
                Math.max((clientX - contentLeft - offsetX) / scale, 0),
                naturalWidth,
            ),
            y: Math.min(
                Math.max((clientY - contentTop - offsetY) / scale, 0),
                naturalHeight,
            ),
        };
    }

    function clearPressTimer() {
        if (pressTimer !== undefined) {
            window.clearTimeout(pressTimer);
            pressTimer = undefined;
        }
    }

    function previewPointerDown(event: PointerEvent) {
        const target = activeSerial.value;
        const image = event.currentTarget as HTMLImageElement;
        if (!target) {
            return;
        }
        const point = mapPreviewPoint(image, event.clientX, event.clientY);
        if (!point) {
            return;
        }
        longPressed = false;
        pressStart = { ...point, at: Date.now() };
        image.setPointerCapture?.(event.pointerId);
        clearPressTimer();
        pressTimer = window.setTimeout(async () => {
            pressTimer = undefined;
            if (!pressStart || !activeSerial.value) {
                return;
            }
            longPressed = true;
            try {
                await swipeScreen(
                    activeSerial.value,
                    pressStart.x,
                    pressStart.y,
                    pressStart.x,
                    pressStart.y,
                    700,
                );
                await refreshPreview();
            } catch (error) {
                previewError.value =
                    error instanceof Error ? error.message : "长按失败";
            }
        }, 650);
    }

    async function previewPointerUp(event: PointerEvent) {
        clearPressTimer();
        const target = activeSerial.value;
        const start = pressStart;
        pressStart = null;
        if (!target || !start || longPressed) {
            longPressed = false;
            return;
        }
        const image = event.currentTarget as HTMLImageElement;
        const end = mapPreviewPoint(image, event.clientX, event.clientY);
        if (!end) {
            return;
        }
        const distance = Math.hypot(end.x - start.x, end.y - start.y);
        try {
            if (distance > 12) {
                await swipeScreen(target, start.x, start.y, end.x, end.y, 300);
            } else {
                await tapScreen(target, end.x, end.y);
            }
            await refreshPreview();
        } catch (error) {
            previewError.value =
                error instanceof Error ? error.message : "触摸失败";
        }
    }

    function previewPointerCancel() {
        clearPressTimer();
        pressStart = null;
        longPressed = false;
    }

    async function sendKey(key: string) {
        const target = activeSerial.value;
        if (!target) {
            return;
        }
        try {
            await keyEvent(target, key);
            await refreshPreview();
        } catch (error) {
            previewError.value =
                error instanceof Error ? error.message : "按键失败";
        }
    }

    async function sendPreviewText() {
        const target = activeSerial.value;
        const text = previewText.value;
        if (!target || text === "") {
            return;
        }
        try {
            await inputText(target, text);
            previewText.value = "";
            await refreshPreview();
        } catch (error) {
            previewError.value =
                error instanceof Error ? error.message : "输入失败";
        }
    }

    async function savePreview() {
        const target = activeSerial.value;
        if (!target) {
            return;
        }
        let directory = settings.downloadDirectory;
        if (directory.trim() === "") {
            const picked = await pickDirectory("选择截图保存目录");
            if (!picked) {
                return;
            }
            directory = picked;
        }
        try {
            const saved = await takeScreenshot(target, directory);
            previewNotice.value = `已保存：${saved}`;
        } catch (error) {
            previewError.value =
                error instanceof Error ? error.message : "保存截图失败";
        }
    }

    async function recordPreview() {
        const target = activeSerial.value;
        if (!target || previewRecording.value) {
            return;
        }
        let directory = settings.downloadDirectory;
        if (directory.trim() === "") {
            const picked = await pickDirectory("选择录屏保存目录");
            if (!picked) {
                return;
            }
            directory = picked;
        }
        previewRecording.value = true;
        previewError.value = "";
        previewNotice.value = "正在录制 15 秒，请保持设备连接...";
        try {
            const saved = await recordScreen(target, directory, 15);
            previewNotice.value = `录屏已保存：${saved}`;
        } catch (error) {
            previewError.value =
                error instanceof Error ? error.message : "录屏失败";
        } finally {
            previewRecording.value = false;
        }
    }

    async function startScrcpy() {
        previewError.value = "";
        previewNotice.value = "";
        try {
            await launchScrcpy(activeSerial.value);
            previewNotice.value = "scrcpy 已启动";
        } catch (error) {
            previewError.value =
                error instanceof Error ? error.message : "启动 scrcpy 失败";
        }
    }

    async function startScrcpyRecording() {
        const target = activeSerial.value;
        if (!target) {
            return;
        }
        let directory = settings.downloadDirectory;
        if (directory.trim() === "") {
            const picked = await pickDirectory("选择 scrcpy 录制保存目录");
            if (!picked) {
                return;
            }
            directory = picked;
        }
        const recordPath = joinLocalPath(
            directory,
            `scrcpy-${Date.now()}.mp4`,
        );
        previewError.value = "";
        previewNotice.value = "";
        try {
            await launchScrcpy(target, recordPath);
            previewNotice.value = `scrcpy 已启动并录制到：${recordPath}`;
        } catch (error) {
            previewError.value =
                error instanceof Error ? error.message : "启动录制失败";
        }
    }

    // ---------- 分区刷写 ----------
    const showFlashDialog = ref(false);
    const flashPartition = ref("");
    const flashFilePath = ref("");
    const flashVbmeta = ref(false);
    const flashRunning = ref(false);
    const flashError = ref("");
    const flashNotice = ref("");

    function openFlashDialog() {
        flashPartition.value = "";
        flashFilePath.value = "";
        flashVbmeta.value = false;
        flashError.value = "";
        flashNotice.value = "";
        showFlashDialog.value = true;
    }

    async function chooseFlashFile() {
        const path = await pickFile("选择要刷入的镜像", ["img", "bin"]);
        if (path) {
            flashFilePath.value = path;
        }
    }

    async function runFlash() {
        const target = activeSerial.value;
        if (!target || flashRunning.value) {
            return;
        }
        const partition = flashPartition.value.trim();
        if (partition === "" || flashFilePath.value.trim() === "") {
            flashError.value = "请填写分区名并选择镜像文件";
            return;
        }
        if (
            !window.confirm(
                `确定把镜像刷入 ${partition} 分区吗？操作失败可能导致设备无法开机。`,
            )
        ) {
            return;
        }
        flashRunning.value = true;
        flashError.value = "";
        flashNotice.value = "刷入中，请保持设备连接...";
        try {
            const args = ["-s", target];
            if (flashVbmeta.value) {
                args.push("--disable-verity", "--disable-verification");
            }
            args.push("flash", partition, flashFilePath.value.trim());
            const result = await runDeviceTool("fastboot", args);
            if (result.code !== 0) {
                throw new Error(
                    (result.stderr || result.stdout).trim() || "刷入失败",
                );
            }
            flashNotice.value =
                (result.stdout || result.stderr).trim() || "刷入完成";
        } catch (error) {
            flashError.value =
                error instanceof Error ? error.message : "刷入失败";
        } finally {
            flashRunning.value = false;
        }
    }

    // ---------- 网络工具 ----------
    const showNetworkTools = ref(false);
    const networkBusy = ref(false);
    const networkError = ref("");
    const networkNotice = ref("");
    const forwardRules = ref("");
    const mdnsList = ref("");
    const forwardLocal = ref("");
    const forwardRemote = ref("");
    const reverseRemote = ref("");
    const reverseLocal = ref("");
    const mdnsAddress = ref("");
    const proxyValue = ref("");

    async function refreshNetworkTools() {
        const target = activeSerial.value;
        if (!target || networkBusy.value) {
            return;
        }
        networkBusy.value = true;
        networkError.value = "";
        try {
            forwardRules.value = await forwardList(target);
            mdnsList.value = await mdnsServices();
            proxyValue.value = await getProxy(target);
        } catch (error) {
            networkError.value =
                error instanceof Error ? error.message : "读取网络信息失败";
        } finally {
            networkBusy.value = false;
        }
    }

    function openNetworkTools() {
        networkError.value = "";
        networkNotice.value = "";
        forwardLocal.value = "";
        forwardRemote.value = "";
        reverseRemote.value = "";
        reverseLocal.value = "";
        mdnsAddress.value = "";
        showNetworkTools.value = true;
        void refreshNetworkTools();
    }

    function validPort(value: string) {
        const port = Number(value);
        return Number.isInteger(port) && port > 0 && port <= 65535;
    }

    async function networkAction(
        action: () => Promise<string>,
        fallback: string,
    ) {
        if (networkBusy.value) {
            return;
        }
        networkBusy.value = true;
        networkError.value = "";
        networkNotice.value = "";
        try {
            networkNotice.value = (await action()) || fallback;
            networkBusy.value = false;
            await refreshNetworkTools();
        } catch (error) {
            networkError.value =
                error instanceof Error ? error.message : "操作失败";
        } finally {
            networkBusy.value = false;
        }
    }

    async function addPortForward() {
        const target = activeSerial.value;
        if (!target) {
            return;
        }
        if (!validPort(forwardLocal.value) || !validPort(forwardRemote.value)) {
            networkError.value = "端口必须是 1-65535 的数字";
            return;
        }
        await networkAction(
            () => addForward(target, forwardLocal.value, forwardRemote.value),
            "端口转发已添加",
        );
    }

    async function addPortReverse() {
        const target = activeSerial.value;
        if (!target) {
            return;
        }
        if (!validPort(reverseRemote.value) || !validPort(reverseLocal.value)) {
            networkError.value = "端口必须是 1-65535 的数字";
            return;
        }
        await networkAction(
            () => addReverse(target, reverseRemote.value, reverseLocal.value),
            "反向转发已添加",
        );
    }

    async function removePortForward(localPort: string) {
        const target = activeSerial.value;
        if (!target) {
            return;
        }
        await networkAction(
            () => removeForward(target, localPort),
            "端口转发已移除",
        );
    }

    async function removePortReverse(remotePort: string) {
        const target = activeSerial.value;
        if (!target) {
            return;
        }
        await networkAction(
            () => removeReverse(target, remotePort),
            "反向转发已移除",
        );
    }

    async function removeForwardPrompt() {
        const value = window.prompt("要移除的电脑端口");
        if (value && value.trim() !== "") {
            await removePortForward(value.trim());
        }
    }

    async function removeReversePrompt() {
        const value = window.prompt("要移除的设备端口");
        if (value && value.trim() !== "") {
            await removePortReverse(value.trim());
        }
    }

    async function connectMdns() {
        const address = mdnsAddress.value.trim();
        if (address === "") {
            networkError.value = "请输入要连接的地址";
            return;
        }
        await networkAction(() => connectDevice(address), "连接完成");
    }

    async function applyProxy(clear = false) {
        const target = activeSerial.value;
        if (!target) {
            return;
        }
        await networkAction(
            () => setProxy(target, clear ? null : proxyValue.value),
            clear ? "代理已清除" : "代理已设置",
        );
    }

    // ---------- 设备工具 ----------
    const showDeviceTools = ref(false);
    const toolsBusy = ref(false);
    const toolsError = ref("");
    const toolsNotice = ref("");
    const display = ref<DisplaySettings | null>(null);
    const sizeOverride = ref("");
    const densityOverride = ref("");
    const animationValue = ref("1");
    const users = ref<DeviceUser[]>([]);
    const newUserName = ref("");

    async function refreshDeviceTools() {
        const target = activeSerial.value;
        if (!target || toolsBusy.value) {
            return;
        }
        toolsBusy.value = true;
        toolsError.value = "";
        try {
            const [displayResult, userResult] = await Promise.all([
                getDisplaySettings(target),
                listUsers(target),
            ]);
            display.value = displayResult;
            users.value = userResult;
            animationValue.value = displayResult.windowScale || "1";
        } catch (error) {
            toolsError.value =
                error instanceof Error ? error.message : "读取设备设置失败";
        } finally {
            toolsBusy.value = false;
        }
    }

    function openDeviceTools() {
        toolsError.value = "";
        toolsNotice.value = "";
        sizeOverride.value = "";
        densityOverride.value = "";
        newUserName.value = "";
        showDeviceTools.value = true;
        void refreshDeviceTools();
    }

    async function deviceToolAction(
        action: () => Promise<string>,
        fallback: string,
    ) {
        if (toolsBusy.value) {
            return;
        }
        toolsBusy.value = true;
        toolsError.value = "";
        toolsNotice.value = "";
        try {
            toolsNotice.value = (await action()) || fallback;
            toolsBusy.value = false;
            await refreshDeviceTools();
        } catch (error) {
            toolsError.value =
                error instanceof Error ? error.message : "操作失败";
        } finally {
            toolsBusy.value = false;
        }
    }

    async function applyDisplaySize() {
        const target = activeSerial.value;
        if (!target) {
            return;
        }
        await deviceToolAction(
            () => setDisplaySize(target, sizeOverride.value.trim() || null),
            "分辨率已更新",
        );
    }

    async function applyDisplayDensity() {
        const target = activeSerial.value;
        if (!target) {
            return;
        }
        await deviceToolAction(
            () =>
                setDisplayDensity(
                    target,
                    densityOverride.value.trim() || null,
                ),
            "DPI 已更新",
        );
    }

    async function applyAnimationScale() {
        const target = activeSerial.value;
        if (!target) {
            return;
        }
        const value = animationValue.value.trim();
        if (value === "") {
            toolsError.value = "请输入动画缩放值";
            return;
        }
        toolsBusy.value = true;
        toolsError.value = "";
        try {
            await setAnimationScale(target, "window_animation_scale", value);
            await setAnimationScale(
                target,
                "transition_animation_scale",
                value,
            );
            await setAnimationScale(
                target,
                "animator_duration_scale",
                value,
            );
            toolsNotice.value = `动画缩放已设为 ${value}`;
            toolsBusy.value = false;
            await refreshDeviceTools();
        } catch (error) {
            toolsError.value =
                error instanceof Error ? error.message : "修改动画缩放失败";
        } finally {
            toolsBusy.value = false;
        }
    }

    async function toggleStayAwake(enabled: boolean) {
        const target = activeSerial.value;
        if (!target) {
            return;
        }
        await deviceToolAction(
            () => setStayAwake(target, enabled),
            enabled ? "已保持常亮" : "已取消常亮",
        );
    }

    async function sleepDeviceScreen() {
        const target = activeSerial.value;
        if (!target) {
            return;
        }
        await deviceToolAction(() => screenOff(target), "屏幕已熄灭");
    }

    async function addDeviceUser() {
        const target = activeSerial.value;
        const name = newUserName.value.trim();
        if (!target || name === "") {
            return;
        }
        await deviceToolAction(
            () => createUser(target, name),
            "用户已创建",
        );
        newUserName.value = "";
    }

    async function switchDeviceUser(userId: string) {
        const target = activeSerial.value;
        if (!target) {
            return;
        }
        await deviceToolAction(
            () => switchUser(target, userId),
            `已切换到用户 ${userId}`,
        );
    }

    async function deleteDeviceUser(user: DeviceUser) {
        const target = activeSerial.value;
        if (!target) {
            return;
        }
        if (!window.confirm(`确定删除用户 ${user.name}（${user.id}）吗？`)) {
            return;
        }
        await deviceToolAction(
            () => removeUser(target, user.id),
            `已删除用户 ${user.id}`,
        );
    }

    // ---------- FastBoot 变量 ----------
    const showFastbootVars = ref(false);
    const fastbootVars = ref("");
    const fastbootVarsLoading = ref(false);
    const fastbootVarsError = ref("");

    async function loadFastbootVars() {
        fastbootVarsLoading.value = true;
        fastbootVarsError.value = "";
        try {
            fastbootVars.value = await getFastbootVariables(
                activeSerial.value,
            );
        } catch (error) {
            fastbootVarsError.value =
                error instanceof Error ? error.message : "读取变量失败";
        } finally {
            fastbootVarsLoading.value = false;
        }
    }

    function openFastbootVars() {
        fastbootVars.value = "";
        showFastbootVars.value = true;
        void loadFastbootVars();
    }

    // ---------- 分区备份 ----------
    const showBackupDialog = ref(false);
    const backupPartitionName = ref("boot");
    const backupDirectory = ref("");
    const backupRunning = ref(false);
    const backupError = ref("");
    const backupNotice = ref("");
    const partitions = ref<string[]>([]);
    const partitionsLoading = ref(false);
    const partitionsError = ref("");

    async function loadPartitions() {
        const target = activeSerial.value;
        if (!target) {
            return;
        }
        partitionsLoading.value = true;
        partitionsError.value = "";
        try {
            partitions.value = await listPartitions(target);
            if (partitions.value.length === 0) {
                partitionsError.value =
                    "未能自动识别分区，请手动输入分区名";
            }
        } catch (error) {
            partitionsError.value =
                error instanceof Error ? error.message : "识别分区失败";
        } finally {
            partitionsLoading.value = false;
        }
    }

    function openBackupDialog() {
        backupPartitionName.value = "boot";
        backupDirectory.value = settings.downloadDirectory;
        backupError.value = "";
        backupNotice.value = "";
        partitions.value = [];
        partitionsError.value = "";
        showBackupDialog.value = true;
        void loadPartitions();
    }

    function closeBackupDialog() {
        if (!backupRunning.value) {
            showBackupDialog.value = false;
        }
    }

    async function chooseBackupDirectory() {
        const picked = await pickDirectory("选择分区备份保存目录");
        if (picked) {
            backupDirectory.value = picked;
        }
    }

    async function runBackup() {
        const target = activeSerial.value;
        if (!target || backupRunning.value) {
            return;
        }
        const partition = backupPartitionName.value.trim();
        if (partition === "") {
            backupError.value = "请输入分区名";
            return;
        }
        if (backupDirectory.value.trim() === "") {
            backupError.value = "请选择保存目录";
            return;
        }
        backupRunning.value = true;
        backupError.value = "";
        backupNotice.value = "备份中，请保持设备连接...";
        try {
            const saved = await backupPartition(
                target,
                partition,
                backupDirectory.value.trim(),
            );
            backupNotice.value = `已保存：${saved}`;
        } catch (error) {
            backupError.value =
                error instanceof Error ? error.message : "备份失败";
        } finally {
            backupRunning.value = false;
        }
    }

    onMounted(() => {
        startPolling();
        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("pagehide", stopPolling);
    });

    onBeforeUnmount(() => {
        stopPolling();
        closePreview();
        document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange,
        );
        window.removeEventListener("pagehide", stopPolling);
    });
</script>
<style scoped>
    .devices-layout {
        box-sizing: border-box;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 220px;
        gap: 24px;
        align-items: stretch;
        height: calc(100vh - 56px);
        min-height: 0;
        margin-inline: calc(-1 * var(--page-gutter));
        overflow-y: auto;
        overscroll-behavior: contain;
    }
    .page {
        height: auto;
        min-height: 100%;
        padding-inline: var(--page-gutter);
        padding-bottom: 24px;
        text-align: center;
    }
    .connection-error {
        margin: 10px 0 0;
        color: #dc2626;
        font-size: 13px;
    }
    .reload-button {
        margin-top: 14px;
        padding: 8px 16px;
        border: 1px solid var(--accent);
        background: #fff;
        color: var(--accent);
        font-family: inherit;
        font-size: 13px;
        cursor: pointer;
    }
    .reload-button:hover {
        background: rgba(59, 130, 246, 0.08);
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
        white-space: nowrap;
    }
    .deviceInfo-value {
        color: #1f2937;
        white-space: nowrap;
        word-break: keep-all;
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
    .danger-confirm {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin-top: 12px;
        color: #b91c1c;
        font-size: 13px;
        line-height: 1.5;
        cursor: pointer;
    }
    .danger-confirm input {
        margin-top: 2px;
    }
    .pair-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 12px;
    }
    .pair-form input {
        padding: 8px 10px;
        border: 1px solid #d1d5db;
        font-family: inherit;
        font-size: 13px;
    }
    .pair-form input:focus {
        border-color: var(--accent);
        outline: none;
    }
    .partition-hint {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: 0;
        color: #6b7280;
        font-size: 12px;
        text-align: left;
    }
    .link-button {
        flex: none;
        padding: 2px 4px;
        border: none;
        background: none;
        color: var(--accent);
        font-family: inherit;
        font-size: 12px;
        cursor: pointer;
    }
    .link-button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
    .pair-success {
        margin-top: 8px;
        color: #166534;
        font-size: 13px;
        text-align: left;
        word-break: break-all;
    }
    .command-modes {
        display: flex;
        gap: 16px;
        margin: 8px 0 10px;
        color: #374151;
        font-size: 13px;
    }
    .command-modes label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }
    .command-history {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-top: 10px;
        color: #6b7280;
        font-size: 12px;
    }
    .command-history button {
        max-width: 100%;
        padding: 3px 8px;
        overflow: hidden;
        border: 1px solid #e5e7eb;
        background: #f9fafb;
        color: #374151;
        font-family: Consolas, monospace;
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
    }
    .command-history button:hover:not(:disabled) {
        border-color: var(--accent);
        color: var(--accent);
    }
    .command-output {
        max-height: 240px;
        margin: 10px 0 0;
        padding: 10px;
        overflow: auto;
        background: #0f172a;
        color: #e2e8f0;
        font-family: Consolas, monospace;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-all;
    }
    .tool-section {
        margin: 16px 0 6px;
        color: var(--accent);
        font-size: 13px;
        text-align: left;
    }
    .script-input {
        box-sizing: border-box;
        width: 100%;
        min-height: 110px;
        margin-bottom: 8px;
        padding: 8px 10px;
        border: 1px solid #d1d5db;
        font-family: Consolas, monospace;
        font-size: 12px;
        line-height: 1.5;
        resize: vertical;
    }
    .script-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 8px;
        text-align: left;
    }
    .script-item {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .script-load {
        flex: 1;
        padding: 4px 8px;
        overflow: hidden;
        border: 1px solid #e5e7eb;
        background: #f9fafb;
        color: #374151;
        font-family: inherit;
        font-size: 12px;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
    }
    .script-delete {
        flex: none;
        padding: 4px 8px;
        border: 1px solid #fecaca;
        background: #fff;
        color: #dc2626;
        font-family: inherit;
        font-size: 11px;
        cursor: pointer;
    }
    .tool-list {
        max-height: 180px;
        padding: 6px 10px;
        overflow-y: auto;
        border: 1px solid #e5e7eb;
        background: #f9fafb;
    }
    .tool-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 6px 0;
        border-bottom: 1px solid #e5e7eb;
        font-size: 13px;
        text-align: left;
    }
    .tool-row:last-child {
        border-bottom: none;
    }
    .tool-row-actions {
        display: flex;
        flex: none;
        gap: 6px;
    }
    .action-pick.danger {
        border-color: #dc2626;
        color: #dc2626;
    }
    .preview-dialog {
        width: min(480px, calc(100% - 32px));
    }
    .preview-dialog .dialog-actions {
        flex-wrap: wrap;
    }
    .preview-image {
        display: block;
        box-sizing: border-box;
        width: 100%;
        max-height: 62vh;
        margin: 10px auto 0;
        object-fit: contain;
        border: 1px solid #e5e7eb;
        background: #0f172a;
        cursor: crosshair;
        touch-action: none;
        user-select: none;
    }
    .preview-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
    }
    .preview-controls .dialog-cancel {
        min-width: 0;
        padding: 6px 10px;
        font-size: 12px;
    }
    .preview-controls button {
        border: 1px solid var(--accent);
        background: #fff;
        color: var(--accent);
        font-family: inherit;
        font-size: 12px;
        cursor: pointer;
    }
    .preview-controls button:hover {
        background: rgba(59, 130, 246, 0.08);
    }
    .preview-hint {
        margin: 8px 0 0;
        color: #6b7280;
        font-size: 12px;
        line-height: 1.5;
        text-align: left;
    }
    .preview-text {
        flex: 1;
        min-width: 140px;
        padding: 6px 8px;
        border: 1px solid #d1d5db;
        font-family: inherit;
        font-size: 12px;
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
        position: sticky;
        top: 0;
        align-self: start;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        height: calc(100vh - 56px);
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
        border-radius: 0;
        background: #fff;
        color: var(--accent);
        font-family: inherit;
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
        border: 1px solid var(--accent);
        border-radius: 0;
        background: #fff;
        color: var(--accent);
        font-family: inherit;
        font-size: 13px;
        cursor: pointer;
    }
    .copy-button:hover {
        background: rgba(59, 130, 246, 0.08);
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
        border: 1px solid var(--accent);
        border-radius: 0;
        background: #fff;
        color: var(--accent);
        font-family: inherit;
        font-size: 14px;
        cursor: pointer;
        transition: background-color 0.15s ease, color 0.15s ease,
            opacity 0.15s ease;
    }
    .dialog-cancel {
        color: var(--accent);
        background: #fff;
    }
    .dialog-cancel:hover {
        background: rgba(59, 130, 246, 0.08);
    }
    .dialog-confirm {
        border-color: var(--accent);
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
