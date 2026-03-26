use crate::task_presets;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::Command,
    time::SystemTime,
};
use tauri::async_runtime::channel;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))
        .or_else(|_| {
            std::env::current_dir()
                .map(|dir| dir.join("rail-data"))
                .map_err(|e| format!("failed to resolve fallback app data dir: {e}"))
        })
}

fn ensure_subdir(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join(name);
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create {name} directory: {e}"))?;
    Ok(dir)
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

#[derive(Debug, Clone, Copy)]
struct StorageGuardrailSettings {
    max_snapshots_per_topic: usize,
    max_runs: usize,
    max_raw_items_per_topic: usize,
    max_web_worker_log_bytes: u64,
}

impl Default for StorageGuardrailSettings {
    fn default() -> Self {
        Self {
            max_snapshots_per_topic: 6,
            max_runs: 40,
            max_raw_items_per_topic: 16,
            max_web_worker_log_bytes: 256 * 1024,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsageEntry {
    label: String,
    category: String,
    path: String,
    file_count: usize,
    bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsageSummary {
    entries: Vec<StorageUsageEntry>,
    total_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskPromptRecord {
    id: String,
    target: String,
    prompt: String,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskRoleState {
    id: String,
    label: String,
    studio_role_id: String,
    enabled: bool,
    status: String,
    last_prompt: Option<String>,
    last_prompt_at: Option<String>,
    last_run_id: Option<String>,
    artifact_paths: Vec<String>,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    task_id: String,
    goal: String,
    mode: String,
    team: String,
    isolation_requested: String,
    isolation_resolved: String,
    status: String,
    #[serde(default)]
    project_path: String,
    workspace_path: String,
    worktree_path: Option<String>,
    branch_name: Option<String>,
    fallback_reason: Option<String>,
    created_at: String,
    updated_at: String,
    roles: Vec<TaskRoleState>,
    prompts: Vec<TaskPromptRecord>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskListItem {
    record: TaskRecord,
    changed_file_count: usize,
    changed_files_preview: Vec<String>,
    validation_state: String,
    risk_level: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    record: TaskRecord,
    artifacts: BTreeMap<String, String>,
    changed_files: Vec<String>,
    validation_state: String,
    risk_level: String,
}

fn normalize_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("file name is required".to_string());
    }
    if trimmed.contains("..") || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("invalid file name".to_string());
    }

    if trimmed.ends_with(".json") {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{trimmed}.json"))
    }
}

fn normalize_markdown_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("file name is required".to_string());
    }
    if trimmed.contains("..") || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("invalid file name".to_string());
    }

    if trimmed.ends_with(".md") {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{trimmed}.md"))
    }
}

fn normalize_text_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("file name is required".to_string());
    }
    if trimmed.contains("..") || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("invalid file name".to_string());
    }
    Ok(trimmed.to_string())
}

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

fn normalize_workspace_file_target(cwd: &str, raw_path: &str) -> Result<PathBuf, String> {
    let workspace = normalize_workspace_root(cwd)?;
    let raw = raw_path.trim();
    if raw.is_empty() {
        return Err("path is required".to_string());
    }
    let target = PathBuf::from(raw);
    if !target.exists() {
        return Err("file not found".to_string());
    }
    if !target.is_file() {
        return Err("target is not file".to_string());
    }
    let canonical = fs::canonicalize(&target)
        .map_err(|error| format!("failed to resolve target {}: {error}", target.display()))?;
    if !canonical.starts_with(&workspace) {
        return Err("target is outside workspace".to_string());
    }
    Ok(canonical)
}

fn rail_dir(workspace: &Path) -> PathBuf {
    workspace.join(".rail")
}

fn task_root_dir(workspace: &Path) -> PathBuf {
    rail_dir(workspace).join("tasks")
}

fn task_dir(workspace: &Path, task_id: &str) -> PathBuf {
    task_root_dir(workspace).join(task_id)
}

fn task_record_path(task_dir: &Path) -> PathBuf {
    task_dir.join("task.json")
}

fn artifact_key_to_file_name(key: &str) -> Option<&'static str> {
    match key {
        "brief" => Some("brief.md"),
        "findings" => Some("findings.md"),
        "plan" => Some("plan.md"),
        "patch" => Some("patch.md"),
        "validation" => Some("validation.md"),
        "handoff" => Some("handoff.md"),
        _ => None,
    }
}

fn task_artifact_keys() -> [&'static str; 6] {
    ["brief", "findings", "plan", "patch", "validation", "handoff"]
}

fn sanitize_slug(input: &str, max_len: usize) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in input.chars() {
        let normalized = ch.to_ascii_lowercase();
        if normalized.is_ascii_alphanumeric() {
            out.push(normalized);
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
        if out.len() >= max_len {
            break;
        }
    }
    out.trim_matches('-').to_string()
}

fn build_task_id(goal: &str) -> String {
    let stamp = Utc::now().format("%Y%m%d-%H%M%S-%3f").to_string();
    let slug = sanitize_slug(goal, 18);
    if slug.is_empty() {
        format!("task-{stamp}")
    } else {
        format!("task-{stamp}-{slug}")
    }
}

fn normalize_mode(raw: Option<String>) -> String {
    match raw.unwrap_or_else(|| "balanced".to_string()).trim().to_lowercase().as_str() {
        "safe" => "safe".to_string(),
        "fast" => "fast".to_string(),
        "yolo" => "yolo".to_string(),
        _ => "balanced".to_string(),
    }
}

fn normalize_team(raw: Option<String>) -> String {
    match raw.unwrap_or_else(|| "full-squad".to_string()).trim().to_lowercase().as_str() {
        "solo" => "solo".to_string(),
        "duo" => "duo".to_string(),
        "full-squad" => "full-squad".to_string(),
        _ => "full-squad".to_string(),
    }
}

fn normalize_isolation(raw: Option<String>) -> String {
    match raw.unwrap_or_else(|| "auto".to_string()).trim().to_lowercase().as_str() {
        "current-repo" => "current-repo".to_string(),
        "branch" => "branch".to_string(),
        "worktree" => "worktree".to_string(),
        _ => "auto".to_string(),
    }
}

