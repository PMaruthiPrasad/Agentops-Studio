'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Copy,
  Download,
  GitBranch,
  MoreHorizontal,
  Play,
  Star,
  Trash2,
  Waypoints,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Hint } from '@/components/ui/tooltip';
import {
  deleteWorkflow,
  downloadWorkflow,
  duplicateWorkflow,
  toggleFavorite,
} from '@/lib/workflow-actions';
import { cn, formatRelativeTime, toErrorMessage } from '@/lib/utils';
import type { WorkflowSummary } from '@/types/workflow';

interface WorkflowCardProps {
  workflow: WorkflowSummary;
  onChanged: () => void;
}

export function WorkflowCard({ workflow, onChanged }: WorkflowCardProps) {
  const [busy, setBusy] = useState(false);
  // Favorite flips instantly and reverts if the request fails — waiting on a
  // round trip to fill in a star feels broken.
  const [favorite, setFavorite] = useState(workflow.isFavorite);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      onChanged();
    } catch (error) {
      toast.error(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleFavorite() {
    const next = !favorite;
    setFavorite(next);
    try {
      await toggleFavorite(workflow.id);
      onChanged();
    } catch (error) {
      setFavorite(!next);
      toast.error(toErrorMessage(error));
    }
  }

  return (
    <Card className="group flex flex-col gap-3 p-4 transition-colors hover:border-border/70 hover:bg-accent/20">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/workflows/${workflow.id}`} className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold tracking-tight group-hover:text-primary">
            {workflow.name}
          </h3>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {workflow.description || 'No description.'}
          </p>
        </Link>

        <div className="flex shrink-0 items-center">
          <Hint label={favorite ? 'Remove from favorites' : 'Add to favorites'}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleFavorite}
              aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star
                className={cn(
                  'size-4',
                  favorite ? 'fill-warning text-warning' : 'text-muted-foreground',
                )}
              />
            </Button>
          </Hint>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" disabled={busy} aria-label="Workflow actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/workflows/${workflow.id}`}>
                  <Play />
                  Open in builder
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  void run(() => duplicateWorkflow(workflow.id), 'Workflow duplicated.')
                }
              >
                <Copy />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadWorkflow(workflow.id)}>
                <Download />
                Export JSON
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onSelect={() => {
                  if (!window.confirm(`Delete "${workflow.name}" and all of its runs?`)) return;
                  void run(() => deleteWorkflow(workflow.id), 'Workflow deleted.');
                }}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {workflow.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {workflow.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="font-normal">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Waypoints className="size-3.5" />
          {workflow.nodeCount} node{workflow.nodeCount === 1 ? '' : 's'}
        </span>
        <span className="inline-flex items-center gap-1">
          <GitBranch className="size-3.5" />v{workflow.version}
        </span>
        <span className="inline-flex items-center gap-1">
          <Play className="size-3.5" />
          {workflow.executionCount} run{workflow.executionCount === 1 ? '' : 's'}
        </span>
        <span className="ml-auto">{formatRelativeTime(workflow.updatedAt)}</span>
      </div>
    </Card>
  );
}
