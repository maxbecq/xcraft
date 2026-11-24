import { Vector3 } from 'three';
import { type BuildingDef, DEFS } from '../data';
import { heightAt } from '../map';
import { FP } from '../sim/fixed';
import type { Entity, World } from '../sim/world';
import type { Effects } from './effects';
import type { EntityRenderer } from './units';
import { FLY_HEIGHT } from '../data';
import { currentBiome } from '../terrain';

/** Where buildings give off smoke or steam: [x, y, z offset from the centre, dark smoke?]. */
const VENTS: Record<string, [number, number, number, boolean]> = {
  conseil: [-1.4, 0.8, 2.0, true], // the burning tyre stack
  mine: [-0.9, 0.9, -0.7, false], // generator steam
  puits: [0, 0.2, 0, false], // energy mist rising from the well
};

/** This frame's sparks, smoke and fires given off by what stands on the map: serfs and drones at work, decks
 * welding, free wells, vents, burning buildings. */
export function ambientEffects(world: World, units: EntityRenderer, effects: Effects, sees: (e: Entity) => boolean, dt: number, taken: (well: Entity) => boolean): void {
  const map = world.map;
  for (const e of world.entities.values()) {
    // A Caserne volante taking off or landing: its rotors blow the ground's dust out from under it, hardest near the
    // ground (at the touch when it lands); lighter as it lifts off.
    if ((e.type === 'casernevol' || e.type === 'casernevolante') && sees(e)) {
      const f = units.liftoff(e.id);
      if (f) {
        const near = Math.max(0, 1 - f.height / FLY_HEIGHT);
        const k = f.kind === 'up' ? (f.age < 1 ? 0.6 * f.age : 0.7 * near) : f.age < 1.8 ? near * near : Math.max(0, 1 - (f.age - 1.8) / 1.6);
        if (k > 0.02) {
          const b = currentBiome();
          const c = b.levels[1].clone().lerp(b.sand, 0.5).multiplyScalar(1.1);
          const x = e.x / FP;
          const z = e.y / FP;
          effects.downwash(new Vector3(x, heightAt(map, x, z), z), 2.2, k, c.getHex(), dt);
        }
      }
    }
    // A Z Déchiqueteur cutting: sparks from its saw all the while it works on its foe.
    if (e.kit === 'dechiqueteur' && e.cooldown > 0 && e.order?.kind !== undefined && 'target' in e.order && e.order.target && sees(e)) {
      const foe = world.entities.get(e.order.target);
      const near = foe && Math.hypot(foe.x - e.x, foe.y - e.y) <= e.radius + foe.radius + 1.5 * FP;
      const bite = near ? units.sawBite(e.id, new Vector3(foe.x / FP, heightAt(map, foe.x / FP, foe.y / FP) + 0.3, foe.y / FP)) : undefined;
      if (bite) effects.grind(bite.at, bite.dir, heightAt(map, bite.at.x, bite.at.z), dt);
    }
    // Serfs at work: the jackhammer bites the field or the building site; a Z drone drilling a crystal too.
    const o = e.order;
    if ((e.type === 'serf' || e.type === 'drone') && e.x === e.px && e.y === e.py && sees(e) && ((o?.kind === 'gather' && o.phase === 'mine') || o?.kind === 'construct')) {
      // A Serf in its drill pose sprays grinding sparks from its tool's point; otherwise (a Z drone, a model without
      // the pose) blue sparks at the foot of the target.
      const bit = e.type === 'serf' ? units.bit(e.id) : undefined;
      const t = world.entities.get(o.target);
      if (bit) effects.drill(bit, dt);
      else if (t) {
        const x = e.x / FP;
        const z = e.y / FP;
        const d = Math.hypot(t.x / FP - x, t.y / FP - z) || 1;
        const tx = x + ((t.x / FP - x) / d) * 0.32;
        const tz = z + ((t.y / FP - z) / d) * 0.32;
        effects.sparks(new Vector3(tx, heightAt(map, tx, tz) + 0.05, tz), dt);
      }
    }
    if (e.type === 'plateforme' && e.buildLeft === 0 && e.trainLeft > 0 && DEFS[e.queue[0]]?.kind === 'unit' && sees(e)) {
      // Welding on the deck while it assembles a unit: blue sparks from the tip of the arm's torch as it sweeps over
      // the socle, or, a model with no arm to follow, at a point that wanders over it.
      const a = performance.now() / 260 + e.id;
      const wx = e.x / FP + Math.cos(a * 1.7) * 0.35;
      const wz = e.y / FP + 0.1 + Math.sin(a * 1.3) * 0.3;
      const weld = units.weld(e.id) ?? new Vector3(wx, heightAt(map, e.x / FP, e.y / FP) + 0.55 + Math.abs(Math.sin(a)) * 0.35, wz);
      effects.sparks(weld, dt);
      effects.sparks(weld, dt); // twice a jackhammer's rate: a weld crackles
    }
    if (e.type === 'puits') {
      if (!taken(e)) effects.ambient(new Vector3(e.x / FP, heightAt(map, e.x / FP, e.y / FP) + 0.2, e.y / FP), dt, false);
      continue;
    }
    if (e.def.kind !== 'building' || e.buildLeft > 0 || !sees(e)) continue;
    const vent = VENTS[e.type];
    if (vent) {
      const vx = e.x / FP + vent[0];
      const vz = e.y / FP + vent[2];
      effects.ambient(new Vector3(vx, heightAt(map, e.x / FP, e.y / FP) + vent[1], vz), dt, vent[3]);
    }
    if (e.hp > e.maxHp / 2) continue;
    const size = e.def.size;
    const x = e.x / FP;
    const z = e.y / FP;
    effects.burn(new Vector3(x, heightAt(map, x, z) + size * 0.4, z), e.hp / e.maxHp, size, dt, e.id, (e.def as BuildingDef).faction === 'isdaris');
  }
}
