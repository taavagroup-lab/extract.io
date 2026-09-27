export interface Positioned {
  id: number;
  x: number;
  y: number;
}

const OFFSET = 1 << 12;

/**
 * Uniform-grid spatial hash for dynamic entities. Used for interest
 * management (who sees what) and broad-phase hit tests.
 */
export class SpatialHash<T extends Positioned> {
  private readonly cells = new Map<number, Set<T>>();
  private readonly entityCell = new Map<number, number>();

  constructor(private readonly cellSize: number) {}

  get size(): number {
    return this.entityCell.size;
  }

  private cellKey(x: number, y: number): number {
    const cx = Math.floor(x / this.cellSize) + OFFSET;
    const cy = Math.floor(y / this.cellSize) + OFFSET;
    return cx * (OFFSET * 2) + cy;
  }

  insert(entity: T): void {
    const key = this.cellKey(entity.x, entity.y);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = new Set();
      this.cells.set(key, cell);
    }
    cell.add(entity);
    this.entityCell.set(entity.id, key);
  }

  remove(entity: T): void {
    const key = this.entityCell.get(entity.id);
    if (key === undefined) return;
    const cell = this.cells.get(key);
    if (cell) {
      cell.delete(entity);
      if (cell.size === 0) this.cells.delete(key);
    }
    this.entityCell.delete(entity.id);
  }

  /** Re-buckets an entity after it moved. Cheap when it stays in its cell. */
  update(entity: T): void {
    const oldKey = this.entityCell.get(entity.id);
    const newKey = this.cellKey(entity.x, entity.y);
    if (oldKey === newKey) return;
    if (oldKey !== undefined) this.remove(entity);
    this.insert(entity);
  }

  has(entity: T): boolean {
    return this.entityCell.has(entity.id);
  }

  clear(): void {
    this.cells.clear();
    this.entityCell.clear();
  }

  queryRect(minX: number, minY: number, maxX: number, maxY: number, out: T[] = []): T[] {
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs);
    const x1 = Math.floor(maxX / cs);
    const y0 = Math.floor(minY / cs);
    const y1 = Math.floor(maxY / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const cell = this.cells.get((cx + OFFSET) * (OFFSET * 2) + (cy + OFFSET));
        if (!cell) continue;
        for (const e of cell) {
          if (e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY) out.push(e);
        }
      }
    }
    return out;
  }

  queryRadius(x: number, y: number, radius: number, out: T[] = []): T[] {
    const start = out.length;
    this.queryRect(x - radius, y - radius, x + radius, y + radius, out);
    const r2 = radius * radius;
    let w = start;
    for (let i = start; i < out.length; i++) {
      const e = out[i] as T;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy <= r2) out[w++] = e;
    }
    out.length = w;
    return out;
  }
}
