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
const PINCHTAB_DEFAULT_BASE_URL: &str = "http://127.0.0.1:9867";
const ENV_PINCHTAB_BASE_URL: &str = "RAIL_PINCHTAB_URL";
const ENV_PINCHTAB_BRIDGE_TOKEN: &str = "RAIL_PINCHTAB_BRIDGE_TOKEN";
const ENV_PINCHTAB_REQUIRED: &str = "RAIL_PINCHTAB_REQUIRED";
const ENV_PINCHTAB_URL_COMPAT: &str = "PINCHTAB_URL";
const ENV_PINCHTAB_TOKEN_COMPAT: &str = "PINCHTAB_TOKEN";
const ENV_PINCHTAB_BRIDGE_TOKEN_COMPAT: &str = "BRIDGE_TOKEN";

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardCrawlRunResult {
    pub started_at: String,
    pub finished_at: String,
    pub total_fetched: usize,
    pub total_files: usize,
    pub topics: Vec<DashboardTopicCrawlResult>,
}

#[derive(Debug, Clone)]
struct SourceDocument {
    markdown: String,
    json_payload: Value,
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
struct PinchtabConfig {
    base_url: String,
    bridge_token: Option<String>,
    required: bool,
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
pub fn dashboard_raw_list(cwd: String, topic: String, limit: Option<usize>) -> Result<Vec<String>, String> {
    let workspace = normalize_workspace_cwd(&cwd)?;
    let topic_id = normalize_topic_id(&topic).ok_or_else(|| format!("invalid topic: {topic}"))?;
    let topic_dir = workspace.join(".rail/dashboard/raw").join(topic_id);
    if !topic_dir.exists() {
        return Ok(Vec::new());
    }

    let mut paths: Vec<PathBuf> = Vec::new();
    for entry in
        fs::read_dir(&topic_dir).map_err(|err| format!("failed to list raw files for {topic_id}: {err}"))?
    {
        let entry = entry.map_err(|err| format!("failed to read raw file entry: {err}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path.extension().and_then(|value| value.to_str()).unwrap_or_default();
        if ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("json") {
            paths.push(path);
        }
    }

    paths.sort_by(|left, right| {
        right
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .cmp(left.file_name().and_then(|value| value.to_str()).unwrap_or_default())
    });

    let limit = limit.unwrap_or(50).clamp(1, 500);
    Ok(paths
        .into_iter()
        .take(limit)
        .map(|path| path.to_string_lossy().to_string())
        .collect())
}

pub async fn run_dashboard_crawl(request: DashboardCrawlRequest) -> Result<DashboardCrawlRunResult, String> {
    let workspace = normalize_workspace_cwd(&request.cwd)?;
    let selected_topics = normalize_topics(request.topics);
    let allowlist_map = build_allowlist_map(request.allowlist_by_topic);
    let pinchtab = pinchtab_config_from_env()?;
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
            if let Err(err) = validate_source_url(&source_url) {
                result.errors.push(format!("blocked source ({source_url}): {err}"));
                continue;
            }
            match fetch_source_document(&client, topic, &source_url, pinchtab.as_ref()).await {
                Ok(document) => {
                    let stamp = now_epoch_millis();
                    let date = now_date_yyyymmdd();
                    let slug = slugify_source(&source_url);
                    let md_path = topic_dir.join(format!("{stamp}_{date}_{event_label}_{slug}.md"));
                    let json_path = topic_dir.join(format!("{stamp}_{date}_{event_label}_{slug}.json"));

                    if let Err(err) = fs::write(&md_path, document.markdown) {
                        result.errors.push(format!("{}: failed to write markdown ({err})", source_url));
                        continue;
                    }

                    let payload_body = match serde_json::to_string_pretty(&document.json_payload) {
                        Ok(body) => body,
                        Err(err) => {
                            result.errors.push(format!("{}: failed to serialize payload ({err})", source_url));
                            continue;
                        }
                    };
                    if let Err(err) = fs::write(&json_path, payload_body) {
                        result
                            .errors
                            .push(format!("{}: failed to write payload json ({err})", source_url));
                        continue;
                    }

                    result.fetched_count += 1;
                    total_fetched += 1;
                    total_files += 2;
                    result.saved_files.push(md_path.to_string_lossy().to_string());
                    result.saved_files.push(json_path.to_string_lossy().to_string());
                }
                Err(err) => {
                    result.errors.push(format!("{}: {err}", source_url));
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

fn pinchtab_config_from_env() -> Result<Option<PinchtabConfig>, String> {
    let required = std::env::var(ENV_PINCHTAB_REQUIRED)
        .ok()
        .map(|value| parse_bool_env(&value))
        .unwrap_or(false);
    let bridge_token = first_non_empty_env(&[
        ENV_PINCHTAB_BRIDGE_TOKEN,
        ENV_PINCHTAB_BRIDGE_TOKEN_COMPAT,
        ENV_PINCHTAB_TOKEN_COMPAT,
    ]);
    let raw_base = first_non_empty_env(&[ENV_PINCHTAB_BASE_URL, ENV_PINCHTAB_URL_COMPAT])
        .unwrap_or_else(|| PINCHTAB_DEFAULT_BASE_URL.to_string());
    let base_url = validate_pinchtab_base_url(&raw_base)?;
    // Try pinchtab by default (without forcing), so users only need to run the local server.
    // If unavailable and required=false, crawler will transparently fallback to reqwest.
    Ok(Some(PinchtabConfig {
        base_url,
        bridge_token,
        required,
    }))
}

fn validate_pinchtab_base_url(raw: &str) -> Result<String, String> {
    let parsed = Url::parse(raw.trim()).map_err(|err| format!("invalid pinchtab base url: {err}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("pinchtab base url must use http/https".to_string());
    }
    let Some(host) = parsed.host_str() else {
        return Err("pinchtab base url host is missing".to_string());
    };
    let is_localhost = host.eq_ignore_ascii_case("localhost")
        || host.parse::<IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false);
    if !is_localhost {
        return Err("pinchtab base url must be localhost/loopback for security".to_string());
    }
    Ok(parsed.as_str().trim_end_matches('/').to_string())
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
        fs::create_dir_all(&path).map_err(|err| format!("failed to create cwd directory: {err}"))?;
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
    TOPIC_IDS.iter().copied().find(|topic| topic.eq_ignore_ascii_case(trimmed))
}

fn build_allowlist_map(custom: Option<HashMap<String, Vec<String>>>) -> HashMap<&'static str, Vec<String>> {
    let defaults = default_allowlist_map();
    let Some(input) = custom else {
        return defaults;
    };

    let mut out: HashMap<&'static str, Vec<String>> = HashMap::new();
    for topic in TOPIC_IDS {
        let custom_values = input
            .iter()
            .find_map(|(key, values)| normalize_topic_id(key).filter(|k| *k == topic).map(|_| values.clone()));
        let source_values = custom_values.unwrap_or_else(|| defaults.get(topic).cloned().unwrap_or_default());
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
                "reuters.com".to_string(),
                "apnews.com".to_string(),
                "ft.com".to_string(),
                "wsj.com".to_string(),
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
    pinchtab: Option<&PinchtabConfig>,
) -> Result<SourceDocument, String> {
    if let Some(config) = pinchtab {
        match fetch_source_document_with_pinchtab(client, topic, url, config).await {
            Ok(document) => return Ok(document),
            Err(err) => {
                if config.required {
                    return Err(format!("pinchtab required mode: {err}"));
                }
            }
        }
    }
    fetch_source_document_with_reqwest(client, topic, url).await
}

async fn fetch_source_document_with_reqwest(client: &Client, topic: &str, url: &str) -> Result<SourceDocument, String> {
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
        });
    }

    if content_type.contains("json") || looks_like_json(&trimmed) {
        let parsed = serde_json::from_str::<Value>(&trimmed).unwrap_or_else(|_| json!({ "raw": trimmed }));
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
        });
    }

    let title = extract_html_title(&trimmed).unwrap_or_else(|| url.to_string());
    let summary = extract_meta_description(&trimmed).unwrap_or_else(|| extract_text_preview(&trimmed, MAX_SUMMARY_CHARS));
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
    })
}

