'use client';

import { useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { Plus, Search, Star, Upload, Workflow as WorkflowIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateWorkflowDialog } from './create-workflow-dialog';
import { WorkflowCard } from './workflow-card';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTags, useWorkflows } from '@/hooks/use-resources';
import { importWorkflowFile } from '@/lib/workflow-actions';
import { cn, toErrorMessage } from '@/lib/utils';

/**
 * The workflow library: search, tag filter, favorites, import, create.
 *
 * Filtering happens server-side (the API supports `search`, `tag`, and
 * `favorite`) rather than by filtering a fetched array, so this page behaves
 * the same at 10 workflows and at 10,000.
 */
export function WorkflowBrowser() {
  const searchParams = useSearchParams();

  const [search, setSearch] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 250);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: workflows, loading, error, refresh } = useWorkflows({
    search: debouncedSearch || undefined,
    tag: tag ?? undefined,
    favorite: favoritesOnly ? true : undefined,
  });

  const { data: tags, refresh: refreshTags } = useTags();

  // `?new=1` opens the create dialog — lets the command palette deep-link here.
  useEffect(() => {
    if (searchParams.get('new') === '1') setCreateOpen(true);
  }, [searchParams]);

  async function onImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset immediately so re-picking the same file still fires a change event.
    event.target.value = '';
    if (!file) return;

    try {
      const workflow = await importWorkflowFile(file);
      toast.success(`Imported "${workflow.name}".`);
      refresh();
      refreshTags();
    } catch (cause) {
      toast.error(toErrorMessage(cause));
    }
  }

  const hasFilters = Boolean(debouncedSearch || tag || favoritesOnly);

  function clearFilters() {
    setSearch('');
    setTag(null);
    setFavoritesOnly(false);
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Workflows</h1>
          <p className="text-sm text-muted-foreground">
            Agent graphs you can edit, execute, and optimize.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onImport}
          />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload />
            Import
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            New workflow
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search workflows…"
            className="pl-8"
            aria-label="Search workflows"
          />
        </div>

        <Button
          variant={favoritesOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFavoritesOnly((value) => !value)}
        >
          <Star className={cn(favoritesOnly && 'fill-current')} />
          Favorites
        </Button>

        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X />
            Clear
          </Button>
        ) : null}
      </div>

      {tags && tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((entry) => (
            <button
              key={entry.tag}
              type="button"
              onClick={() => setTag(tag === entry.tag ? null : entry.tag)}
              aria-pressed={tag === entry.tag}
            >
              <Badge
                variant={tag === entry.tag ? 'default' : 'outline'}
                className="cursor-pointer transition-colors hover:border-primary/50"
              >
                {entry.tag}
                <span className="text-muted-foreground">{entry.count}</span>
              </Badge>
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <Card className="border-destructive/40 p-6 text-sm">
          <p className="font-medium text-destructive">Could not load workflows.</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={refresh}>
            Retry
          </Button>
        </Card>
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-40" />
          ))}
        </div>
      ) : workflows && workflows.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {workflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              onChanged={() => {
                refresh();
                refreshTags();
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={WorkflowIcon}
          title={hasFilters ? 'No workflows match those filters' : 'No workflows yet'}
          description={
            hasFilters
              ? 'Try a different search term, or clear the filters.'
              : 'Create one from scratch, or run `npm run db:seed` to load three worked examples.'
          }
          action={
            hasFilters ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus />
                New workflow
              </Button>
            )
          }
        />
      )}

      <CreateWorkflowDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
