import type { AgentConfig, AgentType, UpstreamOutput } from '@/types/agent';
import type {
  ExecutionEvent,
  ExecutionMetrics,
  ExecutionStatus,
  ExecutionStep,
  StepStatus,
} from '@/types/execution';
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from '@/types/workflow';
import { EMPTY_USAGE, ProviderError } from '@/types/provider';
import type { BaseAgent } from '@/lib/agents/base-agent';
import { createAgentForNode } from '@/lib/agents/registry';
import { isAbortError, toErrorMessage } from '@/lib/utils';
import { computeBackoff, mapWithConcurrency, TimeoutError, withTimeout } from './concurrency';
import { evaluateCondition, type ConditionSubject } from './conditions';
import { computeMetrics } from './metrics';
import { computeTopology } from './topology';
import { assertValidGraph } from './validate';

/**
 * The workflow execution engine.
 *
 * Deliberately framework-free: no React, no Next, no Prisma, no global state.
 * Everything it needs — how to build an agent, what time it is, where to send
 * events — arrives through `EngineDependencies`, which is what makes it
 * testable with a fake clock and a stub agent, and reusable from a worker or a
 * CLI without changes.
 *
 * ## Semantics
 *
 * - **Layers.** The graph is split into topological layers; a whole layer is
 *   dispatched concurrently under a configurable ceiling.
 * - **Activation (OR-join).** A node with predecessors runs if *at least one*
 *   incoming edge is satisfied — the source succeeded and the edge condition
 *   passed. Otherwise it is skipped with a recorded reason. This is what makes
 *   branching work: an unsatisfied branch prunes its whole subtree.
 * - **Data flow.** A node receives the outputs of exactly the predecessors
 *   whose edges were satisfied, in layer order.
 * - **Retries.** Retryable failures back off exponentially with jitter.
 *   Non-retryable failures (bad credentials, validation) fail immediately —
 *   retrying them only burns time and money.
 * - **Isolation.** One node failing never aborts its layer. The run continues
 *   and the failure is reported, because a partial result with a clear failure
 *   is more useful to an engineer than no result at all.
 */

export interface EngineDependencies {
  /** Builds the executable agent for a node. Injected so tests can stub it. */
  buildAgent: (node: WorkflowNode) => BaseAgent;
  /** Monotonic-ish clock. Injected so tests can freeze time. */
  now: () => number;
  /** Receives live progress events. */
  emit: (event: ExecutionEvent) => void;
  /** Sleep used for retry backoff. Injected so tests skip real waiting. */
  wait: (ms: number) => Promise<void>;
  /** Step id factory. */
  nextId: () => string;
}

export interface ExecuteWorkflowOptions {
  executionId: string;
  workflowId: string;
  workflowName: string;
  task: string;
  graph: WorkflowGraph;
  maxConcurrency?: number;
  maxAttempts?: number;
  nodeTimeoutMs?: number;
  signal?: AbortSignal;
  /** Overrides the built-in agent defaults (e.g. user-edited configurations). */
  agentDefaults?: Record<AgentType, AgentConfig>;
}

export interface EngineRunResult {
  executionId: string;
  status: ExecutionStatus;
  steps: ExecutionStep[];
  metrics: ExecutionMetrics;
  startedAt: string;
  completedAt: string;
  error: string | null;
  layers: string[][];
}

const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_NODE_TIMEOUT_MS = 60_000;

let idCounter = 0;

export function createDefaultDependencies(
  emit: (event: ExecutionEvent) => void = () => {},
  agentDefaults?: Record<AgentType, AgentConfig>,
): EngineDependencies {
  return {
    buildAgent: (node) => createAgentForNode(node, agentDefaults),
    now: () => Date.now(),
    emit,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    nextId: () => {
      idCounter += 1;
      return `step_${Date.now().toString(36)}_${idCounter.toString(36)}`;
    },
  };
}

/** Result of one node's execution, internal to the engine. */
interface NodeOutcome {
  step: ExecutionStep;
  /** Present only when the node produced usable output for downstream nodes. */
  output: UpstreamOutput | null;
}

