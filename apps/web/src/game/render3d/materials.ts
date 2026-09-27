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

/** Cached PBR material by parameters (shared across all meshes). */
export function mat(color: number, opts: { rough?: number; metal?: number; emissive?: number; emissiveIntensity?: number; map?: THREE.Texture; flat?: boolean } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.rough ?? 0.8}|${opts.metal ?? 0}|${opts.emissive ?? 0}|${opts.emissiveIntensity ?? 1}|${opts.map?.uuid ?? ''}|${opts.flat ? 1 : 0}`;
  let m = standardCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.8,
      metalness: opts.metal ?? 0,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      map: opts.map ?? null,
      flatShading: opts.flat ?? false,
    });
    standardCache.set(key, m);
  }
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
  standardCache.clear();
  glowCache.clear();
}
