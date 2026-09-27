import type { Obstacle } from '@extract/game-types';
import { clamp } from './math';

export interface MutablePoint {
  x: number;
  y: number;
}

export interface RayHit {
  /** Fraction along the segment, 0..1. */
  t: number;
  obstacle: Obstacle;
}

const EPS = 1e-9;

/** Segment (origin + t*d, t in [0,1]) vs axis aligned rect. Returns entry t or null. */
export function segmentRect(
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): number | null {
  let tmin = 0;
  let tmax = 1;
  if (Math.abs(dx) < EPS) {
    if (x0 < rx || x0 > rx + rw) return null;
  } else {
    let t1 = (rx - x0) / dx;
    let t2 = (rx + rw - x0) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < EPS) {
    if (y0 < ry || y0 > ry + rh) return null;
  } else {
    let t1 = (ry - y0) / dy;
    let t2 = (ry + rh - y0) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

/** Segment vs circle. Returns first intersection t (0 if starting inside) or null. */
export function segmentCircle(
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  r: number,
): number | null {
  const fx = x0 - cx;
  const fy = y0 - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a < EPS) return null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/**
 * Static collision world built from map obstacles. Identical on server and
 * client so client-side prediction matches the authoritative simulation.
 */
export class CollisionWorld {
  private readonly grid: number[][];
  private readonly cols: number;
  private readonly rows: number;
  private readonly stamps: Uint32Array;
  private stamp = 0;

  constructor(
    readonly obstacles: readonly Obstacle[],
    readonly width: number,
    readonly height: number,
    private readonly cellSize = 160,
  ) {
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.grid = Array.from({ length: this.cols * this.rows }, () => [] as number[]);
    this.stamps = new Uint32Array(obstacles.length);
    obstacles.forEach((o, index) => {
      const b = CollisionWorld.bounds(o);
      this.forCells(b.minX, b.minY, b.maxX, b.maxY, (cell) => cell.push(index));
    });
  }

  static bounds(o: Obstacle): { minX: number; minY: number; maxX: number; maxY: number } {
    if (o.kind === 'rect') return { minX: o.x, minY: o.y, maxX: o.x + o.w, maxY: o.y + o.h };
    return { minX: o.x - o.r, minY: o.y - o.r, maxX: o.x + o.r, maxY: o.y + o.r };
  }

  private forCells(minX: number, minY: number, maxX: number, maxY: number, fn: (cell: number[]) => void): void {
    const cs = this.cellSize;
    const x0 = clamp(Math.floor(minX / cs), 0, this.cols - 1);
    const x1 = clamp(Math.floor(maxX / cs), 0, this.cols - 1);
    const y0 = clamp(Math.floor(minY / cs), 0, this.rows - 1);
    const y1 = clamp(Math.floor(maxY / cs), 0, this.rows - 1);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) fn(this.grid[cy * this.cols + cx] as number[]);
    }
  }

  /** Candidate obstacles overlapping the given bounds (deduplicated). */
  query(minX: number, minY: number, maxX: number, maxY: number, out: Obstacle[] = []): Obstacle[] {
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.stamps.fill(0);
      this.stamp = 1;
    }
    const stamp = this.stamp;
    this.forCells(minX, minY, maxX, maxY, (cell) => {
      for (const idx of cell) {
        if (this.stamps[idx] === stamp) continue;
        this.stamps[idx] = stamp;
        out.push(this.obstacles[idx] as Obstacle);
      }
    });
    return out;
  }

  circleIntersects(x: number, y: number, r: number): boolean {
    if (x - r < 0 || y - r < 0 || x + r > this.width || y + r > this.height) return true;
    for (const o of this.query(x - r, y - r, x + r, y + r)) {
      if (o.kind === 'rect') {
        const cx = clamp(x, o.x, o.x + o.w);
        const cy = clamp(y, o.y, o.y + o.h);
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy < r * r) return true;
      } else {
        const dx = x - o.x;
        const dy = y - o.y;
        const rr = r + o.r;
        if (dx * dx + dy * dy < rr * rr) return true;
      }
    }
    return false;
  }

  /** Pushes a circle out of all obstacles and keeps it inside the map. */
  resolveCircle(p: MutablePoint, r: number): boolean {
    let collided = false;
    for (let iter = 0; iter < 3; iter++) {
      let pushed = false;
      for (const o of this.query(p.x - r, p.y - r, p.x + r, p.y + r)) {
        if (o.kind === 'rect') {
          const cx = clamp(p.x, o.x, o.x + o.w);
          const cy = clamp(p.y, o.y, o.y + o.h);
          const dx = p.x - cx;
          const dy = p.y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          if (d2 > EPS) {
            const d = Math.sqrt(d2);
            const push = r - d;
            p.x += (dx / d) * push;
            p.y += (dy / d) * push;
          } else {
            // Center inside the rect: exit along the axis of least penetration.
            const left = p.x - o.x;
            const right = o.x + o.w - p.x;
            const top = p.y - o.y;
            const bottom = o.y + o.h - p.y;
            const m = Math.min(left, right, top, bottom);
            if (m === left) p.x = o.x - r;
            else if (m === right) p.x = o.x + o.w + r;
            else if (m === top) p.y = o.y - r;
            else p.y = o.y + o.h + r;
          }
          pushed = true;
        } else {
          const dx = p.x - o.x;
          const dy = p.y - o.y;
          const rr = r + o.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr) continue;
          const d = Math.sqrt(d2);
          if (d > EPS) {
            const push = rr - d;
            p.x += (dx / d) * push;
            p.y += (dy / d) * push;
          } else {
            p.x += rr;
          }
          pushed = true;
        }
      }
      if (!pushed) break;
      collided = true;
    }
    p.x = clamp(p.x, r, this.width - r);
    p.y = clamp(p.y, r, this.height - r);
    return collided;
  }

  /** First obstacle hit along the segment, or null. */
  raycast(x0: number, y0: number, x1: number, y1: number): RayHit | null {
    const dx = x1 - x0;
    const dy = y1 - y0;
    let best: RayHit | null = null;
    const minX = Math.min(x0, x1);
    const minY = Math.min(y0, y1);
    const maxX = Math.max(x0, x1);
    const maxY = Math.max(y0, y1);
    for (const o of this.query(minX, minY, maxX, maxY)) {
      const t =
        o.kind === 'rect'
          ? segmentRect(x0, y0, dx, dy, o.x, o.y, o.w, o.h)
          : segmentCircle(x0, y0, dx, dy, o.x, o.y, o.r);
      if (t !== null && (best === null || t < best.t)) best = { t, obstacle: o };
    }
    return best;
  }

  lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    return this.raycast(x0, y0, x1, y1) === null;
  }
}
