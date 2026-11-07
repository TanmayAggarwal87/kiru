import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  const minimalEnv = {
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    DIRECT_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    R2_ACCOUNT_ID: 'fake-account-id',
    R2_ACCESS_KEY_ID: 'fake-access-key-id',
    R2_SECRET_ACCESS_KEY: 'fake-secret-access-key',
    R2_BUCKET: 'kiru-dev',
    WORKER_TOKEN_HASHES: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  };

  it('populates defaults for valid input', () => {
    const config = validateEnv(minimalEnv);
    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(4000);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.MAX_UPLOAD_BYTES).toBe(2147483648);
  });

  it('throws on missing required variable', () => {
    expect(() => validateEnv({})).toThrow('Environment validation failed');
  });

  it('rejects invalid URL for SUPABASE_URL', () => {
    expect(() => validateEnv({ ...minimalEnv, SUPABASE_URL: 'not-a-url' })).toThrow();
  });
});
