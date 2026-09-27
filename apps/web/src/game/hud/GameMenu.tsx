import { Button } from '@extract/ui';
import { useState } from 'react';
import { settings, type QualitySetting } from '../../lib/settings';
import { useStore } from '../../lib/store';
import { sound } from '../audio/SoundEngine';

const QUALITIES: { value: QualitySetting; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Adapts to your FPS' },
  { value: 'low', label: 'Low', hint: 'Max FPS, no effects' },
  { value: 'medium', label: 'Medium', hint: 'Anti-aliasing, no bloom' },
  { value: 'high', label: 'High', hint: 'Bloom + sharp shadows' },
  { value: 'ultra', label: 'Ultra', hint: 'Full resolution, 4K shadows' },
];

export function SettingsPanel() {
  const s = useStore(settings);
  return (
    <div className="settings">
      <section>
        <h3>GRAPHICS</h3>
        <div className="quality-grid" role="radiogroup" aria-label="Graphics quality">
          {QUALITIES.map((q) => (
            <button
              key={q.value}
              role="radio"
              aria-checked={s.quality === q.value}
              className={`quality-opt ${s.quality === q.value ? 'is-active' : ''}`}
              onClick={() => {
                sound.ui();
                settings.patch({ quality: q.value });
              }}
            >
              <strong>{q.label}</strong>
              <small>{q.hint}</small>
            </button>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={s.showFps} onChange={(e) => settings.patch({ showFps: e.target.checked })} />
          <span>Show FPS &amp; ping</span>
        </label>
      </section>
      <section>
        <h3>AUDIO</h3>
        <label className="slider">
          <span>Master volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.volume}
            onChange={(e) => settings.patch({ volume: Number(e.target.value) })}
            onPointerUp={() => sound.shot('basic_pistol')}
          />
          <b>{Math.round(s.volume * 100)}%</b>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={s.muted} onChange={(e) => settings.patch({ muted: e.target.checked })} />
          <span>Mute all sounds</span>
        </label>
      </section>
    </div>
  );
}

export function GameMenu({ onResume, onLeave }: { onResume: () => void; onLeave: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="overlay overlay--menu" onMouseDown={(e) => e.target === e.currentTarget && onResume()}>
      <div className="menu-card">
        <header className="overlay__header">
          <h2>PAUSED · MATCH CONTINUES</h2>
          <button className="overlay__close" onClick={onResume} aria-label="Resume">
            ×
          </button>
        </header>
        <div className="menu-card__body">
          <SettingsPanel />
          <section className="controls-help">
            <h3>CONTROLS</h3>
            <ul>
              <li><kbd>WASD</kbd> Move</li>
              <li><kbd>Mouse</kbd> Aim · <kbd>Click</kbd> Shoot</li>
              <li><kbd>Space</kbd> Dash</li>
              <li><kbd>R</kbd> Reload · <kbd>E</kbd> Loot</li>
              <li><kbd>1-3</kbd> Weapons</li>
              <li><kbd>H</kbd> Medkit · <kbd>G</kbd> Armor</li>
              <li><kbd>Tab</kbd> Inventory · <kbd>M</kbd> Map</li>
            </ul>
          </section>
        </div>
        <footer className="menu-card__footer">
          <Button variant="primary" onClick={onResume} autoFocus>
            Resume
          </Button>
          {confirm ? (
            <>
              <span className="menu-warn">Leaving forfeits this run (like dying).</span>
              <Button variant="danger" onClick={onLeave}>
                Leave anyway
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Leave match
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
