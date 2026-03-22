use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};
use tauri::path::BaseDirectory;
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, Window};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{oneshot, Mutex},
    task::JoinHandle,
    time::{timeout, Duration},
};
use url::Url;

use crate::task_prompt_packs;

const EVENT_ENGINE_NOTIFICATION: &str = "engine://notification";
const EVENT_ENGINE_LIFECYCLE: &str = "engine://lifecycle";
const EVENT_ENGINE_APPROVAL_REQUEST: &str = "engine://approval_request";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);
const WEB_WORKER_REQUEST_TIMEOUT: Duration = Duration::from_secs(240);
const CHILD_VIEW_LABEL_PREFIX: &str = "provider-child-";
const CHILD_VIEW_MIN_WIDTH: u32 = 560;
const CHILD_VIEW_MIN_HEIGHT: u32 = 360;
const CHILD_VIEW_MAX_WIDTH: u32 = 900;
const CHILD_VIEW_MAX_HEIGHT: u32 = 560;
const CHILD_VIEW_WIDTH_RATIO: f64 = 0.42;
const CHILD_VIEW_HEIGHT_RATIO: f64 = 0.34;
const CHILD_VIEW_SAFE_MARGIN_X: u32 = 44;
const CHILD_VIEW_SAFE_MARGIN_TOP: u32 = 212;
const CHILD_VIEW_SAFE_MARGIN_BOTTOM: u32 = 36;

fn is_executable(path: &Path) -> bool {
    if !path.exists() || !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(path) {
            return meta.permissions().mode() & 0o111 != 0;
        }
    }
    #[cfg(not(unix))]
    {
        return true;
    }
    false
}

fn find_in_path(binary: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    env::split_paths(&path_var)
        .map(|dir| dir.join(binary))
        .find(|candidate| is_executable(candidate))
}

fn find_in_nvm(binary: &str) -> Option<PathBuf> {
    let home = env::var_os("HOME")?;
    let node_versions_dir = PathBuf::from(home).join(".nvm/versions/node");
    let entries = fs::read_dir(node_versions_dir).ok()?;
    let mut dirs = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    dirs.sort();
    dirs.reverse();

    dirs.into_iter()
        .map(|dir| dir.join("bin").join(binary))
        .find(|candidate| is_executable(candidate))
}

fn resolve_executable(binary: &str, override_env: &str) -> Result<PathBuf, String> {
    if let Ok(raw) = env::var(override_env) {
        let candidate = PathBuf::from(raw.trim());
        if is_executable(&candidate) {
            return Ok(candidate);
        }
    }
    if let Some(found) = find_in_path(binary) {
        return Ok(found);
    }

    let hardcoded = [
        PathBuf::from(format!("/opt/homebrew/bin/{binary}")),
        PathBuf::from(format!("/usr/local/bin/{binary}")),
        PathBuf::from(format!("/usr/bin/{binary}")),
    ];
    for candidate in hardcoded {
        if is_executable(&candidate) {
            return Ok(candidate);
        }
    }
    if let Some(found) = find_in_nvm(binary) {
        return Ok(found);
    }

    Err(format!(
        "failed to resolve executable `{binary}`; set {override_env} to an absolute path"
    ))
}

fn build_runtime_path(extra_bin_dirs: &[PathBuf]) -> Option<OsString> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut push_unique = |dir: PathBuf| {
        if dir.as_os_str().is_empty() || !dir.exists() {
            return;
        }
        if !dirs.iter().any(|existing| existing == &dir) {
            dirs.push(dir);
        }
    };

    for dir in extra_bin_dirs {
        push_unique(dir.clone());
    }

    if let Some(path_var) = env::var_os("PATH") {
        for dir in env::split_paths(&path_var) {
            push_unique(dir);
        }
    }

    for fallback in [
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ] {
        push_unique(fallback);
    }

    env::join_paths(dirs).ok()
}

fn external_browser_provider_status() -> Value {
    let configured = |key: &str| {
        env::var(key)
            .ok()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
    };
    json!({
        "steel": {
            "configured": configured("RAIL_STEEL_CDP_URL"),
            "capabilities": ["interactive_browser", "stateful_session", "extract_document"],
        },
        "browser_use": {
            "configured": false,
            "capabilities": ["interactive_browser"],
        },
        "scrapy_playwright": {
            "configured": false,
            "capabilities": ["batch_crawl"],
        },
        "lightpanda_experimental": {
            "configured": configured("RAIL_LIGHTPANDA_CDP_URL"),
            "capabilities": ["interactive_browser", "stateful_session"],
        }
    })
}

fn is_external_web_provider(provider: &str) -> bool {
    matches!(provider, "steel" | "lightpanda_experimental")
}

async fn external_browser_provider_health_map(app: &AppHandle) -> Value {
    let mut map = serde_json::Map::new();
    for provider in [
        "steel",
        "lightpanda_experimental",
        "browser_use",
        "scrapy_playwright",
    ] {
        let value = match crate::crawl_providers::dashboard_crawl_provider_health(
            app.clone(),
            None,
            provider.to_string(),
        )
        .await
        {
            Ok(health) => serde_json::to_value(health).unwrap_or_else(|_| {
                json!({
                    "provider": provider,
                    "ready": false,
                    "message": "failed to serialize provider health",
                })
            }),
            Err(error) => json!({
                "provider": provider,
                "available": false,
                "ready": false,
                "configured": false,
                "installed": false,
                "installable": false,
                "message": error,
            }),
        };
        map.insert(provider.to_string(), value);
    }
    Value::Object(map)
}

fn merge_provider_health_maps(base: Value, extra: Value) -> Value {
    match (base, extra) {
        (Value::Object(mut base_map), Value::Object(extra_map)) => {
            for (key, value) in extra_map {
                base_map.insert(key, value);
            }
            Value::Object(base_map)
        }
        (Value::Object(base_map), other) => {
            let mut merged = base_map;
            merged.insert("external".to_string(), other);
            Value::Object(merged)
        }
        (other, Value::Object(extra_map)) => {
            let mut merged = serde_json::Map::new();
            merged.insert("worker".to_string(), other);
            for (key, value) in extra_map {
                merged.insert(key, value);
            }
            Value::Object(merged)
        }
        (other, extra_other) => json!({
            "worker": other,
            "external": extra_other,
        }),
    }
}

fn extract_first_http_url(prompt: &str) -> Option<String> {
    for token in prompt.split_whitespace() {
        let trimmed = token
            .trim_matches(|ch: char| matches!(ch, '"' | '\'' | '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>'))
            .trim_end_matches(|ch: char| matches!(ch, '.' | ',' | ';' | ':' | '!' | '?'));
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(parsed) = Url::parse(trimmed) {
            if parsed.scheme() == "http" || parsed.scheme() == "https" {
                return Some(parsed.to_string());
            }
        }
    }
    None
}

fn build_search_bootstrap_url(prompt: &str) -> Option<String> {
    let query = prompt
        .split_whitespace()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if query.is_empty() {
        return None;
    }
    let encoded = url::form_urlencoded::byte_serialize(query.as_bytes()).collect::<String>();
    Some(format!("https://duckduckgo.com/html/?q={encoded}"))
}

fn resolve_external_web_provider_cwd(
    app: &AppHandle,
    cwd: Option<String>,
) -> Result<String, String> {
    if let Some(existing) = cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(existing.to_string());
    }
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir for external web provider: {error}"))?;
    let external_dir = app_data_dir.join("external-web-provider");
    fs::create_dir_all(&external_dir)
        .map_err(|error| format!("failed to create external web provider workspace: {error}"))?;
    Ok(external_dir.to_string_lossy().to_string())
}

fn build_external_web_provider_text(
    fetch: &crate::crawl_providers::DashboardCrawlProviderFetchResult,
) -> String {
    format!(
        "[source]\n{}\n\n[summary]\n{}\n\n[content]\n{}",
        fetch.url, fetch.summary, fetch.content
    )
}

