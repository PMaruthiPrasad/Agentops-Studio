'use client';

import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  BarChart3,
  Boxes,
  LayoutDashboard,
  Moon,
  Plus,
  Star,
  Sun,
  Workflow,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { useWorkflows } from '@/hooks/use-resources';
import { formatRelativeTime } from '@/lib/utils';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * ⌘K palette. Navigation plus direct jumps into any workflow — the fastest
 * path from "I want to look at the licensing review graph" to having it open.
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const { data: workflows } = useWorkflows();

  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search workflows or jump to a page…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => run(() => router.push('/'))}>
            <LayoutDashboard />
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push('/workflows'))}>
            <Workflow />
            Workflows
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push('/executions'))}>
            <Boxes />
            Executions
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push('/analytics'))}>
            <BarChart3 />
            Analytics
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(() => router.push('/workflows?new=1'))}>
            <Plus />
            New workflow
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => run(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'))}
          >
            {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
            Toggle theme
          </CommandItem>
        </CommandGroup>

        {workflows && workflows.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Workflows">
              {workflows.slice(0, 8).map((workflow) => (
                <CommandItem
                  key={workflow.id}
                  value={`${workflow.name} ${workflow.tags.join(' ')}`}
                  onSelect={() => run(() => router.push(`/workflows/${workflow.id}`))}
                >
                  {workflow.isFavorite ? (
                    <Star className="fill-warning text-warning" />
                  ) : (
                    <Workflow />
                  )}
                  <span className="truncate">{workflow.name}</span>
                  <CommandShortcut className="tracking-normal">
                    {workflow.nodeCount} nodes · {formatRelativeTime(workflow.updatedAt)}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
