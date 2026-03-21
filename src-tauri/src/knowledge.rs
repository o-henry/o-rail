use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    hash::{Hash, Hasher},
    io::Read,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

const MAX_FILE_SIZE_BYTES: u64 = 15 * 1024 * 1024;
const DEFAULT_TOP_K: usize = 4;
const DEFAULT_MAX_CHARS: usize = 2800;
const MIN_CHUNK_CHARS: usize = 1200;
const CHUNK_OVERLAP_CHARS: usize = 180;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeFileRef {
    pub id: String,
    pub name: String,
    pub path: String,
    pub ext: String,
    pub enabled: bool,
    pub size_bytes: Option<u64>,
    pub mtime_ms: Option<u128>,
    pub status: Option<String>,
    pub status_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSnippet {
    pub file_id: String,
    pub file_name: String,
    pub chunk_index: usize,
    pub text: String,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeRetrieveResult {
    pub snippets: Vec<KnowledgeSnippet>,
    pub warnings: Vec<String>,
}

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

#[derive(Debug, Clone)]
struct ChunkCandidate {
    file_id: String,
    file_name: String,
    chunk_index: usize,
    text: String,
    score: f32,
}

#[tauri::command]
pub fn knowledge_probe(paths: Vec<String>) -> Result<Vec<KnowledgeFileRef>, String> {
    let mut out = Vec::new();
    for raw_path in paths {
        out.push(probe_single_file(raw_path));
    }
    Ok(out)
}

#[tauri::command]
pub fn knowledge_retrieve(
    files: Vec<KnowledgeFileRef>,
    query: String,
    top_k: Option<usize>,
    max_chars: Option<usize>,
) -> Result<KnowledgeRetrieveResult, String> {
    let mut warnings: Vec<String> = Vec::new();
    let mut candidates: Vec<ChunkCandidate> = Vec::new();

    let top_k = top_k.unwrap_or(DEFAULT_TOP_K).clamp(1, 20);
    let max_chars = max_chars.unwrap_or(DEFAULT_MAX_CHARS).clamp(300, 20_000);
    let query_tokens = tokenize(&query);

    for file in files.into_iter().filter(|file| file.enabled) {
        let path = PathBuf::from(file.path.trim());
        if !path.exists() {
            warnings.push(format!("첨부 파일 없음: {}", file.name));
            continue;
        }

        if !is_supported_extension(&file.ext) {
            warnings.push(format!(
                "지원하지 않는 확장자: {} ({})",
                file.name, file.ext
            ));
            continue;
        }

        let meta = match std::fs::metadata(&path) {
            Ok(meta) => meta,
            Err(err) => {
                warnings.push(format!("파일 메타 읽기 실패: {} ({err})", file.name));
                continue;
            }
        };

        if meta.len() > MAX_FILE_SIZE_BYTES {
            warnings.push(format!(
                "파일 크기 제한 초과(15MB): {} ({} bytes)",
                file.name,
                meta.len()
            ));
            continue;
        }

        let text = match read_text_by_extension(&path, &file.ext) {
            Ok(text) => text,
            Err(err) => {
                warnings.push(format!("첨부 읽기 실패: {} ({err})", file.name));
                continue;
            }
        };

        if text.trim().is_empty() {
            warnings.push(format!("첨부 내용이 비어있음: {}", file.name));
            continue;
        }

        let chunks = chunk_text(&text, MIN_CHUNK_CHARS, CHUNK_OVERLAP_CHARS);
        for (index, chunk) in chunks.into_iter().enumerate() {
            if chunk.trim().is_empty() {
                continue;
            }
            let score = lexical_score(&query_tokens, &chunk, index);
            if score <= 0.0 {
                continue;
            }
            candidates.push(ChunkCandidate {
                file_id: file.id.clone(),
                file_name: file.name.clone(),
                chunk_index: index + 1,
                text: chunk,
                score,
            });
        }
    }

    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.file_name.cmp(&b.file_name))
            .then_with(|| a.chunk_index.cmp(&b.chunk_index))
    });

    let mut snippets: Vec<KnowledgeSnippet> = Vec::new();
    let mut used_chars = 0usize;
    for candidate in candidates {
        if snippets.len() >= top_k {
            break;
        }

        let remain = max_chars.saturating_sub(used_chars);
        if remain < 40 {
            break;
        }

        let text = truncate_chars(&candidate.text, remain.min(MIN_CHUNK_CHARS));
        if text.trim().is_empty() {
            continue;
        }

        used_chars += text.chars().count();
        snippets.push(KnowledgeSnippet {
            file_id: candidate.file_id,
            file_name: candidate.file_name,
            chunk_index: candidate.chunk_index,
            text,
            score: candidate.score,
        });
    }

    Ok(KnowledgeRetrieveResult { snippets, warnings })
}

