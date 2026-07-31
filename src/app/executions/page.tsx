import type { Metadata } from 'next';
import { ExecutionsView } from '@/components/executions/executions-view';

export const metadata: Metadata = {
  title: 'Executions',
};

export default function ExecutionsPage() {
  return <ExecutionsView />;
}
