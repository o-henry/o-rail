import type { GraphData, GraphNode, NodeAnchorSide } from "../types";
import {
  AUTO_LAYOUT_COLUMN_GAP,
  AUTO_LAYOUT_ROW_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
} from "./shared";

type LayoutDirection = "up" | "right" | "down" | "left";

type EdgeConnectionLayoutHint = {
  fromNodeId: string;
  toNodeId: string;
  fromSide?: NodeAnchorSide;
  toSide?: NodeAnchorSide;
};

const CLUSTER_SHIFT_STEP = 48;
const MAX_CLUSTER_SHIFT_STEPS = 80;
const NODE_COLLISION_PADDING = 12;
const ROLE_INTERNAL_RESEARCH_OFFSET_X = 620;
const ROLE_INTERNAL_PIPELINE_OFFSET_X = 210;
const ROLE_INTERNAL_RESEARCH_ROW_GAP = 150;
const ROLE_INTERNAL_OTHER_ROW_GAP = 150;

function cloneNodePosition(node: GraphNode, x: number, y: number): GraphNode {
  return {
    ...node,
    position: {
      x: Math.round(x),
      y: Math.round(y),
    },
  };
}

function collectOutgoingNodeIds(graph: GraphData): Map<string, string[]> {
  const outgoing = new Map<string, string[]>();
  for (const node of graph.nodes) {
    outgoing.set(node.id, []);
  }
  for (const edge of graph.edges) {
    const bucket = outgoing.get(edge.from.nodeId);
    if (!bucket) {
      continue;
    }
    bucket.push(edge.to.nodeId);
  }
  return outgoing;
}

function collectDescendantNodeIds(
  graph: GraphData,
  startNodeId: string,
): Set<string> {
  const outgoing = collectOutgoingNodeIds(graph);
  const visited = new Set<string>();
  const queue = [startNodeId];
  let cursor = 0;
  while (cursor < queue.length) {
    const currentNodeId = queue[cursor];
    cursor += 1;
    if (visited.has(currentNodeId)) {
      continue;
    }
    visited.add(currentNodeId);
    const nextNodeIds = outgoing.get(currentNodeId) ?? [];
    for (const nextNodeId of nextNodeIds) {
      if (!visited.has(nextNodeId)) {
        queue.push(nextNodeId);
      }
    }
  }
  return visited;
}

function resolveLayoutDirection(params: {
  fromNode: GraphNode;
  toNode: GraphNode;
  fromSide?: NodeAnchorSide;
  toSide?: NodeAnchorSide;
}): LayoutDirection {
  if (params.fromSide) {
    if (params.fromSide === "top") {
      return "up";
    }
    if (params.fromSide === "bottom") {
      return "down";
    }
    if (params.fromSide === "left") {
      return "left";
    }
    return "right";
  }

  if (params.toSide) {
    if (params.toSide === "top") {
      return "down";
    }
    if (params.toSide === "bottom") {
      return "up";
    }
    if (params.toSide === "left") {
      return "right";
    }
    return "left";
  }

  const dx = params.toNode.position.x - params.fromNode.position.x;
  const dy = params.toNode.position.y - params.fromNode.position.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx < 0 ? "left" : "right";
  }
  return dy < 0 ? "up" : "down";
}

function resolveDirectionalStep(direction: LayoutDirection): { x: number; y: number } {
  if (direction === "up") {
    return { x: 0, y: -CLUSTER_SHIFT_STEP };
  }
  if (direction === "down") {
    return { x: 0, y: CLUSTER_SHIFT_STEP };
  }
  if (direction === "left") {
    return { x: -CLUSTER_SHIFT_STEP, y: 0 };
  }
  return { x: CLUSTER_SHIFT_STEP, y: 0 };
}

function resolveDesiredConnectedNodePosition(
  sourceNode: GraphNode,
  direction: LayoutDirection,
): { x: number; y: number } {
  if (direction === "up") {
    return {
      x: sourceNode.position.x,
      y: sourceNode.position.y - AUTO_LAYOUT_ROW_GAP,
    };
  }
  if (direction === "down") {
    return {
      x: sourceNode.position.x,
      y: sourceNode.position.y + AUTO_LAYOUT_ROW_GAP,
    };
  }
  if (direction === "left") {
    return {
      x: sourceNode.position.x - AUTO_LAYOUT_COLUMN_GAP,
      y: sourceNode.position.y,
    };
  }
  return {
    x: sourceNode.position.x + AUTO_LAYOUT_COLUMN_GAP,
    y: sourceNode.position.y,
  };
}

