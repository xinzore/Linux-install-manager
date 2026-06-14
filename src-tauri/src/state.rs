use crate::pty::PtySession;
use std::collections::HashMap;
use std::sync::Mutex;

pub struct AppState {
    // Determine if we need multiple sessions. For now, let's assume one active session per window or global?
    // The requirement says "Embedded terminal", usually one is enough.
    // Putting it in a mutex to share across commands.
    // Key could be a generic "default" or window label if we support multiple windows.
    pub sessions: Mutex<HashMap<String, PtySession>>,
    pub pending_open_files: Mutex<Vec<String>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            pending_open_files: Mutex::new(Vec::new()),
        }
    }
}
