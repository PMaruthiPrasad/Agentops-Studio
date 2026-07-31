'use client';

import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { AGENT_DEFINITIONS } from '@/lib/agents/definitions';
import { ALWAYS, type EdgeCondition, type NodeConfig, type Position, type Workflow, type WorkflowEdge, type WorkflowGraph, type WorkflowNode } from '@/types/workflow';
import type { AgentType } from '@/types/agent';

/**
 * Builder state.
 *
 * The canvas is the one genuinely stateful surface in the app: it holds
 * unsaved edits, a selection, and an undo stack that has to survive panel
 * re-renders. That belongs in a store rather than in component state, and
 * keeping it here means the graph can be read by the run panel, the optimizer,
 * and the inspector without prop-drilling through the canvas.
 *
 * ## History model
 *
 * `past` holds whole-graph snapshots. Graphs here are small (tens of nodes), so
 * snapshotting is cheaper and far less bug-prone than inverse patches. Callers
 * that mutate structure snapshot automatically; dragging is different — it fires
 * continuously, so the canvas calls `snapshot()` once on drag start and then
 * moves nodes without touching history.
 */

const HISTORY_LIMIT = 50;

/** Offset applied when a node is duplicated so the copy is visibly distinct. */
const DUPLICATE_OFFSET = 48;

export interface BuilderState {
  workflowId: string | null;
  name: string;
  description: string;
  tags: string[];
  isFavorite: boolean;
  version: number;

  graph: WorkflowGraph;
  selectedNodeIds: string[];
  selectedEdgeId: string | null;

  past: WorkflowGraph[];
  future: WorkflowGraph[];
  dirty: boolean;

  /* Actions */
  load: (workflow: Workflow) => void;
  setMeta: (meta: Partial<Pick<BuilderState, 'name' | 'description' | 'tags' | 'isFavorite'>>) => void;
  markSaved: (workflow: Workflow) => void;

  snapshot: () => void;
  setGraph: (graph: WorkflowGraph, options?: { history?: boolean }) => void;

  addNode: (type: AgentType, position: Position, label?: string) => string;
  updateNode: (id: string, patch: Partial<Pick<WorkflowNode, 'label' | 'description'>>) => void;
  updateNodeConfig: (id: string, patch: Partial<NodeConfig>) => void;
  moveNode: (id: string, position: Position) => void;
  removeNodes: (ids: string[]) => void;
  duplicateNode: (id: string) => void;

  connect: (source: string, target: string) => void;
  updateEdge: (id: string, patch: { label?: string; condition?: EdgeCondition }) => void;
  removeEdges: (ids: string[]) => void;

  select: (nodeIds: string[], edgeId?: string | null) => void;
  clearSelection: () => void;

  undo: () => void;
  redo: () => void;
  reset: () => void;
}

function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return {
    nodes: graph.nodes.map((node) => ({ ...node, position: { ...node.position }, config: { ...node.config } })),
    edges: graph.edges.map((edge) => ({ ...edge, condition: { ...edge.condition } })),
  };
}

const EMPTY: WorkflowGraph = { nodes: [], edges: [] };

