'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Boxes, LayoutDashboard, Workflow, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProviderIndicator } from './provider-indicator';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Also highlight for nested routes such as `/workflows/abc`. */
  prefix?: boolean;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/workflows', label: 'Workflows', icon: Workflow, prefix: true },
  { href: '/executions', label: 'Executions', icon: Boxes, prefix: true },
  { href: '/analytics', label: 'Analytics', icon: BarChart3, prefix: true },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-card/40 md:flex">
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary/15 ring-1 ring-inset ring-primary/25">
          <Workflow className="size-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight tracking-tight">
            AgentOps
          </p>
          <p className="truncate text-[10px] uppercase tracking-widest text-muted-foreground">
            Studio
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 p-2" aria-label="Primary">
        {NAV.map((item) => {
          const active = item.prefix
            ? pathname === item.href || pathname.startsWith(`${item.href}/`)
            : pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <item.icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <ProviderIndicator />
    </aside>
  );
}
