'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertCircle, Loader2, MinusCircle, Settings2 } from 'lucide-react';
import { getAgentAccent, getAgentIcon } from '@/lib/agent-ui';
import { cn, formatCost, formatDuration, formatPercent } from '@/lib/utils';
import type { AgentFlowNode } from './flow-types';

/**
 * A node on the canvas.
 *
 * Outside a run it shows identity: which agent, what it's called, whether it
 * has been customised. During a run the same node becomes the telemetry
 * readout — status ring, duration, cost, confidence — so the graph itself is
 * the progress indicator and no separate console is needed.
 */
function AgentNodeComponent({ data, selected }: NodeProps<AgentFlowNode>) {
  const Icon = getAgentIcon(data.agentType);
  const accent = getAgentAccent(data.agentType);
  const live = data.live;

  const running = live?.status === 'running';
  const failed = live?.status === 'failed';
  const skipped = live?.status === 'skipped';
  const succeeded = live?.status === 'success';

  return (
    // The handles sit outside the shell on purpose: the shell clips its own
    // overflow to keep the accent rail and footer inside the rounded corners,
    // and a clipped handle is not just invisible but unhittable — which leaves
    // no way to draw an edge at all.
    <div className="relative w-[220px]">
      <Handle type="target" position={Position.Left} className="!left-[-5px]" />

      <div
        className={cn(
          'agent-node-shell relative overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all',
          running && 'border-info/70 ring-2 ring-info/30',
          failed && 'border-destructive/70 ring-2 ring-destructive/25',
          succeeded && 'border-success/50',
          skipped && 'opacity-55',
          selected && 'border-primary/80',
        )}
      >
        {/* Accent rail identifies the agent family at a glance when zoomed out. */}
        <div className={cn('absolute inset-y-0 left-0 w-1', accent.rail)} aria-hidden />

        <div className="flex items-start gap-2.5 p-3 pl-4">
          <div
            className={cn(
              'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md',
              accent.chip,
            )}
          >
            <Icon className="size-4" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-medium leading-tight">{data.label}</p>
              {data.overridden ? (
                <Settings2
                  className="size-3 shrink-0 text-muted-foreground"
                  aria-label="Custom configuration"
                />
              ) : null}
            </div>
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
              {data.description}
            </p>
          </div>

          {running ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-info" aria-label="Running" />
          ) : failed ? (
            <AlertCircle className="size-3.5 shrink-0 text-destructive" aria-label="Failed" />
          ) : skipped ? (
            <MinusCircle className="size-3.5 shrink-0 text-muted-foreground" aria-label="Skipped" />
          ) : null}
        </div>

        {live && live.status !== 'pending' ? (
          <div className="tabular flex items-center gap-2 border-t border-border bg-muted/40 px-3 py-1.5 text-[10px] text-muted-foreground">
            <span>{formatDuration(live.durationMs)}</span>
            <span aria-hidden>·</span>
            <span>{formatCost(live.costUsd)}</span>
            {live.confidence > 0 ? (
              <>
                <span aria-hidden>·</span>
                <span>{formatPercent(live.confidence)}</span>
              </>
            ) : null}
            {live.attempt > 1 ? (
              <span className="ml-auto text-warning">retry {live.attempt}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <Handle type="source" position={Position.Right} className="!right-[-5px]" />
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
