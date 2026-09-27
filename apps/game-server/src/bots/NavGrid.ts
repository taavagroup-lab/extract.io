import { BOT_CONFIG, PLAYER_CONFIG } from '@extract/game-config';
import type { Vec2 } from '@extract/game-types';
import type { CollisionWorld } from '@extract/shared';

/** Minimal binary min-heap keyed by number priority. */
class MinHeap {
  private readonly items: number[] = [];
  private readonly prio: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, priority: number): void {
    this.items.push(item);
    this.prio.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent]! <= this.prio[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0]!;
    const lastItem = this.items.pop()!;
    const lastPrio = this.prio.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l]! < this.prio[m]!) m = l;
        if (r < this.items.length && this.prio[r]! < this.prio[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.prio[a], this.prio[b]] = [this.prio[b]!, this.prio[a]!];
  }
}

const DIRS: readonly [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** Coarse walkability grid + A* for bots. Built once per map and shared. */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly blocked: Uint8Array;
  private readonly gScore: Float32Array;
  private readonly cameFrom: Int32Array;
  private readonly visitStamp: Uint32Array;
  private stamp = 0;

  constructor(
    private readonly world: CollisionWorld,
    readonly cell: number = BOT_CONFIG.navCellSize,
    private readonly clearance: number = PLAYER_CONFIG.radius - 2,
  ) {
    this.cols = Math.ceil(world.width / cell);
    this.rows = Math.ceil(world.height / cell);
    const n = this.cols * this.rows;
    this.blocked = new Uint8Array(n);
    this.gScore = new Float32Array(n);
    this.cameFrom = new Int32Array(n);
    this.visitStamp = new Uint32Array(n);
    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const x = (cx + 0.5) * cell;
        const y = (cy + 0.5) * cell;
        this.blocked[cy * this.cols + cx] = world.circleIntersects(x, y, clearance) ? 1 : 0;
      }
    }
  }

  private index(x: number, y: number): number {
    const cx = Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cell)));
    const cy = Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cell)));
    return cy * this.cols + cx;
  }

  private center(idx: number): Vec2 {
    return { x: ((idx % this.cols) + 0.5) * this.cell, y: (Math.floor(idx / this.cols) + 0.5) * this.cell };
  }

  isBlocked(x: number, y: number): boolean {
    return this.blocked[this.index(x, y)] === 1;
  }

  private nearestFree(idx: number): number {
    if (this.blocked[idx] === 0) return idx;
    const cx = idx % this.cols;
    const cy = Math.floor(idx / this.cols);
    for (let r = 1; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) continue;
          const i = y * this.cols + x;
          if (this.blocked[i] === 0) return i;
        }
      }
    }
    return -1;
  }

  /** Clear straight corridor for a player-sized circle between two points. */
  corridorClear(a: Vec2, b: Vec2): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return true;
    const ox = (-dy / len) * (this.clearance - 2);
    const oy = (dx / len) * (this.clearance - 2);
    return (
      this.world.lineOfSight(a.x, a.y, b.x, b.y) &&
      this.world.lineOfSight(a.x + ox, a.y + oy, b.x + ox, b.y + oy) &&
      this.world.lineOfSight(a.x - ox, a.y - oy, b.x - ox, b.y - oy)
    );
  }

  /** A* path (smoothed waypoints, excluding the start). Null when unreachable. */
  findPath(from: Vec2, to: Vec2, maxExpansions = 9000): Vec2[] | null {
    if (this.corridorClear(from, to)) return [to];
    const start = this.nearestFree(this.index(from.x, from.y));
    const goal = this.nearestFree(this.index(to.x, to.y));
    if (start < 0 || goal < 0) return null;

    this.stamp++;
    const stamp = this.stamp;
    const gx = goal % this.cols;
    const gy = Math.floor(goal / this.cols);
    const h = (i: number) => {
      const dx = Math.abs((i % this.cols) - gx);
      const dy = Math.abs(Math.floor(i / this.cols) - gy);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };

    const open = new MinHeap();
    this.visitStamp[start] = stamp;
    this.gScore[start] = 0;
    this.cameFrom[start] = -1;
    open.push(start, h(start));
    let expansions = 0;

    while (open.size > 0 && expansions++ < maxExpansions) {
      const cur = open.pop();
      if (cur === goal) break;
      const cx = cur % this.cols;
      const cy = Math.floor(cur / this.cols);
      const g = this.gScore[cur]!;
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
        const ni = ny * this.cols + nx;
        if (this.blocked[ni] === 1) continue;
        // No diagonal corner cutting.
        if (dx !== 0 && dy !== 0 && (this.blocked[cy * this.cols + nx] === 1 || this.blocked[ny * this.cols + cx] === 1)) continue;
        const ng = g + cost;
        if (this.visitStamp[ni] === stamp && ng >= this.gScore[ni]!) continue;
        this.visitStamp[ni] = stamp;
        this.gScore[ni] = ng;
        this.cameFrom[ni] = cur;
        open.push(ni, ng + h(ni));
      }
    }
    if (this.visitStamp[goal] !== stamp) return null;

    const cells: Vec2[] = [];
    for (let i = goal; i !== -1 && i !== start; i = this.cameFrom[i]!) cells.push(this.center(i));
    cells.reverse();
    cells.push(to);
    return this.smooth(from, cells);
  }

  private smooth(from: Vec2, pts: Vec2[]): Vec2[] {
    const out: Vec2[] = [];
    let anchor = from;
    let i = 0;
    while (i < pts.length) {
      let far = i;
      for (let j = Math.min(pts.length - 1, i + 14); j > i; j--) {
        if (this.corridorClear(anchor, pts[j]!)) {
          far = j;
          break;
        }
      }
      out.push(pts[far]!);
      anchor = pts[far]!;
      i = far + 1;
    }
    return out;
  }
}
