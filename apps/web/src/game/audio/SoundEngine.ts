import type { Rarity, WeaponId } from '@extract/game-types';
import { settings } from '../../lib/settings';

/**
 * Procedural game audio (Web Audio API, no asset files). Every sound is
 * synthesized from noise + oscillators, so it is tiny and easy to tune.
 *
 * Weapons are keyed by the `audio` keys of their WeaponDefinition:
 * fire (per weapon), reload (per reload family), empty, equip, pickup,
 * impact. Distance shapes every positional sound the same way (volume
 * falloff, high frequencies lost with distance, stereo pan), so a future
 * sample-based backend only has to replace the voice builders.
 */

/** Layered gunshot recipe. */
interface FireProfile {
  /** Sharp transient (supersonic crack / action slap). */
  crack: { freq: number; q: number; gain: number; decay: number };
  /** Main report: filtered noise body. */
  body: { type: BiquadFilterType; freq: number; q: number; gain: number; decay: number };
  /** Low-frequency punch (sine sweep). */
  thump: { from: number; to: number; gain: number; decay: number };
  /** Room / outdoor tail. */
  tail: { freq: number; gain: number; decay: number };
  /** Mechanical follow-up (bolt, pump, link clatter): clicks after the shot. */
  mech?: { delay: number; freq: number; gain: number; count: number; spacing: number };
  /** Energy weapons: tonal zap. */
  zap?: { type: OscillatorType; from: number; to: number; gain: number; decay: number };
  /** Random pitch variation (fraction). */
  jitter: number;
}

