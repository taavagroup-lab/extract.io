import { findRepoRoot, loadRootEnv } from '@extract/server-core';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { testDatabaseUrl } from './testDb';

/** Migrates + seeds the isolated test schema once per test run (skipped without a database). */
export default function setup(): void {
  loadRootEnv();
  const url = testDatabaseUrl();
  if (!url) return;
  const cwd = join(findRepoRoot(), 'packages', 'database');
  const env = { ...process.env, DATABASE_URL: url, CHECKPOINT_DISABLE: '1', SEED_DEMO_MARKET: 'false' };
  try {
    execSync('pnpm exec prisma migrate deploy', { cwd, env, stdio: 'pipe' });
    execSync('pnpm exec tsx prisma/seed.ts', { cwd, env, stdio: 'pipe' });
  } catch (err) {
    console.warn('[api tests] could not prepare the test schema; integration tests will be skipped.', (err as Error).message);
  }
}
