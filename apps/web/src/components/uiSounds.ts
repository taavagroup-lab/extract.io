import { sound } from '../game/audio/SoundEngine';

const SELECTOR = '.x-btn:not(:disabled), .x-tab, .nav-tile, .main-nav__link, [data-hover-sound]';
let installed = false;

/**
 * Subtle hover / click feedback for menu controls via one delegated listener
 * (no per-button handlers). Respects the global mute + volume settings.
 */
export function installUiSounds(): void {
  if (installed) return;
  installed = true;
  let lastTarget: Element | null = null;
  let lastAt = 0;
  document.addEventListener(
    'pointerover',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      const target = (e.target as Element | null)?.closest(SELECTOR) ?? null;
      if (!target || target === lastTarget) return;
      lastTarget = target;
      const now = performance.now();
      if (now - lastAt < 60) return;
      lastAt = now;
      sound.uiHover();
    },
    { passive: true },
  );
  document.addEventListener(
    'pointerout',
    (e) => {
      const target = (e.target as Element | null)?.closest(SELECTOR) ?? null;
      if (target && target === lastTarget && !target.contains(e.relatedTarget as Node | null)) lastTarget = null;
    },
    { passive: true },
  );
  document.addEventListener(
    'click',
    (e) => {
      if ((e.target as Element | null)?.closest(SELECTOR)) sound.ui();
    },
    { passive: true },
  );
}