fn build_task_roles(team: &str) -> Vec<TaskRoleState> {
    let now = now_iso();
    let enabled = task_presets::task_team_preset_ids(team)
        .into_iter()
        .map(str::to_string)
        .collect::<BTreeSet<_>>();
    task_presets::unity_task_agent_presets()
    .iter()
    .map(|preset| TaskRoleState {
        id: preset.id.to_string(),
        label: preset.label.to_string(),
        studio_role_id: preset.studio_role_id.to_string(),
        enabled: enabled.contains(preset.id),
        status: if enabled.contains(preset.id) { "ready".to_string() } else { "disabled".to_string() },
        last_prompt: None,
        last_prompt_at: None,
        last_run_id: None,
        artifact_paths: Vec::new(),
        updated_at: now.clone(),
    })
    .collect()
}

fn task_artifact_defaults(record: &TaskRecord) -> BTreeMap<String, String> {
    let isolation_line = if record.isolation_requested == record.isolation_resolved {
        record.isolation_resolved.clone()
    } else {
        format!("{} -> {}", record.isolation_requested, record.isolation_resolved)
    };
    let mut map = BTreeMap::new();
    map.insert(
        "brief".to_string(),
        format!(
            "# BRIEF\n\n- TASK_ID: {}\n- GOAL: {}\n- MODE: {}\n- TEAM: {}\n- ISOLATION: {}\n\n## REQUEST\n\n{}\n",
            record.task_id, record.goal, record.mode, record.team, isolation_line, record.goal
        ),
    );
    map.insert("findings".to_string(), "# FINDINGS\n\n- pending\n".to_string());
    map.insert("plan".to_string(), "# PLAN\n\n- pending\n".to_string());
    map.insert("patch".to_string(), "# PATCH\n\n- pending\n".to_string());
    map.insert("validation".to_string(), "# VALIDATION\n\n- pending\n".to_string());
    map.insert("handoff".to_string(), "# HANDOFF\n\n- pending\n".to_string());
    map
}

fn write_task_record_file(task_dir: &Path, record: &TaskRecord) -> Result<(), String> {
    fs::create_dir_all(task_dir)
        .map_err(|error| format!("failed to create task directory {}: {error}", task_dir.display()))?;
    let payload = serde_json::to_string_pretty(record)
        .map_err(|error| format!("failed to serialize task record: {error}"))?;
    fs::write(task_record_path(task_dir), format!("{payload}\n"))
        .map_err(|error| format!("failed to write task record: {error}"))
}

fn write_task_artifacts(task_dir: &Path, artifacts: &BTreeMap<String, String>) -> Result<(), String> {
    fs::create_dir_all(task_dir)
        .map_err(|error| format!("failed to create task directory {}: {error}", task_dir.display()))?;
    for (key, content) in artifacts {
        let Some(file_name) = artifact_key_to_file_name(key) else {
            continue;
        };
        fs::write(task_dir.join(file_name), content)
            .map_err(|error| format!("failed to write task artifact {file_name}: {error}"))?;
    }
    Ok(())
}

fn read_task_record_file(task_dir: &Path) -> Result<TaskRecord, String> {
    let raw = fs::read_to_string(task_record_path(task_dir))
        .map_err(|error| format!("failed to read task record {}: {error}", task_dir.display()))?;
    let mut record: TaskRecord =
        serde_json::from_str(&raw).map_err(|error| format!("invalid task record {}: {error}", task_dir.display()))?;
    normalize_task_record_roles(&mut record);
    Ok(record)
}

fn normalize_task_record_roles(record: &mut TaskRecord) {
    if record.roles.is_empty() {
        record.roles = build_task_roles(&record.team);
        return;
    }
    let mut normalized = Vec::<TaskRoleState>::new();
    for role in record.roles.clone() {
        let canonical = task_presets::canonical_task_agent_id(&role.id).unwrap_or(role.id.trim());
        if let Some(existing) = normalized.iter_mut().find(|entry| entry.id == canonical) {
            existing.enabled = existing.enabled || role.enabled;
            if existing.last_prompt.is_none() {
                existing.last_prompt = role.last_prompt.clone();
            }
            if existing.last_prompt_at.is_none() {
                existing.last_prompt_at = role.last_prompt_at.clone();
            }
            if existing.last_run_id.is_none() {
                existing.last_run_id = role.last_run_id.clone();
            }
            if existing.artifact_paths.is_empty() {
                existing.artifact_paths = role.artifact_paths.clone();
            }
            if existing.status == "disabled" && role.status != "disabled" {
                existing.status = role.status.clone();
            }
            existing.updated_at = existing.updated_at.clone().max(role.updated_at.clone());
            continue;
        }
        normalized.push(TaskRoleState {
            id: canonical.to_string(),
            label: task_presets::task_agent_label(canonical),
            studio_role_id: task_presets::task_agent_studio_role_id(canonical)
                .unwrap_or_else(|| role.studio_role_id.clone()),
            enabled: role.enabled,
            status: role.status,
            last_prompt: role.last_prompt,
            last_prompt_at: role.last_prompt_at,
            last_run_id: role.last_run_id,
            artifact_paths: role.artifact_paths,
            updated_at: role.updated_at,
        });
    }
    record.roles = normalized;
}

fn load_task_artifacts(task_dir: &Path) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for key in task_artifact_keys() {
        if let Some(file_name) = artifact_key_to_file_name(key) {
            let path = task_dir.join(file_name);
            let content = fs::read_to_string(&path).unwrap_or_else(|_| format!("# {}\n\n", key.to_uppercase()));
            out.insert(key.to_string(), content);
        }
    }
    out
}

fn artifact_has_user_content(content: &str) -> bool {
    content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.starts_with('#'))
        .filter(|line| *line != "- pending")
        .next()
        .is_some()
}

fn validation_state(record: &TaskRecord, artifacts: &BTreeMap<String, String>) -> String {
    if let Some(role) = record
        .roles
        .iter()
        .find(|role| task_presets::is_validation_task_agent(&role.id) && role.enabled)
    {
        if role.status == "error" {
            return "failed".to_string();
        }
        if role.status == "done" {
            return "validated".to_string();
        }
    }
    if artifacts
        .get("validation")
        .map(|content| artifact_has_user_content(content))
        .unwrap_or(false)
    {
        return "validated".to_string();
    }
    "pending".to_string()
}

fn risk_level(record: &TaskRecord) -> String {
    match record.mode.as_str() {
        "safe" => "low".to_string(),
        "fast" => "high".to_string(),
        "yolo" => "extreme".to_string(),
        _ => "medium".to_string(),
    }
}

fn git_stdout(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

fn git_changed_files(path: &Path) -> Vec<String> {
    let output = match Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["status", "--short"])
        .output()
    {
        Ok(output) if output.status.success() => output,
        _ => return Vec::new(),
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| {
            if line.len() > 3 {
                line[3..].trim().to_string()
            } else {
                line.to_string()
            }
        })
        .collect()
}

