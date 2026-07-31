import { describe, expect, it } from 'vitest';
import { getRule, OPTIMIZER_RULES, runRules } from './rules';
import { applyPatch } from '@/lib/workflow/graph-utils';
import { findCycle, validateGraph } from '@/lib/workflow/validate';
import type { OptimizationSuggestion, OptimizerContext } from '@/types/optimizer';
import type { WorkflowGraph } from '@/types/workflow';
import { edge, graph, node } from '@/test/fixtures';

/**
 * Rule tests.
 *
 * Each rule gets two cases at minimum: a graph that violates it (the rule
 * fires) and a graph that does not (the rule stays quiet). A rule that fires on
 * everything is as useless as one that never fires.
 */
function context(g: WorkflowGraph, overrides: Partial<OptimizerContext> = {}): OptimizerContext {
  return {
    graph: g,
    workflowName: overrides.workflowName ?? 'Untitled workflow',
    workflowDescription: overrides.workflowDescription ?? '',
    tags: overrides.tags ?? [],
  };
}

const idsOf = (suggestions: OptimizationSuggestion[]) => suggestions.map((s) => s.ruleId);
const firedBy = (suggestions: OptimizationSuggestion[], ruleId: string) =>
  suggestions.filter((s) => s.ruleId === ruleId);

describe('rule registry', () => {
  it('exposes every rule with a unique id and a positive weight', () => {
    const ids = OPTIMIZER_RULES.map((rule) => rule.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(OPTIMIZER_RULES.every((rule) => rule.weight > 0)).toBe(true);
  });

  it('looks a rule up by id', () => {
    expect(getRule('duplicate-agent')?.title).toBe('Remove duplicate agents');
    expect(getRule('does-not-exist')).toBeUndefined();
  });

  it('finds nothing wrong with a clean graph', () => {
    // Planner → (researcher ‖ retriever) → coder: parallel, no duplicates,
    // no orphans, has a planner.
    const clean = graph(
      [
        node('plan', 'planner'),
        node('research', 'researcher'),
        node('retrieve', 'retriever'),
        node('build', 'coder'),
      ],
      [
        edge('plan', 'research'),
        edge('plan', 'retrieve'),
        edge('research', 'build'),
        edge('retrieve', 'build'),
      ],
    );

    expect(runRules(context(clean))).toEqual([]);
  });

  it('survives a malformed graph instead of taking the report down', () => {
    const cyclic = graph([node('a', 'coder'), node('b', 'coder')], [edge('a', 'b'), edge('b', 'a')]);

    expect(() => runRules(context(cyclic))).not.toThrow();
  });
});

describe('parallelize-independent-research', () => {
  const chained = () =>
    graph(
      [node('research', 'researcher'), node('retrieve', 'retriever')],
      [edge('research', 'retrieve')],
    );

  it('fires when two knowledge-gathering agents are chained', () => {
    const fired = firedBy(runRules(context(chained())), 'parallelize-independent-research');

    expect(fired).toHaveLength(1);
    expect(fired[0]!.severity).toBe('high');
    expect(fired[0]!.estimatedLatencyReductionMs).toBeGreaterThan(0);
    expect(fired[0]!.affectedNodeIds).toEqual(['research', 'retrieve']);
  });

  it('stays quiet when a knowledge agent feeds a consumer that needs it', () => {
    const g = graph(
      [node('research', 'researcher'), node('write', 'coder')],
      [edge('research', 'write')],
    );

    expect(firedBy(runRules(context(g)), 'parallelize-independent-research')).toHaveLength(0);
  });

  it('stays quiet when the target has another genuine dependency', () => {
    // retrieve also depends on the planner, so it cannot simply move earlier.
    const g = graph(
      [node('plan', 'planner'), node('research', 'researcher'), node('retrieve', 'retriever')],
      [edge('research', 'retrieve'), edge('plan', 'retrieve')],
    );

    expect(firedBy(runRules(context(g)), 'parallelize-independent-research')).toHaveLength(0);
  });

  it('stays quiet when the edge is conditional — the branch is deliberate', () => {
    const g = graph(
      [node('research', 'researcher'), node('retrieve', 'retriever')],
      [
        edge('research', 'retrieve', {
          kind: 'expression',
          field: 'confidence',
          operator: 'lt',
          value: 0.5,
        }),
      ],
    );

    expect(firedBy(runRules(context(g)), 'parallelize-independent-research')).toHaveLength(0);
  });

  it('produces a patch that actually parallelises the pair', () => {
    const g = graph(
      [node('plan', 'planner'), node('research', 'researcher'), node('retrieve', 'retriever')],
      [edge('plan', 'research'), edge('research', 'retrieve')],
    );

    const suggestion = firedBy(runRules(context(g)), 'parallelize-independent-research')[0]!;
    const patched = applyPatch(g, suggestion.patch!);

    // retrieve now hangs off the planner, same as research.
    expect(patched.edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
      'plan->research',
      'plan->retrieve',
    ]);
    expect(validateGraph(patched).valid).toBe(true);
  });
});

