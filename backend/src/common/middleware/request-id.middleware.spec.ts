import { RequestIdMiddleware } from './request-id.middleware';
import { Request, Response } from 'express';

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
  });

  it('preserves existing x-request-id header', () => {
    const req = { headers: { 'x-request-id': 'custom-id' } } as unknown as Request;
    const setHeaderMock = jest.fn();
    const res = { setHeader: setHeaderMock } as unknown as Response;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(setHeaderMock).toHaveBeenCalledWith('x-request-id', 'custom-id');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('generates a new uuid if x-request-id is missing', () => {
    const req = { headers: {} } as unknown as Request;
    const setHeaderMock = jest.fn();
    const res = { setHeader: setHeaderMock } as unknown as Response;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.headers['x-request-id']).toBeDefined();
    expect(setHeaderMock).toHaveBeenCalledWith('x-request-id', req.headers['x-request-id']);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
