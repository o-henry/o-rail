use crate::task_presets;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskAgentPromptPack {
    pub id: String,
    pub label: String,
    pub studio_role_id: String,
    pub model: String,
    pub model_reasoning_effort: String,
    pub sandbox_mode: String,
    pub output_artifact_name: String,
    pub prompt_doc_file: String,
    pub developer_instructions: String,
}

#[derive(Debug, Deserialize)]
struct TaskAgentPromptPackToml {
    label: String,
    studio_role_id: String,
    model: Option<String>,
    model_reasoning_effort: Option<String>,
    sandbox_mode: Option<String>,
    output_artifact_name: Option<String>,
    prompt_doc_file: Option<String>,
    developer_instructions: Option<String>,
}

struct TaskAgentPromptPackSource {
    id: &'static str,
    toml_file_name: &'static str,
    prompt_doc_file_name: &'static str,
    toml_text: &'static str,
    prompt_doc_text: &'static str,
}

const TASK_AGENT_PROMPT_PACK_SOURCES: &[TaskAgentPromptPackSource] = &[
    TaskAgentPromptPackSource {
        id: "game_designer",
        toml_file_name: "game_designer.toml",
        prompt_doc_file_name: "game_designer.md",
        toml_text: include_str!("../resources/tasks_agents/game_designer.toml"),
        prompt_doc_text: include_str!("../resources/tasks_agents/game_designer.md"),
    },
    TaskAgentPromptPackSource {
        id: "level_designer",
        toml_file_name: "level_designer.toml",
        prompt_doc_file_name: "level_designer.md",
        toml_text: include_str!("../resources/tasks_agents/level_designer.toml"),
        prompt_doc_text: include_str!("../resources/tasks_agents/level_designer.md"),
    },
    TaskAgentPromptPackSource {
        id: "researcher",
        toml_file_name: "researcher.toml",
        prompt_doc_file_name: "researcher.md",
        toml_text: include_str!("../resources/tasks_agents/researcher.toml"),
        prompt_doc_text: include_str!("../resources/tasks_agents/researcher.md"),
    },
    TaskAgentPromptPackSource {
        id: "unity_architect",
        toml_file_name: "unity_architect.toml",
        prompt_doc_file_name: "unity_architect.md",
        toml_text: include_str!("../resources/tasks_agents/unity_architect.toml"),
        prompt_doc_text: include_str!("../resources/tasks_agents/unity_architect.md"),
    },
    TaskAgentPromptPackSource {
        id: "unity_implementer",
        toml_file_name: "unity_implementer.toml",
        prompt_doc_file_name: "unity_implementer.md",
        toml_text: include_str!("../resources/tasks_agents/unity_implementer.toml"),
        prompt_doc_text: include_str!("../resources/tasks_agents/unity_implementer.md"),
    },
    TaskAgentPromptPackSource {
        id: "technical_artist",
        toml_file_name: "technical_artist.toml",
        prompt_doc_file_name: "technical_artist.md",
        toml_text: include_str!("../resources/tasks_agents/technical_artist.toml"),
        prompt_doc_text: include_str!("../resources/tasks_agents/technical_artist.md"),
    },
    TaskAgentPromptPackSource {
        id: "unity_editor_tools",
        toml_file_name: "unity_editor_tools.toml",
        prompt_doc_file_name: "unity_editor_tools.md",
        toml_text: include_str!("../resources/tasks_agents/unity_editor_tools.toml"),
        prompt_doc_text: include_str!("../resources/tasks_agents/unity_editor_tools.md"),
    },
    TaskAgentPromptPackSource {
        id: "qa_playtester",
        toml_file_name: "qa_playtester.toml",
        prompt_doc_file_name: "qa_playtester.md",
        toml_text: include_str!("../resources/tasks_agents/qa_playtester.toml"),
        prompt_doc_text: include_str!("../resources/tasks_agents/qa_playtester.md"),
    },
    TaskAgentPromptPackSource {
        id: "release_steward",
        toml_file_name: "release_steward.toml",
        prompt_doc_file_name: "release_steward.md",
        toml_text: include_str!("../resources/tasks_agents/release_steward.toml"),
        prompt_doc_text: include_str!("../resources/tasks_agents/release_steward.md"),
    },
    TaskAgentPromptPackSource {
        id: "handoff_writer",
        toml_file_name: "handoff_writer.toml",
        prompt_doc_file_name: "handoff_writer.md",
        toml_text: include_str!("../resources/tasks_agents/handoff_writer.toml"),
        prompt_doc_text: include_str!("../resources/tasks_agents/handoff_writer.md"),
    },
];

