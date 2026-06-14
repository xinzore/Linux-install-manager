use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationHistory {
    #[serde(default)]
    pub id: String,
    pub operation: String,
    pub app_name: String,
    pub command: String,
    pub started_at: String,
    pub finished_at: String,
    pub status: String,
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct HistoryStore {
    entries: Vec<OperationHistory>,
}

impl HistoryStore {
    fn path() -> Result<PathBuf, String> {
        let home = std::env::var("HOME").map_err(|_| "HOME environment variable not set")?;
        let dir = PathBuf::from(home)
            .join(".config")
            .join("linux-install-manager");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir.join("history.json"))
    }

    fn load() -> Result<Self, String> {
        let path = Self::path()?;
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    }

    fn save(&self) -> Result<(), String> {
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(Self::path()?, content).map_err(|e| e.to_string())
    }
}

pub fn add(mut entry: OperationHistory) -> Result<(), String> {
    if entry.id.is_empty() {
        entry.id = uuid::Uuid::new_v4().to_string();
    }
    if entry.finished_at.is_empty() {
        entry.finished_at = Utc::now().to_rfc3339();
    }
    if entry.output.len() > 50_000 {
        entry.output.truncate(50_000);
    }
    let mut store = HistoryStore::load()?;
    store.entries.insert(0, entry);
    store.entries.truncate(250);
    store.save()
}

pub fn list() -> Result<Vec<OperationHistory>, String> {
    Ok(HistoryStore::load()?.entries)
}

pub fn clear() -> Result<(), String> {
    HistoryStore::default().save()
}
