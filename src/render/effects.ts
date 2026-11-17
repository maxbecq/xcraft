import { TEAM_COLORS } from './units';
import {
  AdditiveBlending, BoxGeometry, CanvasTexture, CircleGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, NormalBlending,
  type Scene, Sprite,
  SpriteMaterial, type Texture, Vector3,
} from 'three';
import type { Audio, Sfx } from '../audio';
import { DEFS, FLY_HEIGHT } from '../data';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import type { Shot, World } from '../sim/world';

const MAX_PARTICLES = 1200;
const BUILDING_SIZES: Record<string, number> = { conseil: 5, caserne: 3, grenier: 2, mine: 3 };

/** Soft round sprite textures, drawn once. */
function blob(inner: string, outer: string, size = 64, noisy = false): Texture {
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
  return new CanvasTexture(c);
}

/** Fire colours: Human scrap burns orange with black smoke, Isdaris plasma blue with pale smoke. */
const FIRE = {
  human: { body: [0xff6a10, 0xff8c1a], core: 0xffd27a, tips: 0xc8261a, embers: [0xffb347, 0xff7a2a], smoke: [0x2a2522, 0x3d3631], glow: 0xff6a1f },
  isdaris: { body: [0x2a7cff, 0x4fa8ff], core: 0xd8f4ff, tips: 0x6a40ff, embers: [0x9fdcff, 0x5ab8ff], smoke: [0x4a5260, 0x5d6573], glow: 0x3f8cff },
};

/** A tongue of flame: bright at the bottom, tapering upwards, soft edged. */
function flame(size = 64): Texture {
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
  return new CanvasTexture(c);
}

interface Particle {
  sprite: Sprite;
  vel: Vector3;
  age: number;
  life: number;
  size0: number;
  size1: number;
  alpha: number;
  gravity: number;
  active: boolean;
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
  private readonly pool: Particle[] = [];
  private debris: Debris[] = [];
  private decals: Decal[] = [];
  private readonly decalGeo = new CircleGeometry(0.5, 20);
  private readonly tex = {
    glow: blob('rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
    smoke: blob('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)', 64, true),
    flame: flame(),
  };
  private readonly debrisGeo = new BoxGeometry(0.12, 0.12, 0.12);
  private readonly debrisMat = new MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.9 });

  /** Share of particles spawned (src/quality.ts): fewer, each a draw call, on low-end graphics. */
  density = 1;

  /** Sprites go to `fx` (drawn after ambient occlusion); debris, which casts shadows, to the main scene. */
  constructor(private readonly fx: Scene, private readonly scene: Scene, private readonly map: GameMap, private readonly audio: Audio) {}

  /** Collects the effects of the tick that just ran. */
  collect(world: World, seen: (x: number, y: number) => boolean): void {
    for (const s of world.shots) {
      if (!seen(s.x1, s.y1) && !seen(s.x2, s.y2)) continue;
      // Isdaris shoot light; the Orbe throws plasma.
      const faction = s.type && (DEFS[s.type] as { faction?: string } | undefined)?.faction;
      this.audio.play(s.type === 'orbe' ? 'plasma' : s.kind === 'ranged' && faction === 'isdaris' ? 'ray' : s.kind, 0.6);
      this.shot(s);
    }
    for (const c of world.casts) {
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

  private shot(s: Shot): void {
    const from = this.at(s.x1, s.y1, 0.55 + (s.air1 ? FLY_HEIGHT : 0));
    const to = this.at(s.x2, s.y2, 0.5 + (s.air2 ? FLY_HEIGHT : 0));
    const dir = to.clone().sub(from);
    if (s.kind === 'heal') {
      for (let i = 0; i < 4; i++) {
        this.spawn(this.tex.glow, 0x7dff9a, to.clone().add(rnd(0.25)), new Vector3(0, 0.8 + Math.random() * 0.5, 0), 0.6, 0.12, 0.02, 0.9, 0, true);
      }
      return;
    }
    if (s.kind === 'melee') {
      for (let i = 0; i < 7; i++) {
        this.spawn(this.tex.glow, 0xffd27a, to.clone(), rnd(3).setY(1 + Math.random() * 2), 0.25, 0.08, 0.02, 1, 9, true);
      }
      return;
    }
    // Ranged: muzzle flash, a fast glowing round, and a spark where it lands.
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

  private spawn(tex: Texture, color: number, pos: Vector3, vel: Vector3, life: number, size0: number, size1: number, alpha: number, gravity: number, additive: boolean): void {
    if (this.density < 1 && Math.random() > this.density) return; // render only: the simulation never sees it
    let p = this.pool.find((q) => !q.active);
    if (!p) {
      if (this.pool.length >= MAX_PARTICLES * this.density) return;
      // No depth test: the post pass does not keep scene depth. Effects are short-lived and drawn over the scene.
      const sprite = new Sprite(new SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
      this.fx.add(sprite);
      p = { sprite, vel: new Vector3(), age: 0, life: 0, size0: 0, size1: 0, alpha: 0, gravity: 0, active: false };
      this.pool.push(p);
    }
    const m = p.sprite.material;
    // Only a sprite's first texture changes its shader; swapping textures, colour or blending needs no recompile check.
    if (!m.map) m.needsUpdate = true;
    m.map = tex;
    m.color.set(color);
    m.blending = additive ? AdditiveBlending : NormalBlending;
    p.sprite.position.copy(pos);
    p.sprite.visible = true;
    p.vel.copy(vel);
    Object.assign(p, { age: 0, life, size0, size1, alpha, gravity, active: true });
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.age += dt;
      const f = p.age / p.life;
      if (f >= 1) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(p.size0 + (p.size1 - p.size0) * f);
      p.sprite.material.opacity = p.alpha * (1 - f) * Math.min(1, f * 8 + 0.3);
    }
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
