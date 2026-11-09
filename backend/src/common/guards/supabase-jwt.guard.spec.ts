import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseJwtGuard } from './supabase-jwt.guard';
import { ConfigService } from '../../config/config.service';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';
import * as jose from 'jose';

jest.mock('jose');

describe('SupabaseJwtGuard', () => {
  let guard: SupabaseJwtGuard;
  let reflector: Reflector;
  let configService: ConfigService;

  beforeEach(() => {
    reflector = new Reflector();
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'SUPABASE_URL') return 'https://test-project.supabase.co';
        return undefined;
      }),
    } as unknown as ConfigService;

    guard = new SupabaseJwtGuard(reflector, configService);
  });

  const createMockContext = (authHeader?: string) => {
    const request = {
      headers: {
        authorization: authHeader,
      },
      user: undefined,
    };

    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      request,
    } as unknown as ExecutionContext & { request: typeof request };
  };

  it('allows access if route is decorated with @Public()', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const context = createMockContext();

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('throws 401 E_UNAUTHENTICATED if authorization header is missing', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const context = createMockContext(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(AppError);
    try {
      await guard.canActivate(context);
    } catch (err: unknown) {
      expect((err as AppError).code).toBe(ErrorCodes.E_UNAUTHENTICATED);
    }
  });

  it('throws 401 E_UNAUTHENTICATED if authorization header is not Bearer', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const context = createMockContext('Basic 12345');

    await expect(guard.canActivate(context)).rejects.toThrow(AppError);
  });

  it('attaches user to request if JWT verification succeeds', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const context = createMockContext('Bearer valid-token');

    (jose.createRemoteJWKSet as jest.Mock).mockReturnValue({});
    (jose.jwtVerify as jest.Mock).mockResolvedValue({
      payload: {
        sub: 'user-uuid-123',
        email: 'user@example.com',
        role: 'authenticated',
      },
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(context.request.user).toEqual({
      id: 'user-uuid-123',
      email: 'user@example.com',
      role: 'authenticated',
      payload: expect.any(Object),
    });
  });

  it('throws 401 E_UNAUTHENTICATED if jwtVerify throws', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const context = createMockContext('Bearer invalid-token');

    (jose.createRemoteJWKSet as jest.Mock).mockReturnValue({});
    (jose.jwtVerify as jest.Mock).mockRejectedValue(new Error('JWT signature verification failed'));

    await expect(guard.canActivate(context)).rejects.toThrow(AppError);
  });
});