const FIRE: Record<WeaponId, FireProfile> = {
  basic_pistol: {
    crack: { freq: 4200, q: 1.2, gain: 0.3, decay: 0.018 },
    body: { type: 'bandpass', freq: 1700, q: 0.8, gain: 0.5, decay: 0.09 },
    thump: { from: 260, to: 70, gain: 0.45, decay: 0.07 },
    tail: { freq: 900, gain: 0.08, decay: 0.28 },
    jitter: 0.06,
  },
  heavy_pistol: {
    crack: { freq: 3600, q: 1, gain: 0.45, decay: 0.022 },
    body: { type: 'lowpass', freq: 2100, q: 0.9, gain: 0.8, decay: 0.16 },
    thump: { from: 190, to: 42, gain: 0.95, decay: 0.16 },
    tail: { freq: 700, gain: 0.2, decay: 0.55 },
    jitter: 0.04,
  },
  smg: {
    crack: { freq: 5200, q: 1.4, gain: 0.22, decay: 0.012 },
    body: { type: 'highpass', freq: 1200, q: 0.7, gain: 0.38, decay: 0.05 },
    thump: { from: 210, to: 90, gain: 0.32, decay: 0.04 },
    tail: { freq: 1100, gain: 0.05, decay: 0.16 },
    jitter: 0.07,
  },
  suppressed_smg: {
    crack: { freq: 2600, q: 2, gain: 0.12, decay: 0.01 },
    body: { type: 'bandpass', freq: 850, q: 1.4, gain: 0.3, decay: 0.045 },
    thump: { from: 150, to: 80, gain: 0.18, decay: 0.035 },
    tail: { freq: 600, gain: 0.02, decay: 0.08 },
    mech: { delay: 0.012, freq: 3800, gain: 0.08, count: 1, spacing: 0 },
    jitter: 0.08,
  },
  assault_rifle: {
    crack: { freq: 4800, q: 1, gain: 0.34, decay: 0.016 },
    body: { type: 'lowpass', freq: 2800, q: 0.9, gain: 0.58, decay: 0.12 },
    thump: { from: 170, to: 55, gain: 0.6, decay: 0.1 },
    tail: { freq: 850, gain: 0.12, decay: 0.42 },
    jitter: 0.05,
  },
  burst_rifle: {
    crack: { freq: 5600, q: 1.3, gain: 0.34, decay: 0.014 },
    body: { type: 'bandpass', freq: 2400, q: 0.9, gain: 0.5, decay: 0.1 },
    thump: { from: 190, to: 65, gain: 0.5, decay: 0.08 },
    tail: { freq: 1000, gain: 0.1, decay: 0.35 },
    jitter: 0.03,
  },
  battle_rifle: {
    crack: { freq: 4200, q: 1, gain: 0.46, decay: 0.02 },
    body: { type: 'lowpass', freq: 2300, q: 0.9, gain: 0.85, decay: 0.18 },
    thump: { from: 150, to: 40, gain: 0.95, decay: 0.16 },
    tail: { freq: 650, gain: 0.22, decay: 0.7 },
    jitter: 0.04,
  },
  shotgun: {
    crack: { freq: 3000, q: 0.8, gain: 0.4, decay: 0.03 },
    body: { type: 'lowpass', freq: 1500, q: 0.8, gain: 0.95, decay: 0.3 },
    thump: { from: 120, to: 36, gain: 1.1, decay: 0.22 },
    tail: { freq: 500, gain: 0.26, decay: 0.8 },
    mech: { delay: 0.36, freq: 1900, gain: 0.3, count: 2, spacing: 0.13 },
    jitter: 0.04,
  },
  auto_shotgun: {
    crack: { freq: 3200, q: 0.8, gain: 0.32, decay: 0.025 },
    body: { type: 'lowpass', freq: 1700, q: 0.8, gain: 0.72, decay: 0.2 },
    thump: { from: 130, to: 45, gain: 0.8, decay: 0.15 },
    tail: { freq: 560, gain: 0.18, decay: 0.5 },
    jitter: 0.05,
  },
  marksman_rifle: {
    crack: { freq: 6200, q: 0.9, gain: 0.6, decay: 0.025 },
    body: { type: 'lowpass', freq: 2600, q: 0.8, gain: 0.95, decay: 0.24 },
    thump: { from: 130, to: 32, gain: 1.15, decay: 0.24 },
    tail: { freq: 480, gain: 0.34, decay: 1.25 },
    mech: { delay: 0.45, freq: 2300, gain: 0.28, count: 2, spacing: 0.2 },
    jitter: 0.02,
  },
  lmg: {
    crack: { freq: 4400, q: 1, gain: 0.3, decay: 0.016 },
    body: { type: 'lowpass', freq: 2200, q: 0.9, gain: 0.6, decay: 0.12 },
    thump: { from: 140, to: 48, gain: 0.72, decay: 0.12 },
    tail: { freq: 700, gain: 0.12, decay: 0.45 },
    mech: { delay: 0.03, freq: 5200, gain: 0.05, count: 1, spacing: 0 },
    jitter: 0.06,
  },
  void_rifle: {
    crack: { freq: 7000, q: 2, gain: 0.2, decay: 0.012 },
    body: { type: 'bandpass', freq: 1400, q: 2.2, gain: 0.32, decay: 0.08 },
    thump: { from: 240, to: 60, gain: 0.5, decay: 0.09 },
    tail: { freq: 1600, gain: 0.07, decay: 0.3 },
    zap: { type: 'sawtooth', from: 1900, to: 240, gain: 0.12, decay: 0.12 },
    jitter: 0.03,
  },
};

type Surface = 'metal' | 'concrete' | 'wood' | 'soft' | 'flesh' | 'armor';

const PICKUP_NOTES: Record<Rarity, number[]> = {
  COMMON: [660],
  RARE: [660, 880],
  EPIC: [587, 784, 988],
  LEGENDARY: [523, 659, 784, 1047],
  MYTHIC: [523, 659, 784, 1047, 1319],
};

