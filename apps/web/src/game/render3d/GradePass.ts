import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Colour grade in linear HDR (before tone mapping): vibrance, log-space
 * contrast, cool-shadow / warm-highlight split tone, vignette, plus two
 * gameplay tints: low health drains colour at the rim, extraction lifts
 * the frame towards green. Saturated emissives (tracers, beams, rarity
 * glows) keep their hue. One full-screen pass; only used on MEDIUM+.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSat: { value: 1.04 },
    uVib: { value: 0.16 },
    uContrast: { value: 1.08 },
    uShadowTint: { value: new THREE.Vector3(0.965, 0.99, 1.04) },
    uHighTint: { value: new THREE.Vector3(1.03, 1.0, 0.965) },
    uVignette: { value: 0.3 },
    uAspect: { value: 1.7 },
    uHurt: { value: 0 },
    uExtract: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Vector3(1, 0.8, 0.3) },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSat, uVib, uContrast, uVignette, uAspect, uHurt, uExtract, uFlash;
    uniform vec3 uShadowTint, uHighTint, uFlashColor;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      float mx = max(c.r, max(c.g, c.b));
      float mn = min(c.r, min(c.g, c.b));
      float chroma = (mx - mn) / max(mx, 1e-4);
      // vibrance: muted colours gain saturation, saturated ones barely move
      c.rgb = max(mix(vec3(l), c.rgb, uSat + uVib * (1.0 - smoothstep(0.1, 0.7, chroma))), 0.0);
      // contrast around mid grey in log space (keeps HDR highlights ordered)
      c.rgb = 0.18 * pow(max(c.rgb, vec3(1e-6)) / 0.18, vec3(uContrast));
      // split tone for neutrals only
      float lt = smoothstep(0.015, 0.55, l);
      c.rgb *= mix(vec3(1.0), mix(uShadowTint, uHighTint, lt), 1.0 - 0.85 * smoothstep(0.35, 0.8, chroma));
      vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
      float r = length(q);
      c.rgb *= 1.0 - uVignette * smoothstep(0.55, 1.25, r);
      // low health: drain saturation and darken the rim (the HUD draws the red edge)
      float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(c.rgb, vec3(lum), uHurt * 0.5);
      c.rgb *= 1.0 - uHurt * 0.3 * smoothstep(0.35, 1.1, r);
      // extracting: faint green lift towards the edges
      c.rgb += vec3(0.02, 0.07, 0.035) * uExtract * smoothstep(0.3, 1.0, r);
      // legendary find: brief warm lift, strongest in the centre
      c.rgb += uFlashColor * uFlash * 0.22 * (1.0 - 0.6 * smoothstep(0.0, 1.0, r));
      gl_FragColor = c;
    }`,
};

export class GradePass extends ShaderPass {
  constructor() {
    super(GradeShader);
  }

  setAspect(aspect: number): void {
    this.uniforms.uAspect!.value = aspect;
  }

  /** Eased gameplay tints (0..1). */
  setState(hurt: number, extract: number, dt: number): void {
    const u = this.uniforms;
    const k = Math.min(1, dt * 4);
    u.uHurt!.value += (hurt - (u.uHurt!.value as number)) * k;
    u.uExtract!.value += (extract - (u.uExtract!.value as number)) * k;
    u.uFlash!.value = Math.max(0, (u.uFlash!.value as number) - dt * 1.6);
  }

  /** Short full-screen colour flash (legendary finds). */
  flash(color: number, amount: number): void {
    const c = new THREE.Color(color);
    (this.uniforms.uFlashColor!.value as THREE.Vector3).set(c.r, c.g, c.b);
    this.uniforms.uFlash!.value = Math.max(this.uniforms.uFlash!.value as number, amount);
  }
}
