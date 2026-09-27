/**
 * Solo sandbox: a second game server without bots that starts with one human.
 * Open the client with ?gs=ws://localhost:3102/ws to use it.
 *
 *   pnpm dev:sandbox
 */
process.env.GAME_SERVER_PORT = process.env.SANDBOX_PORT ?? '3102';
process.env.MATCH_FILL_WITH_BOTS = 'false';
process.env.MATCH_MIN_HUMANS = '1';
process.env.LOBBY_WAIT_SECONDS = '2';

await import('../src/index');

export {};