fn task_detail_from_record(workspace: &Path, record: TaskRecord) -> TaskDetail {
    let task_dir = task_dir(workspace, &record.task_id);
    let artifacts = load_task_artifacts(&task_dir);
    let changed_files = git_changed_files(Path::new(&record.workspace_path));
    TaskDetail {
        validation_state: validation_state(&record, &artifacts),
        risk_level: risk_level(&record),
        record,
        artifacts,
        changed_files,
    }
}

fn task_list_item_from_record(workspace: &Path, record: TaskRecord) -> TaskListItem {
    let detail = task_detail_from_record(workspace, record.clone());
    TaskListItem {
        record,
        changed_file_count: detail.changed_files.len(),
        changed_files_preview: detail.changed_files.iter().take(4).cloned().collect(),
        validation_state: detail.validation_state,
        risk_level: detail.risk_level,
    }
}

fn collect_task_records(workspace: &Path) -> Result<Vec<TaskRecord>, String> {
    let root = task_root_dir(workspace);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&root).map_err(|error| format!("failed to list task root {}: {error}", root.display()))? {
        let entry = entry.map_err(|error| format!("failed to read task entry: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Ok(record) = read_task_record_file(&path) else {
            continue;
        };
        out.push(record);
    }
    out.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(out)
}

fn remove_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| format!("failed to delete {}: {error}", path.display()))
    } else {
        fs::remove_file(path).map_err(|error| format!("failed to delete {}: {error}", path.display()))
    }
}

