use chrono::Local;
use reqwest::Client;
use roxmltree::Document;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeSet, HashMap},
    fs,
    net::IpAddr,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use url::Url;

const DEFAULT_TIMEOUT_MS: u64 = 15_000;
const DEFAULT_MAX_SOURCES_PER_TOPIC: usize = 8;
const MAX_MAX_SOURCES_PER_TOPIC: usize = 40;
const MAX_BODY_CHARS: usize = 80_000;
const MAX_SUMMARY_CHARS: usize = 1_200;
const MAX_CONTENT_CHARS: usize = 12_000;
const MAX_RSS_ITEMS: usize = 8;
const USER_AGENT: &str = "RAIL-Dashboard-Crawler/1.0";
const SCRAPLING_DEFAULT_BASE_URL: &str = "http://127.0.0.1:9871";
const ENV_SCRAPLING_BASE_URL: &str = "RAIL_SCRAPLING_BRIDGE_URL";
const ENV_SCRAPLING_TOKEN: &str = "RAIL_SCRAPLING_BRIDGE_TOKEN";
const ENV_SCRAPLING_PYTHON: &str = "RAIL_SCRAPLING_PYTHON";
const ENV_SCRAPLING_DISABLE: &str = "RAIL_SCRAPLING_DISABLE";
const ENV_SCRAPLING_AUTO_INSTALL: &str = "RAIL_SCRAPLING_AUTO_INSTALL";
const DEFAULT_SCRAPLING_HEALTH_RETRY: usize = 20;
const DEFAULT_SCRAPLING_FETCH_TIMEOUT_MS: u64 = 20_000;

