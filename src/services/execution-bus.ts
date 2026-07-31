import { EventEmitter } from 'node:events';
import type { ExecutionEvent } from '@/types/execution';

/**
 * In-process pub/sub bridging the engine to SSE subscribers.
 *
 * ## Why a module-level emitter
 *
 * A run happens inside one Node process, and the SSE route needs to observe it
 * from a *different* request. An in-memory emitter is the smallest thing that
 * works and keeps the demo dependency-free.
 *
 * ## The limitation, stated plainly
 *
 * This is single-process only. Two server instances behind a load balancer
 * would not see each other's runs. The production shape is a job queue plus
 * Redis pub/sub — the engine already emits a serialisable event stream, so that
 * swap touches this file and nothing else. Documented in the README rather than
 * hidden.
 *
 * A short replay buffer is kept per execution so a client that subscribes a few
 * milliseconds after starting a run doesn't miss the opening events.
 */

const REPLAY_LIMIT = 500;
/** How long a finished run's buffer is retained for late subscribers. */
const BUFFER_TTL_MS = 5 * 60_000;

interface BufferEntry {
  events: ExecutionEvent[];
  finished: boolean;
  expiresAt: number | null;
}

class ExecutionBus {
  private readonly emitter = new EventEmitter();
  private readonly buffers = new Map<string, BufferEntry>();

  constructor() {
    // One listener per SSE connection; the default cap of 10 is far too low.
    this.emitter.setMaxListeners(0);
  }

  publish(event: ExecutionEvent): void {
    const entry = this.ensureBuffer(event.executionId);

    entry.events.push(event);
    if (entry.events.length > REPLAY_LIMIT) {
      entry.events.splice(0, entry.events.length - REPLAY_LIMIT);
    }

    if (event.type === 'run.finish' || event.type === 'run.error') {
      entry.finished = true;
      entry.expiresAt = Date.now() + BUFFER_TTL_MS;
      this.sweep();
    }

    this.emitter.emit(event.executionId, event);
  }

  /**
   * Subscribe to a run. Buffered events are replayed synchronously first, so a
   * subscriber always sees the complete stream regardless of when it attached.
   */
  subscribe(executionId: string, listener: (event: ExecutionEvent) => void): () => void {
    const buffered = this.buffers.get(executionId);
    if (buffered) {
      for (const event of buffered.events) listener(event);
      if (buffered.finished) {
        // Nothing more will arrive; don't leave a listener attached forever.
        return () => {};
      }
    }

    this.emitter.on(executionId, listener);
    return () => this.emitter.off(executionId, listener);
  }

  /** True once the run has emitted a terminal event. */
  isFinished(executionId: string): boolean {
    return this.buffers.get(executionId)?.finished ?? false;
  }

  getBufferedEvents(executionId: string): ExecutionEvent[] {
    return [...(this.buffers.get(executionId)?.events ?? [])];
  }

  private ensureBuffer(executionId: string): BufferEntry {
    let entry = this.buffers.get(executionId);
    if (!entry) {
      entry = { events: [], finished: false, expiresAt: null };
      this.buffers.set(executionId, entry);
    }
    return entry;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.buffers) {
      if (entry.expiresAt !== null && entry.expiresAt < now) {
        this.buffers.delete(id);
      }
    }
  }
}

// Survive Next's dev-server hot reloads, or a run started before an edit would
// become unobservable after it.
const globalForBus = globalThis as unknown as { executionBus: ExecutionBus | undefined };

export const executionBus: ExecutionBus = globalForBus.executionBus ?? new ExecutionBus();

if (process.env.NODE_ENV !== 'production') {
  globalForBus.executionBus = executionBus;
}

/** Serialise an event as an SSE frame. */
export function toSseFrame(event: ExecutionEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
