import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from './config.service';

describe('ConfigService', () => {
  let service: ConfigService;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      DIRECT_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      R2_ACCOUNT_ID: 'fake-account-id',
      R2_ACCESS_KEY_ID: 'fake-access-key-id',
      R2_SECRET_ACCESS_KEY: 'fake-secret-access-key',
      R2_BUCKET: 'kiru-dev',
      WORKER_TOKEN_HASHES: 'hash1,hash2',
      CORS_ORIGINS: 'http://localhost:3000,https://app.example.com',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ConfigService],
    }).compile();

    service = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should be defined and return parsed config', () => {
    expect(service).toBeDefined();
    expect(service.get('PORT')).toBe(4000);
    expect(service.corsOrigins).toEqual(['http://localhost:3000', 'https://app.example.com']);
    expect(service.workerTokenHashes).toEqual(['hash1', 'hash2']);
    expect(service.isProduction).toBe(false);
  });
});
