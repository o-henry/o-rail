export type ShellSplitDirection = "left" | "right" | "top" | "bottom";
export type ShellSplitOrientation = "horizontal" | "vertical";

export type ShellTerminalLayoutNode =
  | {
      kind: "leaf";
      paneId: string;
    }
  | {
      kind: "split";
      id: string;
      orientation: ShellSplitOrientation;
      ratio: number;
      first: ShellTerminalLayoutNode;
      second: ShellTerminalLayoutNode;
    };

export function createShellTerminalLeaf(paneId: string): ShellTerminalLayoutNode {
  return {
    kind: "leaf",
    paneId: String(paneId ?? "").trim(),
  };
}

export function collectShellTerminalPaneIds(node: ShellTerminalLayoutNode | null): string[] {
  if (!node) {
    return [];
  }
  if (node.kind === "leaf") {
    return node.paneId ? [node.paneId] : [];
  }
  return [...collectShellTerminalPaneIds(node.first), ...collectShellTerminalPaneIds(node.second)];
}

export function defaultShellAddDirection(paneCount: number): ShellSplitDirection {
  return paneCount <= 1 ? "right" : "bottom";
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(0.8, Math.max(0.2, value));
}

function splitOrientationFor(direction: ShellSplitDirection): ShellSplitOrientation {
  return direction === "left" || direction === "right" ? "horizontal" : "vertical";
}

export function splitShellTerminalLayout(params: {
  node: ShellTerminalLayoutNode;
  targetPaneId: string;
  newPaneId: string;
  direction: ShellSplitDirection;
  splitId: string;
}): ShellTerminalLayoutNode {
  const targetPaneId = String(params.targetPaneId ?? "").trim();
  const newPaneId = String(params.newPaneId ?? "").trim();
  const splitId = String(params.splitId ?? "").trim();
  if (!targetPaneId || !newPaneId || !splitId) {
    return params.node;
  }

  if (params.node.kind === "leaf") {
    if (params.node.paneId !== targetPaneId) {
      return params.node;
    }
    const currentLeaf = createShellTerminalLeaf(params.node.paneId);
    const newLeaf = createShellTerminalLeaf(newPaneId);
    const direction = params.direction;
    return {
      kind: "split",
      id: splitId,
      orientation: splitOrientationFor(direction),
      ratio: 0.5,
      first: direction === "left" || direction === "top" ? newLeaf : currentLeaf,
      second: direction === "left" || direction === "top" ? currentLeaf : newLeaf,
    };
  }

  return {
    ...params.node,
    first: splitShellTerminalLayout({
      ...params,
      node: params.node.first,
    }),
    second: splitShellTerminalLayout({
      ...params,
      node: params.node.second,
    }),
  };
}

export function updateShellTerminalSplitRatio(
  node: ShellTerminalLayoutNode | null,
  splitId: string,
  ratio: number,
): ShellTerminalLayoutNode | null {
  if (!node) {
    return null;
  }
  if (node.kind === "leaf") {
    return node;
  }
  if (node.id === splitId) {
    return {
      ...node,
      ratio: clampRatio(ratio),
    };
  }
  return {
    ...node,
    first: updateShellTerminalSplitRatio(node.first, splitId, ratio) ?? node.first,
    second: updateShellTerminalSplitRatio(node.second, splitId, ratio) ?? node.second,
  };
}

export function removePaneFromShellTerminalLayout(
  node: ShellTerminalLayoutNode | null,
  paneId: string,
): ShellTerminalLayoutNode | null {
  if (!node) {
    return null;
  }
  const normalizedPaneId = String(paneId ?? "").trim();
  if (!normalizedPaneId) {
    return node;
  }
  if (node.kind === "leaf") {
    return node.paneId === normalizedPaneId ? null : node;
  }
  const nextFirst = removePaneFromShellTerminalLayout(node.first, normalizedPaneId);
  const nextSecond = removePaneFromShellTerminalLayout(node.second, normalizedPaneId);
  if (!nextFirst && !nextSecond) {
    return null;
  }
  if (!nextFirst) {
    return nextSecond;
  }
  if (!nextSecond) {
    return nextFirst;
  }
  return {
    ...node,
    first: nextFirst,
    second: nextSecond,
  };
}
