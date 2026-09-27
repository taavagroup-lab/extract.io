/**
 * Load test: N simulated clients connect over WebSocket, join matchmaking and
 * play (move, aim, shoot, loot) while server metrics are sampled.
 *
 *   pnpm loadtest                       # 20 clients, 60 s
 *   pnpm loadtest --clients 50
 *   pnpm loadtest --clients 100 --duration 120
 *
 * Tip: start the game server with MATCH_TARGET_PLAYERS=100 to put 100 clients
 * into a single match. Requires ALLOW_ANONYMOUS_PLAY=true (dev default).
 */
import { NETWORK_CONFIG } from '@extract/game-config';
import { INPUT_BUTTONS, type ClientMessage, type ServerMessage } from '@extract/game-types';
import { loadRootEnv } from '@extract/server-core';
import { decodeMessage, encodeMessage } from '@extract/shared';
import { WebSocket } from 'ws';

loadRootEnv();

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const CLIENTS = Number(arg('clients', '20'));
const DURATION_S = Number(arg('duration', '60'));
const WS_URL = arg('url', process.env.GAME_SERVER_URL ?? 'ws://localhost:3002/ws');
const METRICS_URL = arg('metrics', WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '/metrics'));
const RAMP_MS = Number(arg('ramp', '50'));

interface Stats {
  connected: number;
  playing: number;
  dead: number;
  extracted: number;
  errors: number;
  msgsIn: number;
  bytesIn: number;
  snapshots: number;
}
const stats: Stats = { connected: 0, playing: 0, dead: 0, extracted: 0, errors: 0, msgsIn: 0, bytesIn: 0, snapshots: 0 };

class SimClient {
  private ws: WebSocket;
  private seq = 0;
  private mx = 0;
  private my = 0;
  private aim = 0;
  private fire = false;
  private playing = false;
  private timer: NodeJS.Timeout | null = null;
  private nextChange = 0;

  constructor(readonly index: number) {
    this.ws = new WebSocket(WS_URL);
    this.ws.binaryType = 'nodebuffer';
    this.ws.on('open', () => {
      stats.connected++;
      this.send({ t: 'join', token: null, name: `load_${index}` });
    });
    this.ws.on('message', (data: Buffer) => this.onMessage(data));
    this.ws.on('close', () => {
      stats.connected--;
      this.stop();
    });
    this.ws.on('error', () => {
      stats.errors++;
    });
  }

  private send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encodeMessage(msg));
  }

  private onMessage(data: Buffer): void {
    stats.msgsIn++;
    stats.bytesIn += data.byteLength;
    const msg = decodeMessage(data) as ServerMessage;
    if (msg.t === 'snap') stats.snapshots++;
    if (msg.t === 'start' && !this.playing) this.start();
    if (msg.t === 'death') {
      stats.dead++;
      this.stop();
    }
    if (msg.t === 'extracted') {
      stats.extracted++;
      this.stop();
    }
  }

  private start(): void {
    this.playing = true;
    stats.playing++;
    this.timer = setInterval(() => this.step(), 1000 / NETWORK_CONFIG.tickRate);
  }

  private step(): void {
    const now = Date.now();
    if (now >= this.nextChange) {
      this.nextChange = now + 800 + Math.random() * 1500;
      this.mx = Math.floor(Math.random() * 3) - 1;
      this.my = Math.floor(Math.random() * 3) - 1;
      this.aim = Math.random() * Math.PI * 2;
      this.fire = Math.random() < 0.35;
      if (Math.random() < 0.3) this.send({ t: 'act', a: { k: 'interact' } });
    }
    const b = (this.fire ? INPUT_BUTTONS.FIRE : 0) | (Math.random() < 0.01 ? INPUT_BUTTONS.DASH : 0);
    this.send({ t: 'input', i: [{ s: ++this.seq, mx: this.mx, my: this.my, a: this.aim, b }] });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.playing) stats.playing--;
    this.playing = false;
    this.timer = null;
  }

  close(): void {
    this.stop();
    this.ws.close();
  }
}

interface Metrics {
  rooms: number;
  connectedClients: number;
  playersInWorld: number;
  bots: number;
  tick: { rate: number; avgMs: number; p95Ms: number; maxMs: number };
  messagesInPerSecond: number;
  messagesOutPerSecond: number;
  bytesOutPerSecond: number;
  memoryMb: { rss: number; heapUsed: number };
}

async function fetchMetrics(): Promise<Metrics | null> {
  try {
    const res = await fetch(METRICS_URL);
    return (await res.json()) as Metrics;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`[loadtest] ${CLIENTS} clients · ${DURATION_S}s · ${WS_URL}`);
  const clients: SimClient[] = [];
  for (let i = 0; i < CLIENTS; i++) {
    clients.push(new SimClient(i));
    await new Promise((r) => setTimeout(r, RAMP_MS));
  }

  const samples: Metrics[] = [];
  const started = Date.now();
  let lastIn = 0;
  const report = setInterval(async () => {
    const m = await fetchMetrics();
    const inRate = (stats.msgsIn - lastIn) / 5;
    lastIn = stats.msgsIn;
    if (!m) {
      console.log('[loadtest] metrics endpoint unreachable');
      return;
    }
    samples.push(m);
    console.log(
      `t=${String(Math.round((Date.now() - started) / 1000)).padStart(3)}s ` +
        `clients=${stats.connected} playing=${stats.playing} dead=${stats.dead} | ` +
        `server: rooms=${m.rooms} inWorld=${m.playersInWorld} (bots ${m.bots}) ` +
        `tick ${m.tick.rate}/s avg=${m.tick.avgMs}ms p95=${m.tick.p95Ms}ms max=${m.tick.maxMs}ms | ` +
        `msg in/out ${m.messagesInPerSecond}/${m.messagesOutPerSecond}/s out=${Math.round(m.bytesOutPerSecond / 1024)}KB/s | ` +
        `rss=${m.memoryMb.rss}MB heap=${m.memoryMb.heapUsed}MB | client recv ${Math.round(inRate)} msg/s`,
    );
  }, 5000);

  await new Promise((r) => setTimeout(r, DURATION_S * 1000));
  clearInterval(report);
  for (const c of clients) c.close();

  if (samples.length) {
    const max = (f: (m: Metrics) => number) => Math.max(...samples.map(f));
    const avg = (f: (m: Metrics) => number) => samples.reduce((n, m) => n + f(m), 0) / samples.length;
    console.log('\n[loadtest] summary');
    console.table({
      clients: CLIENTS,
      'tick avg (ms)': +avg((m) => m.tick.avgMs).toFixed(2),
      'tick p95 max (ms)': max((m) => m.tick.p95Ms),
      'tick max (ms)': max((m) => m.tick.maxMs),
      'tick rate min (/s)': Math.min(...samples.map((m) => m.tick.rate)),
      'msgs out/s avg': Math.round(avg((m) => m.messagesOutPerSecond)),
      'KB out/s avg': Math.round(avg((m) => m.bytesOutPerSecond) / 1024),
      'rss max (MB)': max((m) => m.memoryMb.rss),
      'snapshots received': stats.snapshots,
      'connection errors': stats.errors,
    });
    const budget = 1000 / NETWORK_CONFIG.tickRate;
    const p95 = max((m) => m.tick.p95Ms);
    console.log(p95 < budget * 0.5 ? `OK: p95 tick ${p95}ms well within the ${budget.toFixed(1)}ms budget` : `WARN: p95 tick ${p95}ms (budget ${budget.toFixed(1)}ms)`);
  }
  setTimeout(() => process.exit(0), 500);
}

void main();
