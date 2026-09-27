import * as THREE from 'three';

/**
 * Procedural textures drawn on canvases at startup. No external assets, so the
 * art can be swapped later by replacing these factories with loaded images.
 */

type Painter = (ctx: CanvasRenderingContext2D, size: number, rand: () => number) => void;

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(size: number, seed: number, paint: Painter, repeat = true): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  paint(ctx, size, seeded(seed));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = 8;
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, size: number, rand: () => number, count: number, colors: string[], maxR: number): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)]!;
    const r = 0.5 + rand() * maxR;
    ctx.fillRect(rand() * size, rand() * size, r, r);
  }
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

export const Textures = {
  grass: () =>
    cached('grass', () =>
      canvasTexture(512, 11, (ctx, s, rand) => {
        ctx.fillStyle = '#46683a';
        ctx.fillRect(0, 0, s, s);
        for (let i = 0; i < 40; i++) {
          const cx = rand() * s;
          const cy = rand() * s;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40 + rand() * 90);
          g.addColorStop(0, rand() < 0.5 ? 'rgba(80,112,58,0.45)' : 'rgba(34,58,30,0.45)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, s, s);
        }
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 5000; i++) {
          const x = rand() * s;
          const y = rand() * s;
          const shade = 70 + Math.floor(rand() * 70);
          ctx.strokeStyle = `rgba(${shade - 30},${shade + 20},${shade - 40},0.55)`;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + (rand() - 0.5) * 3, y - 3 - rand() * 4);
          ctx.stroke();
        }
      }),
    ),
  forestFloor: () =>
    cached('forest', () =>
      canvasTexture(512, 12, (ctx, s, rand) => {
        ctx.fillStyle = '#35462b';
        ctx.fillRect(0, 0, s, s);
        speckle(ctx, s, rand, 9000, ['#435634', '#2b3a21', '#554429', '#3d5031', '#655434'], 3);
        for (let i = 0; i < 260; i++) {
          ctx.fillStyle = rand() < 0.5 ? 'rgba(120,86,40,0.5)' : 'rgba(150,120,50,0.45)';
          ctx.beginPath();
          ctx.ellipse(rand() * s, rand() * s, 2 + rand() * 4, 1 + rand() * 2, rand() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
      }),
    ),
  asphalt: () =>
    cached('asphalt', () =>
      canvasTexture(512, 13, (ctx, s, rand) => {
        ctx.fillStyle = '#2b2e33';
        ctx.fillRect(0, 0, s, s);
        speckle(ctx, s, rand, 16000, ['#34383e', '#25282c', '#3d4148', '#202326'], 2);
        ctx.strokeStyle = 'rgba(15,16,18,0.7)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 8; i++) {
          let x = rand() * s;
          let y = rand() * s;
          ctx.beginPath();
          ctx.moveTo(x, y);
          for (let k = 0; k < 6; k++) {
            x += (rand() - 0.5) * 40;
            y += (rand() - 0.5) * 40;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }),
    ),
  concrete: () =>
    cached('concrete', () =>
      canvasTexture(512, 14, (ctx, s, rand) => {
        ctx.fillStyle = '#6d7178';
        ctx.fillRect(0, 0, s, s);
        speckle(ctx, s, rand, 12000, ['#777b82', '#62666c', '#80848b', '#5b5f65'], 2);
        for (let i = 0; i < 18; i++) {
          const cx = rand() * s;
          const cy = rand() * s;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30 + rand() * 70);
          g.addColorStop(0, 'rgba(40,40,40,0.18)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, s, s);
        }
        ctx.strokeStyle = 'rgba(40,42,46,0.8)';
        ctx.lineWidth = 3;
        for (let p = 0; p <= s; p += 128) {
          ctx.beginPath();
          ctx.moveTo(p, 0);
          ctx.lineTo(p, s);
          ctx.moveTo(0, p);
          ctx.lineTo(s, p);
          ctx.stroke();
        }
      }),
    ),
  planks: () =>
    cached('planks', () =>
      canvasTexture(512, 15, (ctx, s, rand) => {
        const h = 32;
        for (let y = 0; y < s; y += h) {
          const base = 70 + Math.floor(rand() * 30);
          ctx.fillStyle = `rgb(${base + 22},${base + 8},${base - 12})`;
          ctx.fillRect(0, y, s, h);
          ctx.strokeStyle = 'rgba(0,0,0,0.12)';
          for (let k = 0; k < 6; k++) {
            ctx.beginPath();
            const yy = y + 4 + rand() * (h - 8);
            ctx.moveTo(0, yy);
            ctx.bezierCurveTo(s * 0.3, yy + (rand() - 0.5) * 6, s * 0.6, yy + (rand() - 0.5) * 6, s, yy);
            ctx.stroke();
          }
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(0, y + h - 2, s, 2);
          const joint = rand() * s;
          ctx.fillRect(joint, y, 2, h);
        }
      }),
    ),
  tiles: () =>
    cached('tiles', () =>
      canvasTexture(256, 16, (ctx, s, rand) => {
        const n = 4;
        const t = s / n;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const v = (i + j) % 2 === 0 ? 74 : 64;
            const d = Math.floor(rand() * 8);
            ctx.fillStyle = `rgb(${v + d},${v + 3 + d},${v + 8 + d})`;
            ctx.fillRect(i * t, j * t, t, t);
          }
        }
        ctx.strokeStyle = 'rgba(20,22,26,0.9)';
        ctx.lineWidth = 2;
        for (let p = 0; p <= s; p += t) {
          ctx.beginPath();
          ctx.moveTo(p, 0);
          ctx.lineTo(p, s);
          ctx.moveTo(0, p);
          ctx.lineTo(s, p);
          ctx.stroke();
        }
      }),
    ),
  metalPlates: () =>
    cached('metal', () =>
      canvasTexture(256, 17, (ctx, s, rand) => {
        ctx.fillStyle = '#34373e';
        ctx.fillRect(0, 0, s, s);
        speckle(ctx, s, rand, 3000, ['#3b3f47', '#2d3036', '#41454d'], 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 3;
        ctx.strokeRect(1.5, 1.5, s - 3, s - 3);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let k = -s; k < s * 2; k += 16) {
          ctx.beginPath();
          ctx.moveTo(k, 0);
          ctx.lineTo(k + s, s);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(160,165,175,0.5)';
        for (const [x, y] of [[10, 10], [s - 10, 10], [10, s - 10], [s - 10, s - 10]] as const) {
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }),
    ),
  corrugated: () =>
    cached('corrugated', () =>
      canvasTexture(256, 18, (ctx, s, rand) => {
        for (let x = 0; x < s; x += 16) {
          const g = ctx.createLinearGradient(x, 0, x + 16, 0);
          g.addColorStop(0, '#9a9a9a');
          g.addColorStop(0.5, '#ffffff');
          g.addColorStop(1, '#8a8a8a');
          ctx.fillStyle = g;
          ctx.fillRect(x, 0, 16, s);
        }
        speckle(ctx, s, rand, 1500, ['rgba(60,40,20,0.25)', 'rgba(0,0,0,0.15)'], 3);
      }),
    ),
  crateWood: () =>
    cached('crateWood', () =>
      canvasTexture(256, 19, (ctx, s, rand) => {
        ctx.fillStyle = '#d9d9d9';
        ctx.fillRect(0, 0, s, s);
        const h = s / 5;
        for (let i = 0; i < 5; i++) {
          const v = 200 + Math.floor(rand() * 40);
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(0, i * h + 2, s, h - 4);
          ctx.strokeStyle = 'rgba(0,0,0,0.12)';
          for (let k = 0; k < 4; k++) {
            ctx.beginPath();
            const yy = i * h + 6 + rand() * (h - 12);
            ctx.moveTo(0, yy);
            ctx.lineTo(s, yy + (rand() - 0.5) * 4);
            ctx.stroke();
          }
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, s - 10, s - 10);
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(10, 10);
        ctx.lineTo(s - 10, s - 10);
        ctx.stroke();
      }),
    ),
  /** Soft radial blob: ground glow, shadows, sparks. White, tinted by material color. */
  radial: () =>
    cached('radial', () =>
      canvasTexture(
        128,
        20,
        (ctx, s) => {
          const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
          g.addColorStop(0, 'rgba(255,255,255,1)');
          g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, s, s);
        },
        false,
      ),
    ),
  /** Vertical fade for light beams (opaque bottom -> transparent top). */
  beam: () =>
    cached('beam', () =>
      canvasTexture(
        64,
        21,
        (ctx, s) => {
          const g = ctx.createLinearGradient(0, s, 0, 0);
          g.addColorStop(0, 'rgba(255,255,255,0.95)');
          g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, s, s);
        },
        false,
      ),
    ),
  medCross: () =>
    cached('medCross', () =>
      canvasTexture(
        64,
        22,
        (ctx, s) => {
          ctx.fillStyle = '#f1f5f9';
          ctx.fillRect(0, 0, s, s);
          ctx.fillStyle = '#e11d48';
          ctx.fillRect(s * 0.4, s * 0.15, s * 0.2, s * 0.7);
          ctx.fillRect(s * 0.15, s * 0.4, s * 0.7, s * 0.2);
        },
        false,
      ),
    ),
  hazard: () =>
    cached('hazard', () =>
      canvasTexture(64, 23, (ctx, s) => {
        ctx.fillStyle = '#facc15';
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = '#111';
        for (let k = -s; k < s * 2; k += 16) {
          ctx.beginPath();
          ctx.moveTo(k, 0);
          ctx.lineTo(k + 8, 0);
          ctx.lineTo(k + 8 + s, s);
          ctx.lineTo(k + s, s);
          ctx.fill();
        }
      }),
    ),
};

export function disposeTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
