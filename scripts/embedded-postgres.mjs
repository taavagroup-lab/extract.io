// Runs a real PostgreSQL server from npm binaries (no Docker required).
// Data lives in ./.data/pg. Credentials match docker-compose.yml / .env.example.
//
//   pnpm db:embedded          start (Ctrl+C to stop)
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, '.data', 'pg');
const port = Number(process.env.PG_PORT ?? 5432);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'extract',
  password: 'extract',
  port,
  persistent: true,
  // UTF-8 regardless of the host OS locale (Windows would default to WIN1252).
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

const fresh = !existsSync(resolve(dataDir, 'PG_VERSION'));
if (fresh) {
  console.log('[embedded-postgres] initialising cluster in', dataDir);
  await pg.initialise();
}
await pg.start();
if (fresh) {
  await pg.createDatabase('extractio');
  console.log('[embedded-postgres] created database "extractio"');
}
console.log(`[embedded-postgres] running on postgresql://extract:extract@localhost:${port}/extractio`);

const shutdown = async () => {
  console.log('\n[embedded-postgres] stopping...');
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Keep the process alive.
setInterval(() => {}, 1 << 30);