fn modified_key(path: &Path) -> SystemTime {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

fn prune_direct_children<F>(dir: &Path, limit: usize, include: F) -> Result<(), String>
where
    F: Fn(&Path) -> bool,
{
    if limit == 0 || !dir.exists() || !dir.is_dir() {
        return Ok(());
    }
    let mut entries = fs::read_dir(dir)
        .map_err(|error| format!("failed to read {}: {error}", dir.display()))?
        .filter_map(|entry| entry.ok().map(|row| row.path()))
        .filter(|path| include(path))
        .collect::<Vec<_>>();
    if entries.len() <= limit {
        return Ok(());
    }
    entries.sort_by(|left, right| modified_key(right).cmp(&modified_key(left)));
    for path in entries.into_iter().skip(limit) {
        remove_path(&path)?;
    }
    Ok(())
}

fn dir_usage(path: &Path) -> (usize, u64) {
    if !path.exists() {
        return (0, 0);
    }
    if path.is_file() {
        let bytes = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
        return (1, bytes);
    }
    let mut file_count = 0usize;
    let mut bytes = 0u64;
    let Ok(entries) = fs::read_dir(path) else {
        return (0, 0);
    };
    for entry in entries.flatten() {
        let child = entry.path();
        let (child_count, child_bytes) = dir_usage(&child);
        file_count += child_count;
        bytes += child_bytes;
    }
    (file_count, bytes)
}

fn usage_entry(label: &str, category: &str, path: PathBuf) -> StorageUsageEntry {
    let (file_count, bytes) = dir_usage(&path);
    StorageUsageEntry {
        label: label.to_string(),
        category: category.to_string(),
        path: path.to_string_lossy().to_string(),
        file_count,
        bytes,
    }
}

fn truncate_file_to_limit(path: &Path, max_bytes: u64) -> Result<(), String> {
    if !path.exists() || !path.is_file() {
        return Ok(());
    }
    let metadata = fs::metadata(path).map_err(|error| format!("failed to stat {}: {error}", path.display()))?;
    if metadata.len() <= max_bytes {
        return Ok(());
    }
    let keep = max_bytes as usize;
    let mut file = fs::File::open(path).map_err(|error| format!("failed to open {}: {error}", path.display()))?;
    file.seek(SeekFrom::End(-(keep as i64)))
        .map_err(|error| format!("failed to seek {}: {error}", path.display()))?;
    let mut buf = Vec::with_capacity(keep);
    file.read_to_end(&mut buf)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    fs::write(path, buf).map_err(|error| format!("failed to truncate {}: {error}", path.display()))
}

pub fn enforce_default_web_worker_log_limit(path: &Path) -> Result<(), String> {
    truncate_file_to_limit(path, StorageGuardrailSettings::default().max_web_worker_log_bytes)
}

pub fn cleanup_workspace_runtime_noise(workspace: &Path) -> Result<(), String> {
    let settings = StorageGuardrailSettings::default();
    let rail = rail_dir(workspace);

    let snapshot_root = rail.join("dashboard").join("snapshots");
    if snapshot_root.is_dir() {
        for entry in fs::read_dir(&snapshot_root)
            .map_err(|error| format!("failed to read {}: {error}", snapshot_root.display()))?
        {
            let topic_dir = entry.map_err(|error| format!("failed to read snapshot topic: {error}"))?.path();
            if topic_dir.is_dir() {
                prune_direct_children(&topic_dir, settings.max_snapshots_per_topic, |path| {
                    path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("json")
                })?;
            }
        }
    }

    let raw_root = rail.join("dashboard").join("raw");
    if raw_root.is_dir() {
        for entry in fs::read_dir(&raw_root)
            .map_err(|error| format!("failed to read {}: {error}", raw_root.display()))?
        {
            let topic_dir = entry.map_err(|error| format!("failed to read raw topic: {error}"))?.path();
            if topic_dir.is_dir() {
                prune_direct_children(&topic_dir, settings.max_raw_items_per_topic, |path| path.is_file())?;
            }
        }
    }

    let knowledge_raw_root = rail.join("studio_index").join("knowledge").join("raw");
    prune_direct_children(&knowledge_raw_root, settings.max_raw_items_per_topic, |path| path.is_file())?;

    prune_direct_children(&rail.join("runs"), settings.max_runs, |_| true)?;
    prune_direct_children(&rail.join("studio_runs"), settings.max_runs, |_| true)?;

    Ok(())
}

pub fn cleanup_app_runtime_noise(app: &AppHandle) -> Result<(), String> {
    let settings = StorageGuardrailSettings::default();
    prune_direct_children(&ensure_subdir(app, "runs")?, settings.max_runs, |path| {
        path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("json")
    })?;
    let log_path = app_data_dir(app)?.join("web-worker.log");
    truncate_file_to_limit(&log_path, settings.max_web_worker_log_bytes)?;
    Ok(())
}

fn build_storage_usage_summary(app: &AppHandle, workspace: Option<&Path>) -> Result<StorageUsageSummary, String> {
    let app_root = app_data_dir(app)?;
    let mut entries = vec![
        usage_entry("app graphs", "retain", app_root.join("graphs")),
        usage_entry("app runs", "runtime-noise", app_root.join("runs")),
        usage_entry("web worker log", "runtime-noise", app_root.join("web-worker.log")),
        usage_entry("provider profiles", "cache", app_root.join("providers")),
    ];
    if let Some(workspace) = workspace {
        let rail = rail_dir(workspace);
        entries.extend([
            usage_entry("tasks", "retain", rail.join("tasks")),
            usage_entry("dashboard snapshots", "runtime-noise", rail.join("dashboard/snapshots")),
            usage_entry("dashboard raw", "runtime-noise", rail.join("dashboard/raw")),
            usage_entry("knowledge raw", "runtime-noise", rail.join("studio_index/knowledge/raw")),
            usage_entry("runs", "runtime-noise", rail.join("runs")),
            usage_entry("studio runs", "runtime-noise", rail.join("studio_runs")),
            usage_entry("via db", "retain", rail.join("via/app.db")),
            usage_entry("via docs", "retain", rail.join("via-docs")),
            usage_entry("via venv", "retain", rail.join(".venv_via")),
            usage_entry("scrapling venv", "retain", rail.join(".venv_scrapling")),
        ]);
    }
    let total_bytes = entries.iter().map(|entry| entry.bytes).sum();
    Ok(StorageUsageSummary { entries, total_bytes })
}

fn resolve_git_root(workspace: &Path) -> Option<String> {
    git_stdout(workspace, &["rev-parse", "--show-toplevel"])
}

fn git_working_tree_clean(git_root: &Path) -> bool {
    git_stdout(git_root, &["status", "--porcelain"])
        .map(|text| text.trim().is_empty())
        .unwrap_or(true)
}

struct TaskWorkspaceResolution {
    isolation_resolved: String,
    workspace_path: PathBuf,
    worktree_path: Option<PathBuf>,
    branch_name: Option<String>,
    fallback_reason: Option<String>,
}

fn resolve_task_workspace(
    workspace: &Path,
    task_id: &str,
    isolation_requested: &str,
) -> TaskWorkspaceResolution {
    let git_root = resolve_git_root(workspace).map(PathBuf::from);
    let task_worktree_root = rail_dir(workspace).join("tasks").join("worktrees");
    let branch_name = format!("rail/task/{}", task_id.replace('_', "-").to_lowercase());

    let try_worktree = |git_root: &Path| -> Result<TaskWorkspaceResolution, String> {
        fs::create_dir_all(&task_worktree_root).map_err(|error| {
            format!("failed to create task worktree root {}: {error}", task_worktree_root.display())
        })?;
        let worktree_path = task_worktree_root.join(task_id);
        let output = Command::new("git")
            .arg("-C")
            .arg(git_root)
            .arg("worktree")
            .arg("add")
            .arg(&worktree_path)
            .arg("-b")
            .arg(&branch_name)
            .arg("HEAD")
            .output()
            .map_err(|error| format!("failed to start git worktree creation: {error}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "git worktree creation failed".to_string()
            } else {
                stderr
            });
        }
        Ok(TaskWorkspaceResolution {
            isolation_resolved: "worktree".to_string(),
            workspace_path: worktree_path.clone(),
            worktree_path: Some(worktree_path),
            branch_name: Some(branch_name.clone()),
            fallback_reason: None,
        })
    };

    let try_branch = |git_root: &Path| -> Result<TaskWorkspaceResolution, String> {
        if !git_working_tree_clean(git_root) {
            return Err("git working tree is dirty".to_string());
        }
        let output = Command::new("git")
            .arg("-C")
            .arg(git_root)
            .arg("checkout")
            .arg("-b")
            .arg(&branch_name)
            .arg("HEAD")
            .output()
            .map_err(|error| format!("failed to create task branch: {error}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "git branch creation failed".to_string()
            } else {
                stderr
            });
        }
        Ok(TaskWorkspaceResolution {
            isolation_resolved: "branch".to_string(),
            workspace_path: git_root.to_path_buf(),
            worktree_path: None,
            branch_name: Some(branch_name.clone()),
            fallback_reason: None,
        })
    };

    match isolation_requested {
        "worktree" => {
            if let Some(git_root) = git_root.as_deref() {
                if let Ok(result) = try_worktree(git_root) {
                    return result;
                }
            }
        }
        "branch" => {
            if let Some(git_root) = git_root.as_deref() {
                if let Ok(result) = try_branch(git_root) {
                    return result;
                }
            }
        }
        "auto" => {
            if let Some(git_root) = git_root.as_deref() {
                match try_worktree(git_root) {
                    Ok(result) => return result,
                    Err(error) => {
                        return TaskWorkspaceResolution {
                            isolation_resolved: "current-repo".to_string(),
                            workspace_path: workspace.to_path_buf(),
                            worktree_path: None,
                            branch_name: None,
                            fallback_reason: Some(format!("auto fallback: {error}")),
                        }
                    }
                }
            }
        }
        _ => {}
    }

    TaskWorkspaceResolution {
        isolation_resolved: "current-repo".to_string(),
        workspace_path: workspace.to_path_buf(),
        worktree_path: None,
        branch_name: None,
        fallback_reason: if isolation_requested == "current-repo" {
            None
        } else if git_root.is_none() {
            Some("git repository not found; using current repo".to_string())
        } else {
            Some(format!("{} unavailable; using current repo", isolation_requested))
        },
    }
}

fn update_task_record<F>(workspace: &Path, task_id: &str, updater: F) -> Result<TaskRecord, String>
where
    F: FnOnce(&mut TaskRecord) -> Result<(), String>,
{
    let task_path = task_dir(workspace, task_id);
    let mut record = read_task_record_file(&task_path)?;
    updater(&mut record)?;
    record.updated_at = now_iso();
    write_task_record_file(&task_path, &record)?;
    Ok(record)
}

fn list_json_files(app: &AppHandle, dir_name: &str) -> Result<Vec<String>, String> {
    let dir = ensure_subdir(app, dir_name)?;
    let mut files = Vec::new();

    for entry in
        fs::read_dir(dir).map_err(|e| format!("failed to read {dir_name} directory: {e}"))?
    {
        let entry = entry.map_err(|e| format!("failed to read directory entry: {e}"))?;
        let path = entry.path();
        if path.is_file()
            && path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("json"))
                .unwrap_or(false)
        {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                files.push(name.to_string());
            }
        }
    }

    files.sort();
    Ok(files)
}

