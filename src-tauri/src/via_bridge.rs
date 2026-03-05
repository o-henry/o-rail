use reqwest::Client;
use serde_json::{json, Value};
use std::{
    collections::hash_map::DefaultHasher,
    env,
    fs,
    hash::{Hash, Hasher},
    net::IpAddr,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use url::Url;

const USER_AGENT: &str = "RAIL-VIA-Bridge/1.0";
const DEFAULT_VIA_BASE_URL: &str = "http://127.0.0.1:8765";
const ENV_VIA_BASE_URL: &str = "RAIL_VIA_BASE_URL";
const ENV_VIA_PYTHON: &str = "RAIL_VIA_PYTHON";
const ENV_VIA_SQLITE_PATH: &str = "RAIL_VIA_SQLITE_PATH";
const ENV_VIA_DOCS_ROOT: &str = "RAIL_VIA_DOCS_ROOT";
const DEFAULT_HEALTH_RETRY: usize = 20;

type ViaResult<T> = Result<T, String>;

#[derive(Debug)]
struct ViaRuntime {
    child: Option<Child>,
    base_url: String,
}

static VIA_RUNTIME: OnceLock<Mutex<ViaRuntime>> = OnceLock::new();

fn via_runtime() -> &'static Mutex<ViaRuntime> {
    VIA_RUNTIME.get_or_init(|| {
        Mutex::new(ViaRuntime {
            child: None,
            base_url: DEFAULT_VIA_BASE_URL.to_string(),
        })
    })
}

fn first_non_empty_env(keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn trim_text(raw: &str, max: usize) -> String {
    let text = raw.trim();
    if text.len() <= max {
        return text.to_string();
    }
    text[..max].to_string()
}

fn normalize_workspace_cwd(cwd: Option<&str>) -> ViaResult<PathBuf> {
    let path = if let Some(raw) = cwd {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            env::current_dir().map_err(|error| format!("failed to resolve current directory: {error}"))?
        } else {
            PathBuf::from(trimmed)
        }
    } else {
        env::current_dir().map_err(|error| format!("failed to resolve current directory: {error}"))?
    };

    if !path.exists() {
        fs::create_dir_all(&path).map_err(|error| format!("failed to create workspace directory: {error}"))?;
    }
    if !path.is_dir() {
        return Err("cwd must be a directory".to_string());
    }
    Ok(path)
}

