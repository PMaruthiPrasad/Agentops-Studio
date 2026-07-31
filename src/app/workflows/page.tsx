import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkflowBrowser } from '@/components/workflows/workflow-browser';

export const metadata: Metadata = {
  title: 'Workflows',
};

export default function WorkflowsPage() {
  return (
    // `useSearchParams` inside the browser requires a Suspense boundary, or the
    // whole route opts out of static rendering.
    <Suspense fallback={<Skeleton className="m-6 h-64" />}>
      <WorkflowBrowser />
    </Suspense>
  );
}
