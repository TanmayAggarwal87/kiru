import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z.string().min(1).default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  WORKER_TOKEN_HASHES: z.string().min(1),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(2147483648),
  MAX_VIDEO_SECONDS: z.coerce.number().int().positive().default(3600),
  PRESIGN_PUT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  PRESIGN_GET_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  DOWNLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  RETENTION_SOURCE_DAYS: z.coerce.number().int().positive().default(3),
  RETENTION_INTERMEDIATE_DAYS: z.coerce.number().int().positive().default(1),
  RETENTION_CLIP_DAYS: z.coerce.number().int().positive().default(30),
  PLAN_FREE_MINUTES_PER_MONTH: z.coerce.number().int().positive().default(120),
  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(rawEnv: Record<string, unknown> = process.env): Env {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    const formatted = result.error.format();
    const missingOrInvalid = Object.entries(formatted)
      .filter(([key]) => key !== '_errors')
      .map(([key, val]) => `  - ${key}: ${(val as { _errors?: string[] })._errors?.join(', ')}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${missingOrInvalid}`);
  }
  return result.data;
}
