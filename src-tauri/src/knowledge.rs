use crate::knowledge_artifacts::{scan_workspace_artifacts, WorkspaceKnowledgeArtifactEntry};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    hash::{Hash, Hasher},
    io::Read,
    path::{Path, PathBuf},
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

#[derive(Debug, Clone)]
struct ChunkCandidate {
    file_id: String,
    file_name: String,
    chunk_index: usize,
    text: String,
    score: f32,
    matched_query_tokens: HashSet<String>,
    token_set: HashSet<String>,
    char_ngrams: HashSet<String>,
}

#[derive(Debug, Clone)]
struct ExpandedQuery {
    tokens: Vec<String>,
    token_set: HashSet<String>,
    phrases: Vec<String>,
    clauses: Vec<Vec<String>>,
    char_ngrams: HashSet<String>,
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
    let expanded_query = expand_query(&query);

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
            if let Some(candidate) = score_chunk_candidate(
                &expanded_query,
                file.id.clone(),
                file.name.clone(),
                chunk,
                index,
            ) {
                candidates.push(candidate);
            }
        }
    }

    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.file_name.cmp(&b.file_name))
            .then_with(|| a.chunk_index.cmp(&b.chunk_index))
    });

    let snippets = pack_context_candidates(&expanded_query, candidates, top_k, max_chars);

    Ok(KnowledgeRetrieveResult { snippets, warnings })
}

