import { AGENT_DEFINITIONS } from '@/lib/agents/definitions';
import { BaseAgent } from '@/lib/agents/base-agent';
import type {
  AgentConfig,
  AgentExecutionInput,
  AgentExecutionResult,
  AgentType,
} from '@/types/agent';
import type { ExecutionStep, StepStatus } from '@/types/execution';
import type { EdgeCondition, WorkflowEdge, WorkflowGraph, WorkflowNode } from '@/types/workflow';

/**
 * Shared test builders.
 *
 * Graph literals are noisy — every node needs a position and a config even when
 * a test cares about neither. These helpers keep the *relevant* part of each
 * fixture visible.
 */

export function node(
  id: string,
  type: AgentType = 'custom',
  overrides: Partial<WorkflowNode> = {},
): WorkflowNode {
  return {
    id,
    type,
    label: overrides.label ?? id,
    description: overrides.description ?? '',
    position: overrides.position ?? { x: 0, y: 0 },
    config: overrides.config ?? {},
  };
}

export function edge(
  source: string,
  target: string,
  condition: EdgeCondition = { kind: 'always' },
): WorkflowEdge {
  return { id: `${source}->${target}`, source, target, condition };
}

export function graph(nodes: WorkflowNode[], edges: WorkflowEdge[] = []): WorkflowGraph {
  return { nodes, edges };
}

/** `a → b → c`, one node per layer. */
export function serialGraph(...ids: string[]): WorkflowGraph {
  const nodes = ids.map((id) => node(id));
  const edges = ids.slice(1).map((id, index) => edge(ids[index]!, id));
  return graph(nodes, edges);
}

/** One root fanning out to `count` leaves — a single parallel layer. */
export function fanOutGraph(count: number): WorkflowGraph {
  const leaves = Array.from({ length: count }, (_, i) => `leaf${i + 1}`);
  return graph(
    [node('root'), ...leaves.map((id) => node(id))],
    leaves.map((id) => edge('root', id)),
  );
}

export function step(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: overrides.id ?? 'step_1',
    executionId: overrides.executionId ?? 'exec_1',
    nodeId: overrides.nodeId ?? 'n1',
    agentType: overrides.agentType ?? 'custom',
    label: overrides.label ?? 'Node',
    status: overrides.status ?? 'success',
    layer: overrides.layer ?? 0,
    attempts: overrides.attempts ?? 1,
    retries: overrides.retries ?? 0,
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    durationMs: overrides.durationMs ?? 1_000,
    systemPrompt: overrides.systemPrompt ?? '',
    prompt: overrides.prompt ?? '',
    response: overrides.response ?? '',
    usage: overrides.usage ?? { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    costUsd: overrides.costUsd ?? 0.001,
    confidence: overrides.confidence ?? 0.8,
    provider: overrides.provider ?? 'mock',
    model: overrides.model ?? 'mock-sim-1',
    error: overrides.error ?? null,
    skipReason: overrides.skipReason ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Stub agent                                                                 */
/* -------------------------------------------------------------------------- */

export interface StubBehavior {
  /** Text the agent returns. */
  output?: string;
  confidence?: number;
  costUsd?: number;
  totalTokens?: number;
  /** Thrown instead of returning. Called per attempt, so a test can fail-then-succeed. */
  fail?: (attempt: number) => unknown | null;
  /** Milliseconds to advance the injected clock — lets a test assert on durations. */
  advanceClockMs?: number;
  onExecute?: (input: AgentExecutionInput) => void;
}

/**
 * An agent that never touches a provider.
 *
 * `execute` is overridden wholesale so engine tests exercise orchestration —
 * layering, retries, activation — rather than prompt assembly.
 */
export class StubAgent extends BaseAgent {
  constructor(
    config: AgentConfig,
    private readonly behavior: StubBehavior = {},
    private readonly advanceClock: (ms: number) => void = () => {},
  ) {
    super(config);
  }

  protected instruction(): string {
    return 'stub instruction';
  }

  override async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    this.behavior.onExecute?.(input);

    if (this.behavior.advanceClockMs) {
      this.advanceClock(this.behavior.advanceClockMs);
    }

    const failure = this.behavior.fail?.(input.attempt);
    if (failure) throw failure;

    const totalTokens = this.behavior.totalTokens ?? 150;

    return {
      output: this.behavior.output ?? `output from ${input.nodeLabel}`,
      structured: {},
      systemPrompt: this.config.systemPrompt,
      userPrompt: `task: ${input.task}`,
      usage: {
        promptTokens: Math.floor(totalTokens * 0.7),
        completionTokens: totalTokens - Math.floor(totalTokens * 0.7),
        totalTokens,
      },
      costUsd: this.behavior.costUsd ?? 0.001,
      confidence: this.behavior.confidence ?? 0.85,
      latencyMs: this.behavior.advanceClockMs ?? 10,
      provider: 'mock',
      model: 'mock-sim-1',
    };
  }
}

export function agentConfig(type: AgentType = 'custom'): AgentConfig {
  return { ...AGENT_DEFINITIONS[type] };
}

/** A clock a test can move by hand, so durations are deterministic. */
export function createTestClock(start = 1_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
    set: (value: number) => {
      current = value;
    },
  };
}

export const ALL_STEP_STATUSES: StepStatus[] = [
  'pending',
  'running',
  'success',
  'failed',
  'skipped',
  'cancelled',
];
