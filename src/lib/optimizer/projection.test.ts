import { describe, expect, it } from 'vitest';
import { nodeCostUsd, nodeLatencyMs, projectSerialLatencyMs, projectWorkflow } from './projection';
import { AGENT_DEFINITIONS } from '@/lib/agents/definitions';
import { edge, graph, node } from '@/test/fixtures';

describe('nodeLatencyMs', () => {
  it('uses the agent definition by default', () => {
    expect(nodeLatencyMs(node('a', 'planner'))).toBe(AGENT_DEFINITIONS.planner.estimatedLatencyMs);
  });

  it('scales linearly with a raised token budget', () => {
    const doubled = node('a', 'planner', { config: { maxTokens: AGENT_DEFINITIONS.planner.maxTokens * 2 } });

    expect(nodeLatencyMs(doubled)).toBe(AGENT_DEFINITIONS.planner.estimatedLatencyMs * 2);
  });

  it('floors the reduction so a tiny budget is not free', () => {
    // Generation is not the only cost — there is a fixed request overhead.
    const tiny = node('a', 'planner', { config: { maxTokens: 64 } });

    expect(nodeLatencyMs(tiny)).toBe(Math.round(AGENT_DEFINITIONS.planner.estimatedLatencyMs * 0.4));
  });
});

describe('nodeCostUsd', () => {
  it('uses the agent definition by default', () => {
    expect(nodeCostUsd(node('a', 'coder'))).toBeCloseTo(AGENT_DEFINITIONS.coder.estimatedCostUsd, 6);
  });

  it('scales with the token budget', () => {
    const doubled = node('a', 'coder', { config: { maxTokens: AGENT_DEFINITIONS.coder.maxTokens * 2 } });

    expect(nodeCostUsd(doubled)).toBeCloseTo(AGENT_DEFINITIONS.coder.estimatedCostUsd * 2, 6);
  });

  it('rates the clause-by-clause and code-writing agents as the priciest', () => {
    // The Legal Validator rule tells the user this agent is expensive, so the
    // pricing table had better agree. Coder edges it out; both sit at the top.
    const costs = Object.keys(AGENT_DEFINITIONS)
      .map((type) => nodeCostUsd(node('n', type as keyof typeof AGENT_DEFINITIONS)))
      .sort((a, b) => b - a);

    const legal = nodeCostUsd(node('n', 'legal_validator'));
    expect(legal).toBeGreaterThanOrEqual(costs[1]!);
    expect(nodeCostUsd(node('n', 'coder'))).toBe(costs[0]);
  });
});

describe('projectWorkflow', () => {
  it('returns zeroes for an empty graph', () => {
    const projection = projectWorkflow(graph([]));

    expect(projection.estimatedLatencyMs).toBe(0);
    expect(projection.estimatedCostUsd).toBe(0);
    expect(projection.nodeCount).toBe(0);
  });

  it('estimates a serial chain as the sum of its nodes', () => {
    const g = graph(
      [node('a', 'planner'), node('b', 'coder')],
      [edge('a', 'b')],
    );

    expect(projectWorkflow(g).estimatedLatencyMs).toBe(
      AGENT_DEFINITIONS.planner.estimatedLatencyMs + AGENT_DEFINITIONS.coder.estimatedLatencyMs,
    );
  });

  it('estimates a parallel branch as the critical path, not the sum', () => {
    // This is the whole point: parallelising must show up as a saving.
    const parallel = graph(
      [node('root', 'planner'), node('a', 'researcher'), node('b', 'retriever')],
      [edge('root', 'a'), edge('root', 'b')],
    );

    const serial = graph(
      [node('root', 'planner'), node('a', 'researcher'), node('b', 'retriever')],
      [edge('root', 'a'), edge('a', 'b')],
    );

    expect(projectWorkflow(parallel).estimatedLatencyMs).toBeLessThan(
      projectWorkflow(serial).estimatedLatencyMs,
    );
  });

  it('charges the same cost whether nodes run in parallel or not', () => {
    // Parallelism buys wall clock, never tokens.
    const parallel = graph(
      [node('root', 'planner'), node('a', 'researcher'), node('b', 'retriever')],
      [edge('root', 'a'), edge('root', 'b')],
    );
    const serial = graph(
      [node('root', 'planner'), node('a', 'researcher'), node('b', 'retriever')],
      [edge('root', 'a'), edge('a', 'b')],
    );

    expect(projectWorkflow(parallel).estimatedCostUsd).toBeCloseTo(
      projectWorkflow(serial).estimatedCostUsd,
      6,
    );
  });

  it('reports the graph shape alongside the estimates', () => {
    const g = graph(
      [node('root', 'planner'), node('a', 'coder'), node('b', 'tester')],
      [edge('root', 'a'), edge('root', 'b')],
    );

    const projection = projectWorkflow(g);

    expect(projection.nodeCount).toBe(3);
    expect(projection.edgeCount).toBe(2);
    expect(projection.layerCount).toBe(2);
    expect(projection.parallelizationScore).toBeGreaterThan(0);
  });

  it('falls back to a serial estimate for a cyclic graph rather than throwing', () => {
    const cyclic = graph([node('a', 'coder'), node('b', 'coder')], [edge('a', 'b'), edge('b', 'a')]);

    const projection = projectWorkflow(cyclic);

    expect(projection.estimatedLatencyMs).toBe(AGENT_DEFINITIONS.coder.estimatedLatencyMs * 2);
    expect(projection.nodeCount).toBe(2);
  });
});

describe('projectSerialLatencyMs', () => {
  it('ignores parallelism entirely — the pessimistic bound', () => {
    const parallel = graph(
      [node('root', 'planner'), node('a', 'researcher'), node('b', 'retriever')],
      [edge('root', 'a'), edge('root', 'b')],
    );

    const serialTotal =
      AGENT_DEFINITIONS.planner.estimatedLatencyMs +
      AGENT_DEFINITIONS.researcher.estimatedLatencyMs +
      AGENT_DEFINITIONS.retriever.estimatedLatencyMs;

    expect(projectSerialLatencyMs(parallel)).toBe(serialTotal);
    expect(projectWorkflow(parallel).estimatedLatencyMs).toBeLessThan(serialTotal);
  });

  it('is 0 for an empty graph', () => {
    expect(projectSerialLatencyMs(graph([]))).toBe(0);
  });
});
