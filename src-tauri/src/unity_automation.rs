use serde::Serialize;
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

const DEFAULT_DIAGNOSTIC_TAIL_BYTES: usize = 32 * 1024;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnityGuardInspection {
    project_path: String,
    unity_project: bool,
    git_root: Option<String>,
    current_branch: Option<String>,
    dirty: Option<bool>,
    recommended_mode: String,
    protected_paths: Vec<String>,
    editor_log_path: Option<String>,
    latest_diagnostics_path: String,
    latest_diagnostics_markdown_path: String,
    worktree_root: String,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnityGuardPrepareResult {
    strategy: String,
    sandbox_path: Option<String>,
    branch_name: Option<String>,
    metadata_path: String,
    source_project_path: String,
    read_only_default: bool,
    protected_paths: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnityDiagnosticFileSummary {
    kind: String,
    path: String,
    present: bool,
    bytes: usize,
    line_count: usize,
    error_count: usize,
    warning_count: usize,
    excerpt: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnityDiagnosticsBundle {
    project_path: String,
    recommended_mode: String,
    summary: String,
    files: Vec<UnityDiagnosticFileSummary>,
    saved_json_path: String,
    saved_markdown_path: String,
}

fn canonicalize_existing_path(path: &str) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|error| format!("failed to resolve path {path}: {error}"))
}

fn is_unity_project(path: &Path) -> bool {
    path.join("Assets").is_dir() && path.join("Packages").is_dir() && path.join("ProjectSettings").is_dir()
}

fn unity_storage_root(project_path: &Path) -> PathBuf {
    project_path.join(".rail").join("unity")
}

fn unity_sandbox_root(project_path: &Path) -> PathBuf {
    unity_storage_root(project_path).join("sandboxes")
}

fn latest_diagnostics_json_path(project_path: &Path) -> PathBuf {
    unity_storage_root(project_path).join("latest-diagnostics.json")
}

fn latest_diagnostics_markdown_path(project_path: &Path) -> PathBuf {
    unity_storage_root(project_path).join("latest-diagnostics.md")
}

fn latest_guard_path(project_path: &Path) -> PathBuf {
    unity_storage_root(project_path).join("latest-guard.json")
}

fn protected_unity_paths() -> Vec<String> {
    vec![
        "ProjectSettings/**".to_string(),
        "Packages/manifest.json".to_string(),
        "Packages/packages-lock.json".to_string(),
        "Assets/**/*.unity".to_string(),
        "Assets/**/*.prefab".to_string(),
        "Assets/**/*.meta".to_string(),
    ]
}

fn detect_editor_log_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let path = PathBuf::from(home).join("Library/Logs/Unity/Editor.log");
    path.exists().then_some(path)
}

fn trim_excerpt(input: &str, max_chars: usize) -> String {
    let trimmed = input.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    trimmed.chars().take(max_chars).collect::<String>() + "..."
}

fn read_file_tail(path: &Path, max_bytes: usize) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("failed to open diagnostic file {}: {error}", path.display()))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("failed to stat diagnostic file {}: {error}", path.display()))?;
    let total_len = metadata.len();
    let keep_len = std::cmp::min(total_len as usize, max_bytes);
    if keep_len < total_len as usize {
        file.seek(SeekFrom::End(-(keep_len as i64)))
            .map_err(|error| format!("failed to seek diagnostic file {}: {error}", path.display()))?;
    }
    let mut buf = Vec::with_capacity(keep_len);
    file.read_to_end(&mut buf)
        .map_err(|error| format!("failed to read diagnostic file {}: {error}", path.display()))?;
    Ok(String::from_utf8_lossy(&buf).to_string())
}

fn summarize_diagnostic_text(kind: &str, path: &Path, content: &str) -> UnityDiagnosticFileSummary {
    let mut error_count = 0usize;
    let mut warning_count = 0usize;
    let mut relevant_lines = Vec::new();
    for line in content.lines() {
        let lower = line.to_lowercase();
        if lower.contains("error") || lower.contains("exception") || lower.contains("failed") {
            error_count += 1;
            relevant_lines.push(line.trim().to_string());
        } else if lower.contains("warning") {
            warning_count += 1;
            relevant_lines.push(line.trim().to_string());
        }
    }
    let excerpt_source = if relevant_lines.is_empty() {
        content.lines().rev().take(12).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n")
    } else {
        relevant_lines.into_iter().take(18).collect::<Vec<_>>().join("\n")
    };

    UnityDiagnosticFileSummary {
        kind: kind.to_string(),
        path: path.display().to_string(),
        present: true,
        bytes: content.as_bytes().len(),
        line_count: content.lines().count(),
        error_count,
        warning_count,
        excerpt: trim_excerpt(&excerpt_source, 4000),
    }
}

