import { ok, route } from '@/lib/api-response';
import { prisma } from '@/lib/db';
import { getActiveProviderId, getProviderStatuses } from '@/lib/providers/registry';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 *
 * Reports database reachability and which provider is actually serving
 * requests — the fastest way to confirm "yes, it's running on the mock" without
 * reading any code.
 */
export const GET = route(async () => {
  let database: 'up' | 'down' = 'up';

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'down';
  }

  return ok({
    status: database === 'up' ? 'healthy' : 'degraded',
    database,
    activeProvider: getActiveProviderId(),
    providers: getProviderStatuses(),
    timestamp: new Date().toISOString(),
  });
});
