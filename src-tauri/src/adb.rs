use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{Emitter, State};
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
            "uninstall",
            "push",
            "pull",
            "reboot",
            "connect",
            "disconnect",
            "tcpip",
            "pair",
            "logcat",
            "version",
            "kill-server",
            "start-server",
        ],
        "fastboot" => &[
            "devices",
            "flash",
            "flashing",
            "reboot",
            "oem",
            "getvar",
            "--version",
        ],
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

// 把耗时的子进程操作放到后台线程，避免阻塞界面
async fn run_blocking<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("后台任务执行失败: {error}"))?
}

#[tauri::command]
pub async fn run_device_tool(
    app: tauri::AppHandle,
    tool: String,
    args: Vec<String>,
) -> Result<ToolOutput, String> {
    run_blocking(move || {
        validate_args(&tool, &args)?;

        let executable = tool_executable(&app, &tool)
            .ok_or_else(|| format!("未找到 tools/{}", tool_name(&tool)))?;
        let mut command = build_command(executable);
        command.args(&args);

        let output = run_command(command, COMMAND_TIMEOUT)?;
        Ok(ToolOutput {
            code: output.code,
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    })
    .await
}

// 截图并以 PNG 保存到指定目录
#[tauri::command]
pub async fn take_screenshot(
    app: tauri::AppHandle,
    serial: Option<String>,
    directory: String,
) -> Result<String, String> {
    run_blocking(move || take_screenshot_blocking(&app, serial.as_deref(), &directory)).await
}

fn take_screenshot_blocking(
    app: &tauri::AppHandle,
    serial: Option<&str>,
    directory: &str,
) -> Result<String, String> {
    let adb = tool_executable(app, "adb").ok_or("未找到 tools/adb.exe")?;

    let mut command = build_command(adb);
    if let Some(serial) = serial {
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

    let dir = PathBuf::from(directory);
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

// 打开交互式终端，并把 tools 目录加入 PATH，方便直接调用 adb / fastboot
#[tauri::command]
pub fn open_terminal(app: tauri::AppHandle, shell: String) -> Result<(), String> {
    let executable = tool_executable(&app, "adb").ok_or("未找到 tools/adb.exe")?;
    let tools = executable.parent().ok_or("tools 目录不存在")?;

    let mut paths = vec![tools.to_path_buf()];
    if let Some(path) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&path));
    }
    let path =
        std::env::join_paths(paths).map_err(|error| format!("设置 PATH 失败: {error}"))?;

    let mut command = if shell == "powershell" {
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoExit",
            "-Command",
            "$host.UI.RawUI.WindowTitle = 'Cat Android Box'",
        ]);
        command
    } else {
        let mut command = Command::new("cmd.exe");
        command.args(["/K", "title Cat Android Box"]);
        command
    };

    command.current_dir(tools).env("PATH", path);

    // 开发模式下父进程带有控制台，必须新建控制台，避免命令混入启动它的终端
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0000_0010);
    }

    command
        .spawn()
        .map_err(|error| format!("启动终端失败: {error}"))?;

    Ok(())
}

// 抓取当前屏幕，返回可直接展示的 data URL
#[tauri::command]
pub async fn capture_screen(
    app: tauri::AppHandle,
    serial: Option<String>,
) -> Result<String, String> {
    run_blocking(move || capture_screen_blocking(&app, serial.as_deref())).await
}

fn capture_screen_blocking(
    app: &tauri::AppHandle,
    serial: Option<&str>,
) -> Result<String, String> {
    use base64::Engine;

    let executable = tool_executable(app, "adb").ok_or("未找到 tools/adb.exe")?;
    let mut command = build_command(executable);
    if let Some(serial) = serial {
        command.args(["-s", serial]);
    }
    command.args(["exec-out", "screencap", "-p"]);

    let output = run_command(command, Duration::from_secs(30))?;
    if output.code != Some(0) || output.stdout.is_empty() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "截图失败".to_string()
        } else {
            message
        });
    }

    let encoded = base64::engine::general_purpose::STANDARD.encode(output.stdout);
    Ok(format!("data:image/png;base64,{encoded}"))
}

