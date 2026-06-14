use crate::detector::{DetectionResult, InstallerType};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum InstallAction {
    /// Move AppImage to ~/Applications and make executable
    InstallAppImage {
        source: String,
        destination: String,
        create_desktop_entry: bool,
    },
    /// Install .deb package with apt/dpkg
    InstallDeb {
        package_path: String,
        use_apt: bool, // true = apt install, false = dpkg -i
    },
    /// Install .rpm package with dnf/rpm
    InstallRpm {
        package_path: String,
        use_dnf: bool, // true = dnf install, false = rpm -i
    },
    /// Install Arch package with pacman
    InstallArchPkg { package_path: String },
    /// Extract archive to specified location
    ExtractArchive {
        source: String,
        destination: String,
        archive_type: String,
    },
    /// Show script content for inspection (never auto-run)
    InspectScript { script_path: String },
    /// Display warning/info message
    ShowMessage {
        message: String,
        message_type: String, // "info", "warning", "error"
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallStep {
    pub order: u32,
    pub action: InstallAction,
    pub description: String,
    pub command: Option<String>, // Shell command if applicable
    pub requires_root: bool,
    pub is_interactive: bool, // If true, run in terminal
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallPlan {
    pub file_info: DetectionResult,
    pub steps: Vec<InstallStep>,
    pub summary: String,
    pub can_uninstall: bool,
    pub warnings: Vec<String>,
}

impl InstallPlan {
    pub fn from_detection(detection: DetectionResult) -> Self {
        let mut steps = Vec::new();
        let mut warnings = Vec::new();
        let can_uninstall;
        let summary;

        match detection.installer_type {
            InstallerType::AppImage => {
                let app_name = detection
                    .filename
                    .trim_end_matches(".AppImage")
                    .trim_end_matches(".appimage")
                    .to_string();
                let dest = format!("$HOME/Applications/{}", detection.filename);

                steps.push(InstallStep {
                    order: 1,
                    action: InstallAction::InstallAppImage {
                        source: detection.path.clone(),
                        destination: dest.clone(),
                        create_desktop_entry: true,
                    },
                    description: format!("AppImage'ı {} konumuna taşı", dest),
                    command: Some(format!(
                        "mkdir -p $HOME/Applications && cp '{}' \"$HOME/Applications/{}\" && chmod +x \"$HOME/Applications/{}\" && mkdir -p $HOME/.local/share/applications && mkdir -p $HOME/.local/share/icons && APP_NAME='{}' && T=\"$(mktemp -d)\" && CWD=\"$(pwd)\" && cd \"$T\" && \"$HOME/Applications/{}\" --appimage-extract >/dev/null 2>&1 && I=$(find squashfs-root -name '*.png' -o -name '*.svg' | head -n 1) && if [ -n \"$I\" ]; then EXT=\"${{I##*.}}\"; ICON_PATH=\"$HOME/.local/share/icons/$APP_NAME.$EXT\"; cp \"$I\" \"$ICON_PATH\"; fi && cd \"$CWD\" && rm -rf \"$T\" && if [ -z \"$ICON_PATH\" ]; then ICON_PATH=\"$HOME/.local/share/icons/$APP_NAME.png\"; fi && echo \"[Desktop Entry]\nType=Application\nName=$APP_NAME\nExec=$HOME/Applications/{}\nIcon=$ICON_PATH\nTerminal=false\nCategories=Utility;\" > \"$HOME/.local/share/applications/$APP_NAME.desktop\" && (update-desktop-database $HOME/.local/share/applications || true)",
                        detection.path,
                        detection.filename,
                        detection.filename,
                        app_name,
                        detection.filename,
                        detection.filename
                    )),
                    requires_root: false,
                    is_interactive: true,
                });

                summary = format!("{} uygulaması ~/Applications dizinine kurulacak.", app_name);
                can_uninstall = true;
            }

            InstallerType::Deb => {
                steps.push(InstallStep {
                    order: 1,
                    action: InstallAction::InstallDeb {
                        package_path: detection.path.clone(),
                        use_apt: true,
                    },
                    description: "Debian paketini apt ile kur".to_string(),
                    command: Some(format!("sudo apt install '{}'", detection.path)),
                    requires_root: true,
                    is_interactive: true,
                });

                summary = format!("{} paketi apt ile kurulacak.", detection.filename);
                can_uninstall = true;
            }

            InstallerType::Rpm => {
                steps.push(InstallStep {
                    order: 1,
                    action: InstallAction::InstallRpm {
                        package_path: detection.path.clone(),
                        use_dnf: true,
                    },
                    description: "RPM paketini dnf ile kur".to_string(),
                    command: Some(format!("sudo dnf install '{}'", detection.path)),
                    requires_root: true,
                    is_interactive: true,
                });

                summary = format!("{} paketi dnf ile kurulacak.", detection.filename);
                can_uninstall = true;
            }

            InstallerType::ArchPkg => {
                steps.push(InstallStep {
                    order: 1,
                    action: InstallAction::InstallArchPkg {
                        package_path: detection.path.clone(),
                    },
                    description: "Arch paketini pacman ile kur".to_string(),
                    command: Some(format!("sudo pacman -U '{}'", detection.path)),
                    requires_root: true,
                    is_interactive: true,
                });

                summary = format!("{} paketi pacman ile kurulacak.", detection.filename);
                can_uninstall = true;
            }

            InstallerType::Script => {
                warnings.push(
                    "Shell scriptleri otomatik çalıştırılmaz. İçeriğini incelemeniz önerilir."
                        .to_string(),
                );

                steps.push(InstallStep {
                    order: 1,
                    action: InstallAction::InspectScript {
                        script_path: detection.path.clone(),
                    },
                    description: "Script içeriğini incele".to_string(),
                    command: None,
                    requires_root: false,
                    is_interactive: false,
                });

                steps.push(InstallStep {
                    order: 2,
                    action: InstallAction::ShowMessage {
                        message: "Scripti çalıştırmak için terminalde manuel olarak çalıştırın."
                            .to_string(),
                        message_type: "info".to_string(),
                    },
                    description: "Manuel çalıştırma talimatı".to_string(),
                    command: None,
                    requires_root: false,
                    is_interactive: false,
                });

                summary = "Bu bir shell scripti. Otomatik çalıştırılmayacak.".to_string();
                can_uninstall = false;
            }

            InstallerType::TarGz
            | InstallerType::TarXz
            | InstallerType::TarBz2
            | InstallerType::TarZst
            | InstallerType::Zip => {
                warnings.push("Arşiv dosyaları otomatik kurulum için desteklenmez. Hedef dizini seçmeniz gerekir.".to_string());

                steps.push(InstallStep {
                    order: 1,
                    action: InstallAction::ExtractArchive {
                        source: detection.path.clone(),
                        destination: "~/".to_string(),
                        archive_type: format!("{:?}", detection.installer_type),
                    },
                    description: "Arşivi aç".to_string(),
                    command: None, // Will be determined based on type
                    requires_root: false,
                    is_interactive: false,
                });

                summary = "Arşiv dosyası. Hedef dizin seçilerek açılabilir.".to_string();
                can_uninstall = false;
            }

            InstallerType::Unknown => {
                warnings.push("Dosya türü algılanamadı.".to_string());
                summary = "Bilinmeyen dosya türü. Kurulum planı oluşturulamadı.".to_string();
                can_uninstall = false;
            }
        }

        Self {
            file_info: detection,
            steps,
            summary,
            can_uninstall,
            warnings,
        }
    }
}
