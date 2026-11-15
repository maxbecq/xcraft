import {
  AdditiveBlending, BoxGeometry, CanvasTexture, CircleGeometry, Color, Mesh, MeshBasicMaterial, MeshStandardMaterial, NormalBlending,
  type Scene, Sprite,
  SpriteMaterial, type Texture, Vector3,
} from 'three';
import type { Audio } from '../audio';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import type { Shot, World } from '../sim/world';

const MAX_PARTICLES = 600;
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
  };
  private readonly debrisGeo = new BoxGeometry(0.12, 0.12, 0.12);
  private readonly debrisMat = new MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.9 });

  /** Sprites go to `fx` (drawn after ambient occlusion); debris, which casts shadows, to the main scene. */
  constructor(private readonly fx: Scene, private readonly scene: Scene, private readonly map: GameMap, private readonly audio: Audio) {}

  /** Collects the effects of the tick that just ran. */
  collect(world: World, seen: (x: number, y: number) => boolean): void {
    for (const s of world.shots) {
      if (!seen(s.x1, s.y1) && !seen(s.x2, s.y2)) continue;
      this.audio.play(s.kind, 0.6);
      this.shot(s);
    }
    for (const d of world.deaths) {
      if (!seen(d.x, d.y)) continue;
      const size = BUILDING_SIZES[d.type];
      this.audio.play('death', size ? 1.5 : 0.7);
      if (size) {
        this.explosion(this.at(d.x, d.y, 0.5), size);
        this.decal(this.at(d.x, d.y, 0.04), size * 1.1, 0x1a1410, 40);
      } else if (d.type !== 'minerai') {
        this.dust(this.at(d.x, d.y, 0.3), d.owner);
        this.decal(this.at(d.x, d.y, 0.03), 0.8, 0x2a1a12, 15);
      }
    }
  }

  private at(x: number, y: number, lift: number): Vector3 {
    const wx = x / FP;
    const wz = y / FP;
    return new Vector3(wx, heightAt(this.map, wx, wz) + lift, wz);
  }

  private shot(s: Shot): void {
    const from = this.at(s.x1, s.y1, 0.55);
    const to = this.at(s.x2, s.y2, 0.5);
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
    this.spawn(this.tex.glow, owner === 0 ? 0x3a7bd5 : 0xc8402f, p, new Vector3(0, 0.4, 0), 0.3, 0.2, 0.5, 0.8, 0, true);
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

  /** Smoke (and fire when badly hurt) rising from a damaged building; call every frame with its hp fraction. */
  burn(p: Vector3, hp: number, size: number, dt: number): void {
    if (hp > 0.5) return;
    if (Math.random() < dt * (hp < 0.25 ? 10 : 5)) {
      this.spawn(this.tex.smoke, 0x3a3430, p.clone().add(rnd(size * 0.3)), new Vector3(0.3, 1.2, 0.1), 2.2, 0.3, 1.4, 0.55, 0, false);
    }
    if (hp < 0.25 && Math.random() < dt * 14) {
      this.spawn(this.tex.glow, 0xff8a30, p.clone().add(rnd(size * 0.3)), new Vector3(0, 1.4, 0), 0.5, 0.35, 0.1, 0.9, 0, true);
    }
  }

  private spawn(tex: Texture, color: number, pos: Vector3, vel: Vector3, life: number, size0: number, size1: number, alpha: number, gravity: number, additive: boolean): void {
    let p = this.pool.find((q) => !q.active);
    if (!p) {
      if (this.pool.length >= MAX_PARTICLES) return;
      // No depth test: the post pass does not keep scene depth. Effects are short-lived and drawn over the scene.
      const sprite = new Sprite(new SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
      this.fx.add(sprite);
      p = { sprite, vel: new Vector3(), age: 0, life: 0, size0: 0, size1: 0, alpha: 0, gravity: 0, active: false };
      this.pool.push(p);
    }
    const m = p.sprite.material;
    m.map = tex;
    m.color = new Color(color);
    m.blending = additive ? AdditiveBlending : NormalBlending;
    m.needsUpdate = true;
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
