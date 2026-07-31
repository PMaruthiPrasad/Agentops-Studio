'use client';

import { useState } from 'react';
import { CommandPalette } from './command-palette';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { useHotkeys } from '@/hooks/use-hotkeys';

/**
 * The persistent chrome: a fixed sidebar, a topbar, and a scrolling content
 * region. Pages render only their own content — none of them re-implement
 * navigation, and the builder can therefore claim the full content area.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useHotkeys([
    {
      key: 'k',
      mod: true,
      allowInInput: true,
      handler: () => setPaletteOpen((open) => !open),
    },
  ]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenPalette={() => setPaletteOpen(true)} />
        <main className="scrollbar-thin flex-1 overflow-y-auto">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