fn write_json_file(
    app: &AppHandle,
    dir_name: &str,
    name: &str,
    data: &Value,
) -> Result<(), String> {
    let normalized_name = normalize_file_name(name)?;
    let dir = ensure_subdir(app, dir_name)?;
    let path = dir.join(normalized_name);
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| format!("failed to serialize JSON for {dir_name}: {e}"))?;
    fs::write(path, json).map_err(|e| format!("failed to write {dir_name} file: {e}"))
}

fn read_json_file(app: &AppHandle, dir_name: &str, name: &str) -> Result<Value, String> {
    let normalized_name = normalize_file_name(name)?;
    let dir = ensure_subdir(app, dir_name)?;
    let path = dir.join(normalized_name);
    let raw =
        fs::read_to_string(path).map_err(|e| format!("failed to read {dir_name} file: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("invalid JSON in {dir_name} file: {e}"))
}

fn delete_json_file(app: &AppHandle, dir_name: &str, name: &str) -> Result<(), String> {
    let normalized_name = normalize_file_name(name)?;
    let dir = ensure_subdir(app, dir_name)?;
    let path = dir.join(normalized_name);
    if !path.exists() {
        return Err(format!("{dir_name} file not found"));
    }
    fs::remove_file(path).map_err(|e| format!("failed to delete {dir_name} file: {e}"))
}

fn rename_json_file(
    app: &AppHandle,
    dir_name: &str,
    from_name: &str,
    to_name: &str,
) -> Result<String, String> {
    let from_normalized = normalize_file_name(from_name)?;
    let to_normalized = normalize_file_name(to_name)?;
    if from_normalized == to_normalized {
        return Ok(to_normalized);
    }

    let dir = ensure_subdir(app, dir_name)?;
    let from_path = dir.join(&from_normalized);
    if !from_path.exists() {
        return Err(format!("{dir_name} file not found"));
    }

    let to_path = dir.join(&to_normalized);
    if to_path.exists() {
        fs::remove_file(&to_path)
            .map_err(|e| format!("failed to overwrite {dir_name} file: {e}"))?;
    }

    fs::rename(from_path, to_path).map_err(|e| format!("failed to rename {dir_name} file: {e}"))?;
    Ok(to_normalized)
}

#[tauri::command]
pub fn graph_list(app: AppHandle) -> Result<Vec<String>, String> {
    list_json_files(&app, "graphs")
}

#[tauri::command]
pub fn graph_save(app: AppHandle, name: String, graph: Value) -> Result<(), String> {
    write_json_file(&app, "graphs", &name, &graph)?;
    let _ = cleanup_app_runtime_noise(&app);
    Ok(())
}

#[tauri::command]
pub fn graph_load(app: AppHandle, name: String) -> Result<Value, String> {
    read_json_file(&app, "graphs", &name)
}

#[tauri::command]
pub fn graph_delete(app: AppHandle, name: String) -> Result<(), String> {
    delete_json_file(&app, "graphs", &name)
}

#[tauri::command]
pub fn graph_rename(app: AppHandle, from_name: String, to_name: String) -> Result<String, String> {
    rename_json_file(&app, "graphs", &from_name, &to_name)
}

#[tauri::command]
pub fn run_save(app: AppHandle, name: String, run: Value) -> Result<(), String> {
    write_json_file(&app, "runs", &name, &run)?;
    let _ = cleanup_app_runtime_noise(&app);
    Ok(())
}

#[tauri::command]
pub fn run_list(app: AppHandle) -> Result<Vec<String>, String> {
    list_json_files(&app, "runs")
}

#[tauri::command]
pub fn run_load(app: AppHandle, name: String) -> Result<Value, String> {
    read_json_file(&app, "runs", &name)
}

#[tauri::command]
pub fn run_delete(app: AppHandle, name: String) -> Result<(), String> {
    delete_json_file(&app, "runs", &name)
}

#[tauri::command]
pub fn run_directory(app: AppHandle) -> Result<String, String> {
    let dir = ensure_subdir(&app, "runs")?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn storage_cleanup_workspace(app: AppHandle, cwd: String) -> Result<StorageUsageSummary, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    cleanup_workspace_runtime_noise(&workspace)?;
    cleanup_app_runtime_noise(&app)?;
    build_storage_usage_summary(&app, Some(&workspace))
}

#[tauri::command]
pub fn storage_usage_summary(app: AppHandle, cwd: Option<String>) -> Result<StorageUsageSummary, String> {
    let workspace = match cwd {
        Some(value) if !value.trim().is_empty() => Some(normalize_workspace_root(&value)?),
        _ => None,
    };
    build_storage_usage_summary(&app, workspace.as_deref())
}

#[tauri::command]
pub fn task_list(cwd: String) -> Result<Vec<TaskListItem>, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    Ok(collect_task_records(&workspace)?
        .into_iter()
        .map(|record| task_list_item_from_record(&workspace, record))
        .collect())
}

pub fn task_record_list(cwd: String) -> Result<Vec<TaskRecord>, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    collect_task_records(&workspace)
}

#[tauri::command]
pub fn task_load(cwd: String, task_id: String) -> Result<TaskDetail, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let task_path = task_dir(&workspace, task_id.trim());
    let record = read_task_record_file(&task_path)?;
    Ok(task_detail_from_record(&workspace, record))
}

