import type { StudioRoleId } from "./handoffTypes";

type RoleResearchExecutor =
  | "codex"
  | "via_flow"
  | "web_gemini"
  | "web_gpt"
  | "web_grok"
  | "web_perplexity"
  | "web_claude"
  | "ollama";

type RoleResearchViaNodeType =
  | "source.news"
  | "source.sns"
  | "source.community"
  | "source.dev"
  | "source.market"
  | "source.x"
  | "source.threads"
  | "source.reddit"
  | "source.hn";

export type RoleResearchLaneBlueprint = {
  label: string;
  executor: RoleResearchExecutor;
  viaNodeType?: RoleResearchViaNodeType;
  prompt: string;
  keywords?: string;
  countries?: string;
  sites?: string;
  maxItems?: number;
};

export type RoleResearchProfile = {
  focusLabel: string;
  synthesisPrompt: string;
  verificationPrompt: string;
  lanes: RoleResearchLaneBlueprint[];
};

const COMMON_REGION = "US,JP,KR";

const FALLBACK_PROFILE: RoleResearchProfile = {
  focusLabel: "게임 개발 리서치",
  synthesisPrompt:
    "병렬 조사 결과를 종합해 지금 의사결정에 직접 필요한 사실, 근거, 적용 포인트만 남깁니다.",
  verificationPrompt:
    "종합 결과의 주장과 근거가 실제로 맞물리는지 검증하고, 약한 근거와 추측을 제거한 뒤 최종 참고 노트로 정리합니다.",
  lanes: [
    {
      label: "프로젝트 맥락 정리",
      executor: "codex",
      prompt:
        "현재 레포와 기존 그래프 출력에서 이번 역할 수행에 직접 필요한 구조, 제약, 기존 결정사항을 정리합니다.",
    },
    {
      label: "공식 자료 조사",
      executor: "web_perplexity",
      prompt:
        "공식 문서와 1차 자료를 우선으로 조사해 역할 수행에 필요한 신뢰 가능한 근거를 수집합니다.",
      keywords: "unity, indie game development, gameplay system, production workflow",
      countries: COMMON_REGION,
      sites: "docs.unity3d.com, learn.unity.com, gamedeveloper.com",
      maxItems: 20,
    },
    {
      label: "실전 사례 조사",
      executor: "via_flow",
      viaNodeType: "source.dev",
      prompt:
        "실전 사례, 실패 패턴, 현업 팁을 조사해 바로 적용 가능한 체크포인트를 정리합니다.",
      keywords: "unity, indie game development, gameplay system, production workflow",
      countries: COMMON_REGION,
      sites: "gamedeveloper.com, gameprogrammingpatterns.com, gamedev.stackexchange.com",
      maxItems: 18,
    },
  ],
};

