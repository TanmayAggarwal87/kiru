import 'dotenv/config';
import { Injectable } from '@nestjs/common';
import { Env, validateEnv } from './env.schema';

@Injectable()
export class ConfigService {
  private readonly env: Env;

  constructor() {
    this.env = validateEnv(process.env);
  }

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get corsOrigins(): string[] {
    return this.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  }

  get workerTokenHashes(): string[] {
    return this.env.WORKER_TOKEN_HASHES.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }

  get values(): Readonly<Env> {
    return this.env;
  }
}