export async function executeWorkflow(
  options: ExecuteWorkflowOptions,
  deps: EngineDependencies,
): Promise<EngineRunResult> {
  const {
    executionId,
    workflowId,
    task,
    graph,
    signal,
    maxConcurrency = DEFAULT_MAX_CONCURRENCY,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    nodeTimeoutMs = DEFAULT_NODE_TIMEOUT_MS,
  } = options;

  const runStartMs = deps.now();
  const startedAt = new Date(runStartMs).toISOString();

  // Throws WorkflowValidationError; the caller maps it to a 400.
  assertValidGraph(graph);

  const topology = computeTopology(graph);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgesByTarget = groupEdgesByTarget(graph.edges);

  deps.emit({
    type: 'run.start',
    executionId,
    workflowId,
    task,
    layers: topology.layers,
  });

  const steps: ExecutionStep[] = [];
  /** Successful node results, available to downstream nodes. */
  const outputs = new Map<string, UpstreamOutput>();
  /** Every finished step, keyed by node id — used for condition evaluation. */
  const finished = new Map<string, ExecutionStep>();

  let cancelled = false;

  for (const [layerIndex, layer] of topology.layers.entries()) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }

    /* --- Decide what runs in this layer ------------------------------- */
    const activations = layer.map((nodeId) =>
      resolveActivation(nodeId, edgesByTarget.get(nodeId) ?? [], finished, outputs),
    );

    // Record skips before dispatching, so the UI prunes branches immediately.
    for (const activation of activations) {
      if (activation.activated) continue;
      const node = nodeById.get(activation.nodeId);
      if (!node) continue;

      const step = buildSkippedStep({
        id: deps.nextId(),
        executionId,
        node,
        layer: layerIndex,
        reason: activation.reason,
      });
      steps.push(step);
      finished.set(node.id, step);
      deps.emit({ type: 'step.skip', executionId, nodeId: node.id, reason: activation.reason });
      deps.emit({ type: 'step.finish', executionId, nodeId: node.id, step });
    }

    const runnable = activations
      .filter((activation) => activation.activated)
      .map((activation) => ({
        node: nodeById.get(activation.nodeId),
        upstream: activation.upstream,
      }))
      .filter((entry): entry is { node: WorkflowNode; upstream: UpstreamOutput[] } =>
        Boolean(entry.node),
      );

    if (runnable.length === 0) continue;

    /* --- Dispatch the layer ------------------------------------------- */
    const outcomes = await mapWithConcurrency(runnable, maxConcurrency, (entry) =>
      runNode({
        node: entry.node,
        upstream: entry.upstream,
        layerIndex,
        executionId,
        task,
        maxAttempts,
        nodeTimeoutMs,
        ...(signal ? { signal } : {}),
        deps,
      }),
    );

    for (const outcome of outcomes) {
      steps.push(outcome.step);
      finished.set(outcome.step.nodeId, outcome.step);
      if (outcome.output) outputs.set(outcome.step.nodeId, outcome.output);
      if (outcome.step.status === 'cancelled') cancelled = true;
    }
  }

  /* --- Anything never reached (because a whole layer was pruned) ------- */
  for (const node of graph.nodes) {
    if (finished.has(node.id)) continue;
    const reason = cancelled
      ? 'run cancelled before this node was reached'
      : 'no upstream branch reached this node';
    const step = buildSkippedStep({
      id: deps.nextId(),
      executionId,
      node,
      layer: topology.layerOf.get(node.id) ?? 0,
      reason,
    });
    steps.push(step);
    finished.set(node.id, step);
    deps.emit({ type: 'step.finish', executionId, nodeId: node.id, step });
  }

  /* --- Finalise -------------------------------------------------------- */
  const completedMs = deps.now();
  // Order steps the way they executed so the timeline reads correctly.
  steps.sort((a, b) => a.layer - b.layer || a.nodeId.localeCompare(b.nodeId));

  const metrics = computeMetrics(steps, graph, topology.layers.length, completedMs - runStartMs);
  const status = deriveStatus(steps, cancelled);
  const error = summariseError(steps, status);

  deps.emit({ type: 'run.finish', executionId, status, metrics, error });

  return {
    executionId,
    status,
    steps,
    metrics,
    startedAt,
    completedAt: new Date(completedMs).toISOString(),
    error,
    layers: topology.layers,
  };
}

/* -------------------------------------------------------------------------- */
/* Node execution                                                             */
/* -------------------------------------------------------------------------- */

interface RunNodeArgs {
  node: WorkflowNode;
  upstream: UpstreamOutput[];
  layerIndex: number;
  executionId: string;
  task: string;
  maxAttempts: number;
  nodeTimeoutMs: number;
  signal?: AbortSignal;
  deps: EngineDependencies;
}