// 把文本保存到用户指定的文件（日志导出等）
#[tauri::command]
pub fn save_text_file(path: String, contents: String) -> Result<String, String> {
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err("保存目录不存在".to_string());
        }
    }
    if target.is_dir() {
        return Err("目标路径是目录".to_string());
    }
    fs::write(&target, contents.as_bytes()).map_err(|error| format!("保存文件失败: {error}"))?;
    Ok(target.display().to_string())
}

// 在资源目录、开发目录、可执行文件旁查找指定工具
fn find_tool_file(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
    use tauri::Manager;

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("tools").join(name);
        if bundled.is_file() {
            return Some(bundled);
        }
    }

    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tools")
        .join(name);
    if dev.is_file() {
        return Some(dev);
    }

    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("tools").join(name)))
        .filter(|candidate| candidate.is_file())
}

// 录制指定秒数的屏幕并拉回电脑
#[tauri::command]
pub async fn record_screen(
    app: tauri::AppHandle,
    serial: String,
    directory: String,
    seconds: u64,
) -> Result<String, String> {
    run_blocking(move || record_screen_blocking(&app, &serial, &directory, seconds)).await
}

fn record_screen_blocking(
    app: &tauri::AppHandle,
    serial: &str,
    directory: &str,
    seconds: u64,
) -> Result<String, String> {
    let adb = tool_executable(app, "adb").ok_or("未找到 tools/adb.exe")?;
    let dir = PathBuf::from(directory);
    if !dir.is_dir() {
        return Err("保存目录不存在".to_string());
    }

    let seconds = seconds.clamp(1, 180);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("读取时间失败: {error}"))?
        .as_millis();
    let remote = format!("/sdcard/catbox-record-{timestamp}.mp4");

    let mut record = build_command(adb.clone());
    record.args([
        "-s",
        serial,
        "shell",
        "screenrecord",
        "--time-limit",
        &seconds.to_string(),
        &remote,
    ]);
    let output = run_command(record, Duration::from_secs(seconds + 60))?;
    if output.code != Some(0) {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "录屏失败".to_string()
        } else {
            message
        });
    }

    let local = dir.join(format!("record-{timestamp}.mp4"));
    let mut pull = build_command(adb.clone());
    pull.args(["-s", serial, "pull", &remote, &local.display().to_string()]);
    let pulled = run_command(pull, Duration::from_secs(180))?;
    if pulled.code != Some(0) {
        let message = String::from_utf8_lossy(&pulled.stderr)
            .trim()
            .to_string();
        return Err(if message.is_empty() {
            "拉取录屏文件失败".to_string()
        } else {
            message
        });
    }

    let mut cleanup = build_command(adb);
    cleanup.args(["-s", serial, "shell", "rm", "-f", &remote]);
    let _ = run_command(cleanup, Duration::from_secs(30));

    Ok(local.display().to_string())
}

