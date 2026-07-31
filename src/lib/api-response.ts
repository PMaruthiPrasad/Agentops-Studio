import { NextResponse } from 'next/server';
import { ZodError, type z } from 'zod';
import { ServiceError } from '@/services/errors';
import { WorkflowValidationError } from '@/lib/workflow/validate';
import { ProviderError } from '@/types/provider';
import type { ApiErrorCode } from '@/types/api';
import { toErrorMessage } from './utils';

/**
 * HTTP boundary helpers.
 *
 * Every route returns the same envelope — `{ data }` on success,
 * `{ error: { code, message, details } }` on failure — and error-to-status
 * mapping lives here alone. Routes stay three lines long and no handler ever
 * invents its own error shape.
 */

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json({ data }, { status: 201 });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status },
  );
}

/**
 * Translate any thrown value into a response.
 *
 * Unknown errors are logged server-side and reported generically — internal
 * messages and stack traces are not something to hand to a client.
 */
export function handleError(error: unknown): NextResponse {
  if (error instanceof ServiceError) {
    return fail(error.code, error.message, error.status, error.details);
  }

  if (error instanceof ZodError) {
    return fail('VALIDATION_ERROR', 'Request validation failed.', 422, formatZodIssues(error));
  }

  if (error instanceof WorkflowValidationError) {
    return fail('VALIDATION_ERROR', error.message, 422, error.issues);
  }

  if (error instanceof ProviderError) {
    return fail('PROVIDER_ERROR', error.message, 502);
  }

  console.error('[api] unhandled error:', error);
  return fail('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
}

export interface ZodIssueSummary {
  path: string;
  message: string;
}

export function formatZodIssues(error: ZodError): ZodIssueSummary[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * Parse a JSON body against a schema. Throws `ZodError` / `ServiceError`.
 *
 * Generic over the schema rather than over a payload type `T`: a schema with
 * `.default()` has an *input* type where that field is optional and an *output*
 * type where it is required. Typing the parameter as `z.ZodType<T>` pins both
 * sides to `T` and hands callers the input type, so every downstream service
 * call sees `field?: X | undefined` where it requires `field: X`.
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    throw ServiceError.badRequest('Request body must be valid JSON.');
  }

  return schema.parse(raw) as z.infer<S>;
}

/** Parse search params against a schema. Throws `ZodError`. */
export function parseQuery<S extends z.ZodTypeAny>(request: Request, schema: S): z.infer<S> {
  const url = new URL(request.url);
  const raw: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (value !== '') raw[key] = value;
  }
  return schema.parse(raw) as z.infer<S>;
}

/** Wrap a handler so no route needs its own try/catch. */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleError(error);
    }
  };
}

export { toErrorMessage };
