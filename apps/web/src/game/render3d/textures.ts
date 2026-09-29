import * as THREE from 'three';

/**
 * Procedural textures drawn on canvases at startup (no downloaded assets).
 * Surfaces come as PBR pairs: an albedo map plus a normal map derived from a
 * height field (luminance of the albedo, or a dedicated height painter), so
 * joints, seams and grooves catch the low sun. Decal textures carry alpha.
 * Every factory is cached; swap a painter for a loaded image to re-skin.
 */

type Rand = () => number;
type Painter = (ctx: CanvasRenderingContext2D, size: number, rand: Rand) => void;

function seeded(seed: number): Rand {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paintCanvas(w: number, h: number, seed: number, paint: Painter): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext('2d')!, w, seeded(seed));
  return canvas;
}

function toTexture(canvas: HTMLCanvasElement, opts: { repeat?: boolean; srgb?: boolean } = {}): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat !== false) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = 8;
  return tex;
}

/** Tangent-space normal map from a height canvas (luminance), wrapping at the borders. */
function normalFromHeight(src: HTMLCanvasElement, strength: number): THREE.CanvasTexture {
  const w = src.width;
  const h = src.height;
  const input = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = (input[i * 4]! * 0.299 + input[i * 4 + 1]! * 0.587 + input[i * 4 + 2]! * 0.114) / 255;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w;
    const yp = ((y + 1) % h) * w;
    const yr = y * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      const dx = (lum[yr + xp]! - lum[yr + xm]!) * strength;
      const dy = (lum[yp + x]! - lum[ym + x]!) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = (yr + x) * 4;
      d[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      d[o + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      d[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      d[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return toTexture(out, { srgb: false });
}

function speckle(ctx: CanvasRenderingContext2D, size: number, rand: Rand, count: number, colors: string[], maxR: number): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)]!;
    const r = 0.5 + rand() * maxR;
    ctx.fillRect(rand() * size, rand() * size, r, r);
  }
}

/** Soft, wrapping blobs for large-scale tonal variation. */
function mottle(ctx: CanvasRenderingContext2D, size: number, rand: Rand, count: number, colors: string[], minR: number, maxR: number): void {
  for (let i = 0; i < count; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const r = minR + rand() * (maxR - minR);
    const color = colors[Math.floor(rand() * colors.length)]!;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const x = cx + ox;
        const y = cy + oy;
        if (x + r < 0 || y + r < 0 || x - r > size || y - r > size) continue;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
  }
}

function crackPath(ctx: CanvasRenderingContext2D, rand: Rand, x: number, y: number, len: number, width: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  let a = rand() * Math.PI * 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 0; i < len; i++) {
    a += (rand() - 0.5) * 0.9;
    x += Math.cos(a) * 7;
    y += Math.sin(a) * 7;
    ctx.lineTo(x, y);
    if (rand() < 0.08) crackPath(ctx, rand, x, y, Math.floor(len / 3), width * 0.6, color);
  }
  ctx.stroke();
}

const cache = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  let t = cache.get(key) as T | undefined;
  if (t === undefined) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

export interface PbrTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
}

/** Albedo + derived normal map. `heightPaint` overrides the height source. */
function pbr(key: string, size: number, seed: number, paint: Painter, strength: number, heightPaint?: Painter): PbrTextures {
  return cached(`pbr:${key}`, () => {
    const albedo = paintCanvas(size, size, seed, paint);
    const height = heightPaint ? paintCanvas(size, size, seed, heightPaint) : albedo;
    return { map: toTexture(albedo), normalMap: normalFromHeight(height, strength) };
  });
}

function decal(key: string, w: number, h: number, seed: number, paint: Painter, repeat = false): THREE.CanvasTexture {
  return cached(`decal:${key}`, () => toTexture(paintCanvas(w, h, seed, paint), { repeat }));
}

// ---------------------------------------------------------------- painters

