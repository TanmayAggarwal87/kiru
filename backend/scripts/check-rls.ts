import * as fs from 'fs';
import * as path from 'path';

export function verifyMigrationsRls(migrationsDir: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!fs.existsSync(migrationsDir)) {
    return { valid: true, errors: [] };
  }

  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sqlPath = path.join(migrationsDir, entry.name, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;

    const content = fs.readFileSync(sqlPath, 'utf8');
    const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/gi;
    let match: RegExpExecArray | null;
    const tables: string[] = [];

    while ((match = createTableRegex.exec(content)) !== null) {
      const tableName = match[1];
      if (tableName === '_prisma_migrations') continue;
      tables.push(tableName);
    }

    for (const table of tables) {
      const rlsRegex = new RegExp(`ALTER\\s+TABLE\\s+["']?${table}["']?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
      if (!rlsRegex.test(content)) {
        errors.push(`Table "${table}" in migration "${entry.name}" does not have RLS enabled.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

if (typeof require !== 'undefined' && require.main === module) {
  const migrationsDir = path.join(__dirname, '../prisma/migrations');
  const result = verifyMigrationsRls(migrationsDir);
  if (!result.valid) {
    console.error('RLS check failed:\n' + result.errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
  console.log('RLS check passed: All tables have Row Level Security enabled.');
}