// 启动内置 scrcpy 投屏
#[tauri::command]
pub fn launch_scrcpy(app: tauri::AppHandle, serial: Option<String>) -> Result<(), String> {
    let executable = find_tool_file(&app, "scrcpy.exe")
        .ok_or("未找到内置 scrcpy，请重新安装应用")?;
    let tools = executable.parent().ok_or("scrcpy 目录不存在")?;

    let mut command = Command::new(&executable);
    if let Some(serial) = serial {
        command.args(["-s", &serial]);
    }
    command.current_dir(tools);
    command
        .spawn()
        .map_err(|error| format!("启动 scrcpy 失败: {error}"))?;
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppMetadata {
    pub label: Option<String>,
    pub icon: Option<String>,
    pub icon_background: Option<String>,
}

// 从设备 APK 中按需读取应用名称和图标，不下载完整安装包
#[tauri::command]
pub async fn get_app_metadata(
    app: tauri::AppHandle,
    serial: String,
    apk_path: String,
) -> Result<AppMetadata, String> {
    run_blocking(move || get_app_metadata_blocking(&app, &serial, &apk_path)).await
}

fn get_app_metadata_blocking(
    app: &tauri::AppHandle,
    serial: &str,
    apk_path: &str,
) -> Result<AppMetadata, String> {
    use apk_info_axml::{ARSC, AXML};

    let adb = tool_executable(app, "adb").ok_or("未找到 tools/adb.exe")?;

    let manifest = adb_unzip_entry(&adb, serial, apk_path, "AndroidManifest.xml")?;
    let arsc_bytes = adb_unzip_entry(&adb, serial, apk_path, "resources.arsc").ok();
    let arsc = arsc_bytes
        .as_ref()
        .and_then(|bytes| ARSC::new(&mut bytes.as_slice()).ok());

    let mut manifest_slice = manifest.as_slice();
    let axml = AXML::new(&mut manifest_slice, arsc.as_ref())
        .map_err(|error| format!("解析 APK 失败: {error}"))?;

    let label = axml
        .get_attribute_value("application", "label", arsc.as_ref())
        .filter(|value| !value.starts_with('@'));
    let mut icon_path = axml
        .get_attribute_value("application", "icon", arsc.as_ref())
        .filter(|value| !value.starts_with('@'));
    let mut icon_background = None;
    let mut basenames: Vec<String> = Vec::new();

    if let Some(path) = icon_path.clone() {
        if let Some(name) = icon_basename(&path) {
            basenames.push(name);
        }
        if path.ends_with(".xml") {
            // 自适应图标：从 XML 中取前景图和背景色
            if let Ok(xml_bytes) = adb_unzip_entry(&adb, serial, apk_path, &path) {
                let mut slice = xml_bytes.as_slice();
                if let Ok(icon_xml) = AXML::new(&mut slice, arsc.as_ref()) {
                    let foreground = icon_xml
                        .get_attribute_value("foreground", "drawable", arsc.as_ref())
                        .filter(|value| !value.starts_with('@'));
                    let background = icon_xml
                        .get_attribute_value("background", "drawable", arsc.as_ref())
                        .filter(|value| value.starts_with('#'));
                    icon_background = background;
                    if let Some(foreground) = foreground {
                        if let Some(name) = icon_basename(&foreground) {
                            if !basenames.contains(&name) {
                                basenames.push(name);
                            }
                        }
                        icon_path = Some(foreground);
                    } else {
                        icon_path = None;
                    }
                } else {
                    icon_path = None;
                }
            } else {
                icon_path = None;
            }
        }
    }

    let mut icon = icon_path
        .as_deref()
        .and_then(|path| fetch_icon_data(&adb, serial, apk_path, path));

    if icon.is_none() {
        // 矢量/自适应/无扩展名图标回退到同名的传统位图启动图标
        for basename in basenames {
            icon = find_legacy_icon(&adb, serial, apk_path, &basename);
            if icon.is_some() {
                break;
            }
        }
    }

    Ok(AppMetadata {
        label,
        icon,
        icon_background,
    })
}

fn icon_basename(path: &str) -> Option<String> {
    path.rsplit('/')
        .next()
        .map(|name| name.split('.').next().unwrap_or(name).to_string())
        .filter(|name| !name.is_empty())
}

fn fetch_icon_data(
    adb: &std::path::Path,
    serial: &str,
    apk_path: &str,
    icon_path: &str,
) -> Option<String> {
    use base64::Engine;

    let bytes = adb_unzip_entry(adb, serial, apk_path, icon_path).ok()?;
    // APK 里的图片不一定带扩展名，按文件头判断格式
    let mime = if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "image/png"
    } else if bytes.len() > 12
        && bytes.starts_with(b"RIFF")
        && &bytes[8..12] == b"WEBP"
    {
        "image/webp"
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else {
        return None;
    };
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

// 在 APK 条目里找同名的高分辨率传统图标
fn find_legacy_icon(
    adb: &std::path::Path,
    serial: &str,
    apk_path: &str,
    basename: &str,
) -> Option<String> {
    let mut command = build_command(adb.to_path_buf());
    command.args(["-s", serial, "exec-out", "unzip", "-l", apk_path]);
    let output = run_command(command, Duration::from_secs(60)).ok()?;
    if output.code != Some(0) {
        return None;
    }

    let listing = String::from_utf8_lossy(&output.stdout);
    let mut candidates: Vec<(u8, String)> = Vec::new();
    for line in listing.lines() {
        let path = line.split_whitespace().last().unwrap_or("");
        if !path.starts_with("res/") || path.ends_with(".xml") {
            continue;
        }
        let stem = icon_basename(path).unwrap_or_default();
        let score = if stem == basename {
            20
        } else if stem == format!("{basename}_foreground") {
            16
        } else if stem.starts_with(basename) {
            10
        } else if basename.starts_with("ic_launcher")
            && stem.contains("ic_launcher")
        {
            6
        } else {
            continue;
        };
        let density = if path.contains("xxxhdpi") {
            5
        } else if path.contains("xxhdpi") {
            4
        } else if path.contains("xhdpi") {
            3
        } else if path.contains("hdpi") {
            2
        } else if path.contains("mdpi") {
            1
        } else {
            0
        };
        candidates.push((score + density, path.to_string()));
    }

    candidates.sort_by_key(|(score, _)| std::cmp::Reverse(*score));
    for (_, path) in candidates {
        if let Some(data) = fetch_icon_data(adb, serial, apk_path, &path) {
            return Some(data);
        }
    }
    None
}

// 通过 adb unzip -p 只取 APK 中的单个文件
fn adb_unzip_entry(
    adb: &std::path::Path,
    serial: &str,
    apk_path: &str,
    entry: &str,
) -> Result<Vec<u8>, String> {
    let mut command = build_command(adb.to_path_buf());
    command.args(["-s", serial, "exec-out", "unzip", "-p", apk_path, entry]);
    let output = run_command(command, Duration::from_secs(60))?;
    if output.code != Some(0) || output.stdout.is_empty() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            format!("读取 {entry} 失败")
        } else {
            message
        });
    }
    Ok(output.stdout)
}

