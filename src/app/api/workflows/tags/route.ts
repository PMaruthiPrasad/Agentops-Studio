import { ok, route } from '@/lib/api-response';
import { listAllTags } from '@/services/workflow.service';

export const dynamic = 'force-dynamic';

/** GET /api/workflows/tags — every tag in use, with its workflow count. */
export const GET = route(async () => ok(await listAllTags()));
