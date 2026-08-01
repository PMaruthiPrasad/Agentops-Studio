'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ArrowLeft, BarChart3, FileDown, FileText } from 'lucide-react';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getAgentAccent, getAgentIcon } from '@/lib/agent-ui';
import { buildRunReport, sectionSubtitle } from '@/lib/reports/report-model';
import { useExecution } from '@/hooks/use-resources';
import { cn } from '@/lib/utils';

/**
 * The reading view of a run.
 *
 * Deliberately holds no metrics. The execution detail page already answers how
 * a run behaved — cost, tokens, latency, retries, prompts — and that is an
 * engineer's question. This page answers what the agents actually said, which
 * is the only question the person who asked for the review has.
 */
export function ExecutionReport({ executionId }: { executionId: string }) {
  const { data: execution, loading, error } = useExecution(executionId);

  const report = useMemo(() => (execution ? buildRunReport(execution) : null), [execution]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-12" />
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !execution || !report) {
    return (
      <div className="p-6">
        <Card className="border-destructive/40 p-6 text-sm">
          <p className="font-medium text-destructive">Could not load this report.</p>
          <p className="mt-1 text-muted-foreground">{error ?? 'It may have been deleted.'}</p>
          <Button variant="outline" size="sm" className="mt-3" asChild>
            <Link href="/executions">Back to executions</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" asChild aria-label="Back to executions">
            <Link href="/executions">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <StatusBadge status={execution.status} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            {/* Plain anchors, not fetch + blob: the browser's own download
                handling gets the filename from Content-Disposition and shows
                real progress on a large report. */}
            <a href={`/api/executions/${executionId}/report?format=docx`} download>
              <FileDown />
              Word
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/executions/${executionId}/report?format=pdf`} download>
              <FileDown />
              PDF
            </a>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/executions/${executionId}`}>
              <BarChart3 />
              Metrics
            </Link>
          </Button>
        </div>
      </div>

      <article className="space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{report.workflowName}</h1>
          {report.completedAt ? (
            <p className="text-xs text-muted-foreground">
              Completed{' '}
              {new Date(report.completedAt).toLocaleString('en-GB', {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
            </p>
          ) : null}
        </header>

        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Request
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{report.task}</p>
        </section>

        {report.document ? (
          <section className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Source document
            </h2>
            <div className="flex items-center gap-1.5 text-sm">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium">{report.document.name}</span>
              {report.document.truncated ? (
                <span className="text-xs text-muted-foreground">(truncated)</span>
              ) : null}
            </div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-4 font-sans text-[13px] leading-relaxed text-muted-foreground print:max-h-none print:overflow-visible">
              {report.document.text}
            </pre>
          </section>
        ) : null}

        <section className="space-y-6">
          <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Findings
          </h2>

          {report.sections.map((section, index) => {
            const Icon = getAgentIcon(section.agentType);
            const accent = getAgentAccent(section.agentType);

            return (
              <div key={`${section.label}-${index}`} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-md',
                      accent.chip,
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <h3 className="text-sm font-medium">{section.label}</h3>
                  {sectionSubtitle(section) ? (
                    <span className="text-xs text-muted-foreground">
                      {sectionSubtitle(section)}
                    </span>
                  ) : null}
                </div>

                {section.response ? (
                  <p className="whitespace-pre-wrap pl-8 text-sm leading-relaxed">
                    {section.response}
                  </p>
                ) : (
                  <p className="pl-8 text-sm italic text-muted-foreground">{section.note}</p>
                )}
              </div>
            );
          })}
        </section>
      </article>
    </div>
  );
}