async fn run_external_web_provider(
    app: &AppHandle,
    provider: &str,
    prompt: &str,
    cwd: Option<String>,
) -> Result<WebProviderRunResult, String> {
    let (url, extraction_strategy) = if let Some(explicit_url) = extract_first_http_url(prompt) {
        (explicit_url, "external_crawl_provider")
    } else {
        let fallback_url = build_search_bootstrap_url(prompt).ok_or_else(|| {
            format!(
                "{provider} web provider requires either an explicit URL or a non-empty prompt"
            )
        })?;
        (fallback_url, "search_bootstrap")
    };
    let resolved_cwd = resolve_external_web_provider_cwd(app, cwd)?;
    let started = Instant::now();
    let fetch = crate::crawl_providers::dashboard_crawl_provider_fetch_url(
        app.clone(),
        resolved_cwd,
        provider.to_string(),
        url,
        None,
    )
    .await?;
    let elapsed_ms = u64::try_from(started.elapsed().as_millis()).ok();
    let text = build_external_web_provider_text(&fetch);
    let raw = serde_json::to_value(&fetch)
        .map_err(|error| format!("failed to serialize external provider fetch: {error}"))?;
    Ok(WebProviderRunResult {
        ok: true,
        text: Some(text),
        raw: Some(raw),
        meta: Some(WebProviderRunMeta {
            provider: provider.to_string(),
            url: Some(fetch.url.clone()),
            started_at: None,
            finished_at: Some(fetch.fetched_at.clone()),
            elapsed_ms,
            extraction_strategy: Some(extraction_strategy.to_string()),
        }),
        error: None,
        error_code: None,
    })
}

fn merge_bridge_metadata(existing: Option<Value>) -> Option<Value> {
    let mut bridge = existing.unwrap_or_else(|| json!({}));
    if let Some(object) = bridge.as_object_mut() {
        object.insert(
            "externalProviders".to_string(),
            external_browser_provider_status(),
        );
        return Some(Value::Object(object.clone()));
    }
    Some(json!({
        "raw": bridge,
        "externalProviders": external_browser_provider_status(),
    }))
}

#[derive(Default)]
pub struct EngineManager {
    runtime: Mutex<Option<Arc<EngineRuntime>>>,
    web_worker: Mutex<Option<Arc<WebWorkerRuntime>>>,
}

#[derive(Debug, Serialize, Clone)]
struct EngineNotificationEvent {
    method: String,
    params: Value,
}

#[derive(Debug, Serialize, Clone)]
struct EngineLifecycleEvent {
    state: String,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RpcIncomingMessage {
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    params: Option<Value>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<RpcError>,
}

#[derive(Debug, Deserialize)]
struct RpcError {
    code: i64,
    message: String,
    #[serde(default)]
    data: Option<Value>,
}

type PendingMap = HashMap<u64, oneshot::Sender<Result<Value, String>>>;
type PendingServerRequestMap = HashMap<u64, String>;
type WebPendingMap = HashMap<u64, oneshot::Sender<Result<Value, String>>>;

struct EngineRuntime {
    app: AppHandle,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<PendingMap>>,
    pending_server_requests: Arc<Mutex<PendingServerRequestMap>>,
    next_id: AtomicU64,
    initialized: AtomicBool,
    reader_task: JoinHandle<()>,
    stderr_task: JoinHandle<()>,
}

struct WebWorkerRuntime {
    app: AppHandle,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<WebPendingMap>>,
    next_id: AtomicU64,
    reader_task: JoinHandle<()>,
    stderr_task: JoinHandle<()>,
    log_path: PathBuf,
    profile_root: PathBuf,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EngineApprovalRequestEvent {
    request_id: u64,
    method: String,
    params: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginChatgptResult {
    auth_url: String,
    raw: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadStartResult {
    thread_id: String,
    raw: Value,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum SandboxMode {
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}

impl SandboxMode {
    fn thread_start_value(self) -> &'static str {
        match self {
            SandboxMode::ReadOnly => "read-only",
            SandboxMode::WorkspaceWrite => "workspace-write",
            SandboxMode::DangerFullAccess => "danger-full-access",
        }
    }

    fn turn_policy_value(self) -> &'static str {
        match self {
            SandboxMode::ReadOnly => "readOnly",
            SandboxMode::WorkspaceWrite => "workspaceWrite",
            SandboxMode::DangerFullAccess => "dangerFullAccess",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageCheckResult {
    source_method: String,
    raw: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthProbeResult {
    state: String,
    source_method: Option<String>,
    auth_mode: Option<String>,
    raw: Option<Value>,
    detail: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuleDoc {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentRulesReadResult {
    pub docs: Vec<AgentRuleDoc>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebProviderRunMeta {
    pub provider: String,
    pub url: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub elapsed_ms: Option<u64>,
    pub extraction_strategy: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebProviderRunResult {
    pub ok: bool,
    pub text: Option<String>,
    pub raw: Option<Value>,
    pub meta: Option<WebProviderRunMeta>,
    pub error: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebWorkerHealth {
    pub running: bool,
    pub last_error: Option<String>,
    pub providers: Value,
    pub log_path: Option<String>,
    pub profile_root: Option<String>,
    pub active_provider: Option<String>,
    pub bridge: Option<Value>,
}

impl EngineRuntime {
    async fn start(app: AppHandle, cwd: String) -> Result<Arc<Self>, String> {
        let codex_home = resolve_codex_home_dir(&app).await?;
        let codex_bin = resolve_executable("codex", "RAIL_CODEX_BIN")?;
        let node_bin = resolve_executable("node", "RAIL_NODE_BIN")?;

        let mut command = Command::new(&codex_bin);
        command
            .arg("app-server")
            .arg("--listen")
            .arg("stdio://")
            .current_dir(cwd)
            .env("CODEX_HOME", &codex_home)
            .kill_on_drop(true)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let path_dirs = [
            codex_bin
                .parent()
                .map(|path| path.to_path_buf())
                .unwrap_or_default(),
            node_bin
                .parent()
                .map(|path| path.to_path_buf())
                .unwrap_or_default(),
        ];
        if let Some(path_env) = build_runtime_path(&path_dirs) {
            command.env("PATH", path_env);
        }

        let mut child = command
            .spawn()
            .map_err(|e| format!("failed to spawn codex app-server: {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "failed to open child stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to open child stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "failed to open child stderr".to_string())?;

        let pending = Arc::new(Mutex::new(HashMap::new()));
        let pending_server_requests = Arc::new(Mutex::new(HashMap::new()));
        let child = Arc::new(Mutex::new(child));
        let stdin = Arc::new(Mutex::new(stdin));

        let reader_task = {
            let app = app.clone();
            let pending = pending.clone();
            let pending_server_requests = pending_server_requests.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();

                loop {
                    match lines.next_line().await {
                        Ok(Some(raw_line)) => {
                            let line = raw_line.trim();
                            if line.is_empty() {
                                continue;
                            }
                            if let Err(err) =
                                handle_incoming_line(&app, &pending, &pending_server_requests, line)
                                    .await
                            {
                                emit_lifecycle(
                                    &app,
                                    "parseError",
                                    Some(format!("failed to parse incoming JSON-RPC line: {err}")),
                                );
                            }
                        }
                        Ok(None) => {
                            emit_lifecycle(&app, "disconnected", Some("stdout closed".to_string()));
                            break;
                        }
                        Err(err) => {
                            emit_lifecycle(
                                &app,
                                "readError",
                                Some(format!("failed while reading stdout: {err}")),
                            );
                            break;
                        }
                    }
                }

                resolve_all_pending(&pending, "engine output stream closed").await;
            })
        };

        let stderr_task = {
            let app = app.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => {
                            let payload = EngineNotificationEvent {
                                method: "engine/stderr".to_string(),
                                params: json!({ "line": line }),
                            };
                            let _ = app.emit(EVENT_ENGINE_NOTIFICATION, payload);
                        }
                        Ok(None) => break,
                        Err(err) => {
                            emit_lifecycle(
                                &app,
                                "stderrError",
                                Some(format!("failed while reading stderr: {err}")),
                            );
                            break;
                        }
                    }
                }
            })
        };

        let runtime = Arc::new(Self {
            app,
            child,
            stdin,
            pending,
            pending_server_requests,
            next_id: AtomicU64::new(1),
            initialized: AtomicBool::new(false),
            reader_task,
            stderr_task,
        });

        emit_lifecycle(&runtime.app, "starting", None);
        if let Err(err) = runtime.initialize_handshake().await {
            let _ = runtime.stop().await;
            return Err(err);
        }
        emit_lifecycle(&runtime.app, "ready", None);

        Ok(runtime)
    }

    async fn initialize_handshake(&self) -> Result<(), String> {
        let _ = self
            .request_internal(
                "initialize",
                json!({
                  "clientInfo": {
                    "name": "rail",
                    "version": env!("CARGO_PKG_VERSION")
                  },
                  "capabilities": {}
                }),
                false,
            )
            .await?;

        self.notify_internal("initialized", json!({}), false)
            .await?;
        self.initialized.store(true, Ordering::SeqCst);
        Ok(())
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.request_internal(method, params, true).await
    }

    async fn request_internal(
        &self,
        method: &str,
        params: Value,
        require_initialized: bool,
    ) -> Result<Value, String> {
        if require_initialized && !self.initialized.load(Ordering::SeqCst) {
            return Err("Not initialized".to_string());
        }

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let payload = json!({
          "jsonrpc": "2.0",
          "id": id,
          "method": method,
          "params": params
        });

        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        if let Err(err) = self.write_jsonl(&payload).await {
            self.pending.lock().await.remove(&id);
            return Err(err);
        }

        match timeout(REQUEST_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_recv_closed)) => Err("response channel closed".to_string()),
            Err(_elapsed) => {
                self.pending.lock().await.remove(&id);
                Err(format!("request timed out: {method}"))
            }
        }
    }

    async fn notify_internal(
        &self,
        method: &str,
        params: Value,
        require_initialized: bool,
    ) -> Result<(), String> {
        if require_initialized && !self.initialized.load(Ordering::SeqCst) {
            return Err("Not initialized".to_string());
        }

        let payload = json!({
          "jsonrpc": "2.0",
          "method": method,
          "params": params
        });

        self.write_jsonl(&payload).await
    }

    async fn write_jsonl(&self, payload: &Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(payload)
            .map_err(|e| format!("failed to serialize JSON-RPC payload: {e}"))?;
        bytes.push(b'\n');

        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(&bytes)
            .await
            .map_err(|e| format!("failed to write to app-server stdin: {e}"))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("failed to flush app-server stdin: {e}"))
    }

    async fn stop(&self) -> Result<(), String> {
        self.initialized.store(false, Ordering::SeqCst);

        self.reader_task.abort();
        self.stderr_task.abort();

        {
            let mut child = self.child.lock().await;
            let _ = child.kill().await;
            let _ = child.wait().await;
        }

        resolve_all_pending(&self.pending, "engine stopped").await;
        self.pending_server_requests.lock().await.clear();
        emit_lifecycle(&self.app, "stopped", None);

        Ok(())
    }

    async fn respond_server_request(&self, request_id: u64, result: Value) -> Result<(), String> {
        let method = self
            .pending_server_requests
            .lock()
            .await
            .remove(&request_id)
            .ok_or_else(|| format!("unknown approval request id: {request_id}"))?;

        let payload = json!({
          "jsonrpc": "2.0",
          "id": request_id,
          "result": result
        });

        self.write_jsonl(&payload).await?;

        let _ = self.app.emit(
            EVENT_ENGINE_NOTIFICATION,
            EngineNotificationEvent {
                method: "engine/approvalResponseSent".to_string(),
                params: json!({
                    "requestId": request_id,
                    "approvalMethod": method
                }),
            },
        );

        Ok(())
    }
}

impl WebWorkerRuntime {
    async fn start(app: AppHandle) -> Result<Arc<Self>, String> {
        let node_bin = resolve_executable("node", "RAIL_NODE_BIN")?;
        let worker_script = resolve_web_worker_script_path(&app)?;
        let (profile_root, log_path) = resolve_web_worker_dirs(&app).await?;
        let worker_cwd = resolve_web_worker_cwd(&app);

        let mut child = Command::new(node_bin)
            .arg(&worker_script)
            .current_dir(worker_cwd)
            .env("RAIL_WEB_PROFILE_ROOT", &profile_root)
            .env("RAIL_WEB_LOG_PATH", &log_path)
            .env("RAIL_WEB_USE_SYSTEM_CHROME_PROFILE", "0")
            .env("RAIL_PARENT_PID", std::process::id().to_string())
            .kill_on_drop(true)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to spawn web worker: {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "failed to open web worker stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to open web worker stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "failed to open web worker stderr".to_string())?;

        let pending: Arc<Mutex<WebPendingMap>> = Arc::new(Mutex::new(HashMap::new()));
        let child = Arc::new(Mutex::new(child));
        let stdin = Arc::new(Mutex::new(stdin));

        let reader_task = {
            let app = app.clone();
            let pending = pending.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(raw_line)) => {
                            let line = raw_line.trim();
                            if line.is_empty() {
                                continue;
                            }
                            if let Err(err) =
                                handle_web_worker_incoming_line(&app, &pending, line).await
                            {
                                let _ = app.emit(
                                    EVENT_ENGINE_NOTIFICATION,
                                    EngineNotificationEvent {
                                        method: "web/worker/parseError".to_string(),
                                        params: json!({ "error": err.to_string() }),
                                    },
                                );
                            }
                        }
                        Ok(None) => {
                            let _ = app.emit(
                                EVENT_ENGINE_NOTIFICATION,
                                EngineNotificationEvent {
                                    method: "web/worker/stopped".to_string(),
                                    params: json!({ "reason": "stdout closed" }),
                                },
                            );
                            break;
                        }
                        Err(err) => {
                            let _ = app.emit(
                                EVENT_ENGINE_NOTIFICATION,
                                EngineNotificationEvent {
                                    method: "web/worker/readError".to_string(),
                                    params: json!({ "error": err.to_string() }),
                                },
                            );
                            break;
                        }
                    }
                }
                resolve_all_web_pending(&pending, "web worker output stream closed").await;
            })
        };