export const ROLE_RESEARCH_PROFILES: Record<StudioRoleId, RoleResearchProfile> = {
  pm_planner: {
    focusLabel: "기획 리서치",
    synthesisPrompt:
      "기획(PM) 관점에서 레퍼런스, 플레이어 동기, 시장 신호를 엮어 코어 루프와 차별화 가설로 압축합니다.",
    verificationPrompt:
      "기획 판단에 쓰일 주장마다 근거를 붙이고, 과장된 시장 해석이나 검증 안 된 감성 문구는 제거합니다.",
    lanes: [
      {
        label: "프로젝트 맥락 정리",
        executor: "codex",
        prompt:
          "현재 프로젝트 문서와 기존 출력에서 게임 목표, 제약, 이미 정해진 방향을 정리해 PM이 바로 참고할 수 있게 만듭니다.",
      },
      {
        label: "시장·레퍼런스 조사",
        executor: "web_perplexity",
        prompt:
          "시장 흐름, 유사 장르 레퍼런스, 플레이어 기대치를 조사해 기획 판단용 기준선을 만듭니다.",
        keywords: "game design, indie game, core loop, retention, progression, player fantasy",
        countries: COMMON_REGION,
        sites: "gamedeveloper.com, gdcvault.com, gamasutra.com, gameanalytics.com",
        maxItems: 22,
      },
      {
        label: "플레이어 동기·리스크 조사",
        executor: "via_flow",
        viaNodeType: "source.community",
        prompt:
          "플레이어 동기, 코어 루프 몰입 포인트, 자주 실패하는 기획 패턴을 조사해 차별화와 리스크를 동시에 정리합니다.",
        keywords: "player motivation, core loop, progression design, indie retention, game design pitfalls",
        countries: COMMON_REGION,
        sites: "reddit.com, gamedeveloper.com, youtube.com, steamcommunity.com",
        maxItems: 20,
      },
    ],
  },
  research_analyst: {
    focusLabel: "시장·커뮤니티 리서치",
    synthesisPrompt:
      "수집된 리뷰, 커뮤니티 반응, 평론가 시그널을 합쳐 실제 아이디어 판단에 쓸 수 있는 근거와 패턴만 남깁니다.",
    verificationPrompt:
      "출처별 편향과 중복을 줄이고, 점수/반응/서술형 근거가 서로 어긋나는 지점을 따로 표시해 과한 일반화를 막습니다.",
    lanes: [
      {
        label: "프로젝트 리서치 목표 정리",
        executor: "codex",
        prompt:
          "현재 요청에서 어떤 장르, 어떤 플레이어 반응, 어떤 평가 신호를 확인해야 하는지 조사 목적과 판단 질문을 정리합니다.",
      },
      {
        label: "커뮤니티·평가 신호 조사",
        executor: "via_flow",
        viaNodeType: "source.community",
        prompt:
          "리뷰, 커뮤니티 토론, 평론가 평점 주변의 공개 반응을 모아 반복되는 호평·악평 패턴을 정리합니다.",
        keywords: "steam review, community sentiment, game criticism, player feedback, genre reception",
        countries: COMMON_REGION,
        sites: "store.steampowered.com, steamcommunity.com, reddit.com, opencritic.com, metacritic.com",
        maxItems: 24,
      },
      {
        label: "보조 검색 검증",
        executor: "web_perplexity",
        prompt:
          "수집된 신호를 보조 검색으로 교차 확인해 장르, 시장성, 플레이어 평가와 관련된 외부 근거를 보강합니다.",
        keywords: "game genre trend, player review pattern, critic score reception, indie market signal",
        countries: COMMON_REGION,
        sites: "gamedeveloper.com, howtomarketagame.com, opencritic.com, metacritic.com",
        maxItems: 18,
      },
    ],
  },
  pm_creative_director: {
    focusLabel: "창의 기획 리서치",
    synthesisPrompt:
      "창의 확장 PM 관점에서 레퍼런스를 단순 모방하지 말고, 낯선 조합과 차별화 가설을 현재 프로젝트 제약에 맞게 재구성합니다.",
    verificationPrompt:
      "아이디어가 실제로 새롭고 의미 있는지, 단순한 장르 클리셰 재조합에 그치지 않는지, 최소 구현 경로가 있는지 검증합니다.",
    lanes: [
      {
        label: "프로젝트 제약·가능성 정리",
        executor: "codex",
        prompt:
          "현재 프로젝트의 장르, 타깃 플레이 감각, 구현 제약, 이미 결정된 방향을 정리하고 어디서 창의적 변주가 가능한지 찾습니다.",
      },
      {
        label: "장르 레퍼런스·신호 조사",
        executor: "web_perplexity",
        prompt:
          "최근 게임 디자인 레퍼런스와 플레이어가 신선하다고 반응한 훅을 조사해 차별화의 재료를 수집합니다.",
        keywords: "innovative game design, genre twist, player fantasy, surprising game loop, indie game hook",
        countries: COMMON_REGION,
        sites: "gamedeveloper.com, gdcvault.com, gameanalytics.com, steamcommunity.com",
        maxItems: 22,
      },
      {
        label: "커뮤니티 반응·신선도 조사",
        executor: "via_flow",
        viaNodeType: "source.community",
        prompt:
          "커뮤니티에서 식상하다고 느끼는 요소와 반대로 신선하다고 반응하는 포인트를 조사해 창의적 차별화에 바로 쓸 단서를 정리합니다.",
        keywords: "fresh game ideas, overused mechanics, unique core loop, player surprise, design twist",
        countries: COMMON_REGION,
        sites: "reddit.com, youtube.com, steamcommunity.com, gamedeveloper.com",
        maxItems: 20,
      },
    ],
  },
  pm_feasibility_critic: {
    focusLabel: "현실성 비평 리서치",
    synthesisPrompt:
      "현실성 비평 PM 관점에서 아이디어를 일정, 구현 난이도, 시장 설득력, 운영 비용 기준으로 해체하고 점수화 가능한 판단 기준으로 정리합니다.",
    verificationPrompt:
      "근거 없는 낙관, 숫자 없는 기대 효과, 구현 리스크 누락을 제거하고 실제 진행 여부를 판단할 수 있는 평가표로 정리합니다.",
    lanes: [
      {
        label: "프로젝트 현실 제약 조사",
        executor: "codex",
        prompt:
          "현재 프로젝트 구조, 인력 가정, 구현 난이도, 이미 존재하는 기술 부채를 정리해 어떤 아이디어가 과한지 판별합니다.",
      },
      {
        label: "시장·운영 리스크 조사",
        executor: "web_perplexity",
        prompt:
          "유사 기획의 시장 반응, 운영 난이도, 밸런싱 비용, 라이브 대응 부담을 조사해 현실성 판단 근거를 만듭니다.",
        keywords: "game design production risk, balancing cost, live ops burden, feature creep, indie scope risk",
        countries: COMMON_REGION,
        sites: "gamedeveloper.com, gameanalytics.com, gdcvault.com, howtomarketagame.com",
        maxItems: 22,
      },
      {
        label: "실패 사례·플레이어 역반응 조사",
        executor: "via_flow",
        viaNodeType: "source.community",
        prompt:
          "유사 기능이나 과한 기획이 실제로 왜 실패했는지, 플레이어가 어디서 이탈했는지 조사해 냉정한 반례를 모읍니다.",
        keywords: "feature creep failure, player backlash, overdesigned system, game scope failure, retention drop",
        countries: COMMON_REGION,
        sites: "reddit.com, gamedeveloper.com, steamcommunity.com, youtube.com",
        maxItems: 20,
      },
    ],
  },
  client_programmer: {
    focusLabel: "클라이언트 리서치",
    synthesisPrompt:
      "클라이언트 프로그래머가 바로 구현 판단을 할 수 있게 입력, 상태 전이, UX 반응성을 기준으로 결과를 종합합니다.",
    verificationPrompt:
      "구현 제안이 현재 프로젝트 구조와 맞는지, 과한 추측이나 엔진 버전 불일치가 없는지 검증합니다.",
    lanes: [
      {
        label: "프로젝트 구현 맥락",
        executor: "codex",
        prompt:
          "현재 레포에서 플레이어 입력, 전투, 애니메이션, UI 흐름을 훑고 이번 기능과 맞닿는 구현 지점을 정리합니다.",
      },
      {
        label: "Unity 공식 구현 조사",
        executor: "web_perplexity",
        prompt:
          "Unity 공식 문서와 학습 자료에서 입력, 애니메이션, 카메라, 상호작용 구현 패턴을 조사합니다.",
        keywords: "unity gameplay programming, player controller, combat system, input system, animation state machine",
        countries: COMMON_REGION,
        sites: "docs.unity3d.com, learn.unity.com, unity.com/blog",
        maxItems: 22,
      },
      {
        label: "실전 패턴·함정 조사",
        executor: "via_flow",
        viaNodeType: "source.dev",
        prompt:
          "실전 구현 예시와 자주 발생하는 상태 전이/입력 꼬임/애니메이션 함정을 조사합니다.",
        keywords: "unity gameplay pitfalls, animation state machine bug, input system issue, controller architecture",
        countries: COMMON_REGION,
        sites: "gamedev.stackexchange.com, github.com, gamedeveloper.com",
        maxItems: 20,
      },
    ],
  },
  system_programmer: {
    focusLabel: "시스템 리서치",
    synthesisPrompt:
      "시스템 프로그래머가 구조를 정할 수 있게 데이터 흐름, 안정성, 확장성, 성능 측면으로 자료를 종합합니다.",
    verificationPrompt:
      "구조 제안이 현재 프로젝트 제약과 부합하는지, 장기 유지보수 리스크가 큰 패턴은 없는지 검증합니다.",
    lanes: [
      {
        label: "레포 구조 조사",
        executor: "codex",
        prompt:
          "현재 레포의 시스템 경계, 저장 구조, 이벤트 흐름, 결합도를 정리해 아키텍처 판단 근거를 만듭니다.",
      },
      {
        label: "공식 문서·패턴 조사",
        executor: "web_perplexity",
        prompt:
          "Unity 공식 문서와 공신력 있는 아키텍처 자료를 조사해 시스템 설계의 기준 패턴을 정리합니다.",
        keywords: "unity architecture, save system, event bus, data driven design, performance optimization",
        countries: COMMON_REGION,
        sites: "docs.unity3d.com, gameprogrammingpatterns.com, learn.unity.com",
        maxItems: 24,
      },
      {
        label: "병목·실패 사례 조사",
        executor: "via_flow",
        viaNodeType: "source.dev",
        prompt:
          "데이터 흐름, 저장, 상태 동기화, 성능 병목에서 자주 발생하는 실패 사례와 회귀 포인트를 조사합니다.",
        keywords: "unity architecture pitfalls, save corruption, event bus issue, performance bottleneck",
        countries: COMMON_REGION,
        sites: "gamedev.stackexchange.com, reddit.com, gamedeveloper.com, github.com",
        maxItems: 20,
      },
    ],
  },
  tooling_engineer: {
    focusLabel: "툴링 리서치",
    synthesisPrompt:
      "툴링 엔지니어가 자동화와 에디터 도구를 설계할 수 있게 생산성, 안전성, 유지비를 기준으로 자료를 종합합니다.",
    verificationPrompt:
      "도구 제안이 프로젝트를 망가뜨리지 않는지, 보호계층과 자동화 경계를 지키는지 검증합니다.",
    lanes: [
      {
        label: "프로젝트 자동화 갭 조사",
        executor: "codex",
        prompt:
          "현재 레포에서 반복 수작업, 빌드/테스트 흐름, 에디터 유틸 부재 지점을 찾아 자동화 후보를 정리합니다.",
      },
      {
        label: "Unity 툴링·CI 조사",
        executor: "web_perplexity",
        prompt:
          "Unity 에디터 툴링, 테스트, CI, batchmode, 빌드 자동화 관련 공식 자료를 조사합니다.",
        keywords: "unity editor tooling, custom inspector, build automation, test framework, ci pipeline",
        countries: COMMON_REGION,
        sites: "docs.unity3d.com, docs.github.com, learn.unity.com, docs.unity.cn",
        maxItems: 20,
      },
      {
        label: "실전 자동화 사례 조사",
        executor: "via_flow",
        viaNodeType: "source.dev",
        prompt:
          "실제 Unity 자동화 사례와 실패 패턴을 조사해 안전한 워크플로와 금지사항을 정리합니다.",
        keywords: "unity automation workflow, editor tooling pitfalls, batchmode safety, ci examples",
        countries: COMMON_REGION,
        sites: "github.com, gamedeveloper.com, blog.unity.com",
        maxItems: 18,
      },
    ],
  },
  art_pipeline: {
    focusLabel: "아트 파이프라인 리서치",
    synthesisPrompt:
      "아트 파이프라인 역할이 바로 쓸 수 있게 임포트 규칙, 용량, 최적화, 협업 경계를 기준으로 결과를 종합합니다.",
    verificationPrompt:
      "제안이 현재 에셋 구조와 충돌하지 않는지, 임포트/번들/최적화 기준이 실제로 검증 가능한지 확인합니다.",
    lanes: [
      {
        label: "프로젝트 에셋 구조 조사",
        executor: "codex",
        prompt:
          "현재 프로젝트의 에셋 폴더 구조, 임포트 관례, 문제 될 만한 중복/대용량 지점을 정리합니다.",
      },
      {
        label: "공식 파이프라인 조사",
        executor: "web_perplexity",
        prompt:
          "Unity 공식 문서 기준으로 텍스처, 모델, Addressables, 임포트 최적화 패턴을 조사합니다.",
        keywords: "unity asset pipeline, texture import, model import, addressables, asset optimization",
        countries: COMMON_REGION,
        sites: "docs.unity3d.com, docs.unity.cn, learn.unity.com",
        maxItems: 20,
      },
      {
        label: "최적화 사례 조사",
        executor: "via_flow",
        viaNodeType: "source.community",
        prompt:
          "실전 프로젝트에서 자주 쓰는 에셋 최적화, 번들 관리, 임포트 트러블슈팅 사례를 조사합니다.",
        keywords: "unity asset optimization, addressables pitfalls, import settings, texture memory",
        countries: COMMON_REGION,
        sites: "gamedeveloper.com, github.com, youtube.com",
        maxItems: 18,
      },
    ],
  },
  qa_engineer: {
    focusLabel: "QA 리서치",
    synthesisPrompt:
      "QA가 바로 테스트 계획과 회귀 체크를 만들 수 있게 재현성, 위험도, 검증 범위 중심으로 자료를 종합합니다.",
    verificationPrompt:
      "체크리스트와 재현 경로가 실제 프로젝트 흐름과 맞는지, 과도하게 넓거나 모호한 검증 항목을 제거합니다.",
    lanes: [
      {
        label: "프로젝트 위험 경로 조사",
        executor: "codex",
        prompt:
          "현재 레포와 최근 출력에서 테스트가 필요한 핵심 경로, 취약 지점, 회귀 위험을 정리합니다.",
      },
      {
        label: "공식 테스트 절차 조사",
        executor: "web_perplexity",
        prompt:
          "Unity 테스트 프레임워크, QA 체크리스트, 회귀 전략 관련 공식/준공식 자료를 조사합니다.",
        keywords: "unity qa workflow, regression checklist, playmode test, bug reproduction, test strategy",
        countries: COMMON_REGION,
        sites: "docs.unity3d.com, learn.unity.com, martinfowler.com",
        maxItems: 18,
      },
      {
        label: "장애·재현 사례 조사",
        executor: "via_flow",
        viaNodeType: "source.community",
        prompt:
          "현업에서 자주 발생하는 장애 유형, 재현 패턴, 누락되기 쉬운 회귀 포인트를 조사합니다.",
        keywords: "unity bug reproduction, playmode regression, qa pitfalls, null reference gameplay",
        countries: COMMON_REGION,
        sites: "gamedev.stackexchange.com, reddit.com, github.com",
        maxItems: 18,
      },
    ],
  },
  build_release: {
    focusLabel: "빌드 릴리즈 리서치",
    synthesisPrompt:
      "빌드·릴리즈 역할이 즉시 사용할 수 있게 빌드 안정성, 배포 순서, 체크리스트, 실패 대응을 중심으로 자료를 종합합니다.",
    verificationPrompt:
      "릴리즈 제안이 현재 파이프라인과 맞는지, 누락된 검증 단계나 위험한 자동 적용이 없는지 검증합니다.",
    lanes: [
      {
        label: "프로젝트 릴리즈 경로 조사",
        executor: "codex",
        prompt:
          "현재 레포와 스크립트에서 빌드/배포 흐름, 버전 표기, 릴리즈 체크포인트를 조사합니다.",
      },
      {
        label: "공식 빌드 절차 조사",
        executor: "web_perplexity",
        prompt:
          "Unity batchmode, BuildReport, 배포 점검 관련 공식 자료를 조사해 릴리즈 기준을 정리합니다.",
        keywords: "unity build pipeline, release checklist, platform build issue, ci build report",
        countries: COMMON_REGION,
        sites: "docs.unity3d.com, docs.unity.cn, docs.github.com, learn.unity.com",
        maxItems: 18,
      },
      {
        label: "실패·운영 사례 조사",
        executor: "via_flow",
        viaNodeType: "source.dev",
        prompt:
          "빌드 실패, 패키지 충돌, 릴리즈 운영 사고 사례와 사전 예방책을 조사합니다.",
        keywords: "unity build failure, release pipeline issue, package conflict, ci rollback",
        countries: COMMON_REGION,
        sites: "github.com, gamedeveloper.com, reddit.com",
        maxItems: 16,
      },
    ],
  },
  technical_writer: {
    focusLabel: "문서화 리서치",
    synthesisPrompt:
      "문서화 역할이 바로 산출물을 만들 수 있게 독자, 전달 구조, 운영 정보, 온보딩 관점으로 자료를 종합합니다.",
    verificationPrompt:
      "문서 구조가 실제 독자와 용도에 맞는지, 근거 없는 추정이나 중복 설명이 없는지 검증합니다.",
    lanes: [
      {
        label: "프로젝트 맥락 정리",
        executor: "codex",
        prompt:
          "현재 레포와 최근 산출물에서 문서화 대상, 독자, 빠진 운영 지식, 핸드오프 포인트를 정리합니다.",
      },
      {
        label: "문서 구조·가이드 조사",
        executor: "web_perplexity",
        prompt:
          "기술 문서, 릴리즈 노트, 핸드오프 문서의 좋은 구조와 체크리스트를 조사합니다.",
        keywords: "game dev documentation, release notes, handoff document, onboarding guide",
        countries: COMMON_REGION,
        sites: "writethedocs.org, developers.google.com, markdownguide.org",
        maxItems: 16,
      },
      {
        label: "실전 템플릿 조사",
        executor: "via_flow",
        viaNodeType: "source.dev",
        prompt:
          "게임 개발 문서 템플릿, 운영 문서 누락 사례, 좋은 전달 방식 사례를 조사합니다.",
        keywords: "game documentation template, release notes example, onboarding guide example",
        countries: COMMON_REGION,
        sites: "github.com, notion.so, docs.github.com",
        maxItems: 14,
      },
    ],
  },
};

export function getRoleResearchProfile(roleId: StudioRoleId): RoleResearchProfile {
  return ROLE_RESEARCH_PROFILES[roleId] ?? FALLBACK_PROFILE;
}
