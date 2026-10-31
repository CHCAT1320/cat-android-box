use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use wait_timeout::ChildExt;

// 统一命令超时，避免 push / flash 大文件被提前截断
const COMMAND_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Clone, Serialize)]
pub struct ToolOutput {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

struct RawOutput {
    code: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

// 构造工具命令，Windows 下隐藏控制台窗口
fn build_command(executable: PathBuf) -> Command {
    let mut command = Command::new(executable);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    command
}

fn tool_name(tool: &str) -> &'static str {
    if tool == "fastboot" {
        if cfg!(windows) { "fastboot.exe" } else { "fastboot" }
    } else if cfg!(windows) {
        "adb.exe"
    } else {
        "adb"
    }
}

// 不依赖 Tauri 上下文查找工具：项目 tools 目录、可执行文件旁的 tools 目录
fn tool_from_disk(tool: &str) -> Option<PathBuf> {
    let name = tool_name(tool);

    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tools")
        .join(name);
    if dev.is_file() {
        return Some(dev);
    }

    let local = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("tools").join(name)))?;
    local.is_file().then_some(local)
}

// 依次尝试：打包后的资源目录、开发时的项目 tools 目录、可执行文件旁的 tools 目录
fn tool_executable(app: &tauri::AppHandle, tool: &str) -> Option<PathBuf> {
    use tauri::Manager;

    let name = tool_name(tool);

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("tools").join(name);
        if bundled.is_file() {
            return Some(bundled);
        }
    }

    tool_from_disk(tool)
}

// 只允许前端调用受支持的工具与子命令，避免任意执行
fn allowed_verbs(tool: &str) -> &'static [&'static str] {
    match tool {
        "adb" => &[
            "devices",
            "shell",
            "install",
            "push",
            "reboot",
            "connect",
            "disconnect",
            "tcpip",
        ],
        "fastboot" => &["devices", "flash", "flashing"],
        _ => &[],
    }
}

fn validate_args(tool: &str, args: &[String]) -> Result<(), String> {
    let mut rest = args;

    // 跳过 -s <serial> 前缀，校验真正的子命令
    if rest.first().map(String::as_str) == Some("-s") {
        if rest.len() < 3 {
            return Err("缺少设备序列号或命令".to_string());
        }
        rest = &rest[2..];
    }

    let verb = rest.first().map(String::as_str).ok_or("缺少命令参数")?;
    if !allowed_verbs(tool).contains(&verb) {
        return Err(format!("不允许的 {tool} 命令: {verb}"));
    }

    Ok(())
}

// 带超时执行命令并读取输出，避免子进程管道阻塞
fn run_command(mut command: Command, timeout: Duration) -> Result<RawOutput, String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| format!("启动进程失败: {error}"))?;

    let stdout = child.stdout.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let mut buffer = Vec::new();
            let _ = pipe.read_to_end(&mut buffer);
            buffer
        })
    });
    let stderr = child.stderr.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let mut buffer = Vec::new();
            let _ = pipe.read_to_end(&mut buffer);
            buffer
        })
    });

    let status = match child.wait_timeout(timeout) {
        Ok(Some(status)) => status,
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("命令执行超时（{} 秒）", timeout.as_secs()));
        }
        Err(error) => return Err(format!("等待进程失败: {error}")),
    };

    let stdout = stdout
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();
    let stderr = stderr
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();

    Ok(RawOutput {
        code: status.code(),
        stdout,
        stderr,
    })
}

#[tauri::command]
pub fn run_device_tool(
    app: tauri::AppHandle,
    tool: String,
    args: Vec<String>,
) -> Result<ToolOutput, String> {
    validate_args(&tool, &args)?;

    let executable =
        tool_executable(&app, &tool).ok_or_else(|| format!("未找到 tools/{}", tool_name(&tool)))?;
    let mut command = build_command(executable);
    command.args(&args);

    let output = run_command(command, COMMAND_TIMEOUT)?;
    Ok(ToolOutput {
        code: output.code,
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

// 截图并以 PNG 保存到指定目录
#[tauri::command]
pub fn take_screenshot(
    app: tauri::AppHandle,
    serial: Option<String>,
    directory: String,
) -> Result<String, String> {
    let adb = tool_executable(&app, "adb").ok_or("未找到 tools/adb.exe")?;

    let mut command = build_command(adb);
    if let Some(serial) = serial.as_deref() {
        command.args(["-s", serial]);
    }
    command.args(["exec-out", "screencap", "-p"]);

    let output = run_command(command, Duration::from_secs(30))?;
    if output.code != Some(0) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.trim().is_empty() {
            "截图失败".to_string()
        } else {
            stderr.trim().to_string()
        });
    }

    let dir = PathBuf::from(&directory);
    if !dir.is_dir() {
        return Err("保存目录不存在".to_string());
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("读取时间失败: {error}"))?
        .as_millis();
    let file = dir.join(format!("screenshot-{timestamp}.png"));
    fs::write(&file, output.stdout).map_err(|error| format!("保存截图失败: {error}"))?;

    Ok(file.display().to_string())
}

// 停止 adb 服务，避免程序退出后后台残留 adb 进程
pub fn stop_adb(app: &tauri::AppHandle) {
    if let Some(adb) = tool_executable(app, "adb") {
        let mut command = build_command(adb);
        command.arg("kill-server");
        let _ = command.status();
    }
}

// Ctrl+C 或控制台关闭时执行 adb kill-server（窗口叉号走 Tauri 退出事件）
#[cfg(windows)]
mod ctrl_c {
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::OnceLock;

    static ADB: OnceLock<PathBuf> = OnceLock::new();

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetConsoleCtrlHandler(
            handler: Option<unsafe extern "system" fn(u32) -> i32>,
            add: i32,
        ) -> i32;
    }

    unsafe extern "system" fn handler(_ctrl_type: u32) -> i32 {
        if let Some(adb) = ADB.get() {
            let mut command = Command::new(adb);
            command.arg("kill-server");
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
            let _ = command.status();
        }
        // 返回 0 交给系统默认处理，继续正常结束进程
        0
    }

    pub fn install(adb: Option<PathBuf>) {
        if let Some(adb) = adb {
            let _ = ADB.set(adb);
        }
        // 无控制台时注册失败，忽略即可
        unsafe {
            SetConsoleCtrlHandler(Some(handler), 1);
        }
    }
}

pub fn install_ctrlc_handler() {
    #[cfg(windows)]
    ctrl_c::install(tool_from_disk("adb"));
}
