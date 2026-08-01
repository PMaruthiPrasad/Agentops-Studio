'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CircleSlash,
  FileText,
  History,
  Loader2,
  Paperclip,
  Play,
  Square,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import type { UseExecutionStreamResult } from '@/hooks/use-execution-stream';
import { useExecutions } from '@/hooks/use-resources';
import { estimateTokens } from '@/lib/providers/tokens';
import { extractDocument } from '@/lib/workflow-actions';
import {
  cn,
  formatCost,
  formatDuration,
  formatPercent,
  formatRelativeTime,
  formatTokens,
  toErrorMessage,
  truncate,
} from '@/lib/utils';
import type { RunDocument } from '@/types/agent';
import type { ExecutionEvent, ExecutionSummary } from '@/types/execution';

interface RunPanelProps {
  workflowId: string;
  executionId: string | null;
  stream: UseExecutionStreamResult;
  starting: boolean;
  disabled: boolean;
  /** True when the canvas has edits that haven't been saved. */
  dirty: boolean;
  onRun: (task: string, document: RunDocument | null) => void;
  onClear: () => void;
}

/** Enough history to answer "did this workflow work last time?" in one glance. */
const RECENT_RUN_LIMIT = 6;

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
  workflowId,
  executionId,
  stream,
  starting,
  disabled,
  dirty,
  onRun,
  onClear,
}: RunPanelProps) {
  const [task, setTask] = useState('');
  const [attachment, setAttachment] = useState<RunDocument | null>(null);
  const [extracting, setExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const running = stream.phase === 'running' || stream.phase === 'connecting' || starting;
  const metrics = stream.metrics;
  const canRun = !disabled && !extracting && task.trim().length >= 4;

  async function onPickFile(file: File) {
    setExtracting(true);
    try {
      // Extracted before the run so a scan or a corrupt file fails here, for
      // free, rather than after the first agent has been billed.
      setAttachment(await extractDocument(file));
    } catch (cause) {
      toast.error(toErrorMessage(cause));
    } finally {
      setExtracting(false);
      // Clearing the input lets the same file be picked again after a failure.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // Past runs live in the database, but the builder used to hold the current
  // execution id in component state alone — so reopening a workflow left no
  // trace that it had ever run. This is that trace.
  const {
    data: recentRuns,
    loading: recentLoading,
    refresh: refreshRecent,
  } = useExecutions({ workflowId, limit: RECENT_RUN_LIMIT });

  const finished = stream.phase === 'finished';
  useEffect(() => {
    if (finished) refreshRecent();
  }, [finished, refreshRecent]);

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
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canRun) {
              event.preventDefault();
              onRun(task.trim(), attachment);
            }
          }}
        />

        <DocumentField
          document={attachment}
          extracting={extracting}
          disabled={running}
          inputRef={fileInputRef}
          onPick={(file) => void onPickFile(file)}
          onRemove={() => setAttachment(null)}
        />

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="flex-1"
            loading={running}
            disabled={!canRun}
            onClick={() => onRun(task.trim(), attachment)}
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
              <div className="flex items-center gap-3">
                <Link
                  href={`/executions/${executionId}/report`}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <FileText className="size-3" />
                  Report
                </Link>
                <Link
                  href={`/executions/${executionId}`}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Metrics
                  <ArrowUpRight className="size-3" />
                </Link>
              </div>
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
        <RecentRuns runs={recentRuns} loading={recentLoading} />
      )}
    </div>
  );
}

/**
 * The attachment control.
 *
 * The task box stays what it always was — an instruction. This is the material
 * the instruction is about, which is why a licensing agreement belongs here and
 * not pasted into a 4,000-character textarea.
 */
function DocumentField({
  document,
  extracting,
  disabled,
  inputRef,
  onPick,
  onRemove,
}: {
  document: RunDocument | null;
  extracting: boolean;
  disabled: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        aria-label="Attach a PDF"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPick(file);
        }}
      />

      {document ? (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-2">
          <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium">{document.name}</p>
            <p className="tabular text-[10px] text-muted-foreground">
              {document.pages > 0 ? `${document.pages} pages · ` : ''}
              {formatTokens(estimateTokens(document.text))} tokens per agent
              {document.truncated ? ' · truncated' : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Remove ${document.name}`}
            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || extracting}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
        >
          {extracting ? (
            <>
              <Loader2 className="size-3 animate-spin" />
              Reading PDF…
            </>
          ) : (
            <>
              <Paperclip className="size-3" />
              Attach a PDF
            </>
          )}
        </button>
      )}
    </div>
  );
}

/**
 * This workflow's run history, shown where the run panel would otherwise be
 * empty. Every row is a link into the full report — the reason a finished run
 * is no longer something you can only reach in the session that produced it.
 */
function RecentRuns({ runs, loading }: { runs: ExecutionSummary[] | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-12" />
        ))}
      </div>
    );
  }

  if (!runs || runs.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <CircleSlash className="size-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Describe a task and run the graph. Each node reports its own status live.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            <History className="size-3" />
            Past runs
          </p>
          <Link
            href="/executions"
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            All
          </Link>
        </div>

        <ul className="space-y-1">
          {runs.map((run) => (
            <li
              key={run.id}
              className="group relative rounded-md border border-transparent p-2 transition-colors hover:border-border hover:bg-accent/60"
            >
              <div className="flex items-center justify-between gap-2">
                <StatusBadge status={run.status} />
                <span className="text-[10px] text-muted-foreground">
                  {formatRelativeTime(run.startedAt)}
                </span>
              </div>

              {/* Stretched over the card, so the whole thing still opens the
                  run — the Report link below sits above it. */}
              <Link
                href={`/executions/${run.id}`}
                className="mt-1 line-clamp-2 block text-[11px] leading-snug text-muted-foreground after:absolute after:inset-0 after:content-['']"
              >
                {truncate(run.task, 110)}
              </Link>

              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="tabular text-[10px] text-muted-foreground">
                  {formatDuration(run.durationMs)} · {formatCost(run.totalCostUsd)} ·{' '}
                  {formatTokens(run.totalTokens)} tok
                </p>
                <Link
                  href={`/executions/${run.id}/report`}
                  className="relative z-10 inline-flex items-center gap-1 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  <FileText className="size-3" />
                  Report
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </ScrollArea>
  );
}