describe('duplicate-agent', () => {
  it('fires on a second reviewer', () => {
    const g = graph(
      [node('r1', 'reviewer'), node('r2', 'reviewer'), node('code', 'coder')],
      [edge('code', 'r1'), edge('r1', 'r2')],
    );

    const fired = firedBy(runRules(context(g)), 'duplicate-agent');

    expect(fired).toHaveLength(1);
    expect(fired[0]!.severity).toBe('medium');
    expect(fired[0]!.estimatedCostReductionUsd).toBeGreaterThan(0);
  });

  it.each(['planner', 'reviewer', 'critic', 'legal_validator'] as const)(
    'treats a second %s as redundant',
    (type) => {
      const g = graph([node('a', type), node('b', type)], [edge('a', 'b')]);

      expect(firedBy(runRules(context(g)), 'duplicate-agent').length).toBeGreaterThan(0);
    },
  );

  it.each(['coder', 'researcher', 'retriever', 'tester'] as const)(
    'allows two %s agents — parallel workers are legitimate',
    (type) => {
      const g = graph([node('a', type), node('b', type), node('root', 'planner')], [
        edge('root', 'a'),
        edge('root', 'b'),
      ]);

      expect(firedBy(runRules(context(g)), 'duplicate-agent')).toHaveLength(0);
    },
  );

  it('rewires the duplicate connections onto the node it keeps', () => {
    const g = graph(
      [node('code', 'coder'), node('r1', 'reviewer'), node('r2', 'reviewer'), node('ship', 'custom')],
      [edge('code', 'r1'), edge('code', 'r2'), edge('r2', 'ship')],
    );

    const suggestion = firedBy(runRules(context(g)), 'duplicate-agent')[0]!;
    const patched = applyPatch(g, suggestion.patch!);

    expect(patched.nodes.map((n) => n.id)).not.toContain('r2');
    // ship must still be reachable — it now hangs off the surviving reviewer.
    expect(patched.edges.some((e) => e.source === 'r1' && e.target === 'ship')).toBe(true);
    expect(validateGraph(patched).valid).toBe(true);
  });
});

describe('reviewer-after-tester', () => {
  it('fires when a reviewer feeds a tester', () => {
    const g = graph(
      [node('code', 'coder'), node('review', 'reviewer'), node('test', 'tester')],
      [edge('code', 'review'), edge('review', 'test')],
    );

    const fired = firedBy(runRules(context(g)), 'reviewer-after-tester');

    expect(fired).toHaveLength(1);
    expect(fired[0]!.category).toBe('ordering');
  });

  it('stays quiet in the correct order', () => {
    const g = graph(
      [node('code', 'coder'), node('test', 'tester'), node('review', 'reviewer')],
      [edge('code', 'test'), edge('test', 'review')],
    );

    expect(firedBy(runRules(context(g)), 'reviewer-after-tester')).toHaveLength(0);
  });

  it('swaps the pair without breaking the graph', () => {
    const g = graph(
      [node('code', 'coder'), node('review', 'reviewer'), node('test', 'tester')],
      [edge('code', 'review'), edge('review', 'test')],
    );

    const suggestion = firedBy(runRules(context(g)), 'reviewer-after-tester')[0]!;
    const patched = applyPatch(g, suggestion.patch!);

    expect(patched.edges.some((e) => e.source === 'test' && e.target === 'review')).toBe(true);
    expect(findCycle(patched)).toBeNull();
    expect(validateGraph(patched).valid).toBe(true);
  });
});