const slabPainter =
  (base: string, tones: string[], joint: number): Painter =>
  (ctx, s, rand) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, rand, 26, tones, 40, 140);
    speckle(ctx, s, rand, 14000, ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.08)', 'rgba(0,0,0,0.05)'], 1.6);
    for (let i = 0; i < 5; i++) crackPath(ctx, rand, rand() * s, rand() * s, 6 + Math.floor(rand() * 10), 1, 'rgba(20,20,20,0.35)');
    // Expansion joints with a thin lit bevel.
    for (let p = 0; p <= s; p += joint) {
      ctx.fillStyle = 'rgba(18,18,20,0.75)';
      ctx.fillRect(p - 1.5, 0, 3, s);
      ctx.fillRect(0, p - 1.5, s, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(p + 1.5, 0, 1, s);
      ctx.fillRect(0, p + 1.5, s, 1);
    }
  };

export const Textures = {
  // ------------------------------------------------------------- ground
  slab: () => pbr('slab', 512, 101, slabPainter('#6c6f73', ['rgba(40,40,42,0.18)', 'rgba(140,140,140,0.12)', 'rgba(70,60,50,0.12)'], 256), 3.2),
  quay: () => pbr('quay', 512, 102, slabPainter('#61676d', ['rgba(30,34,38,0.2)', 'rgba(120,96,70,0.12)', 'rgba(150,150,150,0.1)'], 256), 3.2),
  asphalt: () =>
    pbr(
      'asphalt',
      512,
      103,
      (ctx, s, rand) => {
        ctx.fillStyle = '#26292d';
        ctx.fillRect(0, 0, s, s);
        mottle(ctx, s, rand, 14, ['rgba(0,0,0,0.25)', 'rgba(90,90,95,0.12)'], 50, 160);
        speckle(ctx, s, rand, 22000, ['#2f3237', '#1e2023', '#3a3d42', '#191b1d'], 1.8);
        // Patch repairs.
        for (let i = 0; i < 3; i++) {
          const w = 60 + rand() * 120;
          const h = 40 + rand() * 90;
          const x = rand() * (s - w);
          const y = rand() * (s - h);
          ctx.fillStyle = 'rgba(12,13,15,0.45)';
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, w, h);
        }
        for (let i = 0; i < 7; i++) crackPath(ctx, rand, rand() * s, rand() * s, 10 + Math.floor(rand() * 14), 1.4, 'rgba(8,8,9,0.7)');
      },
      2.4,
    ),
  epoxy: () =>
    pbr(
      'epoxy',
      512,
      104,
      (ctx, s, rand) => {
        ctx.fillStyle = '#4c5553';
        ctx.fillRect(0, 0, s, s);
        mottle(ctx, s, rand, 20, ['rgba(20,30,28,0.22)', 'rgba(140,150,140,0.1)'], 50, 150);
        // Scuffs from forklifts.
        ctx.lineCap = 'round';
        for (let i = 0; i < 40; i++) {
          ctx.strokeStyle = rand() < 0.5 ? 'rgba(10,12,12,0.18)' : 'rgba(200,210,200,0.07)';
          ctx.lineWidth = 1 + rand() * 3;
          const x = rand() * s;
          const y = rand() * s;
          ctx.beginPath();
          ctx.arc(x, y, 30 + rand() * 90, rand() * 6, rand() * 6 + 0.6 + rand());
          ctx.stroke();
        }
        speckle(ctx, s, rand, 6000, ['rgba(255,255,255,0.04)', 'rgba(0,0,0,0.07)'], 1.4);
        for (let p = 0; p <= s; p += 256) {
          ctx.fillStyle = 'rgba(10,12,12,0.7)';
          ctx.fillRect(p - 1, 0, 2, s);
          ctx.fillRect(0, p - 1, s, 2);
        }
      },
      2,
    ),
  officeTiles: () =>
    pbr(
      'officeTiles',
      256,
      105,
      (ctx, s, rand) => {
        const n = 4;
        const t = s / n;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const v = 92 + Math.floor(rand() * 10);
            ctx.fillStyle = `rgb(${v + 6},${v + 4},${v})`;
            ctx.fillRect(i * t, j * t, t, t);
          }
        }
        speckle(ctx, s, rand, 3000, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.05)'], 1.5);
        mottle(ctx, s, rand, 6, ['rgba(40,30,20,0.15)'], 20, 60);
        ctx.fillStyle = 'rgba(30,28,26,0.85)';
        for (let p = 0; p <= s; p += t) {
          ctx.fillRect(p - 1, 0, 2, s);
          ctx.fillRect(0, p - 1, s, 2);
        }
      },
      3,
    ),
  parquet: () =>
    pbr(
      'parquet',
      256,
      106,
      (ctx, s, rand) => {
        const h = 16;
        for (let y = 0; y < s; y += h) {
          let x = -rand() * 80;
          while (x < s) {
            const len = 50 + rand() * 60;
            const base = 72 + Math.floor(rand() * 26);
            ctx.fillStyle = `rgb(${base + 26},${base + 12},${base - 6})`;
            ctx.fillRect(x, y, len, h);
            ctx.strokeStyle = 'rgba(0,0,0,0.1)';
            for (let k = 0; k < 3; k++) {
              const yy = y + 2 + rand() * (h - 4);
              ctx.beginPath();
              ctx.moveTo(x, yy);
              ctx.lineTo(x + len, yy + (rand() - 0.5) * 2);
              ctx.stroke();
            }
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(x + len - 1, y, 1, h);
            x += len;
          }
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fillRect(0, y + h - 1, s, 1);
        }
        mottle(ctx, s, rand, 5, ['rgba(20,12,4,0.2)'], 30, 70);
      },
      2.5,
    ),
  treadPlate: () =>
    pbr(
      'treadPlate',
      256,
      107,
      (ctx, s, rand) => {
        ctx.fillStyle = '#3a3d43';
        ctx.fillRect(0, 0, s, s);
        mottle(ctx, s, rand, 8, ['rgba(0,0,0,0.25)', 'rgba(120,90,50,0.12)'], 30, 90);
        for (let y = 0; y < s; y += 16) {
          for (let x = (y / 16) % 2 ? 8 : 0; x < s; x += 16) {
            ctx.save();
            ctx.translate(x + 4, y + 4);
            ctx.rotate((y / 16) % 2 ? 0.8 : -0.8);
            ctx.fillStyle = 'rgba(190,195,205,0.35)';
            ctx.fillRect(-4, -1.2, 8, 2.4);
            ctx.restore();
          }
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 3;
        ctx.strokeRect(1.5, 1.5, s - 3, s - 3);
      },
      2.2,
    ),
  field: () =>
    pbr(
      'field',
      512,
      108,
      (ctx, s, rand) => {
        ctx.fillStyle = '#3c5231';
        ctx.fillRect(0, 0, s, s);
        mottle(ctx, s, rand, 40, ['rgba(92,98,52,0.35)', 'rgba(24,40,22,0.4)', 'rgba(110,96,62,0.25)'], 40, 130);
        ctx.lineWidth = 1.1;
        for (let i = 0; i < 6000; i++) {
          const x = rand() * s;
          const y = rand() * s;
          const shade = 60 + Math.floor(rand() * 60);
          ctx.strokeStyle = `rgba(${shade - 18},${shade + 10},${shade - 30},0.5)`;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + (rand() - 0.5) * 3, y - 2 - rand() * 4);
          ctx.stroke();
        }
      },
      1.2,
    ),
  forestFloor: () =>
    pbr(
      'forestFloor',
      512,
      109,
      (ctx, s, rand) => {
        ctx.fillStyle = '#2d3a24';
        ctx.fillRect(0, 0, s, s);
        mottle(ctx, s, rand, 30, ['rgba(70,54,30,0.35)', 'rgba(16,24,12,0.45)'], 30, 110);
        speckle(ctx, s, rand, 9000, ['#3a4a2c', '#232e1a', '#4d3f25', '#34432a', '#5b4a2c'], 3);
        for (let i = 0; i < 360; i++) {
          ctx.fillStyle = rand() < 0.5 ? 'rgba(120,84,40,0.45)' : 'rgba(140,110,50,0.35)';
          ctx.beginPath();
          ctx.ellipse(rand() * s, rand() * s, 2 + rand() * 4, 1 + rand() * 2, rand() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
      },
      1.6,
    ),
  // ------------------------------------------------------------- structures
  wallPanel: () =>
    pbr(
      'wallPanel',
      256,
      110,
      (ctx, s, rand) => {
        ctx.fillStyle = '#8c8e8f';
        ctx.fillRect(0, 0, s, s);
        mottle(ctx, s, rand, 10, ['rgba(60,60,60,0.18)', 'rgba(170,170,165,0.12)'], 30, 90);
        speckle(ctx, s, rand, 5000, ['rgba(0,0,0,0.07)', 'rgba(255,255,255,0.05)'], 1.4);
        // Rain streaks.
        for (let i = 0; i < 26; i++) {
          const x = rand() * s;
          const g = ctx.createLinearGradient(0, 0, 0, s * (0.3 + rand() * 0.7));
          g.addColorStop(0, 'rgba(40,40,38,0.22)');
          g.addColorStop(1, 'rgba(40,40,38,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x, 0, 2 + rand() * 5, s);
        }
        // Panel seams + form-tie holes.
        ctx.fillStyle = 'rgba(20,20,22,0.8)';
        for (let p = 0; p <= s; p += 128) ctx.fillRect(p - 1.5, 0, 3, s);
        ctx.fillRect(0, s / 2 - 1, s, 2);
        ctx.fillStyle = 'rgba(25,25,25,0.6)';
        for (let x = 32; x < s; x += 64) for (let y = 32; y < s; y += 64) ctx.fillRect(x - 2, y - 2, 4, 4);
      },
      3.5,
    ),
  corrugated: () =>
    pbr(
      'corrugated',
      256,
      111,
      (ctx, s, rand) => {
        for (let x = 0; x < s; x += 16) {
          const g = ctx.createLinearGradient(x, 0, x + 16, 0);
          g.addColorStop(0, '#8e8e8e');
          g.addColorStop(0.5, '#ffffff');
          g.addColorStop(1, '#7e7e7e');
          ctx.fillStyle = g;
          ctx.fillRect(x, 0, 16, s);
        }
        mottle(ctx, s, rand, 12, ['rgba(110,60,30,0.28)', 'rgba(0,0,0,0.18)'], 10, 50);
        speckle(ctx, s, rand, 1800, ['rgba(90,50,20,0.3)', 'rgba(0,0,0,0.15)'], 3);
        // Scratches.
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        for (let i = 0; i < 14; i++) {
          const x = rand() * s;
          const y = rand() * s;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + (rand() - 0.5) * 60, y + (rand() - 0.5) * 12);
          ctx.stroke();
        }
      },
      2.6,
    ),
  paintedMetal: () =>
    pbr(
      'paintedMetal',
      256,
      112,
      (ctx, s, rand) => {
        ctx.fillStyle = '#d8d8d8';
        ctx.fillRect(0, 0, s, s);
        mottle(ctx, s, rand, 14, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.12)'], 20, 70);
        // Paint chips showing darker metal.
        for (let i = 0; i < 60; i++) {
          ctx.fillStyle = rand() < 0.6 ? 'rgba(60,60,60,0.55)' : 'rgba(120,70,30,0.5)';
          ctx.beginPath();
          ctx.ellipse(rand() * s, rand() * s, 1 + rand() * 4, 0.5 + rand() * 2, rand() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, 0, s, 2);
        ctx.fillRect(0, s / 2, s, 1);
      },
      1.4,
    ),
  crateWood: () =>
    pbr(
      'crateWood',
      256,
      113,
      (ctx, s, rand) => {
        ctx.fillStyle = '#d6d0c4';
        ctx.fillRect(0, 0, s, s);
        const h = s / 5;
        for (let i = 0; i < 5; i++) {
          const v = 190 + Math.floor(rand() * 40);
          ctx.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
          ctx.fillRect(0, i * h + 2, s, h - 4);
          ctx.strokeStyle = 'rgba(60,40,20,0.14)';
          for (let k = 0; k < 5; k++) {
            ctx.beginPath();
            const yy = i * h + 6 + rand() * (h - 12);
            ctx.moveTo(0, yy);
            ctx.lineTo(s, yy + (rand() - 0.5) * 4);
            ctx.stroke();
          }
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(0, i * h, s, 2);
        }
        ctx.strokeStyle = 'rgba(30,20,10,0.5)';
        ctx.lineWidth = 12;
        ctx.strokeRect(6, 6, s - 12, s - 12);
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.moveTo(12, 12);
        ctx.lineTo(s - 12, s - 12);
        ctx.stroke();
        mottle(ctx, s, rand, 6, ['rgba(40,30,10,0.18)'], 20, 60);
      },
      2.4,
    ),
  hardCase: () =>
    pbr(
      'hardCase',
      256,
      114,
      (ctx, s, rand) => {
        ctx.fillStyle = '#cfcfcf';
        ctx.fillRect(0, 0, s, s);
        // Moulded ribs + corner guards.
        for (let y = 40; y < s - 30; y += 44) {
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(18, y, s - 36, 5);
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(18, y + 5, s - 36, 2);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        for (const [x, y] of [[0, 0], [s - 36, 0], [0, s - 36], [s - 36, s - 36]] as const) ctx.fillRect(x, y, 36, 36);
        speckle(ctx, s, rand, 2500, ['rgba(0,0,0,0.07)', 'rgba(255,255,255,0.06)'], 1.5);
      },
      2.2,
    ),
  burlap: () =>
    pbr(
      'burlap',
      128,
      115,
      (ctx, s, rand) => {
        ctx.fillStyle = '#b09a70';
        ctx.fillRect(0, 0, s, s);
        for (let i = 0; i < s; i += 3) {
          ctx.fillStyle = `rgba(60,45,20,${0.12 + rand() * 0.12})`;
          ctx.fillRect(i, 0, 1, s);
          ctx.fillRect(0, i, s, 1);
        }
        mottle(ctx, s, rand, 6, ['rgba(60,40,10,0.2)', 'rgba(255,240,200,0.12)'], 10, 40);
      },
      2,
    ),
  cardboard: () =>
    pbr(
      'cardboard',
      128,
      116,
      (ctx, s, rand) => {
        ctx.fillStyle = '#b28a5a';
        ctx.fillRect(0, 0, s, s);
        mottle(ctx, s, rand, 6, ['rgba(60,40,20,0.18)', 'rgba(255,230,190,0.1)'], 10, 40);
        ctx.fillStyle = 'rgba(210,200,170,0.75)';
        ctx.fillRect(s / 2 - 6, 0, 12, s);
        ctx.fillStyle = 'rgba(40,30,20,0.35)';
        ctx.fillRect(0, s / 2 - 1, s, 2);
      },
      1.5,
    ),
  // ------------------------------------------------------------- legacy / fx
  metalPlates: () => Textures.treadPlate().map,
  hazard: () =>
    decal(
      'hazard',
      64,
      64,
      23,
      (ctx, s) => {
        ctx.fillStyle = '#e6b412';
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = '#141414';
        for (let k = -s; k < s * 2; k += 16) {
          ctx.beginPath();
          ctx.moveTo(k, 0);
          ctx.lineTo(k + 8, 0);
          ctx.lineTo(k + 8 + s, s);
          ctx.lineTo(k + s, s);
          ctx.fill();
        }
      },
      true,
    ),
  /** Soft radial blob: ground glow, sparks. White, tinted by material colour. */
  radial: () =>
    decal('radial', 128, 128, 20, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }),
  /** Vertical fade for light beams (opaque bottom -> transparent top). */
  beam: () =>
    decal('beam', 64, 64, 21, (ctx, s) => {
      const g = ctx.createLinearGradient(0, s, 0, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }),
  medCross: () =>
    decal('medCross', 64, 64, 22, (ctx, s) => {
      ctx.fillStyle = '#eef2f5';
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#d6263f';
      ctx.fillRect(s * 0.4, s * 0.15, s * 0.2, s * 0.7);
      ctx.fillRect(s * 0.15, s * 0.4, s * 0.7, s * 0.2);
    }),
  /** Soft particle: bright core, used by the GPU particle system. */
  particle: () =>
    decal('particle', 64, 64, 24, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.2, 'rgba(255,255,255,0.8)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }),
  /** Tracer streak: bright head at u=1 fading to the tail at u=0. */
  tracer: () =>
    decal('tracer', 128, 16, 27, (ctx, w) => {
      const h = 16;
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.97, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0.4)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const v = ctx.createLinearGradient(0, 0, 0, h);
      v.addColorStop(0, 'rgba(0,0,0,1)');
      v.addColorStop(0.5, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, w, h);
    }),
  /** Billowy smoke / dust puff. */
  smoke: () =>
    decal('smoke', 128, 128, 25, (ctx, s, rand) => {
      for (let i = 0; i < 14; i++) {
        const r = s * (0.12 + rand() * 0.18);
        const a = rand() * Math.PI * 2;
        const d = rand() * s * 0.2;
        const x = s / 2 + Math.cos(a) * d;
        const y = s / 2 + Math.sin(a) * d;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      }
    }),
  /** Four-point muzzle flash star. */
  flash: () =>
    decal('flash', 128, 128, 26, (ctx, s) => {
      ctx.translate(s / 2, s / 2);
      const core = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.22);
      core.addColorStop(0, 'rgba(255,255,255,1)');
      core.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = core;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -4);
        ctx.lineTo(s * 0.48, 0);
        ctx.lineTo(0, 4);
        ctx.fill();
      }
    }),
  /**
   * Muzzle flame petal: base at u=0 (the muzzle), tip at u=1. Hot white
   * core near the base, ragged tapering tongue; tinted by the material.
   */
  flame: () =>
    decal('flame', 128, 64, 28, (ctx, w, rand) => {
      const h = 64;
      const cy = h / 2;
      const layers: [number, string][] = [
        [1, 'rgba(255,255,255,0.35)'],
        [0.72, 'rgba(255,255,255,0.6)'],
        [0.42, 'rgba(255,255,255,1)'],
      ];
      for (const [len, color] of layers) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, cy - h * 0.2 * len);
        const n = 7;
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const half = h * 0.42 * len * Math.pow(1 - t, 0.8) * (0.75 + rand() * 0.5);
          ctx.lineTo(w * len * t, cy - half);
        }
        for (let i = n; i >= 1; i--) {
          const t = i / n;
          const half = h * 0.42 * len * Math.pow(1 - t, 0.8) * (0.75 + rand() * 0.5);
          ctx.lineTo(w * len * t, cy + half);
        }
        ctx.lineTo(0, cy + h * 0.2 * len);
        ctx.closePath();
        ctx.fill();
      }
      // Soften: radial falloff from the base.
      const g = ctx.createRadialGradient(0, cy, 0, 0, cy, w);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.7, 'rgba(0,0,0,0.25)');
      g.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }),
};