async fn fetch_source_document_with_pinchtab(
    client: &Client,
    topic: &str,
    url: &str,
    config: &PinchtabConfig,
) -> Result<SourceDocument, String> {
    let fetched_at = now_iso8601_like();
    let navigate_url = format!("{}/navigate", config.base_url);
    let text_url = format!("{}/text", config.base_url);
    let mut navigate_request = client.post(&navigate_url);
    if let Some(token) = &config.bridge_token {
        navigate_request = navigate_request.header("Authorization", format!("Bearer {token}"));
    }
    let navigate_response = navigate_request
        .json(&json!({ "url": url }))
        .send()
        .await
        .map_err(|err| format!("pinchtab navigate request failed: {err}"))?;
    if !navigate_response.status().is_success() {
        let status = navigate_response.status();
        let body = navigate_response.text().await.unwrap_or_default();
        return Err(format!(
            "pinchtab navigate failed ({status}): {}",
            truncate_chars(body.trim(), 240)
        ));
    }

    let mut text_request = client.get(&text_url);
    if let Some(token) = &config.bridge_token {
        text_request = text_request.header("Authorization", format!("Bearer {token}"));
    }
    let text_response = text_request
        .send()
        .await
        .map_err(|err| format!("pinchtab text request failed: {err}"))?;
    if !text_response.status().is_success() {
        let status = text_response.status();
        let body = text_response.text().await.unwrap_or_default();
        return Err(format!(
            "pinchtab text failed ({status}): {}",
            truncate_chars(body.trim(), 240)
        ));
    }

    let content_type = text_response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("text/plain")
        .to_string();
    let body = text_response
        .text()
        .await
        .map_err(|err| format!("pinchtab text body read failed: {err}"))?;
    let extracted = extract_pinchtab_text(&body, content_type.contains("json"));
    if extracted.trim().is_empty() {
        return Err("pinchtab returned empty text".to_string());
    }
    let content = truncate_chars(&extracted, MAX_CONTENT_CHARS);
    let summary = extract_text_preview(&extracted, MAX_SUMMARY_CHARS);
    let markdown = format!(
        "# Source Capture\n\n- Topic: {topic}\n- URL: {url}\n- Fetched: {fetched_at}\n- Type: PINCHTAB\n\n## Summary\n\n{summary}\n\n## Content\n\n{content}\n"
    );
    Ok(SourceDocument {
        markdown,
        json_payload: json!({
            "topic": topic,
            "url": url,
            "fetchedAt": fetched_at,
            "format": "pinchtab",
            "summary": summary,
            "content": content,
            "contentType": content_type,
        }),
    })
}

