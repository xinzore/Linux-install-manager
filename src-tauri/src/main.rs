// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod detector;
mod executor;
mod history;
mod planner;
mod pty;
mod receipts;
mod state;
mod system_tools;
mod uninstall;

use crate::detector::DetectionResult;
use crate::detector::InstallerType;
use crate::executor::{ExecutionResult, Executor};
use crate::planner::InstallPlan;
use crate::pty::PtySession;
use crate::receipts::{Receipt, ReceiptStore, ReconcileResult};
use serde::Serialize;
use state::AppState;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::Command;
use tauri::{Emitter, Manager, Window};

#[tauri::command]
fn start_shell(window: Window, state: tauri::State<AppState>) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    // For simplicity, we only allow one session "default" for now, or replace it.
    if sessions.contains_key("default") {
        // drop existing?
    }

    // Default size, should be resizing immediately after anyway
    match PtySession::new(window, 80, 24) {
        Ok(session) => {
            sessions.insert("default".to_string(), session);
            Ok(())
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn write_shell(data: String, state: tauri::State<AppState>) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get("default") {
        session.write(&data).map_err(|e| e.to_string())
    } else {
        Err("No active session".to_string())
    }
}

#[tauri::command]
fn resize_shell(cols: u16, rows: u16, state: tauri::State<AppState>) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get("default") {
        session.resize(cols, rows).map_err(|e| e.to_string())
    } else {
        Err("No active session".to_string())
    }
}

#[tauri::command]
fn kill_shell(state: tauri::State<AppState>) -> Result<(), String> {
    // Dropping the session should close the master/slave?
    // portable-pty logic: dropping master usually signals EOF.
    let mut sessions = state.sessions.lock().unwrap();
    sessions.remove("default");
    Ok(())
}

#[tauri::command]
fn detect_file(path: String) -> Result<DetectionResult, String> {
    DetectionResult::new(&path)
}

#[tauri::command]
fn create_plan(path: String) -> Result<InstallPlan, String> {
    let detection = DetectionResult::new(&path)?;
    Ok(InstallPlan::from_detection(detection))
}

#[tauri::command]
fn execute_plan(window: Window, plan: InstallPlan) -> Result<ExecutionResult, String> {
    Ok(Executor::execute_non_interactive_with_logs(&plan, &window))
}

#[tauri::command]
fn save_receipt(result: ExecutionResult) -> Result<(), String> {
    let mut store = ReceiptStore::load()?;
    let receipt = Receipt::from_execution_result(&result);
    store.add(receipt);
    store.save()
}

#[tauri::command]
fn get_receipts() -> Result<Vec<Receipt>, String> {
    Ok(receipts::reconcile_receipts()?.receipts)
}

#[tauri::command]
fn reconcile_receipts() -> Result<ReconcileResult, String> {
    receipts::reconcile_receipts()
}

#[tauri::command]
fn record_history(entry: history::OperationHistory) -> Result<(), String> {
    history::add(entry)
}

#[tauri::command]
fn get_history() -> Result<Vec<history::OperationHistory>, String> {
    history::list()
}

#[tauri::command]
fn clear_history() -> Result<(), String> {
    history::clear()
}

#[tauri::command]
fn analyze_installer(path: String) -> Result<system_tools::PackageAnalysis, String> {
    system_tools::analyze_installer(&path)
}

#[tauri::command]
fn get_system_info() -> Result<system_tools::SystemInfo, String> {
    system_tools::system_info()
}

#[tauri::command]
fn launch_receipt(receipt: Receipt) -> Result<(), String> {
    system_tools::launch_receipt(&receipt)
}

#[tauri::command]
fn show_receipt_location(receipt: Receipt) -> Result<(), String> {
    system_tools::show_receipt_location(&receipt)
}

#[derive(Serialize)]
struct PackageMetadata {
    installer_type: String,
    package_name: Option<String>,
}

#[tauri::command]
fn get_package_metadata(path: String) -> Result<PackageMetadata, String> {
    let detection = DetectionResult::new(&path)?;
    let installer_type = format!("{:?}", detection.installer_type);
    let package_name = match detection.installer_type {
        InstallerType::Deb => run_cmd_capture("dpkg-deb", &["-f", &path, "Package"]),
        InstallerType::Rpm => run_cmd_capture("rpm", &["-qp", "--qf", "%{NAME}", &path]),
        InstallerType::ArchPkg => run_cmd_capture("pacman", &["-Qp", "--format", "%n", &path]),
        _ => None,
    };

    Ok(PackageMetadata {
        installer_type,
        package_name,
    })
}