#[tauri::command]
pub fn task_create(
    cwd: String,
    project_path: Option<String>,
    goal: String,
    mode: Option<String>,
    team: Option<String>,
    isolation: Option<String>,
) -> Result<TaskDetail, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let project_root = match project_path.map(|value| value.trim().to_string()) {
        Some(value) if !value.is_empty() => normalize_workspace_root(&value)?,
        _ => workspace.clone(),
    };
    let normalized_goal = goal.trim();
    if normalized_goal.is_empty() {
        return Err("goal is required".to_string());
    }
    let mode = normalize_mode(mode);
    let team = normalize_team(team);
    let isolation_requested = normalize_isolation(isolation);
    let task_id = build_task_id(normalized_goal);
    let workspace_resolution = resolve_task_workspace(&project_root, &task_id, &isolation_requested);
    if isolation_requested == "worktree" && workspace_resolution.isolation_resolved != "worktree" {
        return Err(
            workspace_resolution
                .fallback_reason
                .unwrap_or_else(|| "failed to create dedicated worktree for task".to_string()),
        );
    }
    if isolation_requested == "branch" && workspace_resolution.isolation_resolved != "branch" {
        return Err(
            workspace_resolution
                .fallback_reason
                .unwrap_or_else(|| "failed to create dedicated branch for task".to_string()),
        );
    }
    let record = TaskRecord {
        task_id: task_id.clone(),
        goal: normalized_goal.to_string(),
        mode,
        team: team.clone(),
        isolation_requested,
        isolation_resolved: workspace_resolution.isolation_resolved,
        status: "active".to_string(),
        project_path: project_root.to_string_lossy().to_string(),
        workspace_path: workspace_resolution.workspace_path.to_string_lossy().to_string(),
        worktree_path: workspace_resolution.worktree_path.map(|path| path.to_string_lossy().to_string()),
        branch_name: workspace_resolution.branch_name,
        fallback_reason: workspace_resolution.fallback_reason,
        created_at: now_iso(),
        updated_at: now_iso(),
        roles: build_task_roles(&team),
        prompts: Vec::new(),
    };
    let task_path = task_dir(&workspace, &task_id);
    write_task_record_file(&task_path, &record)?;
    write_task_artifacts(&task_path, &task_artifact_defaults(&record))?;
    cleanup_workspace_runtime_noise(&workspace)?;
    Ok(task_detail_from_record(&workspace, record))
}

#[tauri::command]
pub fn task_update_artifact(
    cwd: String,
    task_id: String,
    artifact: String,
    content: String,
) -> Result<TaskDetail, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let task_id = task_id.trim();
    let artifact_key = artifact.trim().to_lowercase();
    let file_name = artifact_key_to_file_name(&artifact_key)
        .ok_or_else(|| format!("unsupported artifact: {artifact}"))?;
    let task_path = task_dir(&workspace, task_id);
    fs::write(task_path.join(file_name), content)
        .map_err(|error| format!("failed to write task artifact {file_name}: {error}"))?;
    let record = update_task_record(&workspace, task_id, |_| Ok(()))?;
    cleanup_workspace_runtime_noise(&workspace)?;
    Ok(task_detail_from_record(&workspace, record))
}

#[tauri::command]
pub fn task_send_prompt(
    cwd: String,
    task_id: String,
    target: String,
    prompt: String,
) -> Result<TaskDetail, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let task_id = task_id.trim();
    let target = target.trim().to_lowercase();
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("prompt is required".to_string());
    }
    let record = update_task_record(&workspace, task_id, |record| {
        let Some(role) = record.roles.iter_mut().find(|role| role.id == target && role.enabled) else {
            return Err(format!("task role not found: {target}"));
        };
        let created_at = now_iso();
        role.status = "running".to_string();
        role.last_prompt = Some(prompt.to_string());
        role.last_prompt_at = Some(created_at.clone());
        role.updated_at = created_at.clone();
        record.prompts.push(TaskPromptRecord {
            id: format!("{}:{}:{}", record.task_id, target, record.prompts.len() + 1),
            target: target.clone(),
            prompt: prompt.to_string(),
            created_at,
        });
        record.status = "active".to_string();
        Ok(())
    })?;
    cleanup_workspace_runtime_noise(&workspace)?;
    Ok(task_detail_from_record(&workspace, record))
}

#[tauri::command]
pub fn task_record_role_result(
    cwd: String,
    task_id: String,
    studio_role_id: String,
    run_id: String,
    run_status: String,
    artifact_paths: Vec<String>,
) -> Result<bool, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let task_path = task_dir(&workspace, task_id.trim());
    if !task_path.exists() {
        return Ok(false);
    }
    let normalized_studio_role_id = task_presets::task_agent_studio_role_id(studio_role_id.trim())
        .unwrap_or_else(|| studio_role_id.trim().to_string());
    let normalized_run_status = match run_status.trim().to_ascii_lowercase().as_str() {
        "done" | "completed" => "done".to_string(),
        "low_quality" | "degraded" => "low_quality".to_string(),
        _ => "error".to_string(),
    };
    let deduped_artifacts = artifact_paths
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| is_user_facing_task_artifact_path(path))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let mut updated = false;
    update_task_record(&workspace, task_id.trim(), |record| {
        let Some(role) = record.roles.iter_mut().find(|role| role.studio_role_id == normalized_studio_role_id) else {
            return Ok(());
        };
        role.status = normalized_run_status.clone();
        role.last_run_id = Some(run_id.trim().to_string());
        role.artifact_paths = deduped_artifacts.clone();
        role.updated_at = now_iso();
        updated = true;
        Ok(())
    })?;
    cleanup_workspace_runtime_noise(&workspace)?;
    Ok(updated)
}

fn is_user_facing_task_artifact_path(path: &str) -> bool {
    let normalized = path.trim();
    if normalized.is_empty() {
        return false;
    }
    let file_name = Path::new(normalized)
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if file_name.is_empty() {
        return false;
    }
    if matches!(
        file_name.as_str(),
        "prompt.md"
            | "response.json"
            | "response.unreadable.json"
            | "response.unreadable.debug.json"
            | "run.json"
            | "orchestration_plan.json"
            | "discussion_brief.md"
            | "discussion_direct.md"
            | "discussion_critique.md"
            | "shared_web_perspective.md"
            | "research_collection.json"
    ) {
        return false;
    }
    !file_name.starts_with("web_") || !file_name.ends_with("_response.md")
}

#[tauri::command]
pub fn task_mark_status(cwd: String, task_id: String, status: String) -> Result<TaskDetail, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let normalized_status = match status.trim().to_lowercase().as_str() {
        "active" => "active",
        "queued" => "queued",
        "completed" => "completed",
        "failed" => "failed",
        "cancelled" => "cancelled",
        "error" => "error",
        "archived" => "archived",
        _ => "active",
    };
    let record = update_task_record(&workspace, task_id.trim(), |record| {
        record.status = normalized_status.to_string();
        Ok(())
    })?;
    Ok(task_detail_from_record(&workspace, record))
}

#[tauri::command]
pub fn task_archive(cwd: String, task_id: String) -> Result<TaskDetail, String> {
    task_mark_status(cwd, task_id, "archived".to_string())
}

