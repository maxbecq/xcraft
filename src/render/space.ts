import {
  CanvasTexture, Color, DynamicDrawUsage, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, Quaternion, RepeatWrapping, SRGBColorSpace, SphereGeometry, Vector3,
} from 'three';
import { isoOffset } from '../camera';

/**
 * Space under the Astéroïdes planet, seen through the chasms and past the map's edges: stars, a banded gas giant and
 * smaller asteroids drifting at several depths. The camera is orthographic, so depth gives no parallax by itself: each
 * layer follows the camera by part of its moves (`update`), the deepest the most, and so seems to slide by slower.
 * Rendering only.
 */
export class Space {
  readonly root = new Group();
  private readonly layers: { group: Group; follow: number }[] = [];

  constructor(width: number, height: number) {
    this.root.userData.noPick = true;
    // A point at depth `d` shows on screen where the ground point straight up the view line is: shift it back along it.
    const view = isoOffset(1);
    const under = (x: number, z: number, d: number) => new Vector3(x - (view.x / view.y) * d, -d, z - (view.z / view.y) * d);
    const [cx, cz] = [width / 2, height / 2];

    // Stars: a wide sheet far down, nearly still.
    const stars = new Mesh(new PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: starTexture(), depthWrite: false, fog: false }));
    stars.material.map!.repeat.set(10, 10);
    stars.position.copy(under(cx, cz, 400));
    stars.renderOrder = -2;
    this.layer([stars], 0.96);

    // The gas giant, far down beyond the map's north corner (the top of the screen).
    const giant = new Mesh(new SphereGeometry(22, 48, 32), new MeshStandardMaterial({ map: giantTexture(), roughness: 1, emissive: new Color(0x3a2a18), emissiveIntensity: 0.6 }));
    giant.position.copy(under(-28, -28, 260)); // follows the camera almost wholly: always up the view, beyond the map's far side
    giant.rotation.set(0.35, 0.8, 0.25);
    this.layer([giant], 0.97);

    // Smaller asteroids, three depths: the nearer, the bigger on screen and the faster they slide by.
    const rock = new MeshStandardMaterial({ color: 0x6a5e52, roughness: 1, flatShading: true });
    let seed = 4242;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const [depth, count, size, follow] of [[14, 40, 1.2, 0.35], [40, 34, 2.6, 0.6], [110, 26, 6, 0.82]] as const) {
      const geo = new IcosahedronGeometry(1, 1);
      // Lumpy: each corner pushed in or out by its direction (corners shared by faces move together, no cracks).
      const pos = geo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
        const h = Math.sin(x * 12.9 + y * 78.2 + z * 37.7 + depth) * 43758.5;
        const k = 0.75 + (h - Math.floor(h)) * 0.45;
        pos.setXYZ(i, x * k, y * k * 0.8, z * k);
      }
      geo.computeVertexNormals();
      const mesh = new InstancedMesh(geo, rock, count);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      const m = new Matrix4();
      const q = new Quaternion();
      for (let i = 0; i < count; i++) {
        const s = size * (0.5 + rand());
        q.setFromAxisAngle(new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(), rand() * Math.PI * 2);
        m.compose(under(-40 + rand() * (width + 80), -40 + rand() * (height + 80), depth + (rand() - 0.5) * depth * 0.3), q, new Vector3(s, s * (0.6 + rand() * 0.4), s));
        mesh.setMatrixAt(i, m);
      }
      this.layer([mesh], follow);
    }
  }

  private layer(objects: (Mesh | InstancedMesh)[], follow: number): void {
    const group = new Group();
    group.add(...objects);
    this.root.add(group);
    this.layers.push({ group, follow });
  }

  /** Each frame, with the point the camera looks at: the layers follow it by their share. */
  update(target: Vector3): void {
    for (const { group, follow } of this.layers) group.position.set(target.x * follow, 0, target.z * follow);
  }
}

/** Black space with stars of a few sizes and tints, a faint band of milky light. */
function starTexture(): CanvasTexture {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#020207';
  g.fillRect(0, 0, size, size);
  let seed = 99;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 30; i++) {
    const x = rand() * size;
    const y = size * 0.3 + Math.sin(x / size * Math.PI * 2) * 60 + (rand() - 0.5) * 120;
    const glow = g.createRadialGradient(x, y, 0, x, y, 120);
    glow.addColorStop(0, 'rgba(90,80,150,0.08)');
    glow.addColorStop(1, 'rgba(90,80,150,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, size, size);
  }
  const tints = ['#ffffff', '#cfe0ff', '#ffe6c8', '#bcd0ff'];
  for (let i = 0; i < 2600; i++) {
    const r = rand() < 0.97 ? 0.5 + rand() * 0.7 : 1.2 + rand() * 1.3;
    g.globalAlpha = 0.35 + rand() * 0.65;
    g.fillStyle = tints[Math.floor(rand() * tints.length)];
    g.beginPath();
    g.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Bands of cream, ochre and rust, wavy, with a storm eye. */
function giantTexture(): CanvasTexture {
  const [w, h] = [1024, 512];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const colours = ['#e8d8b8', '#c89a62', '#a0663a', '#ead7ae', '#b07a48', '#d8b888', '#8a5434', '#e2cca0'];
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < h; y++) {
    const band = Math.floor((y / h) * 18 + Math.sin(y * 0.05) * 0.6);
    g.fillStyle = colours[band % colours.length];
    g.fillRect(0, y, w, 1);
  }
  // Wavy turbulence along the bands.
  for (let i = 0; i < 900; i++) {
    const y = rand() * h;
    g.globalAlpha = 0.12;
    g.fillStyle = colours[Math.floor(rand() * colours.length)];
    g.beginPath();
    g.ellipse(rand() * w, y, 20 + rand() * 80, 2 + rand() * 4, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 0.85;
  g.fillStyle = '#b4583a';
  g.beginPath();
  g.ellipse(w * 0.62, h * 0.64, 46, 22, 0, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 0.6;
  g.fillStyle = '#e0a070';
  g.beginPath();
  g.ellipse(w * 0.62, h * 0.64, 26, 11, 0, 0, Math.PI * 2);
  g.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
