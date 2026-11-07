import { AppError } from './app-error';
import { ErrorCodes } from './error-codes';

describe('AppError', () => {
  it('creates an AppError with default status for code', () => {
    const err = new AppError(ErrorCodes.E_NOT_FOUND, 'Project not found');
    expect(err.getStatus()).toBe(404);
    expect(err.code).toBe(ErrorCodes.E_NOT_FOUND);
    expect(err.message).toBe('Project not found');
    expect(err.details).toEqual({});
  });

  it('allows overriding status and passing details', () => {
    const err = new AppError(ErrorCodes.E_VALIDATION, 'Bad payload', 422, { field: 'email' });
    expect(err.getStatus()).toBe(422);
    expect(err.details).toEqual({ field: 'email' });
  });
});