fn validate_local_base_url(raw: &str) -> ViaResult<String> {
    let parsed = Url::parse(raw.trim()).map_err(|error| format!("invalid VIA base url: {error}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("VIA base url must use http/https".to_string());
    }
    let Some(host) = parsed.host_str() else {
        return Err("VIA base url host is missing".to_string());
    };
    let is_localhost = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false);
    if !is_localhost {
        return Err("VIA base url must be localhost/loopback for security".to_string());
    }
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

fn resolve_via_base_url() -> ViaResult<String> {
    let raw = first_non_empty_env(&[ENV_VIA_BASE_URL]).unwrap_or_else(|| DEFAULT_VIA_BASE_URL.to_string());
    validate_local_base_url(&raw)
}

fn resolve_runtime_script_path(app: &AppHandle) -> ViaResult<PathBuf> {
    if let Ok(resource_path) = app
        .path()
        .resolve("scripts/via_runtime/server.py", BaseDirectory::Resource)
    {
        if resource_path.exists() {
            return Ok(resource_path);
        }
    }

    if let Ok(resource_path_up) = app
        .path()
        .resolve("_up_/scripts/via_runtime/server.py", BaseDirectory::Resource)
    {
        if resource_path_up.exists() {
            return Ok(resource_path_up);
        }
    }

    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/via_runtime/server.py");
    if dev_path.exists() {
        return Ok(dev_path);
    }

    Err("embedded VIA server script not found (scripts/via_runtime/server.py)".to_string())
}

fn resolve_requirements_path(app: &AppHandle) -> ViaResult<PathBuf> {
    if let Ok(resource_path) = app
        .path()
        .resolve("scripts/via_runtime/requirements.lock", BaseDirectory::Resource)
    {
        if resource_path.exists() {
            return Ok(resource_path);
        }
    }

    if let Ok(resource_path_up) = app
        .path()
        .resolve("_up_/scripts/via_runtime/requirements.lock", BaseDirectory::Resource)
    {
        if resource_path_up.exists() {
            return Ok(resource_path_up);
        }
    }

    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/via_runtime/requirements.lock");
    if dev_path.exists() {
        return Ok(dev_path);
    }

    Err("embedded VIA requirements file not found (scripts/via_runtime/requirements.lock)".to_string())
}

fn resolve_workspace_venv_python(workspace: &Path) -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        let candidate = workspace.join(".rail/.venv_via/Scripts/python.exe");
        if candidate.is_file() {
            return Some(candidate);
        }
    } else {
        let candidate = workspace.join(".rail/.venv_via/bin/python");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn run_command(command: &mut Command, step: &str) -> ViaResult<String> {
    let output = command
        .output()
        .map_err(|error| format!("{step}: failed to execute command ({error})"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        let message = if stderr.is_empty() { stdout } else { stderr };
        return Err(format!("{step}: {}", trim_text(&message, 420)));
    }
    Ok(if stdout.is_empty() { stderr } else { stdout })
}

fn file_fingerprint(path: &Path) -> ViaResult<String> {
    let bytes = fs::read(path).map_err(|error| format!("failed to read requirements file: {error}"))?;
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    Ok(format!("{:x}", hasher.finish()))
}

fn bootstrap_via_runtime(workspace: &Path, requirements_path: &Path) -> ViaResult<PathBuf> {
    let rail_dir = workspace.join(".rail");
    fs::create_dir_all(&rail_dir).map_err(|error| format!("failed to create .rail directory: {error}"))?;
    let venv_path = rail_dir.join(".venv_via");

    let python_bootstrap = first_non_empty_env(&[ENV_VIA_PYTHON]).unwrap_or_else(|| "python3".to_string());

    if !venv_path.exists() {
        run_command(
            Command::new(&python_bootstrap)
                .arg("-m")
                .arg("venv")
                .arg(&venv_path),
            "via bootstrap",
        )?;
    }

    let python_path = resolve_workspace_venv_python(workspace)
        .ok_or_else(|| "via bootstrap: python executable not found in .rail/.venv_via".to_string())?;

    let expected_stamp = file_fingerprint(requirements_path)?;
    let stamp_path = venv_path.join(".rail_via_requirements.stamp");
    let current_stamp = fs::read_to_string(&stamp_path)
        .map(|raw| raw.trim().to_string())
        .unwrap_or_default();

    if current_stamp != expected_stamp {
        let _ = run_command(
            Command::new(&python_path)
                .arg("-m")
                .arg("pip")
                .arg("install")
                .arg("--upgrade")
                .arg("pip"),
            "via bootstrap",
        )?;

        run_command(
            Command::new(&python_path)
                .arg("-m")
                .arg("pip")
                .arg("install")
                .arg("-r")
                .arg(requirements_path),
            "via bootstrap",
        )?;

        fs::write(&stamp_path, expected_stamp)
            .map_err(|error| format!("via bootstrap: failed to write stamp file: {error}"))?;
    }

    Ok(python_path)
}

fn stop_via_process() {
    if let Ok(mut state) = via_runtime().lock() {
        if let Some(mut child) = state.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn runtime_base_url() -> String {
    via_runtime()
        .lock()
        .map(|state| state.base_url.clone())
        .unwrap_or_else(|_| DEFAULT_VIA_BASE_URL.to_string())
}

fn spawn_via_process(app: &AppHandle, workspace: &Path) -> ViaResult<()> {
    let script_path = resolve_runtime_script_path(app)?;
    let requirements_path = resolve_requirements_path(app)?;
    let base_url = resolve_via_base_url()?;
    let parsed = Url::parse(&base_url).map_err(|error| format!("invalid VIA base url: {error}"))?;
    let host = parsed.host_str().unwrap_or("127.0.0.1").to_string();
    let port = parsed.port_or_known_default().unwrap_or(8765).to_string();

    let python_path = bootstrap_via_runtime(workspace, &requirements_path)?;

    let sqlite_path = workspace.join(".rail/via/app.db");
    let docs_root = workspace.join(".rail/via-docs");
    if let Some(parent) = sqlite_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("failed to prepare VIA data directory: {error}"))?;
    }
    fs::create_dir_all(&docs_root).map_err(|error| format!("failed to prepare VIA docs directory: {error}"))?;

    let mut state = via_runtime()
        .lock()
        .map_err(|_| "failed to lock VIA runtime".to_string())?;

    if let Some(child) = state.child.as_mut() {
        if child.try_wait().ok().flatten().is_some() {
            state.child = None;
        }
    }

    if state.child.is_some() {
        state.base_url = base_url;
        return Ok(());
    }

    let mut command = Command::new(&python_path);
    command
        .arg(script_path)
        .arg("--host")
        .arg(&host)
        .arg("--port")
        .arg(&port)
        .env(ENV_VIA_SQLITE_PATH, sqlite_path)
        .env(ENV_VIA_DOCS_ROOT, docs_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let child = command
        .spawn()
        .map_err(|error| format!("failed to start embedded VIA runtime: {error}"))?;

    state.child = Some(child);
    state.base_url = base_url;
    Ok(())
}

async fn request_health(client: &Client) -> ViaResult<Value> {
    let health_url = format!("{}/health", runtime_base_url());
    let response = client
        .get(&health_url)
        .send()
        .await
        .map_err(|error| format!("VIA health request failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "VIA health check failed ({status}): {}",
            trim_text(&body, 240)
        ));
    }

    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| format!("failed to parse VIA health payload: {error}"))?;

    if payload
        .get("status")
        .and_then(Value::as_str)
        .map(|value| value.eq_ignore_ascii_case("ok"))
        .unwrap_or(false)
    {
        return Ok(payload);
    }

    Err("VIA health response does not contain status=ok".to_string())
}

async fn ensure_via_running(app: &AppHandle, workspace: &Path, client: &Client) -> ViaResult<Value> {
    let next_base_url = resolve_via_base_url()?;
    {
        let mut state = via_runtime()
            .lock()
            .map_err(|_| "failed to lock VIA runtime".to_string())?;
        state.base_url = next_base_url;
    }

    if let Ok(health) = request_health(client).await {
        return Ok(health);
    }

    spawn_via_process(app, workspace)?;
    let mut last_error = String::new();

    for _ in 0..DEFAULT_HEALTH_RETRY {
        match request_health(client).await {
            Ok(health) => return Ok(health),
            Err(error) => {
                last_error = error;
            }
        }
        tokio::time::sleep(Duration::from_millis(180)).await;
    }

    if last_error.is_empty() {
        Err("embedded VIA runtime health timeout".to_string())
    } else {
        Err(format!("embedded VIA runtime health timeout: {last_error}"))
    }
}

async fn request_via_json(
    client: &Client,
    method: &str,
    path: &str,
    payload: Option<Value>,
) -> ViaResult<Value> {
    let url = format!("{}{}", runtime_base_url(), path);
    let request = match method {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        _ => return Err(format!("unsupported http method: {method}")),
    };
    let request = if let Some(body) = payload { request.json(&body) } else { request };

    let response = request
        .send()
        .await
        .map_err(|error| format!("VIA request failed ({path}): {error}"))?;

    let status = response.status();
    let body_text = response.text().await.unwrap_or_default();
    let parsed = serde_json::from_str::<Value>(&body_text).unwrap_or_else(|_| json!({}));

    if !status.is_success() {
        let detail = parsed
            .get("detail")
            .and_then(Value::as_str)
            .map(|value| value.to_string())
            .unwrap_or_else(|| trim_text(&body_text, 240));
        return Err(format!("VIA request failed ({status}) {path}: {detail}"));
    }

    Ok(parsed)
}

fn build_client(timeout_ms: u64) -> ViaResult<Client> {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| format!("failed to build VIA client: {error}"))
}

