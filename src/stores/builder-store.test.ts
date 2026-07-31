import { beforeEach, describe, expect, it } from 'vitest';
import { useBuilderStore } from './builder-store';
import type { Workflow } from '@/types/workflow';

function makeWorkflow(): Workflow {
  return {
    id: 'wf_1',
    name: 'Test workflow',
    description: '',
    tags: [],
    isFavorite: false,
    version: 3,
    graph: {
      nodes: [
        {
          id: 'a',
          type: 'planner',
          label: 'Planner',
          description: '',
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: 'b',
          type: 'coder',
          label: 'Coder',
          description: '',
          position: { x: 200, y: 0 },
          config: {},
        },
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b', condition: { kind: 'always' } }],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('builder store', () => {
  beforeEach(() => {
    useBuilderStore.getState().reset();
  });

  it('loads a workflow without marking it dirty', () => {
    useBuilderStore.getState().load(makeWorkflow());
    const state = useBuilderStore.getState();

    expect(state.graph.nodes).toHaveLength(2);
    expect(state.version).toBe(3);
    expect(state.dirty).toBe(false);
    expect(state.past).toHaveLength(0);
  });

  it('adds a node and marks the graph dirty', () => {
    useBuilderStore.getState().load(makeWorkflow());
    const id = useBuilderStore.getState().addNode('reviewer', { x: 10, y: 20 });

    const state = useBuilderStore.getState();
    expect(state.graph.nodes).toHaveLength(3);
    expect(state.dirty).toBe(true);
    expect(state.selectedNodeIds).toEqual([id]);
  });

  it('removes edges that would dangle when a node is deleted', () => {
    useBuilderStore.getState().load(makeWorkflow());
    useBuilderStore.getState().removeNodes(['b']);

    const state = useBuilderStore.getState();
    expect(state.graph.nodes.map((node) => node.id)).toEqual(['a']);
    // The edge referenced the deleted node; leaving it would fail validation on save.
    expect(state.graph.edges).toHaveLength(0);
  });

  it('refuses self-connections and duplicate edges', () => {
    useBuilderStore.getState().load(makeWorkflow());

    useBuilderStore.getState().connect('a', 'a');
    expect(useBuilderStore.getState().graph.edges).toHaveLength(1);

    useBuilderStore.getState().connect('a', 'b');
    expect(useBuilderStore.getState().graph.edges).toHaveLength(1);

    useBuilderStore.getState().connect('b', 'a');
    expect(useBuilderStore.getState().graph.edges).toHaveLength(2);
  });

  it('undoes and redoes a structural edit', () => {
    useBuilderStore.getState().load(makeWorkflow());
    useBuilderStore.getState().addNode('critic', { x: 0, y: 0 });
    expect(useBuilderStore.getState().graph.nodes).toHaveLength(3);

    useBuilderStore.getState().undo();
    expect(useBuilderStore.getState().graph.nodes).toHaveLength(2);

    useBuilderStore.getState().redo();
    expect(useBuilderStore.getState().graph.nodes).toHaveLength(3);
  });

  it('keeps node drags out of the undo stack', () => {
    useBuilderStore.getState().load(makeWorkflow());

    // A drag emits a position change per frame; snapshotting each one would make
    // a single drag consume the entire history.
    useBuilderStore.getState().moveNode('a', { x: 5, y: 5 });
    useBuilderStore.getState().moveNode('a', { x: 10, y: 10 });

    const state = useBuilderStore.getState();
    expect(state.past).toHaveLength(0);
    expect(state.graph.nodes[0]?.position).toEqual({ x: 10, y: 10 });
    expect(state.dirty).toBe(true);
  });

  it('restores a drag when the canvas snapshots before it', () => {
    useBuilderStore.getState().load(makeWorkflow());

    useBuilderStore.getState().snapshot();
    useBuilderStore.getState().moveNode('a', { x: 99, y: 99 });
    useBuilderStore.getState().undo();

    expect(useBuilderStore.getState().graph.nodes[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it('duplicates a node with a new id and an offset position', () => {
    useBuilderStore.getState().load(makeWorkflow());
    useBuilderStore.getState().duplicateNode('a');

    const nodes = useBuilderStore.getState().graph.nodes;
    expect(nodes).toHaveLength(3);

    const copy = nodes[2];
    expect(copy?.id).not.toBe('a');
    expect(copy?.type).toBe('planner');
    expect(copy?.position).toEqual({ x: 48, y: 48 });
  });

  it('clears the redo stack once a new edit lands', () => {
    useBuilderStore.getState().load(makeWorkflow());
    useBuilderStore.getState().addNode('critic', { x: 0, y: 0 });
    useBuilderStore.getState().undo();
    expect(useBuilderStore.getState().future).toHaveLength(1);

    useBuilderStore.getState().addNode('tester', { x: 0, y: 0 });
    expect(useBuilderStore.getState().future).toHaveLength(0);
  });

  it('clears the dirty flag when a save is acknowledged', () => {
    useBuilderStore.getState().load(makeWorkflow());
    useBuilderStore.getState().addNode('critic', { x: 0, y: 0 });
    expect(useBuilderStore.getState().dirty).toBe(true);

    useBuilderStore.getState().markSaved({ ...makeWorkflow(), version: 4 });
    const state = useBuilderStore.getState();

    expect(state.dirty).toBe(false);
    expect(state.version).toBe(4);
    // The saved acknowledgement updates metadata but must not revert the canvas.
    expect(state.graph.nodes).toHaveLength(3);
  });
});
