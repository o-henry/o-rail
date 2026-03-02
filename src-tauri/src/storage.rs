use serde_json::Value;
use std::{fs, path::PathBuf};
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
    write_json_file(&app, "graphs", &name, &graph)
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
    write_json_file(&app, "runs", &name, &run)
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
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            let _ = tx.try_send(unique_paths);
        });

    match rx.recv().await {
        Some(paths) => Ok(paths),
        None => Err("첨부 자료 선택 대화상자 응답을 받지 못했습니다.".to_string()),
    }
}
