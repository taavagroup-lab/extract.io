import type { Rarity, WeaponId } from '@extract/game-types';
import { settings } from '../../lib/settings';

/**
 * Procedural game audio (Web Audio API, no asset files). Every sound is
 * synthesized from noise + oscillators, so it is tiny and easy to tune.
 */

interface ShotProfile {
  filter: BiquadFilterType;
  freq: number;
  q: number;
  decay: number;
  thump: number;
  thumpDecay: number;
  gain: number;
}

const SHOTS: Record<WeaponId, ShotProfile> = {
  basic_pistol: { filter: 'bandpass', freq: 1900, q: 0.8, decay: 0.09, thump: 170, thumpDecay: 0.06, gain: 0.55 },
  smg: { filter: 'highpass', freq: 1300, q: 0.7, decay: 0.055, thump: 150, thumpDecay: 0.04, gain: 0.42 },
  assault_rifle: { filter: 'lowpass', freq: 2900, q: 0.9, decay: 0.14, thump: 110, thumpDecay: 0.1, gain: 0.62 },
  shotgun: { filter: 'lowpass', freq: 1500, q: 0.8, decay: 0.3, thump: 72, thumpDecay: 0.19, gain: 0.8 },
};

const PICKUP_NOTES: Record<Rarity, number[]> = {
  COMMON: [660],
  RARE: [660, 880],
  EPIC: [587, 784, 988],
  LEGENDARY: [523, 659, 784, 1047],
  MYTHIC: [523, 659, 784, 1047, 1319],
};

const MAX_VOICES = 24;

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

  private out(ctx: AudioContext, pan: number, duration: number): AudioNode | null {
    if (this.voices >= MAX_VOICES) return null;
    this.voices++;
    window.setTimeout(() => this.voices--, duration * 1000 + 50);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(this.master!);
    return panner;
  }

  private noiseBurst(ctx: AudioContext, dest: AudioNode, type: BiquadFilterType, freq: number, q: number, gain: number, decay: number, delay = 0): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
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

  /** Gunshot; distance in world units (0 = own shot), pan -1..1. */
  shot(weapon: WeaponId, distance = 0, pan = 0): void {
    const ctx = this.ready();
    if (!ctx) return;
    const p = SHOTS[weapon];
    const falloff = Math.max(0, 1 - distance / 1600) ** 1.6;
    if (falloff < 0.02) return;
    const dest = this.out(ctx, pan, p.decay + 0.1);
    if (!dest) return;
    const far = distance > 500;
    this.noiseBurst(ctx, dest, far ? 'lowpass' : p.filter, far ? Math.min(p.freq, 1200) : p.freq, p.q, p.gain * falloff, p.decay * (far ? 1.4 : 1));
    this.tone(ctx, dest, 'sine', p.thump * 1.8, p.thump * 0.5, p.gain * 0.9 * falloff, p.thumpDecay);
  }

  dryFire(): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.05);
    if (ctx && dest) this.noiseBurst(ctx, dest, 'bandpass', 3200, 3, 0.25, 0.03);
  }

  hitmarker(): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.08);
    if (!ctx || !dest) return;
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

  hurt(): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.2);
    if (!ctx || !dest) return;
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

  reload(): void {
    const ctx = this.ready();
    const dest = ctx && this.out(ctx, 0, 0.45);
    if (!ctx || !dest) return;
    this.noiseBurst(ctx, dest, 'bandpass', 2600, 4, 0.3, 0.04);
    this.noiseBurst(ctx, dest, 'bandpass', 1800, 3, 0.25, 0.06, 0.18);
    this.noiseBurst(ctx, dest, 'bandpass', 3400, 5, 0.3, 0.04, 0.36);
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

export const sound = new SoundEngine();

// Browsers only allow audio after a user gesture: unlock on the first one.
const unlockOnce = () => sound.unlock();
window.addEventListener('pointerdown', unlockOnce, { capture: true });
window.addEventListener('keydown', unlockOnce, { capture: true });
