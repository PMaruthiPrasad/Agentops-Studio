'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, CircleSlash, Play, Square } from 'lucide-react';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import type { UseExecutionStreamResult } from '@/hooks/use-execution-stream';
import { cn, formatCost, formatDuration, formatPercent, formatTokens } from '@/lib/utils';
import type { ExecutionEvent } from '@/types/execution';

interface RunPanelProps {
  executionId: string | null;
  stream: UseExecutionStreamResult;
  starting: boolean;
  disabled: boolean;
  /** True when the canvas has edits that haven't been saved. */
  dirty: boolean;
  onRun: (task: string) => void;
  onClear: () => void;
}

const EXAMPLE_TASK =
  'Review a software licensing agreement and identify the legal risks that block signature.';

/** One line per event — the raw stream, for when the canvas isn't enough. */
function describeEvent(event: ExecutionEvent): { text: string; tone: string } {
  switch (event.type) {
    case 'run.start':
      return { text: `Run started · ${event.layers.length} layers`, tone: 'text-info' };
    case 'step.start':
      return {
        text: `${event.nodeId} started (layer ${event.layer}, attempt ${event.attempt})`,
        tone: 'text-muted-foreground',
      };
    case 'step.retry':
      return {
        text: `${event.nodeId} retrying in ${event.backoffMs}ms — ${event.error}`,
        tone: 'text-warning',
      };
    case 'step.finish':
      return {
        text: `${event.nodeId} ${event.step.status} · ${formatDuration(event.step.durationMs)} · ${formatCost(event.step.costUsd)}`,
        tone: event.step.status === 'failed' ? 'text-destructive' : 'text-success',
      };
    case 'step.skip':
      return { text: `${event.nodeId} skipped — ${event.reason}`, tone: 'text-muted-foreground' };
    case 'run.finish':
      return {
        text: `Run ${event.status} · ${formatDuration(event.metrics.totalDurationMs)} · ${formatCost(event.metrics.totalCostUsd)}`,
        tone: event.status === 'failed' ? 'text-destructive' : 'text-success',
      };
    case 'run.error':
      return { text: `Run error — ${event.error}`, tone: 'text-destructive' };
    default:
      return { text: 'Unknown event', tone: 'text-muted-foreground' };
  }
}

export function RunPanel({
  executionId,
  stream,
  starting,
  disabled,
  dirty,
  onRun,
  onClear,
}: RunPanelProps) {
  const [task, setTask] = useState('');

  const running = stream.phase === 'running' || stream.phase === 'connecting' || starting;
  const metrics = stream.metrics;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-border p-3">
        <Textarea
          value={task}
          onChange={(event) => setTask(event.target.value)}
          placeholder={EXAMPLE_TASK}
          rows={3}
          disabled={running}
          className="resize-none text-xs"
          aria-label="Task description"
          onKeyDown={(event) => {
            // ⌘/Ctrl+Enter runs — the convention everywhere else that has a
            // "compose then submit" box.
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && task.trim().length >= 4) {
              event.preventDefault();
              onRun(task.trim());
            }
          }}
        />

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="flex-1"
            loading={running}
            disabled={disabled || task.trim().length < 4}
            onClick={() => onRun(task.trim())}
          >
            <Play />
            {running ? 'Running…' : 'Run workflow'}
          </Button>

          {executionId && !running ? (
            <Button size="sm" variant="outline" onClick={onClear} aria-label="Clear run">
              <Square />
            </Button>
          ) : null}
        </div>

        {dirty ? (
          <p className="text-[11px] leading-relaxed text-warning">
            Unsaved canvas edits will be executed as-is — the saved version is untouched.
          </p>
        ) : null}

        {!task.trim() ? (
          <button
            type="button"
            className="text-left text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setTask(EXAMPLE_TASK)}
          >
            Use the example task
          </button>
        ) : null}
      </div>

      {executionId ? (
        <>
          <div className="space-y-2 border-b border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <StatusBadge status={stream.status ?? (running ? 'running' : 'pending')} />
              <Link
                href={`/executions/${executionId}`}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                Full report
                <ArrowUpRight className="size-3" />
              </Link>
            </div>

            <Progress
              value={stream.progress * 100}
              indicatorClassName={cn(
                stream.status === 'failed' && 'bg-destructive',
                stream.status === 'partial' && 'bg-warning',
                stream.status === 'success' && 'bg-success',
              )}
            />

            {metrics ? (
              <dl className="tabular grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Wall clock</dt>
                  <dd>{formatDuration(metrics.totalDurationMs)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Agent time</dt>
                  <dd>{formatDuration(metrics.totalAgentTimeMs)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Tokens</dt>
                  <dd>{formatTokens(metrics.totalTokens)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Cost</dt>
                  <dd>{formatCost(metrics.totalCostUsd)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Confidence</dt>
                  <dd>{formatPercent(metrics.averageConfidence)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Parallelism</dt>
                  <dd>{formatPercent(metrics.parallelizationScore)}</dd>
                </div>
              </dl>
            ) : null}

            {stream.error ? (
              <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
                {stream.error}
              </p>
            ) : null}
          </div>

          <ScrollArea className="flex-1">
            <ol className="space-y-1 p-3 font-mono text-[10px] leading-relaxed">
              {stream.events.map((event, index) => {
                const { text, tone } = describeEvent(event);
                return (
                  <li key={index} className={cn('flex gap-2', tone)}>
                    <span className="shrink-0 text-muted-foreground/60">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="break-words">{text}</span>
                  </li>
                );
              })}
            </ol>
          </ScrollArea>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <CircleSlash className="size-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Describe a task and run the graph. Each node reports its own status live.
          </p>
        </div>
      )}
    </div>
  );
}