// ------------------------------------------------------------------ decals

export const Decals = {
  /** Rounded-rect falloff for contact shadows / fake ambient occlusion (alpha). */
  softShadow: () =>
    decal('softShadow', 128, 128, 30, (ctx, s) => {
      const img = ctx.createImageData(s, s);
      const inner = s * 0.3;
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const dx = Math.max(0, Math.abs(x + 0.5 - s / 2) - inner);
          const dy = Math.max(0, Math.abs(y + 0.5 - s / 2) - inner);
          const d = Math.hypot(dx, dy) / (s / 2 - inner);
          const a = Math.max(0, 1 - d);
          const o = (y * s + x) * 4;
          img.data[o] = 0;
          img.data[o + 1] = 0;
          img.data[o + 2] = 0;
          img.data[o + 3] = Math.round(255 * a * a * (3 - 2 * a));
        }
      }
      ctx.putImageData(img, 0, 0);
    }),
  /** Grime gradient for wall bases (dark at v=0). */
  grime: () =>
    decal('grime', 64, 64, 31, (ctx, s, rand) => {
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, 'rgba(12,11,10,0.85)');
      g.addColorStop(0.35, 'rgba(18,16,14,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, rand, 400, ['rgba(0,0,0,0.15)'], 2);
    }, true),
  oil: () =>
    decal('oil', 128, 128, 32, (ctx, s, rand) => {
      for (let i = 0; i < 9; i++) {
        const r = s * (0.08 + rand() * 0.22);
        const x = s / 2 + (rand() - 0.5) * s * 0.4;
        const y = s / 2 + (rand() - 0.5) * s * 0.4;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(8,8,10,0.55)');
        g.addColorStop(0.8, 'rgba(8,8,10,0.35)');
        g.addColorStop(1, 'rgba(8,8,10,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      }
    }),
  cracks: () =>
    decal('cracks', 256, 256, 33, (ctx, s, rand) => {
      for (let i = 0; i < 3; i++) crackPath(ctx, rand, s / 2 + (rand() - 0.5) * 60, s / 2 + (rand() - 0.5) * 60, 16, 2, 'rgba(10,10,10,0.7)');
    }),
  /** Worn paint line (tiles along U). */
  paint: () =>
    decal('paint', 256, 32, 34, (ctx, w, rand) => {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillRect(0, 4, w, 24);
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.3 + rand() * 0.6})`;
        ctx.beginPath();
        ctx.ellipse(rand() * w, 4 + rand() * 24, 1 + rand() * 6, 0.5 + rand() * 3, rand() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }, true),
  /** Worn diagonal hazard stripes (tiles along U). */
  hatch: () =>
    decal('hatch', 128, 64, 35, (ctx, w, rand) => {
      const h = 64;
      ctx.fillStyle = 'rgba(230,180,18,0.95)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(16,16,16,0.95)';
      for (let k = -h; k < w + h; k += 32) {
        ctx.beginPath();
        ctx.moveTo(k, 0);
        ctx.lineTo(k + 16, 0);
        ctx.lineTo(k + 16 + h, h);
        ctx.lineTo(k + h, h);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 160; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.3 + rand() * 0.6})`;
        ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 5, 1 + rand() * 3);
      }
    }, true),
  manhole: () =>
    decal('manhole', 128, 128, 36, (ctx, s) => {
      ctx.translate(s / 2, s / 2);
      ctx.fillStyle = 'rgba(28,29,31,1)';
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.47, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,92,96,0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(70,72,76,0.85)';
      ctx.lineWidth = 2;
      for (let r = 10; r < s * 0.44; r += 9) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let i = 0; i < 8; i++) {
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.moveTo(0, 8);
        ctx.lineTo(0, s * 0.44);
        ctx.stroke();
      }
    }),
  drain: () =>
    decal('drain', 128, 64, 37, (ctx, w) => {
      const h = 64;
      ctx.fillStyle = 'rgba(40,42,45,1)';
      ctx.fillRect(4, 4, w - 8, h - 8);
      ctx.fillStyle = 'rgba(5,5,6,1)';
      for (let x = 12; x < w - 12; x += 10) ctx.fillRect(x, 12, 5, h - 24);
    }),
  /** Irregular puddle mask. */
  puddle: () =>
    decal('puddle', 256, 256, 38, (ctx, s, rand) => {
      for (let i = 0; i < 10; i++) {
        const r = s * (0.1 + rand() * 0.18);
        const x = s / 2 + (rand() - 0.5) * s * 0.45;
        const y = s / 2 + (rand() - 0.5) * s * 0.3;
        const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      }
    }),
  /** Warm light cast on the floor (additive). */
  lightPool: () =>
    decal('lightPool', 128, 128, 39, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.3, 'rgba(255,255,255,0.45)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }),
  /** Directional floodlight cone on the floor (apex at v=0, additive). */
  lightCone: () =>
    decal('lightCone', 128, 128, 40, (ctx, s) => {
      ctx.beginPath();
      ctx.moveTo(s / 2, 0);
      ctx.lineTo(s, s);
      ctx.lineTo(0, s);
      ctx.closePath();
      ctx.clip();
      const g = ctx.createRadialGradient(s / 2, 0, 0, s / 2, 0, s);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.25)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }),
  tireMarks: () =>
    decal('tireMarks', 256, 128, 41, (ctx, w, rand) => {
      ctx.lineCap = 'round';
      for (let k = 0; k < 2; k++) {
        const y0 = 34 + k * 56;
        ctx.strokeStyle = 'rgba(6,6,7,0.5)';
        ctx.lineWidth = 12;
        ctx.beginPath();
        ctx.moveTo(0, y0);
        ctx.bezierCurveTo(w * 0.35, y0 + (rand() - 0.5) * 30, w * 0.65, y0 + (rand() - 0.5) * 30, w, y0 + (rand() - 0.5) * 20);
        ctx.stroke();
      }
    }),
  /** Painted floor arrow (points +U). */
  arrow: () =>
    decal('arrow', 128, 64, 42, (ctx, w, rand) => {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(8, 24);
      ctx.lineTo(80, 24);
      ctx.lineTo(80, 8);
      ctx.lineTo(120, 32);
      ctx.lineTo(80, 56);
      ctx.lineTo(80, 40);
      ctx.lineTo(8, 40);
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 90; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.3 + rand() * 0.6})`;
        ctx.fillRect(rand() * w, rand() * 64, 1 + rand() * 4, 1 + rand() * 3);
      }
    }),
  /** Extraction pad marking: ring, ticks and chevrons. */
  pad: () =>
    decal('pad', 512, 512, 43, (ctx, s) => {
      ctx.translate(s / 2, s / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 48; i++) {
        ctx.rotate((Math.PI * 2) / 48);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(-2, -s * 0.46 + 12, 4, i % 4 === 0 ? 22 : 10);
      }
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        for (let k = 0; k < 2; k++) {
          const y = -s * 0.3 + k * 26;
          ctx.beginPath();
          ctx.moveTo(-26, y);
          ctx.lineTo(0, y + 18);
          ctx.lineTo(26, y);
          ctx.lineTo(26, y + 10);
          ctx.lineTo(0, y + 28);
          ctx.lineTo(-26, y + 10);
          ctx.fill();
        }
      }
      ctx.font = '700 44px "Chakra Petch", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('EXTRACT', 0, 0);
    }),
  /** Floor emblem for the vault. */
  emblem: () =>
    decal('emblem', 512, 512, 44, (ctx, s) => {
      ctx.translate(s / 2, s / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.42);
      ctx.lineTo(s * 0.42, 0);
      ctx.lineTo(0, s * 0.42);
      ctx.lineTo(-s * 0.42, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = '700 40px "Chakra Petch", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText('THE VAULT', 0, 0);
    }),
};

/** Worn stencil lettering (white, tinted by material). Cached per text. */
export function stencilTexture(text: string): THREE.CanvasTexture {
  return decal(`stencil:${text}`, 512, 128, text.length * 7 + 45, (ctx, w, rand) => {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '700 88px "Chakra Petch", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, 68, w - 20);
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 380; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.3 + rand() * 0.6})`;
      ctx.fillRect(rand() * w, rand() * 128, 1 + rand() * 6, 1 + rand() * 3);
    }
  });
}

export function disposeTextures(): void {
  for (const t of cache.values()) {
    if (t instanceof THREE.Texture) t.dispose();
    else if (t && typeof t === 'object' && 'map' in t) {
      (t as PbrTextures).map.dispose();
      (t as PbrTextures).normalMap.dispose();
    }
  }
  cache.clear();
}