        let stderr_task = {
            let app = app.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => {
                            let _ = app.emit(
                                EVENT_ENGINE_NOTIFICATION,
                                EngineNotificationEvent {
                                    method: "web/worker/stderr".to_string(),
                                    params: json!({ "line": line }),
                                },
                            );
                        }
                        Ok(None) => break,
                        Err(err) => {
                            let _ = app.emit(
                                EVENT_ENGINE_NOTIFICATION,
                                EngineNotificationEvent {
                                    method: "web/worker/stderrError".to_string(),
                                    params: json!({ "error": err.to_string() }),
                                },
                            );
                            break;
                        }
                    }
                }
            })
        };

        let runtime = Arc::new(Self {
            app,
            child,
            stdin,
            pending,
            next_id: AtomicU64::new(1),
            reader_task,
            stderr_task,
            log_path,
            profile_root,
        });

        let _ = runtime.app.emit(
            EVENT_ENGINE_NOTIFICATION,
            EngineNotificationEvent {
                method: "web/worker/ready".to_string(),
                params: json!({
                    "profileRoot": runtime.profile_root,
                    "logPath": runtime.log_path
                }),
            },
        );

        Ok(runtime)
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let payload = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        if let Err(err) = self.write_jsonl(&payload).await {
            self.pending.lock().await.remove(&id);
            return Err(err);
        }

        match timeout(WEB_WORKER_REQUEST_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("web worker response channel closed".to_string()),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(format!("web worker request timed out: {method}"))
            }
        }
    }

    async fn write_jsonl(&self, payload: &Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(payload)
            .map_err(|e| format!("failed to serialize web worker payload: {e}"))?;
        bytes.push(b'\n');

        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(&bytes)
            .await
            .map_err(|e| format!("failed to write to web worker stdin: {e}"))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("failed to flush web worker stdin: {e}"))
    }

    async fn stop(&self) -> Result<(), String> {
        self.reader_task.abort();
        self.stderr_task.abort();
        {
            let mut child = self.child.lock().await;
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        resolve_all_web_pending(&self.pending, "web worker stopped").await;
        let _ = self.app.emit(
            EVENT_ENGINE_NOTIFICATION,
            EngineNotificationEvent {
                method: "web/worker/stopped".to_string(),
                params: json!({ "reason": "engine command stop" }),
            },
        );
        Ok(())
    }
}

fn resolve_web_worker_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    // Prefer bundled app resource path so rail.app runs standalone.
    if let Ok(resource_path) = app
        .path()
        .resolve("scripts/web_worker/index.mjs", BaseDirectory::Resource)
    {
        if resource_path.exists() {
            return Ok(resource_path);
        }
    }
    if let Ok(resource_path_up) = app
        .path()
        .resolve("_up_/scripts/web_worker/index.mjs", BaseDirectory::Resource)
    {
        if resource_path_up.exists() {
            return Ok(resource_path_up);
        }
    }

    // Dev fallback when running from source tree.
    let dev_path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/web_worker/index.mjs");
    if dev_path.exists() {
        return Ok(dev_path);
    }

    Err("web worker script not found in app resources or source tree".to_string())
}

fn resolve_web_worker_cwd(app: &AppHandle) -> PathBuf {
    // For bundled app, use app data dir as stable writable cwd.
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        return app_data_dir;
    }
    // Dev fallback.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

async fn resolve_web_worker_dirs(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    ensure_private_dir(&app_data_dir, "app data dir").await?;

    let profile_root = app_data_dir.join("providers");
    ensure_private_dir(&profile_root, "provider profile root").await?;

    let log_path = app_data_dir.join("web-worker.log");
    if let Some(parent) = log_path.parent() {
        ensure_private_dir(parent, "worker log dir").await?;
    }
    crate::storage::enforce_default_web_worker_log_limit(&log_path)?;

    Ok((profile_root, log_path))
}

