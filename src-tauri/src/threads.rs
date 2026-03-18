use crate::{storage, task_presets};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
};

fn now_iso() -> String {
    Utc::now().to_rfc3339()
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

fn rail_dir(workspace: &Path) -> PathBuf {
    workspace.join(".rail")
}

fn task_dir(workspace: &Path, thread_id: &str) -> PathBuf {
    rail_dir(workspace).join("tasks").join(thread_id)
}

fn task_record_file_path(task_dir: &Path) -> PathBuf {
    task_dir.join("task.json")
}

fn thread_record_path(task_dir: &Path) -> PathBuf {
    task_dir.join("thread.json")
}

fn thread_messages_path(task_dir: &Path) -> PathBuf {
    task_dir.join("messages.json")
}

fn thread_agents_path(task_dir: &Path) -> PathBuf {
    task_dir.join("agents.json")
}

fn thread_approvals_path(task_dir: &Path) -> PathBuf {
    task_dir.join("approvals.json")
}

fn write_json_pretty<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    let payload = serde_json::to_string_pretty(value)
        .map_err(|error| format!("failed to serialize {}: {error}", path.display()))?;
    fs::write(path, format!("{payload}\n")).map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn read_json_or_default<T>(path: &Path, default: T) -> Result<T, String>
where
    T: for<'de> Deserialize<'de> + Clone,
{
    if !path.exists() {
        return Ok(default);
    }
    let raw = fs::read_to_string(path).map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw).map_err(|error| format!("invalid json {}: {error}", path.display()))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TaskPromptView {
    id: String,
    target: String,
    prompt: String,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TaskRoleView {
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
pub struct TaskRecordView {
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
    roles: Vec<TaskRoleView>,
    prompts: Vec<TaskPromptView>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TaskDetailView {
    record: TaskRecordView,
    artifacts: BTreeMap<String, String>,
    changed_files: Vec<String>,
    validation_state: String,
    risk_level: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRecord {
    thread_id: String,
    task_id: String,
    title: String,
    user_prompt: String,
    status: String,
    cwd: String,
    branch_label: Option<String>,
    access_mode: String,
    model: String,
    reasoning: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThreadMessage {
    id: String,
    thread_id: String,
    role: String,
    content: String,
    agent_id: Option<String>,
    agent_label: Option<String>,
    source_role_id: Option<String>,
    event_kind: Option<String>,
    artifact_path: Option<String>,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundAgentRecord {
    id: String,
    thread_id: String,
    label: String,
    role_id: String,
    status: String,
    summary: Option<String>,
    worktree_path: Option<String>,
    last_updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRecord {
    id: String,
    thread_id: String,
    agent_id: String,
    kind: String,
    summary: String,
    payload: Option<Value>,
    status: String,
    created_at: String,
    updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThreadFileEntry {
    path: String,
    changed: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThreadAgentDetail {
    agent: BackgroundAgentRecord,
    studio_role_id: Option<String>,
    last_prompt: Option<String>,
    last_prompt_at: Option<String>,
    last_run_id: Option<String>,
    artifact_paths: Vec<String>,
    latest_artifact_path: Option<String>,
    latest_artifact_preview: Option<String>,
    worktree_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListItem {
    thread: ThreadRecord,
    project_path: String,
    agent_count: usize,
    pending_approval_count: usize,
    workflow_summary: ThreadWorkflowSummary,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThreadWorkflowStage {
    id: String,
    label: String,
    status: String,
    owner_preset_ids: Vec<String>,
    summary: String,
    artifact_keys: Vec<String>,
    blocker_count: usize,
    started_at: Option<String>,
    completed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThreadWorkflow {
    current_stage_id: String,
    stages: Vec<ThreadWorkflowStage>,
    next_action: String,
    readiness_summary: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThreadWorkflowSummary {
    current_stage_id: String,
    status: String,
    blocked: bool,
    pending_approval_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThreadDetail {
    thread: ThreadRecord,
    task: TaskRecordView,
    messages: Vec<ThreadMessage>,
    agents: Vec<BackgroundAgentRecord>,
    approvals: Vec<ApprovalRecord>,
    artifacts: BTreeMap<String, String>,
    changed_files: Vec<String>,
    validation_state: String,
    risk_level: String,
    files: Vec<ThreadFileEntry>,
    workflow: ThreadWorkflow,
}

fn task_detail_view(value: storage::TaskDetail) -> Result<TaskDetailView, String> {
    serde_json::from_value(serde_json::to_value(value).map_err(|error| format!("failed to encode task detail: {error}"))?)
        .map_err(|error| format!("failed to decode task detail: {error}"))
}

fn task_list_view(value: Vec<storage::TaskListItem>) -> Result<Vec<TaskRecordView>, String> {
    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TaskListItemView {
        record: TaskRecordView,
    }
    let rows: Vec<TaskListItemView> = serde_json::from_value(
        serde_json::to_value(value).map_err(|error| format!("failed to encode task list: {error}"))?,
    )
    .map_err(|error| format!("failed to decode task list: {error}"))?;
    Ok(rows.into_iter().map(|row| row.record).collect())
}

fn truncate_text(input: &str, max_len: usize) -> String {
    let trimmed = input.trim();
    if trimmed.chars().count() <= max_len {
        return trimmed.to_string();
    }
    let mut out = String::new();
    for ch in trimmed.chars().take(max_len) {
        out.push(ch);
    }
    format!("{out}…")
}

fn is_placeholder_thread_title(input: &str) -> bool {
    let normalized = input.trim().to_lowercase();
    normalized.is_empty() || normalized == "new thread" || normalized == "새 thread" || normalized == "새 스레드"
}

fn normalize_thread_title(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return "NEW THREAD".to_string();
    }
    truncate_text(trimmed, 56)
}

fn should_replace_thread_title(current_title: &str, current_prompt: &str) -> bool {
    let title = current_title.trim();
    if title.is_empty() || is_placeholder_thread_title(title) {
        return true;
    }
    let prompt = current_prompt.trim();
    !prompt.is_empty() && title == truncate_text(prompt, 56)
}

fn default_thread_record(task: &TaskRecordView, model: &str, reasoning: &str, access_mode: &str) -> ThreadRecord {
    ThreadRecord {
        thread_id: task.task_id.clone(),
        task_id: task.task_id.clone(),
        title: truncate_text(&task.goal, 56),
        user_prompt: task.goal.clone(),
        status: task.status.clone(),
        cwd: task.workspace_path.clone(),
        branch_label: task.branch_name.clone().or_else(|| Some(task.isolation_resolved.clone())),
        access_mode: access_mode.to_string(),
        model: model.to_string(),
        reasoning: reasoning.to_string(),
        created_at: task.created_at.clone(),
        updated_at: task.updated_at.clone(),
    }
}

fn default_messages(thread: &ThreadRecord) -> Vec<ThreadMessage> {
    vec![
        ThreadMessage {
            id: format!("{}:message:1", thread.thread_id),
            thread_id: thread.thread_id.clone(),
            role: "user".to_string(),
            content: thread.user_prompt.clone(),
            agent_id: None,
            agent_label: None,
            source_role_id: None,
            event_kind: Some("user_prompt".to_string()),
            artifact_path: None,
            created_at: thread.created_at.clone(),
        },
        ThreadMessage {
            id: format!("{}:message:2", thread.thread_id),
            thread_id: thread.thread_id.clone(),
            role: "assistant".to_string(),
            content: "Thread created. Ask for a follow-up and tag any agents you want to involve.".to_string(),
            agent_id: None,
            agent_label: None,
            source_role_id: None,
            event_kind: Some("thread_created".to_string()),
            artifact_path: None,
            created_at: thread.created_at.clone(),
        },
    ]
}

fn default_agents(thread: &ThreadRecord, task: &TaskRecordView) -> Vec<BackgroundAgentRecord> {
    task.roles
        .iter()
        .filter(|role| role.enabled)
        .map(|role| BackgroundAgentRecord {
            id: format!("{}:{}", thread.thread_id, role.id),
            thread_id: thread.thread_id.clone(),
            label: role.label.clone(),
            role_id: role.id.clone(),
            status: "idle".to_string(),
            summary: None,
            worktree_path: task.worktree_path.clone().or_else(|| Some(task.workspace_path.clone())),
            last_updated_at: thread.updated_at.clone(),
        })
        .collect()
}

fn default_role_label(role_id: &str) -> String {
    task_presets::task_agent_label(role_id)
}

fn default_studio_role_id(role_id: &str) -> Option<String> {
    task_presets::task_agent_studio_role_id(role_id)
}

fn role_label_for(task: &TaskRecordView, role_id: &str) -> String {
    let canonical = task_presets::canonical_task_agent_id(role_id).unwrap_or(role_id);
    task.roles
        .iter()
        .find(|role| role.id == canonical)
        .map(|role| role.label.clone())
        .unwrap_or_else(|| default_role_label(canonical))
}

fn role_instruction(_task: &TaskRecordView, role_id: &str, prompt: &str) -> String {
    task_presets::task_agent_instruction(role_id, prompt)
}

fn role_summary(role_id: &str) -> String {
    task_presets::task_agent_summary(role_id)
}

fn role_discussion_line(role_id: &str) -> String {
    task_presets::task_agent_discussion_line(role_id)
}

fn write_task_record_view(task_dir: &Path, record: &TaskRecordView) -> Result<(), String> {
    write_json_pretty(&task_record_file_path(task_dir), record)
}

fn append_message_with_meta(
    messages: &mut Vec<ThreadMessage>,
    thread_id: &str,
    role: &str,
    content: &str,
    agent_id: Option<&str>,
    agent_label: Option<&str>,
    source_role_id: Option<&str>,
    event_kind: Option<&str>,
    artifact_path: Option<&str>,
) {
    let next = messages.len() + 1;
    messages.push(ThreadMessage {
        id: format!("{thread_id}:message:{next}"),
        thread_id: thread_id.to_string(),
        role: role.to_string(),
        content: content.to_string(),
        agent_id: agent_id.map(|value| value.to_string()),
        agent_label: agent_label.map(|value| value.to_string()),
        source_role_id: source_role_id.map(|value| value.to_string()),
        event_kind: event_kind.map(|value| value.to_string()),
        artifact_path: artifact_path.map(|value| value.to_string()),
        created_at: now_iso(),
    });
}

fn append_message(messages: &mut Vec<ThreadMessage>, thread_id: &str, role: &str, content: &str) {
    append_message_with_meta(messages, thread_id, role, content, None, None, None, None, None);
}

fn enabled_roles(task: &TaskRecordView) -> Vec<String> {
    task_presets::ordered_task_agent_ids(task.roles
        .iter()
        .filter(|role| role.enabled)
        .map(|role| role.id.as_str()))
}

fn next_handoff_target(task: &TaskRecordView, role_id: &str) -> Option<String> {
    let enabled = enabled_roles(task);
    task_presets::next_task_agent_id(role_id, &enabled)
}

fn role_prompt_for_handoff(task: &TaskRecordView, from_role: &str, to_role: &str) -> String {
    format!(
        "Continue the task from {from_role} output.\n\nGoal: {}\n\nFocus for {to_role}: proceed using the latest findings and artifacts.",
        task.goal
    )
}

fn is_previewable_artifact(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase()),
        Some(extension)
            if matches!(
                extension.as_str(),
                "md" | "txt" | "json" | "yml" | "yaml" | "toml" | "log" | "cs" | "ts" | "tsx" | "js" | "jsx" | "rs"
            )
    )
}

fn truncate_preview_content(input: String) -> String {
    const LIMIT: usize = 4000;
    if input.chars().count() <= LIMIT {
        return input;
    }
    let truncated = input.chars().take(LIMIT).collect::<String>();
    format!("{truncated}\n\n...[truncated]")
}

fn resolve_artifact_preview(
    workspace: &Path,
    artifacts: &BTreeMap<String, String>,
    artifact_paths: &[String],
) -> (Option<String>, Option<String>) {
    let Some(latest_artifact_path) = artifact_paths.iter().rev().find(|path| !path.trim().is_empty()) else {
        return (None, None);
    };
    let latest_artifact_path = latest_artifact_path.trim().to_string();
    let candidate = PathBuf::from(&latest_artifact_path);
    let resolved_path = if candidate.is_absolute() {
        candidate
    } else {
        workspace.join(&latest_artifact_path)
    };

    let preview = if resolved_path.is_file() && is_previewable_artifact(&resolved_path) {
        fs::read_to_string(&resolved_path).ok().map(truncate_preview_content)
    } else {
        resolved_path
            .file_stem()
            .and_then(|value| value.to_str())
            .and_then(|key| artifacts.get(key))
            .cloned()
            .map(truncate_preview_content)
    };

    (Some(latest_artifact_path), preview)
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

fn collect_recursive_files(root: &Path, base: &Path, out: &mut Vec<String>) {
    if out.len() >= 400 || !root.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= 400 {
            break;
        }
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".git" || name == ".rail" || name == "node_modules" || name == "target" || name == "dist" {
            continue;
        }
        if path.is_dir() {
            collect_recursive_files(&path, base, out);
            continue;
        }
        if let Ok(relative) = path.strip_prefix(base) {
            out.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
}

fn thread_files_for_task(task: &TaskDetailView) -> Vec<ThreadFileEntry> {
    let workspace_path = PathBuf::from(task.record.workspace_path.trim());
    let changed = task.changed_files.iter().cloned().collect::<BTreeSet<_>>();
    let mut files = if let Some(output) = git_stdout(&workspace_path, &["ls-files"]) {
        output.lines().map(|line| line.trim().to_string()).filter(|line| !line.is_empty()).collect::<Vec<_>>()
    } else {
        let mut out = Vec::new();
        collect_recursive_files(&workspace_path, &workspace_path, &mut out);
        out
    };
    files.sort();
    files.dedup();
    files
        .into_iter()
        .take(400)
        .map(|path| ThreadFileEntry {
            changed: changed.contains(&path),
            path,
        })
        .collect()
}

fn ensure_thread_state(
    task_dir: &Path,
    task: &TaskRecordView,
    model: &str,
    reasoning: &str,
    access_mode: &str,
) -> Result<(ThreadRecord, Vec<ThreadMessage>, Vec<BackgroundAgentRecord>, Vec<ApprovalRecord>), String> {
    let mut thread = read_json_or_default(
        &thread_record_path(task_dir),
        default_thread_record(task, model, reasoning, access_mode),
    )?;
    thread.status = task.status.clone();
    thread.cwd = task.workspace_path.clone();
    thread.branch_label = task.branch_name.clone().or_else(|| Some(task.isolation_resolved.clone()));
    thread.updated_at = task.updated_at.clone();

    let messages = read_json_or_default(&thread_messages_path(task_dir), default_messages(&thread))?;
    let mut agents = read_json_or_default(&thread_agents_path(task_dir), default_agents(&thread, task))?;
    let approvals = read_json_or_default(&thread_approvals_path(task_dir), Vec::<ApprovalRecord>::new())?;
    let enabled_role_ids = enabled_roles(task);
    agents = agents
        .into_iter()
        .filter_map(|mut agent| {
            let canonical = task_presets::canonical_task_agent_id(&agent.role_id)?;
            agent.role_id = canonical.to_string();
            agent.label = task_presets::task_agent_label(canonical);
            if agent.summary.is_none() {
                agent.summary = Some(role_summary(canonical));
            }
            Some(agent)
        })
        .collect();
    agents.retain(|agent| enabled_role_ids.iter().any(|role_id| role_id == &agent.role_id));

    for role in task.roles.iter().filter(|role| role.enabled) {
        if let Some(agent) = agents.iter_mut().find(|agent| agent.role_id == role.id) {
            agent.label = role.label.clone();
            agent.worktree_path = task.worktree_path.clone().or_else(|| Some(task.workspace_path.clone()));
            agent.summary = Some(role_summary(&role.id));
        } else {
            agents.push(BackgroundAgentRecord {
                id: format!("{}:{}", thread.thread_id, role.id),
                thread_id: thread.thread_id.clone(),
                label: role.label.clone(),
                role_id: role.id.clone(),
                status: "idle".to_string(),
                summary: Some(role_summary(&role.id)),
                worktree_path: task.worktree_path.clone().or_else(|| Some(task.workspace_path.clone())),
                last_updated_at: now_iso(),
            });
        }
    }

    write_json_pretty(&thread_record_path(task_dir), &thread)?;
    write_json_pretty(&thread_messages_path(task_dir), &messages)?;
    write_json_pretty(&thread_agents_path(task_dir), &agents)?;
    write_json_pretty(&thread_approvals_path(task_dir), &approvals)?;
    Ok((thread, messages, agents, approvals))
}

fn build_thread_detail(
    task_dir: &Path,
    task: TaskDetailView,
    model: &str,
    reasoning: &str,
    access_mode: &str,
) -> Result<ThreadDetail, String> {
    let (thread, messages, agents, approvals) = ensure_thread_state(task_dir, &task.record, model, reasoning, access_mode)?;
    let files = thread_files_for_task(&task);
    let workflow = derive_thread_workflow(&thread, &task.record, &agents, &approvals, &task.artifacts, &task.changed_files, &task.validation_state);
    Ok(ThreadDetail {
        files,
        thread,
        task: task.record,
        messages,
        agents,
        approvals,
        artifacts: task.artifacts,
        changed_files: task.changed_files,
        validation_state: task.validation_state,
        risk_level: task.risk_level,
        workflow,
    })
}

fn artifact_has_user_content(content: &str) -> bool {
    content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .any(|line| !line.starts_with('#') && line != "- pending")
}

fn has_stage_activity(task: &TaskRecordView, agents: &[BackgroundAgentRecord], owners: &[&str]) -> bool {
    owners.iter().any(|owner| {
        task.roles.iter().any(|role| role.id == *owner && role.enabled && (role.last_prompt.is_some() || role.last_run_id.is_some()))
            || agents.iter().any(|agent| agent.role_id == *owner && agent.status != "idle" && agent.status != "failed")
    })
}

fn has_active_stage_activity(task: &TaskRecordView, agents: &[BackgroundAgentRecord], owners: &[&str]) -> bool {
    owners.iter().any(|owner| {
        task.roles.iter().any(|role| role.id == *owner && role.enabled && role.status == "running")
            || agents
                .iter()
                .any(|agent| agent.role_id == *owner && matches!(agent.status.as_str(), "thinking" | "awaiting_approval"))
    })
}

fn latest_stage_event_at(task: &TaskRecordView, owners: &[&str]) -> Option<String> {
    task.roles
        .iter()
        .filter(|role| owners.iter().any(|owner| *owner == role.id))
        .filter(|role| role.last_prompt_at.is_some() || role.last_run_id.is_some())
        .filter_map(|role| role.last_prompt_at.clone().or_else(|| Some(role.updated_at.clone())))
        .max()
}

fn stage_evidence_at(thread: &ThreadRecord, task: &TaskRecordView, owners: &[&str], has_evidence: bool) -> Option<String> {
    latest_stage_event_at(task, owners).or_else(|| has_evidence.then(|| thread.updated_at.clone()))
}

fn validation_satisfied(validation_state: &str) -> bool {
    matches!(
        validation_state.trim().to_lowercase().as_str(),
        "validated" | "done" | "passed" | "ready"
    )
}

fn build_workflow_stage(
    id: &str,
    label: &str,
    status: &str,
    owners: &[&str],
    summary: String,
    artifact_keys: &[&str],
    blocker_count: usize,
    thread: &ThreadRecord,
    started_at: Option<String>,
) -> ThreadWorkflowStage {
    ThreadWorkflowStage {
        id: id.to_string(),
        label: label.to_string(),
        status: status.to_string(),
        owner_preset_ids: owners.iter().map(|owner| owner.to_string()).collect(),
        summary,
        artifact_keys: artifact_keys.iter().map(|key| key.to_string()).collect(),
        blocker_count,
        started_at,
        completed_at: if status == "done" || status == "ready" {
            Some(thread.updated_at.clone())
        } else {
            None
        },
    }
}

fn derive_thread_workflow(
    thread: &ThreadRecord,
    task: &TaskRecordView,
    agents: &[BackgroundAgentRecord],
    approvals: &[ApprovalRecord],
    artifacts: &BTreeMap<String, String>,
    changed_files: &[String],
    validation_state: &str,
) -> ThreadWorkflow {
    let approvals_pending = approvals.iter().filter(|approval| approval.status == "pending").count();
    let brief_done = !is_placeholder_thread_title(&thread.user_prompt) || !is_placeholder_thread_title(&task.goal);
    let design_done = artifact_has_user_content(artifacts.get("findings").map(String::as_str).unwrap_or(""))
        || artifact_has_user_content(artifacts.get("plan").map(String::as_str).unwrap_or(""))
        || has_stage_activity(task, agents, &["game_designer", "level_designer", "unity_architect"]);
    let implement_done = !changed_files.is_empty()
        || artifact_has_user_content(artifacts.get("patch").map(String::as_str).unwrap_or(""))
        || has_stage_activity(task, agents, &["unity_implementer", "unity_editor_tools"]);
    let integrate_evidence = !approvals.is_empty()
        || artifact_has_user_content(artifacts.get("handoff").map(String::as_str).unwrap_or(""))
        || has_stage_activity(task, agents, &["unity_architect", "technical_artist", "release_steward"]);
    let integrate_done = integrate_evidence && approvals_pending == 0;
    let playtest_done = validation_satisfied(validation_state)
        || artifact_has_user_content(artifacts.get("validation").map(String::as_str).unwrap_or(""))
        || has_stage_activity(task, agents, &["qa_playtester"]);
    let handoff_ready = artifact_has_user_content(artifacts.get("handoff").map(String::as_str).unwrap_or(""));
    let design_active = has_active_stage_activity(task, agents, &["game_designer", "level_designer", "unity_architect"]);
    let implement_active = has_active_stage_activity(task, agents, &["unity_implementer", "unity_editor_tools"]);
    let integrate_active = has_active_stage_activity(task, agents, &["unity_architect", "technical_artist", "release_steward"]);
    let playtest_active = has_active_stage_activity(task, agents, &["qa_playtester"]);
    let readiness_checks = [implement_done, playtest_done, handoff_ready]
        .into_iter()
        .filter(|value| *value)
        .count();
    let lock_ready = approvals_pending == 0 && readiness_checks == 3;

    let latest_evidence_stage_id = [
        ("brief", if brief_done { Some(thread.updated_at.clone()) } else { None }),
        ("design", stage_evidence_at(thread, task, &["game_designer", "level_designer", "unity_architect"], design_done)),
        ("implement", stage_evidence_at(thread, task, &["unity_implementer", "unity_editor_tools"], implement_done)),
        ("integrate", stage_evidence_at(thread, task, &["unity_architect", "technical_artist", "release_steward"], integrate_evidence)),
        ("playtest", stage_evidence_at(thread, task, &["qa_playtester"], playtest_done)),
        ("lock", if lock_ready { Some(thread.updated_at.clone()) } else { None }),
    ]
    .into_iter()
    .enumerate()
    .filter_map(|(index, (stage_id, timestamp))| timestamp.map(|value| (stage_id, value, index)))
    .max_by(|left, right| left.1.cmp(&right.1).then(left.2.cmp(&right.2)))
    .map(|(stage_id, _, _)| stage_id);

    let current_stage_id = if approvals_pending > 0 {
        "integrate"
    } else if !brief_done {
        "brief"
    } else if design_active {
        "design"
    } else if implement_active {
        "implement"
    } else if integrate_active {
        "integrate"
    } else if playtest_active {
        "playtest"
    } else if lock_ready {
        "lock"
    } else {
        latest_evidence_stage_id.unwrap_or("brief")
    };

    let stages = vec![
        build_workflow_stage(
            "brief",
            "BRIEF",
            if current_stage_id == "brief" && !brief_done {
                "active"
            } else if brief_done {
                "done"
            } else {
                "idle"
            },
            &["game_designer"],
            if brief_done {
                thread.user_prompt.clone()
            } else {
                "Define the Unity task scope and target system.".to_string()
            },
            &["brief"],
            0,
            thread,
            if brief_done { Some(thread.updated_at.clone()) } else { None },
        ),
        build_workflow_stage(
            "design",
            "DESIGN",
            if design_active {
                "active"
            } else if design_done {
                "done"
            } else {
                "idle"
            },
            &["game_designer", "level_designer", "unity_architect"],
            if design_done {
                "Design notes and findings captured.".to_string()
            } else {
                "Capture system flow, scene intent, and open design questions.".to_string()
            },
            &["findings", "plan"],
            0,
            thread,
            stage_evidence_at(thread, task, &["game_designer", "level_designer", "unity_architect"], design_done),
        ),
        build_workflow_stage(
            "implement",
            "IMPLEMENT",
            if implement_active {
                "active"
            } else if implement_done {
                "done"
            } else {
                "idle"
            },
            &["unity_implementer", "unity_editor_tools"],
            if !changed_files.is_empty() {
                format!("{} changed files ready for inspection.", changed_files.len())
            } else if artifact_has_user_content(artifacts.get("patch").map(String::as_str).unwrap_or("")) {
                "Implementation artifacts captured for review.".to_string()
            } else {
                "No implementation artifacts yet.".to_string()
            },
            &["patch"],
            0,
            thread,
            stage_evidence_at(thread, task, &["unity_implementer", "unity_editor_tools"], implement_done),
        ),
        build_workflow_stage(
            "integrate",
            "INTEGRATE",
            if approvals_pending > 0 {
                "blocked"
            } else if integrate_active {
                "active"
            } else if integrate_done {
                "done"
            } else {
                "idle"
            },
            &["unity_architect", "technical_artist", "release_steward"],
            if approvals_pending > 0 {
                format!("{approvals_pending} approvals are blocking integration.")
            } else {
                "Integration, handoff, and release checks are clear so far.".to_string()
            },
            &["handoff"],
            approvals_pending,
            thread,
            stage_evidence_at(thread, task, &["unity_architect", "technical_artist", "release_steward"], integrate_evidence),
        ),
        build_workflow_stage(
            "playtest",
            "PLAYTEST",
            if playtest_active {
                "active"
            } else if playtest_done {
                "done"
            } else {
                "idle"
            },
            &["qa_playtester"],
            format!("Validation is {}.", validation_state.to_uppercase()),
            &["validation"],
            0,
            thread,
            stage_evidence_at(thread, task, &["qa_playtester"], playtest_done),
        ),
        build_workflow_stage(
            "lock",
            "LOCK",
            if lock_ready {
                "ready"
            } else {
                "idle"
            },
            &["handoff_writer", "release_steward"],
            format!("{readiness_checks}/3 readiness checks satisfied."),
            &["handoff", "validation"],
            0,
            thread,
            if lock_ready { Some(thread.updated_at.clone()) } else { None },
        ),
    ];

    ThreadWorkflow {
        current_stage_id: current_stage_id.to_string(),
        stages,
        next_action: match current_stage_id {
            "brief" => "Clarify the Unity feature, target scene, and constraints.".to_string(),
            "design" => "Capture design notes, system boundaries, and open questions.".to_string(),
            "implement" => "Ship the code, data, prefab, or editor changes for review.".to_string(),
            "integrate" if approvals_pending > 0 => "Resolve approvals to unblock integration.".to_string(),
            "integrate" => "Tie together assets, systems, and handoff notes.".to_string(),
            "playtest" => "Run validation and playtest checks before lock.".to_string(),
            "lock" if lock_ready => "Task is ready to hand off or merge.".to_string(),
            _ => "Complete validation and handoff notes to reach lock.".to_string(),
        },
        readiness_summary: format!("LOCK {} · {readiness_checks}/3 checks", if lock_ready { "READY" } else { "PENDING" }),
    }
}

fn workflow_summary(workflow: &ThreadWorkflow, pending_approval_count: usize) -> ThreadWorkflowSummary {
    let current_stage = workflow
        .stages
        .iter()
        .find(|stage| stage.id == workflow.current_stage_id)
        .cloned()
        .unwrap_or_else(|| workflow.stages[0].clone());
    ThreadWorkflowSummary {
        current_stage_id: workflow.current_stage_id.clone(),
        status: current_stage.status,
        blocked: workflow.stages.iter().any(|stage| stage.status == "blocked"),
        pending_approval_count,
    }
}

fn normalize_project_path(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let candidate = PathBuf::from(trimmed);
    let resolved = if candidate.exists() {
        fs::canonicalize(&candidate).unwrap_or(candidate)
    } else {
        candidate
    };
    resolved
        .to_string_lossy()
        .trim()
        .trim_end_matches(['/', '\\'])
        .to_string()
}

fn task_matches_project(task: &TaskRecordView, project_path: Option<&str>) -> bool {
    let Some(project_path) = project_path.map(normalize_project_path).filter(|value| !value.is_empty()) else {
        return true;
    };
    let task_project_path = normalize_project_path(&task.project_path);
    if !task_project_path.is_empty() && task_project_path == project_path {
        return true;
    }
    let workspace_path = normalize_project_path(&task.workspace_path);
    let worktree_path = task.worktree_path.as_deref().map(normalize_project_path);
    workspace_path == project_path || worktree_path.as_deref() == Some(project_path.as_str())
}

fn default_run_roles(task: &TaskRecordView, requested_roles: &[String]) -> Vec<String> {
    let enabled = enabled_roles(task);
    task_presets::default_run_task_agent_ids(&enabled, requested_roles)
}

fn update_agent_statuses(
    agents: &mut [BackgroundAgentRecord],
    selected_roles: &[String],
    workspace_path: &str,
    discussion_mode: bool,
) {
    let now = now_iso();
    for (index, role_id) in selected_roles.iter().enumerate() {
        if let Some(agent) = agents.iter_mut().find(|agent| &agent.role_id == role_id) {
            agent.status = if discussion_mode || index == 0 {
                "thinking".to_string()
            } else {
                "awaiting_approval".to_string()
            };
            agent.summary = Some(role_summary(role_id));
            agent.worktree_path = Some(workspace_path.to_string());
            agent.last_updated_at = now.clone();
        }
    }
}

fn create_approval_record(thread_id: &str, agent_id: &str, kind: &str, summary: &str, payload: Value, index: usize) -> ApprovalRecord {
    ApprovalRecord {
        id: format!("{thread_id}:approval:{}", index + 1),
        thread_id: thread_id.to_string(),
        agent_id: agent_id.to_string(),
        kind: kind.to_string(),
        summary: summary.to_string(),
        payload: Some(payload),
        status: "pending".to_string(),
        created_at: now_iso(),
        updated_at: None,
    }
}

#[tauri::command]
pub fn thread_list(cwd: String, project_path: Option<String>) -> Result<Vec<ThreadListItem>, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let task_records = task_list_view(storage::task_list(cwd.clone())?)?
        .into_iter()
        .filter(|task| task.status != "archived")
        .filter(|task| task_matches_project(task, project_path.as_deref()))
        .collect::<Vec<_>>();
    let mut threads = Vec::new();
    for task in task_records {
        let detail = build_thread_detail(&task_dir(&workspace, &task.task_id), task_detail_view(storage::task_load(cwd.clone(), task.task_id.clone())?)?, "5.4", "중간", "Local")?;
        threads.push(ThreadListItem {
            project_path: if detail.task.project_path.trim().is_empty() {
                detail.task.workspace_path.clone()
            } else {
                detail.task.project_path.clone()
            },
            pending_approval_count: detail.approvals.iter().filter(|approval| approval.status == "pending").count(),
            agent_count: detail.agents.len(),
            workflow_summary: workflow_summary(&detail.workflow, detail.approvals.iter().filter(|approval| approval.status == "pending").count()),
            thread: detail.thread,
        });
    }
    threads.sort_by(|left, right| right.thread.updated_at.cmp(&left.thread.updated_at));
    Ok(threads)
}

#[tauri::command]
pub fn thread_delete(cwd: String, thread_id: String) -> Result<bool, String> {
    let thread_id = thread_id.trim().to_string();
    if thread_id.is_empty() {
        return Err("threadId is required".to_string());
    }
    let _ = storage::task_archive(cwd, thread_id)?;
    Ok(true)
}

#[tauri::command]
pub fn thread_add_agent(
    cwd: String,
    thread_id: String,
    role_id: String,
    label: Option<String>,
) -> Result<ThreadDetail, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let thread_id = thread_id.trim().to_string();
    let normalized_role_id = task_presets::canonical_task_agent_id(&role_id)
        .ok_or_else(|| format!("unsupported role id: {role_id}"))?
        .to_string();
    if thread_id.is_empty() {
        return Err("threadId is required".to_string());
    }
    let Some(studio_role_id) = default_studio_role_id(&normalized_role_id) else {
        return Err(format!("unsupported role id: {role_id}"));
    };
    let task_path = task_dir(&workspace, &thread_id);
    let mut task = task_detail_view(storage::task_load(cwd, thread_id.clone())?)?;
    let desired_label = label
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default_role_label(&normalized_role_id));

    if let Some(role) = task.record.roles.iter_mut().find(|role| role.id == normalized_role_id) {
        role.enabled = true;
        role.label = desired_label;
        role.updated_at = now_iso();
    } else {
        task.record.roles.push(TaskRoleView {
            id: normalized_role_id.clone(),
            label: desired_label,
            studio_role_id,
            enabled: true,
            status: "idle".to_string(),
            last_prompt: None,
            last_prompt_at: None,
            last_run_id: None,
            artifact_paths: Vec::new(),
            updated_at: now_iso(),
        });
    }
    task.record.updated_at = now_iso();
    write_task_record_view(&task_path, &task.record)?;
    storage::cleanup_workspace_runtime_noise(&workspace)?;
    build_thread_detail(&task_path, task, "5.4", "MEDIUM", "Local")
}

#[tauri::command]
pub fn thread_update_agent(
    cwd: String,
    thread_id: String,
    agent_id: String,
    label: Option<String>,
) -> Result<ThreadDetail, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let thread_id = thread_id.trim().to_string();
    let agent_id = agent_id.trim().to_string();
    if thread_id.is_empty() {
        return Err("threadId is required".to_string());
    }
    if agent_id.is_empty() {
        return Err("agentId is required".to_string());
    }
    let normalized_role_id = agent_id
        .split(':')
        .next_back()
        .unwrap_or_default()
        .trim();
    let normalized_role_id = task_presets::canonical_task_agent_id(normalized_role_id)
        .ok_or_else(|| format!("unknown agent id: {agent_id}"))?
        .to_string();
    let task_path = task_dir(&workspace, &thread_id);
    let mut task = task_detail_view(storage::task_load(cwd, thread_id.clone())?)?;
    let desired_label = label
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default_role_label(&normalized_role_id));
    let Some(role) = task.record.roles.iter_mut().find(|role| role.id == normalized_role_id) else {
        return Err(format!("unknown agent id: {agent_id}"));
    };
    role.label = desired_label;
    role.updated_at = now_iso();
    task.record.updated_at = now_iso();
    write_task_record_view(&task_path, &task.record)?;
    build_thread_detail(&task_path, task, "5.4", "MEDIUM", "Local")
}

#[tauri::command]
pub fn thread_remove_agent(cwd: String, thread_id: String, agent_id: String) -> Result<ThreadDetail, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let thread_id = thread_id.trim().to_string();
    let agent_id = agent_id.trim().to_string();
    if thread_id.is_empty() {
        return Err("threadId is required".to_string());
    }
    if agent_id.is_empty() {
        return Err("agentId is required".to_string());
    }
    let normalized_role_id = agent_id
        .split(':')
        .next_back()
        .unwrap_or_default()
        .trim();
    let normalized_role_id = task_presets::canonical_task_agent_id(normalized_role_id)
        .ok_or_else(|| format!("unknown agent id: {agent_id}"))?
        .to_string();
    let task_path = task_dir(&workspace, &thread_id);
    let mut task = task_detail_view(storage::task_load(cwd, thread_id.clone())?)?;
    let Some(role) = task.record.roles.iter_mut().find(|role| role.id == normalized_role_id) else {
        return Err(format!("unknown agent id: {agent_id}"));
    };
    role.enabled = false;
    role.status = "disabled".to_string();
    role.updated_at = now_iso();
    task.record.updated_at = now_iso();
    write_task_record_view(&task_path, &task.record)?;
    build_thread_detail(&task_path, task, "5.4", "MEDIUM", "Local")
}

#[tauri::command]
pub fn thread_create(
    cwd: String,
    project_path: Option<String>,
    prompt: String,
    mode: Option<String>,
    team: Option<String>,
    isolation: Option<String>,
    model: Option<String>,
    reasoning: Option<String>,
    access_mode: Option<String>,
) -> Result<ThreadDetail, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("prompt is required".to_string());
    }
    let workspace = normalize_workspace_root(&cwd)?;
    let task = task_detail_view(storage::task_create(cwd.clone(), project_path, prompt.to_string(), mode, team, isolation)?)?;
    let task_path = task_dir(&workspace, &task.record.task_id);
    let thread = default_thread_record(
        &task.record,
        model.as_deref().unwrap_or("5.4"),
        reasoning.as_deref().unwrap_or("MEDIUM"),
        access_mode.as_deref().unwrap_or("Local"),
    );
    write_json_pretty(&thread_record_path(&task_path), &thread)?;
    write_json_pretty(&thread_messages_path(&task_path), &default_messages(&thread))?;
    write_json_pretty(&thread_agents_path(&task_path), &default_agents(&thread, &task.record))?;
    write_json_pretty(&thread_approvals_path(&task_path), &Vec::<ApprovalRecord>::new())?;
    storage::cleanup_workspace_runtime_noise(&workspace)?;
    build_thread_detail(&task_path, task, &thread.model, &thread.reasoning, &thread.access_mode)
}

#[tauri::command]
pub fn thread_load(cwd: String, thread_id: String) -> Result<ThreadDetail, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let thread_id = thread_id.trim().to_string();
    let task = task_detail_view(storage::task_load(cwd.clone(), thread_id.clone())?)?;
    build_thread_detail(&task_dir(&workspace, &thread_id), task, "5.4", "MEDIUM", "Local")
}

#[tauri::command]
pub fn thread_append_message(cwd: String, thread_id: String, role: String, content: String) -> Result<ThreadDetail, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let thread_id = thread_id.trim().to_string();
    let content = content.trim();
    if content.is_empty() {
        return Err("content is required".to_string());
    }
    let task = task_detail_view(storage::task_load(cwd.clone(), thread_id.clone())?)?;
    let task_path = task_dir(&workspace, &thread_id);
    let (mut thread, mut messages, agents, approvals) = ensure_thread_state(&task_path, &task.record, "5.4", "MEDIUM", "Local")?;
    append_message(&mut messages, &thread.thread_id, role.trim(), content);
    thread.updated_at = now_iso();
    if role.trim().eq_ignore_ascii_case("user") {
        let should_update_title = should_replace_thread_title(&thread.title, &thread.user_prompt);
        thread.user_prompt = content.to_string();
        if should_update_title {
            thread.title = normalize_thread_title(content);
        }
    }
    write_json_pretty(&thread_record_path(&task_path), &thread)?;
    write_json_pretty(&thread_messages_path(&task_path), &messages)?;
    write_json_pretty(&thread_agents_path(&task_path), &agents)?;
    write_json_pretty(&thread_approvals_path(&task_path), &approvals)?;
    build_thread_detail(&task_path, task, &thread.model, &thread.reasoning, &thread.access_mode)
}

#[tauri::command]
pub fn thread_rename(cwd: String, thread_id: String, title: String) -> Result<ThreadDetail, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let thread_id = thread_id.trim().to_string();
    if thread_id.is_empty() {
        return Err("threadId is required".to_string());
    }
    let task = task_detail_view(storage::task_load(cwd.clone(), thread_id.clone())?)?;
    let task_path = task_dir(&workspace, &thread_id);
    let (mut thread, messages, agents, approvals) = ensure_thread_state(&task_path, &task.record, "5.4", "MEDIUM", "Local")?;
    thread.title = normalize_thread_title(&title);
    thread.updated_at = now_iso();
    write_json_pretty(&thread_record_path(&task_path), &thread)?;
    write_json_pretty(&thread_messages_path(&task_path), &messages)?;
    write_json_pretty(&thread_agents_path(&task_path), &agents)?;
    write_json_pretty(&thread_approvals_path(&task_path), &approvals)?;
    build_thread_detail(&task_path, task, &thread.model, &thread.reasoning, &thread.access_mode)
}

#[tauri::command]
pub fn thread_spawn_agents(
    cwd: String,
    thread_id: String,
    prompt: String,
    roles: Vec<String>,
    suppress_approval: Option<bool>,
) -> Result<ThreadDetail, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let thread_id = thread_id.trim().to_string();
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("prompt is required".to_string());
    }
    let mut task = task_detail_view(storage::task_load(cwd.clone(), thread_id.clone())?)?;
    let selected_roles = default_run_roles(&task.record, &roles);
    for role_id in &selected_roles {
        let updated = storage::task_send_prompt(cwd.clone(), thread_id.clone(), role_id.clone(), prompt.to_string())?;
        task = task_detail_view(updated)?;
    }
    let task_path = task_dir(&workspace, &thread_id);
    let (mut thread, mut messages, mut agents, mut approvals) = ensure_thread_state(&task_path, &task.record, "5.4", "MEDIUM", "Local")?;
    let discussion_mode = suppress_approval.unwrap_or(false);
    update_agent_statuses(&mut agents, &selected_roles, &task.record.workspace_path, discussion_mode);

    for role_id in &selected_roles {
        let label = role_label_for(&task.record, role_id);
        let agent_id = format!("{}:{}", thread.thread_id, role_id);
        append_message_with_meta(
            &mut messages,
            &thread.thread_id,
            "assistant",
            &format!("Created {label} with instructions: {}", role_instruction(&task.record, role_id, prompt)),
            Some(agent_id.as_str()),
            Some(label.as_str()),
            Some(role_id.as_str()),
            Some("agent_created"),
            None,
        );
    }
    for role_id in &selected_roles {
        let label = role_label_for(&task.record, role_id);
        let agent_id = format!("{}:{}", thread.thread_id, role_id);
        append_message_with_meta(
            &mut messages,
            &thread.thread_id,
            "assistant",
            &role_discussion_line(role_id),
            Some(agent_id.as_str()),
            Some(label.as_str()),
            Some(role_id.as_str()),
            Some("agent_status"),
            None,
        );
    }

    if selected_roles.len() >= 2 && !discussion_mode {
        let from_role = selected_roles[0].clone();
        let target_role = selected_roles[1].clone();
        let already_pending = approvals.iter().any(|approval| {
            approval.status == "pending"
                && approval
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.get("targetRole"))
                    .and_then(Value::as_str)
                    == Some(target_role.as_str())
        });
        if !already_pending {
            approvals.push(create_approval_record(
                &thread.thread_id,
                &format!("{}:{}", thread.thread_id, from_role),
                "handoff",
                &format!(
                    "Approve handoff from {} to {}.",
                    role_label_for(&task.record, &from_role),
                    role_label_for(&task.record, &target_role)
                ),
                json!({
                    "fromRole": from_role,
                    "targetRole": target_role,
                    "prompt": role_prompt_for_handoff(
                        &task.record,
                        &role_label_for(&task.record, &selected_roles[0]),
                        &role_label_for(&task.record, &selected_roles[1]),
                    )
                }),
                approvals.len(),
            ));
        }
    }

    append_message_with_meta(
        &mut messages,
        &thread.thread_id,
        "assistant",
        &format!(
            "{} background agents are running now. I will wait for their updates and then synthesize the answer into one response.",
            selected_roles.len()
        ),
        None,
        None,
        None,
        Some("agent_batch_running"),
        None,
    );
    thread.status = "active".to_string();
    thread.updated_at = now_iso();
    write_json_pretty(&thread_record_path(&task_path), &thread)?;
    write_json_pretty(&thread_messages_path(&task_path), &messages)?;
    write_json_pretty(&thread_agents_path(&task_path), &agents)?;
    write_json_pretty(&thread_approvals_path(&task_path), &approvals)?;
    storage::cleanup_workspace_runtime_noise(&workspace)?;
    build_thread_detail(&task_path, task, &thread.model, &thread.reasoning, &thread.access_mode)
}