#[tauri::command]
pub fn knowledge_scan_workspace_artifacts(cwd: String) -> Result<Vec<WorkspaceKnowledgeArtifactEntry>, String> {
    let workspace = normalize_workspace_root(&cwd)?;
    scan_workspace_artifacts(&workspace)
}

fn normalize_workspace_root(cwd: &str) -> Result<PathBuf, String> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Err("workspace root is required".to_string());
    }
    let root = PathBuf::from(trimmed);
    if !root.exists() {
        return Err(format!("workspace not found: {}", root.display()));
    }
    std::fs::canonicalize(&root).map_err(|error| format!("failed to resolve workspace {}: {error}", root.display()))
}

fn scan_workspace_artifacts(workspace: &Path) -> Result<Vec<WorkspaceKnowledgeArtifactEntry>, String> {
    let tasks_root = workspace.join(".rail/tasks");
    if !tasks_root.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for task_entry in fs::read_dir(&tasks_root)
        .map_err(|error| format!("failed to read tasks directory {}: {error}", tasks_root.display()))?
    {
        let Ok(task_entry) = task_entry else {
            continue;
        };
        let task_dir = task_entry.path();
        if !task_dir.is_dir() {
            continue;
        }
        let task_id = task_dir.file_name().and_then(|value| value.to_str()).unwrap_or("").trim();
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
            let run_id = run_dir.file_name().and_then(|value| value.to_str()).unwrap_or("").trim();
            if run_id.is_empty() {
                continue;
            }
            for artifact_name in ["research_findings.md", "research_collection.md", "research_collection.json"] {
                let artifact_path = run_dir.join(artifact_name);
                if !artifact_path.is_file() {
                    continue;
                }
                let artifact_path_string = artifact_path.to_string_lossy().to_string();
                let created_at = file_timestamp_iso8601(&artifact_path);
                entries.push(WorkspaceKnowledgeArtifactEntry {
                    id: stable_file_id(&artifact_path_string),
                    run_id: run_id.to_string(),
                    task_id: task_id.to_string(),
                    role_id: "research_analyst".to_string(),
                    workspace_path: workspace.to_string_lossy().to_string(),
                    source_kind: "artifact".to_string(),
                    title: format!("리서처 · {} · {}", task_id, artifact_name),
                    summary: "복구된 리서치 산출물".to_string(),
                    created_at,
                    markdown_path: artifact_name.ends_with(".md").then_some(artifact_path_string.clone()),
                    json_path: artifact_name.ends_with(".json").then_some(artifact_path_string.clone()),
                    source_file: Some(artifact_path_string),
                });
            }
        }
    }
    entries.sort_by(|left, right| right.created_at.cmp(&left.created_at).then_with(|| left.id.cmp(&right.id)));
    Ok(entries)
}

fn file_timestamp_iso8601(path: &Path) -> String {
    let Ok(metadata) = fs::metadata(path) else {
        return "1970-01-01T00:00:00.000Z".to_string();
    };
    let Ok(modified) = metadata.modified() else {
        return "1970-01-01T00:00:00.000Z".to_string();
    };
    let Ok(duration) = modified.duration_since(UNIX_EPOCH) else {
        return "1970-01-01T00:00:00.000Z".to_string();
    };
    let seconds = duration.as_secs() as i64;
    let nanos = duration.subsec_nanos();
    let Some(datetime) = chrono::DateTime::<chrono::Utc>::from_timestamp(seconds, nanos) else {
        return "1970-01-01T00:00:00.000Z".to_string();
    };
    datetime.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn probe_single_file(raw_path: String) -> KnowledgeFileRef {
    let input_path = raw_path.trim();
    let fallback = PathBuf::from(input_path);
    let canonical = std::fs::canonicalize(input_path).unwrap_or(fallback.clone());
    let path = canonical.to_string_lossy().to_string();
    let name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(input_path)
        .to_string();
    let ext = extension_with_dot(&canonical);

    let mut file = KnowledgeFileRef {
        id: stable_file_id(&path),
        name,
        path,
        ext: ext.clone(),
        enabled: true,
        size_bytes: None,
        mtime_ms: None,
        status: Some("ready".to_string()),
        status_message: None,
    };

    if !canonical.exists() {
        file.status = Some("missing".to_string());
        file.status_message = Some("파일이 존재하지 않습니다.".to_string());
        return file;
    }

    match std::fs::metadata(&canonical) {
        Ok(meta) => {
            file.size_bytes = Some(meta.len());
            if let Ok(modified) = meta.modified() {
                if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                    file.mtime_ms = Some(duration.as_millis());
                }
            }

            if meta.len() > MAX_FILE_SIZE_BYTES {
                file.status = Some("error".to_string());
                file.status_message = Some("파일 크기 15MB 제한을 초과했습니다.".to_string());
                return file;
            }
        }
        Err(err) => {
            file.status = Some("error".to_string());
            file.status_message = Some(format!("파일 메타를 읽지 못했습니다: {err}"));
            return file;
        }
    }

    if !is_supported_extension(&ext) {
        file.status = Some("unsupported".to_string());
        file.status_message = Some("지원하지 않는 파일 형식입니다.".to_string());
    }

    file
}

