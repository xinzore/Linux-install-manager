use crate::receipts::Receipt;
use std::fs;
use std::path::Path;
use std::process::Command;

#[tauri::command]
pub fn uninstall_app(receipt: Receipt) -> Result<Option<String>, String> {
    match receipt.installer_type.as_str() {
        "AppImage" => {
            // Dosyaları sil
            let mut errors = Vec::new();
            for path_str in &receipt.installed_paths {
                let p = Path::new(path_str);
                if p.exists() {
                    if let Err(e) = fs::remove_file(p) {
                         errors.push(format!("Failed to remove {}: {}", path_str, e));
                    }
                }
            }
            
            if !errors.is_empty() {
                return Err(errors.join("\n"));
            }
            
            Ok(None) // Terminal komutu yok, işlem başarıyla tamamlandı.
        },
        "Deb" => {
            let pkg = infer_package_name(&receipt)
                .or_else(|| receipt.package_name.as_ref().cloned())
                .ok_or("Package name missing")?;
            Ok(Some(format!("sudo apt remove -y {}", pkg)))
        },
        "Rpm" => {
            let pkg = infer_package_name(&receipt)
                .or_else(|| receipt.package_name.as_ref().cloned())
                .ok_or("Package name missing")?;
            Ok(Some(format!("sudo dnf remove -y {}", pkg)))
        },
        "ArchPkg" => {
            let pkg = infer_package_name(&receipt)
                .or_else(|| receipt.package_name.as_ref().cloned())
                .ok_or("Package name missing")?;
            Ok(Some(format!("sudo pacman -Rns --noconfirm {}", pkg)))
        },
        "Script" => Err("Shell scriptleri otomatik kaldırılamaz.".to_string()),
        "Unknown" => {
            // Try to guess from source path or installed paths
            let is_appimage = receipt.source_path.to_lowercase().ends_with(".appimage") || 
                             receipt.installed_paths.iter().any(|p| p.to_lowercase().ends_with(".appimage"));
            
            if is_appimage {
                 // AppImage logic copy-paste essentially
                 let mut errors = Vec::new();
                 // If installed_paths is empty (old receipt), try to deduce from source_path if it looks like an installed path
                 let paths_to_remove = if receipt.installed_paths.is_empty() {
                     vec![receipt.source_path.clone()]
                 } else {
                     receipt.installed_paths.clone()
                 };

                 for path_str in &paths_to_remove {
                    let p = Path::new(path_str);
                    if p.exists() {
                        if let Err(e) = fs::remove_file(p) {
                             errors.push(format!("Failed to remove {}: {}", path_str, e));
                        }
                    }
                }
                
                if !errors.is_empty() {
                    return Err(errors.join("\n"));
                }
                Ok(None)
            } else {
                Err(format!("Cannot uninstall Unknown type: {}", receipt.app_name))
            }
        },
        _ => Err(format!("Unsupported installer type for uninstall: {}", receipt.installer_type))
    }
}

fn infer_package_name(receipt: &Receipt) -> Option<String> {
    let path = receipt.source_path.as_str();
    let lowered = path.to_lowercase();
    if lowered.ends_with(".pkg.tar.zst") || lowered.ends_with(".pkg.tar.xz") {
        return run_cmd_capture("pacman", &["-Qp", "--format", "%n", path]);
    }
    if lowered.ends_with(".deb") {
        return run_cmd_capture("dpkg-deb", &["-f", path, "Package"]);
    }
    if lowered.ends_with(".rpm") {
        return run_cmd_capture("rpm", &["-qp", "--qf", "%{NAME}", path]);
    }
    None
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
