import * as THREE from 'three';

/**
 * GPU particle pool. Every particle is an instanced camera-facing quad whose
 * motion (velocity, drag, gravity), growth and fade are evaluated in the
 * vertex shader from its spawn parameters, so the CPU only writes new
 * particles into a ring buffer. One draw call per pool.
 */

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Downward acceleration (units/s²). */
  gravity?: number;
  /** Exponential velocity damping (1/s). */
  drag?: number;
  color: THREE.ColorRepresentation;
  /** Colour multiplier (>1 = HDR, feeds bloom in additive pools). */
  intensity?: number;
  alpha?: number;
  size: number;
  endSize?: number;
  /** Lifetime in ms. */
  life: number;
  /** >0 stretches the quad along its screen-space velocity (sparks, streaks). */
  stretch?: number;
  /** Initial rotation (radians) for round particles. */
  rotation?: number;
  /** Rotation speed (rad/s). */
  spin?: number;
}

const vertexShader = /* glsl */ `
  attribute vec4 aStart;   // xyz, birth time (s)
  attribute vec4 aVel;     // xyz, gravity
  attribute vec4 aColor;   // rgb, alpha
  attribute vec4 aSize;    // size0, size1, life (s), drag
  attribute vec3 aExtra;   // stretch, rotation, spin
  uniform float uTime;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vT;
  void main() {
    float age = uTime - aStart.w;
    float t = age / aSize.z;
    if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float drag = aSize.w;
    float k = drag > 0.0 ? (1.0 - exp(-drag * age)) / drag : age;
    vec3 p = aStart.xyz + aVel.xyz * k;
    p.y -= 0.5 * aVel.w * age * age;
    p.y = max(p.y, 1.5);
    vec3 vel = aVel.xyz * (drag > 0.0 ? exp(-drag * age) : 1.0) - vec3(0.0, aVel.w * age, 0.0);
    float size = mix(aSize.x, aSize.y, t);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec2 q = position.xy;
    if (aExtra.x > 0.0) {
      vec2 vv = (modelViewMatrix * vec4(vel, 0.0)).xy;
      float speed = length(vv);
      vec2 dir = speed > 0.001 ? vv / speed : vec2(1.0, 0.0);
      vec2 nrm = vec2(-dir.y, dir.x);
      float len = size + speed * aExtra.x;
      mv.xy += dir * q.x * len + nrm * q.y * size;
    } else {
      float a = aExtra.y + aExtra.z * age;
      float c = cos(a);
      float s = sin(a);
      mv.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c) * size;
    }
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vColor = aColor;
    vT = t;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uSoftIn;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vT;
  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float fadeIn = uSoftIn > 0.0 ? smoothstep(0.0, uSoftIn, vT) : 1.0;
    float fade = fadeIn * (1.0 - vT) * (1.0 - vT * 0.3);
    gl_FragColor = vec4(vColor.rgb * tex.rgb, tex.a * vColor.a * fade);
    if (gl_FragColor.a < 0.004) discard;
  }
`;

export class ParticlePool {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly start: THREE.InstancedBufferAttribute;
  private readonly vel: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly size: THREE.InstancedBufferAttribute;
  private readonly extra: THREE.InstancedBufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private cursor = 0;
  private dirtyFrom = Infinity;
  private dirtyTo = -1;
  private readonly c = new THREE.Color();
  /** Spawn budget multiplier set by the graphics quality (0..1). */
  density = 1;

  constructor(
    readonly max: number,
    texture: THREE.Texture,
    blending: 'additive' | 'normal',
    softIn = 0,
  ) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.attributes.position!);
    this.geo.setAttribute('uv', quad.attributes.uv!);
    const make = (n: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.start = make(4);
    this.vel = make(4);
    this.color = make(4);
    this.size = make(4);
    this.extra = make(3);
    // Everything starts expired.
    for (let i = 0; i < max; i++) this.start.setW(i, -1e6);
    this.geo.setAttribute('aStart', this.start);
    this.geo.setAttribute('aVel', this.vel);
    this.geo.setAttribute('aColor', this.color);
    this.geo.setAttribute('aSize', this.size);
    this.geo.setAttribute('aExtra', this.extra);
    this.geo.instanceCount = max;
    for (let i = 0; i < max; i++) this.size.setXYZW(i, 0, 0, 1, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uTime: { value: 0 }, uMap: { value: texture }, uSoftIn: { value: softIn } },
      transparent: true,
      depthWrite: false,
      blending: blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: blending !== 'additive',
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = blending === 'additive' ? 12 : 11;
  }

  /** Current shader clock (seconds). */
  get time(): number {
    return this.material.uniforms.uTime!.value as number;
  }

  /** Returns false when the spawn was skipped by the density budget. */
  spawn(p: ParticleSpawn): boolean {
    if (this.density < 1 && Math.random() > this.density) return false;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.c.set(p.color).multiplyScalar(p.intensity ?? 1);
    this.start.setXYZW(i, p.x, p.y, p.z, this.time);
    this.vel.setXYZW(i, p.vx ?? 0, p.vy ?? 0, p.vz ?? 0, p.gravity ?? 0);
    this.color.setXYZW(i, this.c.r, this.c.g, this.c.b, p.alpha ?? 1);
    this.size.setXYZW(i, p.size, p.endSize ?? p.size, Math.max(0.016, p.life / 1000), p.drag ?? 0);
    this.extra.setXYZ(i, p.stretch ?? 0, p.rotation ?? Math.random() * Math.PI * 2, p.spin ?? 0);
    this.dirtyFrom = Math.min(this.dirtyFrom, i);
    this.dirtyTo = Math.max(this.dirtyTo, i);
    return true;
  }

  /** Advances the clock and uploads only the slots written since the last frame. */
  update(timeSec: number): void {
    this.material.uniforms.uTime!.value = timeSec;
    if (this.dirtyTo < 0) return;
    const from = this.dirtyFrom;
    const count = this.dirtyTo - this.dirtyFrom + 1;
    for (const a of [this.start, this.vel, this.color, this.size, this.extra]) {
      a.clearUpdateRanges();
      a.addUpdateRange(from * a.itemSize, count * a.itemSize);
      a.needsUpdate = true;
    }
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