fn extension_with_dot(path: &Path) -> String {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{}", ext.to_lowercase()))
        .unwrap_or_default()
}

fn stable_file_id(path: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn is_supported_extension(ext: &str) -> bool {
    let supported: HashSet<&str> = HashSet::from([
        ".txt", ".md", ".json", ".csv", ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java",
        ".cs", ".html", ".css", ".sql", ".yaml", ".yml", ".pdf", ".docx",
    ]);
    supported.contains(ext)
}

fn read_text_by_extension(path: &Path, ext: &str) -> Result<String, String> {
    if ext == ".pdf" {
        return pdf_extract::extract_text(path).map_err(|err| format!("pdf 추출 실패: {err}"));
    }
    if ext == ".docx" {
        return extract_docx_text(path);
    }
    std::fs::read_to_string(path).map_err(|err| format!("텍스트 파일 읽기 실패: {err}"))
}

fn extract_docx_text(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|err| format!("docx 파일 열기 실패: {err}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|err| format!("docx zip 파싱 실패: {err}"))?;
    let mut xml_file = archive
        .by_name("word/document.xml")
        .map_err(|err| format!("document.xml 읽기 실패: {err}"))?;
    let mut xml = String::new();
    xml_file
        .read_to_string(&mut xml)
        .map_err(|err| format!("document.xml 문자열 읽기 실패: {err}"))?;

    let doc =
        roxmltree::Document::parse(&xml).map_err(|err| format!("docx xml 파싱 실패: {err}"))?;
    let mut out = String::new();
    for node in doc.descendants() {
        if node.is_element() && node.tag_name().name() == "t" {
            if let Some(text) = node.text() {
                if !text.trim().is_empty() {
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    out.push_str(text.trim());
                }
            }
        }
    }
    Ok(out)
}

fn chunk_text(input: &str, chunk_size: usize, overlap: usize) -> Vec<String> {
    let chars: Vec<char> = input.chars().collect();
    if chars.is_empty() {
        return Vec::new();
    }

    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let end = (start + chunk_size).min(chars.len());
        let chunk: String = chars[start..end].iter().collect();
        chunks.push(chunk);
        if end == chars.len() {
            break;
        }
        start = end.saturating_sub(overlap);
    }

    chunks
}

fn truncate_chars(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    input.chars().take(max_chars).collect()
}

fn tokenize(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for ch in input.chars() {
        let is_korean = ('\u{AC00}'..='\u{D7A3}').contains(&ch);
        if ch.is_alphanumeric() || is_korean {
            for c in ch.to_lowercase() {
                current.push(c);
            }
            continue;
        }

        if current.chars().count() >= 2 {
            tokens.push(current.clone());
        }
        current.clear();
    }

    if current.chars().count() >= 2 {
        tokens.push(current);
    }

    tokens
}

fn lexical_score(query_tokens: &[String], chunk: &str, chunk_index: usize) -> f32 {
    if query_tokens.is_empty() {
        return 1.0 / ((chunk_index + 1) as f32);
    }

    let chunk_tokens = tokenize(chunk);
    if chunk_tokens.is_empty() {
        return 0.0;
    }

    let mut freq: HashMap<&str, usize> = HashMap::new();
    for token in &chunk_tokens {
        *freq.entry(token.as_str()).or_insert(0) += 1;
    }

    let mut score = 0f32;
    for token in query_tokens {
        if let Some(count) = freq.get(token.as_str()) {
            score += *count as f32;
        }
    }

    if score > 0.0 {
        score += 1.0 / ((chunk_index + 1) as f32);
    }
    score
}

#[cfg(test)]
mod tests {
    use super::scan_workspace_artifacts;
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
        let run_root = workspace
            .join(".rail/tasks/task-1/codex_runs/role-run-1");
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

        let _ = fs::remove_dir_all(&workspace);
    }
}
