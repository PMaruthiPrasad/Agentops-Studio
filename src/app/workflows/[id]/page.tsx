import type { Metadata } from 'next';
import { WorkflowBuilder } from '@/components/builder/workflow-builder';

export const metadata: Metadata = {
  title: 'Builder',
};

/** Next 15 delivers dynamic route params asynchronously. */
export default async function WorkflowBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorkflowBuilder workflowId={id} />;
}
