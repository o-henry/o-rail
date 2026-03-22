use chrono::Local;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env,
    fs,
    net::IpAddr,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use url::Url;

const USER_AGENT: &str = "RAIL-Crawl-Providers/1.0";
const DEFAULT_TIMEOUT_MS: u64 = 15_000;
const ENV_CRAWL4AI_PYTHON: &str = "RAIL_CRAWL4AI_PYTHON";
const ENV_STEEL_CDP_URL: &str = "RAIL_STEEL_CDP_URL";
const ENV_LIGHTPANDA_CDP_URL: &str = "RAIL_LIGHTPANDA_CDP_URL";
const ENV_NODE_BIN: &str = "RAIL_NODE_BIN";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardCrawlProviderHealth {
    pub provider: String,
    pub available: bool,
    pub ready: bool,
    pub configured: bool,
    pub installed: bool,
    pub installable: bool,
    pub message: String,
    pub capabilities: Vec<String>,
    pub base_url: Option<String>,
    pub details: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardCrawlProviderFetchResult {
    pub provider: String,
    pub status: String,
    pub url: String,
    pub fetched_at: String,
    pub summary: String,
    pub content: String,
    pub markdown_path: Option<String>,
    pub json_path: Option<String>,
    pub source_meta: Value,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardCrawlProviderInstallResult {
    pub provider: String,
    pub installed: bool,
    pub configured: bool,
    pub venv_path: Option<String>,
    pub executable_path: Option<String>,
    pub log: Option<String>,
}

fn clean_line(value: impl AsRef<str>) -> String {
    value.as_ref().split_whitespace().collect::<Vec<_>>().join(" ")
}

fn trim_text(raw: &str, max: usize) -> String {
    let text = clean_line(raw);
    if text.len() <= max {
        return text;
    }
    format!("{}…", &text[..max.saturating_sub(1)])
}

fn now_iso() -> String {
    Local::now().to_rfc3339()
}

fn normalize_workspace_cwd(cwd: &str) -> Result<PathBuf, String> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Err("cwd is required".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|error| format!("failed to create cwd directory: {error}"))?;
    }
    if !path.is_dir() {
        return Err("cwd must be a directory".to_string());
    }
    Ok(path)
}

fn first_non_empty_env(keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn validate_source_url(raw: &str) -> Result<String, String> {
    let parsed = Url::parse(raw.trim()).map_err(|error| format!("invalid url: {error}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("only http/https sources are allowed".to_string());
    }
    let Some(host) = parsed.host_str() else {
        return Err("source host is missing".to_string());
    };
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".local") {
        return Err("localhost/local domains are blocked".to_string());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if ip.is_loopback() || ip.is_multicast() || ip.is_unspecified() {
            return Err("loopback/multicast/unspecified IP sources are blocked".to_string());
        }
        if is_private_ip(ip) {
            return Err("private network IP sources are blocked".to_string());
        }
    }
    Ok(parsed.to_string())
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            value.is_private()
                || value.is_link_local()
                || value.is_broadcast()
                || value.octets()[0] == 0
                || (value.octets()[0] == 100 && (64..=127).contains(&value.octets()[1]))
        }
        IpAddr::V6(value) => {
            value.is_unique_local()
                || value.is_unicast_link_local()
                || value.segments()[0] & 0xffc0 == 0xfe80
        }
    }
}

fn sanitize_file_component(raw: &str) -> String {
    let lowered = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    let collapsed = lowered
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if collapsed.is_empty() {
        "item".to_string()
    } else {
        collapsed
    }
}

