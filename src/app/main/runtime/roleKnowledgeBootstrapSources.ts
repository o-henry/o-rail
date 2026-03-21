import type { StudioRoleId } from "../../../features/studio/handoffTypes";
import { getRoleResearchProfile } from "../../../features/studio/roleResearchProfiles";

const MAX_BOOTSTRAP_CANDIDATES = 7;
const MAX_DOMAIN_TARGETS = 4;
const MAX_DIRECT_DOMAIN_URLS = 2;
const MAX_QUERY_CHARS = 180;

const DUCKDUCKGO_SEARCH = (query: string) => `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
const BING_SEARCH = (query: string) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`;

const DOMAIN_ALIAS_MAP: Record<string, string[]> = {
  steam: ["store.steampowered.com", "steamcommunity.com"],
  스팀: ["store.steampowered.com", "steamcommunity.com"],
  steamcommunity: ["steamcommunity.com"],
  reddit: ["www.reddit.com"],
  레딧: ["www.reddit.com"],
  metacritic: ["www.metacritic.com"],
  메타크리틱: ["www.metacritic.com"],
  opencritic: ["opencritic.com"],
  오픈크리틱: ["opencritic.com"],
  x: ["x.com"],
  트위터: ["x.com"],
  twitter: ["x.com"],
  threads: ["www.threads.net"],
  스레드: ["www.threads.net"],
  youtube: ["www.youtube.com"],
  유튜브: ["www.youtube.com"],
  github: ["github.com"],
  깃허브: ["github.com"],
  unity: ["docs.unity3d.com", "learn.unity.com"],
  유니티: ["docs.unity3d.com", "learn.unity.com"],
  gamedeveloper: ["www.gamedeveloper.com"],
  gdc: ["www.gdcvault.com"],
  gdcvault: ["www.gdcvault.com"],
  gameanalytics: ["gameanalytics.com"],
  stackexchange: ["gamedev.stackexchange.com"],
  gamedev: ["gamedev.stackexchange.com"],
};

function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(rows: string[]): string[] {
  return [...new Set(rows.map((row) => cleanLine(row)).filter(Boolean))];
}

function normalizeDomain(value: string): string {
  return cleanLine(value)
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "www.")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function isLikelyDomain(value: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
}

function truncateQuery(value: string): string {
  const text = cleanLine(value);
  if (text.length <= MAX_QUERY_CHARS) {
    return text;
  }
  return text.slice(0, MAX_QUERY_CHARS).trim();
}

function extractExplicitUrls(userPrompt: string): string[] {
  return uniqueStrings(
    Array.from(userPrompt.matchAll(/https?:\/\/[^\s<>()]+/gi)).map((match) => match[0] ?? ""),
  );
}

function extractPromptDomains(userPrompt: string): string[] {
  const explicit = extractExplicitUrls(userPrompt).map((url) => normalizeDomain(url));
  const inlineDomains = Array.from(userPrompt.matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi))
    .map((match) => normalizeDomain(match[0] ?? ""));
  const aliasDomains = Object.entries(DOMAIN_ALIAS_MAP)
    .flatMap(([alias, domains]) => {
      const pattern = new RegExp(`(^|[^a-z0-9])${alias}([^a-z0-9]|$)`, "i");
      return pattern.test(userPrompt) ? domains : [];
    })
    .map((domain) => normalizeDomain(domain));
  return uniqueStrings([...explicit, ...inlineDomains, ...aliasDomains]).filter(isLikelyDomain);
}

function extractRoleProfileDomains(roleId: StudioRoleId): string[] {
  const profile = getRoleResearchProfile(roleId);
  return uniqueStrings(
    profile.lanes.flatMap((lane) =>
      cleanLine(lane.sites)
        .split(",")
        .map((site) => normalizeDomain(site)),
    ),
  ).filter(isLikelyDomain);
}

function buildQuerySeed(roleId: StudioRoleId, userPrompt?: string): string {
  const profile = getRoleResearchProfile(roleId);
  const prompt = truncateQuery(userPrompt ?? "");
  if (prompt) {
    return prompt;
  }
  const fallback = uniqueStrings([
    profile.focusLabel,
    ...profile.lanes.flatMap((lane) => [lane.keywords ?? "", lane.prompt]),
  ]).join(" ");
  return truncateQuery(fallback);
}

export function buildRoleKnowledgeBootstrapCandidates(params: {
  roleId: StudioRoleId;
  userPrompt?: string;
}): string[] {
  const querySeed = buildQuerySeed(params.roleId, params.userPrompt);
  const explicitUrls = extractExplicitUrls(params.userPrompt ?? "");
  const explicitDomains = explicitUrls.map((url) => normalizeDomain(url));
  const promptDomains = extractPromptDomains(params.userPrompt ?? "").filter(
    (domain) => !explicitDomains.includes(domain),
  );
  const profileDomains = extractRoleProfileDomains(params.roleId);
  const domainTargets = uniqueStrings([...promptDomains, ...profileDomains]).slice(0, MAX_DOMAIN_TARGETS);

  const searchUrls = uniqueStrings([
    DUCKDUCKGO_SEARCH(querySeed),
    BING_SEARCH(querySeed),
    ...domainTargets.map((domain) => DUCKDUCKGO_SEARCH(`${querySeed} site:${domain}`)),
  ]);
  const directDomainUrls = uniqueStrings([
    ...domainTargets.slice(0, MAX_DIRECT_DOMAIN_URLS).map((domain) => `https://${domain}/`),
  ]);

  return uniqueStrings([...explicitUrls, ...searchUrls, ...directDomainUrls]).slice(0, MAX_BOOTSTRAP_CANDIDATES);
}
