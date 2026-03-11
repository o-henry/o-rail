import { readUserMemoryEntries } from "../../features/studio/userMemoryStore";
import { buildAdaptiveDiff, buildAdaptiveShadowCandidates } from "./candidates";
import { adaptiveFloorFailures, scoreAdaptiveRun, weightedAdaptiveScore } from "./score";
import { createEmptyAdaptiveWorkspaceData, loadAdaptiveWorkspaceData, saveAdaptiveWorkspaceData } from "./storage";
import type {
  AdaptiveChampionRecord,
  AdaptiveComparisonRecord,
  AdaptiveEvaluationInput,
  AdaptiveRecipeSnapshot,
  AdaptiveRubricScore,
  AdaptiveWorkspaceData,
} from "./types";
import { normalizeAdaptiveWorkspaceKey } from "./workspace";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function nowIso(): string {
  return new Date().toISOString();
}

function upsertCandidate(rows: AdaptiveRecipeSnapshot[], candidate: AdaptiveRecipeSnapshot): AdaptiveRecipeSnapshot[] {
  return rows.some((row) => row.id === candidate.id)
    ? rows.map((row) => (row.id === candidate.id ? candidate : row))
    : [candidate, ...rows];
}

function createSeedChampion(workspace: string, recipe: AdaptiveRecipeSnapshot, score: AdaptiveRubricScore, weightedTotal: number): AdaptiveChampionRecord {
  return {
    workspace,
    family: recipe.family,
    recipe,
    score,
    weightedTotal,
    updatedAt: nowIso(),
    seededAt: nowIso(),
  };
}

function buildComparison(params: {
  workspace: string;
  candidate: AdaptiveRecipeSnapshot;
  champion: AdaptiveChampionRecord | null;
  candidateScore: AdaptiveRubricScore;
  candidateWeighted: number;
}): AdaptiveComparisonRecord {
  const championScore = params.champion?.score ?? null;
  const championWeighted = params.champion?.weightedTotal ?? null;
  const candidateFloors = adaptiveFloorFailures(params.candidateScore);
  const championFloors = championScore ? adaptiveFloorFailures(championScore) : null;
  const eligible = candidateFloors.length === 0;
  let winner: AdaptiveComparisonRecord["winner"] = "seed";
  if (params.champion) {
    winner =
      eligible && params.candidateWeighted >= params.champion.weightedTotal + 0.6
        ? "candidate"
        : "champion";
  }
  return {
    id: `${params.candidate.id}:${Date.now().toString(36)}`,
    workspace: params.workspace,
    family: params.candidate.family,
    candidate: params.candidate,
    champion: params.champion?.recipe ?? null,
    scores: {
      candidate: params.candidateScore,
      champion: championScore,
    },
    weightedTotal: {
      candidate: params.candidateWeighted,
      champion: championWeighted,
    },
    floorFailures: {
      candidate: candidateFloors,
      champion: championFloors,
    },
    winner,
    eligible,
    promoted: false,
    diff: buildAdaptiveDiff(params.candidate, params.champion?.recipe ?? null),
    createdAt: nowIso(),
  };
}

function shouldPromoteCandidate(comparisons: AdaptiveComparisonRecord[], recipeId: string): boolean {
  const eligibleRows = comparisons.filter((row) => row.eligible).slice(0, 5);
  if (eligibleRows.length < 3) {
    return false;
  }
  const wins = eligibleRows.filter((row) => row.winner === "candidate" && row.candidate.id === recipeId).length;
  return wins >= 3;
}

function buildUserMemoryLines() {
  return readUserMemoryEntries().map((entry) => entry.text.trim()).filter(Boolean);
}

export async function evaluateAdaptiveRecipe(params: {
  cwd: string;
  invokeFn: InvokeFn;
  recipe: AdaptiveRecipeSnapshot;
  evaluation: AdaptiveEvaluationInput;
}): Promise<AdaptiveWorkspaceData> {
  const workspace = normalizeAdaptiveWorkspaceKey(params.cwd);
  const current = await loadAdaptiveWorkspaceData(params.cwd, params.invokeFn).catch(() => createEmptyAdaptiveWorkspaceData(params.cwd));
  const nextCandidates = [params.recipe, ...buildAdaptiveShadowCandidates(params.recipe)].reduce(upsertCandidate, current.candidates);
  const candidateScore = scoreAdaptiveRun({
    ...params.evaluation,
    userMemory: params.evaluation.userMemory.length > 0 ? params.evaluation.userMemory : buildUserMemoryLines(),
  });
  const candidateWeighted = weightedAdaptiveScore(params.recipe.family, candidateScore);
  const currentChampion = current.champions.find((row) => row.family === params.recipe.family) ?? null;
  let comparison = buildComparison({
    workspace,
    candidate: params.recipe,
    champion: currentChampion,
    candidateScore,
    candidateWeighted,
  });
  let champions = [...current.champions];

  if (!currentChampion) {
    const seeded = createSeedChampion(workspace, params.recipe, candidateScore, candidateWeighted);
    champions = [seeded, ...champions.filter((row) => row.family !== params.recipe.family)];
    comparison = {
      ...comparison,
      winner: "seed",
    };
  } else if (currentChampion.recipe.id === params.recipe.id) {
    champions = [
      {
        ...currentChampion,
        recipe: params.recipe,
        score: candidateScore,
        weightedTotal: candidateWeighted,
        updatedAt: nowIso(),
      },
      ...champions.filter((row) => row.family !== params.recipe.family),
    ];
  } else if (
    current.profile.learningState === "active" &&
    comparison.winner === "candidate" &&
    shouldPromoteCandidate([comparison, ...current.comparisons.filter((row) => row.family === params.recipe.family)], params.recipe.id)
  ) {
    const promotedChampion: AdaptiveChampionRecord = {
      workspace,
      family: params.recipe.family,
      recipe: params.recipe,
      score: candidateScore,
      weightedTotal: candidateWeighted,
      updatedAt: nowIso(),
      promotedAt: nowIso(),
    };
    champions = [promotedChampion, ...champions.filter((row) => row.family !== params.recipe.family)];
    comparison = {
      ...comparison,
      promoted: true,
    };
  }

  const next: AdaptiveWorkspaceData = {
    profile: {
      ...current.profile,
      workspace,
      updatedAt: nowIso(),
    },
    champions,
    comparisons: [comparison, ...current.comparisons],
    candidates: nextCandidates,
  };
  return saveAdaptiveWorkspaceData(params.cwd, params.invokeFn, next);
}
