import {
  BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, SphereGeometry,
  type Scene,
} from 'three';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import type { World } from '../sim/world';

const SHOT_TIME = 0.12;
const DEATH_TIME = 0.6;
const COLORS = { ranged: 0xffe08a, melee: 0xffffff, heal: 0x7dff9a };

interface Shot {
  line: LineSegments;
  age: number;
}

interface Puff {
  mesh: Mesh;
  age: number;
  size: number;
}

/** Short-lived visuals: shot tracers, heal beams and death puffs. Only what the player can see. */
export class Effects {
  private shots: Shot[] = [];
  private puffs: Puff[] = [];
  private readonly sphere = new SphereGeometry(0.5, 10, 8);

  constructor(private readonly scene: Scene, private readonly map: GameMap) {}

  /** Collects the effects of the tick that just ran. */
  collect(world: World, seen: (x: number, y: number) => boolean): void {
    for (const s of world.shots) {
      if (!seen(s.x1, s.y1) && !seen(s.x2, s.y2)) continue;
      const a = this.point(s.x1, s.y1, 0.45);
      const b = this.point(s.x2, s.y2, 0.45);
      if (s.kind === 'melee') {
        // A spark at the target.
        a.splice(0, 3, b[0] - 0.15, b[1] + 0.2, b[2]);
        b[0] += 0.15;
        b[1] -= 0.1;
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute([...a, ...b], 3));
      const line = new LineSegments(geo, new LineBasicMaterial({ color: COLORS[s.kind], transparent: true }));
      this.scene.add(line);
      this.shots.push({ line, age: 0 });
    }
    for (const d of world.deaths) {
      if (!seen(d.x, d.y)) continue;
      const big = d.type in BUILDING_SIZES;
      const mesh = new Mesh(this.sphere, new MeshBasicMaterial({ color: big ? 0x6b5a48 : 0x5a1010, transparent: true, opacity: 0.8 }));
      const [x, y, z] = this.point(d.x, d.y, 0.3);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      this.puffs.push({ mesh, age: 0, size: big ? BUILDING_SIZES[d.type] : 0.8 });
    }
  }

  update(dt: number): void {
    this.shots = this.shots.filter((s) => {
      s.age += dt;
      (s.line.material as LineBasicMaterial).opacity = 1 - s.age / SHOT_TIME;
      if (s.age < SHOT_TIME) return true;
      this.scene.remove(s.line);
      s.line.geometry.dispose();
      (s.line.material as LineBasicMaterial).dispose();
      return false;
    });
    this.puffs = this.puffs.filter((p) => {
      p.age += dt;
      const f = p.age / DEATH_TIME;
      p.mesh.scale.setScalar(p.size * (0.4 + f));
      (p.mesh.material as MeshBasicMaterial).opacity = 0.8 * (1 - f);
      if (f < 1) return true;
      this.scene.remove(p.mesh);
      (p.mesh.material as MeshBasicMaterial).dispose();
      return false;
    });
  }

  private point(x: number, y: number, lift: number): number[] {
    const wx = x / FP;
    const wz = y / FP;
    return [wx, heightAt(this.map, wx, wz) + lift, wz];
  }
}

const BUILDING_SIZES: Record<string, number> = { conseil: 5, caserne: 3, grenier: 2, mine: 3 };
