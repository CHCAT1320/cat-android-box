mod adb;

#[tauri::command]
fn pick_file(title: String, extensions: Vec<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new().set_title(&title);
    let extensions: Vec<&str> = extensions.iter().map(String::as_str).collect();
    if !extensions.is_empty() {
        dialog = dialog.add_filter("文件", &extensions);
    }
    dialog.pick_file().map(|path| path.display().to_string())
}

#[tauri::command]
fn pick_files(title: String, extensions: Vec<String>) -> Option<Vec<String>> {
    let mut dialog = rfd::FileDialog::new().set_title(&title);
    let extensions: Vec<&str> = extensions.iter().map(String::as_str).collect();
    if !extensions.is_empty() {
        dialog = dialog.add_filter("文件", &extensions);
    }
    dialog.pick_files().map(|paths| {
        paths
            .iter()
            .map(|path| path.display().to_string())
            .collect()
    })
}

#[tauri::command]
fn pick_directory(title: String) -> Option<String> {
    rfd::FileDialog::new()
        .set_title(&title)
        .pick_folder()
        .map(|path| path.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    adb::install_ctrlc_handler();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            adb::run_device_tool,
            adb::take_screenshot,
            pick_file,
            pick_files,
            pick_directory
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // 点击窗口叉号等正常退出时停止 adb
            if let tauri::RunEvent::Exit = event {
                adb::stop_adb(app);
            }
        });
}
