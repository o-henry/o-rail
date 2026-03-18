pub struct TaskAgentPreset {
    pub id: &'static str,
    pub label: &'static str,
    pub studio_role_id: &'static str,
    pub default_summary: &'static str,
    pub default_instruction: &'static str,
    pub discussion_line: &'static str,
}

pub const UNITY_TASK_AGENT_PRESETS: [TaskAgentPreset; 9] = [
    TaskAgentPreset {
        id: "game_designer",
        label: "GAME DESIGNER",
        studio_role_id: "pm_planner",
        default_summary: "플레이어 목표, 작업 범위, 핵심 메커닉 의도와 기능 명세를 정리하고 있습니다.",
        default_instruction: "집중할 점: 대상 Unity 기능, 플레이어 목표, 범위, 제약 조건, 기능 명세와 open question을 한국어로 명확히 정리하세요.",
        discussion_line: "GAME DESIGNER: 기능 목표, 플레이 판타지, 구현 범위와 기능 명세를 한국어로 정리하고 있습니다.",
    },
    TaskAgentPreset {
        id: "level_designer",
        label: "LEVEL DESIGNER",
        studio_role_id: "pm_creative_director",
        default_summary: "레벨 흐름, 전투 템포, 공간 연출, 플레이 동선을 정리하고 있습니다.",
        default_instruction: "집중할 점: 씬 흐름, 전투 템포, 레벨별 설계 메모, encounter와 pacing 문제를 한국어로 정리하세요.",
        discussion_line: "LEVEL DESIGNER: 씬 흐름, 템포, 동선, 전투 가독성을 한국어로 정리하고 있습니다.",
    },
    TaskAgentPreset {
        id: "unity_architect",
        label: "UNITY ARCHITECT",
        studio_role_id: "system_programmer",
        default_summary: "Unity 아키텍처, 코드맵, 데이터 흐름, 성능과 통합 리스크를 검토하고 있습니다.",
        default_instruction: "집중할 점: 아키텍처, 시스템 경계, 코드맵, 데이터 흐름, 성능 병목, Unity 통합 리스크와 리뷰 포인트를 한국어로 검토하세요.",
        discussion_line: "UNITY ARCHITECT: 아키텍처 경계, 코드 구조, 성능 병목, 통합 리스크를 한국어로 점검하고 있습니다.",
    },
    TaskAgentPreset {
        id: "unity_implementer",
        label: "UNITY IMPLEMENTER",
        studio_role_id: "client_programmer",
        default_summary: "Unity 게임플레이, UI, C# 구현과 디버깅 작업을 준비하고 있습니다.",
        default_instruction: "집중할 점: 요청된 Unity 변경을 안전하게 구현하고, C# 코드 수정, 버그 디버깅, UI 수정 결과와 핵심 diff를 한국어로 요약하세요.",
        discussion_line: "UNITY IMPLEMENTER: 구현 경로, 디버깅 포인트, 수정 가능성이 높은 파일을 한국어로 정리하고 있습니다.",
    },
    TaskAgentPreset {
        id: "technical_artist",
        label: "TECHNICAL ARTIST",
        studio_role_id: "art_pipeline",
        default_summary: "아트 파이프라인, 셰이더, 프리팹, VFX, 에셋 연결 제약을 확인하고 있습니다.",
        default_instruction: "집중할 점: Unity 통합을 위한 프리팹, 셰이더, VFX, 렌더링, 콘텐츠 연결 제약과 시각 품질 리스크를 한국어로 검토하세요.",
        discussion_line: "TECHNICAL ARTIST: 에셋 연결, 프리팹 안전성, 셰이더/VFX 제약을 한국어로 점검하고 있습니다.",
    },
    TaskAgentPreset {
        id: "unity_editor_tools",
        label: "UNITY EDITOR TOOLS",
        studio_role_id: "tooling_engineer",
        default_summary: "에디터 툴링, 자동화, 검증 보조 도구와 생산성 개선을 설계하고 있습니다.",
        default_instruction: "집중할 점: Unity 에디터 툴, 자동화, 검증 보조 기능, 개발 생산성 개선 도구를 한국어로 설계하거나 개선하세요.",
        discussion_line: "UNITY EDITOR TOOLS: 이 작업에 필요한 에디터 자동화, validator, 툴 지원을 한국어로 검토하고 있습니다.",
    },
    TaskAgentPreset {
        id: "qa_playtester",
        label: "QA PLAYTESTER",
        studio_role_id: "qa_engineer",
        default_summary: "Unity 검증 절차, 재현 케이스, 테스트 작성과 플레이테스트 항목을 준비하고 있습니다.",
        default_instruction: "집중할 점: Unity 변경에 대한 플레이테스트 절차, 검증 항목, 회귀 체크, 테스트 시나리오 작성을 한국어로 정리하세요.",
        discussion_line: "QA PLAYTESTER: 검증 범위, 테스트 시나리오, 재현 절차, 회귀 체크를 한국어로 정리하고 있습니다.",
    },
    TaskAgentPreset {
        id: "release_steward",
        label: "RELEASE STEWARD",
        studio_role_id: "build_release",
        default_summary: "빌드 상태, 릴리즈 막힘 요소, CI와 최종 통합 준비 상태를 검토하고 있습니다.",
        default_instruction: "집중할 점: 마감 전에 릴리즈 준비 상태, 빌드/CI 정상 여부, 통합 막힘 요소를 한국어로 확인하세요.",
        discussion_line: "RELEASE STEWARD: 빌드 상태, CI 현황, 승인 상태, 릴리즈 준비 정도를 한국어로 점검하고 있습니다.",
    },
    TaskAgentPreset {
        id: "handoff_writer",
        label: "HANDOFF WRITER",
        studio_role_id: "technical_writer",
        default_summary: "최종 인계 메모, 알려진 이슈, 문서화와 다음 단계 문서를 정리하고 있습니다.",
        default_instruction: "집중할 점: Unity 작업의 최종 인계 내용, 변경 영역, 후속 메모, 문서화를 한국어로 정리하세요.",
        discussion_line: "HANDOFF WRITER: 다음 담당자를 위한 인계 문서, 문서화, 정리 내용을 한국어로 작성하고 있습니다.",
    },
];

