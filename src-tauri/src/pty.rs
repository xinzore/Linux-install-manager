use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::{
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{Emitter, Window};

pub struct PtySession {
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
}

impl PtySession {
    pub fn new(window: Window, cols: u16, rows: u16) -> Result<Self, Box<dyn std::error::Error>> {
        let pty_system = NativePtySystem::default();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let mut cmd = CommandBuilder::new("bash");
        cmd.env("TERM", "xterm-256color");

        let mut child = pair.slave.spawn_command(cmd)?;
        
        // Release the slave, we don't need it anymore
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        // Spawn a thread to read from PTY and emit to frontend
        thread::spawn(move || {
            let mut buffer = [0u8; 1024];
            loop {
                match reader.read(&mut buffer) {
                    Ok(n) if n > 0 => {
                        let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                        // Emit event to frontend
                        // Using base64 to avoid encoding issues with raw bytes if needed, but utf8_lossy is okay for text
                        // For raw terminal data, it's safer to send bytes or base64 if we want perfect fidelity,
                        // but xterm.js usually expects strings. Use base64 if strange chars appear.
                        // Let's use string for now.
                        if let Err(e) = window.emit("pty-data", data) {
                            eprintln!("Failed to emit pty-data: {}", e);
                            break;
                        }
                    }
                    Ok(_) => break, // EOF
                    Err(_) => break, // Error
                }
            }
            let _ = child.wait();
            let _ = window.emit("pty-exit", ());
        });

        Ok(Self {
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(pair.master)),
        })
    }

    pub fn write(&self, data: &str) -> Result<(), Box<dyn std::error::Error>> {
        let mut writer = self.writer.lock().unwrap();
        write!(writer, "{}", data)?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), Box<dyn std::error::Error>> {
        let master = self.master.lock().unwrap();
        master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }
}