#[tauri::command]
pub fn workspace_write_markdown(
    cwd: String,
    name: String,
    content: String,
) -> Result<String, String> {
    let cwd_trimmed = cwd.trim();
    if cwd_trimmed.is_empty() {
        return Err("cwd is required".to_string());
    }
    let path = PathBuf::from(cwd_trimmed);
    let normalized_name = normalize_markdown_file_name(&name)?;

    fs::create_dir_all(&path).map_err(|e| format!("failed to create workspace directory: {e}"))?;
    if !path.is_dir() {
        return Err("workspace path is not a directory".to_string());
    }

    let target = path.join(normalized_name);
    fs::write(&target, content).map_err(|e| format!("failed to write markdown file: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn workspace_write_text(cwd: String, name: String, content: String) -> Result<String, String> {
    let cwd_trimmed = cwd.trim();
    if cwd_trimmed.is_empty() {
        return Err("cwd is required".to_string());
    }
    let path = PathBuf::from(cwd_trimmed);
    let normalized_name = normalize_text_file_name(&name)?;

    fs::create_dir_all(&path).map_err(|e| format!("failed to create workspace directory: {e}"))?;
    if !path.is_dir() {
        return Err("workspace path is not a directory".to_string());
    }

    let target = path.join(normalized_name);
    fs::write(&target, content).map_err(|e| format!("failed to write text file: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn workspace_append_log_line(cwd: String, name: String, line: String) -> Result<String, String> {
    let cwd_trimmed = cwd.trim();
    if cwd_trimmed.is_empty() {
        return Err("cwd is required".to_string());
    }
    let path = PathBuf::from(cwd_trimmed);
    let normalized_name = normalize_text_file_name(&name)?;

    fs::create_dir_all(&path).map_err(|e| format!("failed to create workspace directory: {e}"))?;
    if !path.is_dir() {
        return Err("workspace path is not a directory".to_string());
    }

    let target = path.join(normalized_name);
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&target)
        .map_err(|e| format!("failed to open log file for append: {e}"))?;
    let line = line.trim_end_matches(['\r', '\n']);
    writeln!(file, "{line}").map_err(|e| format!("failed to append log line: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn workspace_read_text(cwd: String, path: String) -> Result<String, String> {
    let target = normalize_workspace_file_target(&cwd, &path)?;
    fs::read_to_string(&target).map_err(|e| format!("failed to read text file: {e}"))
}

#[tauri::command]
pub fn workspace_delete_file(cwd: String, path: String) -> Result<(), String> {
    let target = normalize_workspace_file_target(&cwd, &path)?;
    fs::remove_file(&target).map_err(|e| format!("failed to delete text file: {e}"))
}

#[tauri::command]
pub async fn dialog_pick_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, mut rx) = channel::<Option<String>>(1);
    app.dialog()
        .file()
        .set_title("작업 경로 선택")
        .pick_folder(move |picked| {
            let normalized = picked
                .and_then(|path| path.into_path().ok())
                .map(|path| path.to_string_lossy().to_string());
            let _ = tx.try_send(normalized);
        });

    match rx.recv().await {
        Some(path) => Ok(path),
        None => Err("작업 경로 선택 대화상자 응답을 받지 못했습니다.".to_string()),
    }
}

#[tauri::command]
pub async fn dialog_pick_knowledge_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let (tx, mut rx) = channel::<Vec<String>>(1);
    app.dialog()
        .file()
        .set_title("첨부 자료 선택")
        .add_filter(
            "지원 파일",
            &[
                "txt", "md", "json", "csv", "ts", "tsx", "js", "jsx", "py", "rs", "go", "java",
                "cs", "html", "css", "sql", "yaml", "yml", "pdf", "docx",
            ],
        )
        .pick_files(move |picked| {
            let unique_paths = picked
                .unwrap_or_default()
                .into_iter()
                .filter_map(|path| path.into_path().ok())
                .map(|path| path.to_string_lossy().to_string())
                .filter(|path| !path.trim().is_empty())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            let _ = tx.try_send(unique_paths);
        });

    match rx.recv().await {
        Some(paths) => Ok(paths),
        None => Err("첨부 자료 선택 대화상자 응답을 받지 못했습니다.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_workspace(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("rail-storage-test-{name}-{}", Utc::now().timestamp_nanos_opt().unwrap_or_default()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn cleanup_workspace_prunes_old_runtime_noise_only() {
        let workspace = temp_workspace("cleanup");
        let raw_dir = workspace.join(".rail/dashboard/raw/topic-a");
        let via_db = workspace.join(".rail/via/app.db");
        fs::create_dir_all(&raw_dir).unwrap();
        fs::create_dir_all(via_db.parent().unwrap()).unwrap();
        fs::write(&via_db, "keep").unwrap();
        for index in 0..24 {
            let file = raw_dir.join(format!("{index}.json"));
            fs::write(&file, format!("{index}")).unwrap();
        }
        cleanup_workspace_runtime_noise(&workspace).unwrap();
        let kept = fs::read_dir(&raw_dir).unwrap().count();
        assert!(kept <= StorageGuardrailSettings::default().max_raw_items_per_topic);
        assert!(via_db.exists());
        let _ = fs::remove_dir_all(workspace);
    }

    #[test]
    fn task_create_writes_default_artifacts() {
        let workspace = temp_workspace("task-create");
        let detail = task_create(
            workspace.to_string_lossy().to_string(),
            None,
            "jump bug fix".to_string(),
            Some("balanced".to_string()),
            Some("duo".to_string()),
            Some("current-repo".to_string()),
        )
        .unwrap();
        assert_eq!(detail.record.team, "duo");
        assert_eq!(
            detail.record.project_path,
            fs::canonicalize(&workspace).unwrap().to_string_lossy().to_string()
        );
        assert!(detail.artifacts.contains_key("brief"));
        assert!(task_dir(&workspace, &detail.record.task_id).join("task.json").exists());
        let _ = fs::remove_dir_all(workspace);
    }

    #[test]
    fn task_load_normalizes_legacy_unity_role_aliases() {
        let workspace = temp_workspace("task-normalize-roles");
        let detail = task_create(
            workspace.to_string_lossy().to_string(),
            None,
            "boss arena".to_string(),
            Some("balanced".to_string()),
            Some("full-squad".to_string()),
            Some("current-repo".to_string()),
        )
        .unwrap();
        let task_path = task_dir(&workspace, &detail.record.task_id);
        let now = now_iso();
        let mut record = detail.record.clone();
        record.roles = vec![
            TaskRoleState {
                id: "explorer".to_string(),
                label: "EXPLORER".to_string(),
                studio_role_id: "pm_planner".to_string(),
                enabled: true,
                status: "running".to_string(),
                last_prompt: Some("Scope the feature".to_string()),
                last_prompt_at: Some(now.clone()),
                last_run_id: None,
                artifact_paths: Vec::new(),
                updated_at: now.clone(),
            },
            TaskRoleState {
                id: "reviewer".to_string(),
                label: "REVIEWER".to_string(),
                studio_role_id: "system_programmer".to_string(),
                enabled: true,
                status: "ready".to_string(),
                last_prompt: None,
                last_prompt_at: None,
                last_run_id: None,
                artifact_paths: Vec::new(),
                updated_at: now.clone(),
            },
            TaskRoleState {
                id: "worker".to_string(),
                label: "WORKER".to_string(),
                studio_role_id: "client_programmer".to_string(),
                enabled: true,
                status: "done".to_string(),
                last_prompt: None,
                last_prompt_at: None,
                last_run_id: Some("run-1".to_string()),
                artifact_paths: vec!["patch.md".to_string()],
                updated_at: now.clone(),
            },
            TaskRoleState {
                id: "qa".to_string(),
                label: "QA".to_string(),
                studio_role_id: "qa_engineer".to_string(),
                enabled: true,
                status: "ready".to_string(),
                last_prompt: None,
                last_prompt_at: None,
                last_run_id: None,
                artifact_paths: Vec::new(),
                updated_at: now,
            },
        ];
        write_task_record_file(&task_path, &record).unwrap();

        let loaded = task_load(
            workspace.to_string_lossy().to_string(),
            detail.record.task_id.clone(),
        )
        .unwrap();
        let ids = loaded
            .record
            .roles
            .iter()
            .map(|role| role.id.as_str())
            .collect::<Vec<_>>();

        assert!(ids.contains(&"game_designer"));
        assert!(ids.contains(&"unity_architect"));
        assert!(ids.contains(&"unity_implementer"));
        assert!(ids.contains(&"qa_playtester"));
        assert_eq!(
            loaded
                .record
                .roles
                .iter()
                .find(|role| role.id == "game_designer")
                .map(|role| role.label.as_str()),
            Some("GAME DESIGNER")
        );
        let _ = fs::remove_dir_all(workspace);
    }

    #[test]
    fn workspace_read_text_rejects_paths_outside_workspace() {
        let workspace = temp_workspace("workspace-read-guard");
        let inside = workspace.join("inside.txt");
        let outside = std::env::temp_dir().join(format!(
            "rail-storage-outside-{}.txt",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::write(&inside, "ok").unwrap();
        fs::write(&outside, "nope").unwrap();

        let inside_text = workspace_read_text(
            workspace.to_string_lossy().to_string(),
            inside.to_string_lossy().to_string(),
        )
        .unwrap();
        assert_eq!(inside_text, "ok");

        let error = workspace_read_text(
            workspace.to_string_lossy().to_string(),
            outside.to_string_lossy().to_string(),
        )
        .unwrap_err();
        assert!(error.contains("outside workspace"));

        let _ = fs::remove_dir_all(workspace);
        let _ = fs::remove_file(outside);
    }

    #[test]
    fn workspace_append_log_line_appends_without_overwriting_previous_lines() {
        let workspace = temp_workspace("workspace-append-log");
        let file_path = workspace_append_log_line(
            workspace.to_string_lossy().to_string(),
            "diagnostics.log".to_string(),
            "{\"kind\":\"first\"}".to_string(),
        )
        .unwrap();
        workspace_append_log_line(
            workspace.to_string_lossy().to_string(),
            "diagnostics.log".to_string(),
            "{\"kind\":\"second\"}".to_string(),
        )
        .unwrap();

        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "{\"kind\":\"first\"}\n{\"kind\":\"second\"}\n");

        let _ = fs::remove_dir_all(workspace);
    }

    #[test]
    fn task_record_role_result_accepts_task_agent_alias_and_returns_false_for_unknown_role() {
        let workspace = temp_workspace("task-record-role-result");
        let cwd = workspace.to_string_lossy().to_string();
        let detail = task_create(
            cwd.clone(),
            None,
            "boss arena".to_string(),
            Some("balanced".to_string()),
            Some("full-squad".to_string()),
            Some("current-repo".to_string()),
        )
        .unwrap();

        let updated = task_record_role_result(
            cwd.clone(),
            detail.record.task_id.clone(),
            "game_designer".to_string(),
            "run-123".to_string(),
            "completed".to_string(),
            vec!["/tmp/out.md".to_string()],
        )
        .unwrap();
        assert!(updated);

        let loaded = task_load(cwd.clone(), detail.record.task_id.clone()).unwrap();
        let role = loaded
            .record
            .roles
            .iter()
            .find(|role| role.id == "game_designer")
            .unwrap();
        assert_eq!(role.status, "done");
        assert_eq!(role.last_run_id.as_deref(), Some("run-123"));
        assert_eq!(role.artifact_paths, vec!["/tmp/out.md".to_string()]);

        let missing = task_record_role_result(
            cwd,
            detail.record.task_id.clone(),
            "missing_role".to_string(),
            "run-404".to_string(),
            "done".to_string(),
            vec![],
        )
        .unwrap();
        assert!(!missing);
    }

    #[test]
    fn task_record_role_result_filters_internal_runtime_artifacts() {
        let workspace = temp_workspace("task-record-role-result-filter");
        let cwd = workspace.to_string_lossy().to_string();
        let detail = task_create(
            cwd.clone(),
            None,
            "boss arena".to_string(),
            Some("balanced".to_string()),
            Some("full-squad".to_string()),
            Some("current-repo".to_string()),
        )
        .unwrap();

        let updated = task_record_role_result(
            cwd.clone(),
            detail.record.task_id.clone(),
            "game_designer".to_string(),
            "run-124".to_string(),
            "completed".to_string(),
            vec![
                "/tmp/prompt.md".to_string(),
                "/tmp/response.json".to_string(),
                "/tmp/orchestration_plan.json".to_string(),
                "/tmp/web_gpt_response.md".to_string(),
                "/tmp/final_answer.md".to_string(),
            ],
        )
        .unwrap();
        assert!(updated);

        let loaded = task_load(cwd, detail.record.task_id.clone()).unwrap();
        let role = loaded
            .record
            .roles
            .iter()
            .find(|role| role.id == "game_designer")
            .unwrap();
        assert_eq!(role.artifact_paths, vec!["/tmp/final_answer.md".to_string()]);
    }
}
