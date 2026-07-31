'use client';

import { useEffect } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/** Route-level error boundary. Panel-level failures are caught closer to home. */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[route] unhandled error:', error);
  }, [error]);

  return (
    <div className="p-6">
      <Card className="mx-auto flex max-w-lg flex-col items-center gap-3 border-destructive/40 p-10 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-destructive/15">
          <TriangleAlert className="size-5 text-destructive" />
        </div>

        <div className="space-y-1">
          <h1 className="text-sm font-semibold">Something went wrong</h1>
          <p className="break-words text-sm text-muted-foreground">{error.message}</p>
          {error.digest ? (
            <p className="font-mono text-[11px] text-muted-foreground">digest {error.digest}</p>
          ) : null}
        </div>

        <Button size="sm" variant="outline" onClick={reset}>
          <RotateCcw />
          Try again
        </Button>
      </Card>
    </div>
  );
}