async function runNode(args: RunNodeArgs): Promise<NodeOutcome> {
  const { node, upstream, layerIndex, executionId, task, nodeTimeoutMs, signal, deps } = args;

  // A node may cap its own retries below the run-wide default.
  const maxAttempts = Math.max(1, Math.min(args.maxAttempts, node.config.maxAttempts ?? args.maxAttempts));

  const agent = deps.buildAgent(node);
  const startMs = deps.now();
  const startedAt = new Date(startMs).toISOString();

  let lastError: unknown = null;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;

    if (signal?.aborted) {
      return {
        step: buildStep({
          id: deps.nextId(),
          executionId,
          node,
          agent,
          layer: layerIndex,
          status: 'cancelled',
          attempts: attempt,
          retries: attempt - 1,
          startedAt,
          completedAt: new Date(deps.now()).toISOString(),
          durationMs: deps.now() - startMs,
          error: 'Run cancelled',
        }),
        output: null,
      };
    }

    deps.emit({ type: 'step.start', executionId, nodeId: node.id, layer: layerIndex, attempt });

    try {
      const result = await withTimeout(nodeTimeoutMs, signal, (timeoutSignal) =>
        agent.execute({
          task,
          upstream,
          nodeId: node.id,
          nodeLabel: node.label,
          attempt,
          signal: timeoutSignal,
        }),
      );

      const completedMs = deps.now();
      const step = buildStep({
        id: deps.nextId(),
        executionId,
        node,
        agent,
        layer: layerIndex,
        status: 'success',
        attempts: attempt,
        retries: attempt - 1,
        startedAt,
        completedAt: new Date(completedMs).toISOString(),
        durationMs: Math.max(0, completedMs - startMs),
        systemPrompt: result.systemPrompt,
        prompt: result.userPrompt,
        response: result.output,
        usage: result.usage,
        costUsd: result.costUsd,
        confidence: result.confidence,
        provider: result.provider,
        model: result.model,
      });

      deps.emit({ type: 'step.finish', executionId, nodeId: node.id, step });

      return {
        step,
        output: {
          nodeId: node.id,
          agentType: node.type,
          label: node.label,
          output: result.output,
          confidence: result.confidence,
        },
      };
    } catch (error) {
      lastError = error;

      const retryable = isRetryable(error) && attempt < maxAttempts;
      if (!retryable) break;

      const backoffMs = computeBackoff(attempt);
      deps.emit({
        type: 'step.retry',
        executionId,
        nodeId: node.id,
        attempt,
        error: toErrorMessage(error),
        backoffMs,
      });
      await deps.wait(backoffMs);
    }
  }

  const completedMs = deps.now();
  const cancelledRun = signal?.aborted === true;
  const step = buildStep({
    id: deps.nextId(),
    executionId,
    node,
    agent,
    layer: layerIndex,
    status: cancelledRun ? 'cancelled' : 'failed',
    attempts: attempt,
    retries: Math.max(0, attempt - 1),
    startedAt,
    completedAt: new Date(completedMs).toISOString(),
    durationMs: Math.max(0, completedMs - startMs),
    error: toErrorMessage(lastError),
  });

  deps.emit({ type: 'step.finish', executionId, nodeId: node.id, step });
  return { step, output: null };
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ProviderError) return error.retryable;
  if (error instanceof TimeoutError) return true;
  // A deliberate cancellation is never retried. `isAbortError` matches on
  // `name` because `DOMException` does not subclass `Error` everywhere.
  if (isAbortError(error)) return false;
  // Unknown failures get the benefit of the doubt — transient network errors
  // are by far the most common cause.
  return true;
}

/* -------------------------------------------------------------------------- */
/* Activation                                                                 */
/* -------------------------------------------------------------------------- */

interface Activation {
  nodeId: string;
  activated: boolean;
  reason: string;
  upstream: UpstreamOutput[];
}

/**
 * OR-join activation: one satisfied incoming edge is enough.
 *
 * The `upstream` list contains only the predecessors whose edge actually fired,
 * so a node never sees output from a branch that was logically not taken.
 */
