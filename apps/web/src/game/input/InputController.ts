import type { GameClient, InputSample } from '../net/GameClient';

export interface OverlayHandlers {
  toggleInventory(): void;
  toggleMap(): void;
  toggleDev(): void;
  closeOverlays(): void;
}

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/**
 * Keyboard + mouse state. Movement/fire are sampled every simulation step;
 * discrete actions (reload, interact, weapon swap...) are sent immediately.
 */
export class InputController {
  private readonly keys = new Set<string>();
  mouseDown = false;
  /** While an overlay is open, the character stops moving and shooting. */
  blocked = false;

  constructor(
    private readonly client: GameClient,
    private readonly overlays: OverlayHandlers,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('blur', this.onBlur);
  }

  sample(aim: number): InputSample {
    if (this.blocked) return { mx: 0, my: 0, aim, fire: false };
    const k = this.keys;
    const right = k.has('KeyD') || k.has('ArrowRight') ? 1 : 0;
    const left = k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0;
    const down = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    const up = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    return { mx: right - left, my: down - up, aim, fire: this.mouseDown };
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTyping(e.target)) return;
    if (e.code === 'Tab') {
      e.preventDefault();
      if (!e.repeat) this.overlays.toggleInventory();
      return;
    }
    if (e.code === 'Escape') return this.overlays.closeOverlays();
    if (e.code === 'Backquote' || e.code === 'F2') {
      e.preventDefault();
      if (!e.repeat) this.overlays.toggleDev();
      return;
    }
    if (e.code === 'KeyM') {
      if (!e.repeat) this.overlays.toggleMap();
      return;
    }
    if (MOVE_KEYS.has(e.code)) {
      if (e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
      return;
    }
    if (e.repeat || this.blocked) return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        this.client.queueDash();
        break;
      case 'KeyR':
        this.client.action({ k: 'reload' });
        break;
      case 'KeyE':
      case 'KeyF':
        this.client.action({ k: 'interact' });
        break;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
        this.client.action({ k: 'switch', slot: Number(e.code.slice(5)) - 1 });
        break;
      case 'KeyH':
        this.client.action({ k: 'useItem', itemId: 'medkit' });
        break;
      case 'KeyG':
        this.client.action({ k: 'useItem', itemId: 'armor_plate' });
        break;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseDown = false;
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.mouseDown = false;
  };
}
