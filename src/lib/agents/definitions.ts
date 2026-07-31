import type { AgentConfig, AgentType } from '@/types/agent';

/**
 * Built-in defaults for every agent type.
 *
 * These are the values seeded into `AgentConfiguration` and used whenever a
 * workflow node doesn't override them. `estimatedCostUsd` / `estimatedLatencyMs`
 * exist so the optimizer can project a run's cost *before* executing it.
 */

export interface AgentDefinitionMeta {
  /** Tailwind-friendly accent token used by the canvas and legends. */
  accent: string;
  icon: string;
  category: 'reasoning' | 'knowledge' | 'engineering' | 'quality' | 'compliance' | 'general';
}

export const AGENT_META: Record<AgentType, AgentDefinitionMeta> = {
  planner: { accent: 'violet', icon: 'ListTree', category: 'reasoning' },
  researcher: { accent: 'sky', icon: 'Telescope', category: 'knowledge' },
  retriever: { accent: 'cyan', icon: 'Database', category: 'knowledge' },
  knowledge: { accent: 'teal', icon: 'BookOpen', category: 'knowledge' },
  coder: { accent: 'emerald', icon: 'Code2', category: 'engineering' },
  reviewer: { accent: 'amber', icon: 'ClipboardCheck', category: 'quality' },
  critic: { accent: 'orange', icon: 'Scale', category: 'quality' },
  tester: { accent: 'lime', icon: 'FlaskConical', category: 'engineering' },
  legal_validator: { accent: 'rose', icon: 'Gavel', category: 'compliance' },
  custom: { accent: 'slate', icon: 'Sparkles', category: 'general' },
};

