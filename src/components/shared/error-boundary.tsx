'use client';

import * as React from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface Props {
  children: React.ReactNode;
  /** Named in the fallback so the user knows which panel died. */
  label?: string;
  fallback?: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Panel-level error boundary.
 *
 * Next's `error.tsx` catches at route level, which takes the whole page down.
 * The builder shows several independent panels, and one failing optimizer
 * request should not blank the canvas — so panels get their own boundary.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ui] panel crashed:', error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): React.ReactNode {
    const { error } = this.state;
    const { children, fallback, label } = this.props;

    if (!error) return children;
    if (fallback) return fallback;

    return (
      <Card className="flex flex-col items-center gap-3 border-destructive/40 p-8 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-destructive/15">
          <TriangleAlert className="size-5 text-destructive" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">{label ?? 'This panel'} failed to render.</p>
          <p className="mx-auto max-w-md break-words text-xs text-muted-foreground">
            {error.message}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={this.reset}>
          <RotateCcw />
          Try again
        </Button>
      </Card>
    );
  }
}
