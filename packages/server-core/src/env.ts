import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Walks up from `start` until it finds the monorepo root (pnpm-workspace.yaml). */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

let loaded = false;

/** Loads the root `.env` once (existing process env vars win). */
export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = join(findRepoRoot(), '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export function envStr(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
}

export function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be a number`);
  return Math.trunc(n);
}

export function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Minimum secret length enforced in production. */
export function requireJwtSecret(): string {
  const secret = envStr('JWT_SECRET', isProduction() ? undefined : 'dev-only-secret-change-me-0123456789abcdef');
  if (isProduction() && secret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');
  return secret;
}
