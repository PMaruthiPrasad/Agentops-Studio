import type { ApiErrorCode } from '@/types/api';

/**
 * Service-layer errors.
 *
 * Services throw these; the API layer maps them to status codes in exactly one
 * place. That keeps HTTP concerns out of the services and means a service can
 * be called from a script or a test without pretending to be a request.
 */
export class ServiceError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ServiceError';
  }

  static notFound(resource: string, id?: string): ServiceError {
    return new ServiceError(
      'NOT_FOUND',
      id ? `${resource} "${id}" was not found.` : `${resource} was not found.`,
      404,
    );
  }

  static badRequest(message: string, details?: unknown): ServiceError {
    return new ServiceError('BAD_REQUEST', message, 400, details);
  }

  static validation(message: string, details?: unknown): ServiceError {
    return new ServiceError('VALIDATION_ERROR', message, 422, details);
  }

  static conflict(message: string): ServiceError {
    return new ServiceError('CONFLICT', message, 409);
  }

  static engine(message: string, details?: unknown): ServiceError {
    return new ServiceError('ENGINE_ERROR', message, 500, details);
  }
}
