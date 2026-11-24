import type { Hud } from './hud';

/** The side whose resources the bar shows. Ours in a game; a spectator's, the side of what is picked (the first
 * picked that has one), else the one shown last (side 0 at first). Never another side's when playing. */
export function followed(h: Pick<Hud, 'world' | 'player' | 'spectator' | 'input' | 'shown'>): number {
  if (!h.spectator) return h.player;
  for (const id of h.input.selected) {
    const owner = h.world.entities.get(id)?.owner ?? -1;
    if (owner >= 0 && h.world.players[owner]) return owner;
  }
  return h.shown;
}