fn missing_diagnostic_summary(kind: &str, path: &Path) -> UnityDiagnosticFileSummary {
    UnityDiagnosticFileSummary {
        kind: kind.to_string(),
        path: path.display().to_string(),
        present: false,
        bytes: 0,
        line_count: 0,
        error_count: 0,
        warning_count: 0,
        excerpt: String::new(),
    }
}

async fn git_stdout(project_path: &Path, args: &[&str]) -> Option<String> {
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(project_path)
        .args(args)
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| format!("failed to create directory {}: {error}", parent.display()))
}

fn write_pretty_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    ensure_parent_dir(path)?;
    let payload = serde_json::to_string_pretty(value).map_err(|error| format!("failed to serialize json: {error}"))?;
    fs::write(path, payload).map_err(|error| format!("failed to write {}: {error}", path.display()))
}

#[tauri::command]
pub async fn unity_guard_inspect(project_path: String) -> Result<UnityGuardInspection, String> {
    let project_path = canonicalize_existing_path(&project_path)?;
    let unity_project = is_unity_project(&project_path);
    let git_root = git_stdout(&project_path, &["rev-parse", "--show-toplevel"]).await;
    let current_branch = git_stdout(&project_path, &["rev-parse", "--abbrev-ref", "HEAD"]).await;
    let dirty = if git_root.is_some() {
        git_stdout(&project_path, &["status", "--porcelain"]).await.map(|text| !text.trim().is_empty())
    } else {
        None
    };
    let recommended_mode = if git_root.is_some() { "git_worktree" } else { "read_only" }.to_string();
    let editor_log_path = detect_editor_log_path().map(|path| path.display().to_string());
    let mut warnings = Vec::new();
    if !unity_project {
        warnings.push("선택한 경로가 Unity 프로젝트 구조(Assets/Packages/ProjectSettings)를 충족하지 않습니다.".to_string());
    }
    if git_root.is_none() {
        warnings.push("Git 저장소를 찾지 못했습니다. 진단은 읽기 전용으로만 권장됩니다.".to_string());
    }

    Ok(UnityGuardInspection {
        project_path: project_path.display().to_string(),
        unity_project,
        git_root,
        current_branch,
        dirty,
        recommended_mode,
        protected_paths: protected_unity_paths(),
        editor_log_path,
        latest_diagnostics_path: latest_diagnostics_json_path(&project_path).display().to_string(),
        latest_diagnostics_markdown_path: latest_diagnostics_markdown_path(&project_path).display().to_string(),
        worktree_root: unity_sandbox_root(&project_path).display().to_string(),
        warnings,
    })
}

#[tauri::command]
pub async fn unity_guard_prepare(
    project_path: String,
    strategy: Option<String>,
) -> Result<UnityGuardPrepareResult, String> {
    let project_path = canonicalize_existing_path(&project_path)?;
    let inspection = unity_guard_inspect(project_path.display().to_string()).await?;
    let picked_strategy = strategy.unwrap_or_else(|| inspection.recommended_mode.clone());
    let protected_paths = protected_unity_paths();
    let metadata_path = latest_guard_path(&project_path);
    let mut warnings = inspection.warnings.clone();

    if picked_strategy != "git_worktree" || inspection.git_root.is_none() {
        let result = UnityGuardPrepareResult {
            strategy: "read_only".to_string(),
            sandbox_path: None,
            branch_name: None,
            metadata_path: metadata_path.display().to_string(),
            source_project_path: project_path.display().to_string(),
            read_only_default: true,
            protected_paths,
            warnings,
        };
        write_pretty_json(&metadata_path, &result)?;
        return Ok(result);
    }

    let sandbox_root = unity_sandbox_root(&project_path);
    fs::create_dir_all(&sandbox_root)
        .map_err(|error| format!("failed to create sandbox root {}: {error}", sandbox_root.display()))?;
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let sandbox_path = sandbox_root.join(format!("unity-{}", stamp));
    let branch_name = format!("rail/unity/{}", stamp);
    let git_root = inspection.git_root.clone().ok_or_else(|| "missing git root".to_string())?;

    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&git_root)
        .arg("worktree")
        .arg("add")
        .arg(&sandbox_path)
        .arg("-b")
        .arg(&branch_name)
        .arg("HEAD")
        .output()
        .await
        .map_err(|error| format!("failed to start git worktree: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        warnings.push(format!("git worktree 생성 실패, read-only로 폴백했습니다: {}", stderr));
        let result = UnityGuardPrepareResult {
            strategy: "read_only".to_string(),
            sandbox_path: None,
            branch_name: None,
            metadata_path: metadata_path.display().to_string(),
            source_project_path: project_path.display().to_string(),
            read_only_default: true,
            protected_paths,
            warnings,
        };
        write_pretty_json(&metadata_path, &result)?;
        return Ok(result);
    }

    let result = UnityGuardPrepareResult {
        strategy: "git_worktree".to_string(),
        sandbox_path: Some(sandbox_path.display().to_string()),
        branch_name: Some(branch_name),
        metadata_path: metadata_path.display().to_string(),
        source_project_path: project_path.display().to_string(),
        read_only_default: true,
        protected_paths,
        warnings,
    };
    write_pretty_json(&metadata_path, &result)?;
    Ok(result)
}

