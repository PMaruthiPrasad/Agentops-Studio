import type { Metadata } from 'next';
import { ExecutionReport } from '@/components/executions/execution-report';

export const metadata: Metadata = {
  title: 'Report',
};

export default async function ExecutionReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExecutionReport executionId={id} />;
}