fn run_command(command: &mut Command, step: &str) -> Result<String, String> {
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

fn workspace_python(workspace: &Path, env_name: &str, venv_name: &str) -> String {
    if let Some(value) = first_non_empty_env(&[env_name]) {
        return value;
    }
    let candidate = if cfg!(target_os = "windows") {
        workspace.join(format!(".rail/.venv_{venv_name}/Scripts/python.exe"))
    } else {
        workspace.join(format!(".rail/.venv_{venv_name}/bin/python"))
    };
    if candidate.is_file() {
        return candidate.to_string_lossy().to_string();
    }
    "python3".to_string()
}

fn workspace_venv_dir(workspace: &Path, venv_name: &str) -> PathBuf {
    workspace.join(format!(".rail/.venv_{venv_name}"))
}

fn python_has_module(python: &str, module_name: &str) -> bool {
    let output = Command::new(python)
        .arg("-c")
        .arg(format!(
            "import importlib.util,sys; sys.stdout.write('1' if importlib.util.find_spec({module_name:?}) else '0')"
        ))
        .output();
    let Ok(output) = output else {
        return false;
    };
    output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "1"
}

fn resolve_resource_script_path(app: &AppHandle, relative_path: &str) -> Result<PathBuf, String> {
    if let Ok(resource_path) = app.path().resolve(relative_path, BaseDirectory::Resource) {
        if resource_path.exists() {
            return Ok(resource_path);
        }
    }
    let prefixed = format!("_up_/{relative_path}");
    if let Ok(resource_path) = app.path().resolve(&prefixed, BaseDirectory::Resource) {
        if resource_path.exists() {
            return Ok(resource_path);
        }
    }
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../").join(relative_path);
    if dev_path.exists() {
        return Ok(dev_path);
    }
    Err(format!("embedded resource not found ({relative_path})"))
}

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
    for candidate in [
        PathBuf::from(format!("/opt/homebrew/bin/{binary}")),
        PathBuf::from(format!("/usr/local/bin/{binary}")),
        PathBuf::from(format!("/usr/bin/{binary}")),
    ] {
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

fn resolve_cdp_url(env_key: &str) -> Result<Option<String>, String> {
    let Some(raw) = first_non_empty_env(&[env_key]) else {
        return Ok(None);
    };
    let parsed = Url::parse(&raw).map_err(|error| format!("invalid CDP url for {env_key}: {error}"))?;
    let Some(host) = parsed.host_str() else {
        return Err(format!("CDP url host is missing for {env_key}"));
    };
    let is_localhost = host.eq_ignore_ascii_case("localhost")
        || host.parse::<IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false);
    if !is_localhost {
        return Err(format!("{env_key} must use localhost/loopback for security"));
    }
    Ok(Some(parsed.to_string()))
}

fn cdp_probe_url(raw_cdp_url: &str) -> Result<String, String> {
    let parsed = Url::parse(raw_cdp_url).map_err(|error| format!("invalid CDP url: {error}"))?;
    let scheme = match parsed.scheme() {
        "ws" => "http",
        "wss" => "https",
        "http" | "https" => parsed.scheme(),
        other => return Err(format!("unsupported CDP url scheme: {other}")),
    };
    let host = parsed.host_str().ok_or_else(|| "CDP url host is missing".to_string())?;
    let port = parsed.port().map(|value| format!(":{value}")).unwrap_or_default();
    Ok(format!("{scheme}://{host}{port}/json/version"))
}

async fn probe_cdp_endpoint(provider: &str, raw_cdp_url: &str) -> Result<Value, String> {
    let probe_url = cdp_probe_url(raw_cdp_url)?;
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_millis(DEFAULT_TIMEOUT_MS))
        .build()
        .map_err(|error| format!("failed to build {provider} health client: {error}"))?;
    let response = client
        .get(&probe_url)
        .send()
        .await
        .map_err(|error| format!("{provider} health request failed: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "{provider} health check failed ({status}): {}",
            trim_text(&body, 180)
        ));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| format!("{provider} health payload parse failed: {error}"))
}

fn provider_capabilities(provider: &str) -> Vec<String> {
    match provider {
        "scrapling" | "crawl4ai" => vec!["extract_document".to_string()],
        "steel" | "lightpanda_experimental" => vec![
            "extract_document".to_string(),
            "interactive_browser".to_string(),
            "stateful_session".to_string(),
        ],
        "browser_use" => vec!["interactive_browser".to_string()],
        "scrapy_playwright" => vec!["batch_crawl".to_string()],
        "playwright_local" => vec!["interactive_browser".to_string()],
        _ => Vec::new(),
    }
}

