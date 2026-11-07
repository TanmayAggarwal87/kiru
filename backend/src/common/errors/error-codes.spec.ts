import { ErrorCodes } from './error-codes';

describe('ErrorCodes', () => {
  it('defines all required error codes', () => {
    expect(ErrorCodes.E_UNAUTHENTICATED).toBe('E_UNAUTHENTICATED');
    expect(ErrorCodes.E_FORBIDDEN).toBe('E_FORBIDDEN');
    expect(ErrorCodes.E_NOT_FOUND).toBe('E_NOT_FOUND');
    expect(ErrorCodes.E_VALIDATION).toBe('E_VALIDATION');
    expect(ErrorCodes.E_RATE_LIMITED).toBe('E_RATE_LIMITED');
    expect(ErrorCodes.E_QUOTA_EXCEEDED).toBe('E_QUOTA_EXCEEDED');
    expect(ErrorCodes.E_INTERNAL).toBe('E_INTERNAL');
  });
});