fn remote_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn command_text(output: RawOutput, fallback: &str) -> Result<String, String> {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.code != Some(0) || stdout.contains("Failure") {
        return Err(if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            fallback.to_string()
        });
    }
    Ok(if stdout.is_empty() {
        fallback.to_string()
    } else {
        stdout
    })
}

// 安装 APK / APKS / XAPK
#[tauri::command]
pub async fn install_package(
    app: tauri::AppHandle,
    serial: String,
    path: String,
) -> Result<String, String> {
    run_blocking(move || install_package_blocking(&app, &serial, &path)).await
}

fn install_package_blocking(
    app: &tauri::AppHandle,
    serial: &str,
    path: &str,
) -> Result<String, String> {
    let adb = tool_executable(app, "adb").ok_or("未找到 tools/adb.exe")?;

    if path.to_lowercase().ends_with(".apk") {
        let mut command = build_command(adb);
        command.args(["-s", serial, "install", "-r", path]);
        return command_text(
            run_command(command, COMMAND_TIMEOUT)?,
            "安装完成",
        );
    }

    let file = fs::File::open(path).map_err(|error| format!("打开安装包失败: {error}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|error| format!("解析安装包失败: {error}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("读取时间失败: {error}"))?
        .as_millis();
    let temp_dir = std::env::temp_dir().join(format!("catbox-install-{stamp}"));
    fs::create_dir_all(&temp_dir).map_err(|error| format!("创建临时目录失败: {error}"))?;

    let mut apk_files = Vec::new();
    for index in 0..archive.len() {
        let mut entry = match archive.by_index(index) {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let name = match entry.name() {
            Ok(name) => name.to_string(),
            Err(_) => continue,
        };
        if !name.to_lowercase().ends_with(".apk") || name.ends_with('/') {
            continue;
        }
        let file_name = PathBuf::from(&name)
            .file_name()
            .map(|value| value.to_owned())
            .unwrap_or_default();
        if file_name.is_empty() {
            continue;
        }
        let target = temp_dir.join(file_name);
        let mut out = fs::File::create(&target)
            .map_err(|error| format!("写入临时 APK 失败: {error}"))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|error| format!("解压 APK 失败: {error}"))?;
        apk_files.push(target);
    }

    if apk_files.is_empty() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err("安装包中没有 APK 文件".to_string());
    }

    let mut command = build_command(adb);
    command.args(["-s", serial, "install-multiple", "-r"]);
    for file in &apk_files {
        command.arg(file);
    }
    let result = run_command(command, COMMAND_TIMEOUT);
    let _ = fs::remove_dir_all(&temp_dir);
    command_text(result?, "安装完成")
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    pub mime: String,
    pub data: String,
    pub size: u64,
}

