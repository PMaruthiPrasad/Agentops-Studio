import { describe, expect, it } from 'vitest';
import {
  analyzeWorkflow,
  analyzeWorkflowSync,
  applyAutoFixes,
  applySelectedSuggestions,
  computeScore,
  gradeFor,
} from './analyzer';
import { runRules } from './rules';
import { validateGraph } from '@/lib/workflow/validate';
import type { OptimizationSuggestion, OptimizerContext } from '@/types/optimizer';
import type { WorkflowGraph } from '@/types/workflow';
import { edge, graph, node } from '@/test/fixtures';

function context(g: WorkflowGraph, overrides: Partial<OptimizerContext> = {}): OptimizerContext {
  return {
    graph: g,
    workflowName: overrides.workflowName ?? 'Untitled workflow',
    workflowDescription: overrides.workflowDescription ?? '',
    tags: overrides.tags ?? [],
  };
}

/** Planner → (researcher ‖ retriever) → coder. Nothing to complain about. */
const cleanGraph = () =>
  graph(
    [
      node('plan', 'planner'),
      node('research', 'researcher'),
      node('retrieve', 'retriever'),
      node('build', 'coder'),
    ],
    [edge('plan', 'research'), edge('plan', 'retrieve'), edge('research', 'build'), edge('retrieve', 'build')],
  );

/** Serial chain with a duplicated reviewer — several rules fire. */
const messyGraph = () =>
  graph(
    [
      node('research', 'researcher'),
      node('retrieve', 'retriever'),
      node('r1', 'reviewer'),
      node('r2', 'reviewer'),
      node('build', 'coder'),
    ],
    [edge('research', 'retrieve'), edge('retrieve', 'r1'), edge('r1', 'r2'), edge('r2', 'build')],
  );

function suggestion(overrides: Partial<OptimizationSuggestion> = {}): OptimizationSuggestion {
  return {
    id: overrides.id ?? 's1',
    ruleId: overrides.ruleId ?? 'duplicate-agent',
    title: 'title',
    description: 'description',
    reasoning: 'reasoning',
    severity: overrides.severity ?? 'medium',
    category: overrides.category ?? 'redundancy',
    affectedNodeIds: overrides.affectedNodeIds ?? [],
    estimatedLatencyReductionMs: overrides.estimatedLatencyReductionMs ?? 0,
    estimatedCostReductionUsd: overrides.estimatedCostReductionUsd ?? 0,
    autoFixable: overrides.autoFixable ?? false,
    ...(overrides.patch ? { patch: overrides.patch } : {}),
  };
}

describe('computeScore', () => {
  it('gives a clean workflow a perfect score', () => {
    expect(computeScore([])).toBe(100);
  });

  it('penalises by severity', () => {
    const critical = computeScore([suggestion({ severity: 'critical' })]);
    const low = computeScore([suggestion({ severity: 'low' })]);

    expect(critical).toBeLessThan(low);
    expect(low).toBeLessThan(100);
  });

  it('weights a penalty by how much the rule matters', () => {
    // orphaned-node carries weight 1.5; missing-planner only 0.8.
    const heavy = computeScore([suggestion({ ruleId: 'orphaned-node', severity: 'medium' })]);
    const light = computeScore([suggestion({ ruleId: 'missing-planner', severity: 'medium' })]);

    expect(heavy).toBeLessThan(light);
  });

  it('accumulates across findings', () => {
    const one = computeScore([suggestion({ id: 'a' })]);
    const two = computeScore([suggestion({ id: 'a' }), suggestion({ id: 'b' })]);

    expect(two).toBeLessThan(one);
  });

  it('never drops below zero', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      suggestion({ id: `s${i}`, severity: 'critical' }),
    );

    expect(computeScore(many)).toBe(0);
  });

  it('does not credit a workflow above 100', () => {
    expect(computeScore([])).toBeLessThanOrEqual(100);
  });
});

