import type { AgentConfig, AgentType } from '@/types/agent';
import type { NodeConfig, WorkflowNode } from '@/types/workflow';
import type { BaseAgent } from './base-agent';
import { AGENT_DEFINITIONS, getAgentDefinition } from './definitions';
import {
  CoderAgent,
  CriticAgent,
  CustomAgent,
  KnowledgeAgent,
  LegalValidatorAgent,
  PlannerAgent,
  ResearcherAgent,
  RetrieverAgent,
  ReviewerAgent,
  TesterAgent,
} from './implementations';

type AgentConstructor = new (config: AgentConfig) => BaseAgent;

const AGENT_CLASSES: Record<AgentType, AgentConstructor> = {
  planner: PlannerAgent,
  researcher: ResearcherAgent,
  retriever: RetrieverAgent,
  knowledge: KnowledgeAgent,
  coder: CoderAgent,
  reviewer: ReviewerAgent,
  critic: CriticAgent,
  tester: TesterAgent,
  legal_validator: LegalValidatorAgent,
  custom: CustomAgent,
};

/** Construct an agent from an explicit config. */
export function createAgent(config: AgentConfig): BaseAgent {
  const AgentClass = AGENT_CLASSES[config.type] ?? CustomAgent;
  return new AgentClass(config);
}

/** Construct an agent for a type using its built-in defaults. */
export function createDefaultAgent(type: AgentType): BaseAgent {
  return createAgent(getAgentDefinition(type));
}

/**
 * Merge a node's overrides onto its agent type's defaults.
 *
 * This is the single place where "what the user configured on the canvas" turns
 * into "what the engine will actually run", so cost/latency projections and the
 * real execution can never drift apart.
 */
export function resolveNodeAgentConfig(
  type: AgentType,
  label: string,
  overrides: NodeConfig = {},
  defaults: Record<AgentType, AgentConfig> = AGENT_DEFINITIONS,
): AgentConfig {
  const base = defaults[type] ?? AGENT_DEFINITIONS.custom;

  return {
    ...base,
    name: label || base.name,
    systemPrompt: overrides.systemPrompt?.trim() || base.systemPrompt,
    temperature: overrides.temperature ?? base.temperature,
    maxTokens: overrides.maxTokens ?? base.maxTokens,
    provider: overrides.provider ?? base.provider,
    ...(overrides.model ?? base.model ? { model: overrides.model ?? base.model } : {}),
  };
}

/** Build the executable agent for a graph node. */
export function createAgentForNode(
  node: WorkflowNode,
  defaults?: Record<AgentType, AgentConfig>,
): BaseAgent {
  return createAgent(resolveNodeAgentConfig(node.type, node.label, node.config, defaults));
}