describe('legal-validator-relevance', () => {
  const codingGraph = () =>
    graph(
      [node('build', 'coder'), node('check', 'legal_validator')],
      [edge('build', 'check')],
    );

  it('fires when nothing in the workflow mentions anything legal', () => {
    const fired = firedBy(
      runRules(context(codingGraph(), { workflowName: 'Build a feature' })),
      'legal-validator-relevance',
    );

    expect(fired).toHaveLength(1);
    expect(fired[0]!.estimatedCostReductionUsd).toBeGreaterThan(0);
  });

  it.each([
    ['name', { workflowName: 'Contract review' }],
    ['description', { workflowDescription: 'Check the licence terms' }],
    ['tags', { tags: ['compliance'] }],
  ])('stays quiet when the %s carries a legal signal', (_label, overrides) => {
    const fired = firedBy(
      runRules(context(codingGraph(), overrides)),
      'legal-validator-relevance',
    );

    expect(fired).toHaveLength(0);
  });

  it('stays quiet when another node mentions a legal concept', () => {
    const g = graph(
      [
        node('read', 'retriever', { label: 'Load the agreement' }),
        node('check', 'legal_validator'),
      ],
      [edge('read', 'check')],
    );

    expect(firedBy(runRules(context(g)), 'legal-validator-relevance')).toHaveLength(0);
  });

  it('stays quiet when there is no Legal Validator at all', () => {
    const g = graph([node('build', 'coder')]);

    expect(firedBy(runRules(context(g)), 'legal-validator-relevance')).toHaveLength(0);
  });

  it('bridges around the node it removes', () => {
    const g = graph(
      [node('build', 'coder'), node('check', 'legal_validator'), node('ship', 'custom')],
      [edge('build', 'check'), edge('check', 'ship')],
    );

    const suggestion = firedBy(
      runRules(context(g, { workflowName: 'Ship a feature' })),
      'legal-validator-relevance',
    )[0]!;
    const patched = applyPatch(g, suggestion.patch!);

    expect(patched.nodes.map((n) => n.id)).toEqual(['build', 'ship']);
    expect(patched.edges.some((e) => e.source === 'build' && e.target === 'ship')).toBe(true);
  });
});

describe('critic-before-synthesis', () => {
  it('fires when the critic runs alongside the real deliverable', () => {
    const g = graph(
      [node('plan', 'planner'), node('write', 'coder'), node('critique', 'critic')],
      [edge('plan', 'write'), edge('plan', 'critique')],
    );

    const fired = firedBy(runRules(context(g)), 'critic-before-synthesis');

    expect(fired).toHaveLength(1);
    expect(fired[0]!.autoFixable).toBe(true);
  });

  it('fires — without an auto-fix — when the critic is the only output', () => {
    const g = graph(
      [node('write', 'coder'), node('critique', 'critic')],
      [edge('write', 'critique')],
    );

    const fired = firedBy(runRules(context(g)), 'critic-before-synthesis');

    expect(fired).toHaveLength(1);
    // There is no correct automatic fix — the user must decide what consumes it.
    expect(fired[0]!.autoFixable).toBe(false);
    expect(fired[0]!.patch).toBeUndefined();
  });

  it('stays quiet when the critic already feeds a synthesis step', () => {
    const g = graph(
      [node('write', 'coder'), node('critique', 'critic'), node('final', 'custom')],
      [edge('write', 'critique'), edge('critique', 'final')],
    );

    expect(firedBy(runRules(context(g)), 'critic-before-synthesis')).toHaveLength(0);
  });

  it('connects the critic into the deliverable without creating a cycle', () => {
    const g = graph(
      [node('plan', 'planner'), node('write', 'coder'), node('critique', 'critic')],
      [edge('plan', 'write'), edge('plan', 'critique')],
    );

    const suggestion = firedBy(runRules(context(g)), 'critic-before-synthesis')[0]!;
    const patched = applyPatch(g, suggestion.patch!);

    expect(patched.edges.some((e) => e.source === 'critique' && e.target === 'write')).toBe(true);
    expect(findCycle(patched)).toBeNull();
  });
});

