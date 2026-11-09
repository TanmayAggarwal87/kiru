import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ConfigService } from '../../config/config.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';

@Injectable()
export class SupabaseJwtGuard implements CanActivate {
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private jwksUrl: string | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  private getJWKS() {
    const supabaseUrl = this.config.get('SUPABASE_URL');
    const targetUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;

    if (!this.jwks || this.jwksUrl !== targetUrl) {
      this.jwksUrl = targetUrl;
      this.jwks = createRemoteJWKSet(new URL(targetUrl), {
        cacheMaxAge: 10 * 60 * 1000,
        cooldownDuration: 30 * 1000,
      });
    }

    return this.jwks;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || typeof authHeader !== 'string') {
      throw new AppError(ErrorCodes.E_UNAUTHENTICATED, 'Missing authorization header', 401);
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new AppError(ErrorCodes.E_UNAUTHENTICATED, 'Invalid authorization format. Bearer token required.', 401);
    }

    try {
      const supabaseUrl = this.config.get('SUPABASE_URL');
      const jwks = this.getJWKS();

      const { payload } = await jwtVerify(token, jwks, {
        issuer: `${supabaseUrl}/auth/v1`,
        audience: 'authenticated',
        clockTolerance: 10,
      });

      if (!payload.sub) {
        throw new AppError(ErrorCodes.E_UNAUTHENTICATED, 'Token missing sub claim', 401);
      }

      request.user = {
        id: payload.sub,
        email: payload.email as string,
        role: payload.role as string,
        payload,
      };

      return true;
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError(
        ErrorCodes.E_UNAUTHENTICATED,
        err instanceof Error ? err.message : 'Invalid or expired token',
        401,
      );
    }
  }
}
