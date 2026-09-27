import type { MapData, RectObstacle } from '@extract/game-types';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glow, mat, withProximityFade } from './materials';
import { COLORS, FLOOR_GROUND, HEIGHT, ZONE_GROUND, type GroundKind } from './style';
import { Textures } from './textures';

const GROUND_TEX: Record<GroundKind, () => THREE.Texture> = {
  grass: Textures.grass,
  forest: Textures.forestFloor,
  asphalt: Textures.asphalt,
  concrete: Textures.concrete,
  planks: Textures.planks,
  tiles: Textures.tiles,
  metal: Textures.metalPlates,
};

/** Collects geometries per material and merges them into one mesh each. */
class Batcher {
  private readonly groups = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(material: THREE.Material, geometry: THREE.BufferGeometry): void {
    let list = this.groups.get(material);
    if (!list) {
      list = [];
      this.groups.set(material, list);
    }
    list.push(geometry);
  }

  flush(parent: THREE.Object3D, shadows: { cast: boolean; receive: boolean }): void {
    for (const [material, geoms] of this.groups) {
      const merged = mergeGeometries(geoms, false);
      for (const g of geoms) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = shadows.cast;
      mesh.receiveShadow = shadows.receive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
    }
    this.groups.clear();
  }
}

/** Horizontal plane covering a map rect, with world-scaled UVs so textures tile. */
function groundPlane(x: number, y: number, w: number, h: number, height: number, tile: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    // World-anchored UVs (u = x, v = -z) so neighbouring patches tile seamlessly.
    uv.setXY(i, (uv.getX(i) * w + x) / tile, (uv.getY(i) * h - y - h) / tile);
  }
  g.translate(x + w / 2, height, y + h / 2);
  return g;
}

function box(x: number, y: number, w: number, d: number, h: number, base = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x + w / 2, base + h / 2, y + d / 2);
  return g;
}

function labelTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 170px "Chakra Petch", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 132);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface MapVisuals {
  root: THREE.Group;
  setVaultActive(active: boolean, time: number): void;
}