describe('long-serial-chain', () => {
  it('fires on a 6-node chain with no parallelism', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const g = graph(
      ids.map((id) => node(id, 'custom')),
      ids.slice(1).map((id, i) => edge(ids[i]!, id)),
    );

    const fired = firedBy(runRules(context(g)), 'long-serial-chain');

    expect(fired).toHaveLength(1);
    expect(fired[0]!.severity).toBe('low');
    expect(fired[0]!.autoFixable).toBe(false);
  });

  it('stays quiet on a small graph', () => {
    const g = graph([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c')]);

    expect(firedBy(runRules(context(g)), 'long-serial-chain')).toHaveLength(0);
  });

  it('stays quiet when the graph is well parallelised', () => {
    const g = graph(
      [node('root', 'planner'), node('a'), node('b'), node('c'), node('d')],
      [edge('root', 'a'), edge('root', 'b'), edge('root', 'c'), edge('root', 'd')],
    );

    expect(firedBy(runRules(context(g)), 'long-serial-chain')).toHaveLength(0);
  });
});

describe('missing-planner', () => {
  it('fires on a large graph with no planner', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const g = graph(
      ids.map((id) => node(id, 'coder')),
      ids.slice(1).map((id, i) => edge(ids[i]!, id)),
    );

    expect(firedBy(runRules(context(g)), 'missing-planner')).toHaveLength(1);
  });

  it('stays quiet once a planner is present', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const g = graph(
      [node('plan', 'planner'), ...ids.map((id) => node(id, 'coder'))],
      ids.map((id) => edge('plan', id)),
    );

    expect(firedBy(runRules(context(g)), 'missing-planner')).toHaveLength(0);
  });

  it('stays quiet on a small graph that does not need one', () => {
    const g = graph([node('a', 'coder'), node('b', 'tester')], [edge('a', 'b')]);

    expect(firedBy(runRules(context(g)), 'missing-planner')).toHaveLength(0);
  });
});

describe('excessive-token-budget', () => {
  it('fires when a node doubles its agent default', () => {
    // Planner defaults to 1,400 tokens.
    const g = graph([node('plan', 'planner', { config: { maxTokens: 2_800 } })]);

    const fired = firedBy(runRules(context(g)), 'excessive-token-budget');

    expect(fired).toHaveLength(1);
    expect(fired[0]!.severity).toBe('low');
    expect(fired[0]!.autoFixable).toBe(true);
  });

  it('escalates to medium at 4× the default', () => {
    const g = graph([node('plan', 'planner', { config: { maxTokens: 5_600 } })]);

    expect(firedBy(runRules(context(g)), 'excessive-token-budget')[0]!.severity).toBe('medium');
  });

  it('stays quiet just under the threshold', () => {
    const g = graph([node('plan', 'planner', { config: { maxTokens: 2_500 } })]);

    expect(firedBy(runRules(context(g)), 'excessive-token-budget')).toHaveLength(0);
  });

  it('stays quiet when the node inherits the default', () => {
    const g = graph([node('plan', 'planner')]);

    expect(firedBy(runRules(context(g)), 'excessive-token-budget')).toHaveLength(0);
  });

  it('resets the budget to the agent default', () => {
    const g = graph([node('plan', 'planner', { config: { maxTokens: 8_000, temperature: 0.9 } })]);

    const suggestion = firedBy(runRules(context(g)), 'excessive-token-budget')[0]!;
    const patched = applyPatch(g, suggestion.patch!);

    expect(patched.nodes[0]!.config.maxTokens).toBe(1_400);
    // Unrelated overrides survive the fix.
    expect(patched.nodes[0]!.config.temperature).toBe(0.9);
  });
});