function nodesOverlap(a: GraphNode, b: GraphNode): boolean {
  return (
    a.position.x < b.position.x + NODE_WIDTH + NODE_COLLISION_PADDING &&
    a.position.x + NODE_WIDTH + NODE_COLLISION_PADDING > b.position.x &&
    a.position.y < b.position.y + NODE_HEIGHT + NODE_COLLISION_PADDING &&
    a.position.y + NODE_HEIGHT + NODE_COLLISION_PADDING > b.position.y
  );
}

function resolveClusterShift(params: {
  nodes: GraphNode[];
  movableNodeIds: Set<string>;
  staticNodeIds: Set<string>;
  direction: LayoutDirection;
}): { x: number; y: number } {
  const nodeById = new Map(params.nodes.map((node) => [node.id, node] as const));
  const movableNodes = [...params.movableNodeIds]
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is GraphNode => Boolean(node));
  const staticNodes = [...params.staticNodeIds]
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is GraphNode => Boolean(node));
  if (movableNodes.length === 0 || staticNodes.length === 0) {
    return { x: 0, y: 0 };
  }

  const step = resolveDirectionalStep(params.direction);
  let shiftX = 0;
  let shiftY = 0;
  let attempts = 0;

  while (attempts < MAX_CLUSTER_SHIFT_STEPS) {
    const collides = movableNodes.some((node) => {
      const shiftedNode = shiftX === 0 && shiftY === 0
        ? node
        : cloneNodePosition(node, node.position.x + shiftX, node.position.y + shiftY);
      return staticNodes.some((staticNode) => nodesOverlap(shiftedNode, staticNode));
    });
    if (!collides) {
      return { x: shiftX, y: shiftY };
    }
    shiftX += step.x;
    shiftY += step.y;
    attempts += 1;
  }

  return { x: shiftX, y: shiftY };
}

export function arrangeGraphAfterEdgeConnect(
  input: GraphData,
  hint: EdgeConnectionLayoutHint,
): GraphData {
  const fromNode = input.nodes.find((node) => node.id === hint.fromNodeId);
  const toNode = input.nodes.find((node) => node.id === hint.toNodeId);
  if (!fromNode || !toNode) {
    return input;
  }

  const direction = resolveLayoutDirection({
    fromNode,
    toNode,
    fromSide: hint.fromSide,
    toSide: hint.toSide,
  });
  let movableNodeIds = collectDescendantNodeIds(input, hint.toNodeId);
  if (movableNodeIds.has(hint.fromNodeId)) {
    movableNodeIds = new Set([hint.toNodeId]);
  }

  const targetPosition = resolveDesiredConnectedNodePosition(fromNode, direction);
  const deltaX = targetPosition.x - toNode.position.x;
  const deltaY = targetPosition.y - toNode.position.y;
  if (deltaX === 0 && deltaY === 0) {
    return input;
  }

  const shiftedNodes = input.nodes.map((node) => {
    if (!movableNodeIds.has(node.id)) {
      return node;
    }
    return cloneNodePosition(node, node.position.x + deltaX, node.position.y + deltaY);
  });
  const staticNodeIds = new Set(
    input.nodes
      .filter((node) => !movableNodeIds.has(node.id))
      .map((node) => node.id),
  );
  const clusterShift = resolveClusterShift({
    nodes: shiftedNodes,
    movableNodeIds,
    staticNodeIds,
    direction,
  });
  const nextNodes = shiftedNodes.map((node) => {
    if (!movableNodeIds.has(node.id)) {
      return node;
    }
    return cloneNodePosition(node, node.position.x + clusterShift.x, node.position.y + clusterShift.y);
  });

  const hasChanged = nextNodes.some((node, index) => {
    const before = input.nodes[index];
    return before.position.x !== node.position.x || before.position.y !== node.position.y;
  });
  if (!hasChanged) {
    return input;
  }

  return {
    ...input,
    nodes: nextNodes,
  };
}

