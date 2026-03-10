import { getByPath, replaceInputPlaceholder, stringifyInput } from "../../../features/workflow/promptUtils";
import type { GateConfig, GraphData, GraphNode, TransformConfig, TransformMode } from "../../../features/workflow/types";
import { tp } from "../../../i18n";

export function executeTransformNode(node: GraphNode, input: unknown): { ok: boolean; output?: unknown; error?: string } {
  const config = node.config as TransformConfig;
  const mode = (config.mode ?? "pick") as TransformMode;

  if (mode === "pick") {
    return { ok: true, output: getByPath(input, String(config.pickPath ?? "")) };
  }

  if (mode === "merge") {
    const rawMerge = String(config.mergeJson ?? "{}");
    let mergeValue: unknown = {};
    try {
      mergeValue = JSON.parse(rawMerge);
    } catch (error) {
      return { ok: false, error: `${tp("merge JSON 형식 오류")}: ${String(error)}` };
    }

    if (input && typeof input === "object" && !Array.isArray(input) && mergeValue && typeof mergeValue === "object") {
      return {
        ok: true,
        output: {
          ...(input as Record<string, unknown>),
          ...(mergeValue as Record<string, unknown>),
        },
      };
    }

    return {
      ok: true,
      output: {
        input,
        merge: mergeValue,
      },
    };
  }

  return {
    ok: true,
    output: {
      text: replaceInputPlaceholder(String(config.template ?? "{{input}}"), stringifyInput(input)),
    },
  };
}

export function executeGateNode(options: {
  node: GraphNode;
  input: unknown;
  skipSet: Set<string>;
  graph: GraphData;
  simpleWorkflowUi: boolean;
  addNodeLog: (nodeId: string, message: string) => void;
  validateSimpleSchema: (schema: unknown, data: unknown) => string[];
}): { ok: boolean; output?: unknown; error?: string; message?: string } {
  const { node, input, skipSet, graph, simpleWorkflowUi, addNodeLog, validateSimpleSchema } = options;
  const config = node.config as GateConfig;
  let schemaFallbackNote = "";
  let decisionFallbackNote = "";
  const schemaRaw = String(config.schemaJson ?? "").trim();
  if (schemaRaw) {
    let parsedSchema: unknown;
    try {
      parsedSchema = JSON.parse(schemaRaw);
    } catch (error) {
      return { ok: false, error: `${tp("스키마 JSON 형식 오류")}: ${String(error)}` };
    }
    const schemaErrors = validateSimpleSchema(parsedSchema, input);
    if (schemaErrors.length > 0) {
      if (simpleWorkflowUi) {
        schemaFallbackNote = `${tp("스키마 완화 적용")} (${schemaErrors.join("; ")})`;
        addNodeLog(node.id, `[분기] ${schemaFallbackNote}`);
      } else {
        return { ok: false, error: `${tp("스키마 검증 실패")}: ${schemaErrors.join("; ")}` };
      }
    }
  }

  const decisionPath = String(config.decisionPath ?? "DECISION");
  const decisionRaw =
    getByPath(input, decisionPath) ??
    (decisionPath === "DECISION" ? getByPath(input, "decision") : undefined) ??
    (decisionPath === "decision" ? getByPath(input, "DECISION") : undefined);
  let decision = String(decisionRaw ?? "").toUpperCase();
  if (decision !== "PASS" && decision !== "REJECT") {
    const text = stringifyInput(input).toUpperCase();
    const jsonMatch = text.match(/"DECISION"\s*:\s*"(PASS|REJECT)"/);
    if (jsonMatch?.[1]) {
      decision = jsonMatch[1];
      decisionFallbackNote = `${tp("JSON에서 DECISION")}=${decision} ${tp("추론")}`;
    } else if (/\bREJECT\b/.test(text)) {
      decision = "REJECT";
      decisionFallbackNote = tp("본문 키워드에서 REJECT 추론");
    } else if (/\bPASS\b/.test(text)) {
      decision = "PASS";
      decisionFallbackNote = tp("본문 키워드에서 PASS 추론");
    } else if (simpleWorkflowUi) {
      decision = "PASS";
      decisionFallbackNote = tp("DECISION 누락으로 PASS 기본값 적용");
    }
    if (decisionFallbackNote) {
      addNodeLog(node.id, `[분기] ${decisionFallbackNote}`);
    }
  }

  if (decision !== "PASS" && decision !== "REJECT") {
    return { ok: false, error: `${tp("분기 값은 PASS 또는 REJECT 여야 합니다. 입력값")}=${String(decisionRaw)}` };
  }

  const children = graph.edges
    .filter((edge) => edge.from.nodeId === node.id)
    .map((edge) => edge.to.nodeId)
    .filter((value, index, arr) => arr.indexOf(value) === index);
  const allowed = new Set<string>();
  const target =
    decision === "PASS"
      ? String(config.passNodeId ?? "") || children[0] || ""
      : String(config.rejectNodeId ?? "") || children[1] || "";
  if (target) {
    allowed.add(target);
  }
  for (const child of children) {
    if (!allowed.has(child)) {
      skipSet.add(child);
    }
  }

  return {
    ok: true,
    output: {
      decision,
      fallback: {
        schema: schemaFallbackNote || undefined,
        decision: decisionFallbackNote || undefined,
      },
    },
    message: `${tp("분기 결과")}=${decision}, ${tp("실행 대상")}=${Array.from(allowed).join(",") || tp("없음")}${
      schemaFallbackNote || decisionFallbackNote ? ` (${tp("내부 폴백 적용")})` : ""
    }`,
  };
}