#[tauri::command]
pub fn knowledge_scan_workspace_artifacts(
    cwd: String,
) -> Result<Vec<WorkspaceKnowledgeArtifactEntry>, String> {
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
    std::fs::canonicalize(&root)
        .map_err(|error| format!("failed to resolve workspace {}: {error}", root.display()))
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

fn extract_focus_query(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Some(section) = extract_tagged_section(trimmed, "task_request") {
        return section;
    }

    if let Some(section) = extract_bracketed_section(trimmed, "[요청]") {
        return section;
    }

    if let Some((before, _)) = trimmed.split_once("[ROLE_KB_INJECT]") {
        let candidate = before.trim();
        if !candidate.is_empty() {
            return candidate.to_string();
        }
    }

    trimmed.to_string()
}

fn extract_tagged_section(input: &str, tag_name: &str) -> Option<String> {
    let lower = input.to_lowercase();
    let open = format!("<{}>", tag_name);
    let close = format!("</{}>", tag_name);
    let start = lower.find(&open)?;
    let end = lower[start + open.len()..].find(&close)?;
    let content_start = start + open.len();
    let content_end = content_start + end;
    let extracted = input.get(content_start..content_end)?.trim();
    if extracted.is_empty() {
        None
    } else {
        Some(extracted.to_string())
    }
}

fn extract_bracketed_section(input: &str, marker: &str) -> Option<String> {
    let (_, after) = input.rsplit_once(marker)?;
    let trimmed = after.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn expand_query(input: &str) -> ExpandedQuery {
    let focused = extract_focus_query(input);
    let mut tokens = Vec::new();
    let mut token_set = HashSet::new();
    for token in tokenize(&focused) {
        if is_stop_token(&token) {
            continue;
        }
        if token_set.insert(token.clone()) {
            tokens.push(token);
        }
    }

    let clauses = split_query_clauses(&focused);
    let mut phrases = clauses
        .iter()
        .map(|clause| clause.join(" "))
        .filter(|phrase| phrase.chars().count() >= 4)
        .collect::<Vec<_>>();
    let focused_phrase = normalize_phrase(&focused);
    if focused_phrase.chars().count() >= 4 && !phrases.contains(&focused_phrase) {
        phrases.insert(0, focused_phrase);
    }

    ExpandedQuery {
        tokens,
        token_set,
        phrases,
        clauses,
        char_ngrams: char_ngrams(&focused, 3),
    }
}

fn split_query_clauses(input: &str) -> Vec<Vec<String>> {
    let normalized = input
        .replace('\n', " ")
        .replace('\r', " ")
        .replace(" 그리고 ", ", ")
        .replace(" 및 ", ", ")
        .replace(" and ", ", ")
        .replace(" or ", ", ");
    let mut clauses = Vec::new();
    for part in normalized.split(|ch| matches!(ch, ',' | ';' | '?' | '!')) {
        let clause_tokens = tokenize(part)
            .into_iter()
            .filter(|token| !is_stop_token(token))
            .collect::<Vec<_>>();
        if clause_tokens.is_empty() {
            continue;
        }
        clauses.push(clause_tokens);
    }
    clauses
}

fn normalize_phrase(input: &str) -> String {
    input
        .chars()
        .map(|ch| {
            let is_korean = ('\u{AC00}'..='\u{D7A3}').contains(&ch);
            if ch.is_alphanumeric() || is_korean || ch.is_whitespace() {
                ch.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn char_ngrams(input: &str, n: usize) -> HashSet<String> {
    let normalized = normalize_phrase(input).replace(' ', "");
    let chars = normalized.chars().collect::<Vec<_>>();
    if chars.is_empty() {
        return HashSet::new();
    }
    if chars.len() <= n {
        return HashSet::from([normalized]);
    }
    let mut out = HashSet::new();
    for start in 0..=(chars.len() - n) {
        out.insert(chars[start..start + n].iter().collect());
    }
    out
}

fn is_stop_token(token: &str) -> bool {
    matches!(
        token,
        "please"
            | "show"
            | "give"
            | "make"
            | "write"
            | "with"
            | "from"
            | "that"
            | "this"
            | "into"
            | "about"
            | "using"
            | "task"
            | "request"
            | "prompt"
            | "context"
            | "summary"
            | "요청"
            | "정리"
            | "분석"
            | "설명"
            | "작성"
            | "기반"
            | "관련"
            | "중심"
            | "통해"
            | "대한"
            | "해주세요"
            | "해줘"
            | "해줘요"
    )
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

fn score_chunk_candidate(
    expanded_query: &ExpandedQuery,
    file_id: String,
    file_name: String,
    chunk: String,
    chunk_index: usize,
) -> Option<ChunkCandidate> {
    let chunk_tokens = tokenize(&chunk);
    if chunk_tokens.is_empty() {
        return None;
    }

    let token_set = chunk_tokens.iter().cloned().collect::<HashSet<_>>();
    let mut freq: HashMap<&str, usize> = HashMap::new();
    for token in &chunk_tokens {
        *freq.entry(token.as_str()).or_insert(0) += 1;
    }

    let mut matched_query_tokens = HashSet::new();
    let lexical = lexical_score(&expanded_query.tokens, &chunk, chunk_index);
    for token in &expanded_query.tokens {
        if freq.contains_key(token.as_str()) {
            matched_query_tokens.insert(token.clone());
        }
    }

    let coverage = if expanded_query.tokens.is_empty() {
        0.0
    } else {
        matched_query_tokens.len() as f32 / expanded_query.tokens.len() as f32
    };
    let normalized_chunk = normalize_phrase(&chunk);
    let phrase_hits = expanded_query
        .phrases
        .iter()
        .filter(|phrase| phrase.len() >= 4 && normalized_chunk.contains(phrase.as_str()))
        .count();
    let clause_hits = expanded_query
        .clauses
        .iter()
        .filter(|clause| {
            let matched = clause
                .iter()
                .filter(|token| token_set.contains(token.as_str()))
                .count();
            matched >= clause.len().min(2)
        })
        .count();
    let chunk_ngrams = char_ngrams(&chunk, 3);
    let trigram_similarity = jaccard_similarity(&expanded_query.char_ngrams, &chunk_ngrams);
    let density = if chunk_tokens.is_empty() {
        0.0
    } else {
        matched_query_tokens.len() as f32 / chunk_tokens.len() as f32
    };

    let score = lexical
        + coverage * 5.5
        + phrase_hits as f32 * 3.5
        + clause_hits as f32 * 2.25
        + trigram_similarity * 4.0
        + density * 3.0;

    if score <= 0.0 && matched_query_tokens.is_empty() && phrase_hits == 0 && clause_hits == 0 {
        return None;
    }

    Some(ChunkCandidate {
        file_id,
        file_name,
        chunk_index: chunk_index + 1,
        text: chunk,
        score,
        matched_query_tokens,
        token_set,
        char_ngrams: chunk_ngrams,
    })
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

fn jaccard_similarity(left: &HashSet<String>, right: &HashSet<String>) -> f32 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let intersection = left.intersection(right).count();
    if intersection == 0 {
        return 0.0;
    }
    let union = left.union(right).count();
    if union == 0 {
        0.0
    } else {
        intersection as f32 / union as f32
    }
}

fn pack_context_candidates(
    expanded_query: &ExpandedQuery,
    candidates: Vec<ChunkCandidate>,
    top_k: usize,
    max_chars: usize,
) -> Vec<KnowledgeSnippet> {
    let distinct_file_count = candidates
        .iter()
        .map(|candidate| candidate.file_name.as_str())
        .collect::<HashSet<_>>()
        .len();
    let mut remaining = candidates.into_iter().take(64).collect::<Vec<_>>();
    let mut snippets = Vec::new();
    let mut covered_query_tokens = HashSet::new();
    let mut selected_token_sets: Vec<HashSet<String>> = Vec::new();
    let mut selected_char_ngrams: Vec<HashSet<String>> = Vec::new();
    let mut selected_files = HashSet::new();
    let mut used_chars = 0usize;

    while snippets.len() < top_k && !remaining.is_empty() {
        let remain_chars = max_chars.saturating_sub(used_chars);
        if remain_chars < 40 {
            break;
        }

        let mut best_index = None;
        let mut best_gain = f32::NEG_INFINITY;

        for (index, candidate) in remaining.iter().enumerate() {
            let similarity_penalty = selected_token_sets
                .iter()
                .map(|selected| jaccard_similarity(selected, &candidate.token_set))
                .fold(0.0, f32::max)
                + selected_char_ngrams
                    .iter()
                    .map(|selected| jaccard_similarity(selected, &candidate.char_ngrams))
                    .fold(0.0, f32::max);
            let new_token_gain = candidate
                .matched_query_tokens
                .iter()
                .filter(|token| !covered_query_tokens.contains(token.as_str()))
                .count() as f32;
            let same_file = selected_files.contains(candidate.file_name.as_str());
            let unseen_files_remaining = selected_files.len() < distinct_file_count;
            let file_bonus = if same_file {
                if unseen_files_remaining && new_token_gain <= 0.0 {
                    -24.0
                } else if unseen_files_remaining {
                    -6.0
                } else if new_token_gain <= 0.0 {
                    -4.5
                } else {
                    -0.5
                }
            } else {
                0.75
            };
            let coverage_bonus = if expanded_query.token_set.is_empty() {
                0.0
            } else {
                new_token_gain / expanded_query.token_set.len() as f32 * 3.0
            };
            let gain = candidate.score + coverage_bonus + file_bonus - similarity_penalty * 3.5;

            if gain > best_gain {
                best_gain = gain;
                best_index = Some(index);
            }
        }

        let Some(best_index) = best_index else {
            break;
        };
        let candidate = remaining.remove(best_index);
        let text = truncate_chars(&candidate.text, remain_chars.min(MIN_CHUNK_CHARS));
        if text.trim().is_empty() {
            continue;
        }

        used_chars += text.chars().count();
        covered_query_tokens.extend(candidate.matched_query_tokens.iter().cloned());
        selected_files.insert(candidate.file_name.clone());
        selected_token_sets.push(candidate.token_set.clone());
        selected_char_ngrams.push(candidate.char_ngrams.clone());
        snippets.push(KnowledgeSnippet {
            file_id: candidate.file_id,
            file_name: candidate.file_name,
            chunk_index: candidate.chunk_index,
            text,
            score: candidate.score,
        });
    }

    snippets
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn write_temp_markdown(name: &str, body: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("rail-knowledge-retrieve-{name}-{suffix}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join(format!("{name}.md"));
        fs::write(&path, body).expect("write temp file");
        path
    }

    fn file_ref(path: &Path) -> KnowledgeFileRef {
        KnowledgeFileRef {
            id: stable_file_id(&path.to_string_lossy()),
            name: path.file_name().unwrap().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            ext: ".md".to_string(),
            enabled: true,
            size_bytes: None,
            mtime_ms: None,
            status: Some("ready".to_string()),
            status_message: None,
        }
    }

    #[test]
    fn extracts_task_request_before_expanding_query() {
        let focused =
            extract_focus_query("[ROLE_KB_INJECT]\nignore this\n<task_request>steam deck performance optimization</task_request>");
        assert_eq!(focused, "steam deck performance optimization");
        let expanded = expand_query(&focused);
        assert!(expanded.tokens.contains(&"steam".to_string()));
        assert!(!expanded.tokens.contains(&"ignore".to_string()));
    }

    #[test]
    fn hybrid_scoring_prefers_phrase_and_clause_matches() {
        let expanded = expand_query("indie horror steam retention");
        let broad = score_chunk_candidate(
            &expanded,
            "a".to_string(),
            "a.md".to_string(),
            "This note only mentions steam and retention in unrelated places.".to_string(),
            0,
        )
        .expect("broad candidate");
        let focused = score_chunk_candidate(
            &expanded,
            "b".to_string(),
            "b.md".to_string(),
            "An indie horror launch on Steam can improve retention when the core fantasy is clear."
                .to_string(),
            0,
        )
        .expect("focused candidate");
        assert!(focused.score > broad.score);
    }

    #[test]
    fn context_packing_prefers_complementary_evidence_over_duplicates() {
        let path_a = write_temp_markdown(
            "duplicate",
            &format!(
                "{}{}",
                "alpha beta launch checklist repeat. ".repeat(90),
                "alpha beta launch checklist repeat. ".repeat(90)
            ),
        );
        let path_b = write_temp_markdown(
            "complement",
            "gamma delta live-ops guidance helps retention and monetization. "
                .repeat(60)
                .as_str(),
        );

        let result = knowledge_retrieve(
            vec![file_ref(&path_a), file_ref(&path_b)],
            "alpha beta gamma delta".to_string(),
            Some(2),
            Some(2400),
        )
        .expect("knowledge retrieve");

        assert_eq!(result.snippets.len(), 2);
        let file_names = result
            .snippets
            .iter()
            .map(|snippet| snippet.file_name.clone())
            .collect::<HashSet<_>>();
        assert!(file_names.iter().any(|name| name.contains("duplicate")));
        assert!(file_names.iter().any(|name| name.contains("complement")));

        let _ = fs::remove_file(path_a);
        let _ = fs::remove_file(path_b);
    }
}
