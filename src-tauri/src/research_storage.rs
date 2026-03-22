use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

fn normalize_workspace_root(cwd: &str) -> Result<PathBuf, String> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Err("cwd is required".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.exists() {
        return Err(format!("workspace not found: {}", path.display()));
    }
    let canonical = fs::canonicalize(&path)
        .map_err(|error| format!("failed to resolve workspace {}: {error}", path.display()))?;
    if !canonical.is_dir() {
        return Err("workspace path is not a directory".to_string());
    }
    Ok(canonical)
}

fn resolve_script_path() -> Result<PathBuf, String> {
    let candidates = [
        PathBuf::from("scripts/research_storage.py"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/research_storage.py"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("scripts/research_storage.py"),
    ];
    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err("research storage script not found (scripts/research_storage.py)".to_string())
}

fn resolve_python(workspace: &Path) -> String {
    let candidates = if cfg!(target_os = "windows") {
        vec![
            workspace.join(".rail/.venv_research/Scripts/python.exe"),
            workspace.join(".rail/.venv_scrapling/Scripts/python.exe"),
        ]
    } else {
        vec![
            workspace.join(".rail/.venv_research/bin/python"),
            workspace.join(".rail/.venv_scrapling/bin/python"),
        ]
    };
    for candidate in candidates {
        if candidate.is_file() {
            return candidate.to_string_lossy().to_string();
        }
    }
    "python3".to_string()
}

fn parse_json_output(output: std::process::Output, step: &str) -> Result<Value, String> {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        let message = if stderr.is_empty() { stdout } else { stderr };
        return Err(format!("{step}: {message}"));
    }
    serde_json::from_str::<Value>(&stdout)
        .map_err(|error| format!("{step}: failed to parse json output: {error}"))
}

fn run_research_storage(workspace: &Path, args: &[String], step: &str) -> Result<Value, String> {
    let script_path = resolve_script_path()?;
    let python = resolve_python(workspace);
    let output = Command::new(&python)
        .arg(script_path)
        .args(args)
        .current_dir(workspace)
        .output()
        .map_err(|error| format!("{step}: failed to execute script ({error})"))?;
    parse_json_output(output, step)
}

fn json_string_array(raw: Option<Vec<String>>) -> String {
    let rows = raw
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    serde_json::to_string(&rows).unwrap_or_else(|_| "[]".to_string())
}

#[tauri::command]
pub fn research_storage_ingest_steam_cache(cwd: String) -> Result<Value, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    run_research_storage(
        &workspace,
        &[
            "ingest-steam-cache".to_string(),
            "--workspace".to_string(),
            workspace.to_string_lossy().to_string(),
        ],
        "research storage ingest",
    )
}

#[tauri::command]
pub fn research_storage_overview(cwd: String) -> Result<Value, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    run_research_storage(
        &workspace,
        &[
            "overview".to_string(),
            "--workspace".to_string(),
            workspace.to_string_lossy().to_string(),
        ],
        "research storage overview",
    )
}

#[tauri::command]
pub fn research_storage_query_reviews(
    cwd: String,
    source: Option<String>,
    game_key: Option<String>,
    sentiment: Option<String>,
    language: Option<String>,
    search: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Value, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let args = vec![
        "query-reviews".to_string(),
        "--workspace".to_string(),
        workspace.to_string_lossy().to_string(),
        "--source".to_string(),
        source.unwrap_or_else(|| "steam".to_string()),
        "--game-key".to_string(),
        game_key.unwrap_or_default(),
        "--sentiment".to_string(),
        sentiment.unwrap_or_default(),
        "--language".to_string(),
        language.unwrap_or_default(),
        "--search".to_string(),
        search.unwrap_or_default(),
        "--limit".to_string(),
        limit.unwrap_or(50).to_string(),
        "--offset".to_string(),
        offset.unwrap_or(0).to_string(),
    ];
    run_research_storage(&workspace, &args, "research storage query")
}

#[tauri::command]
pub fn research_storage_list_games(cwd: String, source: Option<String>) -> Result<Value, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    run_research_storage(
        &workspace,
        &[
            "list-games".to_string(),
            "--workspace".to_string(),
            workspace.to_string_lossy().to_string(),
            "--source".to_string(),
            source.unwrap_or_else(|| "steam".to_string()),
        ],
        "research storage list games",
    )
}

