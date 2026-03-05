import type { GraphEdge, GraphNode, NodeAnchorSide } from "../types";
import {
  alignAutoEdgePoints,
  buildRoundedEdgePath,
  edgeMidPoint,
  getAutoConnectionSides,
  getNodeAnchorPoint,
} from "./edges";
import type { LogicalPoint, NodeVisualSize } from "./shared";

export type CanvasEdgeEntry = {
  edge: GraphEdge;
  edgeKey: string;
  readOnly: boolean;
};

export type CanvasEdgeLine = {
  key: string;
  edgeKey: string;
  path: string;
  startPoint: LogicalPoint;
  endPoint: LogicalPoint;
  controlPoint: LogicalPoint;
  hasManualControl: boolean;
  readOnly: boolean;
};

type BuildCanvasEdgeLinesParams = {
  entries: CanvasEdgeEntry[];
  nodeMap: Map<string, GraphNode>;
  getNodeVisualSize: (nodeId: string) => NodeVisualSize;
  preferCurvedPaths?: boolean;
};

const SIDE_EDGE_PADDING = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildOrthogonalPolylinePath(points: LogicalPoint[]): string {
  if (points.length === 0) {
    return "";
  }
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    path += ` L ${points[i].x} ${points[i].y}`;
  }
  return path;
}

function compressCollinear(points: LogicalPoint[]): LogicalPoint[] {
  if (points.length <= 2) {
    return points;
  }
  const next: LogicalPoint[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    if (next.length < 2) {
      next.push(point);
      continue;
    }
    const prev = next[next.length - 1];
    const head = next[next.length - 2];
    const collinearX = Math.abs(head.x - prev.x) <= 0.1 && Math.abs(prev.x - point.x) <= 0.1;
    const collinearY = Math.abs(head.y - prev.y) <= 0.1 && Math.abs(prev.y - point.y) <= 0.1;
    if (collinearX || collinearY) {
      next[next.length - 1] = point;
    } else {
      next.push(point);
    }
  }
  return next;
}