#[tauri::command]
pub fn thread_list_agents(cwd: String, thread_id: String) -> Result<Vec<BackgroundAgentRecord>, String> {
    Ok(thread_load(cwd, thread_id)?.agents)
}

#[tauri::command]
pub fn thread_open_agent_detail(cwd: String, thread_id: String, agent_id: String) -> Result<ThreadAgentDetail, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let detail = thread_load(cwd, thread_id)?;
    let agent = detail
        .agents
        .iter()
        .find(|row| row.id == agent_id.trim())
        .cloned()
        .ok_or_else(|| format!("unknown agent id: {agent_id}"))?;
    let task_role = detail
        .task
        .roles
        .iter()
        .find(|row| row.id == agent.role_id)
        .cloned();
    let artifact_paths = task_role.as_ref().map(|row| row.artifact_paths.clone()).unwrap_or_default();
    let (latest_artifact_path, latest_artifact_preview) =
        resolve_artifact_preview(&workspace, &detail.artifacts, &artifact_paths);
    Ok(ThreadAgentDetail {
        agent,
        studio_role_id: task_role.as_ref().map(|row| row.studio_role_id.clone()),
        last_prompt: task_role.as_ref().and_then(|row| row.last_prompt.clone()),
        last_prompt_at: task_role.as_ref().and_then(|row| row.last_prompt_at.clone()),
        last_run_id: task_role.as_ref().and_then(|row| row.last_run_id.clone()),
        artifact_paths,
        latest_artifact_path,
        latest_artifact_preview,
        worktree_path: detail.task.worktree_path.clone().or_else(|| Some(detail.task.workspace_path.clone())),
    })
}

