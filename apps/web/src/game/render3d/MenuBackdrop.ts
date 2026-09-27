import { generateMap } from '@extract/shared';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildMap } from './MapBuilder3D';
import { glow } from './materials';
import { COLORS } from './style';
import { Textures } from './textures';

/**
 * Cinematic main-menu background: the real map rendered in 3D with a slow
 * camera flight around the vault. No networking, no game logic.
 */
export class MenuBackdrop {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 10, 9000);
  private readonly resizeObserver: ResizeObserver;
  private readonly beams: THREE.Mesh[] = [];
  private readonly start = performance.now();

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'menu-webgl';
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    pmrem.dispose();
    this.scene.background = new THREE.Color(0x0a0f16);
    this.scene.fog = new THREE.Fog(0x0a0f16, 2600, 5200);

    const map = generateMap();
    this.scene.add(buildMap(map).root);
    this.scene.add(new THREE.HemisphereLight(0x9fb8e0, 0x1c1610, 0.75));
    const sun = new THREE.DirectionalLight(0xffc98f, 2.6);
    sun.position.set(900, 1400, 2600);
    sun.target.position.set(2000, 0, 2000);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -1500, right: 1500, top: 1500, bottom: -1500, near: 100, far: 5000 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0005;
    this.scene.add(sun, sun.target);

    // Loot beams + active extraction zones for atmosphere.
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
    const colors = [0xf5b301, 0xa855f7, 0xef4444, 0x3b82f6];
    map.crates
      .filter((c) => c.type === 'LEGENDARY' || c.type === 'RARE')
      .slice(0, 14)
      .forEach((c, i) => {
        const beam = new THREE.Mesh(beamGeo, glow(colors[i % colors.length]!, 0.35, Textures.beam(), 1.6).clone());
        beam.scale.set(9, 220, 9);
        beam.position.set(c.x, 110, c.y);
        this.scene.add(beam);
        this.beams.push(beam);
      });
    for (const p of map.extractionPoints.slice(0, 3)) {
      const beam = new THREE.Mesh(beamGeo, glow(COLORS.extraction, 0.25, Textures.beam(), 1.3).clone());
      beam.scale.set(p.radius, 420, p.radius);
      beam.position.set(p.x, 210, p.y);
      this.scene.add(beam);
      this.beams.push(beam);
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(this.frame);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private readonly frame = (): void => {
    const t = (performance.now() - this.start) / 1000;
    const a = t * 0.035;
    const r = 1250;
    this.camera.position.set(2000 + Math.cos(a) * r, 900 + Math.sin(t * 0.1) * 60, 2000 + Math.sin(a) * r);
    this.camera.lookAt(2000 + Math.cos(a + 0.9) * 250, 0, 2000 + Math.sin(a + 0.9) * 250);
    for (let i = 0; i < this.beams.length; i++) {
      (this.beams[i]!.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.12 * Math.sin(t * 2 + i);
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
