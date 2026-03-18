use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex as StdMutex},
    time::Instant,
};
use tauri::{AppHandle, Emitter, State};
use tokio::{
    io::AsyncReadExt,
    process::Command,
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
    child: Arc<StdMutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    master: Arc<StdMutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<StdMutex<Box<dyn Write + Send>>>,
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
    mut reader: Box<dyn Read + Send>,
) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
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
        if let Ok(mut child) = session.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
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
        sessions.get(&normalized_session_id).map(|session| session.writer.clone())
    };
    if existing_session.is_some() {
        emit_workspace_terminal_state(
            &app,
            &normalized_session_id,
            "running",
            None,
            Some("reconnected to existing shell session".to_string()),
        );
        return Ok(());
    }

    emit_workspace_terminal_state(
        &app,
        &normalized_session_id,
        "starting",
        None,
        Some("shell session booting".to_string()),
    );

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to create workspace pty: {error}"))?;

    let mut command = CommandBuilder::new("/bin/zsh");
    command.arg("-il");
    command.cwd(cwd);
    command.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("failed to spawn workspace shell: {error}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("failed to clone workspace shell reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("failed to capture workspace shell writer: {error}"))?;

    let child_arc = Arc::new(StdMutex::new(child));
    let master_arc = Arc::new(StdMutex::new(pair.master));
    let writer_arc = Arc::new(StdMutex::new(writer));

    manager.sessions.lock().await.insert(
        normalized_session_id.clone(),
        WorkspaceTerminalSession {
            child: child_arc.clone(),
            master: master_arc.clone(),
            writer: writer_arc.clone(),
        },
    );

    spawn_terminal_reader(app.clone(), normalized_session_id.clone(), "stdout", reader);
    emit_workspace_terminal_state(
        &app,
        &normalized_session_id,
        "running",
        None,
        Some("shell session started".to_string()),
    );

    if let Some(command) = initial_command.map(|value| value.trim().to_string()) {
        if !command.is_empty() {
            let mut writer = writer_arc
                .lock()
                .map_err(|_| "failed to lock workspace shell writer".to_string())?;
            writer
                .write_all(format!("{command}\n").as_bytes())
                .map_err(|error| format!("failed to send initial command: {error}"))?;
            writer.flush().map_err(|error| format!("failed to flush initial command: {error}"))?;
        }
    }

    let app_for_wait = app.clone();
    let session_id_for_wait = normalized_session_id.clone();
    let manager_for_wait = manager.inner().clone();
    std::thread::spawn(move || {
        let exit = child_arc.lock().ok().and_then(|mut child| child.wait().ok());
        let exit_code = exit
            .map(|status| status.exit_code())
            .and_then(|code| i32::try_from(code).ok());
        tauri::async_runtime::block_on(async {
            let _ = remove_terminal_session(&manager_for_wait, &session_id_for_wait).await;
        });
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
            .map(|session| session.writer.clone())
    };
    let writer = session.ok_or_else(|| "workspace terminal session not found".to_string())?;
    let mut handle = writer
        .lock()
        .map_err(|_| "failed to lock workspace terminal writer".to_string())?;
    handle
        .write_all(chars.as_bytes())
        .map_err(|error| format!("failed to write terminal input: {error}"))?;
    handle
        .flush()
        .map_err(|error| format!("failed to flush terminal input: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn workspace_terminal_resize(
    manager: State<'_, WorkspaceTerminalManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let normalized_session_id = session_id.trim().to_string();
    if normalized_session_id.is_empty() || cols == 0 || rows == 0 {
        return Ok(());
    }
    let session = {
        let sessions = manager.sessions.lock().await;
        sessions
            .get(&normalized_session_id)
            .map(|session| session.master.clone())
    };
    let Some(master) = session else {
        return Ok(());
    };
    let handle = master
        .lock()
        .map_err(|_| "failed to lock workspace terminal pty".to_string())?;
    handle
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to resize workspace terminal: {error}"))?;
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
            .map(|session| session.writer.clone())
    };
    let Some(writer) = session else {
        return Ok(());
    };
    let mut handle = writer
        .lock()
        .map_err(|_| "failed to lock workspace terminal writer".to_string())?;
    handle
        .write_all(&[3])
        .map_err(|error| format!("failed to interrupt workspace terminal: {error}"))?;
    let _ = handle.flush();
    emit_workspace_terminal_state(
        &app,
        &normalized_session_id,
        "stopped",
        None,
        Some("interrupt sent; shell session preserved".to_string()),
    );
    Ok(())
}

#[tauri::command]
pub async fn workspace_terminal_close(
    app: AppHandle,
    manager: State<'_, WorkspaceTerminalManager>,
    session_id: String,
) -> Result<(), String> {
    let normalized_session_id = session_id.trim().to_string();
    if normalized_session_id.is_empty() {
        return Ok(());
    }
    let Some(session) = remove_terminal_session(manager.inner(), &normalized_session_id).await else {
        return Ok(());
    };

    let exit_code = if let Ok(mut child) = session.child.lock() {
        let _ = child.kill();
        child
            .wait()
            .ok()
            .map(|status| status.exit_code())
            .and_then(|code| i32::try_from(code).ok())
    } else {
        None
    };
    emit_workspace_terminal_state(
        &app,
        &normalized_session_id,
        "exited",
        exit_code,
        Some("shell session closed".to_string()),
    );

    Ok(())
}