describe('orphaned-node', () => {
  it('fires on a node with no edges at all', () => {
    const g = graph([node('a', 'coder'), node('b', 'tester'), node('lonely', 'critic')], [
      edge('a', 'b'),
    ]);

    const fired = firedBy(runRules(context(g)), 'orphaned-node');

    expect(fired).toHaveLength(1);
    expect(fired[0]!.affectedNodeIds).toEqual(['lonely']);
    expect(fired[0]!.estimatedCostReductionUsd).toBeGreaterThan(0);
  });

  it('escalates severity with the number of orphans', () => {
    const g = graph(
      [node('a', 'coder'), node('b', 'tester'), node('x'), node('y'), node('z')],
      [edge('a', 'b')],
    );

    expect(firedBy(runRules(context(g)), 'orphaned-node')[0]!.severity).toBe('high');
  });

  it('stays quiet when everything is connected', () => {
    const g = graph([node('a', 'coder'), node('b', 'tester')], [edge('a', 'b')]);

    expect(firedBy(runRules(context(g)), 'orphaned-node')).toHaveLength(0);
  });

  it('stays quiet for a single-node graph — one node cannot be disconnected', () => {
    expect(firedBy(runRules(context(graph([node('only')]))), 'orphaned-node')).toHaveLength(0);
  });

  it('removes the orphans and leaves a valid graph', () => {
    const g = graph([node('a', 'coder'), node('b', 'tester'), node('lonely')], [edge('a', 'b')]);

    const suggestion = firedBy(runRules(context(g)), 'orphaned-node')[0]!;
    const patched = applyPatch(g, suggestion.patch!);

    expect(patched.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(validateGraph(patched).valid).toBe(true);
  });
});

describe('suggestion shape', () => {
  it('gives every suggestion the fields the UI renders', () => {
    const messy = graph(
      [
        node('r1', 'reviewer'),
        node('r2', 'reviewer'),
        node('code', 'coder'),
        node('lonely', 'critic'),
      ],
      [edge('code', 'r1'), edge('r1', 'r2')],
    );

    const suggestions = runRules(context(messy));
    expect(suggestions.length).toBeGreaterThan(0);

    for (const suggestion of suggestions) {
      expect(suggestion.id).toBeTruthy();
      expect(suggestion.title).toBeTruthy();
      expect(suggestion.description).toBeTruthy();
      // Reasoning is shown verbatim, so it must actually explain something.
      expect(suggestion.reasoning.length).toBeGreaterThan(60);
      expect(suggestion.affectedNodeIds.length).toBeGreaterThan(0);
      expect(suggestion.estimatedLatencyReductionMs).toBeGreaterThanOrEqual(0);
      expect(suggestion.estimatedCostReductionUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives every suggestion a unique id', () => {
    const messy = graph(
      [node('r1', 'reviewer'), node('r2', 'reviewer'), node('r3', 'reviewer')],
      [edge('r1', 'r2'), edge('r2', 'r3')],
    );

    const ids = runRules(context(messy)).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never marks a patch auto-fixable if applying it would break the graph', () => {
    const messy = graph(
      [node('r1', 'reviewer'), node('r2', 'reviewer'), node('code', 'coder')],
      [edge('code', 'r1'), edge('r1', 'r2')],
    );

    for (const suggestion of runRules(context(messy))) {
      if (!suggestion.autoFixable || !suggestion.patch) continue;
      const patched = applyPatch(messy, suggestion.patch);
      expect(findCycle(patched)).toBeNull();
      expect(patched.nodes.length).toBeGreaterThan(0);
    }
  });

  it('reports findings from several rules at once', () => {
    const messy = graph(
      [
        node('r1', 'reviewer'),
        node('r2', 'reviewer'),
        node('code', 'coder'),
        node('lonely', 'tester'),
      ],
      [edge('code', 'r1'), edge('r1', 'r2')],
    );

    const rules = new Set(idsOf(runRules(context(messy))));
    expect(rules.size).toBeGreaterThan(1);
  });
});