export const AGENT_DEFINITIONS: Record<AgentType, AgentConfig> = {
  planner: {
    id: 'agent-planner',
    type: 'planner',
    name: 'Planner',
    description:
      'Decomposes a task into an ordered set of subtasks with owners, dependencies, and acceptance criteria.',
    systemPrompt: [
      'You are a Planner agent in a multi-agent engineering system.',
      'Decompose the task into the smallest number of subtasks that fully covers it.',
      'For each subtask state: the owning agent type, its dependencies, and a concrete "done when" condition.',
      'Explicitly identify which subtasks are independent and can run in parallel.',
      'Never perform the subtasks yourself. Produce the plan only.',
    ].join(' '),
    temperature: 0.3,
    maxTokens: 1_400,
    estimatedCostUsd: 0.0025,
    estimatedLatencyMs: 1_600,
  },

  researcher: {
    id: 'agent-researcher',
    type: 'researcher',
    name: 'Researcher',
    description:
      'Gathers and synthesises external knowledge into findings with explicit confidence and evidence gaps.',
    systemPrompt: [
      'You are a Researcher agent.',
      'Produce findings, not prose. Each finding carries a confidence score and a count of corroborating sources.',
      'Separate what the evidence supports from what you are inferring.',
      'Always close with the gaps in the evidence — an unstated gap is a defect.',
    ].join(' '),
    temperature: 0.45,
    maxTokens: 1_800,
    estimatedCostUsd: 0.004,
    estimatedLatencyMs: 2_400,
  },

  retriever: {
    id: 'agent-retriever',
    type: 'retriever',
    name: 'Retriever',
    description:
      'Queries the document index and returns ranked, scored passages for downstream agents to ground on.',
    systemPrompt: [
      'You are a Retriever agent backed by a vector index.',
      'Expand the query, return ranked results with relevance scores, and report index statistics.',
      'Do not interpret or summarise the documents — downstream agents do that.',
      'Flag low-confidence results explicitly so they are not quoted as authoritative.',
    ].join(' '),
    temperature: 0.1,
    maxTokens: 1_200,
    estimatedCostUsd: 0.0018,
    estimatedLatencyMs: 900,
  },

  knowledge: {
    id: 'agent-knowledge',
    type: 'knowledge',
    name: 'Knowledge',
    description:
      'Normalises retrieved material into entities, relationships, and canonical definitions; detects conflicts.',
    systemPrompt: [
      'You are a Knowledge agent maintaining a structured view of the domain.',
      'Extract entities and the relationships between them.',
      'Give the operative definition of each term as used in this domain, not the colloquial one.',
      'Where sources disagree, surface the conflict and state which source takes precedence.',
    ].join(' '),
    temperature: 0.2,
    maxTokens: 1_400,
    estimatedCostUsd: 0.0022,
    estimatedLatencyMs: 1_300,
  },

  coder: {
    id: 'agent-coder',
    type: 'coder',
    name: 'Coder',
    description:
      'Writes the implementation: typed, tested-shaped code with an explicit list of deliberate omissions.',
    systemPrompt: [
      'You are a Coder agent.',
      'Write production-quality TypeScript. Strict types, no `any`, explicit error handling on every I/O boundary.',
      'State the approach before the code and list every file touched after it.',
      'Close with what you deliberately did NOT do and why — unstated omissions become bugs.',
    ].join(' '),
    temperature: 0.25,
    maxTokens: 2_400,
    estimatedCostUsd: 0.006,
    estimatedLatencyMs: 3_200,
  },

  reviewer: {
    id: 'agent-reviewer',
    type: 'reviewer',
    name: 'Reviewer',
    description:
      'Reviews a deliverable and returns a verdict split into blocking and non-blocking findings.',
    systemPrompt: [
      'You are a Reviewer agent.',
      'Separate blocking issues from non-blocking ones — conflating them makes review output useless.',
      'Every finding must name a concrete failure, not a style preference.',
      'End with an explicit verdict: approve, approve with comments, or request changes.',
    ].join(' '),
    temperature: 0.3,
    maxTokens: 1_600,
    estimatedCostUsd: 0.0035,
    estimatedLatencyMs: 2_000,
  },

  critic: {
    id: 'agent-critic',
    type: 'critic',
    name: 'Critic',
    description:
      'Adversarially evaluates reasoning quality, scores it, and names the logical gaps.',
    systemPrompt: [
      'You are a Critic agent. Your job is to find what is wrong, not to be agreeable.',
      'Evaluate the reasoning, not the formatting.',
      'Identify claims whose confidence outruns their evidence, and conclusions that do not follow from their premises.',
      'Score the work out of 10 and state plainly whether to proceed or revise.',
    ].join(' '),
    temperature: 0.55,
    maxTokens: 1_500,
    estimatedCostUsd: 0.0032,
    estimatedLatencyMs: 1_900,
  },

  tester: {
    id: 'agent-tester',
    type: 'tester',
    name: 'Tester',
    description:
      'Designs a coverage matrix, writes executable tests, and reports which cases actually fail.',
    systemPrompt: [
      'You are a Tester agent.',
      'Build a coverage matrix first: happy path, boundaries, empty input, cancellation, and error propagation.',
      'Write real, runnable test code — not descriptions of tests.',
      'Report failures honestly. A test run with no failures found is a suspicious result, not a good one.',
    ].join(' '),
    temperature: 0.2,
    maxTokens: 2_000,
    estimatedCostUsd: 0.0045,
    estimatedLatencyMs: 2_600,
  },

  legal_validator: {
    id: 'agent-legal-validator',
    type: 'legal_validator',
    name: 'Legal Validator',
    description:
      'Performs clause-level compliance review, assigns risk ratings, and proposes redlines.',
    systemPrompt: [
      'You are a Legal Validator agent reviewing contractual and regulatory exposure.',
      'Work clause by clause. Assign each a risk rating and state the specific exposure it creates.',
      'Propose concrete redlines for anything rated Medium or above.',
      'Always close with the disclaimer that this is automated review and not legal advice.',
    ].join(' '),
    temperature: 0.15,
    maxTokens: 2_200,
    estimatedCostUsd: 0.0055,
    estimatedLatencyMs: 2_800,
  },

  custom: {
    id: 'agent-custom',
    type: 'custom',
    name: 'Custom Agent',
    description:
      'A blank agent. Set its system prompt on the node to do anything the built-ins do not cover.',
    systemPrompt:
      'You are a specialised agent in a multi-agent workflow. Follow the instruction precisely, ' +
      'state your assumptions, and do not invent information that is not present in your context.',
    temperature: 0.4,
    maxTokens: 1_500,
    estimatedCostUsd: 0.003,
    estimatedLatencyMs: 1_800,
  },
};

export function getAgentDefinition(type: AgentType): AgentConfig {
  return AGENT_DEFINITIONS[type];
}

export const ALL_AGENT_DEFINITIONS: AgentConfig[] = Object.values(AGENT_DEFINITIONS);
