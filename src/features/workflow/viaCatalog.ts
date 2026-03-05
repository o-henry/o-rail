export type ViaNodeType =
  | "trigger.manual"
  | "source.news"
  | "source.sns"
  | "source.community"
  | "source.dev"
  | "source.market"
  | "transform.normalize"
  | "transform.verify"
  | "transform.rank"
  | "agent.codex"
  | "export.rag"
  | "source.x"
  | "source.threads"
  | "source.reddit"
  | "source.hn";

export type ViaNodeOption = {
  value: ViaNodeType;
  label: string;
  iconText: string;
  group: "trigger" | "source" | "transform" | "agent" | "export";
};

export const VIA_NODE_OPTIONS: ViaNodeOption[] = [
  { value: "trigger.manual", label: "수동 시작", iconText: "TRG", group: "trigger" },
  { value: "source.news", label: "뉴스 수집 (미/일/중/한)", iconText: "NEWS", group: "source" },
  { value: "source.sns", label: "SNS 수집 (X+Threads)", iconText: "SNS", group: "source" },
  { value: "source.community", label: "커뮤니티 수집 (미/일/중/한)", iconText: "COMM", group: "source" },
  { value: "source.dev", label: "개발 커뮤니티 수집", iconText: "DEV", group: "source" },
  { value: "source.market", label: "주식/시장 수집", iconText: "MKT", group: "source" },
  { value: "transform.normalize", label: "정규화", iconText: "NORM", group: "transform" },
  { value: "transform.verify", label: "검증", iconText: "VER", group: "transform" },
  { value: "transform.rank", label: "우선순위", iconText: "RANK", group: "transform" },
  { value: "agent.codex", label: "핵심 요약 생성", iconText: "AI", group: "agent" },
  { value: "export.rag", label: "문서 내보내기", iconText: "OUT", group: "export" },
];

const LEGACY_VIA_NODE_OPTIONS: ViaNodeOption[] = [
  { value: "source.x", label: "SNS 수집 (X+Threads)", iconText: "SNS", group: "source" },
  { value: "source.threads", label: "SNS 수집 (X+Threads)", iconText: "SNS", group: "source" },
  { value: "source.reddit", label: "커뮤니티 수집 (미/일/중/한)", iconText: "COMM", group: "source" },
  { value: "source.hn", label: "개발 커뮤니티 수집", iconText: "DEV", group: "source" },
];

export const VIA_NODE_LABEL_BY_TYPE: Record<ViaNodeType, string> = Object.fromEntries(
  [...VIA_NODE_OPTIONS, ...LEGACY_VIA_NODE_OPTIONS].map((row) => [row.value, row.label]),
) as Record<ViaNodeType, string>;

export const VIA_NODE_ICON_TEXT_BY_TYPE: Record<ViaNodeType, string> = Object.fromEntries(
  [...VIA_NODE_OPTIONS, ...LEGACY_VIA_NODE_OPTIONS].map((row) => [row.value, row.iconText]),
) as Record<ViaNodeType, string>;

export function isViaNodeType(value: string): value is ViaNodeType {
  return [...VIA_NODE_OPTIONS, ...LEGACY_VIA_NODE_OPTIONS].some((row) => row.value === value);
}

export function viaNodeLabel(value: string): string {
  if (isViaNodeType(value)) {
    return VIA_NODE_LABEL_BY_TYPE[value];
  }
  return value || "VIA Node";
}

export function viaNodeIconText(value: string): string {
  if (isViaNodeType(value)) {
    return VIA_NODE_ICON_TEXT_BY_TYPE[value];
  }
  return "NODE";
}
