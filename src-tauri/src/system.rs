use serde::Serialize;
use std::time::Instant;
use tokio::{
    io::AsyncReadExt,
    process::Command,
    time::{timeout, Duration},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellCommandResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
    timed_out: bool,
    duration_ms: u128,
}

fn normalize_allowlist(commands: &[String]) -> Vec<String> {
    commands
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

#[tauri::command]
pub async fn command_exec(
    cwd: String,
    command: String,
    timeout_sec: Option<u64>,
) -> Result<ShellCommandResult, String> {
    let timeout_duration = Duration::from_secs(timeout_sec.unwrap_or(120));
    let started_at = Instant::now();

    let mut child = Command::new("/bin/zsh")
        .arg("-lc")
        .arg(command)
        .current_dir(cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn shell command: {e}"))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture command stdout".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture command stderr".to_string())?;

    let read_stdout = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf).await;
        String::from_utf8_lossy(&buf).to_string()
    });

    let read_stderr = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf).await;
        String::from_utf8_lossy(&buf).to_string()
    });

    let status = match timeout(timeout_duration, child.wait()).await {
        Ok(waited) => waited.map_err(|e| format!("failed to wait command: {e}"))?,
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            let stdout_value = read_stdout
                .await
                .map_err(|e| format!("failed to read stdout task: {e}"))?;
            let stderr_value = read_stderr
                .await
                .map_err(|e| format!("failed to read stderr task: {e}"))?;
            return Ok(ShellCommandResult {
                exit_code: -1,
                stdout: stdout_value,
                stderr: stderr_value,
                timed_out: true,
                duration_ms: started_at.elapsed().as_millis(),
            });
        }
    };

    let stdout_value = read_stdout
        .await
        .map_err(|e| format!("failed to read stdout task: {e}"))?;
    let stderr_value = read_stderr
        .await
        .map_err(|e| format!("failed to read stderr task: {e}"))?;

    Ok(ShellCommandResult {
        exit_code: status.code().unwrap_or(-1),
        stdout: stdout_value,
        stderr: stderr_value,
        timed_out: false,
        duration_ms: started_at.elapsed().as_millis(),
    })
}

#[tauri::command]
pub async fn task_terminal_exec(
    cwd: String,
    command: String,
    allowed_commands: Vec<String>,
    timeout_sec: Option<u64>,
) -> Result<ShellCommandResult, String> {
    let normalized_command = command.trim().to_string();
    if normalized_command.is_empty() {
        return Err("task terminal command is empty".to_string());
    }
    let allowlist = normalize_allowlist(&allowed_commands);
    if !allowlist.iter().any(|row| row == &normalized_command) {
        return Err("task terminal command is not in allowlist".to_string());
    }
    command_exec(cwd, normalized_command, timeout_sec).await
}