fn extract_pinchtab_text(response_body: &str, looks_json: bool) -> String {
    if looks_json {
        if let Ok(parsed) = serde_json::from_str::<Value>(response_body) {
            let keys = [
                "/text",
                "/content",
                "/result",
                "/data/text",
                "/data/content",
                "/data/result",
                "/output/text",
            ];
            for key in keys {
                if let Some(value) = parsed.pointer(key).and_then(Value::as_str) {
                    let trimmed = value.trim();
                    if !trimmed.is_empty() {
                        return truncate_chars(trimmed, MAX_BODY_CHARS);
                    }
                }
            }
            let fallback = value_to_summary_text(&parsed);
            if !fallback.trim().is_empty() {
                return truncate_chars(&fallback, MAX_BODY_CHARS);
            }
        }
    }
    truncate_chars(response_body.trim(), MAX_BODY_CHARS)
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

fn build_rss_markdown(url: &str, topic: &str, fetched_at: &str, items: &[ParsedFeedItem]) -> String {
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
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch
            } else {
                '_'
            }
        })
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

    #[test]
    fn sanitizes_event_label_for_filename() {
        let value = sanitize_filename_segment("시장 조사 세트 / 위험");
        assert_eq!(value, "시장-조사-세트-위험");
    }

    #[test]
    fn maps_known_topic_to_event_label() {
        assert_eq!(topic_event_label("marketSummary"), "시장요약");
        assert_eq!(topic_event_label("communityHotTopics"), "일반커뮤니티핫토픽");
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
    fn pinchtab_base_url_must_be_localhost() {
        let error = validate_pinchtab_base_url("https://example.com").unwrap_err();
        assert!(error.contains("localhost/loopback"));
        assert!(validate_pinchtab_base_url("http://127.0.0.1:8931").is_ok());
    }
}
