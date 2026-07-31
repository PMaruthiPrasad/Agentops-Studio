import { describe, expect, it } from 'vitest';
import {
  buildAdjacency,
  computeComplexityScore,
  computeCriticalPath,
  computeParallelizationScore,
  computeTopology,
  countBranchPoints,
  countMergePoints,
  findRootNodes,
  findTerminalNodes,
  TopologyError,
} from './topology';
import { edge, fanOutGraph, graph, node, serialGraph } from '@/test/fixtures';

describe('computeTopology', () => {
  it('puts a serial chain in one node per layer', () => {
    const result = computeTopology(serialGraph('a', 'b', 'c'));

    expect(result.layers).toEqual([['a'], ['b'], ['c']]);
    expect(result.layerOf.get('c')).toBe(2);
  });

  it('groups independent nodes into a single dispatchable layer', () => {
    const result = computeTopology(fanOutGraph(3));

    expect(result.layers).toEqual([['root'], ['leaf1', 'leaf2', 'leaf3']]);
  });

  it('holds a join node until every dependency has run', () => {
    // a → c, b → c: c cannot be in the same layer as either parent.
    const result = computeTopology(
      graph([node('a'), node('b'), node('c')], [edge('a', 'c'), edge('b', 'c')]),
    );

    expect(result.layers).toEqual([['a', 'b'], ['c']]);
  });

  it('preserves authoring order within a layer', () => {
    // Declared z, m, a — the layer must not be alphabetised.
    const result = computeTopology(graph([node('z'), node('m'), node('a')]));

    expect(result.layers).toEqual([['z', 'm', 'a']]);
  });

  it('refuses to order a cyclic graph and names the cycle', () => {
    const cyclic = graph([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]);

    expect(() => computeTopology(cyclic)).toThrow(TopologyError);
    try {
      computeTopology(cyclic);
    } catch (error) {
      expect((error as TopologyError).cycle).toContain('a');
      expect((error as TopologyError).message).toMatch(/→/);
    }
  });

  it('treats an isolated node as its own root', () => {
    const result = computeTopology(graph([node('a'), node('b'), node('lonely')], [edge('a', 'b')]));

    expect(result.layers[0]).toEqual(['a', 'lonely']);
  });

  it('handles an empty graph without throwing', () => {
    const result = computeTopology(graph([]));
    expect(result.layers).toEqual([]);
  });
});

describe('buildAdjacency', () => {
  it('records both directions for every edge', () => {
    const { incoming, outgoing } = buildAdjacency(serialGraph('a', 'b', 'c'));

    expect(outgoing.get('a')).toEqual(['b']);
    expect(incoming.get('b')).toEqual(['a']);
    expect(outgoing.get('c')).toEqual([]);
  });
});

describe('computeParallelizationScore', () => {
  it('scores a fully serial graph at 0', () => {
    expect(computeParallelizationScore(4, 4)).toBe(0);
  });

  it('scores a single-layer graph at 1', () => {
    expect(computeParallelizationScore(4, 1)).toBe(1);
  });

  it('scores partial parallelism between the extremes', () => {
    // 4 nodes in 3 layers eliminates one of three serial steps.
    expect(computeParallelizationScore(4, 3)).toBeCloseTo(0.333, 2);
  });

  it('returns 0 for a graph too small to parallelise', () => {
    expect(computeParallelizationScore(1, 1)).toBe(0);
    expect(computeParallelizationScore(0, 0)).toBe(0);
  });
});

describe('computeComplexityScore', () => {
  it('is 0 for an empty graph', () => {
    expect(computeComplexityScore(graph([]), 0)).toBe(0);
  });

  it('rates a big branching graph above a small linear one', () => {
    const simple = serialGraph('a', 'b');
    const complex = graph(
      Array.from({ length: 12 }, (_, i) => node(`n${i}`)),
      Array.from({ length: 11 }, (_, i) => edge(`n${i}`, `n${i + 1}`)),
    );

    expect(computeComplexityScore(complex, 11)).toBeGreaterThan(
      computeComplexityScore(simple, 2),
    );
  });

  it('stays within 0..1 for an extreme graph', () => {
    const huge = graph(
      Array.from({ length: 60 }, (_, i) => node(`n${i}`)),
      Array.from({ length: 59 }, (_, i) => edge(`n${i}`, `n${i + 1}`)),
    );

    const score = computeComplexityScore(huge, 59);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('counts conditional edges as added complexity', () => {
    const plain = graph([node('a'), node('b')], [edge('a', 'b')]);
    const conditional = graph(
      [node('a'), node('b')],
      [edge('a', 'b', { kind: 'expression', field: 'confidence', operator: 'gte', value: 0.7 })],
    );

    expect(computeComplexityScore(conditional, 2)).toBeGreaterThan(
      computeComplexityScore(plain, 2),
    );
  });
});

describe('branch and merge points', () => {
  it('counts a node with two outgoing edges as a branch', () => {
    expect(countBranchPoints(fanOutGraph(2))).toBe(1);
    expect(countBranchPoints(serialGraph('a', 'b', 'c'))).toBe(0);
  });

  it('counts a node with two incoming edges as a merge', () => {
    const join = graph([node('a'), node('b'), node('c')], [edge('a', 'c'), edge('b', 'c')]);

    expect(countMergePoints(join)).toBe(1);
    expect(countMergePoints(fanOutGraph(2))).toBe(0);
  });
});

describe('roots and terminals', () => {
  it('identifies entry and exit nodes', () => {
    const g = serialGraph('a', 'b', 'c');

    expect(findRootNodes(g).map((n) => n.id)).toEqual(['a']);
    expect(findTerminalNodes(g).map((n) => n.id)).toEqual(['c']);
  });

  it('treats an isolated node as both a root and a terminal', () => {
    const g = graph([node('lonely')]);

    expect(findRootNodes(g).map((n) => n.id)).toEqual(['lonely']);
    expect(findTerminalNodes(g).map((n) => n.id)).toEqual(['lonely']);
  });
});

describe('computeCriticalPath', () => {
  it('follows the heaviest chain, not the longest one', () => {
    // a → b → d  (1 + 1 + 1 = 3)
    // a → c → d  (1 + 10 + 1 = 12)  ← critical
    const g = graph(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
    );

    const weights: Record<string, number> = { a: 1, b: 1, c: 10, d: 1 };
    const result = computeCriticalPath(g, (n) => weights[n.id] ?? 0);

    expect(result.path).toEqual(['a', 'c', 'd']);
    expect(result.totalWeight).toBe(12);
  });

  it('reports the sum of a serial chain', () => {
    const result = computeCriticalPath(serialGraph('a', 'b', 'c'), () => 5);

    expect(result.totalWeight).toBe(15);
    expect(result.path).toEqual(['a', 'b', 'c']);
  });

  it('reports only the heaviest node when everything is parallel', () => {
    const g = fanOutGraph(3);
    const weights: Record<string, number> = { root: 1, leaf1: 2, leaf2: 9, leaf3: 3 };

    const result = computeCriticalPath(g, (n) => weights[n.id] ?? 0);

    // Parallel leaves overlap, so wall clock is root + the slowest leaf.
    expect(result.totalWeight).toBe(10);
    expect(result.path).toEqual(['root', 'leaf2']);
  });
});