pub const UNITY_TASK_AGENT_ORDER: [&str; 9] = [
    "game_designer",
    "level_designer",
    "unity_architect",
    "unity_implementer",
    "technical_artist",
    "unity_editor_tools",
    "qa_playtester",
    "release_steward",
    "handoff_writer",
];

pub fn unity_task_agent_presets() -> &'static [TaskAgentPreset] {
    &UNITY_TASK_AGENT_PRESETS
}

pub fn task_team_preset_ids(team: &str) -> Vec<&'static str> {
    match team.trim().to_lowercase().as_str() {
        "solo" => vec!["game_designer", "unity_implementer", "qa_playtester"],
        "duo" => vec![
            "game_designer",
            "unity_implementer",
            "qa_playtester",
            "unity_architect",
            "technical_artist",
        ],
        "full-squad" => UNITY_TASK_AGENT_ORDER.to_vec(),
        _ => Vec::new(),
    }
}

pub fn canonical_task_agent_id(raw: &str) -> Option<&'static str> {
    match raw.trim().to_lowercase().as_str() {
        "game_designer" | "designer" | "explorer" | "planner" | "spec" | "brief" => Some("game_designer"),
        "level_designer" | "level" | "encounter" | "pacing" => Some("level_designer"),
        "unity_architect" | "architect" | "reviewer" | "review" | "codemap" | "code_mapper" | "mapper" | "performance" | "perf" => Some("unity_architect"),
        "unity_implementer" | "implementer" | "worker" | "csharp" | "csharp_developer" | "debug" | "debugger" | "fixer" | "ui" | "ui_fixer" => Some("unity_implementer"),
        "technical_artist" | "techart" | "shader" | "vfx" | "prefab" => Some("technical_artist"),
        "unity_editor_tools" | "tools" | "automation" | "editor" | "validator" => Some("unity_editor_tools"),
        "qa_playtester" | "playtest" | "qa" | "tester" | "test" | "regression" => Some("qa_playtester"),
        "release_steward" | "release" | "build" | "ci" => Some("release_steward"),
        "handoff_writer" | "docs" | "documentation" | "handoff" => Some("handoff_writer"),
        _ => None,
    }
}

pub fn task_agent_preset(raw: &str) -> Option<&'static TaskAgentPreset> {
    let normalized = canonical_task_agent_id(raw)?;
    UNITY_TASK_AGENT_PRESETS.iter().find(|preset| preset.id == normalized)
}