const MAX_VOICES = 32;
/** World units at which positional sounds fade out completely. */
const HEARING_RANGE = 1700;

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = 0;

  /** Must be called from a user gesture (browsers block audio before one). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private ready(): AudioContext | null {
    const s = settings.get();
    if (!this.ctx || !this.master || s.muted || s.volume <= 0) return null;
    this.master.gain.value = s.volume * 0.9;
    return this.ctx.state === 'running' ? this.ctx : null;
  }

  /**
   * Voice output: pan + distance filter. `distance` 0 = at the listener.
   * Returns null when the voice budget is exhausted.
   */
  private out(ctx: AudioContext, pan: number, duration: number, distance = 0): AudioNode | null {
    if (this.voices >= MAX_VOICES) return null;
    this.voices++;
    window.setTimeout(() => this.voices--, duration * 1000 + 60);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(this.master!);
    if (distance <= 60) return panner;
    // Air absorbs highs with distance.
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = Math.max(700, 16000 * Math.exp(-distance / 420));
    air.connect(panner);
    return air;
  }

  /** 0..1 loudness for a sound at `distance` world units. */
  private static falloff(distance: number): number {
    return Math.max(0, 1 - distance / HEARING_RANGE) ** 1.6;
  }

  private noiseBurst(ctx: AudioContext, dest: AudioNode, type: BiquadFilterType, freq: number, q: number, gain: number, decay: number, delay = 0, rate = 1): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = (0.8 + Math.random() * 0.4) * rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.02);
  }

  private tone(ctx: AudioContext, dest: AudioNode, type: OscillatorType, from: number, to: number, gain: number, dur: number, delay = 0): void {
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Short metallic click (actions, mags, latches). */
  private click(ctx: AudioContext, dest: AudioNode, freq: number, gain: number, delay = 0): void {
    this.noiseBurst(ctx, dest, 'bandpass', freq, 6, gain, 0.035, delay, 1.2);
    this.tone(ctx, dest, 'triangle', freq * 0.9, freq * 0.7, gain * 0.35, 0.03, delay);
  }

  // ------------------------------------------------------------------ weapons

  /**
   * Gunshot. distance in world units (0 = own shot), pan -1..1, streak =
   * rounds in the current trigger string (sustained fire gets slightly
   * quieter / thinner so automatic fire does not clip).
   */
  weaponFire(weapon: WeaponId, distance = 0, pan = 0, streak = 0): void {
    const ctx = this.ready();
    if (!ctx) return;
    const p = FIRE[weapon];
    const loud = SoundEngine.falloff(distance);
    if (loud < 0.02) return;
    const dur = Math.max(p.tail.decay, p.mech ? p.mech.delay + p.mech.count * p.mech.spacing + 0.05 : 0);
    const dest = this.out(ctx, pan, dur + 0.1, distance);
    if (!dest) return;
    const sustain = streak > 3 ? 0.82 : 1;
    const g = loud * sustain;
    const pitch = 1 + (Math.random() * 2 - 1) * p.jitter;
    const far = distance > 700;
    if (!far) this.noiseBurst(ctx, dest, 'highpass', p.crack.freq * pitch, p.crack.q, p.crack.gain * g, p.crack.decay);
    this.noiseBurst(ctx, dest, p.body.type, p.body.freq * pitch, p.body.q, p.body.gain * g, p.body.decay * (far ? 1.5 : 1));
    this.tone(ctx, dest, 'sine', p.thump.from * pitch, p.thump.to, p.thump.gain * g, p.thump.decay);
    this.noiseBurst(ctx, dest, 'lowpass', p.tail.freq, 0.7, p.tail.gain * g * (far ? 1.4 : 1), p.tail.decay, 0.012);
    if (p.zap) this.tone(ctx, dest, p.zap.type, p.zap.from * pitch, p.zap.to, p.zap.gain * g, p.zap.decay);
    if (p.mech && distance < 500) {
      for (let i = 0; i < p.mech.count; i++) this.click(ctx, dest, p.mech.freq * pitch, p.mech.gain * g, p.mech.delay + i * p.mech.spacing);
    }
  }

  /** Trigger pulled on an empty magazine. */
  weaponEmpty(): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.08);
    if (ctx && dest) {
      this.click(ctx, dest, 3400, 0.22);
      this.click(ctx, dest, 2600, 0.12, 0.05);
    }
  }

  /**
   * Reload phases (driven by reload progress so interrupted reloads stay
   * silent): start = mag out / open, mid = mag in, end = charge / close.
   */
  weaponReload(key: string, phase: 'start' | 'mid' | 'end'): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.5);
    if (!ctx || !dest) return;
    switch (key) {
      case 'pistol':
        if (phase === 'start') this.click(ctx, dest, 2400, 0.25);
        else if (phase === 'mid') {
          this.click(ctx, dest, 1700, 0.3);
          this.noiseBurst(ctx, dest, 'bandpass', 900, 2, 0.12, 0.06);
        } else this.click(ctx, dest, 3200, 0.3);
        break;
      case 'belt':
        if (phase === 'start') {
          this.click(ctx, dest, 1500, 0.3);
          this.noiseBurst(ctx, dest, 'bandpass', 3000, 1.5, 0.12, 0.3, 0.08);
        } else if (phase === 'mid') {
          for (let i = 0; i < 5; i++) this.click(ctx, dest, 4200 + i * 120, 0.08, i * 0.045);
          this.click(ctx, dest, 1300, 0.32, 0.26);
        } else {
          this.click(ctx, dest, 1900, 0.3);
          this.click(ctx, dest, 2600, 0.3, 0.12);
        }
        break;
      case 'shell':
        if (phase === 'start') this.noiseBurst(ctx, dest, 'bandpass', 700, 1.5, 0.12, 0.12);
        else if (phase === 'end') {
          // Pump: back + forward.
          this.noiseBurst(ctx, dest, 'bandpass', 1500, 2, 0.32, 0.07);
          this.click(ctx, dest, 1900, 0.3, 0.11);
        }
        break;
      case 'energy':
        if (phase === 'start') this.tone(ctx, dest, 'sawtooth', 900, 120, 0.06, 0.28);
        else if (phase === 'mid') this.click(ctx, dest, 2800, 0.2);
        else {
          this.tone(ctx, dest, 'sine', 240, 1800, 0.1, 0.3);
          this.tone(ctx, dest, 'triangle', 480, 2400, 0.05, 0.34, 0.04);
        }
        break;
      default:
        // rifle
        if (phase === 'start') {
          this.click(ctx, dest, 2100, 0.26);
          this.noiseBurst(ctx, dest, 'bandpass', 800, 2, 0.1, 0.08, 0.04);
        } else if (phase === 'mid') {
          this.click(ctx, dest, 1500, 0.34);
          this.noiseBurst(ctx, dest, 'bandpass', 2400, 3, 0.12, 0.05, 0.03);
        } else {
          this.click(ctx, dest, 2800, 0.26);
          this.click(ctx, dest, 2000, 0.3, 0.1);
        }
    }
  }

  /** One shotgun shell pushed into the tube. */
  weaponShellIn(): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.1);
    if (!ctx || !dest) return;
    this.click(ctx, dest, 1400, 0.26);
    this.noiseBurst(ctx, dest, 'bandpass', 3000, 3, 0.08, 0.04, 0.02);
  }

  weaponEquip(key: string): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.35);
    if (!ctx || !dest) return;
    if (key === 'energy') {
      this.tone(ctx, dest, 'sine', 300, 1400, 0.08, 0.25);
      this.click(ctx, dest, 3000, 0.12, 0.2);
      return;
    }
    this.noiseBurst(ctx, dest, 'bandpass', 1100, 0.9, key === 'holster' ? 0.1 : 0.16, 0.14);
    this.click(ctx, dest, key === 'holster' ? 3000 : 2200, 0.2, 0.12);
  }

  weaponPickup(): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.3);
    if (!ctx || !dest) return;
    this.noiseBurst(ctx, dest, 'bandpass', 1400, 1, 0.16, 0.1);
    this.click(ctx, dest, 2000, 0.24, 0.07);
    this.click(ctx, dest, 2900, 0.2, 0.16);
  }

  /** Bullet impact near the listener (throttled by the caller). */
  impact(surface: Surface, distance: number, pan: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const loud = SoundEngine.falloff(distance * 2.2);
    if (loud < 0.05) return;
    const dest = this.out(ctx, pan, 0.2, distance);
    if (!dest) return;
    switch (surface) {
      case 'metal':
        this.tone(ctx, dest, 'triangle', 2600 + Math.random() * 1400, 1800, 0.07 * loud, 0.12);
        this.noiseBurst(ctx, dest, 'highpass', 5000, 1, 0.08 * loud, 0.03);
        break;
      case 'wood':
        this.noiseBurst(ctx, dest, 'bandpass', 600, 1.5, 0.16 * loud, 0.06);
        break;
      case 'armor':
        this.tone(ctx, dest, 'square', 1900, 1300, 0.05, 0.05);
        this.noiseBurst(ctx, dest, 'highpass', 4200, 1, 0.1, 0.04);
        break;
      case 'flesh':
        this.noiseBurst(ctx, dest, 'lowpass', 500, 1, 0.16, 0.05);
        break;
      case 'soft':
        this.noiseBurst(ctx, dest, 'lowpass', 900, 0.8, 0.1 * loud, 0.06);
        break;
      default:
        this.noiseBurst(ctx, dest, 'bandpass', 2200, 1.2, 0.12 * loud, 0.04);
    }
  }

  /** An enemy round passing close by. */
  whiz(pan: number): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, pan, 0.2);
    if (!ctx || !dest) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 4;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(4200, t);
    f.frequency.exponentialRampToValueAtTime(1200, t + 0.14);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.17);
  }

  // ------------------------------------------------------------------ feedback

  hitmarker(armor = false): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.08);
    if (!ctx || !dest) return;
    if (armor) {
      this.tone(ctx, dest, 'square', 1500, 1200, 0.08, 0.05);
      this.noiseBurst(ctx, dest, 'highpass', 5200, 1, 0.12, 0.035);
      return;
    }
    this.tone(ctx, dest, 'triangle', 2100, 1700, 0.22, 0.05);
    this.noiseBurst(ctx, dest, 'highpass', 4000, 1, 0.12, 0.03);
  }

  kill(): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.35);
    if (!ctx || !dest) return;
    this.tone(ctx, dest, 'square', 880, 880, 0.12, 0.09);
    this.tone(ctx, dest, 'square', 1320, 1320, 0.12, 0.16, 0.08);
    this.noiseBurst(ctx, dest, 'highpass', 3000, 1, 0.1, 0.12);
  }

  hurt(armor = false): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.2);
    if (!ctx || !dest) return;
    if (armor) {
      this.tone(ctx, dest, 'triangle', 700, 300, 0.25, 0.1);
      this.noiseBurst(ctx, dest, 'bandpass', 2600, 1, 0.2, 0.06);
      return;
    }
    this.tone(ctx, dest, 'sine', 140, 50, 0.6, 0.16);
    this.noiseBurst(ctx, dest, 'lowpass', 500, 1, 0.35, 0.12);
  }

  /** Loot pickup: more notes, sparkle and a sub "weight" as rarity rises. */
  pickup(rarity: Rarity): void {
    const ctx = this.ready();
    const notes = PICKUP_NOTES[rarity];
    const dest = ctx && this.out(ctx, 0, notes.length * 0.07 + 0.6);
    if (!ctx || !dest) return;
    const top = rarity === 'LEGENDARY' || rarity === 'MYTHIC';
    notes.forEach((n, i) => {
      this.tone(ctx, dest, 'triangle', n, n, top ? 0.18 : 0.16, top ? 0.3 : 0.22, i * 0.07);
      if (top) this.tone(ctx, dest, 'sine', n * 2, n * 2, 0.06, 0.4, i * 0.07 + 0.02);
    });
    if (rarity !== 'COMMON') this.noiseBurst(ctx, dest, 'highpass', 6000, 0.7, 0.05 + 0.03 * notes.length, 0.25, notes.length * 0.07);
    if (top) this.tone(ctx, dest, 'sine', 110, 55, 0.3, 0.5);
  }

  /** Crate lid thrown open. */
  crateOpen(big: boolean): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.4);
    if (!ctx || !dest) return;
    this.noiseBurst(ctx, dest, 'lowpass', 500, 1, 0.22, 0.18);
    this.click(ctx, dest, 1300, 0.22, 0.02);
    if (big) this.tone(ctx, dest, 'sine', 220, 440, 0.08, 0.35, 0.05);
  }

  dash(): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.25);
    if (!ctx || !dest) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.18);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(f).connect(g).connect(dest);
    src.start(t);
    src.stop(t + 0.22);
  }

  tick(high = false): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.1);
    if (ctx && dest) this.tone(ctx, dest, 'sine', high ? 1320 : 990, high ? 1320 : 990, 0.14, 0.07);
  }

  extracted(): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 1.2);
    if (!ctx || !dest) return;
    [523, 659, 784, 1047, 1319].forEach((n, i) => this.tone(ctx, dest, 'triangle', n, n, 0.18, 0.35, i * 0.09));
  }

  announce(kind: 'info' | 'warning' | 'danger' | 'success'): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.8);
    if (!ctx || !dest) return;
    if (kind === 'danger') {
      this.tone(ctx, dest, 'sawtooth', 440, 330, 0.1, 0.3);
      this.tone(ctx, dest, 'sawtooth', 440, 330, 0.1, 0.3, 0.35);
    } else if (kind === 'warning') {
      this.tone(ctx, dest, 'triangle', 659, 659, 0.14, 0.2);
      this.tone(ctx, dest, 'triangle', 523, 523, 0.14, 0.3, 0.18);
    } else {
      this.tone(ctx, dest, 'triangle', 523, 523, 0.13, 0.25);
      this.tone(ctx, dest, 'triangle', 784, 784, 0.13, 0.35, 0.14);
    }
  }

  heartbeat(): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.5);
    if (!ctx || !dest) return;
    this.tone(ctx, dest, 'sine', 70, 45, 0.5, 0.14);
    this.tone(ctx, dest, 'sine', 65, 42, 0.38, 0.14, 0.2);
  }

  ui(): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.06);
    if (ctx && dest) this.tone(ctx, dest, 'sine', 1400, 1100, 0.08, 0.04);
  }

  /** Very quiet tick for menu hovers (throttled by the caller). */
  uiHover(): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.05);
    if (ctx && dest) this.tone(ctx, dest, 'sine', 2200, 1900, 0.025, 0.03);
  }

  /** KINGPIN detected: low two-tone siren. */
  kingpin(): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 1.1);
    if (!ctx || !dest) return;
    for (let i = 0; i < 2; i++) {
      this.tone(ctx, dest, 'sawtooth', 220, 330, 0.07, 0.28, i * 0.34);
      this.tone(ctx, dest, 'sine', 110, 110, 0.18, 0.3, i * 0.34);
    }
  }

  /** Extraction interrupted: falling buzz. */
  extractCancel(): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.5);
    if (!ctx || !dest) return;
    this.tone(ctx, dest, 'square', 330, 110, 0.07, 0.35);
    this.noiseBurst(ctx, dest, 'lowpass', 900, 1, 0.2, 0.2);
  }
}

export type { Surface as ImpactSurface };
export const sound = new SoundEngine();

// Browsers only allow audio after a user gesture: unlock on the first one.
const unlockOnce = () => sound.unlock();
window.addEventListener('pointerdown', unlockOnce, { capture: true });
window.addEventListener('keydown', unlockOnce, { capture: true });
