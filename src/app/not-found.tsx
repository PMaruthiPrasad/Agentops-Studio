import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function NotFound() {
  return (
    <div className="p-6">
      <Card className="mx-auto flex max-w-lg flex-col items-center gap-3 p-10 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-muted">
          <Compass className="size-5 text-muted-foreground" />
        </div>

        <div className="space-y-1">
          <h1 className="text-sm font-semibold">Page not found</h1>
          <p className="text-sm text-muted-foreground">
            That workflow or run may have been deleted.
          </p>
        </div>

        <Button size="sm" variant="outline" asChild>
          <Link href="/">Back to dashboard</Link>
        </Button>
      </Card>
    </div>
  );
}