fn run_cmd_capture(cmd: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(cmd).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

#[tauri::command]
fn remove_receipt(id: String) -> Result<(), String> {
    let mut store = ReceiptStore::load()?;
    store.remove(&id);
    store.save()
}

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn remove_receipts(ids: Vec<String>) -> Result<(), String> {
    let mut store = ReceiptStore::load()?;
    store.remove_many(&ids);
    store.save()
}

#[tauri::command]
fn clear_receipts() -> Result<(), String> {
    let mut store = ReceiptStore::load()?;
    store.clear();
    store.save()
}

#[tauri::command]
fn read_text_preview(path: String, max_lines: Option<usize>) -> Result<String, String> {
    let file = fs::File::open(&path).map_err(|e| format!("Dosya okunamadi: {}", e))?;
    let reader = BufReader::new(file);
    let limit = max_lines.unwrap_or(120);
    let mut lines = Vec::new();
    for (idx, line) in reader.lines().enumerate() {
        if idx >= limit {
            lines.push("... (kisaltildi)".to_string());
            break;
        }
        let line = line.map_err(|e| format!("Dosya okunamadi: {}", e))?;
        lines.push(line);
    }
    Ok(lines.join("\n"))
}

#[tauri::command]
fn install_file_associations() -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME bulunamadi".to_string())?;
    let mime_dir = format!("{}/.local/share/mime/packages", home);
    fs::create_dir_all(&mime_dir).map_err(|e| format!("Mime dizini olusturulamadi: {}", e))?;

    let mime_path = format!("{}/linux-install-manager.xml", mime_dir);
    let xml = include_str!("../mime/linux-install-manager.xml");
    fs::write(&mime_path, xml).map_err(|e| format!("Mime dosyasi yazilamadi: {}", e))?;

    run_command(
        "update-mime-database",
        &[format!("{}/.local/share/mime", home)],
    )
    .map_err(|e| format!("Mime veritabani guncellenemedi: {}", e))?;

    install_mime_icons(&home)?;

    let desktop_id = "linux-install-manager.desktop";
    let mime_types = [
        "application/vnd.appimage",
        "application/x-appimage",
        "application/vnd.debian.binary-package",
        "application/x-deb",
        "application/x-rpm",
        "application/x-redhat-package-manager",
        "application/x-archlinux-package",
        "application/x-shellscript",
        "text/x-shellscript",
    ];

    for mime in mime_types {
        run_command(
            "xdg-mime",
            &[
                "default".to_string(),
                desktop_id.to_string(),
                mime.to_string(),
            ],
        )
        .map_err(|e| format!("Dosya iliskilendirmesi ayarlanamadi: {}", e))?;
    }

    let _ = run_command(
        "update-desktop-database",
        &[format!("{}/.local/share/applications", home)],
    );

    let _ = run_command(
        "gtk-update-icon-cache",
        &[format!("{}/.local/share/icons/hicolor", home)],
    );

    Ok(())
}

fn install_mime_icons(home: &str) -> Result<(), String> {
    const MIME_ICON_NAMES: &[&str] = &[
        "application-x-deb",
        "application-vnd.debian.binary-package",
        "application-x-rpm",
        "application-x-redhat-package-manager",
        "application-x-archlinux-package",
        "application-x-shellscript",
        "text-x-shellscript",
        "application-x-appimage",
        "application-vnd.appimage",
    ];

    let icon_root = format!("{}/.local/share/icons/hicolor", home);
    let svg_dir = format!("{}/scalable/mimetypes", icon_root);
    fs::create_dir_all(&svg_dir).map_err(|e| format!("Ikon dizini olusturulamadi: {}", e))?;

    let svg_data = include_bytes!("../../iconlar/icon.svg");
    for name in MIME_ICON_NAMES {
        let path = format!("{}/{}.svg", svg_dir, name);
        fs::write(&path, svg_data).map_err(|e| format!("Ikon yazilamadi ({}): {}", path, e))?;
    }

    let png_variants: &[(u32, &[u8])] = &[
        (16, include_bytes!("../../iconlar/icon-16.png")),
        (32, include_bytes!("../../iconlar/icon-32.png")),
        (64, include_bytes!("../../iconlar/icon-64.png")),
        (128, include_bytes!("../../iconlar/icon-128.png")),
        (256, include_bytes!("../../iconlar/icon-256.png")),
        (512, include_bytes!("../../iconlar/icon-512.png")),
    ];

    for (size, data) in png_variants {
        let dir = format!("{}/{}x{}/mimetypes", icon_root, size, size);
        fs::create_dir_all(&dir).map_err(|e| format!("Ikon dizini olusturulamadi: {}", e))?;
        for name in MIME_ICON_NAMES {
            let path = format!("{}/{}.png", dir, name);
            fs::write(&path, data).map_err(|e| format!("Ikon yazilamadi ({}): {}", path, e))?;
        }
    }

    Ok(())
}

fn run_command(cmd: &str, args: &[String]) -> Result<(), String> {
    let output = Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| format!("Komut calistirilamadi: {}", e))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            "Komut hatasi".to_string()
        } else {
            stderr
        })
    }
}

#[tauri::command]
fn take_pending_open_files(state: tauri::State<AppState>) -> Vec<String> {
    let mut pending = state.pending_open_files.lock().unwrap();
    if pending.is_empty() {
        return Vec::new();
    }
    let files = pending.clone();
    pending.clear();
    files
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .setup(|app| {
            let args: Vec<String> = std::env::args().skip(1).collect();
            for arg in args {
                if arg.starts_with('-') {
                    continue;
                }
                let mut path = arg.clone();
                if let Some(stripped) = arg.strip_prefix("file://") {
                    path = stripped.replace("%20", " ");
                }
                if Path::new(&path).exists() {
                    let state = app.state::<AppState>();
                    {
                        let mut pending = state.pending_open_files.lock().unwrap();
                        pending.push(path.clone());
                    }
                    let _ = app.emit("open-file", path);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_shell,
            write_shell,
            resize_shell,
            kill_shell,
            detect_file,
            create_plan,
            execute_plan,
            save_receipt,
            get_receipts,
            reconcile_receipts,
            record_history,
            get_history,
            clear_history,
            analyze_installer,
            get_system_info,
            launch_receipt,
            show_receipt_location,
            get_package_metadata,
            remove_receipt,
            remove_receipts,
            clear_receipts,
            get_app_version,
            read_text_preview,
            take_pending_open_files,
            install_file_associations,
            uninstall::uninstall_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
