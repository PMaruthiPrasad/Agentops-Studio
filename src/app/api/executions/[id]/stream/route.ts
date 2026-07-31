import type { NextRequest } from 'next/server';
import { executionBus, toSseFrame } from '@/services/execution-bus';
import { isExecutionComplete } from '@/services/execution.service';

export const dynamic = 'force-dynamic';
// Node runtime: the bus uses `node:events` and shares a process with the engine.
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

/** Keeps proxies from closing an idle connection mid-run. */
const HEARTBEAT_MS = 15_000;

/**
 * GET /api/executions/:id/stream — Server-Sent Events.
 *
 * Emits `run.start`, `step.start`, `step.retry`, `step.skip`, `step.finish`,
 * and `run.finish`. Any events already buffered for this run are replayed
 * immediately on connect, so a client that subscribes a moment after starting
 * the run still receives the complete stream.
 *
 * SSE rather than WebSockets: the data flows one way, it survives proxies, and
 * `EventSource` reconnects on its own. A socket would be strictly more moving
 * parts for no benefit here.
 */
export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const send = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client went away between the check and the enqueue.
          closed = true;
        }
      };

      const close = (): void => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      // Comment frame: opens the stream immediately so the client's
      // `onopen` fires without waiting for the first real event.
      send(': connected\n\n');

      unsubscribe = executionBus.subscribe(id, (event) => {
        send(toSseFrame(event));
        if (event.type === 'run.finish' || event.type === 'run.error') {
          // Give the frame a tick to flush before tearing the stream down.
          setTimeout(close, 50);
        }
      });

      // Cover the case where the run finished before anyone subscribed and its
      // buffer has already been swept.
      if (executionBus.isFinished(id) || (await isExecutionComplete(id))) {
        send(`event: run.closed\ndata: ${JSON.stringify({ executionId: id })}\n\n`);
        setTimeout(close, 50);
        return;
      }

      heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);

      request.signal.addEventListener('abort', close, { once: true });
    },

    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disables buffering in nginx-style proxies, which otherwise hold the
      // whole stream until the run completes.
      'X-Accel-Buffering': 'no',
    },
  });
}
