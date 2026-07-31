'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  MoreHorizontal,
  Redo2,
  Save,
  Star,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Hint } from '@/components/ui/tooltip';
import { validateGraph } from '@/lib/workflow/validate';
import {
  deleteWorkflow,
  downloadWorkflow,
  duplicateWorkflow,
  toggleFavorite,
} from '@/lib/workflow-actions';
import { selectCanRedo, selectCanUndo, useBuilderStore } from '@/stores/builder-store';
import { modifierAwareLabel } from '@/hooks/use-hotkeys';
import { cn, toErrorMessage } from '@/lib/utils';

interface BuilderToolbarProps {
  workflowId: string;
  saving: boolean;
  onSave: () => void;
}

export function BuilderToolbar({ workflowId, saving, onSave }: BuilderToolbarProps) {
  const router = useRouter();

  const name = useBuilderStore((state) => state.name);
  const version = useBuilderStore((state) => state.version);
  const dirty = useBuilderStore((state) => state.dirty);
  const isFavorite = useBuilderStore((state) => state.isFavorite);
  const graph = useBuilderStore((state) => state.graph);
  const setMeta = useBuilderStore((state) => state.setMeta);
  const undo = useBuilderStore((state) => state.undo);
  const redo = useBuilderStore((state) => state.redo);
  const canUndo = useBuilderStore(selectCanUndo);
  const canRedo = useBuilderStore(selectCanRedo);

  const [busy, setBusy] = useState(false);

  // Validate on every edit rather than at save time: a cycle is much easier to
  // fix while you still remember making it.
  const validation = useMemo(
    () => (graph.nodes.length === 0 ? { valid: true, errors: [] } : validateGraph(graph)),
    [graph],
  );

  async function onDelete() {
    if (!window.confirm(`Delete "${name}" and all of its runs? This cannot be undone.`)) return;

    setBusy(true);
    try {
      await deleteWorkflow(workflowId);
      toast.success('Workflow deleted.');
      router.push('/workflows');
    } catch (error) {
      toast.error(toErrorMessage(error));
      setBusy(false);
    }
  }

  async function onDuplicate() {
    setBusy(true);
    try {
      const copy = await duplicateWorkflow(workflowId);
      toast.success('Workflow duplicated.');
      router.push(`/workflows/${copy.id}`);
    } catch (error) {
      toast.error(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleFavorite() {
    const next = !isFavorite;
    setMeta({ isFavorite: next });
    try {
      await toggleFavorite(workflowId);
    } catch (error) {
      setMeta({ isFavorite: !next });
      toast.error(toErrorMessage(error));
    }
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
      <Button variant="ghost" size="icon-sm" asChild aria-label="Back to workflows">
        <Link href="/workflows">
          <ArrowLeft className="size-4" />
        </Link>
      </Button>

      <Input
        value={name}
        onChange={(event) => setMeta({ name: event.target.value })}
        className="h-8 max-w-[280px] border-transparent bg-transparent px-2 text-sm font-medium shadow-none hover:border-border focus-visible:border-input"
        aria-label="Workflow name"
        maxLength={120}
      />

      <Badge variant="outline" className="shrink-0">
        v{version}
      </Badge>

      {dirty ? (
        <Badge variant="warning" className="shrink-0">
          Unsaved
        </Badge>
      ) : null}

      {validation.valid ? (
        graph.nodes.length > 0 ? (
          <Hint label="The graph is valid and executable.">
            <span className="hidden items-center gap-1 text-xs text-success sm:inline-flex">
              <CheckCircle2 className="size-3.5" />
              Valid
            </span>
          </Hint>
        ) : null
      ) : (
        <Hint
          label={
            <ul className="max-w-[280px] list-disc space-y-0.5 pl-3">
              {validation.errors.slice(0, 4).map((issue, index) => (
                <li key={index}>{issue.message}</li>
              ))}
            </ul>
          }
        >
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="size-3.5" />
            {validation.errors.length} issue{validation.errors.length === 1 ? '' : 's'}
          </span>
        </Hint>
      )}

      <div className="ml-auto flex items-center gap-1">
        <Hint label={modifierAwareLabel('Undo', 'Z')}>
          <Button variant="ghost" size="icon-sm" onClick={undo} disabled={!canUndo} aria-label="Undo">
            <Undo2 className="size-4" />
          </Button>
        </Hint>

        <Hint label={modifierAwareLabel('Redo', '⇧Z')}>
          <Button variant="ghost" size="icon-sm" onClick={redo} disabled={!canRedo} aria-label="Redo">
            <Redo2 className="size-4" />
          </Button>
        </Hint>

        <Hint label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleFavorite}
            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star className={cn('size-4', isFavorite && 'fill-warning text-warning')} />
          </Button>
        </Hint>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={busy} aria-label="More actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void onDuplicate()}>
              <Copy />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => downloadWorkflow(workflowId)}>
              <Download />
              Export JSON
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => void onDelete()}>
              <Trash2 />
              Delete workflow
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Hint label={modifierAwareLabel('Save', 'S')}>
          <Button
            size="sm"
            onClick={onSave}
            loading={saving}
            disabled={!dirty || !validation.valid}
          >
            <Save />
            Save
          </Button>
        </Hint>
      </div>
    </header>
  );
}
