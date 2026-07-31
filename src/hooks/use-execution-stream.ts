'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type {
  ExecutionEvent,
  ExecutionMetrics,
  ExecutionStatus,
  LiveNodeState,
} from '@/types/execution';

/**
 * Live run subscription.
 *
 * The server publishes named SSE events (`event: step.finish`), so each type is
 * registered individually — an `onmessage` handler alone would never fire.
 *
 * `EventSource` reconnects automatically, and the server replays a run's
 * buffered events on connect, so a dropped connection self-heals without any
 * retry logic here.
 */

export type StreamPhase = 'idle' | 'connecting' | 'running' | 'finished' | 'error';

export interface LiveRunState {
  phase: StreamPhase;
  /** Terminal status of the run, once known. */
  status: ExecutionStatus | null;
  /** Per-node view model, keyed by node id. */
  nodes: Record<string, LiveNodeState>;
  /** Topological layers reported at run start — drives the progress readout. */
  layers: string[][];
  metrics: ExecutionMetrics | null;
  events: ExecutionEvent[];
  error: string | null;
}

const INITIAL: LiveRunState = {
  phase: 'idle',
  status: null,
  nodes: {},
  layers: [],
  metrics: null,
  events: [],
  error: null,
};

type Action =
  | { kind: 'reset' }
  | { kind: 'connecting' }
  | { kind: 'event'; event: ExecutionEvent }
  | { kind: 'closed' }
  | { kind: 'error'; message: string };

function emptyNode(nodeId: string): LiveNodeState {
  return {
    nodeId,
    status: 'pending',
    attempt: 0,
    durationMs: 0,
    costUsd: 0,
    totalTokens: 0,
    confidence: 0,
    error: null,
  };
}

function reduce(state: LiveRunState, action: Action): LiveRunState {
  switch (action.kind) {
    case 'reset':
      return INITIAL;

    case 'connecting':
      return { ...INITIAL, phase: 'connecting' };

    case 'closed':
      // The run had already finished before we attached; keep whatever the
      // replay gave us rather than reporting an error.
      return state.phase === 'finished' ? state : { ...state, phase: 'finished' };

    case 'error':
      return { ...state, phase: 'error', error: action.message };

    case 'event': {
      const event = action.event;
      const events = [...state.events, event];

      switch (event.type) {
        case 'run.start': {
          const nodes: Record<string, LiveNodeState> = {};
          for (const layer of event.layers) {
            for (const nodeId of layer) nodes[nodeId] = emptyNode(nodeId);
          }
          return { ...state, phase: 'running', layers: event.layers, nodes, events };
        }

        case 'step.start': {
          const current = state.nodes[event.nodeId] ?? emptyNode(event.nodeId);
          return {
            ...state,
            phase: 'running',
            events,
            nodes: {
              ...state.nodes,
              [event.nodeId]: { ...current, status: 'running', attempt: event.attempt },
            },
          };
        }

        case 'step.retry': {
          const current = state.nodes[event.nodeId] ?? emptyNode(event.nodeId);
          return {
            ...state,
            events,
            nodes: {
              ...state.nodes,
              [event.nodeId]: {
                ...current,
                status: 'running',
                attempt: event.attempt,
                error: event.error,
              },
            },
          };
        }

        case 'step.finish': {
          const step = event.step;
          return {
            ...state,
            events,
            nodes: {
              ...state.nodes,
              [event.nodeId]: {
                nodeId: event.nodeId,
                status: step.status,
                attempt: step.attempts,
                durationMs: step.durationMs,
                costUsd: step.costUsd,
                totalTokens: step.usage.totalTokens,
                confidence: step.confidence,
                error: step.error,
              },
            },
          };
        }

        case 'step.skip': {
          const current = state.nodes[event.nodeId] ?? emptyNode(event.nodeId);
          return {
            ...state,
            events,
            nodes: {
              ...state.nodes,
              [event.nodeId]: { ...current, status: 'skipped', error: null },
            },
          };
        }

        case 'run.finish':
          return {
            ...state,
            phase: 'finished',
            status: event.status,
            metrics: event.metrics,
            error: event.error,
            events,
          };

        case 'run.error':
          return { ...state, phase: 'error', error: event.error, events };

        default:
          return { ...state, events };
      }
    }

    default:
      return state;
  }
}

const EVENT_TYPES: ExecutionEvent['type'][] = [
  'run.start',
  'step.start',
  'step.retry',
  'step.finish',
  'step.skip',
  'run.finish',
  'run.error',
];

export interface UseExecutionStreamResult extends LiveRunState {
  /** Fraction of nodes in a terminal state, 0..1. */
  progress: number;
  reset: () => void;
}

export function useExecutionStream(
  executionId: string | null,
  options: { onFinish?: (status: ExecutionStatus) => void } = {},
): UseExecutionStreamResult {
  const [state, dispatch] = useReducer(reduce, INITIAL);

  const onFinishRef = useRef(options.onFinish);
  onFinishRef.current = options.onFinish;

  useEffect(() => {
    if (!executionId) {
      dispatch({ kind: 'reset' });
      return;
    }

    dispatch({ kind: 'connecting' });
    const source = new EventSource(`/api/executions/${executionId}/stream`);
    let settled = false;

    const handle = (raw: MessageEvent<string>) => {
      try {
        const event = JSON.parse(raw.data) as ExecutionEvent;
        dispatch({ kind: 'event', event });

        if (event.type === 'run.finish') {
          settled = true;
          onFinishRef.current?.(event.status);
          source.close();
        } else if (event.type === 'run.error') {
          settled = true;
          source.close();
        }
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    };

    for (const type of EVENT_TYPES) {
      source.addEventListener(type, handle as EventListener);
    }

    source.addEventListener('run.closed', () => {
      settled = true;
      dispatch({ kind: 'closed' });
      source.close();
    });

    source.onerror = () => {
      // EventSource fires `error` on every reconnect attempt, including the
      // normal close after a completed run. Only surface it if we never got a
      // terminal event.
      if (settled) return;
      if (source.readyState === EventSource.CLOSED) {
        dispatch({ kind: 'error', message: 'Lost connection to the execution stream.' });
      }
    };

    return () => {
      settled = true;
      source.close();
    };
  }, [executionId]);

  const reset = useCallback(() => dispatch({ kind: 'reset' }), []);

  const nodeList = Object.values(state.nodes);
  const done = nodeList.filter(
    (node) => node.status === 'success' || node.status === 'failed' || node.status === 'skipped',
  ).length;

  return {
    ...state,
    progress: nodeList.length === 0 ? 0 : done / nodeList.length,
    reset,
  };
}