export const useBuilderStore = create<BuilderState>((set, get) => ({
  workflowId: null,
  name: '',
  description: '',
  tags: [],
  isFavorite: false,
  version: 1,

  graph: EMPTY,
  selectedNodeIds: [],
  selectedEdgeId: null,

  past: [],
  future: [],
  dirty: false,

  load: (workflow) =>
    set({
      workflowId: workflow.id,
      name: workflow.name,
      description: workflow.description,
      tags: workflow.tags,
      isFavorite: workflow.isFavorite,
      version: workflow.version,
      graph: cloneGraph(workflow.graph),
      past: [],
      future: [],
      dirty: false,
      selectedNodeIds: [],
      selectedEdgeId: null,
    }),

  setMeta: (meta) => set((state) => ({ ...state, ...meta, dirty: true })),

  markSaved: (workflow) =>
    set({
      workflowId: workflow.id,
      version: workflow.version,
      name: workflow.name,
      description: workflow.description,
      tags: workflow.tags,
      isFavorite: workflow.isFavorite,
      dirty: false,
    }),

  snapshot: () =>
    set((state) => ({
      past: [...state.past, cloneGraph(state.graph)].slice(-HISTORY_LIMIT),
      future: [],
    })),

  setGraph: (graph, options = {}) => {
    const { history = true } = options;
    const state = get();

    set({
      graph: cloneGraph(graph),
      dirty: true,
      ...(history
        ? { past: [...state.past, cloneGraph(state.graph)].slice(-HISTORY_LIMIT), future: [] }
        : {}),
    });
  },

  addNode: (type, position, label) => {
    const definition = AGENT_DEFINITIONS[type];
    const id = `node_${nanoid(8)}`;

    const node: WorkflowNode = {
      id,
      type,
      label: label ?? definition.name,
      description: definition.description,
      position,
      config: {},
    };

    get().setGraph({ ...get().graph, nodes: [...get().graph.nodes, node] });
    set({ selectedNodeIds: [id], selectedEdgeId: null });
    return id;
  },

  updateNode: (id, patch) => {
    const graph = get().graph;
    get().setGraph({
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    });
  },

  updateNodeConfig: (id, patch) => {
    const graph = get().graph;
    get().setGraph({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === id ? { ...node, config: { ...node.config, ...patch } } : node,
      ),
    });
  },

  // Deliberately bypasses history — see the note on the history model above.
  moveNode: (id, position) =>
    set((state) => ({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((node) => (node.id === id ? { ...node, position } : node)),
      },
      dirty: true,
    })),

  removeNodes: (ids) => {
    if (ids.length === 0) return;
    const graph = get().graph;
    const removed = new Set(ids);

    get().setGraph({
      nodes: graph.nodes.filter((node) => !removed.has(node.id)),
      // Dangling edges would fail graph validation on save.
      edges: graph.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
    });

    set((state) => ({
      selectedNodeIds: state.selectedNodeIds.filter((id) => !removed.has(id)),
    }));
  },

  duplicateNode: (id) => {
    const graph = get().graph;
    const source = graph.nodes.find((node) => node.id === id);
    if (!source) return;

    const copy: WorkflowNode = {
      ...source,
      id: `node_${nanoid(8)}`,
      label: `${source.label} copy`,
      position: {
        x: source.position.x + DUPLICATE_OFFSET,
        y: source.position.y + DUPLICATE_OFFSET,
      },
      config: { ...source.config },
    };

    get().setGraph({ ...graph, nodes: [...graph.nodes, copy] });
    set({ selectedNodeIds: [copy.id] });
  },

  connect: (source, target) => {
    if (source === target) return;

    const graph = get().graph;
    const exists = graph.edges.some((edge) => edge.source === source && edge.target === target);
    if (exists) return;

    const edge: WorkflowEdge = {
      id: `edge_${nanoid(8)}`,
      source,
      target,
      condition: ALWAYS,
    };

    get().setGraph({ ...graph, edges: [...graph.edges, edge] });
  },

  updateEdge: (id, patch) => {
    const graph = get().graph;
    get().setGraph({
      ...graph,
      edges: graph.edges.map((edge) => (edge.id === id ? { ...edge, ...patch } : edge)),
    });
  },

  removeEdges: (ids) => {
    if (ids.length === 0) return;
    const graph = get().graph;
    const removed = new Set(ids);

    get().setGraph({ ...graph, edges: graph.edges.filter((edge) => !removed.has(edge.id)) });
    set((state) => ({ selectedEdgeId: removed.has(state.selectedEdgeId ?? '') ? null : state.selectedEdgeId }));
  },

  select: (nodeIds, edgeId = null) => set({ selectedNodeIds: nodeIds, selectedEdgeId: edgeId }),

  clearSelection: () => set({ selectedNodeIds: [], selectedEdgeId: null }),

  undo: () =>
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous) return state;

      return {
        graph: previous,
        past: state.past.slice(0, -1),
        future: [cloneGraph(state.graph), ...state.future].slice(0, HISTORY_LIMIT),
        dirty: true,
      };
    }),

  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next) return state;

      return {
        graph: next,
        past: [...state.past, cloneGraph(state.graph)].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        dirty: true,
      };
    }),

  reset: () =>
    set({
      workflowId: null,
      name: '',
      description: '',
      tags: [],
      isFavorite: false,
      version: 1,
      graph: EMPTY,
      past: [],
      future: [],
      dirty: false,
      selectedNodeIds: [],
      selectedEdgeId: null,
    }),
}));

/** Selector helpers — keep components from subscribing to the whole store. */
export const selectCanUndo = (state: BuilderState): boolean => state.past.length > 0;
export const selectCanRedo = (state: BuilderState): boolean => state.future.length > 0;
export const selectSelectedNode = (state: BuilderState): WorkflowNode | null => {
  const id = state.selectedNodeIds[0];
  if (!id || state.selectedNodeIds.length !== 1) return null;
  return state.graph.nodes.find((node) => node.id === id) ?? null;
};
export const selectSelectedEdge = (state: BuilderState): WorkflowEdge | null => {
  if (!state.selectedEdgeId) return null;
  return state.graph.edges.find((edge) => edge.id === state.selectedEdgeId) ?? null;
};
