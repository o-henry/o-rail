function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sanitizeToken(raw: string): string {
  const normalized = cleanLine(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "role";
}

export function toRoleShortToken(rawRoleId: string): string {
  if (rawRoleId === "pm_planner") {
    return "pm";
  }
  if (rawRoleId === "pm_creative_director") {
    return "pm_idea";
  }
  if (rawRoleId === "pm_feasibility_critic") {
    return "pm_critic";
  }
  if (rawRoleId === "client_programmer") {
    return "client";
  }
  if (rawRoleId === "system_programmer") {
    return "system";
  }
  if (rawRoleId === "tooling_engineer") {
    return "tooling";
  }
  if (rawRoleId === "art_pipeline") {
    return "art";
  }
  if (rawRoleId === "qa_engineer") {
    return "qa";
  }
  if (rawRoleId === "build_release") {
    return "release";
  }
  if (rawRoleId === "technical_writer") {
    return "docs";
  }
  return sanitizeToken(rawRoleId);
}

export function toCompactTimestamp(rawIso: string): string {
  const parsed = new Date(rawIso);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}
