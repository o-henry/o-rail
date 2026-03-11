import type { AdaptiveFamilyKey } from "./types";
import type { StudioRoleId } from "../../features/studio/handoffTypes";
import type { PresetKind } from "../../features/workflow/domain";

export function resolveAdaptiveFamilyBucket(
  family: AdaptiveFamilyKey,
): "creative" | "research" | "development" | "validation" | "fullstack" | "unityGame" {
  if (family.startsWith("preset:")) {
    const presetKind = family.slice("preset:".length) as PresetKind;
    if (presetKind === "creative") return "creative";
    if (presetKind === "research" || presetKind === "expert" || presetKind === "newsTrend") return "research";
    if (presetKind === "development") return "development";
    if (presetKind === "fullstack") return "fullstack";
    if (presetKind === "unityGame") return "unityGame";
    return "validation";
  }
  if (family.startsWith("role:")) {
    const roleId = family.slice("role:".length) as StudioRoleId;
    if (roleId === "pm_planner" || roleId === "pm_creative_director" || roleId === "client_programmer" || roleId === "art_pipeline") {
      return "creative";
    }
    if (roleId === "system_programmer" || roleId === "tooling_engineer") {
      return "development";
    }
    if (roleId === "technical_writer") {
      return "research";
    }
    return "validation";
  }
  return "development";
}

export function formatAdaptiveFamilyLabel(family: AdaptiveFamilyKey): string {
  if (family.startsWith("preset:")) {
    const value = family.slice("preset:".length);
    if (value === "creative") return "템플릿 · 창의";
    if (value === "research") return "템플릿 · 리서치";
    if (value === "development") return "템플릿 · 개발";
    if (value === "validation") return "템플릿 · 검증";
    if (value === "fullstack") return "템플릿 · 풀스택";
    if (value === "unityGame") return "템플릿 · 유니티 게임";
    return `템플릿 · ${value}`;
  }
  if (family.startsWith("role:")) {
    const value = family.slice("role:".length);
    if (value === "pm_planner") return "역할 · 기획(PM)";
    if (value === "client_programmer") return "역할 · 클라이언트";
    if (value === "system_programmer") return "역할 · 시스템";
    if (value === "tooling_engineer") return "역할 · 툴링";
    if (value === "art_pipeline") return "역할 · 아트 파이프라인";
    if (value === "qa_engineer") return "역할 · QA";
    if (value === "build_release") return "역할 · 빌드·릴리즈";
    if (value === "technical_writer") return "역할 · 문서화";
    return `역할 · ${value}`;
  }
  return "커스텀 그래프";
}

export function canGenerateShadowCandidates(family: AdaptiveFamilyKey): boolean {
  return family.startsWith("preset:") || family.startsWith("role:");
}
