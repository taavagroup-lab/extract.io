import { WEAPONS } from '@extract/game-config';
import { INPUT_BUTTONS, WEAPON_IDS, type WeaponId } from '@extract/game-types';
import { describe, expect, it } from 'vitest';
import { openLane, place, startedRoomWithTwo } from './helpers';

const DT_MS = 1000 / 30;

/**
 * Time-to-kill scenarios through the real server path (inputs -> weapon
 * controller -> projectiles -> damage). Shooter stands still at `gap` units
 * from an unarmoured target and fires like a player would (holds AUTO,
 * taps SEMI / BURST). Returns ms until the kill, or null.
 */
async function measure(id: WeaponId, gap: number, armor = 0): Promise<{ ms: number | null; rounds: number }> {
  const { room, p1, p2 } = await startedRoomWithTwo();
  const lane = openLane(room, gap);
  place(room, p1, lane.ax, lane.ay);
  place(room, p2, lane.bx, lane.by);
  p2.armor = armor;
  let seq = 1;
  const input = (fire: boolean) => {
    room.handleInputs(p1, [{ s: ++seq, mx: 0, my: 0, a: 0, b: fire ? INPUT_BUTTONS.FIRE : 0 }]);
    room.tick();
    room.handleInputs(p2, [{ s: seq, mx: 0, my: 0, a: Math.PI, b: 0 }]);
  };
  input(false);
  room.handleDev(p1, { cmd: 'giveWeapon', weaponId: id });
  const def = WEAPONS[id];
  for (let i = 0; i < Math.ceil(def.equipMs / DT_MS) + 2; i++) input(false);
  const mag0 = p1.inventory.activeWeapon()!.mag;
  const reserve0 = p1.inventory.ammo[def.ammoType];
  for (let i = 0; i < 180; i++) {
    const fire = def.fireMode === 'AUTO' ? true : i % 2 === 0;
    input(fire);
    if (p2.status === 'DEAD') {
      const w = p1.inventory.activeWeapon()!;
      return { ms: i * DT_MS, rounds: mag0 - w.mag + (reserve0 - p1.inventory.ammo[def.ammoType]) };
    }
  }
  return { ms: null, rounds: 0 };
}

describe('time to kill (server simulation)', () => {
  it('every weapon kills an unarmoured target at close range in a reactable time', async () => {
    for (const id of WEAPON_IDS) {
      const { ms } = await measure(id, 110);
      expect(ms, id).not.toBeNull();
      if (WEAPONS[id].category === 'SHOTGUN' && WEAPONS[id].fireMode === 'SEMI') continue; // point-blank pump
      expect(ms!, id).toBeGreaterThanOrEqual(300);
      expect(ms!, id).toBeLessThanOrEqual(2600);
    }
  });

  it('the pump shotgun is brutal up close but weak at range', async () => {
    const close = await measure('shotgun', 80);
    expect(close.ms).not.toBeNull();
    expect(close.ms!).toBeLessThanOrEqual(1000); // one or two pumps
    const far = await measure('shotgun', 420);
    // At the edge of its range it barely tickles (or never finishes in 6 s).
    if (far.ms !== null) expect(far.ms).toBeGreaterThan(2500);
  });

  it('armour slows every kill down', async () => {
    for (const id of ['smg', 'assault_rifle', 'battle_rifle'] as const) {
      const bare = await measure(id, 150);
      const armored = await measure(id, 150, 100);
      expect(armored.ms!, id).toBeGreaterThan(bare.ms!);
    }
  });

  it('the marksman rifle needs two hits, even at long range', async () => {
    const far = await measure('marksman_rifle', 700);
    expect(far.ms).not.toBeNull();
    expect(far.rounds).toBeGreaterThanOrEqual(2);
  });
});
