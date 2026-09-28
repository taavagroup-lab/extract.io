import * as THREE from 'three';

/** Shared uniform: world position the tree canopies fade around (the local player). */
export const fadeUniforms = {
  uFadeCenter: { value: new THREE.Vector3(-99999, 0, -99999) },
};

/**
 * Makes a (possibly instanced) material fade out around `fadeUniforms.uFadeCenter`
 * so canopies never hide your own character.
 */
export function withProximityFade(material: THREE.MeshStandardMaterial, inner = 70, outer = 170, minAlpha = 0.22): THREE.MeshStandardMaterial {
  material.transparent = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFadeCenter = fadeUniforms.uFadeCenter;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFadeWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 fadeWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fadeWorld = instanceMatrix * fadeWorld;
        #endif
        vFadeWorld = (modelMatrix * fadeWorld).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uFadeCenter;\nvarying vec3 vFadeWorld;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float fadeD = distance(vFadeWorld.xz, uFadeCenter.xz);
        gl_FragColor.a *= mix(${minAlpha.toFixed(2)}, 1.0, smoothstep(${inner.toFixed(1)}, ${outer.toFixed(1)}, fadeD));`,
      );
  };
  material.customProgramCacheKey = () => `fade-${inner}-${outer}-${minAlpha}`;
  return material;
}

const standardCache = new Map<string, THREE.MeshStandardMaterial>();

export interface MatOptions {
  rough?: number;
  metal?: number;
  emissive?: number;
  emissiveIntensity?: number;
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  /** Strength of the normal map (default 1). */
  normal?: number;
  flat?: boolean;
}

/** Cached PBR material by parameters (shared across all meshes). */
export function mat(color: number, opts: MatOptions = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.rough ?? 0.8}|${opts.metal ?? 0}|${opts.emissive ?? 0}|${opts.emissiveIntensity ?? 1}|${opts.map?.uuid ?? ''}|${opts.normalMap?.uuid ?? ''}|${opts.normal ?? 1}|${opts.flat ? 1 : 0}`;
  let m = standardCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.8,
      metalness: opts.metal ?? 0,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      map: opts.map ?? null,
      normalMap: opts.normalMap ?? null,
      flatShading: opts.flat ?? false,
    });
    if (opts.normalMap) m.normalScale.setScalar(opts.normal ?? 1);
    standardCache.set(key, m);
  }
  return m;
}

/** PBR material from a texture pair (albedo + normal). */
export function surface(color: number, tex: { map: THREE.Texture; normalMap: THREE.Texture }, opts: Omit<MatOptions, 'map' | 'normalMap'> = {}): THREE.MeshStandardMaterial {
  return mat(color, { ...opts, map: tex.map, normalMap: tex.normalMap });
}

const decalCache = new Map<string, THREE.Material>();

export type DecalKind = 'shade' | 'paint' | 'additive' | 'wet';

/**
 * Floor decal materials (no depth write, polygon offset so they never fight
 * the floor). shade = unlit darkening (contact shadows, grime, oil),
 * paint = lit paint/markings, additive = fake light pools, wet = glossy puddles.
 */
export function decalMat(kind: DecalKind, map: THREE.Texture, color = 0xffffff, opacity = 1): THREE.Material {
  const key = `${kind}|${map.uuid}|${color}|${opacity}`;
  let m = decalCache.get(key);
  if (m) return m;
  const common = { map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, opacity, side: THREE.DoubleSide };
  switch (kind) {
    case 'shade':
      m = new THREE.MeshBasicMaterial({ ...common, color, fog: true });
      break;
    case 'additive':
      m = new THREE.MeshBasicMaterial({ ...common, color, blending: THREE.AdditiveBlending, toneMapped: false });
      break;
    case 'wet':
      m = new THREE.MeshStandardMaterial({ ...common, color, roughness: 0.06, metalness: 0.55 });
      break;
    default:
      m = new THREE.MeshStandardMaterial({ ...common, color, roughness: 0.75 });
  }
  decalCache.set(key, m);
  return m;
}

const glowCache = new Map<string, THREE.MeshBasicMaterial>();

/** Unlit, additive, HDR-capable material for beams / rings / tracers (feeds the bloom pass). */
export function glow(color: number, opacity = 1, map: THREE.Texture | null = null, intensity = 1): THREE.MeshBasicMaterial {
  const key = `${color}|${opacity}|${map?.uuid ?? ''}|${intensity}`;
  let m = glowCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      transparent: true,
      opacity,
      map,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    glowCache.set(key, m);
  }
  return m;
}

export function disposeMaterials(): void {
  for (const m of standardCache.values()) m.dispose();
  for (const m of glowCache.values()) m.dispose();
  for (const m of decalCache.values()) m.dispose();
  standardCache.clear();
  glowCache.clear();
  decalCache.clear();
}
