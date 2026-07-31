'use client';

import { useState } from 'react';
import { Check, Sparkles, TrendingDown, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useBuilderStore } from '@/stores/builder-store';
import { applySuggestions, optimizeWorkflow } from '@/lib/workflow-actions';
import { cn, formatCost, formatDuration, formatPercent, toErrorMessage } from '@/lib/utils';
import type { OptimizationReport, SuggestionSeverity } from '@/types/optimizer';

const SEVERITY_VARIANT: Record<SuggestionSeverity, 'destructive' | 'warning' | 'info' | 'muted'> = {
  critical: 'destructive',
  high: 'destructive',
  medium: 'warning',
  low: 'info',
  info: 'muted',
};

const GRADE_COLOR: Record<string, string> = {
  A: 'text-success',
  B: 'text-success',
  C: 'text-warning',
  D: 'text-warning',
  F: 'text-destructive',
};

interface OptimizerPanelProps {
  workflowId: string;
  /** Lets the canvas highlight the nodes a hovered suggestion refers to. */
  onHighlight: (nodeIds: string[]) => void;
}

/**
 * The workflow optimizer.
 *
 * Analysis runs against whatever is currently on the canvas, not the saved
 * graph, so you can evaluate an edit before committing to it. Applying
 * suggestions rewrites the canvas as an *undoable* edit and never persists —
 * the user still has to press Save, which is the right default for a tool that
 * rearranges your work.
 */
export function OptimizerPanel({ workflowId, onHighlight }: OptimizerPanelProps) {
  const graph = useBuilderStore((state) => state.graph);
  const setGraph = useBuilderStore((state) => state.setGraph);

  const [report, setReport] = useState<OptimizationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function analyze() {
    setLoading(true);
    try {
      const result = await optimizeWorkflow(workflowId, {
        graphOverride: graph,
        includeNarrative: true,
      });
      setReport(result);
      setSelected(new Set(result.suggestions.filter((s) => s.autoFixable).map((s) => s.id)));
    } catch (error) {
      toast.error(toErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    if (selected.size === 0) return;

    setApplying(true);
    try {
      const result = await applySuggestions(workflowId, graph, [...selected]);
      setGraph(result.graph);

      const skipped = result.skipped.length;
      toast.success(
        `Applied ${result.applied.length} suggestion${result.applied.length === 1 ? '' : 's'}.`,
        {
          description: skipped
            ? `${skipped} could not be applied automatically. Undo with Ctrl+Z if this isn't what you wanted.`
            : "Undo with Ctrl+Z if this isn't what you wanted. Nothing is saved until you press Save.",
        },
      );

      setReport(null);
      setSelected(new Set());
      onHighlight([]);
    } catch (error) {
      toast.error(toErrorMessage(error));
    } finally {
      setApplying(false);
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Button size="sm" className="flex-1" onClick={analyze} loading={loading}>
          <Sparkles />
          Analyze workflow
        </Button>
      </div>

      {loading && !report ? (
        <div className="space-y-3 p-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : report ? (
        <ScrollArea className="flex-1">
          <div className="space-y-4 p-3">
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Optimization score
                  </p>
                  <p className="tabular mt-0.5 text-2xl font-semibold">
                    {report.score}
                    <span className="text-sm text-muted-foreground">/100</span>
                  </p>
                </div>
                <span
                  className={cn(
                    'text-3xl font-bold leading-none',
                    GRADE_COLOR[report.grade] ?? 'text-muted-foreground',
                  )}
                >
                  {report.grade}
                </span>
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {report.summary}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border p-2.5">
                <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <TrendingDown className="size-3" />
                  Latency
                </p>
                <p className="tabular mt-1 text-sm font-semibold text-success">
                  −{formatDuration(report.estimatedLatencyReductionMs)}
                </p>
                <p className="tabular text-[10px] text-muted-foreground">
                  {formatPercent(report.latencyReductionPct / 100, 1)} faster ·{' '}
                  {formatDuration(report.baseline.estimatedLatencyMs)} →{' '}
                  {formatDuration(report.projected.estimatedLatencyMs)}
                </p>
              </div>

              <div className="rounded-md border border-border p-2.5">
                <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <TrendingDown className="size-3" />
                  Cost
                </p>
                <p className="tabular mt-1 text-sm font-semibold text-success">
                  −{formatCost(report.estimatedCostReductionUsd)}
                </p>
                <p className="tabular text-[10px] text-muted-foreground">
                  {formatPercent(report.costReductionPct / 100, 1)} cheaper ·{' '}
                  {formatCost(report.baseline.estimatedCostUsd)} →{' '}
                  {formatCost(report.projected.estimatedCostUsd)}
                </p>
              </div>
            </div>

            {report.narrative ? (
              <div className="rounded-md border border-primary/25 bg-primary/5 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-primary">
                  Analysis
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
                  {report.narrative}
                </p>
              </div>
            ) : null}

            <Separator />

            {report.suggestions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Check className="size-5 text-success" />
                <p className="text-xs font-medium">No issues found.</p>
                <p className="text-[11px] text-muted-foreground">
                  Every rule passed against this graph.
                </p>
              </div>
            ) : (
              <>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {report.suggestions.length} suggestion
                  {report.suggestions.length === 1 ? '' : 's'}
                </p>

                <ul className="space-y-2">
                  {report.suggestions.map((suggestion) => (
                    <li
                      key={suggestion.id}
                      onMouseEnter={() => onHighlight(suggestion.affectedNodeIds)}
                      onMouseLeave={() => onHighlight([])}
                      className="rounded-md border border-border p-2.5 transition-colors hover:border-border/70 hover:bg-accent/30"
                    >
                      <div className="flex items-start gap-2">
                        <Checkbox
                          className="mt-0.5"
                          checked={selected.has(suggestion.id)}
                          disabled={!suggestion.autoFixable}
                          onCheckedChange={() => toggle(suggestion.id)}
                          aria-label={`Apply: ${suggestion.title}`}
                        />

                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-xs font-medium">{suggestion.title}</p>
                            <Badge variant={SEVERITY_VARIANT[suggestion.severity]}>
                              {suggestion.severity}
                            </Badge>
                            <Badge variant="outline">{suggestion.category}</Badge>
                            {!suggestion.autoFixable ? (
                              <Badge variant="muted">manual</Badge>
                            ) : null}
                          </div>

                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            {suggestion.description}
                          </p>
                          <p className="border-l-2 border-border pl-2 text-[11px] italic leading-relaxed text-muted-foreground">
                            {suggestion.reasoning}
                          </p>

                          {suggestion.estimatedLatencyReductionMs > 0 ||
                          suggestion.estimatedCostReductionUsd > 0 ? (
                            <p className="tabular text-[10px] text-success">
                              saves {formatDuration(suggestion.estimatedLatencyReductionMs)} ·{' '}
                              {formatCost(suggestion.estimatedCostReductionUsd)}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </ScrollArea>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <Wand2 className="size-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Analyze the current canvas for redundant agents, missed parallelism, and ordering
            mistakes.
          </p>
        </div>
      )}

      {report && report.suggestions.length > 0 ? (
        <div className="border-t border-border p-3">
          <Button
            size="sm"
            className="w-full"
            disabled={selected.size === 0}
            loading={applying}
            onClick={apply}
          >
            <Wand2 />
            Apply {selected.size} to canvas
          </Button>
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
            Applied as an undoable edit. Nothing is saved until you press Save.
          </p>
        </div>
      ) : null}
    </div>
  );
}