async fn resolve_codex_home_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(raw_override) = env::var("RAIL_CODEX_HOME") {
        let trimmed = raw_override.trim();
        if !trimmed.is_empty() {
            let overridden = PathBuf::from(trimmed);
            ensure_private_dir(&overridden, "override codex home dir").await?;
            return Ok(overridden);
        }
    }

    let home_mode = env::var("RAIL_CODEX_HOME_MODE")
        .ok()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "isolated".to_string());

    if home_mode != "isolated" {
        if let Ok(home) = env::var("HOME") {
            let global_codex_home = PathBuf::from(home).join(".codex");
            ensure_private_dir(&global_codex_home, "global codex home dir").await?;
            let has_user_config = global_codex_home.join("config.toml").is_file();
            let has_user_auth = global_codex_home.join("auth.json").is_file();
            if has_user_config || has_user_auth {
                return Ok(global_codex_home);
            }
        }
    }

    let app_cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("failed to resolve app cache dir: {e}"))?;
    ensure_private_dir(&app_cache_dir, "app cache dir").await?;

    let codex_home = app_cache_dir.join("codex-home");
    if !codex_home.exists() {
        if let Ok(app_data_dir) = app.path().app_data_dir() {
            let legacy_codex_home = app_data_dir.join("codex-home");
            if legacy_codex_home.is_dir() {
                if let Some(parent) = codex_home.parent() {
                    ensure_private_dir(parent, "codex cache parent dir").await?;
                }
                if let Err(error) = fs::rename(&legacy_codex_home, &codex_home) {
                    eprintln!(
                        "failed to move legacy codex-home from {} to {}: {error}",
                        legacy_codex_home.display(),
                        codex_home.display()
                    );
                }
            }
        }
    }
    ensure_private_dir(&codex_home, "codex home dir").await?;
    if let Err(error) = sync_global_codex_runtime_config(&codex_home) {
        eprintln!("failed to sync global codex config into app codex-home: {error}");
    }
    Ok(codex_home)
}

