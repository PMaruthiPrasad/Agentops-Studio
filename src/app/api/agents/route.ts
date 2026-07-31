import { ok, route } from '@/lib/api-response';
import { getProviders, listAgents } from '@/services/agent.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents
 *
 * The agent catalogue that populates the builder palette, plus which LLM
 * providers currently have credentials.
 */
export const GET = route(async () =>
  ok({
    agents: await listAgents(),
    providers: getProviders(),
  }),
);