export function buildMap(map: MapData): MapVisuals {
  const root = new THREE.Group();
  root.name = 'map';

  // --- Ground --------------------------------------------------------------
  const pad = 2500;
  const outside = new THREE.Mesh(
    groundPlane(-pad, -pad, map.width + pad * 2, map.height + pad * 2, -0.5, 300),
    mat(0x55705a, { map: Textures.grass(), rough: 1 }),
  );
  outside.receiveShadow = true;
  root.add(outside);

  const floors = new Batcher();
  for (const z of map.zones) {
    const s = ZONE_GROUND[z.type];
    floors.add(mat(s.tint, { map: GROUND_TEX[s.kind](), rough: 0.95 }), groundPlane(z.x, z.y, z.w, z.h, 0.4, s.tile));
  }
  for (const f of map.floors) {
    const s = FLOOR_GROUND[f.style];
    floors.add(mat(s.tint, { map: GROUND_TEX[s.kind](), rough: s.kind === 'metal' ? 0.6 : 0.95, metal: s.kind === 'metal' ? 0.4 : 0 }), groundPlane(f.x, f.y, f.w, f.h, s.y, s.tile));
  }
  // Road markings.
  const marking = mat(0xe9e6d8, { rough: 0.7 });
  for (const f of map.floors) {
    if (f.style !== 'road') continue;
    const horizontal = f.w > f.h;
    const len = horizontal ? f.w : f.h;
    for (let d = 20; d < len - 40; d += 110) {
      floors.add(marking, horizontal ? groundPlane(f.x + d, f.y + f.h / 2 - 3, 55, 6, 1.6, 64) : groundPlane(f.x + f.w / 2 - 3, f.y + d, 6, 55, 1.6, 64));
    }
    // Curb lines.
    const edge = mat(0x9c9786, { rough: 0.8 });
    if (horizontal) {
      floors.add(edge, groundPlane(f.x, f.y, f.w, 4, 1.5, 64));
      floors.add(edge, groundPlane(f.x, f.y + f.h - 4, f.w, 4, 1.5, 64));
    } else {
      floors.add(edge, groundPlane(f.x, f.y, 4, f.h, 1.5, 64));
      floors.add(edge, groundPlane(f.x + f.w - 4, f.y, 4, f.h, 1.5, 64));
    }
  }
  floors.flush(root, { cast: false, receive: true });

  // Faint zone names painted on the ground.
  for (const z of map.zones) {
    const w = Math.min(z.w * 0.8, 1100);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w / 4),
      new THREE.MeshBasicMaterial({ map: labelTexture(z.name.toUpperCase()), transparent: true, opacity: 0.1, depthWrite: false }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(z.x + z.w / 2, 3, z.y + z.h / 2);
    root.add(plane);
  }

  // --- Solid obstacles ---------------------------------------------------------
  const vault = map.zones.find((z) => z.type === 'HIGH_VALUE');
  const inVault = (o: RectObstacle) =>
    !!vault && o.x >= vault.x - 1 && o.y >= vault.y - 1 && o.x + o.w <= vault.x + vault.w + 1 && o.y + o.h <= vault.y + vault.h + 1;
  const isBorder = (o: RectObstacle) => o.x <= 0 || o.y <= 0 || o.x + o.w >= map.width || o.y + o.h >= map.height;

  const solids = new Batcher();
  const lights = new Batcher();
  const vaultTrimMat = new THREE.MeshStandardMaterial({ color: 0x3d2e05, emissive: COLORS.vaultTrim, emissiveIntensity: 0.25, roughness: 0.4, metalness: 0.8 });

  const wallMat = mat(COLORS.wall, { rough: 0.9 });
  const capMat = mat(COLORS.wallCap, { rough: 0.7 });
  const borderMat = mat(COLORS.border, { rough: 0.95 });
  const vaultMat = mat(COLORS.vault, { rough: 0.45, metal: 0.6, map: Textures.metalPlates() });
  const containerMats = COLORS.containerTints.map((c) => mat(c, { map: Textures.corrugated(), rough: 0.7, metal: 0.3 }));
  const crateMat = mat(COLORS.crateStack, { map: Textures.crateWood(), rough: 0.85 });
  const machineMat = mat(COLORS.machine, { rough: 0.5, metal: 0.6 });
  const hazardMat = mat(0xffffff, { map: Textures.hazard(), rough: 0.6 });
  const pumpMat = mat(COLORS.pump, { rough: 0.5 });
  const pumpTopMat = mat(0xe5e7eb, { rough: 0.5 });

  for (const o of map.obstacles) {
    if (o.kind !== 'rect') continue;
    switch (o.style) {
      case 'wall': {
        if (isBorder(o)) {
          solids.add(borderMat, box(o.x, o.y, o.w, o.h, HEIGHT.border));
        } else if (inVault(o)) {
          solids.add(vaultMat, box(o.x, o.y, o.w, o.h, HEIGHT.vault));
          solids.add(vaultTrimMat, box(o.x - 1, o.y - 1, o.w + 2, o.h + 2, 5, HEIGHT.vault));
        } else {
          solids.add(wallMat, box(o.x, o.y, o.w, o.h, HEIGHT.wall));
          solids.add(capMat, box(o.x - 1, o.y - 1, o.w + 2, o.h + 2, 4, HEIGHT.wall));
        }
        break;
      }
      case 'container': {
        const stacked = o.id % 3 === 0;
        const tint = containerMats[(o.tint ?? 0) % containerMats.length]!;
        solids.add(tint, box(o.x, o.y, o.w, o.h, HEIGHT.container));
        if (stacked) solids.add(containerMats[((o.tint ?? 0) + 2) % containerMats.length]!, box(o.x + 2, o.y + 2, o.w - 4, o.h - 4, HEIGHT.container, HEIGHT.container));
        break;
      }
      case 'machine': {
        solids.add(machineMat, box(o.x, o.y, o.w, o.h, HEIGHT.machine));
        solids.add(hazardMat, box(o.x + 4, o.y + 4, o.w - 8, 6, 2, HEIGHT.machine));
        const lightColor = o.id % 2 === 0 ? 0x4ade80 : 0xf59e0b;
        lights.add(glow(lightColor, 1, null, 3), box(o.x + o.w - 16, o.y + o.h - 16, 8, 8, 6, HEIGHT.machine));
        break;
      }
      case 'pump':
        solids.add(pumpMat, box(o.x, o.y, o.w, o.h, HEIGHT.pump));
        solids.add(pumpTopMat, box(o.x - 2, o.y - 2, o.w + 4, o.h + 4, 5, HEIGHT.pump));
        break;
      case 'vault':
        solids.add(vaultMat, box(o.x, o.y, o.w, o.h, HEIGHT.vault + 20));
        solids.add(vaultTrimMat, box(o.x - 2, o.y - 2, o.w + 4, o.h + 4, 6, HEIGHT.vault));
        break;
      case 'crate_stack':
        solids.add(crateMat, box(o.x, o.y, o.w, o.h, HEIGHT.crate_stack));
        solids.add(crateMat, box(o.x + 6, o.y + 4, o.w - 12, o.h - 10, 30, HEIGHT.crate_stack));
        break;
      default:
        solids.add(wallMat, box(o.x, o.y, o.w, o.h, HEIGHT.wall));
    }
  }
  solids.flush(root, { cast: true, receive: true });
  lights.flush(root, { cast: false, receive: false });

  // --- Trees & rocks (instanced) -------------------------------------------------
  const trees = map.obstacles.filter((o) => o.kind === 'circle' && o.style === 'tree');
  const rocks = map.obstacles.filter((o) => o.kind === 'circle' && o.style !== 'tree');
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const color = new THREE.Color();
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  if (trees.length) {
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.25, 1, 7), mat(COLORS.treeTrunk, { rough: 1 }), trees.length);
    const lowGeo = new THREE.IcosahedronGeometry(1, 1);
    const topGeo = new THREE.IcosahedronGeometry(1, 0);
    const canopyLow = new THREE.InstancedMesh(lowGeo, withProximityFade(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true })), trees.length);
    const canopyTop = new THREE.InstancedMesh(topGeo, withProximityFade(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true })), trees.length);
    trees.forEach((t, i) => {
      if (t.kind !== 'circle') return;
      const r = t.r;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
      m4.compose(new THREE.Vector3(t.x, 30, t.y), q, new THREE.Vector3(r * 0.22, 60, r * 0.22));
      trunk.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(t.x, 78 + r * 0.3, t.y), q, new THREE.Vector3(r * 1.15, r * 0.8, r * 1.15));
      canopyLow.setMatrixAt(i, m4);
      color.setHex(COLORS.treeCanopy[i % COLORS.treeCanopy.length]!).multiplyScalar(0.85 + rnd() * 0.3);
      canopyLow.setColorAt(i, color);
      m4.compose(new THREE.Vector3(t.x + (rnd() - 0.5) * r * 0.3, 102 + r * 0.55, t.y + (rnd() - 0.5) * r * 0.3), q, new THREE.Vector3(r * 0.75, r * 0.65, r * 0.75));
      canopyTop.setMatrixAt(i, m4);
      color.multiplyScalar(1.18);
      canopyTop.setColorAt(i, color);
    });
    for (const mesh of [trunk, canopyLow, canopyTop]) {
      mesh.castShadow = true;
      mesh.receiveShadow = mesh !== canopyTop;
      root.add(mesh);
    }
  }

  if (rocks.length) {
    const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), rocks.length);
    rocks.forEach((o, i) => {
      if (o.kind !== 'circle') return;
      q.setFromEuler(new THREE.Euler(rnd() * 0.4, rnd() * Math.PI * 2, rnd() * 0.4));
      m4.compose(new THREE.Vector3(o.x, o.r * 0.25, o.y), q, new THREE.Vector3(o.r * 1.05, o.r * 0.7, o.r * 1.05));
      rockMesh.setMatrixAt(i, m4);
      color.setHex(COLORS.rock).multiplyScalar(0.8 + rnd() * 0.35);
      rockMesh.setColorAt(i, color);
    });
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    root.add(rockMesh);
  }

  return {
    root,
    setVaultActive(active: boolean, time: number) {
      vaultTrimMat.emissiveIntensity = active ? 1.6 + Math.sin(time / 300) * 0.6 : 0.25;
    },
  };
}
