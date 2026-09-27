import { Store } from './store';

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high' | 'ultra';

export interface GameSettings {
  quality: QualitySetting;
  showFps: boolean;
  volume: number;
  muted: boolean;
}

const KEY = 'extractio.settings';
const DEFAULTS: GameSettings = { quality: 'auto', showFps: false, volume: 0.7, muted: false };

function load(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch {
    // storage unavailable
  }
  return DEFAULTS;
}

class SettingsStore extends Store<GameSettings> {
  constructor() {
    super(load());
  }

  patch(p: Partial<GameSettings>): void {
    const next = { ...this.get(), ...p };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    this.set(next);
  }
}

/** Per-device player preferences (graphics, audio, overlays). */
export const settings = new SettingsStore();
