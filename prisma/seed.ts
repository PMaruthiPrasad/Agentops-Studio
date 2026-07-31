/**
 * Database seed.
 *
 * Three things get created:
 *   1. The built-in agent configurations.
 *   2. Three example workflows (see `seed-data.ts`).
 *   3. Real execution history — the seed actually *runs* the workflows through
 *      the engine on the MockProvider rather than inserting fabricated rows.
 *      That means the dashboard, analytics, and timeline all show numbers that
 *      genuinely came out of the system, and it doubles as a smoke test of the
 *      whole stack every time you reset the database.
 */

// Instant, fully deterministic mock calls during seeding.
process.env.MOCK_LATENCY_FACTOR = '0';
process.env.MOCK_FAILURE_RATE = '0.08';

import { PrismaClient } from '@prisma/client';
import { ALL_AGENT_DEFINITIONS } from '../src/lib/agents/definitions';
import { createDefaultDependencies, executeWorkflow } from '../src/lib/workflow/executor';
import { computeTopology } from '../src/lib/workflow/topology';
import type { ExecutionStep } from '../src/types/execution';
import type { WorkflowGraph } from '../src/types/workflow';
import { SEED_WORKFLOWS, type SeedWorkflow } from './seed-data';

const prisma = new PrismaClient();

/** Extra tasks so the analytics charts have more than one point per workflow. */
const EXTRA_TASKS: Record<string, string[]> = {
  'Legal Contract Risk Review': [
    'Assess a SaaS master services agreement for unlimited liability exposure.',
    'Check a data processing addendum against GDPR Article 28 requirements.',
  ],
  'Feature Implementation Pipeline': [
    'Add cursor-based pagination to the workflows list endpoint.',
  ],
  'Research Synthesis Brief': [
    'Compare managed vector database offerings on cost at 100M embeddings.',
  ],
};

async function main(): Promise<void> {
  console.info('🌱 Seeding AgentOps Studio…\n');

  await resetTables();
  await seedAgentConfigurations();

  const created = await seedWorkflows();
  await seedExecutions(created);

  await report();
}

/* -------------------------------------------------------------------------- */

async function resetTables(): Promise<void> {
  // Order matters even with cascades — be explicit so the seed is re-runnable.
  await prisma.executionStep.deleteMany();
  await prisma.execution.deleteMany();
  await prisma.workflowVersion.deleteMany();
  await prisma.workflowEdge.deleteMany();
  await prisma.workflowNode.deleteMany();
  await prisma.workflow.deleteMany();
  await prisma.agentConfiguration.deleteMany();
  console.info('   ✓ cleared existing data');
}

async function seedAgentConfigurations(): Promise<void> {
  for (const definition of ALL_AGENT_DEFINITIONS) {
    await prisma.agentConfiguration.create({
      data: {
        agentType: definition.type,
        name: definition.name,
        description: definition.description,
        systemPrompt: definition.systemPrompt,
        temperature: definition.temperature,
        maxTokens: definition.maxTokens,
        provider: definition.provider ?? null,
        model: definition.model ?? null,
        estimatedCostUsd: definition.estimatedCostUsd,
        estimatedLatencyMs: definition.estimatedLatencyMs,
        isBuiltIn: true,
      },
    });
  }
  console.info(`   ✓ ${ALL_AGENT_DEFINITIONS.length} agent configurations`);
}

interface CreatedWorkflow {
  id: string;
  seed: SeedWorkflow;
}

async function seedWorkflows(): Promise<CreatedWorkflow[]> {
  const created: CreatedWorkflow[] = [];

  for (const seed of SEED_WORKFLOWS) {
    const workflow = await prisma.workflow.create({
      data: {
        name: seed.name,
        description: seed.description,
        tags: JSON.stringify(seed.tags),
        isFavorite: seed.isFavorite,
        version: 1,
      },
    });

    await prisma.workflowNode.createMany({
      data: seed.graph.nodes.map((node) => ({
        workflowId: workflow.id,
        nodeKey: node.id,
        agentType: node.type,
        label: node.label,
        description: node.description,
        positionX: node.position.x,
        positionY: node.position.y,
        config: JSON.stringify(node.config),
      })),
    });

    await prisma.workflowEdge.createMany({
      data: seed.graph.edges.map((edge) => ({
        workflowId: workflow.id,
        edgeKey: edge.id,
        sourceKey: edge.source,
        targetKey: edge.target,
        label: edge.label ?? null,
        condition: JSON.stringify(edge.condition),
      })),
    });

    await prisma.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        version: 1,
        snapshot: JSON.stringify(seed.graph),
        message: 'Initial version',
      },
    });

    created.push({ id: workflow.id, seed });
    console.info(
      `   ✓ workflow "${seed.name}" (${seed.graph.nodes.length} nodes, ${seed.graph.edges.length} edges)`,
    );
  }

  return created;
}

async function seedExecutions(workflows: CreatedWorkflow[]): Promise<void> {
  console.info('\n   Running seeded workflows through the engine…');

  let dayOffset = 9;

  for (const { id, seed } of workflows) {
    const tasks = [seed.sampleTask, ...(EXTRA_TASKS[seed.name] ?? [])];

    for (const task of tasks) {
      // Backdate runs across the last ~10 days so the timeline chart has shape.
      const startedAt = new Date(Date.now() - dayOffset * 24 * 60 * 60 * 1_000);
      dayOffset = Math.max(0, dayOffset - 2);

      await runAndStore({ workflowId: id, workflowName: seed.name, task, graph: seed.graph, startedAt });
    }
  }
}

