use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, hash_map::DefaultHasher},
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

const ARTIFACT_CACHE_PATH: &str = ".rail/studio_index/knowledge/artifact-index.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceKnowledgeArtifactEntry {
    pub id: String,
    pub run_id: String,
    pub task_id: String,
    pub role_id: String,
    pub workspace_path: String,
    pub source_kind: String,
    pub title: String,
    pub summary: String,
    pub created_at: String,
    pub markdown_path: Option<String>,
    pub json_path: Option<String>,
    pub source_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceKnowledgeArtifactRunCache {
    key: String,
    run_id: String,
    task_id: String,
    signature_ms: u128,
    entries: Vec<WorkspaceKnowledgeArtifactEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceKnowledgeArtifactCache {
    workspace_path: String,
    generated_at: String,
    runs: Vec<WorkspaceKnowledgeArtifactRunCache>,
}

#[derive(Debug, Clone)]
struct WorkspaceArtifactRunRef {
    key: String,
    run_id: String,
    task_id: String,
    run_dir: PathBuf,
    signature_ms: u128,
}

pub fn scan_workspace_artifacts(workspace: &Path) -> Result<Vec<WorkspaceKnowledgeArtifactEntry>, String> {
    let tasks_root = workspace.join(".rail/tasks");
    if !tasks_root.is_dir() {
        return Ok(Vec::new());
    }

    let run_refs = collect_workspace_artifact_runs(&tasks_root)?;
    let cached_runs = read_workspace_artifact_cache(workspace)
        .map(|cache| {
            cache.runs
                .into_iter()
                .map(|row| (row.key.clone(), row))
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();

    let mut next_cache_runs = Vec::new();
    let mut entries = Vec::new();

    for run_ref in run_refs {
        if let Some(cached_run) = cached_runs.get(&run_ref.key) {
            if cached_run.signature_ms == run_ref.signature_ms {
                entries.extend(cached_run.entries.clone());
                next_cache_runs.push(cached_run.clone());
                continue;
            }
        }

        let run_entries = scan_run_artifacts(workspace, &run_ref);
        entries.extend(run_entries.clone());
        next_cache_runs.push(WorkspaceKnowledgeArtifactRunCache {
            key: run_ref.key,
            run_id: run_ref.run_id,
            task_id: run_ref.task_id,
            signature_ms: run_ref.signature_ms,
            entries: run_entries,
        });
    }

    entries.sort_by(|left, right| right.created_at.cmp(&left.created_at).then_with(|| left.id.cmp(&right.id)));
    next_cache_runs.sort_by(|left, right| left.key.cmp(&right.key));
    write_workspace_artifact_cache(
        workspace,
        WorkspaceKnowledgeArtifactCache {
            workspace_path: workspace.to_string_lossy().to_string(),
            generated_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            runs: next_cache_runs,
        },
    );
    Ok(entries)
}

fn collect_workspace_artifact_runs(tasks_root: &Path) -> Result<Vec<WorkspaceArtifactRunRef>, String> {
    let mut runs = Vec::new();
    for task_entry in fs::read_dir(tasks_root)
        .map_err(|error| format!("failed to read tasks directory {}: {error}", tasks_root.display()))?
    {
        let Ok(task_entry) = task_entry else {
            continue;
        };
        let task_dir = task_entry.path();
        if !task_dir.is_dir() {
            continue;
        }
        let task_id = task_dir.file_name().and_then(|value| value.to_str()).unwrap_or("").trim().to_string();
        if task_id.is_empty() {
            continue;
        }
        let codex_runs_dir = task_dir.join("codex_runs");
        if !codex_runs_dir.is_dir() {
            continue;
        }
        for run_entry in fs::read_dir(&codex_runs_dir)
            .map_err(|error| format!("failed to read codex_runs directory {}: {error}", codex_runs_dir.display()))?
        {
            let Ok(run_entry) = run_entry else {
                continue;
            };
            let run_dir = run_entry.path();
            if !run_dir.is_dir() {
                continue;
            }
            let run_id = run_dir.file_name().and_then(|value| value.to_str()).unwrap_or("").trim().to_string();
            if run_id.is_empty() {
                continue;
            }
            runs.push(WorkspaceArtifactRunRef {
                key: format!("{task_id}:{run_id}"),
                run_id,
                task_id: task_id.clone(),
                signature_ms: file_timestamp_ms(&run_dir),
                run_dir,
            });
        }
    }
    Ok(runs)
}

fn scan_run_artifacts(workspace: &Path, run_ref: &WorkspaceArtifactRunRef) -> Vec<WorkspaceKnowledgeArtifactEntry> {
    let mut entries = Vec::new();
    for artifact_name in ["research_findings.md", "research_collection.md", "research_collection.json"] {
        let artifact_path = run_ref.run_dir.join(artifact_name);
        if !artifact_path.is_file() {
            continue;
        }
        let artifact_path_string = artifact_path.to_string_lossy().to_string();
        entries.push(WorkspaceKnowledgeArtifactEntry {
            id: stable_file_id(&artifact_path_string),
            run_id: run_ref.run_id.clone(),
            task_id: run_ref.task_id.clone(),
            role_id: "research_analyst".to_string(),
            workspace_path: workspace.to_string_lossy().to_string(),
            source_kind: "artifact".to_string(),
            title: format!("리서처 · {} · {}", run_ref.task_id, artifact_name),
            summary: "복구된 리서치 산출물".to_string(),
            created_at: file_timestamp_iso8601(&artifact_path),
            markdown_path: artifact_name.ends_with(".md").then_some(artifact_path_string.clone()),
            json_path: artifact_name.ends_with(".json").then_some(artifact_path_string.clone()),
            source_file: Some(artifact_path_string),
        });
    }
    entries
}

fn read_workspace_artifact_cache(workspace: &Path) -> Option<WorkspaceKnowledgeArtifactCache> {
    let cache_path = workspace.join(ARTIFACT_CACHE_PATH);
    let raw = fs::read_to_string(cache_path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_workspace_artifact_cache(workspace: &Path, cache: WorkspaceKnowledgeArtifactCache) {
    let cache_path = workspace.join(ARTIFACT_CACHE_PATH);
    let Some(parent) = cache_path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let Ok(payload) = serde_json::to_string_pretty(&cache) else {
        return;
    };
    let _ = fs::write(cache_path, format!("{payload}\n"));
}

fn file_timestamp_ms(path: &Path) -> u128 {
    let Ok(metadata) = fs::metadata(path) else {
        return 0;
    };
    let Ok(modified) = metadata.modified() else {
        return 0;
    };
    let Ok(duration) = modified.duration_since(UNIX_EPOCH) else {
        return 0;
    };
    duration.as_millis()
}

fn file_timestamp_iso8601(path: &Path) -> String {
    let ms = file_timestamp_ms(path);
    if ms == 0 {
        return "1970-01-01T00:00:00.000Z".to_string();
    }
    let seconds = (ms / 1000) as i64;
    let nanos = ((ms % 1000) * 1_000_000) as u32;
    let Some(datetime) = chrono::DateTime::<chrono::Utc>::from_timestamp(seconds, nanos) else {
        return "1970-01-01T00:00:00.000Z".to_string();
    };
    datetime.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn stable_file_id(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::{scan_workspace_artifacts, ARTIFACT_CACHE_PATH};
    use std::{fs, path::PathBuf};

    fn make_temp_workspace(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("rail-knowledge-scan-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn scan_workspace_artifacts_discovers_research_artifacts() {
        let workspace = make_temp_workspace("artifacts");
        let run_root = workspace.join(".rail/tasks/task-1/codex_runs/role-run-1");
        fs::create_dir_all(&run_root).unwrap();
        fs::write(run_root.join("research_collection.json"), "{}\n").unwrap();
        fs::write(run_root.join("research_collection.md"), "# report\n").unwrap();
        fs::write(run_root.join("research_findings.md"), "# findings\n").unwrap();

        let rows = scan_workspace_artifacts(&workspace).unwrap();

        assert_eq!(rows.len(), 3);
        assert!(rows.iter().all(|row| row.role_id == "research_analyst"));
        assert!(rows.iter().any(|row| row.json_path.as_deref().unwrap_or("").ends_with("research_collection.json")));
        assert!(rows.iter().any(|row| row.markdown_path.as_deref().unwrap_or("").ends_with("research_collection.md")));
        assert!(rows.iter().any(|row| row.markdown_path.as_deref().unwrap_or("").ends_with("research_findings.md")));

        let cache_path = workspace.join(ARTIFACT_CACHE_PATH);
        assert!(cache_path.is_file());
        let _ = fs::remove_dir_all(&workspace);
    }
}
