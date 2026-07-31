import type { ApiErrorBody, ApiErrorCode } from '@/types/api';

/**
 * Browser-side API client.
 *
 * Every route answers with `{ data }` or `{ error }`; unwrapping that in one
 * place means no component ever touches `response.ok` or reaches into an error
 * envelope by hand.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ApiErrorCode = 'INTERNAL_ERROR',
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True for errors the user can fix by editing their input. */
  get isValidation(): boolean {
    return this.code === 'VALIDATION_ERROR' || this.code === 'BAD_REQUEST';
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ApiErrorBody).error?.message === 'string'
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    // Network-level failure: the server never answered.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Could not reach the server.', 0, 'INTERNAL_ERROR');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (isErrorBody(payload)) {
      throw new ApiError(
        payload.error.message,
        response.status,
        payload.error.code,
        payload.error.details,
      );
    }
    throw new ApiError(`Request failed (${response.status}).`, response.status);
  }

  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data;
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, init?: RequestInit): Promise<T> =>
    request<T>(path, { ...init, method: 'GET' }),

  post: <T>(path: string, body?: unknown, init?: RequestInit): Promise<T> =>
    request<T>(path, {
      ...init,
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),

  patch: <T>(path: string, body: unknown, init?: RequestInit): Promise<T> =>
    request<T>(path, { ...init, method: 'PATCH', body: JSON.stringify(body) }),

  delete: <T = void>(path: string, init?: RequestInit): Promise<T> =>
    request<T>(path, { ...init, method: 'DELETE' }),
};

/** Build a query string, dropping empty values so `?search=` never appears. */
export function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}
