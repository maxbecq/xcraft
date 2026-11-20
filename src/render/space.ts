import {
  AdditiveBlending, type Blending, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, NormalBlending, PlaneGeometry, Quaternion, Sprite, SpriteMaterial, Vector3,
} from 'three';
import { isoOffset } from '../camera';
import { picture } from './textures';

/**
 * Space under the Astéroïdes planet, seen through the chasms and past the map's edges: painted stars and nebulae, a painted gas giant and
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

    // Painted stars (recherches-visuelles/asteroides-espace, seamless): a wide sheet far down, nearly still, one picture
    // over about a screen so the stars stay fine points.
    const sheet = (name: string, repeat: number, depth: number, blending: Blending) => {
      const m = new Mesh(new PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: picture(name, true, repeat), depthWrite: false, fog: false, blending, transparent: blending !== NormalBlending }));
      m.position.copy(under(cx, cz, depth));
      return m;
    };
    const stars = sheet('espace-etoiles', 40, 400, NormalBlending);
    stars.renderOrder = -3;
    this.layer([stars], 0.96);
    // Faint painted nebulae over them, nearer, so they slide by a little faster than the stars.
    const nebula = sheet('espace-nebuleuse', 10, 330, AdditiveBlending);
    nebula.renderOrder = -2;
    this.layer([nebula], 0.92);

    // The painted gas giant, far down beyond the map's north corner (the top of the screen), always facing the view.
    const giant = new Sprite(new SpriteMaterial({ map: picture('espace-geante', true, 1, 'png'), depthWrite: false, fog: false }));
    giant.scale.set(26, 26, 1);
    giant.position.copy(under(-28, -28, 260)); // follows the camera almost wholly: always up the view, beyond the map's far side
    giant.renderOrder = -1;
    this.layer([giant], 0.97);

    // Smaller asteroids, three depths: the nearer, the bigger (the camera is orthographic: size is all the distance
    // there is) and the faster they slide by.
    const rock = new MeshStandardMaterial({ color: 0x2a2724, roughness: 1, flatShading: true });
    let seed = 4242;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const [depth, count, size, follow] of [[14, 30, 1.6, 0.35], [40, 40, 0.9, 0.6], [110, 60, 0.5, 0.82]] as const) {
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

  private layer(objects: (Mesh | InstancedMesh | Sprite)[], follow: number): void {
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