fn unsupported_provider_health(provider: &str, message: &str) -> DashboardCrawlProviderHealth {
    DashboardCrawlProviderHealth {
        provider: provider.to_string(),
        available: false,
        ready: false,
        configured: false,
        installed: false,
        installable: false,
        message: message.to_string(),
        capabilities: provider_capabilities(provider),
        base_url: None,
        details: json!({}),
    }
}

fn map_scrapling_health(health: crate::dashboard_crawler::DashboardScraplingBridgeHealth) -> DashboardCrawlProviderHealth {
    DashboardCrawlProviderHealth {
        provider: "scrapling".to_string(),
        available: true,
        ready: health.running && health.scrapling_ready,
        configured: true,
        installed: health.scrapling_ready,
        installable: true,
        message: health.message,
        capabilities: provider_capabilities("scrapling"),
        base_url: Some(health.base_url),
        details: json!({
            "tokenProtected": health.token_protected,
        }),
    }
}

fn crawl4ai_health(workspace: &Path) -> DashboardCrawlProviderHealth {
    let python = workspace_python(workspace, ENV_CRAWL4AI_PYTHON, "crawl4ai");
    let venv_path = workspace_venv_dir(workspace, "crawl4ai");
    let has_module = python_has_module(&python, "crawl4ai");
    DashboardCrawlProviderHealth {
        provider: "crawl4ai".to_string(),
        available: has_module,
        ready: has_module,
        configured: true,
        installed: venv_path.exists(),
        installable: true,
        message: if has_module {
            "ready".to_string()
        } else {
            "crawl4ai runtime not installed".to_string()
        },
        capabilities: provider_capabilities("crawl4ai"),
        base_url: None,
        details: json!({
            "pythonPath": python,
            "venvPath": venv_path.to_string_lossy().to_string(),
        }),
    }
}

