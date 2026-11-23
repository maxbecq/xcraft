import { TEAM_COLORS } from './models';
import { BoxGeometry, type Camera, CircleGeometry, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Object3D, type Scene, Vector3 } from 'three';
import { Particles, type Picture } from './particles';
import { Streaks } from './streaks';
import type { Audio, Sfx } from '../audio';
import { DEFS, FLY_HEIGHT, KIT } from '../data';
import BALANCE from '../balance.json';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import { type Entity, type Shot, type World, soars } from '../sim/world';

const MAX_PARTICLES = 1200;
const MAX_STREAKS = 1500;
/** Peau de roc's stone scales, 16 a unit. */
const MAX_ROCKS = 480;
/** Preview only: ?fx=avant shows the old shots and no marks, ?fx=a|b the other mark styles, ?fx=aucun no badges (c,
 * badges, is the one kept for the spells with no look of their own yet). */
const PARAMS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const FX_STYLE = PARAMS.get('fx') || 'c';
/** Proposal stage (Z lasting spells, 2026-11-23): ?sorts=1|2 shows the two ideas of each. */
const SPELL_IDEA = PARAMS.get('sorts') ?? '';
/** Who holds a unit where it stands, by its id, as the effects saw it cast (render only): a Napalm burns, an Impulsion
 * magnétique crackles. The sim keeps one `held` count for every hold, so the render remembers which spell set it. */
export const HELD_BY = new Map<number, 'napalm' | 'impulsion'>();
/** A shot's colour by the shooter's camp: Humans' powder orange, Isdaris' cyan light, Z's green, the Gods' gold. */
/**
 * What a Human weapon throws (the balancer, 2026-11-23: each its own look, the camp's orange running through them all).
 * balle: rifles and guns; dard: the Soigneur's injector; grenade, fiole, bombe: lobbed (Phalangiste, Alchimiste,
 * Réservoir); obus: the Pégase's cannon; roquette: the Tour's anti-air rockets; carreau: the Plésiosaure's ballista;
 * rocher: the Ankylosaure's Trébuchet; flamme: the Belluaire's flamethrower, at arm's length.
 */
type Ammo = 'balle' | 'dard' | 'grenade' | 'fiole' | 'bombe' | 'obus' | 'roquette' | 'carreau' | 'rocher' | 'flamme' | 'obusz';
const AMMO: Record<string, Ammo> = {
  auxiliaire: 'balle', scarabee: 'balle', bourdon: 'balle', soigneur: 'dard', phalangiste: 'grenade', alchimiste: 'fiole', cuve: 'bombe',
  pegase: 'obus', tour: 'roquette', plesiosaure: 'carreau', ankylosaure: 'rocher', belluaire: 'flamme',
};
/** Lobbed shots: seconds in the air per tile, height of the arc per tile, head size, smoke behind. */
const Z_GREEN_LOB = 0x8cff5a;
const LOBS: Partial<Record<Ammo, { pace: number; arc: number; size: number; smoke: number; color: number }>> = {
  grenade: { pace: 0.09, arc: 0.28, size: 0.3, smoke: 6, color: 0xffa040 },
  fiole: { pace: 0.1, arc: 0.32, size: 0.3, smoke: 0, color: 0x9aff6a },
  bombe: { pace: 0.11, arc: 0.4, size: 0.42, smoke: 10, color: 0xffa040 },
  obus: { pace: 0.035, arc: 0.06, size: 0.36, smoke: 14, color: 0xffc060 },
  rocher: { pace: 0.12, arc: 0.45, size: 0.5, smoke: 24, color: 0x8a7a62 },
  roquette: { pace: 0.06, arc: 0.04, size: 0.3, smoke: 30, color: 0xffa040 },
  obusz: { pace: 0.09, arc: 0.3, size: 0.4, smoke: 16, color: Z_GREEN_LOB },
};
/** Proposal stage (Z, 2026-11-23): ?z=1 shows each Z kit's own shot, until the user picks; the camp tracers otherwise. */
const Z_STYLE = PARAMS.get('z') === '1';
/** The Z's green, and its hot core. */
const Z_GREEN = 0x8cff5a;
const SHOT_COLORS: Record<string, number> = { humains: 0xffa040, isdaris: 0x5ae0ff, z: 0x8cff5a, dieux: 0xffe28a };
/** The Lance-flammes' cooldown (seconds, a shot keeps its jet going that long), and the flame sprites it throws a second. */
const FLAME_COOLDOWN = BALANCE.weapons.flammes.cooldown;
const FLAME_RATE = 220;
const BUILDING_SIZES: Record<string, number> = { conseil: 5, caserne: 3, grenier: 2, mine: 3 };