fn prompt_pack_source(raw: &str) -> Option<&'static TaskAgentPromptPackSource> {
    let canonical = task_presets::canonical_task_agent_id(raw)?;
    TASK_AGENT_PROMPT_PACK_SOURCES
        .iter()
        .find(|source| source.id == canonical)
}

fn parse_prompt_pack(source: &TaskAgentPromptPackSource) -> Result<TaskAgentPromptPack, String> {
    let parsed = toml::from_str::<TaskAgentPromptPackToml>(source.toml_text).map_err(|error| {
        format!(
            "failed to parse task agent prompt pack {}: {error}",
            source.toml_file_name
        )
    })?;

    Ok(TaskAgentPromptPack {
        id: source.id.to_string(),
        label: parsed.label,
        studio_role_id: parsed.studio_role_id,
        model: parsed.model.unwrap_or_else(|| "gpt-5.4".to_string()),
        model_reasoning_effort: parsed
            .model_reasoning_effort
            .unwrap_or_else(|| "medium".to_string()),
        sandbox_mode: parsed
            .sandbox_mode
            .unwrap_or_else(|| "workspace-write".to_string()),
        output_artifact_name: parsed
            .output_artifact_name
            .unwrap_or_else(|| format!("{}.md", source.id)),
        prompt_doc_file: parsed
            .prompt_doc_file
            .unwrap_or_else(|| source.prompt_doc_file_name.to_string()),
        developer_instructions: if source.prompt_doc_text.trim().is_empty() {
            parsed.developer_instructions.unwrap_or_default()
        } else {
            source.prompt_doc_text.trim().to_string()
        },
    })
}

pub fn builtin_task_agent_prompt_pack(raw: &str) -> Result<TaskAgentPromptPack, String> {
    let source = prompt_pack_source(raw)
        .ok_or_else(|| format!("unknown task agent prompt pack: {raw}"))?;
    parse_prompt_pack(source)
}

pub fn sync_builtin_task_agent_prompt_packs(runtime_agents_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(runtime_agents_dir).map_err(|error| {
        format!(
            "failed to create runtime agents directory {}: {error}",
            runtime_agents_dir.display()
        )
    })?;

    for source in TASK_AGENT_PROMPT_PACK_SOURCES {
        let destination = runtime_agents_dir.join(source.toml_file_name);
        let should_write = match fs::read_to_string(&destination) {
            Ok(existing) => existing != source.toml_text,
            Err(_) => true,
        };
        if should_write {
            fs::write(&destination, source.toml_text).map_err(|error| {
                format!(
                    "failed to write task agent pack {}: {error}",
                    destination.display()
                )
            })?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn task_agent_pack_read(role_id: String) -> Result<TaskAgentPromptPack, String> {
    builtin_task_agent_prompt_pack(&role_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_pack_read_normalizes_legacy_aliases() {
        let pack = builtin_task_agent_prompt_pack("worker").unwrap();
        assert_eq!(pack.id, "unity_implementer");
        assert_eq!(pack.sandbox_mode, "workspace-write");
        assert!(pack.developer_instructions.contains("Unity"));
    }

    #[test]
    fn prompt_pack_read_supports_studio_role_and_researcher_alias() {
        let architect_pack = builtin_task_agent_prompt_pack("system_programmer").unwrap();
        assert_eq!(architect_pack.id, "unity_architect");

        let researcher_pack = builtin_task_agent_prompt_pack("scraper").unwrap();
        assert_eq!(researcher_pack.id, "researcher");
        assert!(researcher_pack.developer_instructions.contains("검색"));
    }
}
