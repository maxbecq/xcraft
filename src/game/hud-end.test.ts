import { describe, expect, it } from 'vitest';
import { showEnd } from './hud-toasts';
import type { Hud } from './hud';

/** A Hud reduced to what showEnd reads. */
function hud(winner: number, resigned: boolean[], spectator = false): Hud & { banner: { innerHTML: string; hidden: boolean } } {
  const players = resigned.map((r, id) => ({ id, team: id, faction: 'humains', resigned: r }));
  return {
    world: { winner, players },
    player: 0,
    spectator,
    online: false,
    endButtons: '',
    banner: { innerHTML: '', hidden: true, classList: { toggle: () => {} } },
  } as unknown as Hud & { banner: { innerHTML: string; hidden: boolean } };
}

describe('end banner', () => {
  it('a draw after both sides gave up says so, without throwing', () => {
    for (const spectator of [false, true]) {
      const h = hud(-1, [true, true], spectator);
      showEnd(h);
      expect(h.banner.hidden).toBe(false);
      expect(h.banner.innerHTML).toContain('Match nul');
      expect(h.banner.innerHTML).not.toContain('abandonne');
    }
  });
  it('a win by resignation still names it', () => {
    const h = hud(0, [false, true]);
    showEnd(h);
    expect(h.banner.innerHTML).toContain('Victoire !');
    expect(h.banner.innerHTML).toContain("L'adversaire abandonne.");
  });
});
