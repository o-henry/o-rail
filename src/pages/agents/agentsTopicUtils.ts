import { DASHBOARD_TOPIC_IDS, type DashboardTopicId } from "../../features/dashboard/intelligence";
import type { StudioRoleId } from "../../features/studio/handoffTypes";
import { toStudioRoleId } from "../../features/studio/roleUtils";

export function topicFromSetId(setId: string | null): DashboardTopicId | null {
  if (!setId || !setId.startsWith("data-")) {
    return null;
  }
  const candidate = setId.slice(5);
  return DASHBOARD_TOPIC_IDS.includes(candidate as DashboardTopicId) ? (candidate as DashboardTopicId) : null;
}

export function formatTopicToken(topic: string): string {
  return String(topic ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toUpperCase();
}

export function roleFromSetId(setId: string | null): StudioRoleId | null {
  const normalized = String(setId ?? "").trim();
  if (!normalized.startsWith("role-")) {
    return null;
  }
  return toStudioRoleId(normalized.slice(5));
}