function resolveActivation(
  nodeId: string,
  incomingEdges: WorkflowEdge[],
  finished: Map<string, ExecutionStep>,
  outputs: Map<string, UpstreamOutput>,
): Activation {
  if (incomingEdges.length === 0) {
    return { nodeId, activated: true, reason: 'entry node', upstream: [] };
  }

  const upstream: UpstreamOutput[] = [];
  const blockedReasons: string[] = [];

  for (const edge of incomingEdges) {
    const sourceStep = finished.get(edge.source);

    if (!sourceStep) {
      blockedReasons.push(`${edge.source} did not run`);
      continue;
    }

    if (sourceStep.status !== 'success') {
      blockedReasons.push(`${edge.source} ${sourceStep.status}`);
      continue;
    }

    const subject: ConditionSubject = {
      status: sourceStep.status,
      confidence: sourceStep.confidence,
      tokens: sourceStep.usage.totalTokens,
      cost: sourceStep.costUsd,
      output: sourceStep.response,
    };

    const evaluation = evaluateCondition(edge.condition, subject);
    if (!evaluation.passed) {
      blockedReasons.push(`${edge.source}: ${evaluation.reason}`);
      continue;
    }

    const output = outputs.get(edge.source);
    if (output) upstream.push(output);
  }

  if (upstream.length === 0) {
    return {
      nodeId,
      activated: false,
      reason: blockedReasons.join('; ') || 'no upstream edge was satisfied',
      upstream: [],
    };
  }

  return { nodeId, activated: true, reason: 'upstream satisfied', upstream };
}

function groupEdgesByTarget(edges: WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  const grouped = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    const bucket = grouped.get(edge.target);
    if (bucket) bucket.push(edge);
    else grouped.set(edge.target, [edge]);
  }
  return grouped;
}

/* -------------------------------------------------------------------------- */
/* Step construction                                                          */
/* -------------------------------------------------------------------------- */

interface BuildStepArgs {
  id: string;
  executionId: string;
  node: WorkflowNode;
  agent: BaseAgent;
  layer: number;
  status: StepStatus;
  attempts: number;
  retries: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  systemPrompt?: string;
  prompt?: string;
  response?: string;
  usage?: ExecutionStep['usage'];
  costUsd?: number;
  confidence?: number;
  provider?: ExecutionStep['provider'];
  model?: string;
  error?: string;
}

function buildStep(args: BuildStepArgs): ExecutionStep {
  return {
    id: args.id,
    executionId: args.executionId,
    nodeId: args.node.id,
    agentType: args.node.type,
    label: args.node.label,
    status: args.status,
    layer: args.layer,
    attempts: args.attempts,
    retries: args.retries,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    durationMs: args.durationMs,
    systemPrompt: args.systemPrompt ?? args.agent.systemPrompt,
    prompt: args.prompt ?? '',
    response: args.response ?? '',
    usage: args.usage ?? EMPTY_USAGE,
    costUsd: args.costUsd ?? 0,
    confidence: args.confidence ?? 0,
    provider: args.provider ?? args.agent.config.provider,
    model: args.model ?? args.agent.config.model ?? '',
    error: args.error ?? null,
    skipReason: null,
  };
}

function buildSkippedStep(args: {
  id: string;
  executionId: string;
  node: WorkflowNode;
  layer: number;
  reason: string;
}): ExecutionStep {
  return {
    id: args.id,
    executionId: args.executionId,
    nodeId: args.node.id,
    agentType: args.node.type,
    label: args.node.label,
    status: 'skipped',
    layer: args.layer,
    attempts: 0,
    retries: 0,
    startedAt: null,
    completedAt: null,
    durationMs: 0,
    systemPrompt: '',
    prompt: '',
    response: '',
    usage: EMPTY_USAGE,
    costUsd: 0,
    confidence: 0,
    provider: 'mock',
    model: '',
    error: null,
    skipReason: args.reason,
  };
}

/* -------------------------------------------------------------------------- */
/* Run status                                                                 */
/* -------------------------------------------------------------------------- */

function deriveStatus(steps: ExecutionStep[], cancelled: boolean): ExecutionStatus {
  if (cancelled) return 'cancelled';

  const succeeded = steps.filter((s) => s.status === 'success').length;
  const failed = steps.filter((s) => s.status === 'failed').length;

  if (failed === 0) return succeeded > 0 ? 'success' : 'failed';
  return succeeded > 0 ? 'partial' : 'failed';
}

function summariseError(steps: ExecutionStep[], status: ExecutionStatus): string | null {
  if (status === 'success') return null;

  const failures = steps.filter((s) => s.status === 'failed');
  if (failures.length === 0) {
    return status === 'cancelled' ? 'Run cancelled' : 'No node produced output';
  }

  const first = failures[0];
  const suffix = failures.length > 1 ? ` (+${failures.length - 1} more)` : '';
  return `${first?.label ?? 'A node'} failed: ${first?.error ?? 'unknown error'}${suffix}`;
}
