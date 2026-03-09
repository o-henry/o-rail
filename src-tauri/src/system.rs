use serde::Serialize;
use std::{collections::HashMap, sync::Arc, time::Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStdin, Command},
    sync::Mutex,
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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTerminalOutputPayload {
    session_id: String,
    stream: String,
    chunk: String,
    at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTerminalStatePayload {
    session_id: String,
    state: String,
    exit_code: Option<i32>,
    message: Option<String>,
}

struct WorkspaceTerminalSession {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
}

#[derive(Clone, Default)]
pub struct WorkspaceTerminalManager {
    sessions: Arc<Mutex<HashMap<String, WorkspaceTerminalSession>>>,
}

const EVENT_WORKSPACE_TERMINAL_OUTPUT: &str = "workspace-terminal-output";
const EVENT_WORKSPACE_TERMINAL_STATE: &str = "workspace-terminal-state";

fn normalize_allowlist(commands: &[String]) -> Vec<String> {
    commands
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn emit_workspace_terminal_state(
    app: &AppHandle,
    session_id: &str,
    state: &str,
    exit_code: Option<i32>,
    message: Option<String>,
) {
    let _ = app.emit(
        EVENT_WORKSPACE_TERMINAL_STATE,
        WorkspaceTerminalStatePayload {
            session_id: session_id.to_string(),
            state: state.to_string(),
            exit_code,
            message,
        },
    );
}

fn spawn_terminal_reader(
    app: AppHandle,
    session_id: String,
    stream: &'static str,
    mut reader: impl AsyncRead + Unpin + Send + 'static,
) {
    tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf).await {
                Ok(0) => break,
                Ok(len) => {
                    let chunk = String::from_utf8_lossy(&buf[..len]).to_string();
                    let _ = app.emit(
                        EVENT_WORKSPACE_TERMINAL_OUTPUT,
                        WorkspaceTerminalOutputPayload {
                            session_id: session_id.clone(),
                            stream: stream.to_string(),
                            chunk,
                            at: chrono::Utc::now().to_rfc3339(),
                        },
                    );
                }
                Err(error) => {
                    emit_workspace_terminal_state(
                        &app,
                        &session_id,
                        "error",
                        None,
                        Some(format!("failed to read {stream}: {error}")),
                    );
                    break;
                }
            }
        }
    });
}

async fn remove_terminal_session(
    manager: &WorkspaceTerminalManager,
    session_id: &str,
) -> Option<WorkspaceTerminalSession> {
    manager.sessions.lock().await.remove(session_id)
}

pub async fn shutdown_workspace_terminal_sessions(manager: &WorkspaceTerminalManager) {
    let drained = {
        let mut sessions = manager.sessions.lock().await;
        sessions.drain().collect::<Vec<_>>()
    };
    for (_, session) in drained {
        let mut child = session.child.lock().await;
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
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

#[tauri::command]
pub async fn workspace_terminal_start(
    app: AppHandle,
    manager: State<'_, WorkspaceTerminalManager>,
    session_id: String,
    cwd: String,
    initial_command: Option<String>,
) -> Result<(), String> {
    let normalized_session_id = session_id.trim().to_string();
    if normalized_session_id.is_empty() {
        return Err("workspace terminal session id is empty".to_string());
    }

    let existing_session = {
        let sessions = manager.sessions.lock().await;
        sessions.get(&normalized_session_id).map(|session| session.stdin.clone())
    };
    if let Some(stdin) = existing_session {
        emit_workspace_terminal_state(
            &app,
            &normalized_session_id,
            "running",
            None,
            Some("reconnected to existing shell session".to_string()),
        );
        let _ = stdin;
        return Ok(());
    }

    emit_workspace_terminal_state(
        &app,
        &normalized_session_id,
        "starting",
        None,
        Some("shell session booting".to_string()),
    );

    let mut child = Command::new("/usr/bin/script")
        .arg("-q")
        .arg("/dev/null")
        .arg("/bin/zsh")
        .arg("-il")
        .current_dir(&cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to spawn workspace shell: {error}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to capture workspace shell stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture workspace shell stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture workspace shell stderr".to_string())?;

    let child_arc = Arc::new(Mutex::new(child));
    let stdin_arc = Arc::new(Mutex::new(stdin));

    manager.sessions.lock().await.insert(
        normalized_session_id.clone(),
        WorkspaceTerminalSession {
            child: child_arc.clone(),
            stdin: stdin_arc.clone(),
        },
    );

    spawn_terminal_reader(app.clone(), normalized_session_id.clone(), "stdout", stdout);
    spawn_terminal_reader(app.clone(), normalized_session_id.clone(), "stderr", stderr);
    emit_workspace_terminal_state(
        &app,
        &normalized_session_id,
        "running",
        None,
        Some("shell session started".to_string()),
    );

    if let Some(command) = initial_command.map(|value| value.trim().to_string()) {
        if !command.is_empty() {
            let mut stdin = stdin_arc.lock().await;
            stdin
                .write_all(format!("{command}\n").as_bytes())
                .await
                .map_err(|error| format!("failed to send initial command: {error}"))?;
            let _ = stdin.flush().await;
        }
    }

    let app_for_wait = app.clone();
    let session_id_for_wait = normalized_session_id.clone();
    let manager_for_wait = manager.inner().clone();
    tokio::spawn(async move {
        let status = {
            let mut child = child_arc.lock().await;
            child.wait().await
        };
        let exit_code = status.ok().and_then(|value| value.code());
        let _ = remove_terminal_session(&manager_for_wait, &session_id_for_wait).await;
        emit_workspace_terminal_state(
            &app_for_wait,
            &session_id_for_wait,
            "exited",
            exit_code,
            Some("shell session exited".to_string()),
        );
    });

    Ok(())
}

#[tauri::command]
pub async fn workspace_terminal_input(
    manager: State<'_, WorkspaceTerminalManager>,
    session_id: String,
    chars: String,
) -> Result<(), String> {
    let normalized_session_id = session_id.trim().to_string();
    let session = {
        let sessions = manager.sessions.lock().await;
        sessions
            .get(&normalized_session_id)
            .map(|session| session.stdin.clone())
    };
    let stdin = session.ok_or_else(|| "workspace terminal session not found".to_string())?;
    let mut writer = stdin.lock().await;
    writer
        .write_all(chars.as_bytes())
        .await
        .map_err(|error| format!("failed to write terminal input: {error}"))?;
    writer
        .flush()
        .await
        .map_err(|error| format!("failed to flush terminal input: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn workspace_terminal_stop(
    app: AppHandle,
    manager: State<'_, WorkspaceTerminalManager>,
    session_id: String,
) -> Result<(), String> {
    let normalized_session_id = session_id.trim().to_string();
    let session = {
        let sessions = manager.sessions.lock().await;
        sessions
            .get(&normalized_session_id)
            .map(|session| session.stdin.clone())
    };
    let Some(stdin) = session else {
        return Ok(());
    };
    let mut writer = stdin.lock().await;
    writer
        .write_all(&[3])
        .await
        .map_err(|error| format!("failed to interrupt workspace terminal: {error}"))?;
    let _ = writer.flush().await;
    emit_workspace_terminal_state(
        &app,
        &normalized_session_id,
        "stopped",
        None,
        Some("interrupt sent; shell session preserved".to_string()),
    );
    Ok(())
}