fn install_crawl4ai(workspace: &Path) -> Result<DashboardCrawlProviderInstallResult, String> {
    let rail_dir = workspace.join(".rail");
    fs::create_dir_all(&rail_dir).map_err(|error| format!("failed to create .rail directory: {error}"))?;
    let venv_path = workspace_venv_dir(workspace, "crawl4ai");
    let python_bootstrap =
        first_non_empty_env(&[ENV_CRAWL4AI_PYTHON]).unwrap_or_else(|| "python3".to_string());
    if !venv_path.exists() {
        run_command(
            Command::new(&python_bootstrap)
                .arg("-m")
                .arg("venv")
                .arg(&venv_path),
            "crawl4ai install",
        )?;
    }
    let python_path = if cfg!(target_os = "windows") {
        venv_path.join("Scripts/python.exe")
    } else {
        venv_path.join("bin/python")
    };
    if !python_path.is_file() {
        return Err("crawl4ai install: python executable not found in venv".to_string());
    }
    let mut logs: Vec<String> = Vec::new();
    logs.push(run_command(
        Command::new(&python_path)
            .arg("-m")
            .arg("pip")
            .arg("install")
            .arg("--upgrade")
            .arg("pip"),
        "crawl4ai install",
    )?);
    logs.push(run_command(
        Command::new(&python_path)
            .arg("-m")
            .arg("pip")
            .arg("install")
            .arg("crawl4ai"),
        "crawl4ai install",
    )?);

    let setup_executable = if cfg!(target_os = "windows") {
        venv_path.join("Scripts/crawl4ai-setup.exe")
    } else {
        venv_path.join("bin/crawl4ai-setup")
    };
    if setup_executable.is_file() {
        if let Ok(output) = run_command(&mut Command::new(&setup_executable), "crawl4ai setup") {
            logs.push(output);
        }
    }

    Ok(DashboardCrawlProviderInstallResult {
        provider: "crawl4ai".to_string(),
        installed: true,
        configured: true,
        venv_path: Some(venv_path.to_string_lossy().to_string()),
        executable_path: Some(python_path.to_string_lossy().to_string()),
        log: Some(
            logs.into_iter()
                .filter(|value| !value.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n"),
        ),
    })
}

fn write_provider_artifacts(
    workspace: &Path,
    provider: &str,
    source_url: &str,
    summary: &str,
    content: &str,
    markdown: &str,
    metadata: Value,
) -> Result<(Option<String>, Option<String>), String> {
    let parsed = Url::parse(source_url).map_err(|error| format!("invalid source url: {error}"))?;
    let host = sanitize_file_component(parsed.host_str().unwrap_or("source"));
    let stamp = Local::now().format("%Y%m%d-%H%M%S-%3f").to_string();
    let base_name = format!("{provider}_{host}_{stamp}");
    let output_dir = workspace.join(".rail/studio_index/knowledge/raw").join(provider);
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("failed to create provider artifact directory: {error}"))?;

    let markdown_path = output_dir.join(format!("{base_name}.md"));
    let json_path = output_dir.join(format!("{base_name}.json"));
    let markdown_value = if markdown.trim().is_empty() {
        format!("# {}\n\n{}\n\n{}", source_url, summary, content)
    } else {
        markdown.to_string()
    };
    fs::write(&markdown_path, format!("{markdown_value}\n"))
        .map_err(|error| format!("failed to write provider markdown artifact: {error}"))?;
    fs::write(
        &json_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&json!({
                "provider": provider,
                "url": source_url,
                "fetchedAt": now_iso(),
                "summary": summary,
                "content": content,
                "metadata": metadata,
            }))
            .map_err(|error| format!("failed to serialize provider artifact json: {error}"))?
        ),
    )
    .map_err(|error| format!("failed to write provider json artifact: {error}"))?;
    Ok((
        Some(markdown_path.to_string_lossy().to_string()),
        Some(json_path.to_string_lossy().to_string()),
    ))
}

fn parse_json_output(output: std::process::Output, step: &str) -> Result<Value, String> {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        let message = if stderr.is_empty() { stdout } else { stderr };
        return Err(format!("{step}: {}", trim_text(&message, 420)));
    }
    serde_json::from_str(&stdout)
        .map_err(|error| format!("{step}: failed to parse json output: {error}"))
}

fn fetch_with_crawl4ai(
    app: &AppHandle,
    workspace: &Path,
    url: &str,
) -> Result<DashboardCrawlProviderFetchResult, String> {
    let python = workspace_python(workspace, ENV_CRAWL4AI_PYTHON, "crawl4ai");
    if !python_has_module(&python, "crawl4ai") {
        let _ = install_crawl4ai(workspace)?;
    }
    let script_path = resolve_resource_script_path(app, "scripts/crawl_providers/crawl4ai_fetch.py")?;
    let output = Command::new(&python)
        .arg(script_path)
        .arg("--url")
        .arg(url)
        .current_dir(workspace)
        .output()
        .map_err(|error| format!("crawl4ai fetch: failed to execute runtime ({error})"))?;
    let payload = parse_json_output(output, "crawl4ai fetch")?;
    let summary = trim_text(payload.get("summary").and_then(Value::as_str).unwrap_or(""), 480);
    let content = trim_text(payload.get("content").and_then(Value::as_str).unwrap_or(""), 12_000);
    let markdown = payload.get("markdown").and_then(Value::as_str).unwrap_or("");
    let metadata = payload.get("metadata").cloned().unwrap_or_else(|| json!({}));
    let (markdown_path, json_path) =
        write_provider_artifacts(workspace, "crawl4ai", url, &summary, &content, markdown, metadata.clone())?;
    Ok(DashboardCrawlProviderFetchResult {
        provider: "crawl4ai".to_string(),
        status: "ok".to_string(),
        url: payload
            .get("url")
            .and_then(Value::as_str)
            .map(|value| value.to_string())
            .unwrap_or_else(|| url.to_string()),
        fetched_at: now_iso(),
        summary,
        content,
        markdown_path,
        json_path,
        source_meta: metadata,
        error: None,
    })
}