const TOPIC_IDS: [&str; 9] = [
    "marketSummary",
    "globalHeadlines",
    "industryTrendRadar",
    "communityHotTopics",
    "devCommunityHotTopics",
    "paperResearch",
    "eventCalendar",
    "riskAlertBoard",
    "devEcosystem",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardCrawlRequest {
    pub cwd: String,
    pub topics: Option<Vec<String>>,
    pub max_sources_per_topic: Option<usize>,
    pub request_timeout_ms: Option<u64>,
    pub allowlist_by_topic: Option<HashMap<String, Vec<String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardTopicCrawlResult {
    pub topic: String,
    pub fetched_count: usize,
    pub saved_files: Vec<String>,
    pub errors: Vec<String>,
    pub source_results: Vec<DashboardSourceCrawlResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardCrawlRunResult {
    pub started_at: String,
    pub finished_at: String,
    pub total_fetched: usize,
    pub total_files: usize,
    pub topics: Vec<DashboardTopicCrawlResult>,
    pub bridge: DashboardScraplingBridgeHealth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSourceCrawlResult {
    pub url: String,
    pub status: String,
    pub http_status: Option<u16>,
    pub error: Option<String>,
    pub bytes: usize,
    pub fetched_at: String,
    pub format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardScraplingBridgeHealth {
    pub running: bool,
    pub base_url: String,
    pub token_protected: bool,
    pub scrapling_ready: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardScraplingFetchResult {
    pub topic: String,
    pub url: String,
    pub fetched_at: String,
    pub format: String,
    pub summary: String,
    pub content: String,
    pub markdown_path: String,
    pub json_path: String,
    pub bytes: usize,
    pub http_status: Option<u16>,
}

#[derive(Debug, Clone)]
struct SourceDocument {
    markdown: String,
    json_payload: Value,
    format: String,
    bytes: usize,
    http_status: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParsedFeedItem {
    title: String,
    link: String,
    published_at: Option<String>,
    summary: Option<String>,
}

#[derive(Debug, Clone)]
struct ScraplingConfig {
    base_url: String,
    bridge_token: Option<String>,
}

#[derive(Debug)]
struct ScraplingBridgeRuntime {
    child: Option<Child>,
    base_url: String,
    bridge_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardAgenticRunSummary {
    pub run_id: String,
    pub topic: Option<String>,
    pub set_id: Option<String>,
    pub source_tab: Option<String>,
    pub status: String,
    pub updated_at: String,
    pub error_stage: Option<String>,
    pub error_message: Option<String>,
}

static SCRAPLING_BRIDGE_RUNTIME: OnceLock<Mutex<ScraplingBridgeRuntime>> = OnceLock::new();

fn bridge_runtime() -> &'static Mutex<ScraplingBridgeRuntime> {
    SCRAPLING_BRIDGE_RUNTIME.get_or_init(|| {
        Mutex::new(ScraplingBridgeRuntime {
            child: None,
            base_url: SCRAPLING_DEFAULT_BASE_URL.to_string(),
            bridge_token: None,
        })
    })
}

#[tauri::command]
pub async fn dashboard_crawl_run(
    cwd: String,
    topics: Option<Vec<String>>,
    max_sources_per_topic: Option<usize>,
    request_timeout_ms: Option<u64>,
    allowlist_by_topic: Option<HashMap<String, Vec<String>>>,
) -> Result<DashboardCrawlRunResult, String> {
    run_dashboard_crawl(DashboardCrawlRequest {
        cwd,
        topics,
        max_sources_per_topic,
        request_timeout_ms,
        allowlist_by_topic,
    })
    .await
}

#[tauri::command]
pub async fn dashboard_scrapling_bridge_health() -> Result<DashboardScraplingBridgeHealth, String> {
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_millis(4_000))
        .build()
        .map_err(|err| format!("failed to build health client: {err}"))?;
    resolve_scrapling_health(&client).await
}

#[tauri::command]
pub async fn dashboard_scrapling_bridge_start(
    cwd: Option<String>,
) -> Result<DashboardScraplingBridgeHealth, String> {
    let workspace = cwd
        .as_ref()
        .map(|value| normalize_workspace_cwd(value))
        .transpose()?;
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_millis(4_000))
        .build()
        .map_err(|err| format!("failed to build bridge client: {err}"))?;
    ensure_scrapling_bridge_running(workspace.as_ref(), &client).await
}

#[tauri::command]
pub fn dashboard_scrapling_bridge_install(cwd: String) -> Result<Value, String> {
    let workspace = normalize_workspace_cwd(&cwd)?;
    let result = install_scrapling_bridge_dependencies(&workspace)?;
    Ok(json!({
        "installed": true,
        "venvPath": result.venv_path,
        "pythonPath": result.python_path,
        "log": result.log,
    }))
}

#[tauri::command]
pub fn dashboard_scrapling_bridge_stop() -> Result<DashboardScraplingBridgeHealth, String> {
    stop_scrapling_bridge_process();
    Ok(DashboardScraplingBridgeHealth {
        running: false,
        base_url: runtime_bridge_base_url(),
        token_protected: runtime_bridge_has_token(),
        scrapling_ready: false,
        message: "stopped".to_string(),
    })
}

#[tauri::command]
pub async fn dashboard_scrapling_fetch_url(
    cwd: String,
    url: String,
    topic: Option<String>,
) -> Result<DashboardScraplingFetchResult, String> {
    let workspace = normalize_workspace_cwd(&cwd)?;
    let topic_id = topic
        .as_deref()
        .and_then(normalize_topic_id)
        .unwrap_or("devEcosystem");
    let source_url = normalize_source_url(&url);
    validate_source_url(&source_url)?;

    let client = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_millis(DEFAULT_TIMEOUT_MS))
        .build()
        .map_err(|err| format!("failed to build crawler client: {err}"))?;

    let health = ensure_scrapling_bridge_running(Some(&workspace), &client).await?;
    if !(health.running && health.scrapling_ready) {
        return Err("scrapling bridge is not ready".to_string());
    }

    let scrapling_config = ScraplingConfig {
        base_url: health.base_url,
        bridge_token: resolve_runtime_bridge_token(),
    };
    let document =
        fetch_source_document(&client, topic_id, &source_url, Some(&scrapling_config)).await?;

    let stamp = now_epoch_millis();
    let date = now_date_yyyymmdd();
    let event_label = sanitize_filename_segment(topic_event_label(topic_id));
    let source_slug = slugify_source(&source_url);
    let raw_dir = workspace.join(".rail/studio_index/knowledge/raw");
    fs::create_dir_all(&raw_dir)
        .map_err(|err| format!("failed to create knowledge raw directory: {err}"))?;
    let markdown_path = raw_dir.join(format!("{stamp}_{date}_{event_label}_{source_slug}.md"));
    let json_path = raw_dir.join(format!("{stamp}_{date}_{event_label}_{source_slug}.json"));
    let fetched_at = now_iso8601_like();

    fs::write(&markdown_path, &document.markdown)
        .map_err(|err| format!("failed to write scraped markdown: {err}"))?;
    let json_payload = serde_json::to_string_pretty(&document.json_payload)
        .map_err(|err| format!("failed to serialize scraped payload: {err}"))?;
    fs::write(&json_path, json_payload)
        .map_err(|err| format!("failed to write scraped payload: {err}"))?;

    let summary = document
        .json_payload
        .get("summary")
        .and_then(Value::as_str)
        .map(|value| truncate_chars(value, MAX_SUMMARY_CHARS))
        .unwrap_or_else(|| extract_text_preview(&document.markdown, MAX_SUMMARY_CHARS));
    let content = document
        .json_payload
        .get("content")
        .and_then(Value::as_str)
        .map(|value| truncate_chars(value, MAX_CONTENT_CHARS))
        .unwrap_or_else(|| extract_text_preview(&document.markdown, MAX_CONTENT_CHARS));

    Ok(DashboardScraplingFetchResult {
        topic: topic_id.to_string(),
        url: source_url,
        fetched_at,
        format: document.format,
        summary,
        content,
        markdown_path: markdown_path.to_string_lossy().to_string(),
        json_path: json_path.to_string_lossy().to_string(),
        bytes: document.bytes,
        http_status: document.http_status,
    })
}

#[tauri::command]
pub fn dashboard_snapshot_save(
    cwd: String,
    topic: String,
    snapshot_json: Value,
) -> Result<String, String> {
    let workspace = normalize_workspace_cwd(&cwd)?;
    let topic_id = normalize_topic_id(&topic).ok_or_else(|| format!("invalid topic: {topic}"))?;
    let snapshot_dir = workspace.join(".rail/dashboard/snapshots").join(topic_id);
    fs::create_dir_all(&snapshot_dir)
        .map_err(|err| format!("failed to create snapshot directory: {err}"))?;
    let stamp = now_epoch_millis();
    let date = now_date_yyyymmdd();
    let event_label = sanitize_filename_segment(topic_event_label(topic_id));
    let file_path = snapshot_dir.join(format!("{stamp}_{date}_{event_label}.json"));
    let body = serde_json::to_string_pretty(&snapshot_json)
        .map_err(|err| format!("failed to serialize snapshot: {err}"))?;
    fs::write(&file_path, body).map_err(|err| format!("failed to save snapshot: {err}"))?;
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn dashboard_snapshot_list(cwd: String) -> Result<Vec<Value>, String> {
    let workspace = normalize_workspace_cwd(&cwd)?;
    let root = workspace.join(".rail/dashboard/snapshots");
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut out: Vec<Value> = Vec::new();
    for topic in TOPIC_IDS {
        let topic_dir = root.join(topic);
        if !topic_dir.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&topic_dir)
            .map_err(|err| format!("failed to list snapshots for {topic}: {err}"))?
        {
            let entry = entry.map_err(|err| format!("failed to read snapshot entry: {err}"))?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            let raw = match fs::read_to_string(&path) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let mut parsed: Value = match serde_json::from_str(&raw) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if let Some(obj) = parsed.as_object_mut() {
                obj.insert("topic".to_string(), json!(topic));
                obj.insert(
                    "path".to_string(),
                    Value::String(path.to_string_lossy().to_string()),
                );
                out.push(Value::Object(obj.clone()));
            }
        }
    }
    out.sort_by(|left, right| {
        let left_time = left
            .get("generatedAt")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let right_time = right
            .get("generatedAt")
            .and_then(Value::as_str)
            .unwrap_or_default();
        right_time.cmp(left_time)
    });
    Ok(out)
}

#[tauri::command]
pub fn dashboard_snapshot_delete(
    cwd: String,
    run_id: Option<String>,
    path: Option<String>,
) -> Result<usize, String> {
    let workspace = normalize_workspace_cwd(&cwd)?;
    let snapshot_root = workspace.join(".rail/dashboard/snapshots");
    if !snapshot_root.exists() {
        return Ok(0);
    }

    let canonical_root = fs::canonicalize(&snapshot_root)
        .map_err(|err| format!("failed to resolve snapshot root: {err}"))?;
    let normalized_run_id = run_id
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let normalized_path = path
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let mut targets: BTreeSet<PathBuf> = BTreeSet::new();

    if let Some(raw_path) = normalized_path {
        let requested = PathBuf::from(raw_path);
        let resolved = if requested.is_absolute() {
            requested
        } else {
            workspace.join(requested)
        };
        if resolved.is_file() {
            let canonical = fs::canonicalize(&resolved)
                .map_err(|err| format!("failed to resolve snapshot path: {err}"))?;
            if !canonical.starts_with(&canonical_root) {
                return Err(
                    "snapshot path is outside workspace dashboard snapshot directory".to_string(),
                );
            }
            if canonical.extension().and_then(|ext| ext.to_str()) == Some("json") {
                targets.insert(canonical);
            }
        }
    }

    if let Some(expected_run_id) = normalized_run_id {
        for topic in TOPIC_IDS {
            let topic_dir = snapshot_root.join(topic);
            if !topic_dir.is_dir() {
                continue;
            }
            for entry in fs::read_dir(&topic_dir)
                .map_err(|err| format!("failed to list snapshots for {topic}: {err}"))?
            {
                let entry = entry.map_err(|err| format!("failed to read snapshot entry: {err}"))?;
                let file_path = entry.path();
                if !file_path.is_file()
                    || file_path.extension().and_then(|ext| ext.to_str()) != Some("json")
                {
                    continue;
                }
                let raw = match fs::read_to_string(&file_path) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                let parsed: Value = match serde_json::from_str(&raw) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                let file_run_id = parsed
                    .get("runId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                if file_run_id != expected_run_id {
                    continue;
                }
                let canonical = match fs::canonicalize(&file_path) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                if canonical.starts_with(&canonical_root) {
                    targets.insert(canonical);
                }
            }
        }
    }

    let mut deleted = 0usize;
    for target in targets {
        if fs::remove_file(&target).is_ok() {
            deleted += 1;
        }
    }
    Ok(deleted)
}

#[tauri::command]
pub fn dashboard_raw_list(
    cwd: String,
    topic: String,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    let workspace = normalize_workspace_cwd(&cwd)?;
    let topic_id = normalize_topic_id(&topic).ok_or_else(|| format!("invalid topic: {topic}"))?;
    let topic_dir = workspace.join(".rail/dashboard/raw").join(topic_id);
    if !topic_dir.exists() {
        return Ok(Vec::new());
    }

    let mut paths: Vec<PathBuf> = Vec::new();
    for entry in fs::read_dir(&topic_dir)
        .map_err(|err| format!("failed to list raw files for {topic_id}: {err}"))?
    {
        let entry = entry.map_err(|err| format!("failed to read raw file entry: {err}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("json") {
            paths.push(path);
        }
    }

    paths.sort_by(|left, right| {
        right
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .cmp(
                left.file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default(),
            )
    });

    let limit = limit.unwrap_or(50).clamp(1, 500);
    Ok(paths
        .into_iter()
        .take(limit)
        .map(|path| path.to_string_lossy().to_string())
        .collect())
}

#[tauri::command]
pub fn dashboard_agentic_run_list(
    cwd: String,
    limit: Option<usize>,
) -> Result<Vec<DashboardAgenticRunSummary>, String> {
    let workspace = normalize_workspace_cwd(&cwd)?;
    let root = workspace.join(".rail/runs");
    if !root.exists() {
        return Ok(Vec::new());
    }
    let max_items = limit.unwrap_or(200).clamp(1, 1000);
    let mut rows: Vec<DashboardAgenticRunSummary> = Vec::new();
    for entry in
        fs::read_dir(&root).map_err(|err| format!("failed to list run directory: {err}"))?
    {
        let entry = entry.map_err(|err| format!("failed to read run directory entry: {err}"))?;
        let run_dir = entry.path();
        if !run_dir.is_dir() {
            continue;
        }
        let run_file = run_dir.join("run.json");
        if !run_file.is_file() {
            continue;
        }
        let raw = match fs::read_to_string(&run_file) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let parsed: Value = match serde_json::from_str(&raw) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let record = parsed
            .get("record")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let run_id = record
            .get("runId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if run_id.is_empty() {
            continue;
        }
        let status = record
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if status.is_empty() {
            continue;
        }
        let stages = parsed
            .get("stages")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let error_stage_row = stages.iter().find(|row| {
            row.get("status")
                .and_then(Value::as_str)
                .map(|value| value.eq_ignore_ascii_case("error"))
                .unwrap_or(false)
        });
        rows.push(DashboardAgenticRunSummary {
            run_id,
            topic: record
                .get("topic")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            set_id: record
                .get("setId")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            source_tab: record
                .get("sourceTab")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            status,
            updated_at: record
                .get("updatedAt")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            error_stage: error_stage_row
                .and_then(|row| row.get("stage"))
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            error_message: error_stage_row
                .and_then(|row| row.get("error").or_else(|| row.get("message")))
                .and_then(Value::as_str)
                .map(|value| truncate_chars(value, 480)),
        });
    }
    rows.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(rows.into_iter().take(max_items).collect())
}

pub async fn run_dashboard_crawl(
    request: DashboardCrawlRequest,
) -> Result<DashboardCrawlRunResult, String> {
    let workspace = normalize_workspace_cwd(&request.cwd)?;
    let selected_topics = normalize_topics(request.topics);
    let allowlist_map = build_allowlist_map(request.allowlist_by_topic);
    let max_sources_per_topic = request
        .max_sources_per_topic
        .unwrap_or(DEFAULT_MAX_SOURCES_PER_TOPIC)
        .clamp(1, MAX_MAX_SOURCES_PER_TOPIC);
    let timeout_ms = request
        .request_timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(2_500, 60_000);
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|err| format!("failed to build crawler client: {err}"))?;
    let bridge_health: DashboardScraplingBridgeHealth;
    let scrapling = if scrapling_disabled_by_env() {
        bridge_health = DashboardScraplingBridgeHealth {
            running: false,
            base_url: runtime_bridge_base_url(),
            token_protected: runtime_bridge_has_token(),
            scrapling_ready: false,
            message: "scrapling bridge disabled by env".to_string(),
        };
        None
    } else {
        match ensure_scrapling_bridge_running(Some(&workspace), &client).await {
            Ok(health) => {
                bridge_health = health.clone();
                if health.running && health.scrapling_ready {
                    Some(ScraplingConfig {
                        base_url: health.base_url.clone(),
                        bridge_token: resolve_runtime_bridge_token(),
                    })
                } else {
                    None
                }
            }
            Err(error) => {
                bridge_health = DashboardScraplingBridgeHealth {
                    running: false,
                    base_url: runtime_bridge_base_url(),
                    token_protected: runtime_bridge_has_token(),
                    scrapling_ready: false,
                    message: truncate_chars(&error, 240),
                };
                None
            }
        }
    };

    let started_at = now_iso8601_like();
    let mut topic_results: Vec<DashboardTopicCrawlResult> = Vec::new();
    let mut total_fetched = 0usize;
    let mut total_files = 0usize;

    for topic in selected_topics {
        let topic_dir = workspace.join(".rail/dashboard/raw").join(topic);
        fs::create_dir_all(&topic_dir)
            .map_err(|err| format!("failed to create raw topic directory ({topic}): {err}"))?;
        let event_label = sanitize_filename_segment(topic_event_label(topic));

        let allowlist = allowlist_map
            .get(topic)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .take(max_sources_per_topic)
            .collect::<Vec<_>>();

        let mut result = DashboardTopicCrawlResult {
            topic: topic.to_string(),
            fetched_count: 0,
            saved_files: Vec::new(),
            errors: Vec::new(),
            source_results: Vec::new(),
        };

        if allowlist.is_empty() {
            result
                .errors
                .push("allowlist is empty; configure sources in settings".to_string());
            topic_results.push(result);
            continue;
        }

        for source in allowlist {
            let source_url = normalize_source_url(&source);
            let fetched_at = now_iso8601_like();
            if let Err(err) = validate_source_url(&source_url) {
                result
                    .errors
                    .push(format!("blocked source ({source_url}): {err}"));
                result.source_results.push(DashboardSourceCrawlResult {
                    url: source_url,
                    status: "blocked".to_string(),
                    http_status: None,
                    error: Some(err),
                    bytes: 0,
                    fetched_at,
                    format: None,
                });
                continue;
            }
            match fetch_source_document(&client, topic, &source_url, scrapling.as_ref()).await {
                Ok(document) => {
                    let stamp = now_epoch_millis();
                    let date = now_date_yyyymmdd();
                    let slug = slugify_source(&source_url);
                    let md_path = topic_dir.join(format!("{stamp}_{date}_{event_label}_{slug}.md"));
                    let json_path =
                        topic_dir.join(format!("{stamp}_{date}_{event_label}_{slug}.json"));

                    if let Err(err) = fs::write(&md_path, document.markdown) {
                        result
                            .errors
                            .push(format!("{}: failed to write markdown ({err})", source_url));
                        continue;
                    }

                    let payload_body = match serde_json::to_string_pretty(&document.json_payload) {
                        Ok(body) => body,
                        Err(err) => {
                            result.errors.push(format!(
                                "{}: failed to serialize payload ({err})",
                                source_url
                            ));
                            continue;
                        }
                    };
                    if let Err(err) = fs::write(&json_path, payload_body) {
                        result.errors.push(format!(
                            "{}: failed to write payload json ({err})",
                            source_url
                        ));
                        continue;
                    }

                    result.fetched_count += 1;
                    total_fetched += 1;
                    total_files += 2;
                    result
                        .saved_files
                        .push(md_path.to_string_lossy().to_string());
                    result
                        .saved_files
                        .push(json_path.to_string_lossy().to_string());
                    result.source_results.push(DashboardSourceCrawlResult {
                        url: source_url,
                        status: "ok".to_string(),
                        http_status: document.http_status,
                        error: None,
                        bytes: document.bytes,
                        fetched_at,
                        format: Some(document.format),
                    });
                }
                Err(err) => {
                    result.errors.push(format!("{}: {err}", source_url));
                    result.source_results.push(DashboardSourceCrawlResult {
                        url: source_url,
                        status: classify_fetch_error_status(&err),
                        http_status: extract_http_status_from_error(&err),
                        error: Some(truncate_chars(&err, 360)),
                        bytes: 0,
                        fetched_at,
                        format: None,
                    });
                }
            }
        }

        topic_results.push(result);
    }

    Ok(DashboardCrawlRunResult {
        started_at,
        finished_at: now_iso8601_like(),
        total_fetched,
        total_files,
        topics: topic_results,
        bridge: bridge_health,
    })
}

fn parse_bool_env(value: &str) -> bool {
    matches!(
        value.trim().to_lowercase().as_str(),
        "1" | "true" | "yes" | "on" | "enabled"
    )
}

fn first_non_empty_env(keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| std::env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn validate_local_bridge_base_url(raw: &str) -> Result<String, String> {
    let parsed = Url::parse(raw.trim())
        .map_err(|err| format!("invalid scrapling bridge base url: {err}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("scrapling bridge base url must use http/https".to_string());
    }
    let Some(host) = parsed.host_str() else {
        return Err("scrapling bridge base url host is missing".to_string());
    };
    let is_localhost = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false);
    if !is_localhost {
        return Err(
            "scrapling bridge base url must be localhost/loopback for security".to_string(),
        );
    }
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

fn runtime_bridge_base_url() -> String {
    bridge_runtime()
        .lock()
        .map(|state| state.base_url.clone())
        .unwrap_or_else(|_| SCRAPLING_DEFAULT_BASE_URL.to_string())
}

fn runtime_bridge_has_token() -> bool {
    bridge_runtime()
        .lock()
        .map(|state| {
            state
                .bridge_token
                .as_ref()
                .map(|row| !row.is_empty())
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

fn resolve_runtime_bridge_token() -> Option<String> {
    bridge_runtime()
        .lock()
        .ok()
        .and_then(|state| state.bridge_token.clone())
}

fn generate_bridge_token() -> String {
    format!("rail-{}-{}", now_epoch_millis(), std::process::id())
}

fn resolve_bridge_base_url() -> Result<String, String> {
    let raw = first_non_empty_env(&[ENV_SCRAPLING_BASE_URL])
        .unwrap_or_else(|| SCRAPLING_DEFAULT_BASE_URL.to_string());
    validate_local_bridge_base_url(&raw)
}

fn resolve_script_path() -> Result<PathBuf, String> {
    let candidates = [
        PathBuf::from("scripts/scrapling_bridge/server.py"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/scrapling_bridge/server.py"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("scripts/scrapling_bridge/server.py"),
    ];
    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err("scrapling bridge script not found (scripts/scrapling_bridge/server.py)".to_string())
}

fn resolve_workspace_venv_python(workspace: Option<&PathBuf>) -> Option<PathBuf> {
    let workspace = workspace?;
    let mut candidates: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "windows") {
        candidates.push(workspace.join(".rail/.venv_scrapling/Scripts/python.exe"));
    } else {
        candidates.push(workspace.join(".rail/.venv_scrapling/bin/python"));
    }
    for candidate in candidates {
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn resolve_bridge_python(workspace: Option<&PathBuf>) -> String {
    if let Some(value) = first_non_empty_env(&[ENV_SCRAPLING_PYTHON]) {
        return value;
    }
    if let Some(path) = resolve_workspace_venv_python(workspace) {
        return path.to_string_lossy().to_string();
    }
    "python3".to_string()
}

fn stop_scrapling_bridge_process() {
    if let Ok(mut state) = bridge_runtime().lock() {
        if let Some(mut child) = state.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub fn shutdown_scrapling_bridge_runtime() {
    stop_scrapling_bridge_process();
}

fn scrapling_disabled_by_env() -> bool {
    std::env::var(ENV_SCRAPLING_DISABLE)
        .ok()
        .map(|value| parse_bool_env(&value))
        .unwrap_or(false)
}

struct InstallBridgeResult {
    venv_path: String,
    python_path: String,
    log: String,
}

fn run_install_command(command: &mut Command, step: &str) -> Result<String, String> {
    let output = command
        .output()
        .map_err(|err| format!("{step}: failed to execute command ({err})"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        let message = if stderr.is_empty() { stdout } else { stderr };
        return Err(format!("{step}: {}", truncate_chars(&message, 480)));
    }
    Ok(if stdout.is_empty() { stderr } else { stdout })
}

fn install_scrapling_bridge_dependencies(
    workspace: &PathBuf,
) -> Result<InstallBridgeResult, String> {
    let rail_dir = workspace.join(".rail");
    fs::create_dir_all(&rail_dir)
        .map_err(|err| format!("failed to create .rail directory: {err}"))?;
    let venv_path = rail_dir.join(".venv_scrapling");
    let python_bootstrap =
        first_non_empty_env(&[ENV_SCRAPLING_PYTHON]).unwrap_or_else(|| "python3".to_string());
    if !venv_path.exists() {
        run_install_command(
            Command::new(&python_bootstrap)
                .arg("-m")
                .arg("venv")
                .arg(&venv_path),
            "scrapling install",
        )?;
    }
    let python_path = if cfg!(target_os = "windows") {
        venv_path.join("Scripts/python.exe")
    } else {
        venv_path.join("bin/python")
    };
    if !python_path.is_file() {
        return Err("scrapling install: python executable not found in venv".to_string());
    }
    let mut logs: Vec<String> = Vec::new();
    logs.push(run_install_command(
        Command::new(&python_path)
            .arg("-m")
            .arg("pip")
            .arg("install")
            .arg("--upgrade")
            .arg("pip"),
        "scrapling install",
    )?);
    logs.push(run_install_command(
        Command::new(&python_path)
            .arg("-m")
            .arg("pip")
            .arg("install")
            .arg("scrapling"),
        "scrapling install",
    )?);
    Ok(InstallBridgeResult {
        venv_path: venv_path.to_string_lossy().to_string(),
        python_path: python_path.to_string_lossy().to_string(),
        log: logs
            .into_iter()
            .filter(|row| !row.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
    })
}

async fn resolve_scrapling_health(
    client: &Client,
) -> Result<DashboardScraplingBridgeHealth, String> {
    let (base_url, bridge_token) = {
        let state = bridge_runtime()
            .lock()
            .map_err(|_| "failed to lock scrapling bridge runtime".to_string())?;
        (state.base_url.clone(), state.bridge_token.clone())
    };
    let health_url = format!("{base_url}/health");
    let mut request = client.get(&health_url);
    if let Some(token) = bridge_token
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        request = request.header("Authorization", format!("Bearer {token}"));
    }
    let response = request
        .send()
        .await
        .map_err(|err| format!("scrapling bridge health request failed: {err}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Ok(DashboardScraplingBridgeHealth {
            running: false,
            base_url,
            token_protected: bridge_token.is_some(),
            scrapling_ready: false,
            message: format!(
                "health check failed ({status}): {}",
                truncate_chars(body.trim(), 180)
            ),
        });
    }
    let payload = response.json::<Value>().await.unwrap_or_else(|_| json!({}));
    let ready = payload
        .get("scraplingReady")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| payload.get("ok").and_then(Value::as_bool).unwrap_or(true));
    Ok(DashboardScraplingBridgeHealth {
        running: true,
        base_url,
        token_protected: bridge_token.is_some(),
        scrapling_ready: ready,
        message: "ready".to_string(),
    })
}

fn update_runtime_bridge_defaults() -> Result<(), String> {
    let base_url = resolve_bridge_base_url()?;
    let bridge_token =
        first_non_empty_env(&[ENV_SCRAPLING_TOKEN]).or_else(|| Some(generate_bridge_token()));
    let mut state = bridge_runtime()
        .lock()
        .map_err(|_| "failed to lock scrapling bridge runtime".to_string())?;
    state.base_url = base_url;
    state.bridge_token = bridge_token;
    Ok(())
}

async fn ensure_scrapling_bridge_running(
    workspace: Option<&PathBuf>,
    client: &Client,
) -> Result<DashboardScraplingBridgeHealth, String> {
    ensure_scrapling_bridge_running_inner(workspace, client, true).await
}

async fn ensure_scrapling_bridge_running_inner(
    workspace: Option<&PathBuf>,
    client: &Client,
    allow_install: bool,
) -> Result<DashboardScraplingBridgeHealth, String> {
    update_runtime_bridge_defaults()?;
    if let Ok(health) = resolve_scrapling_health(client).await {
        if health.running && health.scrapling_ready {
            return Ok(health);
        }
    }

    spawn_scrapling_bridge_process(workspace)?;
    let mut last_health_error: Option<String> = None;

    for _ in 0..DEFAULT_SCRAPLING_HEALTH_RETRY {
        match resolve_scrapling_health(client).await {
            Ok(health) => {
                if health.running && health.scrapling_ready {
                    return Ok(health);
                }
            }
            Err(error) => {
                last_health_error = Some(error);
            }
        }
        tokio::time::sleep(Duration::from_millis(180)).await;
    }

    if allow_install
        && std::env::var(ENV_SCRAPLING_AUTO_INSTALL)
            .ok()
            .map(|value| parse_bool_env(&value))
            .unwrap_or(true)
    {
        if let Some(target_workspace) = workspace {
            if install_scrapling_bridge_dependencies(target_workspace).is_ok() {
                stop_scrapling_bridge_process();
                {
                    let mut state = bridge_runtime()
                        .lock()
                        .map_err(|_| "failed to lock scrapling bridge runtime".to_string())?;
                    state.child = None;
                }
                spawn_scrapling_bridge_process(workspace)?;
                for _ in 0..DEFAULT_SCRAPLING_HEALTH_RETRY {
                    match resolve_scrapling_health(client).await {
                        Ok(health) => {
                            if health.running && health.scrapling_ready {
                                return Ok(health);
                            }
                        }
                        Err(error) => {
                            last_health_error = Some(error);
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(180)).await;
                }
            }
        }
    }

    match resolve_scrapling_health(client).await {
        Ok(health) => Ok(health),
        Err(final_error) => {
            if let Some(previous_error) = last_health_error {
                Err(format!("{previous_error}; final health check failed: {final_error}"))
            } else {
                Err(final_error)
            }
        }
    }
}

fn spawn_scrapling_bridge_process(workspace: Option<&PathBuf>) -> Result<(), String> {
    let script_path = resolve_script_path()?;
    let base_url = resolve_bridge_base_url()?;
    let parsed =
        Url::parse(&base_url).map_err(|err| format!("invalid scrapling bridge url: {err}"))?;
    let host = parsed.host_str().unwrap_or("127.0.0.1").to_string();
    let port = parsed.port_or_known_default().unwrap_or(9871).to_string();
    let python = resolve_bridge_python(workspace);
    let bridge_token =
        first_non_empty_env(&[ENV_SCRAPLING_TOKEN]).or_else(|| Some(generate_bridge_token()));

    let mut state = bridge_runtime()
        .lock()
        .map_err(|_| "failed to lock scrapling bridge runtime".to_string())?;
    if let Some(child) = state.child.as_mut() {
        if child.try_wait().ok().flatten().is_some() {
            state.child = None;
        }
    }
    if state.child.is_some() {
        return Ok(());
    }

    let mut command = Command::new(&python);
    command
        .arg(script_path)
        .arg("--host")
        .arg(&host)
        .arg("--port")
        .arg(&port)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(token) = bridge_token
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        command.env(ENV_SCRAPLING_TOKEN, token);
    }
    let child = command
        .spawn()
        .map_err(|err| format!("failed to start scrapling bridge process: {err}"))?;
    state.child = Some(child);
    state.base_url = base_url;
    state.bridge_token = bridge_token;
    Ok(())
}

fn validate_source_url(raw: &str) -> Result<(), String> {
    let parsed = Url::parse(raw).map_err(|err| format!("invalid url: {err}"))?;
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
    Ok(())
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

fn normalize_workspace_cwd(cwd: &str) -> Result<PathBuf, String> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Err("cwd is required".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.exists() {
        fs::create_dir_all(&path)
            .map_err(|err| format!("failed to create cwd directory: {err}"))?;
    }
    if !path.is_dir() {
        return Err("cwd must be a directory".to_string());
    }
    Ok(path)
}

fn normalize_topics(topics: Option<Vec<String>>) -> Vec<&'static str> {
    let Some(items) = topics else {
        return TOPIC_IDS.to_vec();
    };
    let selected = items
        .iter()
        .filter_map(|item| normalize_topic_id(item))
        .collect::<BTreeSet<_>>();
    if selected.is_empty() {
        return TOPIC_IDS.to_vec();
    }
    TOPIC_IDS
        .iter()
        .copied()
        .filter(|topic| selected.contains(topic))
        .collect()
}

fn normalize_topic_id(raw: &str) -> Option<&'static str> {
    let trimmed = raw.trim();
    TOPIC_IDS
        .iter()
        .copied()
        .find(|topic| topic.eq_ignore_ascii_case(trimmed))
}

fn build_allowlist_map(
    custom: Option<HashMap<String, Vec<String>>>,
) -> HashMap<&'static str, Vec<String>> {
    let defaults = default_allowlist_map();
    let Some(input) = custom else {
        return defaults;
    };

    let mut out: HashMap<&'static str, Vec<String>> = HashMap::new();
    for topic in TOPIC_IDS {
        let custom_values = input.iter().find_map(|(key, values)| {
            normalize_topic_id(key)
                .filter(|k| *k == topic)
                .map(|_| values.clone())
        });
        let source_values =
            custom_values.unwrap_or_else(|| defaults.get(topic).cloned().unwrap_or_default());
        let normalized = source_values
            .into_iter()
            .map(|row| row.trim().to_lowercase())
            .filter(|row| !row.is_empty())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        out.insert(topic, normalized);
    }
    out
}

fn default_allowlist_map() -> HashMap<&'static str, Vec<String>> {
    HashMap::from([
        (
            "marketSummary",
            vec![
                "finance.yahoo.com".to_string(),
                "stooq.com".to_string(),
                "investing.com".to_string(),
            ],
        ),
        (
            "globalHeadlines",
            vec![
                "apnews.com/hub/apf-topnews?output=rss".to_string(),
                "feeds.bbci.co.uk/news/world/rss.xml".to_string(),
                "rss.nytimes.com/services/xml/rss/nyt/world.xml".to_string(),
                "theguardian.com/world/rss".to_string(),
                "aljazeera.com/xml/rss/all.xml".to_string(),
                "npr.org/rss/rss.php?id=1004".to_string(),
                "dw.com/en/top-stories/s-9097".to_string(),
                "straitstimes.com/global/rss.xml".to_string(),
            ],
        ),
        (
            "industryTrendRadar",
            vec![
                "mckinsey.com".to_string(),
                "gartner.com".to_string(),
                "cbinsights.com".to_string(),
                "statista.com".to_string(),
            ],
        ),
        (
            "communityHotTopics",
            vec![
                "reddit.com".to_string(),
                "dcinside.com".to_string(),
                "x.com".to_string(),
                "tieba.baidu.com".to_string(),
                "zhihu.com".to_string(),
                "weibo.com".to_string(),
                "5ch.net".to_string(),
            ],
        ),
        (
            "devCommunityHotTopics",
            vec![
                "news.ycombinator.com".to_string(),
                "github.com".to_string(),
                "stackoverflow.com".to_string(),
                "dev.to".to_string(),
                "hashnode.com".to_string(),
                "lobste.rs".to_string(),
                "csdn.net".to_string(),
                "juejin.cn".to_string(),
                "qiita.com".to_string(),
                "zenn.dev".to_string(),
                "reddit.com".to_string(),
                "x.com".to_string(),
                "threads.net".to_string(),
            ],
        ),
        (
            "paperResearch",
            vec![
                "arxiv.org".to_string(),
                "openreview.net".to_string(),
                "pubmed.ncbi.nlm.nih.gov".to_string(),
                "ieeexplore.ieee.org".to_string(),
                "dl.acm.org".to_string(),
                "nature.com".to_string(),
                "science.org".to_string(),
                "springer.com".to_string(),
                "sciencedirect.com".to_string(),
                "ssrn.com".to_string(),
            ],
        ),
        (
            "eventCalendar",
            vec![
                "federalreserve.gov".to_string(),
                "imf.org".to_string(),
                "sec.gov".to_string(),
                "coinmarketcal.com".to_string(),
            ],
        ),
        (
            "riskAlertBoard",
            vec![
                "sec.gov".to_string(),
                "cisa.gov".to_string(),
                "owasp.org".to_string(),
                "krebsonsecurity.com".to_string(),
            ],
        ),
        (
            "devEcosystem",
            vec![
                "github.blog".to_string(),
                "nodejs.org".to_string(),
                "python.org".to_string(),
                "react.dev".to_string(),
            ],
        ),
    ])
}

async fn fetch_source_document(
    client: &Client,
    topic: &str,
    url: &str,
    scrapling: Option<&ScraplingConfig>,
) -> Result<SourceDocument, String> {
    if let Some(config) = scrapling {
        match fetch_source_document_with_scrapling(client, topic, url, config).await {
            Ok(document) => return Ok(document),
            Err(err) => {
                let fallback = fetch_source_document_with_reqwest(client, topic, url).await;
                if let Ok(value) = fallback {
                    return Ok(value);
                }
                return Err(format!("scrapling failed ({err})"));
            }
        }
    }
    fetch_source_document_with_reqwest(client, topic, url).await
}

async fn fetch_source_document_with_reqwest(
    client: &Client,
    topic: &str,
    url: &str,
) -> Result<SourceDocument, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|err| format!("request failed: {err}"))?;
    if !response.status().is_success() {
        return Err(format!("http status {}", response.status()));
    }
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("text/plain")
        .to_string();
    let body = response
        .text()
        .await
        .map_err(|err| format!("failed to read body: {err}"))?;
    let trimmed = truncate_chars(&body, MAX_BODY_CHARS);
    let fetched_at = now_iso8601_like();

    if content_type.contains("xml") || looks_like_xml(&trimmed) {
        let rss_items = parse_rss_items(&trimmed);
        let markdown = build_rss_markdown(url, topic, &fetched_at, &rss_items);
        return Ok(SourceDocument {
            markdown,
            json_payload: json!({
                "topic": topic,
                "url": url,
                "contentType": content_type,
                "fetchedAt": fetched_at,
                "format": "rss",
                "items": rss_items,
            }),
            format: "rss".to_string(),
            bytes: body.len(),
            http_status: Some(200),
        });
    }

    if content_type.contains("json") || looks_like_json(&trimmed) {
        let parsed =
            serde_json::from_str::<Value>(&trimmed).unwrap_or_else(|_| json!({ "raw": trimmed }));
        let content = truncate_chars(&value_to_summary_text(&parsed), MAX_CONTENT_CHARS);
        let summary = truncate_chars(&content, MAX_SUMMARY_CHARS);
        let markdown = format!(
            "# Source Capture\n\n- Topic: {topic}\n- URL: {url}\n- Fetched: {fetched_at}\n- Type: JSON\n\n## Summary\n\n{summary}\n\n## Content\n\n{content}\n"
        );
        return Ok(SourceDocument {
            markdown,
            json_payload: json!({
                "topic": topic,
                "url": url,
                "contentType": content_type,
                "fetchedAt": fetched_at,
                "format": "json",
                "summary": summary,
                "content": content,
                "payload": parsed,
            }),
            format: "json".to_string(),
            bytes: body.len(),
            http_status: Some(200),
        });
    }

    let title = extract_html_title(&trimmed).unwrap_or_else(|| url.to_string());
    let summary = extract_meta_description(&trimmed)
        .unwrap_or_else(|| extract_text_preview(&trimmed, MAX_SUMMARY_CHARS));
    let content = extract_text_preview(&trimmed, MAX_CONTENT_CHARS);
    let markdown = format!(
        "# {title}\n\n- Topic: {topic}\n- URL: {url}\n- Fetched: {fetched_at}\n- Type: HTML\n\n## Summary\n\n{summary}\n\n## Content\n\n{content}\n"
    );
    Ok(SourceDocument {
        markdown,
        json_payload: json!({
            "topic": topic,
            "url": url,
            "contentType": content_type,
            "fetchedAt": fetched_at,
            "format": "html",
            "title": title,
            "summary": summary,
            "content": content,
        }),
        format: "html".to_string(),
        bytes: body.len(),
        http_status: Some(200),
    })
}

async fn fetch_source_document_with_scrapling(
    client: &Client,
    topic: &str,
    url: &str,
    config: &ScraplingConfig,
) -> Result<SourceDocument, String> {
    let fetched_at = now_iso8601_like();
    let fetch_url = format!("{}/fetch", config.base_url);
    let mut request = client.post(&fetch_url);
    if let Some(token) = &config.bridge_token {
        request = request.header("Authorization", format!("Bearer {token}"));
    }
    let response = request
        .json(&json!({
            "url": url,
            "timeoutMs": DEFAULT_SCRAPLING_FETCH_TIMEOUT_MS,
            "maxChars": MAX_CONTENT_CHARS
        }))
        .send()
        .await
        .map_err(|err| format!("scrapling fetch request failed: {err}"))?;
    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|err| format!("scrapling fetch payload parse failed: {err}"))?;
    if !status.is_success() {
        let message = payload
            .get("error")
            .and_then(Value::as_str)
            .map(|value| truncate_chars(value, 240))
            .unwrap_or_else(|| "bridge request failed".to_string());
        let error_code = payload
            .get("errorCode")
            .and_then(Value::as_str)
            .unwrap_or("SCRAPLING_FAILED");
        return Err(format!("{error_code}: {message}"));
    }

    let content = payload
        .get("content")
        .and_then(Value::as_str)
        .map(|value| truncate_chars(value, MAX_CONTENT_CHARS))
        .unwrap_or_default();
    if content.trim().is_empty() {
        return Err("SCRAPLING_EMPTY: bridge returned empty content".to_string());
    }
    let summary = payload
        .get("summary")
        .and_then(Value::as_str)
        .map(|value| truncate_chars(value, MAX_SUMMARY_CHARS))
        .unwrap_or_else(|| extract_text_preview(&content, MAX_SUMMARY_CHARS));
    let title = payload
        .get("title")
        .and_then(Value::as_str)
        .map(|value| truncate_chars(value, 240))
        .unwrap_or_else(|| url.to_string());
    let content_type = payload
        .get("contentType")
        .and_then(Value::as_str)
        .unwrap_or("text/plain");
    let http_status = payload
        .get("httpStatus")
        .and_then(Value::as_u64)
        .and_then(|value| u16::try_from(value).ok());
    let bytes = payload
        .get("bytes")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or_else(|| content.len());
    let markdown = format!(
        "# {title}\n\n- Topic: {topic}\n- URL: {url}\n- Fetched: {fetched_at}\n- Type: SCRAPLING\n\n## Summary\n\n{summary}\n\n## Content\n\n{content}\n"
    );
    Ok(SourceDocument {
        markdown,
        json_payload: json!({
            "topic": topic,
            "url": url,
            "fetchedAt": fetched_at,
            "format": "scrapling",
            "summary": summary,
            "content": content,
            "contentType": content_type,
            "title": title,
            "httpStatus": http_status,
        }),
        format: "scrapling".to_string(),
        bytes,
        http_status,
    })
}

fn classify_fetch_error_status(error: &str) -> String {
    let lower = error.to_lowercase();
    if lower.contains("timeout") {
        return "timeout".to_string();
    }
    if lower.contains("blocked") {
        return "blocked".to_string();
    }
    if lower.contains("401") || lower.contains("403") {
        return "http_error".to_string();
    }
    if lower.contains("5") && lower.contains("http") {
        return "http_error".to_string();
    }
    "failed".to_string()
}

fn extract_http_status_from_error(error: &str) -> Option<u16> {
    let lower = error.to_lowercase();
    let marker = "http status ";
    let index = lower.find(marker)?;
    let tail = &lower[index + marker.len()..];
    let code = tail
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if code.len() < 3 {
        return None;
    }
    code.parse::<u16>().ok()
}

fn parse_rss_items(xml: &str) -> Vec<ParsedFeedItem> {
    let doc = match Document::parse(xml) {
        Ok(doc) => doc,
        Err(_) => return Vec::new(),
    };
    let mut items = Vec::new();

    for node in doc.descendants() {
        if !(node.has_tag_name("item") || node.has_tag_name("entry")) {
            continue;
        }
        let title = child_text_any(&node, &["title"]).unwrap_or_else(|| "Untitled".to_string());
        let link = child_link(&node).unwrap_or_default();
        let published_at = child_text_any(&node, &["pubDate", "published", "updated"]);
        let summary = child_text_any(&node, &["description", "summary", "content"]);
        items.push(ParsedFeedItem {
            title: title.trim().to_string(),
            link: link.trim().to_string(),
            published_at: published_at.map(|value| value.trim().to_string()),
            summary: summary.map(|value| truncate_chars(value.trim(), 260)),
        });
        if items.len() >= MAX_RSS_ITEMS {
            break;
        }
    }

    items
}

fn child_text_any(node: &roxmltree::Node<'_, '_>, names: &[&str]) -> Option<String> {
    for child in node.children() {
        if !child.is_element() {
            continue;
        }
        if names
            .iter()
            .any(|name| child.tag_name().name().eq_ignore_ascii_case(name))
        {
            if let Some(text) = child.text() {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    None
}

fn child_link(node: &roxmltree::Node<'_, '_>) -> Option<String> {
    for child in node.children() {
        if !child.is_element() || !child.tag_name().name().eq_ignore_ascii_case("link") {
            continue;
        }
        if let Some(href) = child.attribute("href") {
            let trimmed = href.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        if let Some(text) = child.text() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn build_rss_markdown(
    url: &str,
    topic: &str,
    fetched_at: &str,
    items: &[ParsedFeedItem],
) -> String {
    if items.is_empty() {
        return format!(
            "# Source Capture\n\n- Topic: {topic}\n- URL: {url}\n- Fetched: {fetched_at}\n- Type: RSS\n\nNo item parsed.\n"
        );
    }
    let lines = items
        .iter()
        .map(|item| {
            let date_part = item
                .published_at
                .as_ref()
                .map(|value| format!(" ({value})"))
                .unwrap_or_default();
            let link_part = if item.link.is_empty() {
                item.title.clone()
            } else {
                format!("[{}]({})", item.title, item.link)
            };
            let summary_part = item
                .summary
                .as_ref()
                .map(|value| format!(" - {value}"))
                .unwrap_or_default();
            format!("- {link_part}{date_part}{summary_part}")
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "# Source Capture\n\n- Topic: {topic}\n- URL: {url}\n- Fetched: {fetched_at}\n- Type: RSS\n\n## Items\n\n{lines}\n"
    )
}

fn normalize_source_url(source: &str) -> String {
    let trimmed = source.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return trimmed.to_string();
    }
    format!("https://{}", trimmed.trim_start_matches('/'))
}

fn slugify_source(url: &str) -> String {
    let without_scheme = url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    without_scheme
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .take(48)
        .collect::<String>()
}

fn topic_event_label(topic: &str) -> &'static str {
    match topic {
        "marketSummary" => "시장요약",
        "globalHeadlines" => "글로벌헤드라인",
        "industryTrendRadar" => "트렌드",
        "communityHotTopics" => "일반커뮤니티핫토픽",
        "devCommunityHotTopics" => "개발커뮤니티핫토픽",
        "paperResearch" => "논문토픽",
        "eventCalendar" => "이벤트캘린더",
        "riskAlertBoard" => "위험알림보드",
        "devEcosystem" => "개발생태계업데이트",
        _ => "event",
    }
}

fn sanitize_filename_segment(input: &str) -> String {
    let mut out = String::new();
    let mut last_was_separator = false;
    for ch in input.chars() {
        let keep = ch.is_alphanumeric() || ch == '-' || ch == '_';
        if keep {
            out.push(ch);
            last_was_separator = false;
            continue;
        }
        if !last_was_separator {
            out.push('-');
            last_was_separator = true;
        }
    }
    let cleaned = out.trim_matches('-').trim_matches('_');
    if cleaned.is_empty() {
        "event".to_string()
    } else {
        cleaned.to_string()
    }
}

fn now_epoch_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn now_date_yyyymmdd() -> String {
    Local::now().format("%Y%m%d").to_string()
}

fn now_iso8601_like() -> String {
    format!("{}", now_epoch_millis())
}

fn truncate_chars(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    input.chars().take(max_chars).collect()
}

fn looks_like_xml(input: &str) -> bool {
    let trimmed = input.trim_start();
    trimmed.starts_with("<?xml") || trimmed.starts_with("<rss") || trimmed.starts_with("<feed")
}

fn looks_like_json(input: &str) -> bool {
    let trimmed = input.trim_start();
    trimmed.starts_with('{') || trimmed.starts_with('[')
}

fn extract_html_title(html: &str) -> Option<String> {
    extract_between_case_insensitive(html, "<title", "</title>").map(|value| {
        let after_angle = value
            .split_once('>')
            .map(|(_, tail)| tail)
            .unwrap_or(value.as_str());
        extract_text_preview(after_angle, 180)
    })
}

fn extract_meta_description(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let mut start_index = 0usize;
    while let Some(position) = lower[start_index..].find("<meta") {
        let absolute = start_index + position;
        let tail = &lower[absolute..];
        let Some(close_pos) = tail.find('>') else {
            break;
        };
        let end = absolute + close_pos + 1;
        let chunk = &html[absolute..end];
        let chunk_lower = &lower[absolute..end];
        let is_description = chunk_lower.contains("name=\"description\"")
            || chunk_lower.contains("property=\"og:description\"");
        if is_description {
            if let Some(value) = extract_attribute_value_case_insensitive(chunk, "content") {
                let cleaned = extract_text_preview(&value, MAX_SUMMARY_CHARS);
                if !cleaned.is_empty() {
                    return Some(cleaned);
                }
            }
        }
        start_index = end;
    }
    None
}

fn extract_between_case_insensitive(text: &str, start: &str, end: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let start_pos = lower.find(&start.to_lowercase())?;
    let rest = &text[start_pos..];
    let end_pos = rest.to_lowercase().find(&end.to_lowercase())?;
    Some(rest[..end_pos].to_string())
}

fn extract_attribute_value_case_insensitive(tag: &str, attribute: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    let attr = format!("{}=", attribute.to_lowercase());
    let attr_pos = lower.find(&attr)?;
    let raw = &tag[attr_pos + attr.len()..];
    let quote = raw.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let mut collected = String::new();
    for ch in raw.chars().skip(1) {
        if ch == quote {
            return Some(collected);
        }
        collected.push(ch);
    }
    None
}

fn extract_text_preview(raw: &str, max_chars: usize) -> String {
    let no_tags = strip_tags(raw);
    let collapsed = no_tags.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate_chars(&collapsed, max_chars)
}

fn strip_tags(input: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in input.chars() {
        if ch == '<' {
            in_tag = true;
            continue;
        }
        if ch == '>' {
            in_tag = false;
            out.push(' ');
            continue;
        }
        if !in_tag {
            out.push(ch);
        }
    }
    out
}

fn value_to_summary_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(boolean) => boolean.to_string(),
        Value::Number(number) => number.to_string(),
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .take(20)
            .map(value_to_summary_text)
            .filter(|row| !row.trim().is_empty())
            .collect::<Vec<_>>()
            .join(" | "),
        Value::Object(map) => map
            .iter()
            .take(24)
            .map(|(key, row)| format!("{key}: {}", value_to_summary_text(row)))
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn sanitizes_event_label_for_filename() {
        let value = sanitize_filename_segment("시장 조사 세트 / 위험");
        assert_eq!(value, "시장-조사-세트-위험");
    }

    #[test]
    fn maps_known_topic_to_event_label() {
        assert_eq!(topic_event_label("marketSummary"), "시장요약");
        assert_eq!(
            topic_event_label("communityHotTopics"),
            "일반커뮤니티핫토픽"
        );
    }

    #[test]
    fn normalize_topics_uses_known_order() {
        let topics = normalize_topics(Some(vec![
            "riskAlertBoard".to_string(),
            "marketSummary".to_string(),
            "invalid".to_string(),
        ]));
        assert_eq!(topics, vec!["marketSummary", "riskAlertBoard"]);
    }

    #[test]
    fn normalize_source_url_adds_https() {
        assert_eq!(normalize_source_url("example.com"), "https://example.com");
        assert_eq!(
            normalize_source_url("https://example.com/rss"),
            "https://example.com/rss"
        );
    }

    #[test]
    fn parse_rss_items_extracts_item_fields() {
        let xml = r#"
          <rss version="2.0">
            <channel>
              <item>
                <title>Hello</title>
                <link>https://example.com/a</link>
                <pubDate>2026-01-01</pubDate>
                <description>World</description>
              </item>
            </channel>
          </rss>
        "#;
        let items = parse_rss_items(xml);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Hello");
        assert_eq!(items[0].link, "https://example.com/a");
        assert_eq!(items[0].published_at.as_deref(), Some("2026-01-01"));
    }

    #[test]
    fn rejects_localhost_source_url_for_ssrf_safety() {
        let error = validate_source_url("http://127.0.0.1:8080/private").unwrap_err();
        assert!(error.contains("blocked"));
    }

    #[test]
    fn allows_public_source_url() {
        assert!(validate_source_url("https://reuters.com/world").is_ok());
    }

    #[test]
    fn scrapling_base_url_must_be_localhost() {
        let error = validate_local_bridge_base_url("https://example.com").unwrap_err();
        assert!(error.contains("localhost/loopback"));
        assert!(validate_local_bridge_base_url("http://127.0.0.1:8931").is_ok());
    }

    #[test]
    fn dashboard_snapshot_delete_removes_only_matching_run_id() {
        let root =
            std::env::temp_dir().join(format!("rail_snapshot_delete_{}", now_epoch_millis()));
        let topic_dir = root.join(".rail/dashboard/snapshots/globalHeadlines");
        fs::create_dir_all(&topic_dir).expect("create topic dir");

        let keep_file = topic_dir.join("keep.json");
        let delete_file = topic_dir.join("delete.json");
        fs::write(
            &keep_file,
            r#"{"topic":"globalHeadlines","runId":"topic-keep","summary":"keep"}"#,
        )
        .expect("write keep file");
        fs::write(
            &delete_file,
            r#"{"topic":"globalHeadlines","runId":"topic-delete","summary":"delete"}"#,
        )
        .expect("write delete file");

        let deleted = dashboard_snapshot_delete(
            root.to_string_lossy().to_string(),
            Some("topic-delete".to_string()),
            None,
        )
        .expect("delete by run id");
        assert_eq!(deleted, 1);
        assert!(!delete_file.exists());
        assert!(keep_file.exists());

        let _ = fs::remove_dir_all(PathBuf::from(root));
    }
}