#[tauri::command]
pub fn thread_create_approval(
    cwd: String,
    thread_id: String,
    agent_id: String,
    kind: String,
    summary: String,
    payload: Option<Value>,
) -> Result<ThreadDetail, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let thread_id = thread_id.trim().to_string();
    let mut detail = task_detail_view(storage::task_load(cwd.clone(), thread_id.clone())?)?;
    let task_path = task_dir(&workspace, &thread_id);
    let (thread, messages, agents, mut approvals) = ensure_thread_state(&task_path, &detail.record, "5.4", "중간", "Local")?;
    approvals.push(create_approval_record(
        &thread.thread_id,
        agent_id.trim(),
        kind.trim(),
        summary.trim(),
        payload.unwrap_or_else(|| json!({})),
        approvals.len(),
    ));
    write_json_pretty(&thread_approvals_path(&task_path), &approvals)?;
    detail = task_detail_view(storage::task_load(cwd, thread_id.clone())?)?;
    write_json_pretty(&thread_messages_path(&task_path), &messages)?;
    write_json_pretty(&thread_agents_path(&task_path), &agents)?;
    build_thread_detail(&task_path, detail, &thread.model, &thread.reasoning, &thread.access_mode)
}

#[tauri::command]
pub fn thread_resolve_approval(cwd: String, thread_id: String, approval_id: String, decision: String) -> Result<ThreadDetail, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let thread_id = thread_id.trim().to_string();
    let task = task_detail_view(storage::task_load(cwd.clone(), thread_id.clone())?)?;
    let task_path = task_dir(&workspace, &thread_id);
    let (mut thread, mut messages, mut agents, mut approvals) = ensure_thread_state(&task_path, &task.record, "5.4", "MEDIUM", "Local")?;
    let normalized = if decision.trim().eq_ignore_ascii_case("approved") {
        "approved"
    } else {
        "rejected"
    };
    let mut target_role = String::new();
    for approval in approvals.iter_mut() {
        if approval.id == approval_id.trim() {
            approval.status = normalized.to_string();
            approval.updated_at = Some(now_iso());
            target_role = approval
                .payload
                .as_ref()
                .and_then(|payload| payload.get("targetRole"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
        }
    }
    if let Some(canonical_target_role) = task_presets::canonical_task_agent_id(&target_role) {
        target_role = canonical_target_role.to_string();
    }
    if !target_role.is_empty() {
        for agent in agents.iter_mut() {
            if agent.role_id == target_role {
                agent.status = if normalized == "approved" { "thinking".to_string() } else { "idle".to_string() };
                agent.last_updated_at = now_iso();
            }
        }
    }
    let approval_message = if normalized == "approved" {
        format!("Approval granted. {} is continuing the work.", role_label_for(&task.record, &target_role))
    } else {
        "Approval rejected. Waiting for a new direction.".to_string()
    };
    append_message_with_meta(
        &mut messages,
        &thread.thread_id,
        "assistant",
        &approval_message,
        (!target_role.is_empty()).then_some(format!("{}:{}", thread.thread_id, target_role)).as_deref(),
        (!target_role.is_empty()).then_some(role_label_for(&task.record, &target_role)).as_deref(),
        (!target_role.is_empty()).then_some(target_role.as_str()),
        Some(if normalized == "approved" { "approval_approved" } else { "approval_rejected" }),
        None,
    );
    thread.updated_at = now_iso();
    write_json_pretty(&thread_record_path(&task_path), &thread)?;
    write_json_pretty(&thread_messages_path(&task_path), &messages)?;
    write_json_pretty(&thread_agents_path(&task_path), &agents)?;
    write_json_pretty(&thread_approvals_path(&task_path), &approvals)?;
    build_thread_detail(&task_path, task, &thread.model, &thread.reasoning, &thread.access_mode)
}

#[tauri::command]
pub fn thread_record_role_result(
    cwd: String,
    thread_id: String,
    studio_role_id: String,
    run_id: String,
    run_status: String,
    artifact_paths: Vec<String>,
    summary: Option<String>,
    internal: Option<bool>,
) -> Result<bool, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let thread_id = thread_id.trim().to_string();
    if !storage::task_record_role_result(
        cwd.clone(),
        thread_id.clone(),
        studio_role_id.clone(),
        run_id.clone(),
        run_status.clone(),
        artifact_paths.clone(),
    )? {
        return Ok(false);
    }
    let task = task_detail_view(storage::task_load(cwd.clone(), thread_id.clone())?)?;
    let task_path = task_dir(&workspace, &thread_id);
    let (mut thread, mut messages, mut agents, mut approvals) = ensure_thread_state(&task_path, &task.record, "5.4", "MEDIUM", "Local")?;
    let is_internal = internal.unwrap_or(false);

    let Some(task_role) = task.record.roles.iter().find(|role| role.studio_role_id == studio_role_id.trim()) else {
        return Ok(true);
    };

    let agent_id = format!("{}:{}", thread.thread_id, task_role.id);
    for agent in agents.iter_mut() {
        if agent.id == agent_id {
            agent.status = if run_status.trim().eq_ignore_ascii_case("done") {
                "done".to_string()
            } else {
                "failed".to_string()
            };
            agent.summary = Some(summary.clone().unwrap_or_else(|| {
                if artifact_paths.is_empty() {
                    format!("{} completed", task_role.label)
                } else {
                    format!("{} produced {} artifacts", task_role.label, artifact_paths.len())
                }
            }));
            agent.last_updated_at = now_iso();
        }
    }

    let latest_artifact_path = artifact_paths
        .iter()
        .rev()
        .find(|path| !path.trim().is_empty())
        .map(|path| path.trim().to_string());
    append_message_with_meta(
        &mut messages,
        &thread.thread_id,
        "assistant",
        &summary.clone().unwrap_or_else(|| {
            format!(
                "{} {}.",
                task_role.label,
                if run_status.trim().eq_ignore_ascii_case("done") {
                    "completed"
                } else {
                    "failed"
                }
            )
        }),
        Some(agent_id.as_str()),
        Some(task_role.label.as_str()),
        Some(task_role.id.as_str()),
        Some(if run_status.trim().eq_ignore_ascii_case("done") {
            "agent_result"
        } else {
            "agent_failed"
        }),
        latest_artifact_path.as_deref(),
    );

    if run_status.trim().eq_ignore_ascii_case("done") && !is_internal {
        let mut created_handoff = false;
        if let Some(target_role) = next_handoff_target(&task.record, &task_role.id) {
            let target_already_started = task
                .record
                .roles
                .iter()
                .find(|role| role.id == target_role)
                .map(|role| {
                    !matches!(role.status.trim().to_lowercase().as_str(), "" | "idle")
                        || role.last_run_id.as_ref().is_some_and(|value| !value.trim().is_empty())
                })
                .unwrap_or(false);
            let already_pending = approvals.iter().any(|approval| {
                approval.status == "pending"
                    && approval
                        .payload
                        .as_ref()
                        .and_then(|payload| payload.get("targetRole"))
                        .and_then(Value::as_str)
                        == Some(target_role.as_str())
            });
            if !already_pending && !target_already_started {
                let target_label = role_label_for(&task.record, &target_role);
                let payload = json!({
                    "fromRole": task_role.id,
                    "targetRole": target_role,
                    "prompt": role_prompt_for_handoff(&task.record, &task_role.label, &target_label),
                });
                approvals.push(create_approval_record(
                    &thread.thread_id,
                    &agent_id,
                    "handoff",
                    &format!("Approve handoff from {} to {}.", task_role.label, target_label),
                    payload,
                    approvals.len(),
                ));
                for agent in agents.iter_mut() {
                    if agent.role_id == target_role {
                        agent.status = "awaiting_approval".to_string();
                        agent.last_updated_at = now_iso();
                    }
                }
                append_message_with_meta(
                    &mut messages,
                    &thread.thread_id,
                    "system",
                    &format!("Approval required to hand off from {} to {}.", task_role.label, target_label),
                    Some(agent_id.as_str()),
                    Some(task_role.label.as_str()),
                    Some(task_role.id.as_str()),
                    Some("handoff_required"),
                    latest_artifact_path.as_deref(),
                );
                created_handoff = true;
            }
        }
        if !created_handoff {
            append_message_with_meta(
                &mut messages,
                &thread.thread_id,
                "assistant",
                "I have consolidated the latest background agent output into this thread. Review the artifacts and changed files for the next step.",
                Some(agent_id.as_str()),
                Some(task_role.label.as_str()),
                Some(task_role.id.as_str()),
                Some("thread_synthesis_ready"),
                latest_artifact_path.as_deref(),
            );
        }
    }

    thread.updated_at = now_iso();
    write_json_pretty(&thread_record_path(&task_path), &thread)?;
    write_json_pretty(&thread_messages_path(&task_path), &messages)?;
    write_json_pretty(&thread_agents_path(&task_path), &agents)?;
    write_json_pretty(&thread_approvals_path(&task_path), &approvals)?;
    storage::cleanup_workspace_runtime_noise(&workspace)?;
    Ok(true)
}