async fn cdp_provider_health(provider: &str, env_key: &str) -> Result<DashboardCrawlProviderHealth, String> {
    let Some(cdp_url) = resolve_cdp_url(env_key)? else {
        return Ok(unsupported_provider_health(
            provider,
            &format!("{provider} CDP endpoint is not configured"),
        ));
    };
    match probe_cdp_endpoint(provider, &cdp_url).await {
        Ok(details) => Ok(DashboardCrawlProviderHealth {
            provider: provider.to_string(),
            available: true,
            ready: true,
            configured: true,
            installed: false,
            installable: false,
            message: "ready".to_string(),
            capabilities: provider_capabilities(provider),
            base_url: Some(cdp_url),
            details,
        }),
        Err(error) => Ok(DashboardCrawlProviderHealth {
            provider: provider.to_string(),
            available: true,
            ready: false,
            configured: true,
            installed: false,
            installable: false,
            message: error,
            capabilities: provider_capabilities(provider),
            base_url: Some(cdp_url),
            details: json!({}),
        }),
    }
}

fn fetch_with_cdp_provider(
    app: &AppHandle,
    workspace: &Path,
    provider: &str,
    env_key: &str,
    url: &str,
) -> Result<DashboardCrawlProviderFetchResult, String> {
    let cdp_url = resolve_cdp_url(env_key)?
        .ok_or_else(|| format!("{provider} CDP endpoint is not configured"))?;
    let node = resolve_executable("node", ENV_NODE_BIN)?;
    let script_path = resolve_resource_script_path(app, "scripts/crawl_providers/cdp_extract.mjs")?;
    let output = Command::new(&node)
        .arg(script_path)
        .arg("--provider")
        .arg(provider)
        .arg("--cdp-url")
        .arg(&cdp_url)
        .arg("--url")
        .arg(url)
        .current_dir(workspace)
        .output()
        .map_err(|error| format!("{provider} fetch: failed to execute node runtime ({error})"))?;
    let payload = parse_json_output(output, &format!("{provider} fetch"))?;
    let summary = trim_text(payload.get("summary").and_then(Value::as_str).unwrap_or(""), 480);
    let content = trim_text(payload.get("content").and_then(Value::as_str).unwrap_or(""), 12_000);
    let markdown = payload.get("markdown").and_then(Value::as_str).unwrap_or("");
    let metadata = payload.get("metadata").cloned().unwrap_or_else(|| json!({}));
    let (markdown_path, json_path) =
        write_provider_artifacts(workspace, provider, url, &summary, &content, markdown, metadata.clone())?;
    Ok(DashboardCrawlProviderFetchResult {
        provider: provider.to_string(),
        status: "ok".to_string(),
        url: payload
            .get("url")
            .and_then(Value::as_str)
            .map(|value| value.to_string())
            .unwrap_or_else(|| url.to_string()),
        fetched_at: now_iso(),
        summary,
        content,
        markdown_path,
        json_path,
        source_meta: metadata,
        error: None,
    })
}

