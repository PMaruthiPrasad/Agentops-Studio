import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AGENT_DEFINITIONS } from '@/lib/agents/definitions';
import { agentTypeSchema, type AgentType } from '@/types/agent';
import type {
  AgentPerformance,
  AnalyticsOverview,
  AnalyticsPayload,
  ExecutionStatus,
  TimelinePoint,
} from '@/types/execution';
import type { AnalyticsQuery } from '@/types/api';
import { toExecutionSummary } from './mappers';

/**
 * Analytics aggregation.
 *
 * All of it happens here rather than in the chart components — a Recharts
 * `<Bar>` should receive numbers, not compute them. That also means the same
 * figures are available to the API, to tests, and to any future export.
 */

export async function getAnalytics(query: AnalyticsQuery): Promise<AnalyticsPayload> {
  const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1_000);

  const executionWhere: Prisma.ExecutionWhereInput = {
    startedAt: { gte: since },
    ...(query.workflowId ? { workflowId: query.workflowId } : {}),
  };

  const [workflowCount, executions, steps, recentRows] = await Promise.all([
    prisma.workflow.count(),
    prisma.execution.findMany({
      where: executionWhere,
      orderBy: { startedAt: 'asc' },
    }),
    prisma.executionStep.findMany({
      where: { execution: executionWhere },
      select: {
        agentType: true,
        status: true,
        durationMs: true,
        costUsd: true,
        totalTokens: true,
        confidence: true,
      },
    }),
    prisma.execution.findMany({
      where: query.workflowId ? { workflowId: query.workflowId } : {},
      include: { _count: { select: { steps: true } } },
      orderBy: { startedAt: 'desc' },
      take: 8,
    }),
  ]);

  return {
    overview: buildOverview(workflowCount, executions, steps.length),
    agents: buildAgentPerformance(steps),
    timeline: buildTimeline(executions, query.days),
    recentExecutions: recentRows.map(toExecutionSummary),
    statusBreakdown: buildStatusBreakdown(executions),
  };
}

type ExecutionRow = Awaited<ReturnType<typeof prisma.execution.findMany>>[number];
type StepSlice = {
  agentType: string;
  status: string;
  durationMs: number;
  costUsd: number;
  totalTokens: number;
  confidence: number;
};

function buildOverview(
  workflowCount: number,
  executions: ExecutionRow[],
  stepCount: number,
): AnalyticsOverview {
  // Only completed runs contribute to averages; a run still in flight would
  // drag every metric toward zero and make the dashboard lie.
  const completed = executions.filter((e) => e.status !== 'running' && e.status !== 'pending');

  return {
    workflowCount,
    executionCount: executions.length,
    stepCount,
    totalCostUsd: round(sumBy(executions, (e) => e.totalCostUsd), 6),
    totalTokens: sumBy(executions, (e) => e.totalTokens),
    averageLatencyMs: Math.round(meanBy(completed, (e) => e.durationMs)),
    averageCostUsd: round(meanBy(completed, (e) => e.totalCostUsd), 6),
    averageConfidence: round(meanBy(completed, (e) => e.averageConfidence), 4),
    successRate: round(meanBy(completed, (e) => e.successRate), 4),
    averageComplexity: round(meanBy(completed, (e) => e.complexityScore), 3),
    averageParallelization: round(meanBy(completed, (e) => e.parallelizationScore), 3),
    averageAgentCount: round(meanBy(completed, (e) => e.nodeCount), 1),
  };
}

function buildAgentPerformance(steps: StepSlice[]): AgentPerformance[] {
  const grouped = new Map<AgentType, StepSlice[]>();

  for (const step of steps) {
    // Skipped steps did no work; including them would flatten every average.
    if (step.status === 'skipped') continue;

    const parsed = agentTypeSchema.safeParse(step.agentType);
    const type: AgentType = parsed.success ? parsed.data : 'custom';

    const bucket = grouped.get(type);
    if (bucket) bucket.push(step);
    else grouped.set(type, [step]);
  }

  return [...grouped.entries()]
    .map(([agentType, bucket]) => {
      const succeeded = bucket.filter((s) => s.status === 'success');
      return {
        agentType,
        label: AGENT_DEFINITIONS[agentType]?.name ?? agentType,
        runs: bucket.length,
        averageLatencyMs: Math.round(meanBy(bucket, (s) => s.durationMs)),
        totalCostUsd: round(sumBy(bucket, (s) => s.costUsd), 6),
        averageCostUsd: round(meanBy(bucket, (s) => s.costUsd), 6),
        totalTokens: sumBy(bucket, (s) => s.totalTokens),
        successRate: bucket.length === 0 ? 0 : round(succeeded.length / bucket.length, 4),
        averageConfidence: round(meanBy(succeeded, (s) => s.confidence), 4),
      } satisfies AgentPerformance;
    })
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

function buildTimeline(executions: ExecutionRow[], days: number): TimelinePoint[] {
  const buckets = new Map<string, ExecutionRow[]>();

  // Pre-seed every day in the window so the chart has a continuous x-axis
  // instead of collapsing gaps and implying activity that didn't happen.
  const dayCount = Math.min(days, 90);
  for (let i = dayCount - 1; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1_000);
    buckets.set(toDateKey(date), []);
  }

  for (const execution of executions) {
    const key = toDateKey(execution.startedAt);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(execution);
  }

  return [...buckets.entries()].map(([date, rows]) => ({
    date,
    executions: rows.length,
    averageLatencyMs: Math.round(meanBy(rows, (r) => r.durationMs)),
    totalCostUsd: round(sumBy(rows, (r) => r.totalCostUsd), 6),
    totalTokens: sumBy(rows, (r) => r.totalTokens),
    successRate: round(meanBy(rows, (r) => r.successRate), 4),
  }));
}

function buildStatusBreakdown(
  executions: ExecutionRow[],
): Array<{ status: ExecutionStatus; count: number }> {
  const counts = new Map<string, number>();
  for (const execution of executions) {
    counts.set(execution.status, (counts.get(execution.status) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([status, count]) => ({ status: status as ExecutionStatus, count }))
    .sort((a, b) => b.count - a.count);
}

/* -------------------------------------------------------------------------- */

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sumBy<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
}

function meanBy<T>(items: T[], selector: (item: T) => number): number {
  if (items.length === 0) return 0;
  return sumBy(items, selector) / items.length;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