describe('gradeFor', () => {
  it.each([
    [100, 'A'],
    [90, 'A'],
    [89, 'B'],
    [78, 'B'],
    [77, 'C'],
    [64, 'C'],
    [63, 'D'],
    [50, 'D'],
    [49, 'F'],
    [0, 'F'],
  ])('grades %i as %s', (score, expected) => {
    expect(gradeFor(score)).toBe(expected);
  });
});

describe('analyzeWorkflowSync', () => {
  it('scores a clean workflow at 100 with an A', () => {
    const report = analyzeWorkflowSync(context(cleanGraph()));

    expect(report.score).toBe(100);
    expect(report.grade).toBe('A');
    expect(report.suggestions).toEqual([]);
    expect(report.summary).toContain('No issues found');
  });

  it('scores a messy workflow lower and explains why', () => {
    const report = analyzeWorkflowSync(context(messyGraph()));

    expect(report.score).toBeLessThan(100);
    expect(report.suggestions.length).toBeGreaterThan(0);
    expect(report.summary).toContain('finding');
    expect(report.summary).toContain(`Score ${report.score}/100`);
  });

  it('sorts suggestions by severity, worst first', () => {
    const report = analyzeWorkflowSync(context(messyGraph()));
    const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;

    const ranks = report.suggestions.map((s) => order[s.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('projects a real saving when a fix is available', () => {
    const report = analyzeWorkflowSync(context(messyGraph()));

    expect(report.baseline.estimatedLatencyMs).toBeGreaterThan(0);
    expect(report.projected.estimatedLatencyMs).toBeLessThan(report.baseline.estimatedLatencyMs);
    expect(report.estimatedLatencyReductionMs).toBeGreaterThan(0);
    expect(report.latencyReductionPct).toBeGreaterThan(0);
  });

  it('projects no saving for a workflow with nothing to fix', () => {
    const report = analyzeWorkflowSync(context(cleanGraph()));

    expect(report.estimatedLatencyReductionMs).toBe(0);
    expect(report.estimatedCostReductionUsd).toBe(0);
    expect(report.latencyReductionPct).toBe(0);
  });

  it('never reports a negative reduction', () => {
    const report = analyzeWorkflowSync(context(messyGraph()));

    expect(report.estimatedLatencyReductionMs).toBeGreaterThanOrEqual(0);
    expect(report.estimatedCostReductionUsd).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic — the same graph always scores the same', () => {
    const first = analyzeWorkflowSync(context(messyGraph()));
    const second = analyzeWorkflowSync(context(messyGraph()));

    expect(second.score).toBe(first.score);
    expect(second.suggestions.map((s) => s.id)).toEqual(first.suggestions.map((s) => s.id));
  });

  it('stamps the report with a generation time', () => {
    const report = analyzeWorkflowSync(context(cleanGraph()));

    expect(() => new Date(report.generatedAt).toISOString()).not.toThrow();
  });

  it('handles an empty graph without throwing', () => {
    const report = analyzeWorkflowSync(context(graph([])));

    expect(report.score).toBe(100);
    expect(report.baseline.nodeCount).toBe(0);
  });
});

describe('applyAutoFixes', () => {
  it('applies only the auto-fixable suggestions', () => {
    const g = messyGraph();
    const suggestions = runRules(context(g));
    const { graph: fixed, applied } = applyAutoFixes(g, suggestions);

    expect(applied.length).toBeGreaterThan(0);
    expect(applied.every((s) => s.autoFixable)).toBe(true);
    expect(fixed).not.toEqual(g);
  });

  it('leaves a valid graph behind', () => {
    const g = messyGraph();
    const { graph: fixed } = applyAutoFixes(g, runRules(context(g)));

    expect(validateGraph(fixed).valid).toBe(true);
  });

  it('is a no-op when nothing is auto-fixable', () => {
    const g = cleanGraph();
    const { graph: fixed, applied } = applyAutoFixes(g, []);

    expect(applied).toEqual([]);
    expect(fixed).toBe(g);
  });

  it('skips a patch that would empty the graph', () => {
    const g = graph([node('a', 'coder')]);
    const destructive = suggestion({
      autoFixable: true,
      patch: { removeNodeIds: ['a'] },
    });

    const { graph: fixed, applied } = applyAutoFixes(g, [destructive]);

    expect(applied).toEqual([]);
    expect(fixed.nodes).toHaveLength(1);
  });

  it('skips a patch that would introduce a cycle', () => {
    const g = graph([node('a', 'coder'), node('b', 'tester')], [edge('a', 'b')]);
    const cyclic = suggestion({
      autoFixable: true,
      patch: { addEdges: [{ id: 'bad', source: 'b', target: 'a', condition: { kind: 'always' } }] },
    });

    const { applied } = applyAutoFixes(g, [cyclic]);

    expect(applied).toEqual([]);
  });
});

describe('applySelectedSuggestions', () => {
  it('applies only what the user selected', () => {
    const g = messyGraph();
    const suggestions = runRules(context(g));
    const target = suggestions.find((s) => s.autoFixable)!;

    const result = applySelectedSuggestions(g, suggestions, [target.id]);

    expect(result.applied).toEqual([target.id]);
    expect(result.graph).not.toEqual(g);
  });

  it('reports an unknown id as skipped rather than losing it silently', () => {
    const g = messyGraph();
    const result = applySelectedSuggestions(g, runRules(context(g)), ['no-such-suggestion']);

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(['no-such-suggestion']);
  });

  it('skips a suggestion that carries no patch', () => {
    const g = graph([node('write', 'coder'), node('critique', 'critic')], [edge('write', 'critique')]);
    const suggestions = runRules(context(g));
    const manual = suggestions.find((s) => !s.patch)!;

    const result = applySelectedSuggestions(g, suggestions, [manual.id]);

    expect(result.skipped).toContain(manual.id);
    expect(result.graph).toEqual(g);
  });

  it('does not persist anything — it only returns a new graph', () => {
    const g = messyGraph();
    const before = JSON.stringify(g);
    const suggestions = runRules(context(g));

    applySelectedSuggestions(g, suggestions, suggestions.map((s) => s.id));

    expect(JSON.stringify(g)).toBe(before);
  });

  it('applies several suggestions in sequence and stays valid', () => {
    const g = messyGraph();
    const suggestions = runRules(context(g));

    const result = applySelectedSuggestions(
      g,
      suggestions,
      suggestions.filter((s) => s.autoFixable).map((s) => s.id),
    );

    expect(result.applied.length).toBeGreaterThan(0);
    expect(validateGraph(result.graph).valid).toBe(true);
  });

  it('accounts for every requested id in either applied or skipped', () => {
    const g = messyGraph();
    const suggestions = runRules(context(g));
    const requested = [...suggestions.map((s) => s.id), 'bogus'];

    const result = applySelectedSuggestions(g, suggestions, requested);

    expect([...result.applied, ...result.skipped].sort()).toEqual([...requested].sort());
  });
});

describe('analyzeWorkflow', () => {
  it('returns a deterministic narrative when the LLM summary is skipped', async () => {
    const report = await analyzeWorkflow(context(messyGraph()), { includeNarrative: false });

    expect(report.narrative).toBeTruthy();
    expect(typeof report.narrative).toBe('string');
  });

  it('includes an LLM narrative by default', async () => {
    // Runs on the mock provider — no API key, no network.
    const report = await analyzeWorkflow(context(cleanGraph()));

    expect(report.narrative.length).toBeGreaterThan(20);
    expect(report.score).toBe(100);
  });

  it('carries the full report shape through', async () => {
    const report = await analyzeWorkflow(context(messyGraph()), { includeNarrative: false });

    expect(report).toMatchObject({
      score: expect.any(Number),
      grade: expect.any(String),
      summary: expect.any(String),
      narrative: expect.any(String),
      suggestions: expect.any(Array),
      baseline: expect.objectContaining({ estimatedLatencyMs: expect.any(Number) }),
      projected: expect.objectContaining({ estimatedLatencyMs: expect.any(Number) }),
    });
  });
});