#[tauri::command]
pub fn research_storage_game_metrics(cwd: String, source: Option<String>) -> Result<Value, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    run_research_storage(
        &workspace,
        &[
            "game-metrics".to_string(),
            "--workspace".to_string(),
            workspace.to_string_lossy().to_string(),
            "--source".to_string(),
            source.unwrap_or_else(|| "steam".to_string()),
        ],
        "research storage game metrics",
    )
}

#[tauri::command]
pub fn research_storage_sentiment_series(
    cwd: String,
    game_key: String,
    source: Option<String>,
    limit: Option<usize>,
) -> Result<Value, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    run_research_storage(
        &workspace,
        &[
            "sentiment-series".to_string(),
            "--workspace".to_string(),
            workspace.to_string_lossy().to_string(),
            "--game-key".to_string(),
            game_key,
            "--source".to_string(),
            source.unwrap_or_else(|| "steam".to_string()),
            "--limit".to_string(),
            limit.unwrap_or(90).to_string(),
        ],
        "research storage sentiment series",
    )
}

#[tauri::command]
pub fn research_storage_plan_dynamic_job(
    cwd: String,
    urls: Vec<String>,
    keywords: Option<Vec<String>>,
    label: Option<String>,
    requested_source_type: Option<String>,
    max_items: Option<usize>,
) -> Result<Value, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let args = vec![
        "plan-dynamic-job".to_string(),
        "--workspace".to_string(),
        workspace.to_string_lossy().to_string(),
        "--urls-json".to_string(),
        json_string_array(Some(urls)),
        "--keywords-json".to_string(),
        json_string_array(keywords),
        "--label".to_string(),
        label.unwrap_or_default(),
        "--requested-source-type".to_string(),
        requested_source_type.unwrap_or_else(|| "auto".to_string()),
        "--max-items".to_string(),
        max_items.unwrap_or(40).to_string(),
    ];
    run_research_storage(&workspace, &args, "research storage plan dynamic job")
}

#[tauri::command]
pub fn research_storage_list_jobs(cwd: String) -> Result<Value, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    run_research_storage(
        &workspace,
        &[
            "list-jobs".to_string(),
            "--workspace".to_string(),
            workspace.to_string_lossy().to_string(),
        ],
        "research storage list jobs",
    )
}

#[tauri::command]
pub fn research_storage_load_job(cwd: String, job_id: String) -> Result<Value, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    run_research_storage(
        &workspace,
        &[
            "load-job".to_string(),
            "--workspace".to_string(),
            workspace.to_string_lossy().to_string(),
            "--job-id".to_string(),
            job_id,
        ],
        "research storage load job",
    )
}

#[tauri::command]
pub fn research_storage_build_job_handoff(
    cwd: String,
    job_id: String,
    agent_role: Option<String>,
) -> Result<Value, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    run_research_storage(
        &workspace,
        &[
            "build-job-handoff".to_string(),
            "--workspace".to_string(),
            workspace.to_string_lossy().to_string(),
            "--job-id".to_string(),
            job_id,
            "--agent-role".to_string(),
            agent_role.unwrap_or_else(|| "researcher".to_string()),
        ],
        "research storage build handoff",
    )
}

#[tauri::command]
pub fn research_storage_plan_agent_job(
    cwd: String,
    prompt: String,
    label: Option<String>,
    requested_source_type: Option<String>,
    max_items: Option<usize>,
) -> Result<Value, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let args = vec![
        "plan-agent-job".to_string(),
        "--workspace".to_string(),
        workspace.to_string_lossy().to_string(),
        "--prompt".to_string(),
        prompt,
        "--label".to_string(),
        label.unwrap_or_default(),
        "--requested-source-type".to_string(),
        requested_source_type.unwrap_or_else(|| "auto".to_string()),
        "--max-items".to_string(),
        max_items.unwrap_or(40).to_string(),
    ];
    run_research_storage(&workspace, &args, "research storage plan agent job")
}

