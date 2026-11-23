/**
 * A building ordered: shown at once where it will rise, before its worker gets there (remark 91, touch screens). A
 * prototype of four looks to choose from, by the URL: ?pose=eclair (a flash over the footprint), fantome (its outline,
 * kept until the site starts), onde (rings spreading out), icone (a badge rising, with a sound). None by default.
 */
import {
  AdditiveBlending, BoxGeometry, CanvasTexture, EdgesGeometry, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial,
  type Object3D, RingGeometry, type Scene, Sprite, SpriteMaterial,
} from 'three';
import type { Audio } from '../audio';
import { type BuildingDef, DEFS } from '../data';
import { type GameMap, heightAt } from '../map';
import type { Entity, World } from '../sim/world';
import { params } from './config';

const LOOKS = ['eclair', 'fantome', 'onde', 'icone'] as const;
type Look = (typeof LOOKS)[number];
const LOOK = LOOKS.find((l) => l === params.get('pose')) ?? null;

interface Shown {
  obj: Object3D;
  t0: number;
  /** For the outline: the site it stands for, and the worker going there. */
  type: string;
  tx: number;
  ty: number;
  worker: number;
  /** When it began fading (the site started, or the order dropped), or -1. */
  gone: number;
  /** The worker was seen with the order (it reaches the simulation a tick or more after the tap). */
  seen: boolean;
}

const GREEN = 0x7dffa0;

/** The badge: a round green seal with a hammer's head and handle, drawn once. */
function badge(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(10, 40, 20, 0.85)';
  g.strokeStyle = '#7dffa0';
  g.lineWidth = 8;
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.translate(64, 64);
  g.rotate(-Math.PI / 4);
  g.fillStyle = '#e8fff0';
  g.fillRect(-5, -10, 10, 42); // handle
  g.fillRect(-22, -26, 44, 18); // head
  return new CanvasTexture(c);
}

export class PoseConfirm {
  private readonly shown: Shown[] = [];
  private tex: CanvasTexture | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly map: GameMap,
    private readonly audio: Audio,
    readonly look: Look | null = LOOK,
  ) {}

  /** The order to raise `type` at (tx, ty) was just given to `worker`. */
  placed(type: string, tx: number, ty: number, worker: number): void {
    if (!this.look) return;
    const size = (DEFS[type] as BuildingDef).size;
    const cx = tx + size / 2;
    const cz = ty + size / 2;
    const y = heightAt(this.map, cx, cz);
    const at = (o: Object3D, dy = 0) => {
      o.position.set(cx, y + dy, cz);
      this.scene.add(o);
      this.shown.push({ obj: o, t0: performance.now(), type, tx, ty, worker, gone: -1, seen: false });
    };
    if (this.look === 'eclair') {
      const m = new Mesh(new BoxGeometry(size, 1, size), new MeshBasicMaterial({ color: 0xeaffef, transparent: true, blending: AdditiveBlending, depthWrite: false }));
      at(m, 0.5);
    } else if (this.look === 'fantome') {
      const h = Math.max(0.8, size * 0.45);
      const box = new BoxGeometry(size, h, size);
      const lines = new LineSegments(new EdgesGeometry(box), new LineBasicMaterial({ color: GREEN, transparent: true, depthWrite: false }));
      lines.add(new Mesh(box, new MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.12, depthWrite: false })));
      at(lines, h / 2 + 0.02);
    } else if (this.look === 'onde') {
      for (let i = 0; i < 3; i++) {
        const r = new Mesh(new RingGeometry(0.86, 1, 48), new MeshBasicMaterial({ color: GREEN, transparent: true, blending: AdditiveBlending, depthWrite: false }));
        r.rotation.x = -Math.PI / 2;
        r.userData.delay = i * 140;
        r.userData.size = size;
        at(r, 0.2);
      }
    } else {
      this.tex ??= badge();
      const s = new Sprite(new SpriteMaterial({ map: this.tex, transparent: true, depthTest: false }));
      at(s, 1);
      this.audio.play('pose');
    }
  }

  /** Each frame: ages what is shown, and drops what is over. */
  update(world: World): void {
    const now = performance.now();
    for (let i = this.shown.length - 1; i >= 0; i--) {
      const s = this.shown[i];
      const t = now - s.t0;
      if (!this.step(s, t, now, world)) {
        this.scene.remove(s.obj);
        s.obj.traverse((o) => {
          (o as Mesh).geometry?.dispose();
          ((o as Mesh).material as MeshBasicMaterial | undefined)?.dispose();
        });
        this.shown.splice(i, 1);
      }
    }
  }

  /** Moves one along; false once it is over. */
  private step(s: Shown, t: number, now: number, world: World): boolean {
    const mat = (o: Object3D) => (o as Mesh).material as MeshBasicMaterial;
    if (this.look === 'eclair') {
      // A white flash at once, fading out in under half a second as it settles to the ground.
      const k = t / 700;
      mat(s.obj).opacity = 0.85 * (1 - k) ** 2;
      s.obj.scale.y = 1 - 0.7 * k;
      return k < 1;
    }
    if (this.look === 'onde') {
      const k = (t - s.obj.userData.delay) / 700;
      const r = (s.obj.userData.size as number) * (0.5 + 1.1 * Math.max(0, k));
      s.obj.scale.set(r, r, r);
      mat(s.obj).opacity = k < 0 ? 0 : 0.9 * (1 - k);
      return k < 1;
    }
    if (this.look === 'icone') {
      // Pops up, rises a little and fades: a second and a half.
      const k = t / 1500;
      const pop = Math.min(1, t / 120);
      s.obj.scale.setScalar(1.4 * pop * (1 + 0.25 * Math.max(0, 1 - t / 240)));
      s.obj.position.y += 0.012;
      mat(s.obj).opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      return k < 1;
    }
    // The outline: breathes until the site stands there or the worker no longer goes, then fades in a quarter second.
    const on = going(world, s);
    s.seen ||= on;
    if (s.gone < 0 && (started(world, s) || (s.seen ? !on : t > 3000) || t > 120_000)) s.gone = now;
    const fade = s.gone < 0 ? 1 : 1 - (now - s.gone) / 250;
    const a = (0.55 + 0.3 * Math.sin(t / 180)) * Math.max(0, fade) * Math.min(1, t / 100);
    mat(s.obj).opacity = a;
    mat(s.obj.children[0]).opacity = a * 0.25;
    return fade > 0;
  }
}

/** A building of that type stands at that spot. */
function started(world: World, s: Shown): boolean {
  for (const e of world.entities.values()) if (e.type === s.type && e.tx === s.tx && e.ty === s.ty && e.def.kind === 'building') return true;
  return false;
}

/** Its worker still has that build to do, now or later. */
function going(world: World, s: Shown): boolean {
  const w: Entity | undefined = world.entities.get(s.worker);
  if (!w || w.hp <= 0) return false;
  return [w.order, ...w.next].some((o) => o?.kind === 'build' && o.type === s.type && o.tx === s.tx && o.ty === s.ty);
}
