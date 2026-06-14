use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum InstallerType {
    AppImage,
    Deb,
    Rpm,
    ArchPkg,     // .pkg.tar.zst, .pkg.tar.xz (Arch Linux)
    Script,      // .sh files
    TarGz,       // .tar.gz, .tgz
    TarXz,       // .tar.xz
    TarBz2,      // .tar.bz2
    TarZst,      // .tar.zst
    Zip,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionResult {
    pub path: String,
    pub filename: String,
    pub installer_type: InstallerType,
    pub size_bytes: u64,
    pub is_executable: bool,
    pub requires_root: bool,
    pub warning: Option<String>,
}

impl DetectionResult {
    pub fn new(path: &str) -> Result<Self, String> {
        let path_obj = Path::new(path);
        
        if !path_obj.exists() {
            return Err(format!("File not found: {}", path));
        }

        let filename = path_obj
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let metadata = std::fs::metadata(path)
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        let size_bytes = metadata.len();

        // Check if file is executable
        #[cfg(unix)]
        let is_executable = {
            use std::os::unix::fs::PermissionsExt;
            metadata.permissions().mode() & 0o111 != 0
        };
        
        #[cfg(not(unix))]
        let is_executable = false;

        let installer_type = Self::detect_type(&filename, path);
        
        let requires_root = matches!(installer_type, InstallerType::Deb | InstallerType::Rpm | InstallerType::ArchPkg);
        
        let warning = match installer_type {
            InstallerType::Script => Some(
                "Bu bir shell scripti. Otomatik çalıştırılmayacak. İçeriğini incelemeniz önerilir.".to_string()
            ),
            InstallerType::Unknown => Some(
                "Dosya türü algılanamadı.".to_string()
            ),
            _ => None,
        };

        Ok(Self {
            path: path.to_string(),
            filename,
            installer_type,
            size_bytes,
            is_executable,
            requires_root,
            warning,
        })
    }

    fn detect_type(filename: &str, path: &str) -> InstallerType {
        let lower = filename.to_lowercase();

        // Check by extension first
        if lower.ends_with(".appimage") {
            return InstallerType::AppImage;
        }
        if lower.ends_with(".deb") {
            return InstallerType::Deb;
        }
        if lower.ends_with(".rpm") {
            return InstallerType::Rpm;
        }
        if lower.ends_with(".sh") {
            return InstallerType::Script;
        }
        if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
            return InstallerType::TarGz;
        }
        if lower.ends_with(".tar.xz") {
            return InstallerType::TarXz;
        }
        if lower.ends_with(".tar.bz2") {
            return InstallerType::TarBz2;
        }
        if lower.ends_with(".zip") {
            return InstallerType::Zip;
        }
        // Arch Linux packages
        if lower.ends_with(".pkg.tar.zst") || lower.ends_with(".pkg.tar.xz") {
            return InstallerType::ArchPkg;
        }
        // Generic zstd tarball
        if lower.ends_with(".tar.zst") {
            return InstallerType::TarZst;
        }

        // Check by magic bytes for files without clear extensions
        if let Ok(bytes) = std::fs::read(path) {
            if bytes.len() >= 4 {
                // ELF header (for AppImage that might not have extension)
                if bytes[0..4] == [0x7f, 0x45, 0x4c, 0x46] {
                    // Check if it's an AppImage by looking for AI magic
                    if bytes.len() > 8 && bytes.windows(8).any(|w| w == b"AppImage") {
                        return InstallerType::AppImage;
                    }
                }
                // Debian package (ar archive starting with "!<arch>")
                if bytes.len() >= 8 && &bytes[0..8] == b"!<arch>\n" {
                    return InstallerType::Deb;
                }
                // RPM magic
                if bytes.len() >= 4 && bytes[0..4] == [0xed, 0xab, 0xee, 0xdb] {
                    return InstallerType::Rpm;
                }
                // Gzip magic
                if bytes[0..2] == [0x1f, 0x8b] {
                    return InstallerType::TarGz;
                }
                // XZ magic
                if bytes.len() >= 6 && bytes[0..6] == [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] {
                    return InstallerType::TarXz;
                }
                // Bzip2 magic
                if bytes.len() >= 3 && &bytes[0..3] == b"BZh" {
                    return InstallerType::TarBz2;
                }
                // Zip magic
                if bytes[0..2] == [0x50, 0x4b] {
                    return InstallerType::Zip;
                }
                // Shell script (starts with #!)
                if bytes.len() >= 2 && &bytes[0..2] == b"#!" {
                    return InstallerType::Script;
                }
            }
        }

        InstallerType::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extension_detection() {
        assert_eq!(
            DetectionResult::detect_type("app.AppImage", "/tmp/app.AppImage"),
            InstallerType::AppImage
        );
        assert_eq!(
            DetectionResult::detect_type("package.deb", "/tmp/package.deb"),
            InstallerType::Deb
        );
        assert_eq!(
            DetectionResult::detect_type("package.rpm", "/tmp/package.rpm"),
            InstallerType::Rpm
        );
        assert_eq!(
            DetectionResult::detect_type("install.sh", "/tmp/install.sh"),
            InstallerType::Script
        );
    }
}
