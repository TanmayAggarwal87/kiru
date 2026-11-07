import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
  });

  const createMockHost = (requestId = 'test-req-id') => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = { status, json };
    const request = { headers: { 'x-request-id': requestId } };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  };

  it('formats AppError correctly into standard error envelope', () => {
    const { host, status, json } = createMockHost('req-123');
    const appError = new AppError(ErrorCodes.E_FORBIDDEN, 'Access denied', 403, { reason: 'not owner' });

    filter.catch(appError, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: ErrorCodes.E_FORBIDDEN,
        message: 'Access denied',
        requestId: 'req-123',
        details: { reason: 'not owner' },
      },
    });
  });

  it('hides unknown error details and returns E_INTERNAL with 500', () => {
    const { host, status, json } = createMockHost('req-456');
    const unknownError = new Error('Database password was leaked');

    filter.catch(unknownError, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: ErrorCodes.E_INTERNAL,
        message: 'Internal server error',
        requestId: 'req-456',
        details: {},
      },
    });
  });
});
