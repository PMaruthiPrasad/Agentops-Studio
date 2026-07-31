'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Moon, Search, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/tooltip';
import { modifierSymbol } from '@/hooks/use-hotkeys';
import { titleCase } from '@/lib/utils';

/** Derives breadcrumb trail from the path — no route needs to declare one. */
function useCrumbs(): Array<{ href: string; label: string }> {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return [{ href: '/', label: 'Dashboard' }];

  return segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join('/')}`;
    // Ids are opaque; showing a truncated one beats showing nothing.
    const isId = /^[a-z0-9_-]{16,}$/i.test(segment);
    return { href, label: isId ? `${segment.slice(0, 8)}…` : titleCase(segment) };
  });
}

export function Topbar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const crumbs = useCrumbs();
  const { resolvedTheme, setTheme } = useTheme();

  // The theme is unknown until after hydration; rendering the icon early would
  // guarantee a mismatch warning and a flash of the wrong glyph.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex items-center gap-1.5 text-sm">
          {crumbs.map((crumb, index) => (
            <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
              {index > 0 ? <span className="text-muted-foreground/50">/</span> : null}
              {index === crumbs.length - 1 ? (
                <span className="truncate font-medium">{crumb.label}</span>
              ) : (
                <Link
                  href={crumb.href}
                  className="truncate text-muted-foreground transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <Button
        variant="outline"
        size="sm"
        onClick={onOpenPalette}
        className="gap-2 text-muted-foreground"
      >
        <Search className="size-3.5" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="ml-1 hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:inline">
          {mounted ? modifierSymbol() : 'Ctrl'}K
        </kbd>
      </Button>

      <Hint label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle theme"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        >
          {mounted && resolvedTheme === 'light' ? (
            <Sun className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </Button>
      </Hint>
    </header>
  );
}