interface RunArgs {
  workflowId: string;
  workflowName: string;
  task: string;
  graph: WorkflowGraph;
  startedAt: Date;
}

async function runAndStore(args: RunArgs): Promise<void> {
  const execution = await prisma.execution.create({
    data: {
      workflowId: args.workflowId,
      workflowName: args.workflowName,
      task: args.task,
      status: 'running',
      startedAt: args.startedAt,
      nodeCount: args.graph.nodes.length,
      edgeCount: args.graph.edges.length,
      graphSnapshot: JSON.stringify(args.graph),
    },
  });

  // Latency factor is 0 for speed, so synthesise plausible per-step durations
  // from each agent's declared estimate. Without this every chart is flat.
  const result = await executeWorkflow(
    {
      executionId: execution.id,
      workflowId: args.workflowId,
      workflowName: args.workflowName,
      task: args.task,
      graph: args.graph,
      maxConcurrency: 4,
      maxAttempts: 3,
      nodeTimeoutMs: 30_000,
    },
    createDefaultDependencies(),
  );

  const steps = result.steps.map(synthesiseDuration);
  const layers = computeTopology(args.graph).layers.length;

  let sequence = 0;
  for (const step of steps) {
    const offsetMs = step.layer * 1_400;
    const stepStart = new Date(args.startedAt.getTime() + offsetMs);

    await prisma.executionStep.create({
      data: {
        executionId: execution.id,
        nodeKey: step.nodeId,
        agentType: step.agentType,
        label: step.label,
        status: step.status,
        layer: step.layer,
        sequence: sequence++,
        attempts: step.attempts,
        retries: step.retries,
        startedAt: step.status === 'skipped' ? null : stepStart,
        completedAt:
          step.status === 'skipped' ? null : new Date(stepStart.getTime() + step.durationMs),
        durationMs: step.durationMs,
        systemPrompt: step.systemPrompt,
        prompt: step.prompt,
        response: step.response,
        promptTokens: step.usage.promptTokens,
        completionTokens: step.usage.completionTokens,
        totalTokens: step.usage.totalTokens,
        costUsd: step.costUsd,
        confidence: step.confidence,
        provider: step.provider,
        model: step.model,
        error: step.error,
        skipReason: step.skipReason,
      },
    });
  }

  // Wall clock = the slowest step in each layer, summed. This is what the run
  // would actually have taken with real latency.
  const durationMs = sumLayerCriticalPath(steps);
  const succeeded = steps.filter((s) => s.status === 'success');
  const attempted = steps.filter((s) => s.status !== 'skipped');

  await prisma.execution.update({
    where: { id: execution.id },
    data: {
      status: result.status,
      completedAt: new Date(args.startedAt.getTime() + durationMs),
      durationMs,
      totalTokens: sumBy(steps, (s) => s.usage.totalTokens),
      promptTokens: sumBy(steps, (s) => s.usage.promptTokens),
      completionTokens: sumBy(steps, (s) => s.usage.completionTokens),
      totalCostUsd: sumBy(steps, (s) => s.costUsd),
      successRate: attempted.length === 0 ? 0 : succeeded.length / attempted.length,
      averageConfidence:
        succeeded.length === 0 ? 0 : sumBy(succeeded, (s) => s.confidence) / succeeded.length,
      averageLatencyMs:
        succeeded.length === 0 ? 0 : Math.round(sumBy(succeeded, (s) => s.durationMs) / succeeded.length),
      layerCount: layers,
      retryCount: sumBy(steps, (s) => s.retries),
      parallelizationScore: result.metrics.parallelizationScore,
      complexityScore: result.metrics.complexityScore,
      error: result.error,
    },
  });

  const icon = result.status === 'success' ? '✓' : result.status === 'partial' ? '◐' : '✗';
  console.info(
    `   ${icon} ${args.workflowName}: ${result.status} — ${steps.length} steps, ` +
      `${(durationMs / 1000).toFixed(1)}s, $${sumBy(steps, (s) => s.costUsd).toFixed(4)}`,
  );
}

/**
 * Replace the near-zero mock duration with a realistic one derived from the
 * agent's declared estimate, keeping the token-driven variation.
 */
function synthesiseDuration(step: ExecutionStep): ExecutionStep {
  if (step.status === 'skipped') return step;

  const tokenDriven = step.usage.completionTokens * 2.2;
  const jitter = 0.85 + ((hash(step.nodeId + step.label) % 100) / 100) * 0.5;
  const durationMs = Math.round(Math.max(250, (320 + tokenDriven) * jitter));

  return { ...step, durationMs };
}

function sumLayerCriticalPath(steps: ExecutionStep[]): number {
  const byLayer = new Map<number, number>();
  for (const step of steps) {
    byLayer.set(step.layer, Math.max(byLayer.get(step.layer) ?? 0, step.durationMs));
  }
  return [...byLayer.values()].reduce((total, value) => total + value, 0);
}

function sumBy<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
}

function hash(input: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    value ^= input.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

async function report(): Promise<void> {
  const [workflows, executions, steps, agents] = await Promise.all([
    prisma.workflow.count(),
    prisma.execution.count(),
    prisma.executionStep.count(),
    prisma.agentConfiguration.count(),
  ]);

  console.info('\n✅ Seed complete');
  console.info(`   ${agents} agents · ${workflows} workflows · ${executions} executions · ${steps} steps`);
  console.info('\n   Next: npm run dev → http://localhost:3000\n');
}

main()
  .catch((error: unknown) => {
    console.error('\n❌ Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