// 读取设备上的文件用于预览（限制大小）
#[tauri::command]
pub async fn read_device_file(
    app: tauri::AppHandle,
    serial: String,
    path: String,
    max_bytes: u64,
) -> Result<FilePreview, String> {
    run_blocking(move || read_device_file_blocking(&app, &serial, &path, max_bytes)).await
}

fn read_device_file_blocking(
    app: &tauri::AppHandle,
    serial: &str,
    path: &str,
    max_bytes: u64,
) -> Result<FilePreview, String> {
    use base64::Engine;

    let adb = tool_executable(app, "adb").ok_or("未找到 tools/adb.exe")?;
    let limit = max_bytes.clamp(1024, 20 * 1024 * 1024);
    let quoted = remote_quote(path);

    let mut stat = build_command(adb.clone());
    stat.args([
        "-s",
        serial,
        "shell",
        &format!("stat -c %s {quoted}"),
    ]);
    if let Ok(output) = run_command(stat, Duration::from_secs(30)) {
        if output.code == Some(0) {
            let size = String::from_utf8_lossy(&output.stdout)
                .trim()
                .parse::<u64>()
                .unwrap_or(0);
            if size > limit {
                return Err(format!(
                    "文件过大（{}），请先下载到电脑查看",
                    format_bytes(size)
                ));
            }
        }
    }

    let mut command = build_command(adb);
    command.args(["-s", serial, "exec-out", &format!("cat {quoted}")]);
    let output = run_command(command, Duration::from_secs(60))?;
    if output.code != Some(0) || output.stdout.is_empty() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "读取文件失败".to_string()
        } else {
            message
        });
    }

    let bytes = output.stdout;
    let size = bytes.len() as u64;
    let mime = if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "image/png"
    } else if bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else {
        "text/plain"
    };

    Ok(FilePreview {
        mime: mime.to_string(),
        data: base64::engine::general_purpose::STANDARD.encode(bytes),
        size,
    })
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["KB", "MB", "GB", "TB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let mut value = bytes as f64 / 1024.0;
    let mut index = 0;
    while value >= 1024.0 && index < UNITS.len() - 1 {
        value /= 1024.0;
        index += 1;
    }
    format!("{value:.1} {}", UNITS[index])
}

#[derive(Default)]
pub struct LogcatState(pub Mutex<Option<Child>>);

