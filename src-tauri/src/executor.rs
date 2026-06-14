use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::{Emitter, Window};
use crate::planner::{InstallPlan, InstallStep};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExecutionStatus {
    Pending,
    Running,
    Success,
    Failed(String),
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    pub step_order: u32,
    pub status: ExecutionStatus,
    pub output: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub plan_id: String,
    pub overall_status: ExecutionStatus,
    pub step_results: Vec<StepResult>,
    pub installed_app_name: Option<String>,
    pub installed_app_path: Option<String>,
    pub installer_type: String,
    pub package_name: Option<String>,
}

pub struct Executor;

impl Executor {
    fn run_command_streaming<F>(command: &str, mut on_line: F) -> Result<String, String>
    where
        F: FnMut(&str),
    {
        let cmd = format!("{} 2>&1", command);
        let mut child = Command::new("sh")
            .arg("-c")
            .arg(cmd)
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to execute command: {}", e))?;

        let stdout = child.stdout.take().ok_or_else(|| "Failed to capture output".to_string())?;
        let reader = BufReader::new(stdout);
        let mut output = String::new();

        for line in reader.lines() {
            let line = line.map_err(|e| format!("Failed to read output: {}", e))?;
            on_line(&line);
            output.push_str(&line);
            output.push('\n');
        }

        let status = child.wait().map_err(|e| format!("Failed to wait for command: {}", e))?;
        if status.success() {
            Ok(output)
        } else {
            let msg = if output.trim().is_empty() {
                "Command failed.".to_string()
            } else {
                output.clone()
            };
            Err(msg)
        }
    }


    /// Execute a non-interactive step from the install plan (with log events)
    pub fn execute_step_with_logs(window: &Window, step: &InstallStep) -> StepResult {
        // Skip steps that are interactive - they should go through PTY
        if step.is_interactive {
            return StepResult {
                step_order: step.order,
                status: ExecutionStatus::Skipped,
                output: Some("Interactive command - use terminal".to_string()),
                error: None,
            };
        }

        // Skip steps without commands
        let command = match &step.command {
            Some(cmd) => cmd,
            None => {
                return StepResult {
                    step_order: step.order,
                    status: ExecutionStatus::Skipped,
                    output: Some("No command to execute".to_string()),
                    error: None,
                };
            }
        };

        let _ = window.emit(
            "plan-log",
            PlanLogEvent {
                step_order: step.order,
                line: format!("# {}", step.description),
            },
        );

        match Self::run_command_streaming(command, |line| {
            let _ = window.emit(
                "plan-log",
                PlanLogEvent {
                    step_order: step.order,
                    line: line.to_string(),
                },
            );
        }) {
            Ok(output) => StepResult {
                step_order: step.order,
                status: ExecutionStatus::Success,
                output: Some(output),
                error: None,
            },
            Err(e) => StepResult {
                step_order: step.order,
                status: ExecutionStatus::Failed(e.clone()),
                output: None,
                error: Some(e),
            },
        }
    }

    /// Execute all non-interactive steps in a plan
    pub fn execute_non_interactive_with_logs(plan: &InstallPlan, window: &Window) -> ExecutionResult {
        let mut step_results = Vec::new();
        let mut overall_success = true;

        for step in &plan.steps {
            if !step.is_interactive && step.command.is_some() {
                let result = Self::execute_step_with_logs(window, step);
                if matches!(result.status, ExecutionStatus::Failed(_)) {
                    overall_success = false;
                }
                step_results.push(result);
            }
        }

        // Extract app name for receipts
        let app_name = Self::extract_app_name(&plan.file_info.filename);

        ExecutionResult {
            plan_id: uuid::Uuid::new_v4().to_string(),
            overall_status: if overall_success {
                ExecutionStatus::Success
            } else {
                ExecutionStatus::Failed("One or more steps failed".to_string())
            },
            step_results,
            installed_app_name: Some(app_name),
            installed_app_path: Some(plan.file_info.path.clone()),
            installer_type: format!("{:?}", plan.file_info.installer_type),
            package_name: None,
        }
    }

    /// Extract app name from filename (remove extension)
    fn extract_app_name(filename: &str) -> String {
        let name = filename
            .trim_end_matches(".AppImage")
            .trim_end_matches(".appimage")
            .trim_end_matches(".deb")
            .trim_end_matches(".rpm")
            .trim_end_matches(".pkg.tar.zst")
            .trim_end_matches(".pkg.tar.xz")
            .trim_end_matches(".sh")
            .trim_end_matches(".tar.gz")
            .trim_end_matches(".tar.xz")
            .trim_end_matches(".tar.bz2")
            .trim_end_matches(".tar.zst")
            .trim_end_matches(".zip");
        
        name.to_string()
    }

}

#[derive(Clone, Serialize)]
struct PlanLogEvent {
    step_order: u32,
    line: String,
}
