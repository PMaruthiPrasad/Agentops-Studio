'use client';

import { useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { CopyButton } from '@/components/shared/copy-button';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { getAgentAccent, getAgentIcon } from '@/lib/agent-ui';
import { cn, formatCost, formatDuration, formatPercent, formatTokens } from '@/lib/utils';
import type { ExecutionStep } from '@/types/execution';

/**
 * One step, collapsed by default.
 *
 * The header carries the numbers you scan for; expanding reveals the exact
 * system prompt, rendered user prompt, and response. Being able to read the
 * literal prompt that produced a given output is the whole point of a tool like
 * this — summarising it would defeat the purpose.
 */
export function StepCard({ step, defaultOpen = false }: { step: ExecutionStep; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  const Icon = getAgentIcon(step.agentType);
  const accent = getAgentAccent(step.agentType);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          'rounded-lg border border-border transition-colors',
          step.status === 'failed' && 'border-destructive/40',
          step.status === 'skipped' && 'opacity-70',
        )}
      >
        <CollapsibleTrigger className="flex w-full items-center gap-3 p-3 text-left">
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />

          <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-md', accent.chip)}>
            <Icon className="size-4" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{step.label}</span>
              <Badge variant="outline" className="shrink-0 font-normal">
                layer {step.layer}
              </Badge>
              {step.retries > 0 ? (
                <Badge variant="warning" className="shrink-0">
                  <RefreshCw className="size-3" />
                  {step.retries} retr{step.retries === 1 ? 'y' : 'ies'}
                </Badge>
              ) : null}
            </span>
            <span className="tabular mt-0.5 block text-xs text-muted-foreground">
              {formatDuration(step.durationMs)} · {formatTokens(step.usage.totalTokens)} tokens ·{' '}
              {formatCost(step.costUsd)} · {formatPercent(step.confidence)} confidence
            </span>
          </span>

          <StatusBadge status={step.status} className="shrink-0" />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-3 border-t border-border p-3">
            {step.skipReason ? (
              <p className="rounded-md border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Skipped:</span> {step.skipReason}
              </p>
            ) : null}

            {step.error ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                <span className="font-medium">Error:</span> {step.error}
              </p>
            ) : null}

            <dl className="tabular grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Provider</dt>
                {/* A skipped step never reached a provider; naming one would
                    imply it was billed. */}
                <dd className="truncate">
                  {step.status === 'skipped' ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    step.provider
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Model</dt>
                <dd className="truncate">{step.model}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Prompt tokens</dt>
                <dd>{formatTokens(step.usage.promptTokens)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Completion tokens</dt>
                <dd>{formatTokens(step.usage.completionTokens)}</dd>
              </div>
            </dl>

            <Section title="System prompt" value={step.systemPrompt} />
            <Section title="User prompt" value={step.prompt} />
            <Section title="Response" value={step.response} emphasis />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function Section({
  title,
  value,
  emphasis = false,
}: {
  title: string;
  value: string;
  emphasis?: boolean;
}) {
  if (!value) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <CopyButton value={value} label={`Copy ${title.toLowerCase()}`} />
      </div>
      <pre
        className={cn(
          'scrollbar-thin max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border p-2.5 font-mono text-[11px] leading-relaxed',
          emphasis ? 'bg-background' : 'bg-muted/40 text-muted-foreground',
        )}
      >
        {value}
      </pre>
    </div>
  );
}