#[tauri::command]
pub fn research_storage_list_collection_items(
    cwd: String,
    job_id: Option<String>,
    source_type: Option<String>,
    verification_status: Option<String>,
    search: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Value, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let args = vec![
        "list-collection-items".to_string(),
        "--workspace".to_string(),
        workspace.to_string_lossy().to_string(),
        "--job-id".to_string(),
        job_id.unwrap_or_default(),
        "--source-type".to_string(),
        source_type.unwrap_or_default(),
        "--verification-status".to_string(),
        verification_status.unwrap_or_default(),
        "--search".to_string(),
        search.unwrap_or_default(),
        "--limit".to_string(),
        limit.unwrap_or(50).to_string(),
        "--offset".to_string(),
        offset.unwrap_or(0).to_string(),
    ];
    run_research_storage(&workspace, &args, "research storage list collection items")
}

#[tauri::command]
pub fn research_storage_collection_metrics(cwd: String, job_id: Option<String>) -> Result<Value, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    run_research_storage(
        &workspace,
        &[
            "collection-metrics".to_string(),
            "--workspace".to_string(),
            workspace.to_string_lossy().to_string(),
            "--job-id".to_string(),
            job_id.unwrap_or_default(),
        ],
        "research storage collection metrics",
    )
}

#[tauri::command]
pub fn research_storage_collection_genre_rankings(cwd: String, job_id: String) -> Result<Value, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    run_research_storage(
        &workspace,
        &[
            "collection-genre-rankings".to_string(),
            "--workspace".to_string(),
            workspace.to_string_lossy().to_string(),
            "--job-id".to_string(),
            job_id,
        ],
        "research storage collection genre rankings",
    )
}

#[tauri::command]
pub async fn research_storage_execute_job(
    app: AppHandle,
    cwd: String,
    job_id: String,
    flow_id: Option<i64>,
) -> Result<Value, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let normalized_job_id = job_id.trim();
    if normalized_job_id.is_empty() {
        return Err("job_id is required".to_string());
    }
    let resolved_flow_id = flow_id.unwrap_or(1);
    if resolved_flow_id <= 0 {
        return Err("flow_id must be a positive integer".to_string());
    }

    let loaded = run_research_storage(
        &workspace,
        &[
            "load-job".to_string(),
            "--workspace".to_string(),
            workspace.to_string_lossy().to_string(),
            "--job-id".to_string(),
            normalized_job_id.to_string(),
        ],
        "research storage load job",
    )?;
    let job = loaded
        .get("job")
        .cloned()
        .ok_or_else(|| "research storage load job: missing job payload".to_string())?;
    let via_source_type = job
        .get("viaSourceType")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| value.starts_with("source."))
        .unwrap_or_else(|| "source.news".to_string());
    let source_options = job
        .get("sourceOptions")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let mut source_options = source_options;
    if let Some(options) = source_options.as_object_mut() {
        let runtime_providers = job
            .get("targets")
            .and_then(Value::as_array)
            .map(|targets| {
                targets
                    .iter()
                    .flat_map(|target| {
                        target
                            .get("runtimeProviders")
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten()
                            .filter_map(Value::as_str)
                            .map(|value| Value::String(value.to_string()))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if !runtime_providers.is_empty() {
            options.insert(
                "collector_runtime_providers".to_string(),
                Value::Array(runtime_providers),
            );
        }
        if let Some(preferred_execution_order) = job.get("preferredExecutionOrder").cloned() {
            options.insert(
                "preferred_execution_order".to_string(),
                preferred_execution_order,
            );
        }
    }

    let via_result = crate::via_bridge::via_run_flow(
        app,
        Some(workspace.to_string_lossy().to_string()),
        resolved_flow_id,
        Some("research_storage.dynamic_job".to_string()),
        Some(via_source_type),
        Some(source_options),
    )
    .await?;

    let recorded = run_research_storage(
        &workspace,
        &[
            "record-job-run".to_string(),
            "--workspace".to_string(),
            workspace.to_string_lossy().to_string(),
            "--job-id".to_string(),
            normalized_job_id.to_string(),
            "--flow-id".to_string(),
            resolved_flow_id.to_string(),
            "--result-json".to_string(),
            serde_json::to_string(&via_result).map_err(|error| format!("failed to serialize via result: {error}"))?,
        ],
        "research storage record job run",
    )?;

    Ok(serde_json::json!({
        "job": job,
        "execution": recorded.get("execution").cloned().unwrap_or(Value::Null),
        "via": via_result,
    }))
}
