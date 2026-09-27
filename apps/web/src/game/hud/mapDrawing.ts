import type { MapData, MatchGlobalState } from '@extract/game-types';

const ZONE_COLORS: Record<string, string> = {
  CITY: '#1d2128',
  FACTORY: '#1f1f22',
  FOREST: '#14271a',
  PORT: '#172029',
  GAS_STATION: '#222222',
  HIGH_VALUE: '#2b1a1a',
  OPEN: '#18201a',
};

const baseCache = new Map<string, HTMLCanvasElement>();

/** Pre-renders the static map at a given pixel size (cached). */
export function mapBase(map: MapData, size: number): HTMLCanvasElement {
  const key = `${map.id}:${size}`;
  const cached = baseCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const s = size / map.width;
  ctx.fillStyle = ZONE_COLORS.OPEN!;
  ctx.fillRect(0, 0, size, size);
  for (const z of map.zones) {
    ctx.fillStyle = ZONE_COLORS[z.type] ?? '#222';
    ctx.fillRect(z.x * s, z.y * s, z.w * s, z.h * s);
  }
  for (const f of map.floors) {
    if (f.style !== 'road') continue;
    ctx.fillStyle = '#0d0f13';
    ctx.fillRect(f.x * s, f.y * s, f.w * s, f.h * s);
  }
  for (const o of map.obstacles) {
    if (o.kind === 'rect') {
      ctx.fillStyle = o.style === 'container' ? '#3b4658' : '#434b5a';
      ctx.fillRect(o.x * s, o.y * s, Math.max(1, o.w * s), Math.max(1, o.h * s));
    } else {
      ctx.fillStyle = o.style === 'tree' ? '#24583a' : '#4b5563';
      ctx.beginPath();
      ctx.arc(o.x * s, o.y * s, Math.max(1, o.r * s), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const vault = map.zones.find((z) => z.type === 'HIGH_VALUE');
  if (vault) {
    ctx.strokeStyle = '#f59e0b88';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vault.x * s, vault.y * s, vault.w * s, vault.h * s);
  }
  baseCache.set(key, canvas);
  return canvas;
}

export interface MapDrawOptions {
  size: number;
  labels: boolean;
  selfX: number | null;
  selfY: number | null;
  aim: number;
  now: number;
}

export function drawMap(ctx: CanvasRenderingContext2D, map: MapData, global: MatchGlobalState | null, o: MapDrawOptions): void {
  const s = o.size / map.width;
  ctx.clearRect(0, 0, o.size, o.size);
  ctx.drawImage(mapBase(map, o.size), 0, 0);
  const pulse = 0.5 + 0.5 * Math.sin(o.now / 250);

  if (o.labels) {
    ctx.font = `600 ${Math.max(11, o.size / 50)}px "Chakra Petch", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(231,235,242,0.45)';
    for (const z of map.zones) ctx.fillText(z.name.toUpperCase(), (z.x + z.w / 2) * s, (z.y + z.h / 2) * s);
  }

  if (global) {
    if (global.highValueActive) {
      const vault = map.zones.find((z) => z.type === 'HIGH_VALUE');
      if (vault) {
        ctx.strokeStyle = `rgba(245,158,11,${0.4 + 0.5 * pulse})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(vault.x * s, vault.y * s, vault.w * s, vault.h * s);
      }
    }
    for (const z of global.extractionZones) {
      if (!z.active) {
        if (o.labels) {
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(z.position.x * s, z.position.y * s, Math.max(3, z.radius * s), 0, Math.PI * 2);
          ctx.stroke();
        }
        continue;
      }
      ctx.fillStyle = `rgba(52,211,153,${0.25 + 0.25 * pulse})`;
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(z.position.x * s, z.position.y * s, Math.max(4, z.radius * s), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (o.labels) {
        ctx.fillStyle = '#34d399';
        ctx.fillText(z.name, z.position.x * s, z.position.y * s - Math.max(8, z.radius * s) - 6);
      }
    }
    for (const d of global.supplyDrops) {
      if (d.opened) continue;
      ctx.fillStyle = d.landed ? '#fb923c' : `rgba(251,146,60,${0.4 + 0.6 * pulse})`;
      ctx.fillRect(d.x * s - 4, d.y * s - 4, 8, 8);
      if (o.labels) ctx.fillText('SUPPLY', d.x * s, d.y * s - 8);
    }
    for (const b of global.bounties) {
      ctx.strokeStyle = `rgba(239,68,68,${0.5 + 0.4 * pulse})`;
      ctx.fillStyle = 'rgba(239,68,68,0.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x * s, b.y * s, Math.max(6, b.radius * s), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (o.labels) {
        ctx.fillStyle = '#fca5a5';
        ctx.fillText(`${b.name} · HVT`, b.x * s, b.y * s);
      }
    }
  }

  if (o.selfX !== null && o.selfY !== null) {
    const x = o.selfX * s;
    const y = o.selfY * s;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(o.aim);
    ctx.fillStyle = '#b6f23d';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -5);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
