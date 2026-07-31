import { describe, expect, it } from 'vitest';
import { assertValidGraph, findCycle, validateGraph, WorkflowValidationError } from './validate';
import { edge, graph, node, serialGraph } from '@/test/fixtures';

function codes(issues: { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

describe('findCycle', () => {
  it('returns null for an acyclic graph', () => {
    expect(findCycle(serialGraph('a', 'b', 'c'))).toBeNull();
  });

  it('finds a direct two-node cycle', () => {
    const cycle = findCycle(graph([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]));

    expect(cycle).not.toBeNull();
    expect(cycle).toContain('a');
    expect(cycle).toContain('b');
  });

  it('finds a longer cycle and returns it in traversal order', () => {
    const cycle = findCycle(
      graph(
        [node('a'), node('b'), node('c')],
        [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
      ),
    );

    // The path closes back on the node it started from.
    expect(cycle?.[0]).toBe(cycle?.at(-1));
    expect(cycle).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('detects a self loop', () => {
    expect(findCycle(graph([node('a')], [edge('a', 'a')]))).toEqual(['a', 'a']);
  });

  it('does not mistake a diamond for a cycle', () => {
    const diamond = graph(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
    );

    expect(findCycle(diamond)).toBeNull();
  });
});

describe('validateGraph', () => {
  it('accepts a well-formed graph', () => {
    const result = validateGraph(serialGraph('a', 'b'));

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects an empty graph', () => {
    const result = validateGraph(graph([]));

    expect(result.valid).toBe(false);
    expect(codes(result.errors)).toContain('EMPTY_GRAPH');
  });

  it('rejects an edge pointing at a node that does not exist', () => {
    const result = validateGraph(graph([node('a')], [edge('a', 'ghost')]));

    expect(result.valid).toBe(false);
    expect(codes(result.errors)).toContain('DANGLING_EDGE');
  });

  it('rejects a self loop', () => {
    const result = validateGraph(graph([node('a'), node('b')], [edge('a', 'a'), edge('a', 'b')]));

    expect(result.valid).toBe(false);
    expect(codes(result.errors)).toContain('SELF_LOOP');
  });

  it('rejects a cycle and names the nodes involved', () => {
    const result = validateGraph(
      graph([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]),
    );

    expect(result.valid).toBe(false);
    const cycleError = result.errors.find((e) => e.code === 'CYCLE_DETECTED');
    expect(cycleError?.nodeIds).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('rejects a graph with no entry point', () => {
    // Two mutually-dependent nodes: every node has an incoming edge.
    const result = validateGraph(
      graph([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]),
    );

    expect(codes(result.errors)).toContain('NO_ENTRY_POINT');
  });

  it('rejects duplicate node ids', () => {
    const result = validateGraph(graph([node('a'), node('a')]));

    expect(result.valid).toBe(false);
    expect(codes(result.errors)).toContain('DUPLICATE_NODE_ID');
  });

  it('rejects duplicate edge ids', () => {
    const duplicated = { ...edge('a', 'b'), id: 'same' };
    const result = validateGraph(
      graph([node('a'), node('b'), node('c')], [duplicated, { ...edge('b', 'c'), id: 'same' }]),
    );

    expect(result.valid).toBe(false);
    expect(codes(result.errors)).toContain('DUPLICATE_EDGE_ID');
  });

  it('rejects a graph that fails the schema outright', () => {
    const malformed = { nodes: [{ id: '', type: 'nonsense' }], edges: [] } as never;
    const result = validateGraph(malformed);

    expect(result.valid).toBe(false);
    expect(codes(result.errors)).toContain('SCHEMA_INVALID');
  });

  it('warns — but does not fail — on an isolated node', () => {
    const result = validateGraph(
      graph([node('a'), node('b'), node('lonely')], [edge('a', 'b')]),
    );

    expect(result.valid).toBe(true);
    expect(codes(result.warnings)).toContain('ISOLATED_NODE');
  });

  it('does not warn about isolation in a single-node graph', () => {
    const result = validateGraph(graph([node('only')]));

    expect(result.valid).toBe(true);
    expect(codes(result.warnings)).not.toContain('ISOLATED_NODE');
  });

  it('warns on repeated connections between the same pair', () => {
    const result = validateGraph(
      graph([node('a'), node('b')], [edge('a', 'b'), { ...edge('a', 'b'), id: 'second' }]),
    );

    expect(result.valid).toBe(true);
    expect(codes(result.warnings)).toContain('PARALLEL_EDGES');
  });

  it('reports every independent problem at once rather than the first', () => {
    const result = validateGraph(
      graph([node('a'), node('b')], [edge('a', 'a'), edge('b', 'ghost')]),
    );

    expect(codes(result.errors)).toEqual(expect.arrayContaining(['SELF_LOOP', 'DANGLING_EDGE']));
  });
});

describe('assertValidGraph', () => {
  it('is silent for a valid graph', () => {
    expect(() => assertValidGraph(serialGraph('a', 'b'))).not.toThrow();
  });

  it('throws a WorkflowValidationError carrying the issues', () => {
    try {
      assertValidGraph(graph([]));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowValidationError);
      expect((error as WorkflowValidationError).issues.length).toBeGreaterThan(0);
      expect((error as WorkflowValidationError).message).toMatch(/no nodes/i);
    }
  });
});
