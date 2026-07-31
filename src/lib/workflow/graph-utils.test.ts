import { describe, expect, it } from 'vitest';
import {
  addNode,
  applyPatch,
  cloneGraph,
  connectNodes,
  createGraph,
  createNode,
  duplicateNode,
  graphSignature,
  removeEdges,
  removeNodes,
  updateNode,
} from './graph-utils';
import { edge, graph, node, serialGraph } from '@/test/fixtures';

describe('createNode', () => {
  it('takes its label and description from the agent definition', () => {
    const created = createNode('planner', { x: 10, y: 20 });

    expect(created.type).toBe('planner');
    expect(created.label).toBe('Planner');
    expect(created.description).toContain('Decomposes');
    expect(created.position).toEqual({ x: 10, y: 20 });
    expect(created.config).toEqual({});
  });

  it('lets overrides win', () => {
    const created = createNode('coder', { x: 0, y: 0 }, { id: 'fixed', label: 'My Coder' });

    expect(created.id).toBe('fixed');
    expect(created.label).toBe('My Coder');
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createNode('custom', { x: 0, y: 0 }).id));
    expect(ids.size).toBe(50);
  });
});

describe('immutability', () => {
  it('never mutates the input graph', () => {
    const original = serialGraph('a', 'b');
    const before = JSON.stringify(original);

    addNode(original, node('c'));
    removeNodes(original, ['a']);
    connectNodes(original, 'b', 'a');
    updateNode(original, 'a', { label: 'changed' });
    removeEdges(original, ['a->b']);

    expect(JSON.stringify(original)).toBe(before);
  });

  it('cloneGraph produces a deep copy', () => {
    const original = serialGraph('a', 'b');
    const copy = cloneGraph(original);

    copy.nodes[0]!.position.x = 999;
    copy.nodes[0]!.config.temperature = 1.5;

    expect(original.nodes[0]!.position.x).toBe(0);
    expect(original.nodes[0]!.config.temperature).toBeUndefined();
  });
});

describe('removeNodes', () => {
  it('removes the node and every edge that touched it', () => {
    const result = removeNodes(serialGraph('a', 'b', 'c'), ['b']);

    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'c']);
    // Leaving a->b or b->c behind would fail validation on save.
    expect(result.edges).toEqual([]);
  });

  it('is a no-op for an id that is not present', () => {
    const original = serialGraph('a', 'b');
    expect(removeNodes(original, ['ghost'])).toEqual(original);
  });
});

describe('connectNodes', () => {
  it('adds an unconditional edge by default', () => {
    const result = connectNodes(createGraph([node('a'), node('b')]), 'a', 'b');

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.condition).toEqual({ kind: 'always' });
  });

  it('refuses a self connection', () => {
    const original = createGraph([node('a')]);
    expect(connectNodes(original, 'a', 'a')).toBe(original);
  });

  it('refuses a duplicate connection', () => {
    const once = connectNodes(createGraph([node('a'), node('b')]), 'a', 'b');
    expect(connectNodes(once, 'a', 'b')).toBe(once);
  });

  it('allows the reverse direction', () => {
    const once = connectNodes(createGraph([node('a'), node('b')]), 'a', 'b');
    expect(connectNodes(once, 'b', 'a').edges).toHaveLength(2);
  });

  it('carries a condition and label through', () => {
    const condition = {
      kind: 'expression',
      field: 'confidence',
      operator: 'gte',
      value: 0.7,
    } as const;

    const result = connectNodes(createGraph([node('a'), node('b')]), 'a', 'b', {
      condition,
      label: 'high confidence',
    });

    expect(result.edges[0]!.condition).toEqual(condition);
    expect(result.edges[0]!.label).toBe('high confidence');
  });
});