#[tauri::command]
pub async fn via_health(app: AppHandle, cwd: Option<String>) -> ViaResult<Value> {
    let workspace = normalize_workspace_cwd(cwd.as_deref())?;
    let client = build_client(4_000)?;
    ensure_via_running(&app, &workspace, &client).await
}

#[tauri::command]
pub async fn via_run_flow(
    app: AppHandle,
    cwd: Option<String>,
    flow_id: i64,
    trigger: Option<String>,
) -> ViaResult<Value> {
    if flow_id <= 0 {
        return Err("flow_id must be a positive integer".to_string());
    }

    let workspace = normalize_workspace_cwd(cwd.as_deref())?;
    let client = build_client(180_000)?;
    let _ = ensure_via_running(&app, &workspace, &client).await?;

    request_via_json(
        &client,
        "POST",
        &format!("/api/flows/{flow_id}/run"),
        Some(json!({
            "trigger": trigger
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "manual".to_string())
        })),
    )
    .await
}

#[tauri::command]
pub async fn via_get_run(app: AppHandle, cwd: Option<String>, run_id: String) -> ViaResult<Value> {
    let normalized_run_id = run_id.trim();
    if normalized_run_id.is_empty() {
        return Err("run_id is required".to_string());
    }

    let workspace = normalize_workspace_cwd(cwd.as_deref())?;
    let client = build_client(10_000)?;
    let _ = ensure_via_running(&app, &workspace, &client).await?;

    request_via_json(&client, "GET", &format!("/api/runs/{normalized_run_id}"), None).await
}

#[tauri::command]
pub async fn via_list_artifacts(app: AppHandle, cwd: Option<String>, run_id: String) -> ViaResult<Value> {
    let normalized_run_id = run_id.trim();
    if normalized_run_id.is_empty() {
        return Err("run_id is required".to_string());
    }

    let workspace = normalize_workspace_cwd(cwd.as_deref())?;
    let client = build_client(10_000)?;
    let _ = ensure_via_running(&app, &workspace, &client).await?;

    request_via_json(
        &client,
        "GET",
        &format!("/api/runs/{normalized_run_id}/artifacts"),
        None,
    )
    .await
}

pub fn shutdown_via_runtime() {
    stop_via_process();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn via_base_url_must_be_localhost() {
        let error = validate_local_base_url("https://example.com").unwrap_err();
        assert!(error.contains("localhost/loopback"));
        assert!(validate_local_base_url("http://127.0.0.1:8765").is_ok());
        assert!(validate_local_base_url("http://localhost:8765").is_ok());
    }
}
