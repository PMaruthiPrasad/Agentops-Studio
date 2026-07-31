import type { Edge, Node } from '@xyflow/react';
import type { AgentType } from '@/types/agent';
import type { LiveNodeState } from '@/types/execution';
import type { EdgeCondition } from '@/types/workflow';

/**
 * React Flow view models.
 *
 * These are strictly *presentation* shapes derived from `WorkflowGraph`. The
 * canvas never persists them: the store holds the domain graph, and this module
 * describes what the library needs to draw it. Keeping the two apart is what
 * lets the engine, the optimizer, and the database stay unaware that React Flow
 * exists at all.
 */

export interface AgentNodeData extends Record<string, unknown> {
  label: string;
  agentType: AgentType;
  description: string;
  /** Live state during a run; null outside one. */
  live: LiveNodeState | null;
  /** True when the node overrides its agent type's defaults. */
  overridden: boolean;
}

export type AgentFlowNode = Node<AgentNodeData, 'agent'>;

export interface ConditionalEdgeData extends Record<string, unknown> {
  condition: EdgeCondition;
  label?: string;
}

export type ConditionalFlowEdge = Edge<ConditionalEdgeData, 'conditional'>;

/** MIME-ish key for palette drags. Namespaced so other drags are ignored. */
export const AGENT_DRAG_TYPE = 'application/agentops-agent';