describe('duplicateNode', () => {
  it('offsets the copy and gives it a new id', () => {
    const original = graph([node('a', 'coder', { position: { x: 100, y: 100 } })]);
    const result = duplicateNode(original, 'a');

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[1]!.id).not.toBe('a');
    expect(result.nodes[1]!.position).toEqual({ x: 148, y: 148 });
  });

  it('does not copy the original wiring', () => {
    // The user decides how the clone connects; guessing would be wrong as often
    // as it was right.
    const result = duplicateNode(serialGraph('a', 'b'), 'a');
    expect(result.edges).toHaveLength(1);
  });

  it('disambiguates the label when the name is taken', () => {
    const original = graph([node('a', 'custom', { label: 'Reviewer' })]);

    const once = duplicateNode(original, 'a');
    expect(once.nodes[1]!.label).toBe('Reviewer (2)');

    const twice = duplicateNode(once, 'a');
    expect(twice.nodes[2]!.label).toBe('Reviewer (3)');
  });

  it('is a no-op for a missing node', () => {
    const original = serialGraph('a', 'b');
    expect(duplicateNode(original, 'ghost')).toBe(original);
  });
});

describe('applyPatch', () => {
  it('removes nodes and their edges', () => {
    const result = applyPatch(serialGraph('a', 'b', 'c'), { removeNodeIds: ['b'] });

    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'c']);
    expect(result.edges).toEqual([]);
  });

  it('adds edges', () => {
    const result = applyPatch(graph([node('a'), node('b')]), {
      addEdges: [edge('a', 'b')],
    });

    expect(result.edges).toHaveLength(1);
  });

  it('drops an added edge whose endpoint the same patch removed', () => {
    // The parallelism rule rewires around a node it also deletes; without this
    // guard the patch would leave a dangling edge and fail validation.
    const result = applyPatch(serialGraph('a', 'b', 'c'), {
      removeNodeIds: ['b'],
      addEdges: [edge('a', 'b'), edge('a', 'c')],
    });

    expect(result.edges.map((e) => `${e.source}->${e.target}`)).toEqual(['a->c']);
  });

  it('does not add an edge that already exists', () => {
    const result = applyPatch(serialGraph('a', 'b'), { addEdges: [edge('a', 'b')] });
    expect(result.edges).toHaveLength(1);
  });

  it('updates node fields', () => {
    const result = applyPatch(serialGraph('a', 'b'), {
      updateNodes: [{ id: 'a', label: 'Renamed' }],
    });

    expect(result.nodes[0]!.label).toBe('Renamed');
  });

  it('applies an empty patch as a no-op', () => {
    const original = serialGraph('a', 'b');
    expect(applyPatch(original, {})).toEqual(original);
  });

  it('removes edges by id', () => {
    const result = applyPatch(serialGraph('a', 'b'), { removeEdgeIds: ['a->b'] });
    expect(result.edges).toEqual([]);
  });
});

describe('graphSignature', () => {
  it('is stable across node ordering', () => {
    const one = graph([node('a'), node('b')], [edge('a', 'b')]);
    const other = graph([node('b'), node('a')], [edge('a', 'b')]);

    expect(graphSignature(one)).toBe(graphSignature(other));
  });

  it('changes when a node is added', () => {
    const before = graphSignature(serialGraph('a', 'b'));
    const after = graphSignature(addNode(serialGraph('a', 'b'), node('c')));

    expect(after).not.toBe(before);
  });

  it('changes when an edge condition changes', () => {
    const before = graphSignature(serialGraph('a', 'b'));
    const after = graphSignature(
      graph(
        [node('a'), node('b')],
        [edge('a', 'b', { kind: 'expression', field: 'confidence', operator: 'gte', value: 0.7 })],
      ),
    );

    expect(after).not.toBe(before);
  });

  it('ignores position, so dragging a node does not cut a new version', () => {
    const before = graphSignature(graph([node('a', 'custom', { position: { x: 0, y: 0 } })]));
    const after = graphSignature(graph([node('a', 'custom', { position: { x: 900, y: 40 } })]));

    expect(after).toBe(before);
  });

  it('changes when a node config override changes', () => {
    const before = graphSignature(graph([node('a')]));
    const after = graphSignature(graph([node('a', 'custom', { config: { temperature: 0.9 } })]));

    expect(after).not.toBe(before);
  });
});
