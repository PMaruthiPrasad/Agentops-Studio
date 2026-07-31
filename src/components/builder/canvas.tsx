'use client';

import { useCallback, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  type EdgeTypes,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import { AGENT_DEFINITIONS } from '@/lib/agents/definitions';
import { getAgentColorHex } from '@/lib/agent-ui';
import { useBuilderStore } from '@/stores/builder-store';
import type { AgentType } from '@/types/agent';
import type { LiveNodeState } from '@/types/execution';
import { AgentNode } from './agent-node';
import { ConditionalEdge } from './conditional-edge';
import { AGENT_DRAG_TYPE, type AgentFlowNode, type ConditionalFlowEdge } from './flow-types';

/**
 * The canvas.
 *
 * React Flow is *not* the source of truth here — the builder store is. Every
 * change is translated into a store action and flows back down as new props.
 * That one rule is what makes undo/redo, the optimizer's "apply patch", and
 * version restore all work identically: they replace the graph in the store and
 * the canvas simply redraws.
 */

// Defined at module scope: React Flow warns (and re-mounts every node) if these
// object identities change between renders.
const NODE_TYPES: NodeTypes = { agent: AgentNode };
const EDGE_TYPES: EdgeTypes = { conditional: ConditionalEdge };

const DEFAULT_EDGE_OPTIONS = {
  type: 'conditional',
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
} as const;

interface CanvasProps {
  /** Live per-node telemetry while a run is streaming; empty outside a run. */
  liveNodes: Record<string, LiveNodeState>;
  /** Node ids the optimizer is currently highlighting. */
  highlightedNodeIds?: string[];
  readOnly?: boolean;
}

export function Canvas({ liveNodes, highlightedNodeIds = [], readOnly = false }: CanvasProps) {
  const graph = useBuilderStore((state) => state.graph);
  const selectedNodeIds = useBuilderStore((state) => state.selectedNodeIds);
  const selectedEdgeId = useBuilderStore((state) => state.selectedEdgeId);

  const moveNode = useBuilderStore((state) => state.moveNode);
  const removeNodes = useBuilderStore((state) => state.removeNodes);
  const removeEdges = useBuilderStore((state) => state.removeEdges);
  const connect = useBuilderStore((state) => state.connect);
  const addNode = useBuilderStore((state) => state.addNode);
  const select = useBuilderStore((state) => state.select);
  const clearSelection = useBuilderStore((state) => state.clearSelection);
  const snapshot = useBuilderStore((state) => state.snapshot);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const highlighted = useMemo(() => new Set(highlightedNodeIds), [highlightedNodeIds]);
  const selectedNodeSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

  const nodes = useMemo<AgentFlowNode[]>(
    () =>
      graph.nodes.map((node) => {
        const definition = AGENT_DEFINITIONS[node.type];
        // "Overridden" means the node departs from its agent type's defaults —
        // worth a marker, because it explains behaviour that the palette won't.
        const overridden = Object.keys(node.config).length > 0;

        return {
          id: node.id,
          type: 'agent',
          position: node.position,
          selected: selectedNodeSet.has(node.id),
          data: {
            label: node.label,
            agentType: node.type,
            description: node.description || definition.description,
            live: liveNodes[node.id] ?? null,
            overridden,
          },
          className: highlighted.has(node.id) ? 'ring-2 ring-warning/60 rounded-lg' : undefined,
          draggable: !readOnly,
        };
      }),
    [graph.nodes, liveNodes, selectedNodeSet, highlighted, readOnly],
  );

  const edges = useMemo<ConditionalFlowEdge[]>(
    () =>
      graph.edges.map((edge) => {
        const targetLive = liveNodes[edge.target];
        const sourceLive = liveNodes[edge.source];

        // Edge state is derived, never stored: an edge is "running" when its
        // source finished and its target is in flight.
        let className: string | undefined;
        if (targetLive?.status === 'skipped') className = 'edge-skipped';
        else if (targetLive?.status === 'running') className = 'edge-running';
        else if (sourceLive?.status === 'success' && targetLive?.status === 'success')
          className = 'edge-active';

        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: 'conditional',
          selected: edge.id === selectedEdgeId,
          className,
          data: { condition: edge.condition, label: edge.label },
        };
      }),
    [graph.edges, liveNodes, selectedEdgeId],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<AgentFlowNode>[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          moveNode(change.id, change.position);
        } else if (change.type === 'remove' && !readOnly) {
          removeNodes([change.id]);
        }
      }
    },
    [moveNode, removeNodes, readOnly],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<ConditionalFlowEdge>[]) => {
      const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
      if (removed.length > 0 && !readOnly) removeEdges(removed);
    },
    [removeEdges, readOnly],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      if (!connection.source || !connection.target) return;
      connect(connection.source, connection.target);
    },
    [connect, readOnly],
  );

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => {
      select(
        selectedNodes.map((node) => node.id),
        selectedEdges[0]?.id ?? null,
      );
    },
    [select],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (readOnly) return;

      const type = event.dataTransfer.getData(AGENT_DRAG_TYPE) as AgentType;
      if (!type || !(type in AGENT_DEFINITIONS)) return;

      // Drop where the cursor is, not where the graph origin happens to be.
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(type, { x: Math.round(position.x - 110), y: Math.round(position.y - 30) });
    },
    [addNode, screenToFlowPosition, readOnly],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <div ref={wrapperRef} className="size-full">
      <ReactFlow<AgentFlowNode, ConditionalFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onNodeDragStart={snapshot}
        onPaneClick={clearSelection}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable
        // The app owns Delete/Backspace so a keystroke in a side panel can never
        // silently delete part of the graph.
        deleteKeyCode={null}
        multiSelectionKeyCode="Shift"
        selectionOnDrag
        panOnDrag={[1, 2]}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="hsl(var(--canvas-dot))" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(node) => getAgentColorHex((node.data as { agentType: AgentType }).agentType)}
          maskColor="hsl(var(--background) / 0.7)"
          className="!bottom-3 !right-3"
        />
      </ReactFlow>
    </div>
  );
}