#[tauri::command]
pub async fn dashboard_crawl_provider_health(
    _app: AppHandle,
    cwd: Option<String>,
    provider: String,
) -> Result<DashboardCrawlProviderHealth, String> {
    let provider = clean_line(&provider).to_lowercase();
    match provider.as_str() {
        "scrapling" => {
            let health = crate::dashboard_crawler::dashboard_scrapling_bridge_start(cwd).await?;
            Ok(map_scrapling_health(health))
        }
        "crawl4ai" => {
            let workspace = normalize_workspace_cwd(cwd.as_deref().unwrap_or("."))?;
            Ok(crawl4ai_health(&workspace))
        }
        "steel" => cdp_provider_health("steel", ENV_STEEL_CDP_URL).await,
        "lightpanda_experimental" => {
            cdp_provider_health("lightpanda_experimental", ENV_LIGHTPANDA_CDP_URL).await
        }
        "browser_use" => Ok(unsupported_provider_health(
            "browser_use",
            "browser_use provider registry slot is reserved but not wired yet",
        )),
        "scrapy_playwright" => Ok(unsupported_provider_health(
            "scrapy_playwright",
            "scrapy_playwright provider registry slot is reserved but not wired yet",
        )),
        "playwright_local" => Ok(unsupported_provider_health(
            "playwright_local",
            "playwright_local provider slot is reserved for future browser extraction wiring",
        )),
        _ => Err(format!("unsupported crawl provider: {provider}")),
    }
}

#[tauri::command]
pub fn dashboard_crawl_provider_install(
    _app: AppHandle,
    cwd: String,
    provider: String,
) -> Result<DashboardCrawlProviderInstallResult, String> {
    let workspace = normalize_workspace_cwd(&cwd)?;
    let provider = clean_line(&provider).to_lowercase();
    match provider.as_str() {
        "scrapling" => {
            let value = crate::dashboard_crawler::dashboard_scrapling_bridge_install(cwd)?;
            Ok(DashboardCrawlProviderInstallResult {
                provider,
                installed: value
                    .get("installed")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                configured: true,
                venv_path: value
                    .get("venvPath")
                    .and_then(Value::as_str)
                    .map(|value| value.to_string()),
                executable_path: value
                    .get("pythonPath")
                    .and_then(Value::as_str)
                    .map(|value| value.to_string()),
                log: value.get("log").and_then(Value::as_str).map(|value| value.to_string()),
            })
        }
        "crawl4ai" => install_crawl4ai(&workspace),
        "steel" | "lightpanda_experimental" | "browser_use" | "scrapy_playwright" | "playwright_local" => Err(format!(
            "{provider} does not support in-app installation; configure the external runtime separately"
        )),
        _ => Err(format!("unsupported crawl provider: {provider}")),
    }
}

#[tauri::command]
pub async fn dashboard_crawl_provider_fetch_url(
    app: AppHandle,
    cwd: String,
    provider: String,
    url: String,
    topic: Option<String>,
) -> Result<DashboardCrawlProviderFetchResult, String> {
    let workspace = normalize_workspace_cwd(&cwd)?;
    let provider = clean_line(&provider).to_lowercase();
    let normalized_url = validate_source_url(&url)?;
    match provider.as_str() {
        "scrapling" => {
            let result =
                crate::dashboard_crawler::dashboard_scrapling_fetch_url(cwd, normalized_url, topic).await?;
            Ok(DashboardCrawlProviderFetchResult {
                provider: "scrapling".to_string(),
                status: "ok".to_string(),
                url: result.url,
                fetched_at: result.fetched_at,
                summary: result.summary,
                content: result.content,
                markdown_path: Some(result.markdown_path),
                json_path: Some(result.json_path),
                source_meta: json!({
                    "topic": result.topic,
                    "bytes": result.bytes,
                    "format": result.format,
                    "httpStatus": result.http_status,
                }),
                error: None,
            })
        }
        "crawl4ai" => fetch_with_crawl4ai(&app, &workspace, &normalized_url),
        "steel" => fetch_with_cdp_provider(&app, &workspace, "steel", ENV_STEEL_CDP_URL, &normalized_url),
        "lightpanda_experimental" => fetch_with_cdp_provider(
            &app,
            &workspace,
            "lightpanda_experimental",
            ENV_LIGHTPANDA_CDP_URL,
            &normalized_url,
        ),
        "browser_use" | "scrapy_playwright" | "playwright_local" => Err(format!(
            "{provider} fetch is not wired yet; use provider health metadata for capability routing"
        )),
        _ => Err(format!("unsupported crawl provider: {provider}")),
    }
}
