use crate::storage;
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
    worktree_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListItem {
    thread: ThreadRecord,
    agent_count: usize,
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
            created_at: thread.created_at.clone(),
        },
        ThreadMessage {
            id: format!("{}:message:2", thread.thread_id),
            thread_id: thread.thread_id.clone(),
            role: "assistant".to_string(),
            content: "Thread created. Ask for a follow-up and tag any agents you want to involve.".to_string(),
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
    match role_id {
        "explorer" => "EXPLORER".to_string(),
        "reviewer" => "REVIEWER".to_string(),
        "worker" => "WORKER".to_string(),
        "qa" => "QA".to_string(),
        _ => role_id.trim().to_uppercase(),
    }
}

fn default_studio_role_id(role_id: &str) -> Option<String> {
    match role_id {
        "explorer" => Some("pm_planner".to_string()),
        "reviewer" => Some("pm_feasibility_critic".to_string()),
        "worker" => Some("client_programmer".to_string()),
        "qa" => Some("qa_engineer".to_string()),
        _ => None,
    }
}

fn role_label_for(task: &TaskRecordView, role_id: &str) -> String {
    task.roles
        .iter()
        .find(|role| role.id == role_id)
        .map(|role| role.label.clone())
        .unwrap_or_else(|| default_role_label(role_id))
}

fn role_instruction(_task: &TaskRecordView, role_id: &str, prompt: &str) -> String {
    let user_prompt = prompt.trim();
    match role_id {
        "explorer" => format!(
            "{user_prompt} Focus: inspect the repo, locate relevant files, and summarize root cause and constraints."
        ),
        "reviewer" => format!(
            "{user_prompt} Focus: review risks, edge cases, architecture impact, and likely regressions."
        ),
        "qa" => format!(
            "{user_prompt} Focus: define validation steps, regression checks, and test coverage gaps."
        ),
        _ => format!(
            "{user_prompt} Focus: implement the requested change safely and summarize modified files."
        ),
    }
}

fn role_summary(role_id: &str) -> String {
    match role_id {
        "explorer" => "Mapping the repo and identifying relevant files.".to_string(),
        "reviewer" => "Reviewing risks, tradeoffs, and likely regressions.".to_string(),
        "qa" => "Preparing validation steps and regression checks.".to_string(),
        _ => "Preparing an implementation plan and likely code changes.".to_string(),
    }
}

fn role_discussion_line(role_id: &str) -> String {
    match role_id {
        "explorer" => "EXPLORER: I am exploring the repo structure and tracing entry points.".to_string(),
        "reviewer" => "REVIEWER: I am comparing options and highlighting architectural risks.".to_string(),
        "qa" => "QA: I am drafting validation coverage and regression checks.".to_string(),
        _ => "WORKER: I am mapping the implementation path and likely file edits.".to_string(),
    }
}

fn write_task_record_view(task_dir: &Path, record: &TaskRecordView) -> Result<(), String> {
    write_json_pretty(&task_record_file_path(task_dir), record)
}

fn append_message(messages: &mut Vec<ThreadMessage>, thread_id: &str, role: &str, content: &str) {
    let next = messages.len() + 1;
    messages.push(ThreadMessage {
        id: format!("{thread_id}:message:{next}"),
        thread_id: thread_id.to_string(),
        role: role.to_string(),
        content: content.to_string(),
        created_at: now_iso(),
    });
}

fn enabled_roles(task: &TaskRecordView) -> Vec<String> {
    task.roles
        .iter()
        .filter(|role| role.enabled)
        .map(|role| role.id.clone())
        .collect()
}

fn next_handoff_target(task: &TaskRecordView, role_id: &str) -> Option<String> {
    let enabled = enabled_roles(task);
    if role_id == "explorer" {
        if enabled.iter().any(|value| value == "reviewer") {
            return Some("reviewer".to_string());
        }
        if enabled.iter().any(|value| value == "worker") {
            return Some("worker".to_string());
        }
    }
    if role_id == "reviewer" && enabled.iter().any(|value| value == "worker") {
        return Some("worker".to_string());
    }
    if role_id == "worker" && enabled.iter().any(|value| value == "qa") {
        return Some("qa".to_string());
    }
    None
}