fn stop_logcat_inner(state: &LogcatState) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
pub fn start_logcat(
    app: tauri::AppHandle,
    state: State<'_, LogcatState>,
    serial: String,
) -> Result<(), String> {
    stop_logcat_inner(&state);

    let adb = tool_executable(&app, "adb").ok_or("未找到 tools/adb.exe")?;
    let mut command = build_command(adb);
    command
        .args(["-s", &serial, "logcat", "-v", "time"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|error| format!("启动 Logcat 失败: {error}"))?;
    let stdout = child.stdout.take().ok_or("无法读取 Logcat 输出")?;

    // 读线程只负责读，批量线程每 300ms 合并一次事件，避免高频日志冲垮前端
    let (sender, receiver) = std::sync::mpsc::sync_channel::<String>(8192);
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if sender.send(line).is_err() {
                break;
            }
        }
    });

    let handle = app.clone();
    std::thread::spawn(move || {
        use std::sync::mpsc::RecvTimeoutError;
        use std::time::{Duration, Instant};

        let mut batch: Vec<String> = Vec::new();
        let mut last_emit = Instant::now();
        loop {
            match receiver.recv_timeout(Duration::from_millis(300)) {
                Ok(line) => {
                    batch.push(line);
                    if batch.len() >= 300
                        || last_emit.elapsed() >= Duration::from_millis(300)
                    {
                        let _ = handle.emit(
                            "logcat-batch",
                            std::mem::take(&mut batch),
                        );
                        last_emit = Instant::now();
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if !batch.is_empty() {
                        let _ = handle.emit(
                            "logcat-batch",
                            std::mem::take(&mut batch),
                        );
                        last_emit = Instant::now();
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    if !batch.is_empty() {
                        let _ = handle.emit("logcat-batch", batch);
                    }
                    break;
                }
            }
        }
    });

    let mut guard = state.0.lock().map_err(|_| "Logcat 状态锁失败")?;
    *guard = Some(child);
    Ok(())
}

#[tauri::command]
pub fn stop_logcat(state: State<'_, LogcatState>) -> Result<(), String> {
    stop_logcat_inner(&state);
    Ok(())
}

// 通过 root 备份分区为 img 文件并拉回电脑
#[tauri::command]
pub async fn backup_partition(
    app: tauri::AppHandle,
    serial: String,
    partition: String,
    directory: String,
) -> Result<String, String> {
    run_blocking(move || {
        backup_partition_blocking(&app, &serial, &partition, &directory)
    })
    .await
}

fn backup_partition_blocking(
    app: &tauri::AppHandle,
    serial: &str,
    partition: &str,
    directory: &str,
) -> Result<String, String> {
    if partition.is_empty()
        || !partition
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return Err("分区名只能包含字母、数字、下划线和短横线".to_string());
    }
    let dir = PathBuf::from(directory);
    if !dir.is_dir() {
        return Err("保存目录不存在".to_string());
    }

    let adb = tool_executable(app, "adb").ok_or("未找到 tools/adb.exe")?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("读取时间失败: {error}"))?
        .as_millis();
    let remote = format!("/sdcard/catbox-{partition}-{stamp}.img");

    let mut dump = build_command(adb.clone());
    dump.args([
        "-s",
        serial,
        "shell",
        &format!(
            "su -c 'dd if=/dev/block/by-name/{partition} of={remote}'"
        ),
    ]);
    let output = run_command(dump, Duration::from_secs(300))?;
    if output.code != Some(0) {
        let message = String::from_utf8_lossy(&output.stderr)
            .trim()
            .to_string();
        return Err(if message.is_empty() {
            "备份失败，请确认设备已 root".to_string()
        } else {
            message
        });
    }

    let local = dir.join(format!("{partition}-{stamp}.img"));
    let mut pull = build_command(adb.clone());
    pull.args(["-s", serial, "pull", &remote, &local.display().to_string()]);
    let pulled = run_command(pull, Duration::from_secs(300))?;

    if pulled.code != Some(0) {
        let message = String::from_utf8_lossy(&pulled.stderr)
            .trim()
            .to_string();
        return Err(if message.is_empty() {
            "拉取备份文件失败".to_string()
        } else {
            message
        });
    }

    let mut cleanup = build_command(adb);
    cleanup.args(["-s", serial, "shell", "rm", "-f", &remote]);
    let _ = run_command(cleanup, Duration::from_secs(30));

    Ok(local.display().to_string())
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
