use std::{process::Command, sync::Mutex};
use tauri::{Emitter, Manager};
use pulldown_cmark::{html, Options, Parser};

struct InitialFile(Mutex<Option<String>>);
struct AppReady(std::sync::atomic::AtomicBool);

fn is_markdown_file(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

fn find_md_arg(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| is_markdown_file(a))
        .cloned()
}

#[tauri::command]
fn get_initial_file(state: tauri::State<'_, InitialFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[tauri::command]
fn mark_ready(state: tauri::State<'_, AppReady>) {
    state.0.store(true, std::sync::atomic::Ordering::Release);
}

#[tauri::command]
fn render_markdown(markdown: String) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_GFM);

    let parser = Parser::new_ext(&markdown, options);
    let mut html_output = String::with_capacity(markdown.len() * 2);
    html::push_html(&mut html_output, parser);
    html_output
}

#[tauri::command]
fn get_installed_fonts() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Drawing; [System.Drawing.Text.InstalledFontCollection]::new().Families | ForEach-Object { $_.Name } | Sort-Object -Unique",
            ])
            .output()
            .map_err(|err| format!("failed to enumerate fonts: {err}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("font enumeration failed: {}", stderr.trim()));
        }

        let mut fonts: Vec<String> = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToOwned::to_owned)
            .collect();
        fonts.sort_unstable();
        fonts.dedup();
        return Ok(fonts);
    }

    #[cfg(target_os = "macos")]
    {
        use core_text::font_collection;

        let collection = font_collection::create_for_all_families();
        if let Some(descriptors) = collection.get_descriptors() {
            let mut seen = std::collections::HashSet::new();
            for descriptor in descriptors.iter() {
                let family = descriptor.family_name();
                if !family.is_empty() {
                    seen.insert(family);
                }
            }
            let mut fonts: Vec<String> = seen.into_iter().collect();
            fonts.sort_unstable();
            return Ok(fonts);
        }
        return Ok(Vec::new());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Ok(Vec::new())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = find_md_arg(&argv) {
                let _ = app.emit("file-open", path);
            }
            // Focus existing window
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .manage(InitialFile(Mutex::new(None)))
        .manage(AppReady(std::sync::atomic::AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![
            get_initial_file,
            mark_ready,
            render_markdown,
            get_installed_fonts
        ])
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            if let Some(path) = find_md_arg(&args) {
                // Store for frontend to pick up via get_initial_file command
                let state = app.state::<InitialFile>();
                *state.0.lock().unwrap() = Some(path);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // macOS: handle file-open via Finder / "Open With" after app is ready
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        let path_str = path.to_string_lossy().to_string();
                        if is_markdown_file(&path_str) {
                            let ready = app
                                .state::<AppReady>()
                                .0
                                .load(std::sync::atomic::Ordering::Acquire);
                            if ready {
                                let _ = app.emit("file-open", &path_str);
                                // Focus window
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.unminimize();
                                    let _ = w.set_focus();
                                }
                            } else {
                                // App not ready yet — store for get_initial_file()
                                let state = app.state::<InitialFile>();
                                *state.0.lock().unwrap() = Some(path_str);
                            }
                        }
                    }
                }
            }
        });
}
