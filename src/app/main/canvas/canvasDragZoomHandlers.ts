export function createCanvasDragZoomHandlers(params: any) {
  function zoomAtClientPoint(nextZoom: number, clientX: number, clientY: number) {
    const canvas = params.graphCanvasRef.current;
    if (!canvas) {
      params.setCanvasZoom(nextZoom);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const stageOffsetX = params.graphStageInsetX;
    const stageOffsetY = params.graphStageInsetY;
    const pointerX = clientX - rect.left + canvas.scrollLeft;
    const pointerY = clientY - rect.top + canvas.scrollTop;
    const logicalX = (pointerX - stageOffsetX) / params.canvasZoom;
    const logicalY = (pointerY - stageOffsetY) / params.canvasZoom;

    params.setCanvasZoom(nextZoom);
    requestAnimationFrame(() => {
      const currentCanvas = params.graphCanvasRef.current;
      if (!currentCanvas) {
        return;
      }
      currentCanvas.scrollLeft = logicalX * nextZoom + stageOffsetX - (clientX - rect.left);
      currentCanvas.scrollTop = logicalY * nextZoom + stageOffsetY - (clientY - rect.top);
    });
  }

  function applyDragPosition(clientX: number, clientY: number) {
    if (!params.dragRef.current) {
      return;
    }
    const logicalPoint = params.clientToLogicalPoint(clientX, clientY);
    if (!logicalPoint) {
      return;
    }

    const { nodeIds, pointerStart, startPositions } = params.dragRef.current;
    if (nodeIds.length === 0) {
      return;
    }
    const dx = logicalPoint.x - pointerStart.x;
    const dy = logicalPoint.y - pointerStart.y;
    const minX = -params.nodeDragMargin;
    const minY = (24 - params.graphStageInsetY) / params.canvasZoom;
    const nodeIdSet = new Set(nodeIds);
    const dragSingleNode = nodeIds.length === 1;

    params.setGraph((prev: any) => ({
      ...prev,
      nodes: (() => {
        const stationaryNodes = prev.nodes.filter((node: any) => !nodeIdSet.has(node.id));
        return prev.nodes.map((node: any) => {
          if (!nodeIdSet.has(node.id)) {
            return node;
          }
          const start = startPositions[node.id];
          if (!start) {
            return node;
          }
          const size = params.getNodeVisualSize(node.id);
          const maxX = Math.max(minX, params.getBoundedStageWidth() - size.width + params.nodeDragMargin);
          const maxY = Math.max(minY, params.getBoundedStageHeight() - size.height + params.nodeDragMargin);
          const nextX = start.x + dx;
          const nextY = start.y + dy;
          let snappedX = params.snapToLayoutGrid(nextX, "x", params.autoLayoutDragSnapThreshold);
          let snappedY = params.snapToLayoutGrid(nextY, "y", params.autoLayoutDragSnapThreshold);
          if (dragSingleNode) {
            snappedX = params.snapToNearbyNodeAxis(
              snappedX,
              "x",
              stationaryNodes,
              params.autoLayoutNodeAxisSnapThreshold,
            );
            snappedY = params.snapToNearbyNodeAxis(
              snappedY,
              "y",
              stationaryNodes,
              params.autoLayoutNodeAxisSnapThreshold,
            );
          }
          return {
            ...node,
            position: {
              x: Math.min(maxX, Math.max(minX, snappedX)),
              y: Math.min(maxY, Math.max(minY, snappedY)),
            },
          };
        });
      })(),
    }));
  }

  function ensureDragAutoPanLoop() {
    if (params.dragAutoPanFrameRef.current != null) {
      return;
    }

    const tick = () => {
      if (!params.dragRef.current) {
        params.dragAutoPanFrameRef.current = null;
        return;
      }

      const pointer = params.dragPointerRef.current;
      const canvas = params.graphCanvasRef.current;
      if (pointer && canvas) {
        const rect = canvas.getBoundingClientRect();
        const edge = 30;
        const maxSpeed = 14;
        let dx = 0;
        let dy = 0;

        if (pointer.clientX < rect.left + edge) {
          dx = -Math.ceil(((rect.left + edge - pointer.clientX) / edge) * maxSpeed);
        } else if (pointer.clientX > rect.right - edge) {
          dx = Math.ceil(((pointer.clientX - (rect.right - edge)) / edge) * maxSpeed);
        }
        if (pointer.clientY < rect.top + edge) {
          dy = -Math.ceil(((rect.top + edge - pointer.clientY) / edge) * maxSpeed);
        } else if (pointer.clientY > rect.bottom - edge) {
          dy = Math.ceil(((pointer.clientY - (rect.bottom - edge)) / edge) * maxSpeed);
        }

        if (dx !== 0 || dy !== 0) {
          const maxLeft = Math.max(0, canvas.scrollWidth - canvas.clientWidth);
          const maxTop = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
          canvas.scrollLeft = Math.max(0, Math.min(maxLeft, canvas.scrollLeft + dx));
          canvas.scrollTop = Math.max(0, Math.min(maxTop, canvas.scrollTop + dy));
          applyDragPosition(pointer.clientX, pointer.clientY);
        }
      }

      params.dragAutoPanFrameRef.current = requestAnimationFrame(tick);
    };

    params.dragAutoPanFrameRef.current = requestAnimationFrame(tick);
  }

  function onNodeDragStart(e: any, nodeId: string) {
    if (params.panMode) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    const node = params.canvasNodes.find((item: any) => item.id === nodeId);
    if (!node) {
      return;
    }

    const canvasPoint = params.clientToLogicalPoint(e.clientX, e.clientY);
    if (!canvasPoint) {
      return;
    }

    const activeNodeIds = params.selectedNodeIds.includes(nodeId) ? params.selectedNodeIds : [nodeId];
    if (!params.selectedNodeIds.includes(nodeId)) {
      params.setNodeSelection([nodeId], nodeId);
    }
    const startPositions = Object.fromEntries(
      params.canvasNodes
        .filter((item: any) => activeNodeIds.includes(item.id))
        .map((item: any) => [item.id, { x: item.position.x, y: item.position.y }]),
    );
    if (Object.keys(startPositions).length === 0) {
      return;
    }

    params.dragStartSnapshotRef.current = params.cloneGraph(params.graph);
    params.setDraggingNodeIds(activeNodeIds);
    params.setMarqueeSelection(null);
    params.dragPointerRef.current = { clientX: e.clientX, clientY: e.clientY };
    ensureDragAutoPanLoop();
    if (!params.dragWindowMoveHandlerRef.current) {
      params.dragWindowMoveHandlerRef.current = (event: MouseEvent) => {
        if (!params.dragRef.current) {
          return;
        }
        params.dragPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
        applyDragPosition(event.clientX, event.clientY);
      };
      window.addEventListener("mousemove", params.dragWindowMoveHandlerRef.current);
    }
    if (!params.dragWindowUpHandlerRef.current) {
      params.dragWindowUpHandlerRef.current = () => {
        onCanvasMouseUp();
      };
      window.addEventListener("mouseup", params.dragWindowUpHandlerRef.current);
    }

    params.dragRef.current = {
      nodeIds: activeNodeIds,
      pointerStart: canvasPoint,
      startPositions,
    };
  }

  function onCanvasMouseMove(e: any) {
    if (params.panRef.current) {
      const canvas = params.graphCanvasRef.current;
      if (canvas) {
        canvas.scrollLeft = params.panRef.current.scrollLeft - (e.clientX - params.panRef.current.startX);
        canvas.scrollTop = params.panRef.current.scrollTop - (e.clientY - params.panRef.current.startY);
      }
      return;
    }

    if (params.isConnectingDrag && params.connectFromNodeId) {
      const point = params.clientToLogicalPoint(e.clientX, e.clientY);
      if (point) {
        params.snapConnectPreviewPoint(point);
      }
      return;
    }

    if (params.marqueeSelection) {
      const point = params.clientToLogicalPoint(e.clientX, e.clientY);
      if (point) {
        params.setMarqueeSelection((prev: any) => (prev ? { ...prev, current: point } : prev));
      }
      return;
    }

    if (!params.dragRef.current) {
      return;
    }
  }

  function onCanvasMouseUp(event?: { clientX: number; clientY: number }) {
    params.panRef.current = null;
    const edgeReconnectState = params.edgeDragRef.current;

    if (params.isConnectingDrag) {
      const pointerPoint =
        event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
          ? params.clientToLogicalPoint(event.clientX, event.clientY)
          : null;
      const dropPoint = pointerPoint ?? params.connectPreviewPoint;
      const dropTarget = dropPoint ? params.resolveConnectDropTarget(dropPoint) : null;
      if (dropTarget && params.connectFromNodeId && params.connectFromNodeId !== dropTarget.nodeId) {
        if (edgeReconnectState) {
          params.reconnectSelectedEdgeEndpoint(edgeReconnectState, dropTarget.nodeId, dropTarget.side);
        } else {
          params.onNodeConnectDrop(dropTarget.nodeId, dropTarget.side);
        }
      } else {
        params.setIsConnectingDrag(false);
        params.setConnectPreviewStartPoint(null);
        params.setConnectPreviewPoint(null);
        params.setConnectFromNodeId("");
        params.setConnectFromSide(null);
      }
    }
    params.edgeDragRef.current = null;
    params.edgeDragStartSnapshotRef.current = null;

    if (params.marqueeSelection) {
      const minX = Math.min(params.marqueeSelection.start.x, params.marqueeSelection.current.x);
      const maxX = Math.max(params.marqueeSelection.start.x, params.marqueeSelection.current.x);
      const minY = Math.min(params.marqueeSelection.start.y, params.marqueeSelection.current.y);
      const maxY = Math.max(params.marqueeSelection.start.y, params.marqueeSelection.current.y);
      const selectedByBox = params.canvasNodes
        .filter((node: any) => {
          const size = params.getNodeVisualSize(node.id);
          const nodeLeft = node.position.x;
          const nodeTop = node.position.y;
          const nodeRight = node.position.x + size.width;
          const nodeBottom = node.position.y + size.height;
          return !(nodeRight < minX || nodeLeft > maxX || nodeBottom < minY || nodeTop > maxY);
        })
        .map((node: any) => node.id);
      const nextSelected = params.marqueeSelection.append
        ? Array.from(new Set([...params.selectedNodeIds, ...selectedByBox]))
        : selectedByBox;
      params.setNodeSelection(nextSelected, nextSelected[nextSelected.length - 1]);
      params.setMarqueeSelection(null);
      params.setSelectedEdgeKey("");
    }

    params.dragPointerRef.current = null;
    if (params.dragAutoPanFrameRef.current != null) {
      cancelAnimationFrame(params.dragAutoPanFrameRef.current);
      params.dragAutoPanFrameRef.current = null;
    }
    if (params.dragWindowMoveHandlerRef.current) {
      window.removeEventListener("mousemove", params.dragWindowMoveHandlerRef.current);
      params.dragWindowMoveHandlerRef.current = null;
    }
    if (params.dragWindowUpHandlerRef.current) {
      window.removeEventListener("mouseup", params.dragWindowUpHandlerRef.current);
      params.dragWindowUpHandlerRef.current = null;
    }
    const dragSnapshot = params.dragStartSnapshotRef.current;
    if (dragSnapshot && !params.graphEquals(dragSnapshot, params.graph)) {
      params.setUndoStack((stack: any) => [...stack.slice(-79), params.cloneGraph(dragSnapshot)]);
      params.setRedoStack([]);
    }
    const dragNodeIds = params.dragRef.current?.nodeIds ?? [];
    params.dragStartSnapshotRef.current = null;
    params.dragRef.current = null;
    params.setDraggingNodeIds([]);
    if (dragNodeIds.length > 0) {
      const draggedNodeIdSet = new Set(dragNodeIds);
      const dragSingleNode = dragNodeIds.length === 1;
      params.setGraph((prev: any) => ({
        ...prev,
        nodes: (() => {
          const stationaryNodes = prev.nodes.filter((node: any) => !draggedNodeIdSet.has(node.id));
          return prev.nodes.map((node: any) => {
            if (!draggedNodeIdSet.has(node.id)) {
              return node;
            }
            const size = params.getNodeVisualSize(node.id);
            const minX = -params.nodeDragMargin;
            const minY = (24 - params.graphStageInsetY) / params.canvasZoom;
            const maxX = Math.max(minX, params.getBoundedStageWidth() - size.width + params.nodeDragMargin);
            const maxY = Math.max(minY, params.getBoundedStageHeight() - size.height + params.nodeDragMargin);
            let snappedX = params.snapToLayoutGrid(node.position.x, "x", params.autoLayoutSnapThreshold);
            let snappedY = params.snapToLayoutGrid(node.position.y, "y", params.autoLayoutSnapThreshold);
            if (dragSingleNode) {
              snappedX = params.snapToNearbyNodeAxis(
                snappedX,
                "x",
                stationaryNodes,
                params.autoLayoutNodeAxisSnapThreshold,
              );
              snappedY = params.snapToNearbyNodeAxis(
                snappedY,
                "y",
                stationaryNodes,
                params.autoLayoutNodeAxisSnapThreshold,
              );
            }
            return {
              ...node,
              position: {
                x: Math.min(maxX, Math.max(minX, snappedX)),
                y: Math.min(maxY, Math.max(minY, snappedY)),
              },
            };
          });
        })(),
      }));
    }
  }

  function onCanvasMouseDown(e: any) {
    const target = e.target as HTMLElement;
    const clickedNodeOrPorts = target.closest(".graph-node, .node-anchors");
    const clickedEdge = target.closest(".edge-path, .edge-path-hit");
    const clickedOverlay = target.closest(".canvas-overlay");
    const clickedControl = target.closest(".canvas-zoom-controls, .canvas-runbar");

    if (!clickedNodeOrPorts && !clickedEdge && !clickedOverlay) {
      if (!e.shiftKey) {
        params.setNodeSelection([]);
      }
      params.setSelectedEdgeKey("");
    }

    if (!params.panMode) {
      if (e.button !== 0 || clickedControl || clickedOverlay || clickedNodeOrPorts || clickedEdge) {
        return;
      }
      const point = params.clientToLogicalPoint(e.clientX, e.clientY);
      if (!point) {
        return;
      }
      e.preventDefault();
      params.setMarqueeSelection({
        start: point,
        current: point,
        append: e.shiftKey,
      });
      return;
    }
    const canvas = params.graphCanvasRef.current;
    if (!canvas) {
      return;
    }
    if (clickedControl || clickedEdge) {
      return;
    }
    e.preventDefault();
    params.panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: canvas.scrollLeft,
      scrollTop: canvas.scrollTop,
    };
  }

  function onCanvasWheel(e: any) {
    if (!(e.ctrlKey || e.metaKey)) {
      return;
    }
    e.preventDefault();
    const ratio = e.deltaY < 0 ? 1.08 : 0.92;
    const nextZoom = params.clampCanvasZoom(params.canvasZoom * ratio);
    if (nextZoom === params.canvasZoom) {
      return;
    }
    zoomAtClientPoint(nextZoom, e.clientX, e.clientY);
    params.scheduleZoomStatus(nextZoom);
  }

  function zoomAtCanvasCenter(nextZoom: number) {
    const canvas = params.graphCanvasRef.current;
    if (!canvas) {
      params.setCanvasZoom(nextZoom);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    zoomAtClientPoint(nextZoom, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function onCanvasZoomIn() {
    const nextZoom = params.clampCanvasZoom(params.canvasZoom * 1.08);
    if (nextZoom === params.canvasZoom) {
      return;
    }
    zoomAtCanvasCenter(nextZoom);
    params.scheduleZoomStatus(nextZoom);
  }

  function onCanvasZoomOut() {
    const nextZoom = params.clampCanvasZoom(params.canvasZoom * 0.92);
    if (nextZoom === params.canvasZoom) {
      return;
    }
    zoomAtCanvasCenter(nextZoom);
    params.scheduleZoomStatus(nextZoom);
  }

  function onCanvasKeyDown(e: any) {
    if (!(e.metaKey || e.ctrlKey)) {
      return;
    }

    const canvas = params.graphCanvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      const nextZoom = params.clampCanvasZoom(params.canvasZoom * 1.08);
      zoomAtClientPoint(nextZoom, centerX, centerY);
      params.scheduleZoomStatus(nextZoom);
      return;
    }

    if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      const nextZoom = params.clampCanvasZoom(params.canvasZoom * 0.92);
      zoomAtClientPoint(nextZoom, centerX, centerY);
      params.scheduleZoomStatus(nextZoom);
      return;
    }

    if (e.key === "0") {
      e.preventDefault();
      zoomAtClientPoint(1, centerX, centerY);
      params.scheduleZoomStatus(1);
    }
  }

  return {
    onNodeDragStart,
    onCanvasMouseMove,
    onCanvasMouseUp,
    onCanvasMouseDown,
    onCanvasWheel,
    onCanvasZoomIn,
    onCanvasZoomOut,
    onCanvasKeyDown,
    ensureDragAutoPanLoop,
    applyDragPosition,
    zoomAtClientPoint,
  };
}
