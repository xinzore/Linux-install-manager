use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use crate::executor::ExecutionResult;

/// A receipt represents an installed application
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    pub id: String,
    pub app_name: String,
    pub installed_at: String,
    pub source_path: String,
    pub install_path: Option<String>,
    #[serde(default)]
    pub installed_paths: Vec<String>,
    #[serde(default)]
    pub package_name: Option<String>,
    pub installer_type: String,
    pub can_uninstall: bool,
    pub uninstall_command: Option<String>,
    pub desktop_entry_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_status: Option<String>,
}

impl Receipt {
    fn expand_home(path: &str) -> String {
        let home = std::env::var("HOME").unwrap_or_default();
        if home.is_empty() {
            return path.to_string();
        }
        if path == "$HOME" {
            return home;
        }
        if let Some(rest) = path.strip_prefix("$HOME/") {
            return format!("{}/{}", home, rest);
        }
        if let Some(rest) = path.strip_prefix("~/") {
            return format!("{}/{}", home, rest);
        }
        path.to_string()
    }

    pub fn from_execution_result(result: &ExecutionResult) -> Self {
        let id = result.plan_id.clone();
        let app_name = result
            .installed_app_name
            .clone()
            .unwrap_or_else(|| "Unknown".to_string());
        let source_path = result.installed_app_path.clone().unwrap_or_default();
        let install_path = result.installed_app_path.clone();
        let source_path = Self::expand_home(&source_path);
        let install_path = install_path.map(|p| Self::expand_home(&p));

        let mut installed_paths = Vec::new();
        if let Some(p) = &install_path {
            installed_paths.push(p.clone());
            // Infer desktop and icon paths for AppImages
            if p.ends_with(".AppImage") || p.ends_with(".appimage") {
                let home = std::env::var("HOME").unwrap_or_default();
                if !home.is_empty() {
                    installed_paths.push(format!(
                        "{}/.local/share/applications/{}.desktop",
                        home, app_name
                    ));
                    installed_paths.push(format!("{}/.local/share/icons/{}.png", home, app_name));
                    installed_paths.push(format!("{}/.local/share/icons/{}.svg", home, app_name));
                }
            }
        }
        let installer_type = if !result.installer_type.is_empty() {
            result.installer_type.clone()
        } else {
            "Unknown".to_string()
        };
        let is_appimage = installer_type == "AppImage"
            || source_path.to_lowercase().ends_with(".appimage")
            || install_path
                .as_ref()
                .map(|p| p.to_lowercase().ends_with(".appimage"))
                .unwrap_or(false);
        let can_uninstall = matches!(
            installer_type.as_str(),
            "AppImage" | "Deb" | "Rpm" | "ArchPkg"
        );

        Self {
            id,
            app_name,
            installed_at: Utc::now().to_rfc3339(),
            source_path: source_path.clone(),
            install_path: install_path,
            installed_paths,
            package_name: result.package_name.clone(),
            installer_type: if is_appimage {
                "AppImage".to_string()
            } else {
                installer_type
            },
            can_uninstall,
            uninstall_command: None,
            desktop_entry_path: None,
            system_status: None,
        }
    }
}

/// Storage for all receipts
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ReceiptStore {
    pub receipts: Vec<Receipt>,
}

impl ReceiptStore {
    /// Get the path to the receipts file
    fn get_path() -> Result<PathBuf, String> {
        let home = std::env::var("HOME").map_err(|_| "HOME environment variable not set")?;
        let config_dir = PathBuf::from(home)
            .join(".config")
            .join("linux-install-manager");

        // Ensure directory exists
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;

        Ok(config_dir.join("receipts.json"))
    }

    /// Load receipts from disk
    pub fn load() -> Result<Self, String> {
        let path = Self::get_path()?;

        if !path.exists() {
            return Ok(Self::default());
        }

        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read receipts file: {}", e))?;

        serde_json::from_str(&content).map_err(|e| format!("Failed to parse receipts file: {}", e))
    }