#[tauri::command]
pub async fn unity_collect_diagnostics(
    project_path: String,
    editor_log_path: Option<String>,
    player_log_path: Option<String>,
    test_results_path: Option<String>,
    build_report_path: Option<String>,
    max_bytes: Option<usize>,
) -> Result<UnityDiagnosticsBundle, String> {
    let project_path = canonicalize_existing_path(&project_path)?;
    let inspection = unity_guard_inspect(project_path.display().to_string()).await?;
    let max_bytes = max_bytes.unwrap_or(DEFAULT_DIAGNOSTIC_TAIL_BYTES).max(2048);
    let mut files = Vec::new();
    let mut candidates = Vec::new();
    if let Some(path) = editor_log_path.or(inspection.editor_log_path.clone()) {
        candidates.push(("editorLog", PathBuf::from(path)));
    }
    if let Some(path) = player_log_path {
        candidates.push(("playerLog", PathBuf::from(path)));
    }
    if let Some(path) = test_results_path {
        candidates.push(("testResults", PathBuf::from(path)));
    }
    if let Some(path) = build_report_path {
        candidates.push(("buildReport", PathBuf::from(path)));
    }

    for (kind, path) in candidates {
        if path.exists() {
            let content = read_file_tail(&path, max_bytes)?;
            files.push(summarize_diagnostic_text(kind, &path, &content));
        } else {
            files.push(missing_diagnostic_summary(kind, &path));
        }
    }

    let total_errors = files.iter().map(|item| item.error_count).sum::<usize>();
    let total_warnings = files.iter().map(|item| item.warning_count).sum::<usize>();
    let available_files = files.iter().filter(|item| item.present).count();
    let summary = format!(
        "Unity 진단 입력 {}개 파일, error {}개, warning {}개, 권장 보호 모드 {}",
        available_files, total_errors, total_warnings, inspection.recommended_mode
    );

    let bundle = UnityDiagnosticsBundle {
        project_path: project_path.display().to_string(),
        recommended_mode: inspection.recommended_mode,
        summary: summary.clone(),
        files,
        saved_json_path: latest_diagnostics_json_path(&project_path).display().to_string(),
        saved_markdown_path: latest_diagnostics_markdown_path(&project_path).display().to_string(),
    };

    write_pretty_json(Path::new(&bundle.saved_json_path), &bundle)?;
    let markdown = format!(
        "# Unity Diagnostics\n\n- project: {}\n- summary: {}\n\n{}",
        bundle.project_path,
        bundle.summary,
        bundle
            .files
            .iter()
            .map(|file| format!(
                "## {}\n- path: {}\n- present: {}\n- errors: {}\n- warnings: {}\n\n```text\n{}\n```",
                file.kind, file.path, file.present, file.error_count, file.warning_count, file.excerpt
            ))
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    fs::write(&bundle.saved_markdown_path, markdown)
        .map_err(|error| format!("failed to write {}: {error}", bundle.saved_markdown_path))?;

    Ok(bundle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_locked_unity_paths() {
        let paths = protected_unity_paths();
        assert!(paths.iter().any(|path| path.contains("ProjectSettings")));
        assert!(paths.iter().any(|path| path.contains(".unity")));
        assert!(paths.iter().any(|path| path.contains(".prefab")));
    }
}
