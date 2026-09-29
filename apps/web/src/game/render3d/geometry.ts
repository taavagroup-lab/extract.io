import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Static-geometry helpers for the map: everything is collected per material
 * and merged into one mesh per material (a few dozen draw calls for the
 * whole world). Map coordinates: x -> world X, y -> world Z, height -> Y.
 */

const KEEP = new Set(['position', 'normal', 'uv']);

function normalize(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  for (const name of Object.keys(out.attributes)) if (!KEEP.has(name)) out.deleteAttribute(name);
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((out.attributes.position!.count) * 2), 2));
  return out;
}

const mergeCache = new Map<string, { material: THREE.Material; geometry: THREE.BufferGeometry; cast: boolean }[]>();

/**
 * Merges the direct child meshes of `group` into one mesh per material
 * (draw calls: one per material instead of one per part). Meshes that
 * `keep` accepts (animated parts) and non-mesh children stay as they are.
 * With a `cacheKey` the merged geometries are shared by every group built
 * the same way (e.g. all characters wearing the same skin).
 */
export function mergeStatic(group: THREE.Object3D, keep: (m: THREE.Mesh) => boolean = () => false, cacheKey?: string): void {
  const meshes = group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh) && !keep(c) && !Array.isArray(c.material));
  if (meshes.length < 2) return;
  let merged = cacheKey ? mergeCache.get(cacheKey) : undefined;
  if (!merged) {
    const byMat = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean }>();
    for (const m of meshes) {
      m.updateMatrix();
      const g = normalize(m.geometry.clone().applyMatrix4(m.matrix));
      const entry = byMat.get(m.material as THREE.Material) ?? { geos: [], cast: false };
      entry.geos.push(g);
      entry.cast ||= m.castShadow;
      byMat.set(m.material as THREE.Material, entry);
    }
    merged = [...byMat.entries()].map(([material, e]) => {
      const geometry = mergeGeometries(e.geos, false)!;
      for (const g of e.geos) g.dispose();
      return { material, geometry, cast: e.cast };
    });
    if (cacheKey) mergeCache.set(cacheKey, merged);
  }
  for (const m of meshes) m.removeFromParent();
  for (const { material, geometry, cast } of merged) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = cast;
    group.add(mesh);
  }
}

export interface FlushOptions {
  cast: boolean;
  receive: boolean;
  renderOrder?: number;
}

/** Collects geometries per material and merges them into one mesh each. */
export class Batcher {
  private readonly groups = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(material: THREE.Material, geometry: THREE.BufferGeometry): void {
    let list = this.groups.get(material);
    if (!list) {
      list = [];
      this.groups.set(material, list);
    }
    list.push(normalize(geometry));
  }

  get size(): number {
    return this.groups.size;
  }

  flush(parent: THREE.Object3D, opts: FlushOptions): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [material, geoms] of this.groups) {
      const merged = mergeGeometries(geoms, false);
      for (const g of geoms) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = opts.cast;
      mesh.receiveShadow = opts.receive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (opts.renderOrder !== undefined) mesh.renderOrder = opts.renderOrder;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.groups.clear();
    return meshes;
  }
}

/** Remaps a geometry's UVs to world space (tiling textures continue across pieces). */
export function worldUV(g: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (ny > 0.5) uv.setXY(i, x / tile, -z / tile);
    else if (nx > 0.5) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  uv.needsUpdate = true;
  return g;
}

/** Axis-aligned box on the ground rect (x, y, w, d) from `base` up by `h`. */
export function box(x: number, y: number, w: number, d: number, h: number, base = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x + w / 2, base + h / 2, y + d / 2);
  return g;
}

/** Box with world-space UVs. */
export function tiledBox(x: number, y: number, w: number, d: number, h: number, base: number, tile: number): THREE.BufferGeometry {
  return worldUV(box(x, y, w, d, h, base), tile);
}

/** Vertical cylinder standing on (cx, cy). */
export function cylinder(cx: number, cy: number, r: number, h: number, base = 0, segments = 12, rTop = r): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, r, h, segments);
  g.translate(cx, base + h / 2, cy);
  return g;
}

/** Horizontal plane over a map rect with world-scaled UVs. */
export function groundPlane(x: number, y: number, w: number, h: number, height: number, tile: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w + x) / tile, (uv.getY(i) * h - y - h) / tile);
  g.translate(x + w / 2, height, y + h / 2);
  return g;
}

/**
 * Decal quad lying on the floor, centred at (cx, cy), `w` along its local U
 * axis, rotated by `angle` (radians, 0 = +X). UVs span 0..1 unless `uRepeat`.
 */
export function floorQuad(cx: number, cy: number, w: number, d: number, height: number, angle = 0, uRepeat = 1, vRepeat = 1): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  if (uRepeat !== 1 || vRepeat !== 1) {
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uRepeat, uv.getY(i) * vRepeat);
  }
  g.rotateY(-angle);
  g.translate(cx, height, cy);
  return g;
}

/** Applies a Y rotation around (cx, cy) in map space. */
export function rotateAround(g: THREE.BufferGeometry, cx: number, cy: number, angle: number): THREE.BufferGeometry {
  g.translate(-cx, 0, -cy);
  g.rotateY(-angle);
  g.translate(cx, 0, cy);
  return g;
}

/** Deterministic PRNG for set dressing (same map -> same decoration everywhere). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
