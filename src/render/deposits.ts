import { CanvasTexture, Color, type Material, Mesh, MeshStandardMaterial, PlaneGeometry, type Scene, SRGBColorSpace, type Texture } from 'three';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import type { World } from '../sim/world';

/**
 * Ground under resources: a dark, cracked stain with glowing veins, so a mineral line reads as an
 * outcrop of ore and a well as a scorched fissure field. Rendering only.
 */
export function addDeposits(scene: Scene, map: GameMap, world: World, fog: (m: Material) => void): void {
  const mineral = deposit('#1a2a3a', '#3fbfff', 11);
  const well = deposit('#24162e', '#c070ff', 23);
  const geo = new PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  for (const e of world.entities.values()) {
    if (e.type !== 'minerai' && e.type !== 'puits') continue;
    const [maps, color] = e.type === 'minerai' ? [mineral, 0x2aa8ff] : [well, 0xb060ff];
    const m = new MeshStandardMaterial({
      map: maps[0], emissiveMap: maps[1], emissive: new Color(color), emissiveIntensity: 1.6,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, roughness: 1,
    });
    fog(m);
    const mesh = new Mesh(geo, m);
    const size = e.type === 'minerai' ? 3.2 : 6;
    const x = e.x / FP;
    const z = e.y / FP;
    mesh.scale.set(size, 1, size);
    mesh.rotation.y = (e.id * 1.7) % (Math.PI * 2);
    mesh.position.set(x, heightAt(map, x, z) + 0.02, z);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    scene.add(mesh);
  }
}

/** [stain colour with soft ragged edges, glowing cracks] canvases. */
function deposit(stain: string, glow: string, seed: number): [Texture, Texture] {
  const size = 256;
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const base = document.createElement('canvas');
  const cracks = document.createElement('canvas');
  base.width = base.height = cracks.width = cracks.height = size;
  const b = base.getContext('2d')!;
  // Ragged stain: overlapping soft blobs, denser towards the middle.
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.pow(r(), 0.7) * size * 0.32;
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d;
    const rad = size * (0.05 + r() * 0.12);
    const g = b.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, stain + 'b0');
    g.addColorStop(1, stain + '00');
    b.fillStyle = g;
    b.fillRect(0, 0, size, size);
  }
  // Rock chips.
  for (let i = 0; i < 120; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * size * 0.38;
    b.fillStyle = `rgba(${r() < 0.5 ? '20,18,16' : '120,110,100'},${0.3 + r() * 0.4})`;
    b.fillRect(size / 2 + Math.cos(a) * d, size / 2 + Math.sin(a) * d, 1 + r() * 3, 1 + r() * 3);
  }
  // Branching cracks from the middle outwards: drawn dark on the stain, glowing in the emissive map.
  const c = cracks.getContext('2d')!;
  c.fillStyle = '#000';
  c.fillRect(0, 0, size, size);
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    let px = x;
    let py = y;
    for (let k = 0; k < 6; k++) {
      a += (r() - 0.5) * 0.9;
      const nx = px + Math.cos(a) * len / 6;
      const ny = py + Math.sin(a) * len / 6;
      for (const [ctx, col, extra] of [[b, 'rgba(10,8,8,0.8)', 2], [c, glow, 0]] as const) {
        ctx.strokeStyle = col;
        ctx.lineWidth = w + extra;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(nx, ny);
        ctx.stroke();
      }
      px = nx;
      py = ny;
      if (depth > 0 && r() < 0.3) branch(px, py, a + (r() - 0.5) * 2, len * 0.5, w * 0.6, depth - 1);
    }
  };
  for (let i = 0; i < 7; i++) branch(size / 2 + (r() - 0.5) * 30, size / 2 + (r() - 0.5) * 30, r() * Math.PI * 2, size * (0.25 + r() * 0.15), 2.5, 2);
  // Fade the glow towards the rim.
  const fade = c.createRadialGradient(size / 2, size / 2, size * 0.15, size / 2, size / 2, size * 0.48);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  c.fillStyle = fade;
  c.fillRect(0, 0, size, size);
  const tex = (cv: HTMLCanvasElement) => {
    const t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    return t;
  };
  return [tex(base), tex(cracks)];
}