#[tauri::command]
pub fn thread_file_diff(cwd: String, thread_id: String, relative_path: String) -> Result<String, String> {
    let detail = task_detail_view(storage::task_load(cwd, thread_id.trim().to_string())?)?;
    let workspace_path = PathBuf::from(detail.record.workspace_path.trim());
    let relative_path = relative_path.trim();
    if relative_path.is_empty() {
        return Ok(String::new());
    }
    let output = Command::new("git")
        .arg("-C")
        .arg(&workspace_path)
        .args(["diff", "--", relative_path])
        .output()
        .map_err(|error| format!("failed to run git diff: {error}"))?;
    if !output.status.success() {
        return Ok(String::new());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_workspace(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "rail-thread-test-{name}-{}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn thread_create_writes_thread_files() {
        let workspace = temp_workspace("create");
        let detail = thread_create(
            workspace.to_string_lossy().to_string(),
            None,
            "spawn 3 fast subagents".to_string(),
            None,
            Some("full-squad".to_string()),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let dir = task_dir(&workspace, &detail.thread.thread_id);
        assert!(thread_record_path(&dir).exists());
        assert!(thread_messages_path(&dir).exists());
        assert!(thread_agents_path(&dir).exists());
        assert!(thread_approvals_path(&dir).exists());
        assert_eq!(detail.agents.len(), 9);
        assert!(detail.agents.iter().any(|agent| agent.role_id == "game_designer"));
        assert!(detail.agents.iter().any(|agent| agent.role_id == "handoff_writer"));
        assert_eq!(detail.workflow.stages.len(), 6);
    }

    #[test]
    fn thread_approval_roundtrip_updates_status() {
        let workspace = temp_workspace("approval");
        let detail = thread_create(
            workspace.to_string_lossy().to_string(),
            None,
            "explore repo".to_string(),
            None,
            Some("full-squad".to_string()),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let created = thread_create_approval(
            workspace.to_string_lossy().to_string(),
            detail.thread.thread_id.clone(),
            format!("{}:game_designer", detail.thread.thread_id),
            "handoff".to_string(),
            "Allow handoff".to_string(),
            Some(json!({ "targetRole": "unity_implementer", "prompt": "continue" })),
        )
        .unwrap();
        let approval_id = created.approvals.last().unwrap().id.clone();
        let resolved = thread_resolve_approval(
            workspace.to_string_lossy().to_string(),
            detail.thread.thread_id.clone(),
            approval_id,
            "approved".to_string(),
        )
        .unwrap();
        assert!(resolved.approvals.iter().any(|approval| approval.status == "approved"));
        assert!(resolved
            .agents
            .iter()
            .any(|agent| agent.role_id == "unity_implementer" && agent.status == "thinking"));
    }

    #[test]
    fn thread_spawn_agents_creates_messages_and_pending_handoff() {
        let workspace = temp_workspace("spawn");
        let detail = thread_create(
            workspace.to_string_lossy().to_string(),
            None,
            "inspect repo".to_string(),
            None,
            Some("full-squad".to_string()),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let with_tools = thread_add_agent(
            workspace.to_string_lossy().to_string(),
            detail.thread.thread_id.clone(),
            "tools".to_string(),
            None,
        )
        .unwrap();
        let spawned = thread_spawn_agents(
            workspace.to_string_lossy().to_string(),
            with_tools.thread.thread_id.clone(),
            "@designer @implementer inspect repo".to_string(),
            vec!["game_designer".to_string(), "unity_implementer".to_string()],
            None,
        )
        .unwrap();
        assert!(spawned.messages.iter().any(|message| message.content.contains("Created GAME DESIGNER")));
        assert!(spawned.messages.iter().any(|message| message.content.contains("Created UNITY IMPLEMENTER")));
        assert!(spawned.messages.iter().any(|message| message.content.contains("background agents are running now")));
        assert!(spawned.approvals.iter().any(|approval| approval.status == "pending"));
        assert!(spawned.agents.iter().any(|agent| agent.role_id == "game_designer" && agent.status == "thinking"));
        assert!(spawned.agents.iter().any(|agent| agent.role_id == "unity_implementer" && agent.status == "awaiting_approval"));
        assert_eq!(spawned.workflow.current_stage_id, "integrate");
        assert_eq!(
            spawned
                .workflow
                .stages
                .iter()
                .find(|stage| stage.id == "integrate")
                .map(|stage| stage.status.as_str()),
                Some("blocked")
        );
    }

    #[test]
    fn thread_spawn_agents_can_skip_initial_approval_for_discussion() {
        let workspace = temp_workspace("spawn-no-approval");
        let detail = thread_create(
            workspace.to_string_lossy().to_string(),
            None,
            "inspect repo".to_string(),
            None,
            Some("full-squad".to_string()),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let spawned = thread_spawn_agents(
            workspace.to_string_lossy().to_string(),
            detail.thread.thread_id.clone(),
            "@designer @implementer inspect repo".to_string(),
            vec!["game_designer".to_string(), "unity_implementer".to_string()],
            Some(true),
        )
        .unwrap();

        assert!(spawned.approvals.is_empty());
    }

    #[test]
    fn thread_load_marks_lock_ready_when_patch_validation_and_handoff_exist() {
        let workspace = temp_workspace("lock-ready");
        let detail = thread_create(
            workspace.to_string_lossy().to_string(),
            None,
            "finish the boss arena".to_string(),
            None,
            Some("full-squad".to_string()),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let cwd = workspace.to_string_lossy().to_string();
        storage::task_update_artifact(
            cwd.clone(),
            detail.thread.thread_id.clone(),
            "patch".to_string(),
            "# PATCH\n\nImplemented the arena controller.".to_string(),
        )
        .unwrap();
        storage::task_update_artifact(
            cwd.clone(),
            detail.thread.thread_id.clone(),
            "validation".to_string(),
            "# VALIDATION\n\nPlaytest passed.".to_string(),
        )
        .unwrap();
        storage::task_update_artifact(
            cwd.clone(),
            detail.thread.thread_id.clone(),
            "handoff".to_string(),
            "# HANDOFF\n\nReady for merge.".to_string(),
        )
        .unwrap();

        let loaded = thread_load(cwd, detail.thread.thread_id).unwrap();
        assert_eq!(loaded.workflow.current_stage_id, "lock");
        assert_eq!(
            loaded
                .workflow
                .stages
                .iter()
                .find(|stage| stage.id == "lock")
                .map(|stage| stage.status.as_str()),
            Some("ready")
        );
        assert!(loaded.workflow.readiness_summary.contains("LOCK READY"));
    }

    #[test]
    fn thread_rename_persists_custom_title_across_user_messages() {
        let workspace = temp_workspace("rename");
        let detail = thread_create(
            workspace.to_string_lossy().to_string(),
            None,
            "NEW THREAD".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let renamed = thread_rename(
            workspace.to_string_lossy().to_string(),
            detail.thread.thread_id.clone(),
            "Ship tasks polish".to_string(),
        )
        .unwrap();
        assert_eq!(renamed.thread.title, "Ship tasks polish");

        let appended = thread_append_message(
            workspace.to_string_lossy().to_string(),
            detail.thread.thread_id.clone(),
            "user".to_string(),
            "Please finish the remaining UI alignment fixes".to_string(),
        )
        .unwrap();
        assert_eq!(appended.thread.title, "Ship tasks polish");
    }

    #[test]
    fn thread_record_role_result_exposes_agent_metadata_and_latest_artifact_preview() {
        let workspace = temp_workspace("role-result-preview");
        let cwd = workspace.to_string_lossy().to_string();
        let detail = thread_create(
            cwd.clone(),
            None,
            "inspect repo".to_string(),
            None,
            Some("full-squad".to_string()),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let artifact_dir = workspace.join(".rail").join("studio_runs").join("run-1").join("artifacts");
        fs::create_dir_all(&artifact_dir).unwrap();
        let artifact_path = artifact_dir.join("summary.md");
        fs::write(&artifact_path, "# Summary\n\nInvestigated systems.").unwrap();
        let artifact_path_str = artifact_path.to_string_lossy().to_string();

        let recorded = thread_record_role_result(
            cwd.clone(),
            detail.thread.thread_id.clone(),
            "pm_planner".to_string(),
            "run-1".to_string(),
            "done".to_string(),
            vec![artifact_path_str.clone()],
            Some("GAME DESIGNER: Investigated systems.".to_string()),
            None,
        )
        .unwrap();
        assert!(recorded);

        let loaded = thread_load(cwd.clone(), detail.thread.thread_id.clone()).unwrap();
        let result_message = loaded
            .messages
            .iter()
            .find(|message| message.event_kind.as_deref() == Some("agent_result"))
            .unwrap();
        assert_eq!(result_message.agent_label.as_deref(), Some("GAME DESIGNER"));
        assert_eq!(result_message.source_role_id.as_deref(), Some("game_designer"));
        assert_eq!(result_message.artifact_path.as_deref(), Some(artifact_path_str.as_str()));

        let agent_detail = thread_open_agent_detail(
            cwd,
            detail.thread.thread_id.clone(),
            format!("{}:game_designer", detail.thread.thread_id),
        )
        .unwrap();
        assert_eq!(agent_detail.latest_artifact_path.as_deref(), Some(artifact_path_str.as_str()));
        assert!(agent_detail
            .latest_artifact_preview
            .as_deref()
            .unwrap_or_default()
            .contains("Investigated systems."));
    }

    #[test]
    fn thread_record_role_result_internal_run_skips_handoff_approval() {
        let workspace = temp_workspace("internal-role-result");
        let cwd = workspace.to_string_lossy().to_string();
        let detail = thread_create(
            cwd.clone(),
            None,
            "inspect repo".to_string(),
            None,
            Some("full-squad".to_string()),
            None,
            None,
            None,
            None,
        )
        .unwrap();

        let recorded = thread_record_role_result(
            cwd.clone(),
            detail.thread.thread_id.clone(),
            "pm_planner".to_string(),
            "run-2".to_string(),
            "done".to_string(),
            vec![],
            Some("GAME DESIGNER: internal brief".to_string()),
            Some(true),
        )
        .unwrap();
        assert!(recorded);

        let loaded = thread_load(cwd, detail.thread.thread_id.clone()).unwrap();
        assert!(loaded.approvals.is_empty());
    }

    #[test]
    fn thread_list_filters_by_project_path() {
        let workspace = temp_workspace("project-scope");
        let cwd = workspace.to_string_lossy().to_string();
        let project_a = workspace.join("project-a");
        let project_b = workspace.join("project-b");
        fs::create_dir_all(&project_a).unwrap();
        fs::create_dir_all(&project_b).unwrap();

        let thread_a = thread_create(
            cwd.clone(),
            Some(project_a.to_string_lossy().to_string()),
            "task a".to_string(),
            None,
            Some("full-squad".to_string()),
            Some("current-repo".to_string()),
            None,
            None,
            None,
        )
        .unwrap();
        let _thread_b = thread_create(
            cwd.clone(),
            Some(project_b.to_string_lossy().to_string()),
            "task b".to_string(),
            None,
            Some("full-squad".to_string()),
            Some("current-repo".to_string()),
            None,
            None,
            None,
        )
        .unwrap();

        let project_a_items = thread_list(cwd.clone(), Some(project_a.to_string_lossy().to_string())).unwrap();
        assert_eq!(project_a_items.len(), 1);
        assert_eq!(project_a_items[0].thread.thread_id, thread_a.thread.thread_id);

        let project_b_items = thread_list(cwd, Some(project_b.to_string_lossy().to_string())).unwrap();
        assert_eq!(project_b_items.len(), 1);
    }
}