fn role_prompt_for_handoff(task: &TaskRecordView, from_role: &str, to_role: &str) -> String {
    format!(
        "Continue the task from {from_role} output.\n\nGoal: {}\n\nFocus for {to_role}: proceed using the latest findings and artifacts.",
        task.goal
    )
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

    for role in task.roles.iter().filter(|role| role.enabled) {
        if let Some(agent) = agents.iter_mut().find(|agent| agent.role_id == role.id) {
            agent.label = role.label.clone();
            agent.worktree_path = task.worktree_path.clone().or_else(|| Some(task.workspace_path.clone()));
        } else {
            agents.push(BackgroundAgentRecord {
                id: format!("{}:{}", thread.thread_id, role.id),
                thread_id: thread.thread_id.clone(),
                label: role.label.clone(),
                role_id: role.id.clone(),
                status: "idle".to_string(),
                summary: None,
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
    Ok(ThreadDetail {
        files: thread_files_for_task(&task),
        thread,
        task: task.record,
        messages,
        agents,
        approvals,
        artifacts: task.artifacts,
        changed_files: task.changed_files,
        validation_state: task.validation_state,
        risk_level: task.risk_level,
    })
}

fn default_run_roles(task: &TaskRecordView, requested_roles: &[String]) -> Vec<String> {
    let enabled = enabled_roles(task);
    let filtered = requested_roles
        .iter()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| enabled.iter().any(|row| row == value))
        .collect::<Vec<_>>();
    if !filtered.is_empty() {
        return filtered;
    }
    if enabled.iter().any(|value| value == "explorer") {
        return vec!["explorer".to_string()];
    }
    if enabled.iter().any(|value| value == "worker") {
        return vec!["worker".to_string()];
    }
    enabled.into_iter().take(1).collect()
}

fn update_agent_statuses(agents: &mut [BackgroundAgentRecord], selected_roles: &[String], workspace_path: &str) {
    let now = now_iso();
    for (index, role_id) in selected_roles.iter().enumerate() {
        if let Some(agent) = agents.iter_mut().find(|agent| &agent.role_id == role_id) {
            agent.status = if index == 0 { "thinking".to_string() } else { "awaiting_approval".to_string() };
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
pub fn thread_list(cwd: String) -> Result<Vec<ThreadListItem>, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    let task_records = task_list_view(storage::task_list(cwd.clone())?)?
        .into_iter()
        .filter(|task| task.status != "archived")
        .collect::<Vec<_>>();
    let mut threads = Vec::new();
    for task in task_records {
        let detail = build_thread_detail(&task_dir(&workspace, &task.task_id), task_detail_view(storage::task_load(cwd.clone(), task.task_id.clone())?)?, "5.4", "중간", "Local")?;
        threads.push(ThreadListItem {
            pending_approval_count: detail.approvals.iter().filter(|approval| approval.status == "pending").count(),
            agent_count: detail.agents.len(),
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
    let normalized_role_id = role_id.trim().to_lowercase();
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
        .trim()
        .to_lowercase();
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
        .trim()
        .to_lowercase();
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
    let task = task_detail_view(storage::task_create(cwd.clone(), prompt.to_string(), mode, team, isolation)?)?;
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
        thread.user_prompt = content.to_string();
        thread.title = truncate_text(content, 56);
    }
    write_json_pretty(&thread_record_path(&task_path), &thread)?;
    write_json_pretty(&thread_messages_path(&task_path), &messages)?;
    write_json_pretty(&thread_agents_path(&task_path), &agents)?;
    write_json_pretty(&thread_approvals_path(&task_path), &approvals)?;
    build_thread_detail(&task_path, task, &thread.model, &thread.reasoning, &thread.access_mode)
}

#[tauri::command]
pub fn thread_spawn_agents(cwd: String, thread_id: String, prompt: String, roles: Vec<String>) -> Result<ThreadDetail, String> {
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
    update_agent_statuses(&mut agents, &selected_roles, &task.record.workspace_path);

    for role_id in &selected_roles {
        let label = role_label_for(&task.record, role_id);
        append_message(
            &mut messages,
            &thread.thread_id,
            "assistant",
            &format!("Created {label} with instructions: {}", role_instruction(&task.record, role_id, prompt)),
        );
    }
    for role_id in &selected_roles {
        append_message(&mut messages, &thread.thread_id, "assistant", &role_discussion_line(role_id));
    }

    if selected_roles.len() >= 2 {
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

    append_message(
        &mut messages,
        &thread.thread_id,
        "assistant",
        &format!(
            "{} background agents are running now. I will wait for their updates and then synthesize the answer into one response.",
            selected_roles.len()
        ),
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
    Ok(ThreadAgentDetail {
        agent,
        studio_role_id: task_role.as_ref().map(|row| row.studio_role_id.clone()),
        last_prompt: task_role.as_ref().and_then(|row| row.last_prompt.clone()),
        last_prompt_at: task_role.as_ref().and_then(|row| row.last_prompt_at.clone()),
        last_run_id: task_role.as_ref().and_then(|row| row.last_run_id.clone()),
        artifact_paths: task_role.map(|row| row.artifact_paths).unwrap_or_default(),
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
    append_message(
        &mut messages,
        &thread.thread_id,
        "assistant",
        &approval_message,
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

    append_message(
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
    );

    if run_status.trim().eq_ignore_ascii_case("done") {
        let mut created_handoff = false;
        if let Some(target_role) = next_handoff_target(&task.record, &task_role.id) {
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
                let payload = json!({
                    "fromRole": task_role.id,
                    "targetRole": target_role,
                    "prompt": role_prompt_for_handoff(&task.record, &task_role.label, &target_role.to_uppercase()),
                });
                approvals.push(create_approval_record(
                    &thread.thread_id,
                    &agent_id,
                    "handoff",
                    &format!("Approve handoff from {} to {}.", task_role.label, role_label_for(&task.record, &target_role)),
                    payload,
                    approvals.len(),
                ));
                for agent in agents.iter_mut() {
                    if agent.role_id == target_role {
                        agent.status = "awaiting_approval".to_string();
                        agent.last_updated_at = now_iso();
                    }
                }
                append_message(
                    &mut messages,
                    &thread.thread_id,
                    "system",
                    &format!("Approval required to hand off from {} to {}.", task_role.label, target_role.to_uppercase()),
                );
                created_handoff = true;
            }
        }
        if !created_handoff {
            append_message(
                &mut messages,
                &thread.thread_id,
                "assistant",
                "I have consolidated the latest background agent output into this thread. Review the artifacts and changed files for the next step.",
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
            "spawn 3 fast subagents".to_string(),
            None,
            None,
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
    }

    #[test]
    fn thread_approval_roundtrip_updates_status() {
        let workspace = temp_workspace("approval");
        let detail = thread_create(
            workspace.to_string_lossy().to_string(),
            "explore repo".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let created = thread_create_approval(
            workspace.to_string_lossy().to_string(),
            detail.thread.thread_id.clone(),
            format!("{}:explorer", detail.thread.thread_id),
            "handoff".to_string(),
            "Allow handoff".to_string(),
            Some(json!({ "targetRole": "worker", "prompt": "continue" })),
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
    }

    #[test]
    fn thread_spawn_agents_creates_messages_and_pending_handoff() {
        let workspace = temp_workspace("spawn");
        let detail = thread_create(
            workspace.to_string_lossy().to_string(),
            "inspect repo".to_string(),
            None,
            Some("custom".to_string()),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let with_explorer = thread_add_agent(
            workspace.to_string_lossy().to_string(),
            detail.thread.thread_id.clone(),
            "explorer".to_string(),
            Some("EXPLORER".to_string()),
        )
        .unwrap();
        let with_worker = thread_add_agent(
            workspace.to_string_lossy().to_string(),
            with_explorer.thread.thread_id.clone(),
            "worker".to_string(),
            Some("WORKER".to_string()),
        )
        .unwrap();
        let spawned = thread_spawn_agents(
            workspace.to_string_lossy().to_string(),
            with_worker.thread.thread_id.clone(),
            "@explorer @worker inspect repo".to_string(),
            vec!["explorer".to_string(), "worker".to_string()],
        )
        .unwrap();
        assert!(spawned.messages.iter().any(|message| message.content.contains("Created EXPLORER")));
        assert!(spawned.messages.iter().any(|message| message.content.contains("Created WORKER")));
        assert!(spawned.messages.iter().any(|message| message.content.contains("background agents are running now")));
        assert!(spawned.approvals.iter().any(|approval| approval.status == "pending"));
        assert!(spawned.agents.iter().any(|agent| agent.role_id == "explorer" && agent.status == "thinking"));
        assert!(spawned.agents.iter().any(|agent| agent.role_id == "worker" && agent.status == "awaiting_approval"));
    }
}