/** Soft round sprite textures, drawn once. */
function blob(inner: string, outer: string, size = 64, noisy = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  if (noisy) {
    // Break the smoke's perfect circle with darker lumps.
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`;
      ctx.beginPath();
      ctx.arc(Math.random() * size, Math.random() * size, Math.random() * size * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c;
}

/** Fire colours: Human scrap burns orange with black smoke, Isdaris plasma blue with pale smoke. */
const FIRE = {
  human: { body: [0xff6a10, 0xff8c1a], core: 0xffd27a, tips: 0xc8261a, embers: [0xffb347, 0xff7a2a], smoke: [0x2a2522, 0x3d3631], glow: 0xff6a1f },
  isdaris: { body: [0x2a7cff, 0x4fa8ff], core: 0xd8f4ff, tips: 0x6a40ff, embers: [0x9fdcff, 0x5ab8ff], smoke: [0x4a5260, 0x5d6573], glow: 0x3f8cff },
};

/** A tongue of flame: bright at the bottom, tapering upwards, soft edged. */
function flame(size = 64): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.translate(size / 2, size * 0.68);
  ctx.scale(0.55, 1); // narrower than tall
  const g = ctx.createRadialGradient(0, 0, 0, 0, -size * 0.12, size * 0.6);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.12, size * 0.5, size * 0.56, 0, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

interface Decal {
  mesh: Mesh;
  age: number;
  life: number;
}

interface Debris {
  mesh: Mesh;
  vel: Vector3;
  spin: Vector3;
  age: number;
}

/**
 * Particle effects: muzzle flashes, tracers, sparks, heal glints, dust, explosions, smoke and fire.
 * Only what the player can see is spawned.
 */
export class Effects {
  /** Every particle, one draw call (render/particles.ts). */
  private readonly streaks = new Streaks(MAX_STREAKS);
  /** Lobbed shots on their way (grenades, flasks, bombs, shells, rockets, stones). */
  private lobs: { ammo: Ammo; from: Vector3; to: Vector3; age: number; flight: number; arc: number; chem: boolean; spill: number; prev?: Vector3; color?: number }[] = [];
  /** Rounds on their way: where they land, in what colour, in how long. */
  private hits: { at: Vector3; color: number; left: number }[] = [];
  private readonly particles = new Particles([blob('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), blob('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)', 64, true), flame()], MAX_PARTICLES);
  /** Particles flying now (for the telemetry). */
  get live(): number {
    return this.particles.live;
  }
  /** The camera they face and are sorted for; set by the game. */
  eye: Camera | null = null;
  private debris: Debris[] = [];
  private decals: Decal[] = [];
  private readonly decalGeo = new CircleGeometry(0.5, 20);
  /** The particles' pictures, by their place in the particles' texture. */
  private readonly tex = { glow: 0, smoke: 1, flame: 2 } as const;
  private readonly debrisGeo = new BoxGeometry(0.12, 0.12, 0.12);
  /** Stone scales on the units under a Peau de roc: one instanced mesh, laid out every frame. */
  private readonly rocks = new InstancedMesh(new IcosahedronGeometry(1, 0), new MeshStandardMaterial({ color: 0x5e5a56, roughness: 1, flatShading: true }), MAX_ROCKS);
  private readonly rockM = new Matrix4();
  private readonly rockScale = new Vector3(0.12, 0.072, 0.12);
  private readonly debrisMat = new MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.9 });

  /** Share of particles spawned (src/quality.ts): fewer to fill on low-end graphics. */
  density = 1;

  /** Where a Z weapon's muzzle is (world), by the shooter's id (render/units.ts); none if it shows none. */
  muzzle: (id: number) => Vector3 | undefined = () => undefined;
  /** Lance-flammes firing, by shooter: from its nozzle to its target until `left` runs out (a shot every cooldown
   * keeps it going), `spill` the particles owed between frames. */
  private readonly jets = new Map<number, { id: number; from: Vector3; to: Vector3; left: number; spill: number }>();

  /** Sprites go to `fx` (drawn after ambient occlusion); debris, which casts shadows, to the main scene. */
  constructor(fx: Scene, private readonly scene: Scene, private readonly map: GameMap, private readonly audio: Audio) {
    fx.add(this.particles.mesh);
    fx.add(this.streaks.mesh);
    this.rocks.count = 0;
    this.rocks.frustumCulled = false;
    scene.add(this.rocks);
  }

  /** One particle and one ground stain, as the effects draw them, for the warm-up to compile their programs
   * (render/prewarm.ts): the abilities' clouds, rings and stains then cost no shader compile in play. */
  samples(at: Vector3): Object3D[] {
    // The particles' own geometry and material (kept: the warm-up must not free them).
    const sprite = new Mesh(this.particles.mesh.geometry, this.particles.mesh.material);
    sprite.frustumCulled = false;
    sprite.userData.keep = true;
    const stain = new Mesh(this.decalGeo, new MeshBasicMaterial({ color: 0x2c4a0c, transparent: true, opacity: 0.6, depthWrite: false }));
    // A wreck's flying bit too (it casts a shadow: the depth program with it).
    const bit = new Mesh(this.debrisGeo, this.debrisMat);
    bit.castShadow = true;
    bit.userData.keep = true;
    sprite.position.copy(at);
    stain.position.copy(at);
    bit.position.copy(at);
    return [sprite, stain, bit];
  }

  /** Collects the effects of the tick that just ran. */
  collect(world: World, seen: (x: number, y: number) => boolean): void {
    for (const s of world.shots) {
      if (!seen(s.x1, s.y1) && !seen(s.x2, s.y2)) continue;
      // Isdaris shoot light; the Orbe throws plasma.
      const faction = s.type && (DEFS[s.type] as { faction?: string } | undefined)?.faction;
      this.audio.play(s.type === 'orbe' ? 'plasma' : s.kind === 'ranged' && faction === 'isdaris' ? 'ray' : s.kind, 0.6);
      const shooter = s.id === undefined ? undefined : world.entities.get(s.id);
      if (shooter?.kit === 'flammes' && s.kind === 'ranged') {
        let to = this.at(s.x2, s.y2, 0.4 + (s.air2 ? FLY_HEIGHT : 0));
        const from = this.at(s.x1, s.y1, 0.55 + (s.air1 ? FLY_HEIGHT : 0));
        if (Z_STYLE) {
          // The jet runs its whole reach from the shooter's edge, through the target and on (it burns all on the line).
          const reach = shooter.radius / FP + BALANCE.weapons.flammes.range;
          const flat = to.clone().sub(from).setY(0);
          const p = from.clone().addScaledVector(flat.normalize(), reach);
          to = new Vector3(p.x, heightAt(this.map, p.x, p.z) + 0.35, p.z);
        }
        const jet = this.jets.get(s.id!) ?? { id: s.id!, from, to, left: 0, spill: 0 };
        [jet.from, jet.to, jet.left] = [from, to, FLAME_COOLDOWN * 1.15];
        this.jets.set(s.id!, jet);
        continue;
      }
      this.shot(s, world);
    }
    for (const c of world.casts) {
      if (c.kind === 'napalm' || c.kind === 'impulsion') this.holds(world, c.kind, c.x, c.y);
      if (!seen(c.x, c.y)) continue;
      if (c.kind !== 'rappel') this.audio.play(c.kind as Sfx, 0.9); // the recall sounds with its teleport
      this.ability(c.kind, this.at(c.x, c.y, 0.1));
    }
    // Murs d'énergie: a shimmering curtain of cyan sparks over each tile while it stands.
    for (const m of world.walls) {
      for (const i of m.tiles) {
        const [x, y] = [((i % this.map.width) + 0.5) * FP, (Math.floor(i / this.map.width) + 0.5) * FP];
        if (!seen(x, y)) continue;
        const p = this.at(x, y, Math.random() * 1.6).add(new Vector3((Math.random() - 0.5) * 0.9, 0, (Math.random() - 0.5) * 0.9));
        this.spawn(this.tex.glow, 0x5ae8ff, p, new Vector3(0, 0.5, 0), 0.6, 0.55, 0.25, 0.8, 0, true);
      }
    }
    for (const tp of world.teleports) if (seen(tp.x1, tp.y1) || seen(tp.x2, tp.y2)) this.audio.play(tp.phase === 'start' ? 'rappel' : 'arrive');
    // Lasting powers, shown while they last (twice a second): a Gravité alourdie's field round its socle, a Bouclier de
    // plasma's bubble over its building.
    if (world.tick % 10 === 0) {
      for (const e of world.entities.values()) {
        if (e.gravity > 0 && seen(e.x, e.y)) this.gravityField(this.at(e.x, e.y, 0.05));
        if (e.phased > 0 && e.def.kind === 'building' && seen(e.x, e.y)) this.bubble(this.at(e.x, e.y, 0), (e.def as { size: number }).size);
      }
    }
    for (const d of world.deaths) {
      if (!seen(d.x, d.y)) continue;
      const size = BUILDING_SIZES[d.type];
      this.audio.play('death', size ? 1.5 : 0.7);
      if (size) {
        this.explosion(this.at(d.x, d.y, 0.5), size);
        this.decal(this.at(d.x, d.y, 0.04), size * 1.1, 0x1a1410, 40);
      } else if (d.air) {
        // A flyer blows up in the air; its wreck falls with the unit's body.
        this.explosion(this.at(d.x, d.y, FLY_HEIGHT), 0.8);
      } else if (d.type !== 'minerai') {
        this.dust(this.at(d.x, d.y, 0.3), d.owner);
        this.decal(this.at(d.x, d.y, 0.03), 0.8, 0x2a1a12, 15);
      }
    }
    // Rappel: a column of light at the zone and at the Obélisque, a soft one while channelling, a flash on arrival.
    for (const t of world.teleports) {
      for (const [x, y] of [[t.x1, t.y1], [t.x2, t.y2]]) if (seen(x, y)) this.column(this.at(x, y, 0.05), t.phase === 'end');
    }
  }

  /** Notes which units a Napalm (the machine nearest the point) or an Impulsion magnétique (every unit of its zone) holds. */
  private holds(world: World, kind: 'napalm' | 'impulsion', x: number, y: number): void {
    const r = (BALANCE.abilities[kind].radius ?? 1.5) * FP;
    const near = [...world.entities.values()].filter((e) => e.def.kind === 'unit' && e.held > 0 && Math.hypot(e.x - x, e.y - y) <= r + e.radius);
    if (kind === 'napalm') near.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)).splice(1);
    for (const e of near) HELD_BY.set(e.id, kind);
  }

  /** A cloud of glows round p: n of them, spread wide, drifting up, each living about `life` seconds. */
  private cloud(p: Vector3, color: number, n: number, spread: number, rise: number, life: number, size: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * spread;
      const at = p.clone().add(new Vector3(Math.cos(a) * d, Math.random() * 0.3, Math.sin(a) * d));
      this.spawn(this.tex.glow, color, at, new Vector3((Math.random() - 0.5) * 0.3, rise * (0.5 + Math.random()), (Math.random() - 0.5) * 0.3), life * (0.6 + Math.random() * 0.6), size * 0.5, size, 0.7, 0, true);
    }
  }

  /** A ring of glows of the given radius round p, flaring outwards. */
  private ring(p: Vector3, color: number, radius: number, life: number): void {
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const at = p.clone().add(new Vector3(Math.cos(a) * radius, 0.15, Math.sin(a) * radius));
      this.spawn(this.tex.glow, color, at, new Vector3(Math.cos(a) * 0.8, 0.3, Math.sin(a) * 0.8), life, 0.35, 0.15, 0.9, 0, true);
    }
  }

  /** What each ability looks like where it is used. */
  private ability(kind: string, p: Vector3): void {
    switch (kind) {
      case 'explosiftoxique': // a sickly green cloud spreading over the zone
        this.explosion(p, 0.5);
        this.cloud(p, 0x8aff4a, 40, 2.4, 0.25, 3.5, 1.1);
        break;
      case 'silence': // a dome of cold blue sparks, then a ring at its edge
        this.cloud(p, 0x6ab8ff, 30, 4, 0.6, 2.5, 0.5);
        this.ring(p, 0x9ad0ff, 4, 1.2);
        break;
      case 'canonorbitalvise': // the target marked, the beam a few seconds away
        this.ring(p, 0xbfe6ff, 2.5, 6);
        break;
      case 'canonorbital': // a beam from orbit, then the blast
        this.column(p, true);
        this.column(p, false);
        this.explosion(p, 2.5);
        this.ring(p, 0xbfe6ff, 2.5, 0.8);
        break;
      case 'teleport':
      case 'teleportgroupe':
      case 'couloir':
        this.column(p, true);
        break;
      case 'deflagration': // a bolt of plasma striking down
        for (let i = 0; i < 10; i++) this.spawn(this.tex.glow, 0xd89cff, p.clone().setY(p.y + i * 0.5 + Math.random() * 0.2).add(rnd(0.15)), new Vector3(0, -3, 0), 0.25, 0.5, 0.2, 1, 0, true);
        this.explosion(p, 0.8);
        break;
      case 'chocmental':
        this.ring(p, 0xc08aff, 0.8, 0.8);
        break;
      case 'coupcirculaire':
      case 'feucirculaire':
        this.ring(p, 0xffc46a, kind === 'feucirculaire' ? 3 : 1.5, 0.5);
        break;
      case 'regenerant':
      case 'renvoi':
      case 'double':
        this.cloud(p, kind === 'renvoi' ? 0xffe08a : 0x7dffb0, 18, 1, 1.2, 1.2, 0.3);
        break;
      case 'reanimation': // a body stirring: green motes rising from the ground
        this.cloud(p, 0x5aff8a, 24, 0.8, 1.6, 1.6, 0.35);
        break;
      case 'napalm':
        this.explosion(p, 0.7);
        this.cloud(p, 0xff7a2a, 16, 0.8, 0.8, 1, 0.5);
        break;
      case 'manteau':
      case 'camouflage':
      case 'camouflagewalkyrie':
      case 'dephasage':
      case 'portedephasage':
      case 'enfouissement':
        this.cloud(p, kind === 'enfouissement' ? 0xb08a60 : 0xe8f0ff, 20, kind === 'portedephasage' ? 4 : kind === 'manteau' ? 5 : 0.8, 0.5, 1.4, 0.4);
        break;
      case 'observatoire':
        this.ring(p, 0xfff4d0, 6, 1.6);
        break;
      case 'decollage':
        this.cloud(p, 0xb0a090, 16, 1, 0.4, 1.2, 0.6);
        break;
      case 'gravite': // the field gathering round the socle (gravityField keeps it while it lasts)
        this.ring(p, 0xa07aff, 3, 1.4);
        this.cloud(p, 0xb89aff, 30, 3, 0.2, 2, 0.7);
        break;
      case 'lumiereardente': // a blinding flash of sunlight on the zone
        this.column(p, true);
        this.ring(p, 0xfff2b0, 2.4, 0.8);
        this.cloud(p, 0xfff6d0, 44, 2.4, 0.9, 1.1, 1.3);
        this.spawn(this.tex.glow, 0xfffbe8, p.clone().setY(p.y + 0.6), new Vector3(), 0.5, 2, 6, 1, 0, true); // the glare
        break;
      case 'gazeuphorisants': // a pink cloud spreading over the allies
        this.cloud(p, 0xff8ad8, 40, 3, 0.35, 3.5, 1);
        this.ring(p, 0xffb0e8, 3, 1);
        break;
      case 'festin': // the Allosaure tears into a corpse
        this.cloud(p, 0xb02020, 30, 1, 0.7, 1.8, 0.7);
        for (let i = 0; i < 14; i++) this.spawn(this.tex.glow, 0xd83030, p.clone().setY(p.y + 0.4), rnd(1.8).setY(1.5 + Math.random() * 1.5), 0.7, 0.22, 0.1, 1, 9, true);
        this.decal(p.clone().setY(p.y - 0.07), 1.2, 0x4a0c0c, 20);
        break;
      case 'bouclierplasma': // the bubble rises (bubble keeps it while it lasts)
        this.ring(p, 0x6ae8ff, 2.5, 1);
        break;
      case 'jetdesable': // sand thrown into the vehicle's works
        for (let i = 0; i < 40; i++) this.spawn(this.tex.smoke, 0xc8a86a, p.clone().add(rnd(0.4)), rnd(2.6).setY(0.5 + Math.random() * 0.8), 1.6 + Math.random() * 0.8, 0.5, 1.6, 0.9, 0, false);
        this.cloud(p, 0xe8cc90, 20, 1.5, 0.3, 2.5, 0.8);
        break;
      case 'acidedissolvant': // a torrent of acid: splashes, fumes and a burnt stain
        for (let i = 0; i < 36; i++) this.spawn(this.tex.glow, 0x9aff3a, p.clone().add(rnd(0.6)).setY(p.y + 0.4), rnd(3).setY(2.5 + Math.random() * 2.5), 1.1, 0.4, 0.15, 1, 9, true);
        this.cloud(p, 0x7aff3a, 30, 1.8, 0.6, 2.8, 0.9);
        this.decal(p.clone().setY(p.y - 0.07), 1.8, 0x2c4a0c, 20);
        break;
      case 'posermine': // the mine dug in under the tank
        this.cloud(p, 0x8a7a62, 8, 0.4, 0.3, 0.8, 0.4);
        break;
      case 'minechimique': // it goes off: a blast and a green cloud
        this.explosion(p, 0.6);
        this.cloud(p, 0x8aff4a, 24, 1.5, 0.3, 2.5, 0.9);
        break;
    }
  }


  /**
   * The Humans' lasting spells, each drawn its own way on the unit or the ground while it lasts (chosen by the user,
   * 2026-11-23): Peau de roc's stone scales, Régénérant's green veins, Gaz euphorisants' pink bubbles, Camouflage's haze,
   * poison drops, Napalm's flames on a held machine, a mine's blink and trigger circle, the Réservoir's fuse sparks,
   * Explosif toxique's fog, Observation céleste's column of light, a Cadavre réanimé's flies. The Stimulant keeps its
   * badge. Call every frame; render only.
   */
  lasting(world: World, sees: (e: Entity) => boolean, alpha: number, dt: number): void {
    const t = performance.now() / 1000;
    const chance = (rate: number) => Math.random() < dt * rate * this.density;
    let rocks = 0;
    for (const e of world.entities.values()) {
      if (e.def.kind !== 'unit' || e.inside || e.hp <= 0 || !sees(e)) continue;
      const lasting = e.skin > 0 || e.ferveur > 0 || e.pace > 0 || e.camo > 0 || e.poison > 0 || HELD_BY.has(e.id) || e.fuse > 0 || e.type === 'cadavre' || e.type === 'minechimique' || e.type === 'minealchimique';
      if (!lasting) continue;
      const x = (e.px + (e.x - e.px) * alpha) / FP;
      const z = (e.py + (e.y - e.py) * alpha) / FP;
      const foot = new Vector3(x, heightAt(this.map, x, z) + (soars(e) ? FLY_HEIGHT : 0), z);
      const r = e.radius / FP;
      const tall = 0.9 + r * 0.8;
      const seed = e.id * 7.31;
      const onBody = (a: number, h: number, out = 0.05) => foot.clone().add(new Vector3(Math.cos(a) * (r + out), h * tall, Math.sin(a) * (r + out)));
      // Peau de roc: flat stone scales stuck all over the body.
      if (e.skin > 0) {
        for (let i = 0; i < 16 && rocks < MAX_ROCKS; i++) {
          this.rockM.makeRotationY(seed + i).scale(this.rockScale).setPosition(onBody(seed + i * 2.39, 0.1 + ((i * 0.37) % 0.85), 0));
          this.rocks.setMatrixAt(rocks++, this.rockM);
        }
      }
      // Régénérant: green streaks running up its body.
      if (e.ferveur > 0 && chance(10)) {
        const a = Math.random() * 6.28;
        this.streaks.spawn(0x5aff8a, onBody(a, 0.05, 0.02), onBody(a + 0.3, 0.9, 0.02), 0.25, 0.2, 0.35, 0.06, 1);
      }
      // Gaz euphorisants: pink bubbles rising off its head.
      if (e.pace > 0 && e.paceMove > 100 && chance(7)) {
        this.spawn(this.tex.glow, 0xff8ad8, foot.clone().add(rnd(r * 0.6)).setY(foot.y + tall), new Vector3((Math.random() - 0.5) * 0.4, 0.9, 0), 1.2, 0.1, 0.22, 0.9, 0, true);
      }
      // The Belluaire's Camouflage (seen by its own side): a pale haze wrapping its legs. Other camps' veils keep their badge.
      if (e.camo > 0 && e.type === 'belluaire' && chance(8)) {
        this.spawn(this.tex.smoke, 0xe8eef4, onBody(Math.random() * 6.28, 0.15, 0.1), new Vector3(0, 0.15, 0), 1.2, 0.3, 0.6, 0.45, 0, false);
      }
      // Poison (Lames empoisonnées): green drops falling off it.
      if (e.poison > 0 && chance(18)) {
        this.spawn(this.tex.glow, 0x9aff3a, onBody(Math.random() * 6.28, 0.6 + Math.random() * 0.3), new Vector3(), 0.6, 0.22, 0.12, 1, 6, true);
      }
      // Napalm: the machine it holds burns where it stands.
      const by = HELD_BY.get(e.id);
      if (by && e.held === 0) HELD_BY.delete(e.id);
      else if (by === 'napalm') this.burn(foot.clone().setY(foot.y + 0.3), 0.15, r * 1.6, dt, e.id);
      // Mines: a red light blinking, the Bourdon's quicker, and a faint circle at their trigger reach on each blink.
      if (e.type === 'minechimique' || e.type === 'minealchimique') {
        const rate = e.type === 'minealchimique' ? 3 : 1;
        const phase = (t * rate + seed) % 1;
        const on = phase < 0.4;
        this.hold(this.tex.glow, 0xff3020, foot.clone().setY(foot.y + 0.2), on ? 0.55 : 0.25, on ? 1 : 0.5, dt, true);
        if (on && ((t - dt) * rate + seed) % 1 >= 0.4) this.ring(foot.clone(), 0xff4030, e.type === 'minechimique' ? BALANCE.abilities.posermine.radius / 2 : BALANCE.abilities.minealchimique.radius, 0.3);
      }
      // Explosion suicidaire: the Réservoir's fuse throwing yellow sparks.
      if (e.fuse > 0 && chance(30)) this.spawn(this.tex.glow, 0xffd060, foot.clone().setY(foot.y + tall), rnd(1.5).setY(1.5), 0.3, 0.1, 0.02, 1, 6, true);
      // Cadavre réanimé: black flies round its head.
      if (e.type === 'cadavre') this.flies(foot, tall, t, dt);
    }
    this.rocks.count = rocks;
    this.rocks.instanceMatrix.needsUpdate = true;
    if (SPELL_IDEA === '1' || SPELL_IDEA === '2') this.zLasting(world, sees, alpha, dt, SPELL_IDEA === '1');
    // Explosif toxique: a low green fog over the whole zone.
    for (const c of world.clouds) {
      if (c.hits <= 0) continue;
      const p = this.at(c.x, c.y, 0.05);
      const R = c.r / FP;
      for (let n = Math.floor(dt * 14 * R) + (Math.random() < (dt * 14 * R) % 1 ? 1 : 0); n > 0; n--) {
        const a = Math.random() * 6.28;
        const d = Math.sqrt(Math.random()) * R;
        this.spawn(this.tex.smoke, 0x7ac040, p.clone().add(new Vector3(Math.cos(a) * d, 0.1, Math.sin(a) * d)), new Vector3(0, 0.1, 0), 1.8, 0.6, 1.2, 0.45, 0, false);
      }
    }
    // Observation céleste: a soft column of light from the sky onto the spot, small sparkles over the zone.
    for (const sc of world.scans) {
      if (sc.left <= 0) continue;
      const p = this.at(sc.x, sc.y, 0.05);
      const R = sc.radius ?? BALANCE.rules.observation.radius;
      if (chance(25)) this.spawn(this.tex.glow, 0xfff0c0, p.clone().add(rnd(0.3)).setY(p.y + Math.random() * 6), new Vector3(0, -2, 0), 0.8, 1.2, 0.8, 0.45, 0, true);
      if (chance(2 * R)) {
        const a = Math.random() * 6.28;
        const d = Math.sqrt(Math.random()) * R;
        this.spawn(this.tex.glow, 0xfff6dc, p.clone().add(new Vector3(Math.cos(a) * d, 0.3, Math.sin(a) * d)), new Vector3(0, 0.2, 0), 1, 0.1, 0.03, 0.9, 0, true);
      }
    }
  }


  /** Proposal stage: the Z's lasting spells, two ideas each (one: ?sorts=1, two: ?sorts=2). Render only. */
  private zLasting(world: World, sees: (e: Entity) => boolean, alpha: number, dt: number, one: boolean): void {
    const t = performance.now() / 1000;
    const chance = (rate: number) => Math.random() < dt * rate;
    const cones = [...world.entities.values()].filter((c) => c.cone > 0 && c.hp > 0);
    const R = BALANCE.abilities.cone.radius * FP;
    for (const e of world.entities.values()) {
      if (e.inside || e.hp <= 0 || !sees(e)) continue;
      const x = (e.px + (e.x - e.px) * alpha) / FP;
      const z = (e.py + (e.y - e.py) * alpha) / FP;
      const foot = new Vector3(x, heightAt(this.map, x, z) + (soars(e) ? FLY_HEIGHT : 0), z);
      const building = e.def.kind === 'building';
      const r = building ? (e.def as { size: number }).size * 0.5 : e.radius / FP;
      const tall = building ? 1.2 + r * 0.6 : 0.9 + r * 0.8;
      const seed = e.id * 7.31;
      const onBody = (a: number, h: number, out = 0.05) => foot.clone().add(new Vector3(Math.cos(a) * (r + out), h * tall, Math.sin(a) * (r + out)));
      // Gravité alourdie, on a slowed enemy: weights of violet light pressing down (1) or rings crushing down on it (2).
      if (e.heavy > 0) {
        if (one) { if (chance(25)) this.spawn(this.tex.glow, 0xa07aff, onBody(Math.random() * 6.28, 1.4, -r * 0.5), new Vector3(0, -2.5, 0), 0.5, 0.24, 0.12, 1, 0, true); }
        else if (Math.floor(t / 0.35 + seed) !== Math.floor((t - dt) / 0.35 + seed)) for (let i = 0; i < 16; i++) this.spawn(this.tex.glow, 0xb89aff, onBody((i / 16) * 6.28, 1.3, 0.2), new Vector3(0, -2.4, 0), 0.5, 0.16, 0.08, 1, 0, true);
      }
      // Nuage de nanites, on an allied machine near a casting Accumulateur: a swarm of nanites (1) or a cage of light (2).
      if (e.def.kind === 'unit' && (e.def as { mechanical?: boolean }).mechanical && cones.some((c) => !world.hostile(c.owner, e.owner) && Math.hypot(c.x - e.x, c.y - e.y) <= R)) {
        if (one) for (let i = 0; i < 8; i++) this.hold(this.tex.glow, 0x9affb0, onBody(t * (2 + i * 0.3) + i, 0.2 + ((i * 0.31 + t * 0.2) % 0.8), 0.15), 0.07, 1, dt, true);
        else for (let h = 0; h < 3; h++) for (let i = 0; i < 10; i++) this.hold(this.tex.glow, 0x5affb0, onBody((i / 10) * 6.28 + h * 0.3 + t * 0.4, 0.15 + h * 0.35, 0.18), 0.06, 0.8, dt, true);
      }
      // Gel électronique, on a frozen building: ice-blue crackles and frost (1) or a frozen grid turning round it (2).
      if (building && e.frozen > 0) {
        if (one) {
          if (chance(14)) this.spawn(this.tex.glow, 0x9ad8ff, onBody(Math.random() * 6.28, Math.random(), -0.2), rnd(0.4), 0.25, 0.25, 0.05, 1, 0, true);
          if (chance(6)) this.spawn(this.tex.glow, 0xffffff, onBody(Math.random() * 6.28, 1, -r * Math.random()), new Vector3(0, -0.6, 0), 1.2, 0.08, 0.05, 1, 0, true);
        } else for (let k = 0; k < 8; k++) {
          const a = t * 0.5 + (k * Math.PI) / 2;
          const h = 0.15 + ((t * 0.3 + (k >> 2) * 0.45) % 0.9);
          this.streaks.spawn(0x7ad0ff, onBody(a, h, 0.25), onBody(a + Math.PI / 2, h, 0.25), 0, dt * 1.5, 0, 0.09, 1);
        }
      }
      // Balise de vacarme: sound rings from the beacon (1); jagged bars over the deafened (2).
      if (e.type === 'vacarme') {
        const RV = BALANCE.abilities.vacarme.radius;
        if (one && Math.floor(t / 0.7 + seed) !== Math.floor((t - dt) / 0.7 + seed)) {
          for (let i = 0; i < 32; i++) {
            const a = (i / 32) * 6.28;
            this.spawn(this.tex.glow, 0xd8ff8a, foot.clone().setY(foot.y + 0.3), new Vector3(Math.cos(a) * RV / 0.9, 0, Math.sin(a) * RV / 0.9), 0.9, 0.14, 0.1, 0.8, 0, true);
          }
        }
      }
      if (!one && !building && e.frozen > 0 && chance(20)) {
        const top = foot.clone().setY(foot.y + tall + 0.2);
        let a = top.clone().add(new Vector3(-0.2, 0, 0));
        for (let k = 1; k <= 4; k++) {
          const b = top.clone().add(new Vector3(-0.2 + k * 0.1, (k % 2) * 0.15, 0));
          this.streaks.spawn(0xd8ff8a, a, b, 0, 0.25, 0, 0.06, 1);
          a = b;
        }
      }
      // Impulsion magnétique: little electric arcs crackling over it (1), or magnetic rings orbiting it (2).
      if (HELD_BY.get(e.id) === 'impulsion') {
        if (one) {
          if (chance(40)) {
            let a = onBody(Math.random() * 6.28, Math.random(), 0.05);
            for (let k = 0; k < 3; k++) {
              const b = a.clone().add(rnd(0.18));
              this.streaks.spawn(0x9affe8, a, b, 0, 0.12, 0, 0.06, 1);
              a = b;
            }
          }
        } else for (let k = 0; k < 2; k++) for (let i = 0; i < 12; i++) {
          const a = (i / 12) * 6.28 + t * (k ? -2 : 2);
          this.hold(this.tex.glow, 0x6affd8, foot.clone().add(new Vector3(Math.cos(a) * (r + 0.25), tall * (0.35 + k * 0.35) + Math.sin(a) * 0.15 * (k ? 1 : -1), Math.sin(a) * (r + 0.25))), 0.06, 0.9, dt, true);
        }
      }
      // Canon IEM, on a seized unit: a link of green light to the Centre K (1), a crown of sparks over it (2).
      if (e.seizedLeft > 0) {
        const k = world.entities.get(e.seizedBy);
        if (one && k) {
          if (chance(20)) this.streaks.spawn(0x8cff5a, this.at(k.x, k.y, 2), foot.clone().setY(foot.y + tall), 0, 0.15, 0, 0.05, 0.8);
        } else if (!one) for (let i = 0; i < 8; i++) this.hold(this.tex.glow, 0x8cff5a, onBody(t * 1.5 + (i * 6.28) / 8, 1.1, -r * 0.4), 0.14, 1, dt, true);
      }
      // Kit d'invisibilité, seen by its own side: green sparkles (1) or scan lines climbing it (2).
      if (e.support & KIT.invisibilite) {
        if (one) { if (chance(40)) this.spawn(this.tex.glow, 0xb8ffc8, onBody(Math.random() * 6.28, Math.random()), new Vector3(), 0.3, 0.22, 0.04, 1, 0, true); }
        else {
          for (const off of [0, 0.33, 0.66]) {
            const h = (t * 0.6 + seed + off) % 1;
            this.streaks.spawn(0x8cff5a, onBody(-0.8, h, 0.05), onBody(0.8, h, 0.05), 0, dt * 1.5, 0, 0.06, 1);
            this.streaks.spawn(0x8cff5a, onBody(2.3, h, 0.05), onBody(3.9, h, 0.05), 0, dt * 1.5, 0, 0.06, 1);
          }
        }
      }
      // Kit auto-réparateur: welding sparks now and then (1), green glints rising (2).
      if (e.support & KIT.reparateur) {
        if (one) { if (chance(8)) for (let i = 0; i < 8; i++) this.spawn(this.tex.glow, i % 2 ? 0xffffff : 0x9affd0, onBody(seed + t, 0.6), rnd(1.5).setY(1), 0.3, 0.09, 0.02, 1, 9, true); }
        else if (chance(14)) this.spawn(this.tex.glow, 0x9affd0, onBody(Math.random() * 6.28, 0.2), new Vector3(0, 0.9, 0), 0.8, 0.2, 0.05, 1, 0, true);
      }
    }
    // Balise de révélation (a Z player's scans): a radar sweep (1), a beam and a pulse at its reach (2).
    for (const sc of world.scans) {
      if (sc.left <= 0 || world.players[sc.owner]?.faction !== 'z') continue;
      const p = this.at(sc.x, sc.y, 0.1);
      const Rs = sc.radius ?? 4;
      if (one) {
        const a = t * 1.8;
        this.streaks.spawn(0x8cff5a, p, p.clone().add(new Vector3(Math.cos(a) * Rs, 0, Math.sin(a) * Rs)), 0, 0.35, 0, 0.12, 0.6);
      } else {
        if (chance(40)) this.spawn(this.tex.glow, 0x8cff5a, p.clone().add(rnd(0.15)).setY(p.y + Math.random() * 4), new Vector3(0, 1.5, 0), 0.8, 0.7, 0.4, 0.6, 0, true);
        if (Math.floor(t / 1.2) !== Math.floor((t - dt) / 1.2)) this.ring(p, 0x8cff5a, Rs, 1);
      }
    }
  }

  /** A Cadavre réanimé (the user's pick, 2026-11-23): a swarm of small black flies buzzing round its head. */
  private flies(foot: Vector3, tall: number, t: number, dt: number): void {
    const head = foot.clone().setY(foot.y + tall * 0.78);
    for (let i = 0; i < 10; i++) {
      const a = t * (3 + i * 0.7) + i * 1.7;
      const d = 0.22 + 0.1 * Math.sin(t * 5 + i * 2);
      this.hold(this.tex.smoke, 0x0c0a08, head.clone().add(new Vector3(Math.cos(a) * d, 0.1 * Math.sin(t * 7 + i), Math.sin(a) * d)), 0.15, 1, dt, false);
    }
  }

  /** A Gravité alourdie's field: a faint violet circle at its reach, glows pressed down round the socle. */
  private gravityField(p: Vector3): void {
    const R = 18;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2 + Math.random() * 0.1;
      this.spawn(this.tex.glow, 0x9a6aff, p.clone().add(new Vector3(Math.cos(a) * R, 1, Math.sin(a) * R)), new Vector3(0, -1.2, 0), 0.9, 0.6, 0.2, 0.55, 0, true);
    }
    // Round the socle, motes pressed down to the ground, and a faint ring at its feet.
    for (let i = 0; i < 14; i++) this.spawn(this.tex.glow, 0xc8aaff, p.clone().add(rnd(3)).setY(p.y + 2 + Math.random()), new Vector3(0, -2.5, 0), 0.8, 0.45, 0.15, 0.85, 0, true);
    this.ring(p, 0x9a6aff, 2, 0.6);
  }

  /** A Bouclier de plasma: a shimmering dome of cyan glows over a building of this size. */
  private bubble(p: Vector3, size: number): void {
    const r = size * 0.75;
    for (let i = 0; i < 50; i++) {
      const t = Math.random() * Math.PI * 2;
      const f = Math.acos(Math.random()); // upper half
      const at = p.clone().add(new Vector3(r * Math.sin(f) * Math.cos(t), r * Math.cos(f) + 0.2, r * Math.sin(f) * Math.sin(t)));
      this.spawn(this.tex.glow, 0x6ae8ff, at, new Vector3(), 0.7, 0.8, 0.7, 0.5, 0, true);
    }
  }

  /** Art Deco beam: stacked gold-white glows rising from a bright disc. */
  private column(p: Vector3, flash: boolean): void {
    const life = flash ? 0.9 : 3.8;
    for (let i = 0; i < 14; i++) {
      const at = p.clone().add(new Vector3((Math.random() - 0.5) * 0.25, i * 0.32, (Math.random() - 0.5) * 0.25));
      this.spawn(this.tex.glow, i % 3 ? 0xffe6a0 : 0xfffaf0, at, new Vector3(0, flash ? 2.5 : 0.4, 0), life * (0.7 + Math.random() * 0.3), 0.5, flash ? 0.9 : 0.6, flash ? 1 : 0.5, 0, true);
    }
    this.spawn(this.tex.glow, 0xfff4d0, p.clone().setY(p.y + 0.1), new Vector3(), flash ? 0.6 : life, flash ? 1.5 : 1, flash ? 4 : 2.2, flash ? 1 : 0.45, 0, true);
  }

  private at(x: number, y: number, lift: number): Vector3 {
    const wx = x / FP;
    const wz = y / FP;
    return new Vector3(wx, heightAt(this.map, wx, wz) + lift, wz);
  }

  private shot(s: Shot, world?: World): void {
    const from = this.at(s.x1, s.y1, 0.55 + (s.air1 ? FLY_HEIGHT : 0));
    const to = this.at(s.x2, s.y2, 0.5 + (s.air2 ? FLY_HEIGHT : 0));
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (FX_STYLE === 'avant') return this.oldShot(s.kind, from, to, dir);
    if (s.kind === 'heal') {
      // Soin (the user's pick, 2026-11-23): white motes thrown from the healer's hand to the one healed, and white
      // glints rising off it.
      const hand = (s.id !== undefined && this.muzzle(s.id)) || from;
      const way = to.clone().sub(hand);
      for (let i = 0; i < 5; i++) this.spawn(this.tex.glow, 0xffffff, hand.clone().add(rnd(0.08)), way.clone().divideScalar(0.35).add(rnd(0.3)), 0.35, 0.12, 0.06, 1, 0, true);
      for (let i = 0; i < 10; i++) this.spawn(this.tex.glow, i % 3 ? 0xffffff : 0xe8fff0, to.clone().add(rnd(0.35)).setY(to.y - 0.4), new Vector3(0, 1.2 + Math.random() * 0.6, 0), 1, 0.16, 0.05, 1, 0, true);
      return;
    }
    const ammo = s.type ? AMMO[s.type] : undefined;
    if (ammo && this.munition(ammo, s, from, to, world)) return;
    const z = s.type && (DEFS[s.type] as { faction?: string } | undefined)?.faction === 'z' && s.id !== undefined ? world?.entities.get(s.id) : undefined;
    if (z && Z_STYLE && this.zShot(z.kit || 'mitrailleuse', s, from, to)) return;
    if (s.kind === 'melee') {
      // A white flash where the blow lands and a spray of sparks.
      this.spawn(this.tex.glow, 0xfff4d8, to.clone(), new Vector3(), 0.12, 0.25, 0.55, 1, 0, true);
      for (let i = 0; i < 10; i++) {
        this.spawn(this.tex.glow, 0xffd27a, to.clone(), rnd(3).setY(1 + Math.random() * 2), 0.3, 0.13, 0.03, 1, 9, true);
      }
      return;
    }
    const faction = s.type ? (DEFS[s.type] as { faction?: string } | undefined)?.faction : undefined;
    const color = s.type === 'orbe' ? 0xd89cff : (SHOT_COLORS[faction ?? ''] ?? 0xfff0c0);
    const muzzle = from.clone().addScaledVector(dir.clone().normalize(), 0.35);
    // The flight: fast, but slow enough to be seen, about 25 tiles a second.
    const flight = Math.min(0.3, Math.max(0.08, dist / 25));
    this.spawn(this.tex.glow, 0xffffff, muzzle, new Vector3(), 0.08, 0.5, 0.2, 1, 0, true);
    this.spawn(this.tex.glow, color, muzzle, new Vector3(), 0.12, 0.6, 0.3, 0.9, 0, true);
    // Tracers: a streak about a tile long running to the target.
    this.streaks.spawn(color, from, to, flight, 0.06, 1.2, 0.14, 1);
    // The hit, once the round gets there: a flash in its colour.
    this.hits.push({ at: to, color, left: flight });
  }

  /** A Human weapon's own look; false: not one it draws (a blow at arm's length that is no flame, say). */
  private munition(ammo: Ammo, s: Shot, from: Vector3, to: Vector3, world?: World): boolean {
    const dist = from.distanceTo(to);
    const camp = SHOT_COLORS.humains;
    if (ammo === 'flamme') {
      // The Belluaire's flamethrower: a short jet of flame onto what it fights.
      if (s.id === undefined) return false;
      this.jets.set(s.id, { id: s.id, from: from.clone().lerp(to, 0.15), to, left: 0.45, spill: 0 });
      return true;
    }
    if (s.kind === 'melee' || s.kind === 'heal') return false; // an Ankylosaure's tail at arm's length
    const muzzle = from.clone().addScaledVector(to.clone().sub(from).normalize(), 0.3);
    const flight = Math.min(0.3, Math.max(0.08, dist / 25));
    switch (ammo) {
      case 'balle':
        this.flash(muzzle, camp, 1);
        this.streaks.spawn(camp, from, to, flight, 0.06, 1.2, 0.13, 1);
        this.hits.push({ at: to, color: camp, left: flight });
        return true;
      case 'dard': // a thin quick needle, pale, and a green glint where it pricks
        this.streaks.spawn(0xffe0a0, from, to, flight * 0.8, 0.05, 0.5, 0.06, 0.9);
        this.hits.push({ at: to, color: 0x9aff9a, left: flight * 0.8 });
        return true;
      case 'carreau': // a heavy bolt: a long thick streak, then dust where it strikes
        this.streaks.spawn(0xffd9a0, from, to, flight * 1.3, 0.05, 1.6, 0.17, 1);
        this.hits.push({ at: to, color: camp, left: flight * 1.3 });
        return true;
    }
    const lob = LOBS[ammo]!;
    const chem = !!world && s.id !== undefined && ['alchimiste', 'cuve', 'tour'].includes(s.type ?? '') && world.level(world.entities.get(s.id)?.owner ?? -1, 'armeschimiques') > 0;
    if (ammo === 'obus') {
      // The Incineratus fires: a big flash and a puff of smoke at the barrel.
      this.flash(muzzle, camp, 1.8);
      for (let i = 0; i < 6; i++) this.spawn(this.tex.smoke, 0x6a625a, muzzle.clone().add(rnd(0.15)), rnd(0.5).setY(0.4), 1.2, 0.3, 0.9, 0.6, -0.1, false);
    } else if (ammo === 'roquette') {
      this.flash(muzzle, camp, 1.2);
    }
    this.lobs.push({ ammo, from: from.clone(), to: to.clone(), age: 0, flight: Math.max(0.15, dist * lob.pace), arc: Math.max(0.3, dist * lob.arc), chem, spill: 0 });
    return true;
  }

  /**
   * A Z weapon's own look, by its kit (Z.doc): machine gun bursts, laser beam, rockets, shredder, sonic jet along its line,
   * electric arc, X-04 shell, repair beam. The Z's green runs through them all. False: not one it draws.
   */
  private zShot(kit: string, s: Shot, from: Vector3, to: Vector3): boolean {
    const muzzle = (s.id !== undefined && this.muzzle(s.id)) || from;
    const dist = muzzle.distanceTo(to);
    if (s.kind === 'heal' || kit === 'reparateur') {
      // Réparateur: a steady green-white beam, sparks of welding where it lands.
      this.streaks.spawn(0x9affd0, muzzle, to, 0, 0.3, 0, 0.07, 0.9);
      for (let i = 0; i < 5; i++) this.spawn(this.tex.glow, i % 2 ? 0xffffff : 0x9affd0, to.clone(), rnd(1.5).setY(1 + Math.random()), 0.3, 0.09, 0.02, 1, 9, true);
      return true;
    }
    if (kit === 'dechiqueteur' || s.kind === 'melee') {
      // Déchiqueteur: metal torn, white and orange sparks sprayed, a green flash.
      this.spawn(this.tex.glow, Z_GREEN, to.clone(), new Vector3(), 0.12, 0.3, 0.6, 0.9, 0, true);
      for (let i = 0; i < 14; i++) this.spawn(this.tex.glow, i % 3 ? 0xffd27a : 0xffffff, to.clone(), rnd(3.5).setY(1 + Math.random() * 2.5), 0.35, 0.12, 0.02, 1, 9, true);
      return true;
    }
    this.flash(muzzle, Z_GREEN, kit === 'canonx04' ? 2 : 1);
    const flight = Math.min(0.3, Math.max(0.06, dist / 30));
    switch (kit) {
      case 'mitrailleuse': // a burst of three short green tracers
        for (let k = 0; k < 3; k++) {
          const off = rnd(0.12);
          this.streaks.spawn(Z_GREEN, muzzle.clone().addScaledVector(to.clone().sub(muzzle), -k * 0.12), to.clone().add(off), flight * (1 + k * 0.35), 0.04, 0.6, 0.09, 1);
        }
        this.hits.push({ at: to, color: Z_GREEN, left: flight });
        return true;
      case 'laser': // a straight beam, instant, fading
        this.streaks.spawn(0x7affb8, muzzle, to, 0, 0.25, 0, 0.1, 1);
        this.streaks.spawn(0xffffff, muzzle, to, 0, 0.12, 0, 0.04, 1);
        this.hits.push({ at: to, color: 0x7affb8, left: 0 });
        return true;
      case 'roquettes': // two rockets with green exhaust, in a slight arc
        for (let k = 0; k < 2; k++) this.lobs.push({ ammo: 'roquette', from: muzzle.clone().add(rnd(0.1)), to: to.clone().add(rnd(0.25)), age: -k * 0.08, flight: Math.max(0.2, dist * 0.06), arc: Math.max(0.3, dist * 0.06), chem: false, spill: 0, color: Z_GREEN });
        return true;
      case 'canonx04': // a heavy shell high in the air, a big blast the size of its splash
        this.lobs.push({ ammo: 'obusz', from: muzzle.clone(), to: to.clone(), age: 0, flight: Math.max(0.4, dist * 0.09), arc: Math.max(1, dist * 0.3), chem: false, spill: 0, color: Z_GREEN });
        return true;
      case 'jetsonique': { // rings of sound running along the line, through all it hits
        const dir = to.clone().sub(muzzle).normalize();
        for (let k = 0; k < 6; k++) {
          const at = muzzle.clone().addScaledVector(dir, (k / 5) * dist);
          this.spawn(this.tex.glow, k % 2 ? 0xd8ffd0 : Z_GREEN, at, dir.clone().multiplyScalar(3), 0.25 + k * 0.03, 0.2, 0.9, 0.55, 0, true);
        }
        this.streaks.spawn(0xd8ffd0, muzzle, to, 0, 0.2, 0, 0.18, 0.5);
        return true;
      }
      case 'arc': { // a jagged bolt of lightning, flickering
        let a = muzzle.clone();
        const n = Math.max(3, Math.round(dist * 2));
        for (let k = 1; k <= n; k++) {
          const b = muzzle.clone().lerp(to, k / n).add(k < n ? rnd(0.22) : new Vector3());
          this.streaks.spawn(k % 2 ? 0xb8fff0 : 0x6affd8, a, b, 0, 0.18, 0, 0.07, 1);
          a = b;
        }
        this.hits.push({ at: to, color: 0x6affd8, left: 0 });
        return true;
      }
    }
    return false;
  }

  /** A muzzle's flash: white core, the camp's colour round it. */
  private flash(p: Vector3, color: number, k: number): void {
    this.spawn(this.tex.glow, 0xffffff, p, new Vector3(), 0.08, 0.45 * k, 0.2 * k, 1, 0, true);
    this.spawn(this.tex.glow, color, p, new Vector3(), 0.12, 0.6 * k, 0.3 * k, 0.9, 0, true);
  }

  /** One frame of a lobbed shot: its head along the arc, its smoke behind, and its blast when it lands. */
  private flyLob(l: (typeof this.lobs)[number], dt: number): boolean {
    const lob = LOBS[l.ammo]!;
    const color = l.color ?? lob.color;
    if ((l.age += dt) < 0) return true; // a second rocket waiting its turn
    const k = Math.min(1, l.age / l.flight);
    const at = l.from.clone().lerp(l.to, k);
    at.y += 4 * l.arc * k * (1 - k);
    if (k < 1) {
      // The head: hot white in the middle, its own colour round it (a stone: dark, no glow).
      // A trail drawn along its arc, fading behind it: the path reads at a glance (a stone's pale dust, the rest glowing).
      if (l.prev) this.streaks.spawn(l.ammo === 'rocher' ? 0xc8b090 : color, l.prev, at, 0, 0.18, 0, lob.size * 0.45, l.ammo === 'rocher' ? 0.6 : 0.9);
      if (l.ammo === 'rocher') this.spawn(this.tex.smoke, 0x5a4e40, at, new Vector3(), 0.05, lob.size, lob.size, 1, 0, false);
      else {
        this.spawn(this.tex.glow, color, at, new Vector3(), 0.06, lob.size * 1.6, lob.size * 1.4, 0.9, 0, true);
        this.spawn(this.tex.glow, 0xffffff, at, new Vector3(), 0.05, lob.size * 0.6, lob.size * 0.5, 1, 0, true);
      }
      l.prev = at;
      for (l.spill += dt * lob.smoke; l.spill >= 1; l.spill--) {
        this.spawn(this.tex.smoke, l.ammo === 'roquette' ? 0xd8d0c4 : 0x6a625a, at.clone().add(rnd(0.05)), new Vector3(0, 0.2, 0), 0.7, lob.size * 0.5, lob.size * 1.8, 0.55, 0, false);
      }
      return true;
    }
    const p = l.to;
    switch (l.ammo) {
      case 'grenade':
        this.flash(p, 0xffa040, 1.4);
        for (let i = 0; i < 8; i++) this.spawn(this.tex.glow, 0xffc060, p.clone(), rnd(2.5).setY(1.5 + Math.random() * 1.5), 0.35, 0.14, 0.03, 1, 9, true);
        for (let i = 0; i < 4; i++) this.spawn(this.tex.smoke, 0x3a3430, p.clone().add(rnd(0.2)), rnd(0.4).setY(0.6), 1.4, 0.3, 0.9, 0.6, -0.1, false);
        break;
      case 'fiole': // the flask breaks: a green splash
        this.flash(p, 0x9aff6a, 1);
        for (let i = 0; i < 12; i++) this.spawn(this.tex.glow, 0x9aff3a, p.clone(), rnd(2).setY(1.5 + Math.random()), 0.5, 0.14, 0.04, 1, 9, true);
        break;
      case 'bombe': // a blast the size of its splash
        this.explosion(p, 0.7);
        this.ring(p.clone().setY(p.y - 0.4), 0xffa040, 0.6, 0.5);
        break;
      case 'obus':
        this.flash(p, 0xffa040, 2.2);
        for (let i = 0; i < 12; i++) this.spawn(this.tex.glow, i % 2 ? 0xffc060 : 0xff7a2a, p.clone(), rnd(3).setY(2 + Math.random() * 2), 0.5, 0.18, 0.04, 1, 9, true);
        for (let i = 0; i < 6; i++) this.spawn(this.tex.smoke, 0x2c2622, p.clone().add(rnd(0.3)), rnd(0.5).setY(0.8), 2, 0.4, 1.3, 0.7, -0.1, false);
        this.decal(p.clone().setY(heightAt(this.map, p.x, p.z) + 0.03), 0.9, 0x1a1410, 12);
        break;
      case 'obusz': // the X-04's shell: a big blast, a ring the size of its splash
        this.flash(p, color, 2.4);
        this.explosion(p, 0.9);
        this.ring(p.clone().setY(heightAt(this.map, p.x, p.z) + 0.1), color, BALANCE.weapons.canonx04.splash, 0.6);
        this.decal(p.clone().setY(heightAt(this.map, p.x, p.z) + 0.03), 1.4, 0x1a1410, 15);
        break;
      case 'roquette':
        this.flash(p, color, 1.6);
        for (let i = 0; i < 6; i++) this.spawn(this.tex.smoke, 0x8a827a, p.clone().add(rnd(0.2)), rnd(0.6), 1.2, 0.3, 1, 0.6, 0, false);
        break;
      case 'rocher':
        for (let i = 0; i < 10; i++) this.spawn(this.tex.smoke, 0x8a7a62, p.clone().add(rnd(0.3)), rnd(1.5).setY(0.8 + Math.random()), 1.2, 0.4, 1.1, 0.8, 1, false);
        break;
    }
    // Armes chimiques: a green cloud stays a moment where it lands.
    if (l.chem) this.cloud(p, 0x8aff4a, 10, 0.6, 0.2, 2, 0.6);
    return false;
  }

  /** Proposal stage only: the shots as they were, for the before pictures. */
  private oldShot(kind: string, from: Vector3, to: Vector3, dir: Vector3): void {
    if (kind === 'heal') {
      for (let i = 0; i < 4; i++) this.spawn(this.tex.glow, 0x7dff9a, to.clone().add(rnd(0.25)), new Vector3(0, 0.8 + Math.random() * 0.5, 0), 0.6, 0.12, 0.02, 0.9, 0, true);
      return;
    }
    if (kind === 'melee') {
      for (let i = 0; i < 7; i++) this.spawn(this.tex.glow, 0xffd27a, to.clone(), rnd(3).setY(1 + Math.random() * 2), 0.25, 0.08, 0.02, 1, 9, true);
      return;
    }
    const muzzle = from.clone().addScaledVector(dir.clone().normalize(), 0.35);
    this.spawn(this.tex.glow, 0xbfff8a, muzzle, new Vector3(), 0.07, 0.35, 0.15, 1, 0, true);
    this.spawn(this.tex.glow, 0x9cff6a, from.clone(), dir.clone().divideScalar(0.09), 0.09, 0.16, 0.16, 1, 0, true);
    this.spawn(this.tex.glow, 0xeaffb0, to.clone(), new Vector3(), 0.12, 0.15, 0.3, 0.9, 0, true);
  }

  private dust(p: Vector3, owner: number): void {
    for (let i = 0; i < 6; i++) {
      this.spawn(this.tex.smoke, 0x8a7a62, p.clone().add(rnd(0.2)), rnd(0.8).setY(0.3 + Math.random() * 0.4), 0.8, 0.3, 0.9, 0.7, 0, false);
    }
    // A splash of the fallen unit's colour.
    this.spawn(this.tex.glow, TEAM_COLORS[owner] ?? 0xffffff, p, new Vector3(0, 0.4, 0), 0.3, 0.2, 0.5, 0.8, 0, true);
  }

  private explosion(p: Vector3, size: number): void {
    for (let i = 0; i < 6 + size * 2; i++) {
      const at = p.clone().add(rnd(size * 0.35));
      at.y = p.y + Math.random() * size * 0.3;
      this.spawn(this.tex.glow, i % 2 ? 0xffa040 : 0xffe080, at, rnd(1.5).setY(1 + Math.random() * 1.5), 0.5 + Math.random() * 0.3, size * 0.25, size * 0.6, 1, 0, true);
    }
    for (let i = 0; i < 6 + size * 3; i++) {
      this.spawn(this.tex.smoke, 0x2c2622, p.clone().add(rnd(size * 0.4)), rnd(0.6).setY(0.8 + Math.random()), 2 + Math.random() * 1.5, size * 0.3, size * 0.9, 0.75, -0.1, false);
    }
    for (let i = 0; i < 8 + size * 3; i++) {
      const mesh = new Mesh(this.debrisGeo, this.debrisMat);
      mesh.position.copy(p).add(rnd(size * 0.3));
      mesh.scale.setScalar(0.6 + Math.random() * 1.6);
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.debris.push({ mesh, vel: rnd(4).setY(3 + Math.random() * 4), spin: rnd(8), age: 0 });
    }
  }

  /** A dark scorch mark on the ground that fades away. */
  private decal(p: Vector3, size: number, color: number, life: number): void {
    const mesh = new Mesh(this.decalGeo, new MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI;
    mesh.scale.set(size, size * (0.7 + Math.random() * 0.3), 1);
    mesh.position.copy(p);
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.decals.push({ mesh, age: 0, life });
  }

  /** Blue sparks where a jackhammer bites (mining, building); call every frame while it works. */
  sparks(p: Vector3, dt: number): void {
    if (Math.random() > dt * 16) return;
    for (let i = 0; i < 3; i++) {
      const v = rnd(2.6).setY(1.4 + Math.random() * 1.8);
      this.spawn(this.tex.glow, Math.random() < 0.5 ? 0x4fc8ff : 0xe0f6ff, p.clone().add(rnd(0.05)), v, 0.22 + Math.random() * 0.14, 0.11, 0.03, 1, 9, true);
    }
  }

  /** Light, steady smoke from a chimney or fire; call every frame. */
  ambient(p: Vector3, dt: number, dark: boolean): void {
    if (Math.random() < dt * 3) {
      this.spawn(this.tex.smoke, dark ? 0x3a3430 : 0xb8b0a4, p.clone().add(rnd(0.08)), new Vector3(0.25, 0.9, 0.1), 2.5, 0.15, 0.9, dark ? 0.45 : 0.3, 0, false);
    }
  }

  /**
   * A damaged building on fire; call every frame with its hp fraction. Below half its hp it smokes and burns
   * in one spot, more spots as it gets worse (fixed per building, from `seed`): layered flames (white-yellow
   * core, orange body, red tips), embers flying off, thick smoke rising from above the flames and drifting
   * with the wind, and a flickering glow on the ground.
   */
  burn(p: Vector3, hp: number, size: number, dt: number, seed = 0, isdaris = false): void {
    if (hp > 0.5) return;
    // Isdaris technology burns blue (plasma), with paler smoke.
    const c = isdaris ? FIRE.isdaris : FIRE.human;
    const spots = hp < 0.15 ? 3 : hp < 0.3 ? 2 : 1;
    const strength = Math.min(1, (0.5 - hp) * 3 + 0.35);
    for (let s = 0; s < spots; s++) {
      const a = ((seed * 2654435761 + s * 40503) % 1000) / 1000 * Math.PI * 2;
      const d = size * (0.12 + ((seed * 7 + s * 13) % 10) / 40);
      const at = p.clone().add(new Vector3(Math.cos(a) * d, ((seed + s * 3) % 5) * 0.08 * size, Math.sin(a) * d));
      // Flames: many short-lived licks rising fast, each layer smaller and hotter towards the base.
      // Flame sizes follow the building's: a Council burns bigger than a Grenier.
      const big = 0.5 + size * 0.22;
      if (Math.random() < dt * 40 * strength) {
        const w = rnd(0.12 * size);
        // Normal blending for the body and tips (additive washes out on bright sand), additive for the hot core.
        this.spawn(this.tex.flame, Math.random() < 0.5 ? c.body[0] : c.body[1], at.clone().add(w), new Vector3(0, 1.3 + Math.random() * 0.6, 0).add(rnd(0.25)), 0.6, big * (0.5 + 0.4 * strength), big * 0.15, 0.95, -0.6, false);
        this.spawn(this.tex.flame, c.core, at.clone().add(w).setY(at.y - 0.05), new Vector3(0, 1.0 + Math.random() * 0.5, 0), 0.35, big * (0.3 + 0.25 * strength), big * 0.08, 1, -0.4, true);
      }
      if (Math.random() < dt * 16 * strength) {
        this.spawn(this.tex.flame, c.tips, at.clone().add(rnd(0.15 * size)).setY(at.y + 0.3 * big), new Vector3(0, 1.6, 0).add(rnd(0.3)), 0.5, big * 0.35, big * 0.05, 0.85, -0.5, false);
      }
      // Embers: tiny sparks carried up and away by the heat.
      if (Math.random() < dt * 7 * strength) {
        this.spawn(this.tex.glow, Math.random() < 0.5 ? c.embers[0] : c.embers[1], at.clone().add(rnd(0.1)), rnd(0.7).setY(1.6 + Math.random() * 1.4), 1.2 + Math.random() * 0.8, 0.06, 0.02, 1, 0.15, true);
      }
      // Smoke: dark, thick, from above the flames, widening as it drifts downwind.
      if (Math.random() < dt * (4 + 6 * strength)) {
        const grey = Math.random() < 0.5 ? c.smoke[0] : c.smoke[1];
        this.spawn(this.tex.smoke, grey, at.clone().add(rnd(0.15)).setY(at.y + 0.5 + 0.5 * big), new Vector3(0.35 + Math.random() * 0.2, 0.9 + Math.random() * 0.5, 0.12), 3.2, 0.45, 1.8 + strength, 0.5 + 0.2 * strength, -0.05, false);
      }
      // A flickering warm glow where it burns.
      if (Math.random() < dt * 20) {
        this.spawn(this.tex.glow, c.glow, at.clone().setY(at.y - 0.1), new Vector3(), 0.12, size * 0.55 * strength * (0.8 + Math.random() * 0.4), size * 0.5 * strength, 0.22, 0, true);
      }
    }
  }

  /**
   * One frame of a Lance-flammes' jet: a cone of flame from its nozzle to its target (white-yellow core, orange body,
   * red tips, widening as they go), a flickering glow at the nozzle, a little dark smoke rising where it lands. Its
   * sprites share the flame and glow textures of the fires, so no new shader.
   */
  private flameJet(jet: { id: number; from: Vector3; to: Vector3; spill: number }, dt: number): void {
    const from = this.muzzle(jet.id) ?? jet.from;
    const dir = jet.to.clone().sub(from);
    const reach = Math.max(0.3, dir.length());
    dir.divideScalar(reach);
    const life = 0.35;
    const speed = reach / life;
    // Many at once share a budget: the flames thin out rather than overflow the particle pool.
    jet.spill += dt * FLAME_RATE * Math.min(1, 6 / this.jets.size);
    for (; jet.spill >= 1; jet.spill--) {
      // Born anywhere along the jet, as if already that far on its way: a continuous cone, not puffs from the nozzle.
      const u = Math.random();
      const at = from.clone().addScaledVector(dir, u * reach * 0.95).add(rnd(0.02 + 0.1 * u * reach));
      const v = dir.clone().multiplyScalar(speed).add(rnd(speed * 0.08));
      const left = life * (1 - u) + 0.06;
      const w = 0.12 + 0.3 * u * Math.min(reach, 2);
      const f = Math.random();
      // The hot core near the nozzle, the body orange, red at the tips.
      const color = u < 0.3 && f < 0.6 ? 0xfff0b0 : u < 0.75 ? (f < 0.5 ? 0xffb030 : 0xff7a14) : f < 0.5 ? 0xff6010 : 0xd83a10;
      this.spawn(f < 0.5 ? this.tex.glow : this.tex.flame, color, at, v, left, w, w * 1.4, 0.9, -0.6, true);
    }
    if (Math.random() < dt * 30) this.spawn(this.tex.glow, 0xff9a30, from.clone(), new Vector3(), 0.08, 0.3, 0.45, 1, 0, true);
    if (Math.random() < dt * 20) this.spawn(this.tex.glow, 0xff6a10, jet.to.clone().add(rnd(0.15)), new Vector3(0, 0.5, 0), 0.15, 0.3, 0.6, 0.8, 0, true);
    if (Math.random() < dt * 5) {
      this.spawn(this.tex.smoke, 0x2c2622, jet.to.clone().add(rnd(0.2)), rnd(0.2).setY(0.7 + Math.random() * 0.4), 1.2, 0.2, 0.7, 0.5, -0.1, false);
    }
  }

  private spawn(tex: Picture, color: number, pos: Vector3, vel: Vector3, life: number, size0: number, size1: number, alpha: number, gravity: number, additive: boolean): void {
    if (this.density < 1 && Math.random() > this.density) return; // render only: the simulation never sees it
    this.particles.spawn(MAX_PARTICLES * this.density, tex, color, pos, vel, life, size0, size1, alpha, gravity, additive);
  }

  /** A sprite that stays where it is drawn this frame only, at full opacity: laid out again every frame (never thinned
   * by the graphics level, or it would flicker). */
  private hold(tex: Picture, color: number, pos: Vector3, size: number, alpha: number, dt: number, additive: boolean): void {
    this.particles.spawn(MAX_PARTICLES, tex, color, pos, new Vector3(), dt * 1.5, size, size, alpha, 0, additive, true);
  }

  update(dt: number): void {
    for (const jet of this.jets.values()) {
      jet.left -= dt;
      if (jet.left <= 0) this.jets.delete(jet.id);
      else this.flameJet(jet, dt);
    }
    if (this.eye) this.particles.update(dt, this.eye);
    this.streaks.update(dt);
    this.lobs = this.lobs.filter((l) => this.flyLob(l, dt));
    this.hits = this.hits.filter((h) => {
      if ((h.left -= dt) > 0) return true;
      this.spawn(this.tex.glow, 0xffffff, h.at, new Vector3(), 0.1, 0.2, 0.45, 1, 0, true);
      this.spawn(this.tex.glow, h.color, h.at, new Vector3(), 0.22, 0.25, 0.7, 0.9, 0, true);
      for (let i = 0; i < 3; i++) this.spawn(this.tex.glow, h.color, h.at.clone(), rnd(2).setY(1 + Math.random()), 0.25, 0.1, 0.02, 1, 9, true);
      return false;
    });
    this.decals = this.decals.filter((d) => {
      d.age += dt;
      (d.mesh.material as MeshBasicMaterial).opacity = 0.6 * Math.min(1, (d.life - d.age) / (d.life * 0.3));
      if (d.age < d.life) return true;
      this.scene.remove(d.mesh);
      (d.mesh.material as MeshBasicMaterial).dispose();
      return false;
    });
    this.debris = this.debris.filter((d) => {
      d.age += dt;
      d.vel.y -= 12 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      const ground = heightAt(this.map, d.mesh.position.x, d.mesh.position.z);
      if (d.mesh.position.y < ground) {
        d.mesh.position.y = ground;
        d.vel.multiplyScalar(0.3);
        d.vel.y = Math.abs(d.vel.y) * 0.3;
      }
      if (d.age < 6) return true;
      this.scene.remove(d.mesh);
      return false;
    });
  }
}

function rnd(r: number): Vector3 {
  return new Vector3((Math.random() - 0.5) * 2 * r, (Math.random() - 0.5) * 2 * r, (Math.random() - 0.5) * 2 * r);
}
