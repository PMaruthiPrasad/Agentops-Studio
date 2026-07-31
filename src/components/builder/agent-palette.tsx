'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Hint } from '@/components/ui/tooltip';
import { useAgents } from '@/hooks/use-resources';
import { getAgentAccent, getAgentIcon } from '@/lib/agent-ui';
import { cn, formatCost, formatDuration, groupBy, titleCase } from '@/lib/utils';
import type { AgentType } from '@/types/agent';
import { AGENT_DRAG_TYPE } from './flow-types';

interface AgentPaletteProps {
  /** Click-to-add, for when dragging is awkward (trackpads, touch). */
  onAdd: (type: AgentType) => void;
}

/**
 * The agent catalogue.
 *
 * Entries come from `/api/agents`, which merges built-in definitions with any
 * persisted overrides — so a customised agent shows its real cost and latency
 * here rather than the hard-coded default.
 */
export function AgentPalette({ onAdd }: AgentPaletteProps) {
  const { data, loading } = useAgents();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const agents = data?.agents ?? [];
    const term = query.trim().toLowerCase();

    const filtered = term
      ? agents.filter(
          (agent) =>
            agent.name.toLowerCase().includes(term) ||
            agent.description.toLowerCase().includes(term) ||
            agent.category.toLowerCase().includes(term),
        )
      : agents;

    return [...groupBy(filtered, (agent) => agent.category).entries()];
  }, [data, query]);

  return (
    <div className="flex h-full flex-col border-r border-border bg-card/40">
      <div className="border-b border-border p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Agents</p>
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter agents…"
            className="h-8 pl-8 text-xs"
            aria-label="Filter agents"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          {loading
            ? Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))
            : groups.map(([category, agents]) => (
                <div key={category} className="space-y-1.5">
                  <p className="px-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                    {titleCase(category)}
                  </p>

                  {agents.map((agent) => {
                    const type = agent.type;
                    const Icon = getAgentIcon(type);
                    const accent = getAgentAccent(type);

                    return (
                      <Hint
                        key={agent.id}
                        side="right"
                        label={
                          <div className="max-w-[240px] space-y-1">
                            <p className="font-medium">{agent.name}</p>
                            <p className="text-muted-foreground">{agent.description}</p>
                            <p className="tabular text-muted-foreground">
                              ~{formatDuration(agent.estimatedLatencyMs)} ·{' '}
                              {formatCost(agent.estimatedCostUsd)} · temp {agent.temperature}
                            </p>
                          </div>
                        }
                      >
                        <button
                          type="button"
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData(AGENT_DRAG_TYPE, type);
                            event.dataTransfer.effectAllowed = 'move';
                          }}
                          onClick={() => onAdd(type)}
                          className={cn(
                            'flex w-full cursor-grab items-center gap-2.5 rounded-md border border-transparent px-2 py-2 text-left transition-colors',
                            'hover:border-border hover:bg-accent/60 active:cursor-grabbing',
                          )}
                        >
                          <span
                            className={cn(
                              'flex size-7 shrink-0 items-center justify-center rounded-md',
                              accent.chip,
                            )}
                          >
                            <Icon className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{agent.name}</span>
                            <span className="tabular block truncate text-[10px] text-muted-foreground">
                              ~{formatDuration(agent.estimatedLatencyMs)} ·{' '}
                              {formatCost(agent.estimatedCostUsd)}
                            </span>
                          </span>
                        </button>
                      </Hint>
                    );
                  })}
                </div>
              ))}

          {!loading && groups.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              No agents match “{query}”.
            </p>
          ) : null}
        </div>
      </ScrollArea>

      <p className="border-t border-border p-3 text-[10px] leading-relaxed text-muted-foreground">
        Drag onto the canvas, or click to drop one in the middle.
      </p>
    </div>
  );
}