export function buildCanvasEdgeLines(params: BuildCanvasEdgeLinesParams): CanvasEdgeLine[] {
  const { entries, nodeMap, getNodeVisualSize, preferCurvedPaths = false } = params;

  const groupedFrom = new Map<string, CanvasEdgeEntry[]>();
  const groupedTo = new Map<string, CanvasEdgeEntry[]>();
  for (const entry of entries) {
    const fromId = entry.edge.from.nodeId;
    const toId = entry.edge.to.nodeId;
    const fromRows = groupedFrom.get(fromId) ?? [];
    const toRows = groupedTo.get(toId) ?? [];
    fromRows.push(entry);
    toRows.push(entry);
    groupedFrom.set(fromId, fromRows);
    groupedTo.set(toId, toRows);
  }

  const bundledFromSideByNodeId = new Map<string, NodeAnchorSide>();
  groupedFrom.forEach((groupedEntries, fromId) => {
    if (groupedEntries.length < 2) {
      return;
    }
    const fromNode = nodeMap.get(fromId);
    if (!fromNode) {
      return;
    }
    const fromSize = getNodeVisualSize(fromNode.id);
    const fromCenterX = fromNode.position.x + fromSize.width / 2;
    const fromCenterY = fromNode.position.y + fromSize.height / 2;
    let sumDx = 0;
    let sumDy = 0;
    let targetCount = 0;
    for (const entry of groupedEntries) {
      const toNode = nodeMap.get(entry.edge.to.nodeId);
      if (!toNode) {
        continue;
      }
      const toSize = getNodeVisualSize(toNode.id);
      const toCenterX = toNode.position.x + toSize.width / 2;
      const toCenterY = toNode.position.y + toSize.height / 2;
      sumDx += toCenterX - fromCenterX;
      sumDy += toCenterY - fromCenterY;
      targetCount += 1;
    }
    if (targetCount === 0) {
      return;
    }
    const avgDx = sumDx / targetCount;
    const avgDy = sumDy / targetCount;
    const side: NodeAnchorSide =
      Math.abs(avgDx) >= Math.abs(avgDy) ? (avgDx >= 0 ? "right" : "left") : avgDy >= 0 ? "bottom" : "top";
    bundledFromSideByNodeId.set(fromId, side);
  });

  const bundledToSideByNodeId = new Map<string, NodeAnchorSide>();
  groupedTo.forEach((groupedEntries, toId) => {
    if (groupedEntries.length < 2) {
      return;
    }
    const toNode = nodeMap.get(toId);
    if (!toNode) {
      return;
    }
    const toSize = getNodeVisualSize(toNode.id);
    const toCenterX = toNode.position.x + toSize.width / 2;
    const toCenterY = toNode.position.y + toSize.height / 2;
    let sumDx = 0;
    let sumDy = 0;
    let sourceCount = 0;
    for (const entry of groupedEntries) {
      const fromNode = nodeMap.get(entry.edge.from.nodeId);
      if (!fromNode) {
        continue;
      }
      const fromSize = getNodeVisualSize(fromNode.id);
      const fromCenterX = fromNode.position.x + fromSize.width / 2;
      const fromCenterY = fromNode.position.y + fromSize.height / 2;
      sumDx += toCenterX - fromCenterX;
      sumDy += toCenterY - fromCenterY;
      sourceCount += 1;
    }
    if (sourceCount === 0) {
      return;
    }
    const avgDx = sumDx / sourceCount;
    const avgDy = sumDy / sourceCount;
    const side: NodeAnchorSide =
      Math.abs(avgDx) >= Math.abs(avgDy) ? (avgDx >= 0 ? "left" : "right") : avgDy >= 0 ? "top" : "bottom";
    bundledToSideByNodeId.set(toId, side);
  });

  const snapPoint = (point: LogicalPoint): LogicalPoint => ({
    x: Math.round(point.x),
    y: Math.round(point.y),
  });

  const bundledFromAnchorByNodeId = new Map<string, LogicalPoint>();
  bundledFromSideByNodeId.forEach((side, nodeId) => {
    const node = nodeMap.get(nodeId);
    if (!node) {
      return;
    }
    const size = getNodeVisualSize(node.id);
    bundledFromAnchorByNodeId.set(nodeId, snapPoint(getNodeAnchorPoint(node, side, size)));
  });

  const bundledToAnchorByNodeId = new Map<string, LogicalPoint>();
  bundledToSideByNodeId.forEach((side, nodeId) => {
    const node = nodeMap.get(nodeId);
    if (!node) {
      return;
    }
    const size = getNodeVisualSize(node.id);
    bundledToAnchorByNodeId.set(nodeId, snapPoint(getNodeAnchorPoint(node, side, size)));
  });

  return entries
    .map((entry, index) => {
      const edge = entry.edge;
      const fromNode = nodeMap.get(edge.from.nodeId);
      const toNode = nodeMap.get(edge.to.nodeId);
      if (!fromNode || !toNode) {
        return null;
      }

      const fromSize = getNodeVisualSize(fromNode.id);
      const toSize = getNodeVisualSize(toNode.id);
      const auto = getAutoConnectionSides(fromNode, toNode, fromSize, toSize);
      const hasManualControl = false;
      const hasExplicitSides = Boolean(edge.from.side || edge.to.side);
      const bundledFromSide = bundledFromSideByNodeId.get(fromNode.id);
      const bundledToSide = bundledToSideByNodeId.get(toNode.id);
      const resolvedFromSide = edge.from.side ?? bundledFromSide ?? auto.fromSide;
      const resolvedToSide = edge.to.side ?? bundledToSide ?? auto.toSide;
      let fromPoint = bundledFromSide
        ? (bundledFromAnchorByNodeId.get(fromNode.id) ??
          snapPoint(getNodeAnchorPoint(fromNode, resolvedFromSide, fromSize)))
        : snapPoint(getNodeAnchorPoint(fromNode, resolvedFromSide, fromSize));
      let toPoint = bundledToSide
        ? (bundledToAnchorByNodeId.get(toNode.id) ?? snapPoint(getNodeAnchorPoint(toNode, resolvedToSide, toSize)))
        : snapPoint(getNodeAnchorPoint(toNode, resolvedToSide, toSize));

      const routeFromSide = bundledFromSide ?? resolvedFromSide;
      const routeToSide = bundledToSide ?? resolvedToSide;
      const fromHorizontal = routeFromSide === "left" || routeFromSide === "right";
      const toHorizontal = routeToSide === "left" || routeToSide === "right";
      const fromVertical = !fromHorizontal;
      const toVertical = !toHorizontal;

      if (!hasManualControl && !hasExplicitSides && !bundledFromSide && !bundledToSide) {
        // Single edge: force source-lane alignment to avoid diagonal endpoint drift.
        if (fromHorizontal && toHorizontal) {
          const toMinY = toNode.position.y + SIDE_EDGE_PADDING;
          const toMaxY = toNode.position.y + toSize.height - SIDE_EDGE_PADDING;
          const laneY = clamp(Math.round(fromPoint.y), toMinY, toMaxY);
          fromPoint = { ...fromPoint, y: laneY };
          toPoint = { ...toPoint, y: laneY };
        } else if (fromVertical && toVertical) {
          const toMinX = toNode.position.x + SIDE_EDGE_PADDING;
          const toMaxX = toNode.position.x + toSize.width - SIDE_EDGE_PADDING;
          const laneX = clamp(Math.round(fromPoint.x), toMinX, toMaxX);
          fromPoint = { ...fromPoint, x: laneX };
          toPoint = { ...toPoint, x: laneX };
        }

        const aligned = alignAutoEdgePoints(
          fromNode,
          toNode,
          fromPoint,
          toPoint,
          resolvedFromSide,
          resolvedToSide,
          fromSize,
          toSize,
        );
        fromPoint = snapPoint(aligned.fromPoint);
        toPoint = snapPoint(aligned.toPoint);
      }

      const edgeKey = entry.edgeKey;
      const defaultControl = edgeMidPoint(fromPoint, toPoint);
      const control = defaultControl;
      const hasBundledRouting = !hasManualControl && Boolean(bundledFromSide || bundledToSide);

      let path: string;
      if (preferCurvedPaths) {
        path = buildRoundedEdgePath(
          fromPoint.x,
          fromPoint.y,
          toPoint.x,
          toPoint.y,
          true,
          routeFromSide,
          routeToSide,
          0,
        );
      } else if (hasBundledRouting && toHorizontal) {
        const fromCenterX = fromNode.position.x + fromSize.width / 2;
        const virtualFromSide: NodeAnchorSide = toPoint.x >= fromCenterX ? "right" : "left";
        const virtualFromPoint = fromHorizontal
          ? fromPoint
          : snapPoint(getNodeAnchorPoint(fromNode, virtualFromSide, fromSize));
        fromPoint = virtualFromPoint;
        const gap = Math.max(24, Math.round(Math.abs(toPoint.x - virtualFromPoint.x) * 0.38));
        const laneX = bundledFromSide
          ? (routeFromSide === "right" ? virtualFromPoint.x + gap : virtualFromPoint.x - gap)
          : bundledToSide
            ? (routeToSide === "left" ? toPoint.x - gap : toPoint.x + gap)
            : Math.round((virtualFromPoint.x + toPoint.x) / 2);
        const points = compressCollinear([
          virtualFromPoint,
          { x: laneX, y: virtualFromPoint.y },
          { x: laneX, y: toPoint.y },
          toPoint,
        ]);
        path = buildOrthogonalPolylinePath(points);
      } else if (hasBundledRouting && toVertical) {
        const fromCenterY = fromNode.position.y + fromSize.height / 2;
        const virtualFromSide: NodeAnchorSide = toPoint.y >= fromCenterY ? "bottom" : "top";
        const virtualFromPoint = fromVertical
          ? fromPoint
          : snapPoint(getNodeAnchorPoint(fromNode, virtualFromSide, fromSize));
        fromPoint = virtualFromPoint;
        const gap = Math.max(24, Math.round(Math.abs(toPoint.y - virtualFromPoint.y) * 0.38));
        const laneY = bundledFromSide
          ? (routeFromSide === "bottom" ? virtualFromPoint.y + gap : virtualFromPoint.y - gap)
          : bundledToSide
            ? (routeToSide === "top" ? toPoint.y - gap : toPoint.y + gap)
            : Math.round((virtualFromPoint.y + toPoint.y) / 2);
        const points = compressCollinear([
          virtualFromPoint,
          { x: virtualFromPoint.x, y: laneY },
          { x: toPoint.x, y: laneY },
          toPoint,
        ]);
        path = buildOrthogonalPolylinePath(points);
      } else {
        const isOppositeHorizontal =
          (routeFromSide === "left" && routeToSide === "right") ||
          (routeFromSide === "right" && routeToSide === "left");
        const isOppositeVertical =
          (routeFromSide === "top" && routeToSide === "bottom") ||
          (routeFromSide === "bottom" && routeToSide === "top");
        const shouldUseSimpleSingleRoute =
          !hasManualControl &&
          !hasBundledRouting &&
          (isOppositeHorizontal || isOppositeVertical);

        if (shouldUseSimpleSingleRoute) {
          const points = isOppositeHorizontal
            ? compressCollinear([
                fromPoint,
                { x: Math.round((fromPoint.x + toPoint.x) / 2), y: fromPoint.y },
                { x: Math.round((fromPoint.x + toPoint.x) / 2), y: toPoint.y },
                toPoint,
              ])
            : compressCollinear([
                fromPoint,
                { x: fromPoint.x, y: Math.round((fromPoint.y + toPoint.y) / 2) },
                { x: toPoint.x, y: Math.round((fromPoint.y + toPoint.y) / 2) },
                toPoint,
              ]);
          path = buildOrthogonalPolylinePath(points);
        } else {
          path = buildRoundedEdgePath(
            fromPoint.x,
            fromPoint.y,
            toPoint.x,
            toPoint.y,
            true,
            resolvedFromSide,
            resolvedToSide,
            0,
          );
        }
      }

      return {
        key: `${edgeKey}-${index}`,
        edgeKey,
        startPoint: fromPoint,
        endPoint: toPoint,
        controlPoint: control,
        hasManualControl,
        readOnly: entry.readOnly,
        path,
      } satisfies CanvasEdgeLine;
    })
    .filter(Boolean) as CanvasEdgeLine[];
}
