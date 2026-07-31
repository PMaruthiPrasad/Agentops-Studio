import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, toQuery } from './api-client';

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    ...response,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('api client', () => {
  it('unwraps the success envelope', async () => {
    mockFetch({ json: async () => ({ data: { id: 'wf_1' } }) });

    await expect(api.get('/api/workflows/wf_1')).resolves.toEqual({ id: 'wf_1' });
  });

  it('returns undefined for 204 responses without parsing a body', async () => {
    const json = vi.fn();
    mockFetch({ status: 204, json });

    await expect(api.delete('/api/workflows/wf_1')).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it('throws a typed ApiError carrying the server code and details', async () => {
    mockFetch({
      ok: false,
      status: 422,
      json: async () => ({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Workflow graph is invalid: cycle detected',
          details: [{ path: 'graph', message: 'cycle' }],
        },
      }),
    });

    const error = await api.post('/api/workflows', {}).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe('VALIDATION_ERROR');
    expect(apiError.isValidation).toBe(true);
    expect(apiError.message).toContain('cycle detected');
  });

  it('falls back to a generic message when the error body is malformed', async () => {
    mockFetch({ ok: false, status: 500, json: async () => null });

    const error = (await api.get('/api/analytics').catch((cause: unknown) => cause)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(error.message).toBe('Request failed (500).');
  });

  it('reports an unreachable server rather than leaking the fetch failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    const error = (await api.get('/api/health').catch((cause: unknown) => cause)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.message).toBe('Could not reach the server.');
  });

  it('rethrows aborts untouched so callers can ignore them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
    );

    const error = await api.get('/api/health').catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('sets a JSON content type only when there is a body', async () => {
    const fetchMock = mockFetch({ json: async () => ({ data: null }) });

    await api.post('/api/workflows/wf_1/favorite');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({});

    await api.post('/api/workflows', { name: 'x' });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
      'Content-Type': 'application/json',
    });
  });
});

describe('toQuery', () => {
  it('drops undefined and empty values', () => {
    expect(toQuery({ search: 'legal', tag: undefined, favorite: '' })).toBe('?search=legal');
  });

  it('returns an empty string when nothing survives', () => {
    expect(toQuery({ search: undefined })).toBe('');
  });

  it('serialises numbers and booleans', () => {
    expect(toQuery({ days: 30, favorite: true })).toBe('?days=30&favorite=true');
  });
});
