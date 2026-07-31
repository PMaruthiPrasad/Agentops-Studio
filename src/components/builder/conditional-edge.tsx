'use client';

import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { ConditionalFlowEdge } from './flow-types';
import { describeCondition } from './condition-format';

/**
 * An edge that can carry a branch predicate.
 *
 * Unconditional edges draw as a plain line; conditional ones get a small chip
 * showing the predicate, because "why didn't that node run?" is the single most
 * common question about a branching graph and the answer should be on the
 * canvas rather than buried in a panel.
 */
function ConditionalEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
  selected,
}: EdgeProps<ConditionalFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const condition = data?.condition;
  const conditional = condition !== undefined && condition.kind !== 'always';
  const text = data?.label ?? (conditional ? describeCondition(condition) : null);

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />

      {text ? (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className={cn(
              'pointer-events-none absolute rounded border px-1.5 py-0.5 font-mono text-[10px] shadow-sm',
              conditional
                ? 'border-warning/40 bg-warning/10 text-warning'
                : 'border-border bg-card text-muted-foreground',
              selected && 'border-primary/60 text-primary',
            )}
          >
            {text}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const ConditionalEdge = memo(ConditionalEdgeComponent);
