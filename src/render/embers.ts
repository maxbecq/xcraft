import { AdditiveBlending, BufferGeometry, type DataTexture, Float32BufferAttribute, Group, NormalBlending, Points, ShaderMaterial, Vector2 } from 'three';
import { type GameMap, LEVEL_HEIGHT, heightAt } from '../map';

/**
 * The volcano's air: embers rising from the lava in the chasms, and slow smoke from the lava and from vents in the
 * ground. Points animated on the graphics card from the clock (nothing per frame on the CPU but the clock), dimmed
 * by the fog of war like the ground. Rendering only.
 */
export class Embers {
  readonly root = new Group();
  private readonly time = { value: 0 };
  private readonly scale = { value: 1 };

  constructor(map: GameMap, fog: DataTexture, lavaDepth: number, count: number) {
    this.root.userData.noPick = true;
    let seed = 1234;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const lava: [number, number][] = [];
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.chasm?.[y * map.width + x]) lava.push([x, y]);
    const lavaY = -lavaDepth * LEVEL_HEIGHT;
    // Vents: smoke also rises from bare ground here and there (all of it when there is no lava on the map).
    const at = (fromLava: boolean): [number, number, number] => {
      if (fromLava && lava.length) {
        const [x, y] = lava[Math.floor(rand() * lava.length)];
        return [x + rand(), lavaY, y + rand()];
      }
      const [x, z] = [2 + rand() * (map.width - 4), 2 + rand() * (map.height - 4)];
      return [x, heightAt(map, x, z), z];
    };
    const uniforms = { time: this.time, scale: this.scale, fogMap: { value: fog }, mapSize: { value: new Vector2(map.width, map.height) } };
    if (lava.length) {
      this.root.add(points(count, () => at(true), rand, {
        uniforms, blending: AdditiveBlending,
        // Embers: quick, a few metres up, a wobble, from yellow to dark red, a few pixels wide.
        motion: 'float t = fract(time * (0.25 + seed * 0.2) + seed * 7.0); p += vec3(sin(seed * 40.0 + time * 2.0) * 0.5 * t, t * 4.5, cos(seed * 23.0 + time * 1.7) * 0.5 * t);',
        size: '0.09 * (1.0 - t * 0.6)',
        colour: 'mix(vec3(1.0, 0.85, 0.35), vec3(0.9, 0.2, 0.02), t) * (1.0 - t)',
        alpha: '1.0',
      }));
    }
    this.root.add(points(Math.ceil(count / 6), () => at(rand() < 0.6), rand, {
      uniforms, blending: NormalBlending,
      // Smoke: slow, high, widening, grey, faint.
      motion: 'float t = fract(time * (0.05 + seed * 0.03) + seed * 5.0); p += vec3(t * 1.5, t * 7.0, t * 0.8);',
      size: '(0.8 + t * 2.6)',
      colour: 'vec3(0.16, 0.14, 0.13)',
      alpha: '0.3 * sin(t * 3.14159)',
    }));
  }

  /** Each frame: seconds elapsed, and screen pixels to a world unit (points are sized in world units). */
  update(dt: number, pixelsPerUnit: number): void {
    this.time.value += dt;
    this.scale.value = pixelsPerUnit;
  }
}

function points(
  count: number, at: () => [number, number, number], rand: () => number,
  o: { uniforms: Record<string, { value: unknown }>; blending: typeof AdditiveBlending | typeof NormalBlending; motion: string; size: string; colour: string; alpha: string },
): Points {
  const pos: number[] = [];
  const seeds: number[] = [];
  for (let i = 0; i < count; i++) {
    pos.push(...at());
    seeds.push(rand());
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('seed', new Float32BufferAttribute(seeds, 1));
  const m = new ShaderMaterial({
    uniforms: o.uniforms,
    transparent: true,
    depthWrite: false,
    blending: o.blending,
    vertexShader: `
      attribute float seed;
      uniform float time, scale;
      uniform sampler2D fogMap;
      uniform vec2 mapSize;
      varying vec3 vColour;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        ${o.motion}
        float seen = texture2D(fogMap, p.xz / mapSize).r;
        vColour = ${o.colour} * (seen > 0.9 ? 1.0 : 0.4);
        vAlpha = (${o.alpha}) * smoothstep(0.3, 0.6, seen);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = ${o.size} * scale;
      }`,
    fragmentShader: `
      varying vec3 vColour;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(vColour, vAlpha * (1.0 - smoothstep(0.4, 1.0, d)));
      }`,
  });
  const p = new Points(g, m);
  p.frustumCulled = false;
  return p;
}
