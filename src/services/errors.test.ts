import { describe, expect, it } from 'vitest';
import { ServiceError } from './errors';

describe('ServiceError', () => {
  it('is a real Error so stack traces and instanceof both work', () => {
    const error = ServiceError.notFound('Workflow', 'wf_1');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.name).toBe('ServiceError');
  });

  it.each([
    ['notFound', ServiceError.notFound('Workflow', 'wf_1'), 'NOT_FOUND', 404],
    ['badRequest', ServiceError.badRequest('bad input'), 'BAD_REQUEST', 400],
    ['validation', ServiceError.validation('invalid graph'), 'VALIDATION_ERROR', 422],
    ['conflict', ServiceError.conflict('already exists'), 'CONFLICT', 409],
    ['engine', ServiceError.engine('engine blew up'), 'ENGINE_ERROR', 500],
  ])('%s maps to %s / %i', (_name, error, code, status) => {
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
  });

  it('names the missing resource and its id', () => {
    expect(ServiceError.notFound('Workflow', 'wf_1').message).toBe('Workflow "wf_1" was not found.');
  });

  it('omits the id when there is not one', () => {
    expect(ServiceError.notFound('Workflow').message).toBe('Workflow was not found.');
  });

  it('carries structured details through for the API layer to surface', () => {
    const details = [{ path: 'graph.nodes', message: 'cycle detected' }];
    const error = ServiceError.validation('Workflow graph is invalid', details);

    expect(error.details).toBe(details);
  });

  it('leaves details undefined when none are supplied', () => {
    expect(ServiceError.conflict('nope').details).toBeUndefined();
  });
});
