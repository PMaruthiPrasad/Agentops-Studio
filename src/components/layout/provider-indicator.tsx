'use client';

import { CircleDot } from 'lucide-react';
import { useAgents } from '@/hooks/use-resources';
import { Skeleton } from '@/components/ui/skeleton';
import { Hint } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Which LLM provider is actually serving requests.
 *
 * This is the fastest way to answer "am I burning real API credits right now?"
 * — a question worth being able to answer at a glance rather than by reading
 * env files.
 */
export function ProviderIndicator() {
  const { data, loading } = useAgents();

  if (loading) {
    return (
      <div className="border-t border-border p-3">
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  const providers = data?.providers ?? [];
  const live = providers.find((provider) => provider.available && provider.id !== 'mock');
  const active = live ?? providers.find((provider) => provider.id === 'mock');
  const isMock = !live;

  return (
    <div className="border-t border-border p-3">
      <Hint
        side="right"
        label={
          isMock
            ? 'Running on the deterministic mock provider — no API keys needed and no spend.'
            : `Live provider: ${active?.name} (${active?.defaultModel}). Real API calls are billed.`
        }
      >
        <div className="flex w-full items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-2 text-left">
          <CircleDot
            className={cn('size-3.5 shrink-0', isMock ? 'text-muted-foreground' : 'text-success')}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{active?.name ?? 'No provider'}</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {isMock ? 'Simulated · no key required' : active?.defaultModel}
            </p>
          </div>
        </div>
      </Hint>
    </div>
  );
}
