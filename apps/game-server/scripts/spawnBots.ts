/**
 * DEV: spawns bots into the running match (or the lobby / a new room).
 *
 *   pnpm bots            # 20 bots
 *   pnpm bots 50
 */
import { loadRootEnv } from '@extract/server-core';

loadRootEnv();
const count = Number(process.argv[2] ?? 20);
const base = (process.env.GAME_SERVER_URL ?? 'ws://localhost:3002/ws').replace(/^ws/, 'http').replace(/\/ws$/, '');

try {
  const res = await fetch(`${base}/dev/spawn-bots?count=${count}`, { method: 'POST' });
  if (res.status === 404) {
    console.error('Dev tools are disabled on this server (DEV_TOOLS=false or NODE_ENV=production).');
    process.exit(1);
  }
  console.log('[bots]', await res.json());
} catch {
  console.error(`Game server not reachable at ${base}. Is \`pnpm dev\` running?`);
  process.exit(1);
}
