// Creates `.env` from `.env.example` if it does not exist yet.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, '.env');
const example = resolve(root, '.env.example');

if (existsSync(target)) {
  console.log('[setup] .env already exists - leaving it untouched.');
} else {
  copyFileSync(example, target);
  console.log('[setup] created .env from .env.example');
}