export function arrangeExpandedRoleInternalNodes(
  input: GraphData,
  parentNodeId: string,
  visibleNodeIds?: Iterable<string>,
): GraphData {
  const parentNode = input.nodes.find((node) => node.id === parentNodeId);
  if (!parentNode) {
    return input;
  }

  const internalNodes = input.nodes.filter((node) => {
    const config = node.config as Record<string, unknown>;
    return String(config.internalParentNodeId ?? "").trim() === parentNodeId;
  });
  if (internalNodes.length === 0) {
    return input;
  }

  const researchNodes = internalNodes
    .filter((node) => String((node.config as Record<string, unknown>).internalNodeKind ?? "").trim() === "research")
    .sort((a, b) => a.id.localeCompare(b.id));
  const synthesisNodes = internalNodes
    .filter((node) => String((node.config as Record<string, unknown>).internalNodeKind ?? "").trim() === "synthesis")
    .sort((a, b) => a.id.localeCompare(b.id));
  const verificationNodes = internalNodes
    .filter((node) => String((node.config as Record<string, unknown>).internalNodeKind ?? "").trim() === "verification")
    .sort((a, b) => a.id.localeCompare(b.id));
  const assignedNodeIds = new Set([
    ...researchNodes.map((node) => node.id),
    ...synthesisNodes.map((node) => node.id),
    ...verificationNodes.map((node) => node.id),
  ]);
  const otherNodes = internalNodes
    .filter((node) => !assignedNodeIds.has(node.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  const desiredPositionById = new Map<string, { x: number; y: number }>();
  const researchMidpoint = (researchNodes.length - 1) / 2;
  researchNodes.forEach((node, index) => {
    desiredPositionById.set(node.id, {
      x: parentNode.position.x - ROLE_INTERNAL_RESEARCH_OFFSET_X,
      y: parentNode.position.y + (index - researchMidpoint) * ROLE_INTERNAL_RESEARCH_ROW_GAP,
    });
  });
  synthesisNodes.forEach((node, index) => {
    desiredPositionById.set(node.id, {
      x: parentNode.position.x - ROLE_INTERNAL_PIPELINE_OFFSET_X,
      y: parentNode.position.y - 72 + index * ROLE_INTERNAL_OTHER_ROW_GAP,
    });
  });
  verificationNodes.forEach((node, index) => {
    desiredPositionById.set(node.id, {
      x: parentNode.position.x - ROLE_INTERNAL_PIPELINE_OFFSET_X,
      y: parentNode.position.y + 76 + index * ROLE_INTERNAL_OTHER_ROW_GAP,
    });
  });
  otherNodes.forEach((node, index) => {
    desiredPositionById.set(node.id, {
      x: parentNode.position.x - ROLE_INTERNAL_PIPELINE_OFFSET_X,
      y: parentNode.position.y + 220 + index * ROLE_INTERNAL_OTHER_ROW_GAP,
    });
  });

  const internalNodeIdSet = new Set(internalNodes.map((node) => node.id));
  const candidateNodes = input.nodes.map((node) => {
    const desired = desiredPositionById.get(node.id);
    if (!desired) {
      return node;
    }
    return cloneNodePosition(node, desired.x, desired.y);
  });
  const visibleNodeIdSet = new Set(visibleNodeIds ?? input.nodes.map((node) => node.id));
  const staticNodeIds = new Set(
    [...visibleNodeIdSet].filter((nodeId) => !internalNodeIdSet.has(nodeId)),
  );
  const clusterShift = resolveClusterShift({
    nodes: candidateNodes,
    movableNodeIds: internalNodeIdSet,
    staticNodeIds,
    direction: "left",
  });
  const shiftedNodes = candidateNodes.map((node) => {
    if (!internalNodeIdSet.has(node.id)) {
      return node;
    }
    return cloneNodePosition(node, node.position.x + clusterShift.x, node.position.y + clusterShift.y);
  });
  const leftOverflow = shiftedNodes
    .filter((node) => internalNodeIdSet.has(node.id))
    .reduce((minX, node) => Math.min(minX, node.position.x), Number.POSITIVE_INFINITY);
  const leftBoundShift = Number.isFinite(leftOverflow) && leftOverflow < 0 ? -leftOverflow : 0;
  const nextNodes = leftBoundShift > 0
    ? shiftedNodes.map((node) => {
        if (!internalNodeIdSet.has(node.id)) {
          return node;
        }
        return cloneNodePosition(node, node.position.x + leftBoundShift, node.position.y);
      })
    : shiftedNodes;

  const hasChanged = nextNodes.some((node, index) => {
    const before = input.nodes[index];
    return before.position.x !== node.position.x || before.position.y !== node.position.y;
  });
  if (!hasChanged) {
    return input;
  }

  return {
    ...input,
    nodes: nextNodes,
  };
}
