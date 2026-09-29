import { NETWORK_CONFIG } from '@extract/game-config';
import type {
  BulletEnd,
  BulletSpawn,
  CrateUpdate,
  CrateView,
  GroundItemView,
  PlayerEnter,
  PlayerNet,
  SnapshotMessage,
} from '@extract/game-types';
import type { ServerPlayer } from '../game/entities/ServerPlayer';
import type { Crate, GroundItem } from '../game/entities/types';
import type { MatchRoom } from '../game/match/MatchRoom';

const MAX_BULLET_RANGE = 1100;

function tupleEqual(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const crateKey = (c: Crate): number => (c.opened ? 2 : 0) + (c.locked ? 1 : 0);

/**
 * Interest management + delta replication. For each client only entities
 * inside its interest rectangle are considered, and of those only the ones
 * that entered, changed or left since the previous snapshot are sent.
 */
export class SnapshotBuilder {
  private readonly players: ServerPlayer[] = [];
  private readonly items: GroundItem[] = [];
  private readonly crates: Crate[] = [];
  private readonly seen = new Set<number>();

  build(room: MatchRoom, p: ServerPlayer, bulletSpawns: BulletSpawn[], bulletEnds: BulletEnd[]): SnapshotMessage {
    const view = p.view!;
    const { halfWidth: hw, halfHeight: hh } = NETWORK_CONFIG.interest;
    const cx = p.x;
    const cy = p.y;
    const minX = cx - hw;
    const maxX = cx + hw;
    const minY = cy - hh;
    const maxY = cy + hh;
    const world = room.world;

    const snap: SnapshotMessage = {
      t: 'snap',
      tick: room.tickCount,
      time: Math.round(room.matchTime),
      ack: p.lastProcessedSeq,
      self: room.selfStateFor(p),
    };

    // --- players
    this.players.length = 0;
    this.seen.clear();
    world.playerGrid.queryRect(minX, minY, maxX, maxY, this.players);
    const pe: PlayerEnter[] = [];
    const pu: PlayerNet[] = [];
    for (const o of this.players) {
      if (o === p || !o.net) continue;
      this.seen.add(o.id);
      const prev = view.knownPlayers.get(o.id);
      if (!prev) pe.push({ name: o.name, bot: o.isBot, d: o.net });
      else if (!tupleEqual(prev, o.net)) pu.push(o.net);
      view.knownPlayers.set(o.id, o.net);
    }
    const pl: number[] = [];
    for (const id of view.knownPlayers.keys()) {
      if (!this.seen.has(id)) {
        pl.push(id);
        view.knownPlayers.delete(id);
      }
    }
    if (pe.length) snap.pe = pe;
    if (pu.length) snap.pu = pu;
    if (pl.length) snap.pl = pl;

    // --- ground items
    this.items.length = 0;
    this.seen.clear();
    world.itemGrid.queryRect(minX, minY, maxX, maxY, this.items);
    const ie: GroundItemView[] = [];
    for (const it of this.items) {
      this.seen.add(it.id);
      if (view.knownItems.has(it.id)) continue;
      view.knownItems.add(it.id);
      ie.push(it.mag === undefined ? { id: it.id, x: Math.round(it.x), y: Math.round(it.y), itemId: it.itemId, qty: it.qty } : { id: it.id, x: Math.round(it.x), y: Math.round(it.y), itemId: it.itemId, qty: it.qty, mag: it.mag });
    }
    const il: number[] = [];
    for (const id of view.knownItems) {
      if (!this.seen.has(id)) {
        il.push(id);
        view.knownItems.delete(id);
      }
    }
    if (ie.length) snap.ie = ie;
    if (il.length) snap.il = il;

    // --- crates
    this.crates.length = 0;
    this.seen.clear();
    world.crateGrid.queryRect(minX, minY, maxX, maxY, this.crates);
    const ce: CrateView[] = [];
    const cu: CrateUpdate[] = [];
    for (const c of this.crates) {
      this.seen.add(c.id);
      const key = crateKey(c);
      const prev = view.knownCrates.get(c.id);
      if (prev === undefined) ce.push({ id: c.id, x: c.x, y: c.y, type: c.type, opened: c.opened, locked: c.locked });
      else if (prev !== key) cu.push([c.id, c.opened ? 1 : 0, c.locked ? 1 : 0]);
      view.knownCrates.set(c.id, key);
    }
    const cl: number[] = [];
    for (const id of view.knownCrates.keys()) {
      if (!this.seen.has(id)) {
        cl.push(id);
        view.knownCrates.delete(id);
      }
    }
    if (ce.length) snap.ce = ce;
    if (cu.length) snap.cu = cu;
    if (cl.length) snap.cl = cl;

    // --- bullets (spawn events whose path may cross the view)
    if (bulletSpawns.length) {
      const bs = bulletSpawns.filter(
        (b) => b[1] > minX - MAX_BULLET_RANGE && b[1] < maxX + MAX_BULLET_RANGE && b[2] > minY - MAX_BULLET_RANGE && b[2] < maxY + MAX_BULLET_RANGE,
      );
      if (bs.length) snap.bs = bs;
    }
    if (bulletEnds.length) {
      const be = bulletEnds.filter((b) => b[1] > minX - 200 && b[1] < maxX + 200 && b[2] > minY - 200 && b[2] < maxY + 200);
      if (be.length) snap.be = be;
    }

    // --- global state (only when it changed)
    if (view.lastGlobalVersion !== room.globalVersion) {
      snap.g = room.globalState();
      view.lastGlobalVersion = room.globalVersion;
    }

    const ev = view.drainEvents();
    if (ev) snap.ev = ev;
    return snap;
  }
}