pub fn task_agent_label(raw: &str) -> String {
    task_agent_preset(raw)
        .map(|preset| preset.label.to_string())
        .unwrap_or_else(|| raw.trim().to_uppercase())
}

pub fn task_agent_studio_role_id(raw: &str) -> Option<String> {
    task_agent_preset(raw).map(|preset| preset.studio_role_id.to_string())
}

pub fn task_agent_summary(raw: &str) -> String {
    task_agent_preset(raw)
        .map(|preset| preset.default_summary.to_string())
        .unwrap_or_else(|| "다음 Unity 제작 단계를 준비하고 있습니다.".to_string())
}

pub fn task_agent_instruction(raw: &str, prompt: &str) -> String {
    let trimmed_prompt = prompt.trim();
    task_agent_preset(raw)
        .map(|preset| format!("{trimmed_prompt}\n\n{}", preset.default_instruction))
        .unwrap_or_else(|| trimmed_prompt.to_string())
}

pub fn task_agent_discussion_line(raw: &str) -> String {
    task_agent_preset(raw)
        .map(|preset| preset.discussion_line.to_string())
        .unwrap_or_else(|| "UNITY AGENT: 다음 제작 단계를 한국어로 정리하고 있습니다.".to_string())
}

pub fn ordered_task_agent_ids<I, S>(ids: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let normalized = ids
        .into_iter()
        .filter_map(|id| canonical_task_agent_id(id.as_ref()).map(str::to_string))
        .collect::<std::collections::BTreeSet<_>>();
    UNITY_TASK_AGENT_ORDER
        .iter()
        .filter(|id| normalized.contains(**id))
        .map(|id| (*id).to_string())
        .collect()
}

fn unique_task_agent_ids_preserve_order<I, S>(ids: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut seen = std::collections::BTreeSet::new();
    let mut ordered = Vec::new();
    for raw in ids {
        let Some(normalized) = canonical_task_agent_id(raw.as_ref()).map(str::to_string) else {
            continue;
        };
        if seen.insert(normalized.clone()) {
            ordered.push(normalized);
        }
    }
    ordered
}

pub fn default_run_task_agent_ids(enabled: &[String], requested: &[String]) -> Vec<String> {
    let filtered = unique_task_agent_ids_preserve_order(requested.iter().map(String::as_str));
    if !filtered.is_empty() {
        return filtered
            .into_iter()
            .filter(|value| enabled.iter().any(|row| row == value))
            .collect();
    }
    if enabled.iter().any(|value| value == "game_designer") {
        return vec!["game_designer".to_string()];
    }
    if enabled.iter().any(|value| value == "unity_implementer") {
        return vec!["unity_implementer".to_string()];
    }
    enabled.iter().take(1).cloned().collect()
}

pub fn next_task_agent_id(current: &str, enabled: &[String]) -> Option<String> {
    let current = canonical_task_agent_id(current)?;
    let enabled = ordered_task_agent_ids(enabled.iter().map(String::as_str));
    let index = enabled.iter().position(|value| value == current)?;
    enabled.get(index + 1).cloned()
}

pub fn is_validation_task_agent(raw: &str) -> bool {
    canonical_task_agent_id(raw) == Some("qa_playtester")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_extended_aliases_to_existing_unity_roles() {
        assert_eq!(canonical_task_agent_id("codemap"), Some("unity_architect"));
        assert_eq!(canonical_task_agent_id("performance"), Some("unity_architect"));
        assert_eq!(canonical_task_agent_id("csharp"), Some("unity_implementer"));
        assert_eq!(canonical_task_agent_id("debug"), Some("unity_implementer"));
        assert_eq!(canonical_task_agent_id("validator"), Some("unity_editor_tools"));
        assert_eq!(canonical_task_agent_id("build"), Some("release_steward"));
        assert_eq!(canonical_task_agent_id("documentation"), Some("handoff_writer"));
    }

    #[test]
    fn keeps_requested_order_for_default_runs() {
        let roles = default_run_task_agent_ids(
            &vec![
                "game_designer".to_string(),
                "unity_architect".to_string(),
                "unity_implementer".to_string(),
            ],
            &vec!["unity_implementer".to_string(), "reviewer".to_string()],
        );
        assert_eq!(roles, vec!["unity_implementer".to_string(), "unity_architect".to_string()]);
    }
}
