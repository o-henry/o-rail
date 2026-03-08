import type { StudioRoleId } from "./handoffTypes";

type RoleResearchProfile = {
  keywords: string;
  countries: string;
  sites: string;
  maxItems: number;
  focusLabel: string;
};

const FALLBACK_PROFILE: RoleResearchProfile = {
  keywords: "unity, indie game development, gameplay system, production workflow",
  countries: "US,JP,KR",
  sites: "docs.unity3d.com, gamedeveloper.com, learn.unity.com",
  maxItems: 24,
  focusLabel: "게임 개발 리서치",
};

export const ROLE_RESEARCH_PROFILES: Record<StudioRoleId, RoleResearchProfile> = {
  pm_planner: {
    keywords: "game design, indie game, core loop, retention, progression, player fantasy",
    countries: "US,JP,KR",
    sites: "gamedeveloper.com, gdcvault.com, reddit.com, gamasutra.com",
    maxItems: 22,
    focusLabel: "기획 리서치",
  },
  client_programmer: {
    keywords: "unity gameplay programming, player controller, combat system, input system, animation state machine",
    countries: "US,JP,KR",
    sites: "docs.unity3d.com, learn.unity.com, gamedev.stackexchange.com",
    maxItems: 24,
    focusLabel: "클라이언트 리서치",
  },
  system_programmer: {
    keywords: "unity architecture, save system, event bus, data driven design, performance optimization",
    countries: "US,JP,KR",
    sites: "docs.unity3d.com, gameprogrammingpatterns.com, learn.unity.com",
    maxItems: 24,
    focusLabel: "시스템 리서치",
  },
  tooling_engineer: {
    keywords: "unity editor tooling, custom inspector, build automation, test framework, ci pipeline",
    countries: "US,JP,KR",
    sites: "docs.unity3d.com, github.com, learn.unity.com",
    maxItems: 20,
    focusLabel: "툴링 리서치",
  },
  art_pipeline: {
    keywords: "unity asset pipeline, texture import, model import, addressables, asset optimization",
    countries: "US,JP,KR",
    sites: "docs.unity3d.com, learn.unity.com, gamedeveloper.com",
    maxItems: 20,
    focusLabel: "아트 파이프라인 리서치",
  },
  qa_engineer: {
    keywords: "unity qa workflow, regression checklist, playmode test, bug reproduction, test strategy",
    countries: "US,JP,KR",
    sites: "docs.unity3d.com, martinfowler.com, learn.unity.com",
    maxItems: 18,
    focusLabel: "QA 리서치",
  },
  build_release: {
    keywords: "unity build pipeline, release checklist, platform build issue, ci build report",
    countries: "US,JP,KR",
    sites: "docs.unity3d.com, docs.github.com, learn.unity.com",
    maxItems: 18,
    focusLabel: "빌드 릴리즈 리서치",
  },
  technical_writer: {
    keywords: "game dev documentation, release notes, handoff document, onboarding guide",
    countries: "US,JP,KR",
    sites: "writethedocs.org, developers.google.com, markdownguide.org",
    maxItems: 16,
    focusLabel: "문서화 리서치",
  },
};

export function getRoleResearchProfile(roleId: StudioRoleId): RoleResearchProfile {
  return ROLE_RESEARCH_PROFILES[roleId] ?? FALLBACK_PROFILE;
}

export type { RoleResearchProfile };
