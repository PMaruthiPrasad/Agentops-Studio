import type { Metadata } from 'next';
import { ExecutionDetail } from '@/components/executions/execution-detail';

export const metadata: Metadata = {
  title: 'Execution',
};

export default async function ExecutionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ExecutionDetail executionId={id} />;
}
