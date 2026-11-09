import * as path from 'path';
import { verifyMigrationsRls } from '../scripts/check-rls';

describe('RLS enforcement on migrations', () => {
  it('ensures every table created in migrations has RLS enabled', () => {
    const migrationsDir = path.join(__dirname, '../prisma/migrations');
    const result = verifyMigrationsRls(migrationsDir);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
