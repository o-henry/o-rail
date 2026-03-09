use crate::system::{command_exec, ShellCommandResult};
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnityBatchCommandPreview {
    action: String,
    sandbox_path: String,
    unity_path: String,
    command: String,
    log_path: String,
    test_results_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnityBatchRunResult {
    action: String,
    sandbox_path: String,
    log_path: String,
    test_results_path: Option<String>,
    result: ShellCommandResult,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnityBatchJobRequest {
    project_path: String,
    sandbox_path: String,
    unity_path: String,
    action: String,
    execute_method: Option<String>,
    extra_args: Option<Vec<String>>,
    timeout_sec: Option<u64>,
}

fn canonicalize_existing_path(path: &str) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|error| format!("failed to resolve path {path}: {error}"))
}

fn unity_storage_root(project_path: &Path) -> PathBuf {
    project_path.join(".rail").join("unity")
}

fn unity_sandbox_root(project_path: &Path) -> PathBuf {
    unity_storage_root(project_path).join("sandboxes")
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn allowed_batch_action(value: &str) -> bool {
    matches!(value, "build" | "tests_edit" | "tests_play")
}

fn build_batch_preview(request: &UnityBatchJobRequest) -> Result<UnityBatchCommandPreview, String> {
    let project_path = canonicalize_existing_path(&request.project_path)?;
    let sandbox_path = canonicalize_existing_path(&request.sandbox_path)?;
    let sandbox_root = unity_sandbox_root(&project_path);
    if !sandbox_path.starts_with(&sandbox_root) {
        return Err("unity batch jobs are only allowed inside .rail/unity/sandboxes".to_string());
    }
    if !allowed_batch_action(request.action.as_str()) {
        return Err("unsupported unity batch action".to_string());
    }

    let session_root = unity_storage_root(&project_path).join("runs");
    fs::create_dir_all(&session_root)
        .map_err(|error| format!("failed to create unity run directory {}: {error}", session_root.display()))?;
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let log_path = session_root.join(format!("{}-{}.log", request.action, stamp));
    let test_results_path = match request.action.as_str() {
        "tests_edit" => Some(session_root.join(format!("tests-edit-{}.xml", stamp))),
        "tests_play" => Some(session_root.join(format!("tests-play-{}.xml", stamp))),
        _ => None,
    };

    let mut args = vec![
        shell_quote(&request.unity_path),
        "-batchmode".to_string(),
        "-projectPath".to_string(),
        shell_quote(&sandbox_path.display().to_string()),
    ];

    match request.action.as_str() {
        "build" => {
            let execute_method = request
                .execute_method
                .clone()
                .unwrap_or_else(|| "RailBuild.PerformBuild".to_string());
            args.push("-executeMethod".to_string());
            args.push(shell_quote(&execute_method));
        }
        "tests_edit" => {
            args.extend(["-runTests".to_string(), "-testPlatform".to_string(), "EditMode".to_string()]);
            if let Some(path) = &test_results_path {
                args.push("-testResults".to_string());
                args.push(shell_quote(&path.display().to_string()));
            }
        }
        "tests_play" => {
            args.extend(["-runTests".to_string(), "-testPlatform".to_string(), "PlayMode".to_string()]);
            if let Some(path) = &test_results_path {
                args.push("-testResults".to_string());
                args.push(shell_quote(&path.display().to_string()));
            }
        }
        _ => {}
    }

    for arg in request.extra_args.clone().unwrap_or_default() {
        let trimmed = arg.trim();
        if !trimmed.is_empty() {
            args.push(trimmed.to_string());
        }
    }
    args.extend(["-quit".to_string(), "-logFile".to_string(), shell_quote(&log_path.display().to_string())]);

    Ok(UnityBatchCommandPreview {
        action: request.action.clone(),
        sandbox_path: sandbox_path.display().to_string(),
        unity_path: request.unity_path.clone(),
        command: args.join(" "),
        log_path: log_path.display().to_string(),
        test_results_path: test_results_path.map(|path| path.display().to_string()),
    })
}

#[tauri::command]
pub async fn unity_batch_command_preview(
    request: UnityBatchJobRequest,
) -> Result<UnityBatchCommandPreview, String> {
    build_batch_preview(&request)
}

#[tauri::command]
pub async fn unity_batch_run(
    request: UnityBatchJobRequest,
) -> Result<UnityBatchRunResult, String> {
    let preview = build_batch_preview(&request)?;
    let result = command_exec(
        preview.sandbox_path.clone(),
        preview.command.clone(),
        Some(request.timeout_sec.unwrap_or(900)),
    )
    .await?;
    Ok(UnityBatchRunResult {
        action: preview.action,
        sandbox_path: preview.sandbox_path,
        log_path: preview.log_path,
        test_results_path: preview.test_results_path,
        result,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_known_batch_actions() {
        assert!(allowed_batch_action("build"));
        assert!(allowed_batch_action("tests_edit"));
        assert!(allowed_batch_action("tests_play"));
        assert!(!allowed_batch_action("rm"));
    }
}