    /// Save receipts to disk
    pub fn save(&self) -> Result<(), String> {
        let path = Self::get_path()?;

        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize receipts: {}", e))?;

        fs::write(&path, content).map_err(|e| format!("Failed to write receipts file: {}", e))
    }

    /// Add a receipt
    pub fn add(&mut self, receipt: Receipt) {
        self.receipts.push(receipt);
    }

    /// Remove a receipt by ID
    pub fn remove(&mut self, id: &str) {
        self.receipts.retain(|r| r.id != id);
    }

    /// Remove multiple receipts by ID
    pub fn remove_many(&mut self, ids: &[String]) {
        self.receipts.retain(|r| !ids.contains(&r.id));
    }

    /// Clear all receipts
    pub fn clear(&mut self) {
        self.receipts.clear();
    }

    // Find helpers removed until needed.
}

#[derive(Debug, Clone, Serialize)]
pub struct ReconcileResult {
    pub receipts: Vec<Receipt>,
    pub removed_stale: usize,
    pub removed_duplicates: usize,
}

pub fn reconcile_receipts() -> Result<ReconcileResult, String> {
    let mut store = ReceiptStore::load()?;
    let mut seen = HashSet::new();
    let mut removed_stale = 0;
    let mut removed_duplicates = 0;
    let mut reconciled = Vec::new();

    for mut receipt in store.receipts.into_iter().rev() {
        let status = installation_status(&receipt);
        receipt.system_status = Some(status.to_string());

        if status == "missing" {
            removed_stale += 1;
            continue;
        }

        let key = receipt_key(&receipt);
        if !seen.insert(key) {
            removed_duplicates += 1;
            continue;
        }
        reconciled.push(receipt);
    }

    reconciled.reverse();
    store.receipts = reconciled.clone();
    if removed_stale > 0 || removed_duplicates > 0 {
        store.save()?;
    }

    Ok(ReconcileResult {
        receipts: reconciled,
        removed_stale,
        removed_duplicates,
    })
}

fn receipt_key(receipt: &Receipt) -> String {
    let identity = receipt
        .package_name
        .as_deref()
        .or(receipt.install_path.as_deref())
        .unwrap_or(&receipt.source_path);
    format!("{}:{}", receipt.installer_type, identity).to_lowercase()
}

fn installation_status(receipt: &Receipt) -> &'static str {
    match receipt.installer_type.as_str() {
        "AppImage" => {
            let path = receipt
                .install_path
                .as_deref()
                .or_else(|| receipt.installed_paths.first().map(String::as_str))
                .unwrap_or(&receipt.source_path);
            if PathBuf::from(path).exists() {
                "installed"
            } else {
                "missing"
            }
        }
        "Deb" => package_status("dpkg-query", &["-W", "-f=${Status}", package_name(receipt)])
            .map(|installed| if installed { "installed" } else { "missing" })
            .unwrap_or("unknown"),
        "Rpm" => package_status("rpm", &["-q", package_name(receipt)])
            .map(|installed| if installed { "installed" } else { "missing" })
            .unwrap_or("unknown"),
        "ArchPkg" => package_status("pacman", &["-Q", package_name(receipt)])
            .map(|installed| if installed { "installed" } else { "missing" })
            .unwrap_or("unknown"),
        _ => "unknown",
    }
}

fn package_name(receipt: &Receipt) -> &str {
    receipt.package_name.as_deref().unwrap_or(&receipt.app_name)
}

fn package_status(command: &str, args: &[&str]) -> Option<bool> {
    if Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {} >/dev/null 2>&1", command))
        .status()
        .ok()?
        .success()
    {
        let output = Command::new(command).args(args).output().ok()?;
        if command == "dpkg-query" && output.status.success() {
            return Some(String::from_utf8_lossy(&output.stdout).contains("install ok installed"));
        }
        return Some(output.status.success());
    }
    None
}