fn copy_if_newer(src: &Path, dest: &Path) -> Result<(), String> {
    if !src.is_file() {
        return Ok(());
    }

    let should_copy = match (fs::metadata(src), fs::metadata(dest)) {
        (Ok(src_meta), Ok(dest_meta)) => {
            let src_modified = src_meta.modified().ok();
            let dest_modified = dest_meta.modified().ok();
            match (src_modified, dest_modified) {
                (Some(src_ts), Some(dest_ts)) => src_ts > dest_ts,
                (Some(_), None) => true,
                (None, Some(_)) => false,
                (None, None) => false,
            }
        }
        (Ok(_), Err(_)) => true,
        (Err(error), _) => {
            return Err(format!(
                "failed to read source metadata for {}: {error}",
                src.display()
            ))
        }
    };

    if !should_copy {
        return Ok(());
    }

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create destination directory {}: {error}",
                parent.display()
            )
        })?;
    }

    fs::copy(src, dest).map_err(|error| {
        format!(
            "failed to copy {} -> {}: {error}",
            src.display(),
            dest.display()
        )
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dest, std::fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

fn sync_global_codex_runtime_config(codex_home: &Path) -> Result<(), String> {
    let home = match env::var("HOME") {
        Ok(value) => value,
        Err(_) => return Ok(()),
    };

    let global_codex_home = PathBuf::from(home).join(".codex");
    if !global_codex_home.is_dir() {
        return Ok(());
    }

    let global_config = global_codex_home.join("config.toml");
    let runtime_config = codex_home.join("config.toml");
    copy_if_newer(&global_config, &runtime_config)?;

    let runtime_agents_dir = codex_home.join("agents");
    fs::create_dir_all(&runtime_agents_dir).map_err(|error| {
        format!(
            "failed to create runtime agents directory {}: {error}",
            runtime_agents_dir.display()
        )
    })?;

    let global_agents_dir = global_codex_home.join("agents");
    if global_agents_dir.is_dir() {
        let entries = fs::read_dir(&global_agents_dir).map_err(|error| {
            format!(
                "failed to read global agents directory {}: {error}",
                global_agents_dir.display()
            )
        })?;

        for entry in entries {
            let Ok(entry) = entry else {
                continue;
            };
            let source_path = entry.path();
            if !source_path.is_file() {
                continue;
            }
            let Some(file_name) = source_path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if !file_name.ends_with(".toml") {
                continue;
            }
            let destination_path = runtime_agents_dir.join(file_name);
            copy_if_newer(&source_path, &destination_path)?;
        }
    }

    task_prompt_packs::sync_builtin_task_agent_prompt_packs(&runtime_agents_dir)?;

    Ok(())
}

async fn ensure_private_dir(path: &Path, label: &str) -> Result<(), String> {
    tokio::fs::create_dir_all(path)
        .await
        .map_err(|e| format!("failed to create {label}: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .await
            .map_err(|e| format!("failed to tighten permissions for {label}: {e}"))?;
    }

    Ok(())
}

fn append_if_file(out: &mut Vec<PathBuf>, path: PathBuf) {
    if path.is_file() {
        out.push(path);
    }
}

fn collect_skill_docs(dir: &Path, out: &mut Vec<PathBuf>, max_docs: usize) {
    if out.len() >= max_docs {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .collect();
    paths.sort();

    for path in paths {
        if out.len() >= max_docs {
            return;
        }
        if path.is_dir() {
            collect_skill_docs(&path, out, max_docs);
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if file_name.eq_ignore_ascii_case("skill.md") {
            out.push(path);
        }
    }
}

#[tauri::command]
pub async fn agent_rules_read(
    cwd: String,
    base_cwd: Option<String>,
) -> Result<AgentRulesReadResult, String> {
    let cwd_trimmed = cwd.trim();
    if cwd_trimmed.is_empty() {
        return Ok(AgentRulesReadResult { docs: Vec::new() });
    }

    let cwd_candidate = PathBuf::from(cwd_trimmed);
    let cwd_path = if cwd_candidate.is_absolute() {
        cwd_candidate
    } else if let Some(base) = base_cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        PathBuf::from(base).join(cwd_candidate)
    } else {
        cwd_candidate
    };
    if !cwd_path.is_dir() {
        return Ok(AgentRulesReadResult { docs: Vec::new() });
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    append_if_file(&mut candidates, cwd_path.join("agent.md"));
    append_if_file(&mut candidates, cwd_path.join("AGENT.md"));
    append_if_file(&mut candidates, cwd_path.join("agents.md"));
    append_if_file(&mut candidates, cwd_path.join("AGENTS.md"));
    append_if_file(&mut candidates, cwd_path.join("skill.md"));
    append_if_file(&mut candidates, cwd_path.join("SKILL.md"));

    collect_skill_docs(&cwd_path.join("skills"), &mut candidates, 24);

    let mut docs: Vec<AgentRuleDoc> = Vec::new();
    for path in candidates {
        if docs.len() >= 24 {
            break;
        }
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let trimmed = content.trim();
        if trimmed.is_empty() {
            continue;
        }
        let relative_path = path
            .strip_prefix(&cwd_path)
            .unwrap_or(path.as_path())
            .to_string_lossy()
            .to_string();
        docs.push(AgentRuleDoc {
            path: relative_path,
            content: trimmed.to_string(),
        });
    }

    Ok(AgentRulesReadResult { docs })
}

fn logout_auth_candidate_paths(codex_home: &Path) -> Vec<PathBuf> {
    let mut paths = vec![
        codex_home.join("auth.json"),
        codex_home.join("credentials.json"),
        codex_home.join(".auth.json"),
    ];

    if let Some(home) = env::var_os("HOME") {
        let global_codex_home = PathBuf::from(home).join(".codex");
        paths.push(global_codex_home.join("auth.json"));
        paths.push(global_codex_home.join("credentials.json"));
    }

    paths
}

fn clear_local_auth_artifacts(codex_home: &Path) -> Result<Vec<String>, String> {
    let candidates = logout_auth_candidate_paths(codex_home);
    let mut removed: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for path in candidates {
        if !path.exists() {
            continue;
        }
        match fs::remove_file(&path) {
            Ok(_) => removed.push(path.to_string_lossy().to_string()),
            Err(err) => errors.push(format!("{}: {}", path.display(), err)),
        }
    }

    if errors.is_empty() {
        Ok(removed)
    } else {
        Err(errors.join(" | "))
    }
}

async fn handle_incoming_line(
    app: &AppHandle,
    pending: &Arc<Mutex<PendingMap>>,
    pending_server_requests: &Arc<Mutex<PendingServerRequestMap>>,
    line: &str,
) -> Result<(), String> {
    let incoming: RpcIncomingMessage =
        serde_json::from_str(line).map_err(|e| format!("invalid json: {e}"))?;

    if let (Some(method), Some(id_value)) = (incoming.method.clone(), incoming.id.as_ref()) {
        if incoming.result.is_none() && incoming.error.is_none() {
            if let Some(request_id) = rpc_id_to_u64(id_value) {
                if is_approval_method(&method) {
                    pending_server_requests
                        .lock()
                        .await
                        .insert(request_id, method.clone());
                    let params = incoming.params.unwrap_or(Value::Null);
                    let payload = EngineApprovalRequestEvent {
                        request_id,
                        method: method.clone(),
                        params: params.clone(),
                    };
                    let _ = app.emit(EVENT_ENGINE_APPROVAL_REQUEST, payload);
                    let _ = app.emit(
                        EVENT_ENGINE_NOTIFICATION,
                        EngineNotificationEvent { method, params },
                    );
                } else {
                    let _ = app.emit(
                        EVENT_ENGINE_NOTIFICATION,
                        EngineNotificationEvent {
                            method: "engine/unhandledServerRequest".to_string(),
                            params: json!({
                                "requestId": request_id,
                                "method": method,
                                "params": incoming.params.unwrap_or(Value::Null)
                            }),
                        },
                    );
                }
            }
            return Ok(());
        }
    }

    if let Some(method) = incoming.method {
        if incoming.id.is_none() {
            let payload = EngineNotificationEvent {
                method,
                params: incoming.params.unwrap_or(Value::Null),
            };
            let _ = app.emit(EVENT_ENGINE_NOTIFICATION, payload);
            return Ok(());
        }
    }

    if let Some(id_value) = incoming.id {
        if let Some(id) = rpc_id_to_u64(&id_value) {
            if let Some(sender) = pending.lock().await.remove(&id) {
                let response = if let Some(err) = incoming.error {
                    Err(format_rpc_error(err))
                } else {
                    Ok(incoming.result.unwrap_or(Value::Null))
                };
                let _ = sender.send(response);
            }
        }
    }

    Ok(())
}

async fn handle_web_worker_incoming_line(
    app: &AppHandle,
    pending: &Arc<Mutex<WebPendingMap>>,
    line: &str,
) -> Result<(), String> {
    let incoming: RpcIncomingMessage =
        serde_json::from_str(line).map_err(|e| format!("invalid json: {e}"))?;

    if let Some(method) = incoming.method {
        if incoming.id.is_none() {
            let payload = EngineNotificationEvent {
                method,
                params: incoming.params.unwrap_or(Value::Null),
            };
            let _ = app.emit(EVENT_ENGINE_NOTIFICATION, payload);
            return Ok(());
        }
    }

    if let Some(id_value) = incoming.id {
        if let Some(id) = rpc_id_to_u64(&id_value) {
            if let Some(sender) = pending.lock().await.remove(&id) {
                let response = if let Some(err) = incoming.error {
                    Err(format_rpc_error(err))
                } else {
                    Ok(incoming.result.unwrap_or(Value::Null))
                };
                let _ = sender.send(response);
            }
        }
    }

    Ok(())
}

fn is_approval_method(method: &str) -> bool {
    matches!(
        method,
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval"
    )
}

async fn resolve_all_pending(pending: &Arc<Mutex<PendingMap>>, reason: &str) {
    let mut locked = pending.lock().await;
    for (_id, sender) in locked.drain() {
        let _ = sender.send(Err(reason.to_string()));
    }
}

async fn resolve_all_web_pending(pending: &Arc<Mutex<WebPendingMap>>, reason: &str) {
    let mut locked = pending.lock().await;
    for (_id, sender) in locked.drain() {
        let _ = sender.send(Err(reason.to_string()));
    }
}

fn rpc_id_to_u64(id: &Value) -> Option<u64> {
    match id {
        Value::Number(n) => n.as_u64(),
        Value::String(s) => s.parse::<u64>().ok(),
        _ => None,
    }
}

fn format_rpc_error(err: RpcError) -> String {
    match err.data {
        Some(data) => format!("rpc error {}: {} ({data})", err.code, err.message),
        None => format!("rpc error {}: {}", err.code, err.message),
    }
}

fn emit_lifecycle(app: &AppHandle, state: &str, message: Option<String>) {
    let payload = EngineLifecycleEvent {
        state: state.to_string(),
        message,
    };
    let _ = app.emit(EVENT_ENGINE_LIFECYCLE, payload);
}

fn provider_url(provider: &str) -> Option<&'static str> {
    match provider {
        "gemini" => Some("https://gemini.google.com/"),
        "gpt" => Some("https://chatgpt.com/"),
        "grok" => Some("https://grok.com/"),
        "perplexity" => Some("https://www.perplexity.ai/"),
        "claude" => Some("https://claude.ai/"),
        _ => None,
    }
}

fn provider_child_view_label(provider_key: &str) -> String {
    format!("{CHILD_VIEW_LABEL_PREFIX}{provider_key}")
}

async fn current_runtime(state: &EngineManager) -> Result<Arc<EngineRuntime>, String> {
    state
        .runtime
        .lock()
        .await
        .as_ref()
        .cloned()
        .ok_or_else(|| "engine is not started".to_string())
}

async fn current_web_worker(state: &EngineManager) -> Result<Arc<WebWorkerRuntime>, String> {
    state
        .web_worker
        .lock()
        .await
        .as_ref()
        .cloned()
        .ok_or_else(|| "web worker is not started".to_string())
}

async fn ensure_web_worker_started(
    app: &AppHandle,
    state: &EngineManager,
) -> Result<Arc<WebWorkerRuntime>, String> {
    if let Some(runtime) = state.web_worker.lock().await.as_ref().cloned() {
        return Ok(runtime);
    }

    let runtime = WebWorkerRuntime::start(app.clone()).await?;
    let mut locked = state.web_worker.lock().await;
    if let Some(existing) = locked.as_ref().cloned() {
        drop(locked);
        runtime.stop().await?;
        return Ok(existing);
    }
    *locked = Some(runtime.clone());
    Ok(runtime)
}

fn is_web_worker_recoverable_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("web worker stopped")
        || lower.contains("response channel closed")
        || lower.contains("failed to write to web worker stdin")
        || lower.contains("failed to flush web worker stdin")
        || lower.contains("request timed out")
}

async fn request_web_worker_with_recovery(
    app: &AppHandle,
    state: &EngineManager,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let runtime = ensure_web_worker_started(app, state).await?;
    match runtime.request(method, params.clone()).await {
        Ok(value) => Ok(value),
        Err(error) if is_web_worker_recoverable_error(&error) => {
            {
                let mut locked = state.web_worker.lock().await;
                if let Some(current) = locked.as_ref() {
                    if Arc::ptr_eq(current, &runtime) {
                        locked.take();
                    }
                }
            }
            let _ = runtime.stop().await;
            let restarted = ensure_web_worker_started(app, state).await?;
            restarted.request(method, params).await
        }
        Err(error) => Err(error),
    }
}

fn extract_string_by_paths(value: &Value, paths: &[&str]) -> Option<String> {
    for path in paths {
        let mut current = value;
        let mut found = true;

        for part in path.split('.') {
            match current.get(part) {
                Some(next) => current = next,
                None => {
                    found = false;
                    break;
                }
            }
        }

        if found {
            if let Some(s) = current.as_str() {
                return Some(s.to_string());
            }
        }
    }

    None
}

fn extract_bool_by_paths(value: &Value, paths: &[&str]) -> Option<bool> {
    for path in paths {
        let mut current = value;
        let mut found = true;

        for part in path.split('.') {
            match current.get(part) {
                Some(next) => current = next,
                None => {
                    found = false;
                    break;
                }
            }
        }

        if found {
            if let Some(flag) = current.as_bool() {
                return Some(flag);
            }
        }
    }
    None
}

fn extract_auth_mode(value: &Value, depth: usize) -> Option<String> {
    if depth > 4 {
        return None;
    }

    match value {
        Value::String(mode) => {
            let normalized = mode.trim().to_lowercase();
            if normalized == "chatgpt" {
                Some("chatgpt".to_string())
            } else if normalized == "apikey" || normalized == "api_key" || normalized == "api-key" {
                Some("apikey".to_string())
            } else {
                None
            }
        }
        Value::Array(items) => items
            .iter()
            .find_map(|item| extract_auth_mode(item, depth + 1)),
        Value::Object(map) => {
            if let Some(mode) = map
                .get("authMode")
                .and_then(|candidate| extract_auth_mode(candidate, depth + 1))
            {
                return Some(mode);
            }
            if let Some(mode) = map
                .get("auth_mode")
                .and_then(|candidate| extract_auth_mode(candidate, depth + 1))
            {
                return Some(mode);
            }

            ["account", "user", "data", "payload"]
                .iter()
                .filter_map(|key| map.get(*key))
                .find_map(|candidate| extract_auth_mode(candidate, depth + 1))
        }
        _ => None,
    }
}

fn is_login_required_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    (lower.contains("login") || lower.contains("auth"))
        && (lower.contains("required")
            || lower.contains("unauthorized")
            || lower.contains("forbidden"))
}

#[tauri::command]
pub async fn engine_start(
    app: AppHandle,
    state: State<'_, EngineManager>,
    cwd: String,
) -> Result<(), String> {
    {
        if state.runtime.lock().await.is_some() {
            return Err("engine already started".to_string());
        }
    }

    let runtime = EngineRuntime::start(app, cwd).await?;

    let mut locked = state.runtime.lock().await;
    if locked.is_some() {
        // Extremely unlikely race; stop the newly created runtime to avoid leaks.
        drop(locked);
        runtime.stop().await?;
        return Err("engine already started".to_string());
    }
    *locked = Some(runtime);

    Ok(())
}

#[tauri::command]
pub async fn engine_stop(state: State<'_, EngineManager>) -> Result<(), String> {
    shutdown_all_runtimes(state.inner()).await
}

pub async fn shutdown_all_runtimes(state: &EngineManager) -> Result<(), String> {
    let runtime = state.runtime.lock().await.take();
    if let Some(runtime) = runtime {
        runtime.stop().await?;
    }
    let web_worker = state.web_worker.lock().await.take();
    if let Some(web_worker) = web_worker {
        web_worker.stop().await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn web_worker_start(
    app: AppHandle,
    state: State<'_, EngineManager>,
) -> Result<(), String> {
    let _ = ensure_web_worker_started(&app, &state).await?;
    Ok(())
}

#[tauri::command]
pub async fn web_worker_stop(state: State<'_, EngineManager>) -> Result<(), String> {
    let runtime = state.web_worker.lock().await.take();
    if let Some(runtime) = runtime {
        runtime.stop().await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn web_provider_health(
    app: AppHandle,
    state: State<'_, EngineManager>,
) -> Result<WebWorkerHealth, String> {
    let external_providers = external_browser_provider_health_map(&app).await;
    if let Ok(runtime) = current_web_worker(&state).await {
        let raw = match runtime.request("health", json!({})).await {
            Ok(raw) => raw,
            Err(error) if is_web_worker_recoverable_error(&error) => {
                {
                    let mut locked = state.web_worker.lock().await;
                    if let Some(current) = locked.as_ref() {
                        if Arc::ptr_eq(current, &runtime) {
                            locked.take();
                        }
                    }
                }
                let _ = runtime.stop().await;
                request_web_worker_with_recovery(&app, &state, "health", json!({})).await?
            }
            Err(error) => return Err(error),
        };
        let mut parsed =
            serde_json::from_value::<WebWorkerHealth>(raw).unwrap_or(WebWorkerHealth {
                running: true,
                last_error: None,
                providers: json!({}),
                log_path: Some(runtime.log_path.to_string_lossy().to_string()),
                profile_root: Some(runtime.profile_root.to_string_lossy().to_string()),
                active_provider: None,
                bridge: None,
            });
        parsed.running = true;
        if parsed.log_path.is_none() {
            parsed.log_path = Some(runtime.log_path.to_string_lossy().to_string());
        }
        if parsed.profile_root.is_none() {
            parsed.profile_root = Some(runtime.profile_root.to_string_lossy().to_string());
        }
        parsed.providers = merge_provider_health_maps(parsed.providers, external_providers.clone());
        parsed.bridge = merge_bridge_metadata(parsed.bridge);
        return Ok(parsed);
    }

    let (profile_root, log_path) = resolve_web_worker_dirs(&app).await?;
    Ok(WebWorkerHealth {
        running: false,
        last_error: None,
        providers: external_providers,
        log_path: Some(log_path.to_string_lossy().to_string()),
        profile_root: Some(profile_root.to_string_lossy().to_string()),
        active_provider: None,
        bridge: merge_bridge_metadata(None),
    })
}

#[tauri::command]
pub async fn web_provider_run(
    app: AppHandle,
    state: State<'_, EngineManager>,
    provider: String,
    prompt: String,
    timeout_ms: Option<u64>,
    mode: Option<String>,
    cwd: Option<String>,
) -> Result<WebProviderRunResult, String> {
    let provider_key = provider.trim().to_lowercase();
    if is_external_web_provider(&provider_key) {
        return run_external_web_provider(&app, &provider_key, &prompt, cwd).await;
    }
    let raw = request_web_worker_with_recovery(
        &app,
        &state,
        "provider/run",
        json!({
            "provider": provider_key,
            "prompt": prompt,
            "timeoutMs": timeout_ms.unwrap_or(90_000),
            "mode": mode.unwrap_or_else(|| "auto".to_string())
        }),
    )
    .await?;

    serde_json::from_value(raw).map_err(|e| format!("invalid web provider run response: {e}"))
}

#[tauri::command]
pub async fn web_provider_open_session(
    app: AppHandle,
    state: State<'_, EngineManager>,
    provider: String,
) -> Result<Value, String> {
    let provider_key = provider.trim().to_lowercase();
    if is_external_web_provider(&provider_key) {
        let health = crate::crawl_providers::dashboard_crawl_provider_health(
            app.clone(),
            None,
            provider_key.clone(),
        )
        .await?;
        let ready = health.ready;
        let session_state = if ready { "active" } else { "unavailable" };
        return Ok(json!({
            "ok": ready,
            "provider": provider_key,
            "sessionState": session_state,
            "message": health.message,
            "health": health,
            "error": if ready { Value::Null } else { Value::String("external runtime is not ready".to_string()) },
            "errorCode": if ready { Value::Null } else { Value::String("PROVIDER_NOT_READY".to_string()) },
        }));
    }
    request_web_worker_with_recovery(
        &app,
        &state,
        "provider/openSession",
        json!({ "provider": provider_key }),
    )
    .await
}

#[tauri::command]
pub async fn web_provider_reset_session(
    app: AppHandle,
    state: State<'_, EngineManager>,
    provider: String,
) -> Result<(), String> {
    let provider_key = provider.trim().to_lowercase();
    if is_external_web_provider(&provider_key) {
        return Ok(());
    }
    let _ = request_web_worker_with_recovery(
        &app,
        &state,
        "provider/resetSession",
        json!({ "provider": provider_key }),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn web_provider_cancel(
    app: AppHandle,
    state: State<'_, EngineManager>,
    provider: String,
) -> Result<(), String> {
    let provider_key = provider.trim().to_lowercase();
    if is_external_web_provider(&provider_key) {
        return Ok(());
    }
    let _ = request_web_worker_with_recovery(
        &app,
        &state,
        "provider/cancel",
        json!({ "provider": provider_key }),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn web_bridge_status(
    app: AppHandle,
    state: State<'_, EngineManager>,
) -> Result<Value, String> {
    let raw = request_web_worker_with_recovery(&app, &state, "bridge/status", json!({})).await?;
    if !raw.is_object() {
        return Ok(raw);
    }
    let mut sanitized = raw;
    if let Some(row) = sanitized.as_object_mut() {
        row.remove("token");
    }
    Ok(sanitized)
}

#[tauri::command]
pub async fn web_bridge_rotate_token(
    app: AppHandle,
    state: State<'_, EngineManager>,
) -> Result<Value, String> {
    request_web_worker_with_recovery(&app, &state, "bridge/tokenRotate", json!({})).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebBridgeConnectCodeResult {
    code: String,
    masked_code: String,
}

#[tauri::command]
pub async fn web_bridge_connect_code(
    app: AppHandle,
    state: State<'_, EngineManager>,
) -> Result<WebBridgeConnectCodeResult, String> {
    let raw = request_web_worker_with_recovery(&app, &state, "bridge/status", json!({})).await?;
    let token = extract_string_by_paths(&raw, &["token"])
        .ok_or_else(|| "bridge token not available".to_string())?;
    let port = raw
        .get("port")
        .and_then(|value| value.as_u64())
        .unwrap_or(38961);
    let code = serde_json::to_string_pretty(&json!({
        "bridgeUrl": format!("http://127.0.0.1:{port}"),
        "token": token,
    }))
    .map_err(|error| format!("failed to serialize bridge connect code: {error}"))?;
    let masked_code = serde_json::to_string_pretty(&json!({
        "bridgeUrl": format!("http://127.0.0.1:{port}"),
        "token": extract_string_by_paths(&raw, &["tokenMasked"]).unwrap_or_else(|| "********".to_string()),
    }))
    .map_err(|error| format!("failed to serialize masked bridge connect code: {error}"))?;
    Ok(WebBridgeConnectCodeResult { code, masked_code })
}

#[tauri::command]
pub async fn login_chatgpt(state: State<'_, EngineManager>) -> Result<LoginChatgptResult, String> {
    let runtime = current_runtime(&state).await?;
    let raw = runtime
        .request("account/login/start", json!({ "type": "chatgpt" }))
        .await?;

    let auth_url = extract_string_by_paths(&raw, &["authUrl", "auth_url", "url"])
        .ok_or_else(|| format!("authUrl not found in response: {raw}"))?;

    Ok(LoginChatgptResult { auth_url, raw })
}

#[tauri::command]
pub async fn usage_check(state: State<'_, EngineManager>) -> Result<UsageCheckResult, String> {
    let runtime = current_runtime(&state).await?;
    let candidates: [(&str, Value); 6] = [
        ("account/rateLimits/read", Value::Null),
        ("account/read", json!({})),
        ("account/usage/get", json!({})),
        ("account/usage", json!({})),
        ("account/get", json!({})),
        ("account/status", json!({})),
    ];

    let mut errors: Vec<String> = Vec::new();
    for (method, params) in candidates {
        match runtime.request(method, params).await {
            Ok(raw) => {
                return Ok(UsageCheckResult {
                    source_method: method.to_string(),
                    raw,
                });
            }
            Err(err) => {
                errors.push(format!("{method}: {err}"));
            }
        }
    }

    Err(format!(
        "failed to fetch usage info from app-server; attempted methods: {}",
        errors.join(" | ")
    ))
}

#[tauri::command]
pub async fn auth_probe(state: State<'_, EngineManager>) -> Result<AuthProbeResult, String> {
    let runtime = current_runtime(&state).await?;
    let candidates: [(&str, Value); 6] = [
        ("account/read", json!({})),
        ("account/rateLimits/read", Value::Null),
        ("account/status", json!({})),
        ("account/get", json!({})),
        ("account/usage/get", json!({})),
        ("account/usage", json!({})),
    ];
    let auth_bool_paths = [
        "authenticated",
        "isAuthenticated",
        "loggedIn",
        "isLoggedIn",
        "account.authenticated",
        "account.loggedIn",
    ];
    let requires_openai_auth_paths = ["requiresOpenaiAuth", "account.requiresOpenaiAuth"];

    let mut errors: Vec<String> = Vec::new();
    let mut saw_login_required = false;

    for (method, params) in candidates {
        match runtime.request(method, params).await {
            Ok(raw) => {
                let auth_mode = extract_auth_mode(&raw, 0);
                let requires_openai_auth =
                    extract_bool_by_paths(&raw, &requires_openai_auth_paths).unwrap_or(false);
                let state = if auth_mode.is_some() {
                    "authenticated"
                } else if let Some(flag) = extract_bool_by_paths(&raw, &auth_bool_paths) {
                    if flag {
                        "authenticated"
                    } else {
                        "login_required"
                    }
                } else if requires_openai_auth {
                    "login_required"
                } else if method.starts_with("account/usage")
                    || method == "account/rateLimits/read"
                    || method == "account/read"
                {
                    // Account endpoints succeeded, so auth is effectively active.
                    "authenticated"
                } else {
                    "unknown"
                };

                return Ok(AuthProbeResult {
                    state: state.to_string(),
                    source_method: Some(method.to_string()),
                    auth_mode,
                    raw: Some(raw),
                    detail: None,
                });
            }
            Err(err) => {
                if is_login_required_error(&err) {
                    saw_login_required = true;
                }
                errors.push(format!("{method}: {err}"));
            }
        }
    }

    let state = if saw_login_required {
        "login_required"
    } else {
        "unknown"
    };
    let detail = if errors.is_empty() {
        None
    } else {
        Some(errors.join(" | "))
    };

    Ok(AuthProbeResult {
        state: state.to_string(),
        source_method: None,
        auth_mode: None,
        raw: None,
        detail,
    })
}

#[tauri::command]
pub async fn logout_codex(state: State<'_, EngineManager>) -> Result<(), String> {
    let runtime = current_runtime(&state).await?;
    let codex_home = resolve_codex_home_dir(&runtime.app).await?;
    let candidates: [(&str, Value); 4] = [
        ("logoutChatGpt", json!({})),
        ("logoutChatGpt", Value::Null),
        ("account/logout", Value::Null),
        ("account/logout", json!({})),
    ];
    let mut errors: Vec<String> = Vec::new();

    for (method, params) in candidates {
        match runtime.request(method, params).await {
            Ok(_) => return Ok(()),
            Err(err) => {
                errors.push(format!("{method}: {err}"));
            }
        }
    }

    match clear_local_auth_artifacts(&codex_home) {
        Ok(_) => Ok(()),
        Err(clear_error) => Err(format!(
            "failed to logout from app-server; attempted methods: {}; local cleanup failed: {}",
            errors.join(" | "),
            clear_error
        )),
    }
}

#[tauri::command]
pub async fn thread_start(
    state: State<'_, EngineManager>,
    model: String,
    cwd: String,
    sandbox_mode: Option<SandboxMode>,
) -> Result<ThreadStartResult, String> {
    let runtime = current_runtime(&state).await?;
    let sandbox_mode = sandbox_mode.unwrap_or(SandboxMode::ReadOnly);
    let raw = runtime
        .request(
            "thread/start",
            json!({
              "model": model,
              "cwd": cwd,
              "sandbox": sandbox_mode.thread_start_value()
            }),
        )
        .await?;

    let thread_id = extract_string_by_paths(
        &raw,
        &[
            "threadId",
            "thread_id",
            "id",
            "thread.id",
            "thread.threadId",
            "thread.thread_id",
        ],
    )
    .ok_or_else(|| format!("thread id not found in response: {raw}"))?;

    Ok(ThreadStartResult { thread_id, raw })
}

#[tauri::command]
pub async fn codex_thread_read(
    state: State<'_, EngineManager>,
    thread_id: String,
    include_turns: Option<bool>,
) -> Result<Value, String> {
    let runtime = current_runtime(&state).await?;
    runtime
        .request(
            "thread/read",
            json!({
              "threadId": thread_id,
              "includeTurns": include_turns.unwrap_or(false)
            }),
        )
        .await
}

#[tauri::command]
pub async fn codex_thread_compact_start(
    state: State<'_, EngineManager>,
    thread_id: String,
) -> Result<Value, String> {
    let runtime = current_runtime(&state).await?;
    runtime
        .request(
            "thread/compact/start",
            json!({
              "threadId": thread_id
            }),
        )
        .await
}

#[tauri::command]
pub async fn turn_start(
    state: State<'_, EngineManager>,
    thread_id: String,
    text: String,
    reasoning_effort: Option<String>,
    temperature: Option<f64>,
    context_budget: Option<String>,
    max_input_chars: Option<u32>,
    sandbox_mode: Option<SandboxMode>,
) -> Result<Value, String> {
    let runtime = current_runtime(&state).await?;
    let sandbox_mode = sandbox_mode.unwrap_or(SandboxMode::ReadOnly);
    let mut payload = json!({
      "threadId": thread_id,
      "text": text,
      "input": [
        {
          "type": "text",
          "text": text
        }
      ],
      "sandboxPolicy": {
        "type": sandbox_mode.turn_policy_value()
      }
    });

    if let Some(effort) = reasoning_effort
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        if let Some(object) = payload.as_object_mut() {
            object.insert("reasoning".to_string(), json!({ "effort": effort }));
        }
    }

    if let Some(value) = temperature.filter(|value| value.is_finite()) {
        if let Some(object) = payload.as_object_mut() {
            object.insert("temperature".to_string(), json!(value));
        }
    }

    if let Some(value) = context_budget
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        if let Some(object) = payload.as_object_mut() {
            object.insert("contextBudget".to_string(), json!(value));
        }
    }

    if let Some(value) = max_input_chars.filter(|value| *value > 0) {
        if let Some(object) = payload.as_object_mut() {
            object.insert("maxInputChars".to_string(), json!(value));
        }
    }

    runtime.request("turn/start", payload).await
}

#[tauri::command]
pub async fn turn_start_blocking(
    state: State<'_, EngineManager>,
    thread_id: String,
    text: String,
    reasoning_effort: Option<String>,
    temperature: Option<f64>,
    context_budget: Option<String>,
    max_input_chars: Option<u32>,
    sandbox_mode: Option<SandboxMode>,
) -> Result<Value, String> {
    let runtime = current_runtime(&state).await?;
    let sandbox_mode = sandbox_mode.unwrap_or(SandboxMode::ReadOnly);
    let mut payload = json!({
      "threadId": thread_id,
      "text": text,
      "input": [
        {
          "type": "text",
          "text": text
        }
      ],
      "sandboxPolicy": {
        "type": sandbox_mode.turn_policy_value()
      },
      "stream": false
    });

    if let Some(effort) = reasoning_effort
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        if let Some(object) = payload.as_object_mut() {
            object.insert("reasoning".to_string(), json!({ "effort": effort }));
        }
    }

    if let Some(value) = temperature.filter(|value| value.is_finite()) {
        if let Some(object) = payload.as_object_mut() {
            object.insert("temperature".to_string(), json!(value));
        }
    }

    if let Some(value) = context_budget
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        if let Some(object) = payload.as_object_mut() {
            object.insert("contextBudget".to_string(), json!(value));
        }
    }

    if let Some(value) = max_input_chars.filter(|value| *value > 0) {
        if let Some(object) = payload.as_object_mut() {
            object.insert("maxInputChars".to_string(), json!(value));
        }
    }

    runtime.request("turn/start", payload).await
}

#[tauri::command]
pub async fn turn_interrupt(
    state: State<'_, EngineManager>,
    thread_id: String,
) -> Result<Value, String> {
    let runtime = current_runtime(&state).await?;
    runtime
        .request(
            "turn/interrupt",
            json!({
              "threadId": thread_id
            }),
        )
        .await
}

#[tauri::command]
pub async fn approval_respond(
    state: State<'_, EngineManager>,
    request_id: u64,
    result: Value,
) -> Result<(), String> {
    let runtime = current_runtime(&state).await?;
    runtime.respond_server_request(request_id, result).await
}

#[tauri::command]
pub async fn provider_window_open(app: AppHandle, provider: String) -> Result<(), String> {
    let provider_key = provider.trim().to_lowercase();
    let url =
        provider_url(&provider_key).ok_or_else(|| format!("unsupported provider: {provider}"))?;
    let window_id = format!("provider-{provider_key}");

    if let Some(window) = app.get_webview_window(&window_id) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let external = url
        .parse()
        .map_err(|e| format!("invalid provider url ({url}): {e}"))?;
    WebviewWindowBuilder::new(&app, &window_id, WebviewUrl::External(external))
        .title(format!("{provider_key} - RAIL"))
        .inner_size(1280.0, 860.0)
        .min_inner_size(1024.0, 700.0)
        .center()
        .build()
        .map_err(|e| format!("failed to open provider window: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn provider_window_close(app: AppHandle, provider: String) -> Result<(), String> {
    let provider_key = provider.trim().to_lowercase();
    let window_id = format!("provider-{provider_key}");
    let window = app
        .get_webview_window(&window_id)
        .ok_or_else(|| format!("provider window not found: {provider_key}"))?;
    window
        .close()
        .map_err(|e| format!("failed to close provider window: {e}"))?;
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
pub async fn provider_child_view_open(window: Window, provider: String) -> Result<(), String> {
    let provider_key = provider.trim().to_lowercase();
    let url =
        provider_url(&provider_key).ok_or_else(|| format!("unsupported provider: {provider}"))?;
    let child_label = provider_child_view_label(&provider_key);

    let size = window
        .inner_size()
        .map_err(|e| format!("failed to read parent window size: {e}"))?;
    let available_width = size
        .width
        .saturating_sub(CHILD_VIEW_SAFE_MARGIN_X.saturating_mul(2));
    let available_height = size
        .height
        .saturating_sub(CHILD_VIEW_SAFE_MARGIN_TOP + CHILD_VIEW_SAFE_MARGIN_BOTTOM);

    let width_ceiling = available_width.max(1);
    let height_ceiling = available_height.max(1);
    let width_floor = CHILD_VIEW_MIN_WIDTH.min(width_ceiling).max(1);
    let height_floor = CHILD_VIEW_MIN_HEIGHT.min(height_ceiling).max(1);
    let desired_width = ((f64::from(available_width) * CHILD_VIEW_WIDTH_RATIO).round() as u32)
        .min(CHILD_VIEW_MAX_WIDTH);
    let desired_height = ((f64::from(available_height) * CHILD_VIEW_HEIGHT_RATIO).round() as u32)
        .min(CHILD_VIEW_MAX_HEIGHT);
    let width = desired_width.max(width_floor).min(width_ceiling);
    let height = desired_height.max(height_floor).min(height_ceiling);

    let x_start = CHILD_VIEW_SAFE_MARGIN_X.min(size.width.saturating_sub(width));
    let y_start = CHILD_VIEW_SAFE_MARGIN_TOP.min(size.height.saturating_sub(height));
    let x = x_start + (available_width.saturating_sub(width) / 2);
    let y = y_start + (available_height.saturating_sub(height) / 2);

    if let Some(webview) = window.app_handle().get_webview(&child_label) {
        let _ = webview.set_position(tauri::LogicalPosition::new(f64::from(x), f64::from(y)));
        let _ = webview.set_size(tauri::LogicalSize::new(f64::from(width), f64::from(height)));
        let _ = webview.show();
        let _ = webview.set_focus();
        return Ok(());
    }

    let external = url
        .parse()
        .map_err(|e| format!("invalid provider url ({url}): {e}"))?;

    window
        .add_child(
            WebviewBuilder::new(child_label, WebviewUrl::External(external)),
            tauri::LogicalPosition::new(f64::from(x), f64::from(y)),
            tauri::LogicalSize::new(f64::from(width), f64::from(height)),
        )
        .map_err(|e| format!("failed to open provider child view: {e}"))?;

    Ok(())
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn provider_child_view_open(_provider: String) -> Result<(), String> {
    Err("provider child view is only supported on desktop".to_string())
}

#[cfg(desktop)]
#[tauri::command]
pub async fn provider_child_view_close(app: AppHandle, provider: String) -> Result<(), String> {
    let provider_key = provider.trim().to_lowercase();
    let child_label = provider_child_view_label(&provider_key);
    let webview = app
        .get_webview(&child_label)
        .ok_or_else(|| format!("provider child view not found: {provider_key}"))?;
    webview
        .close()
        .map_err(|e| format!("failed to close provider child view: {e}"))?;
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
pub async fn provider_child_view_hide(app: AppHandle, provider: String) -> Result<(), String> {
    let provider_key = provider.trim().to_lowercase();
    let child_label = provider_child_view_label(&provider_key);
    let Some(webview) = app.get_webview(&child_label) else {
        return Ok(());
    };
    webview
        .hide()
        .map_err(|e| format!("failed to hide provider child view: {e}"))?;
    Ok(())
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn provider_child_view_hide(_provider: String) -> Result<(), String> {
    Err("provider child view is only supported on desktop".to_string())
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn provider_child_view_close(_provider: String) -> Result<(), String> {
    Err("provider child view is only supported on desktop".to_string())
}

#[tauri::command]
pub async fn ollama_generate(model: String, prompt: String) -> Result<Value, String> {
    let trimmed_model = model.trim();
    let trimmed_prompt = prompt.trim();
    if trimmed_model.is_empty() {
        return Err("ollama model is required".to_string());
    }
    if trimmed_prompt.is_empty() {
        return Err("ollama prompt is required".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("failed to build ollama client: {e}"))?;

    let response = client
        .post("http://127.0.0.1:11434/api/generate")
        .json(&json!({
            "model": trimmed_model,
            "prompt": trimmed_prompt,
            "stream": false
        }))
        .send()
        .await
        .map_err(|e| format!("failed to call ollama api: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<unreadable body>".to_string());
        return Err(format!("ollama api returned {status}: {body}"));
    }

    response
        .json::<Value>()
        .await
        .map_err(|e| format!("invalid ollama response json: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{build_search_bootstrap_url, extract_first_http_url};

    #[test]
    fn extracts_first_http_url_from_prompt_text() {
        let prompt = "Please inspect https://x.com/OpenAI/status/12345 and summarize it.";
        assert_eq!(
            extract_first_http_url(prompt).as_deref(),
            Some("https://x.com/OpenAI/status/12345")
        );
    }

    #[test]
    fn ignores_non_http_urls() {
        let prompt = "Open ftp://example.com first and then maybe nothing else.";
        assert_eq!(extract_first_http_url(prompt), None);
    }

    #[test]
    fn builds_search_bootstrap_url_when_prompt_has_no_explicit_url() {
        let prompt = "latest indie game retention ideas";
        assert_eq!(
            build_search_bootstrap_url(prompt).as_deref(),
            Some("https://duckduckgo.com/html/?q=latest+indie+game+retention+ideas")
        );
    }
}
