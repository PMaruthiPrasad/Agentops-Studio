import { render } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { AgentNode } from './agent-node';
import type { AgentFlowNode } from './flow-types';

function makeProps(overrides: Partial<AgentFlowNode['data']> = {}): NodeProps<AgentFlowNode> {
  return {
    id: 'node_a',
    type: 'agent',
    data: {
      label: 'Contract reviewer',
      agentType: 'reviewer',
      description: 'Reviews a deliverable.',
      live: null,
      overridden: false,
      ...overrides,
    },
    selected: false,
    dragging: false,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    deletable: true,
    selectable: true,
    draggable: true,
  };
}

function renderNode(overrides?: Partial<AgentFlowNode['data']>) {
  const { container } = render(
    <ReactFlowProvider>
      <AgentNode {...makeProps(overrides)} />
    </ReactFlowProvider>,
  );
  return container;
}

describe('AgentNode', () => {
  it('renders both connection handles', () => {
    const container = renderNode();

    expect(container.querySelector('.react-flow__handle-left')).not.toBeNull();
    expect(container.querySelector('.react-flow__handle-right')).not.toBeNull();
  });

  it('keeps the handles outside the clipping shell', () => {
    // Regression: the handles used to live inside `.agent-node-shell`, which
    // clips its overflow to keep the accent rail and footer inside the rounded
    // corners. Since the handles are positioned outside the card's box, the clip
    // removed them entirely — not merely invisible but unhittable, which left no
    // way to draw an edge on the canvas at all. jsdom does no layout, so only
    // the structural relationship can be asserted here.
    const container = renderNode();
    const shell = container.querySelector('.agent-node-shell');

    expect(shell).not.toBeNull();
    expect(shell?.className).toContain('overflow-hidden');

    for (const handle of container.querySelectorAll('.react-flow__handle')) {
      expect(shell?.contains(handle)).toBe(false);
    }
  });
});
