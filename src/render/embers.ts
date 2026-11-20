import { AdditiveBlending, BufferGeometry, type DataTexture, Float32BufferAttribute, Group, NormalBlending, Points, ShaderMaterial, Vector2 } from 'three';
import { type GameMap, LEVEL_HEIGHT, heightAt } from '../map';

/**
 * The volcano's air: embers rising from the lava in the chasms, and slow smoke from the lava and from vents in the
 * ground. Points animated on the graphics card from the clock (nothing per frame on the CPU but the clock), dimmed
 * by the fog of war like the ground. Rendering only. With `bubbles`, now and then a bright dome swells on the lava
 * and bursts, throwing a few embers: at most BUBBLES at a time.
 */
export class Embers {
  readonly root = new Group();
  private readonly time = { value: 0 };
  private readonly scale = { value: 1 };

  constructor(map: GameMap, fog: DataTexture, lavaDepth: number, count: number, bubbles = true) {
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
    if (lava.length && bubbles) {
      const spots: [number, number, number][] = [];
      const seeds: number[] = [];
      for (let i = 0; i < BUBBLES; i++) {
        const [x, y] = lava[Math.floor(rand() * lava.length)];
        spots.push([x + 0.5, lavaY + 0.02, y + 0.5]);
        seeds.push(rand());
      }
      // Each bubble's cycle (shared by its embers): a few seconds of rest, then it swells (u < 0.8) and bursts.
      // It comes back elsewhere in its tile each time.
      const cycle = 'float per = 7.0 + seed * 6.0; float c = time / per + seed * 13.0; float u = fract(c) * 3.0; float n = floor(c); p.xz += (vec2(fract(sin(n * 12.9 + seed * 78.2) * 43758.5), fract(sin(n * 39.3 + seed * 11.1) * 24634.6)) - 0.5) * 0.8;';
      this.root.add(points(spots, seeds, {
        uniforms, blending: NormalBlending,
        motion: cycle,
        size: '(u < 0.8 ? 0.2 + u * 0.8 : 0.0)',
        colour: 'mix(vec3(0.7, 0.22, 0.03), vec3(1.0, 0.62, 0.18), u * 1.25)',
        alpha: '(u < 0.8 ? smoothstep(0.0, 0.15, u) : 0.0)',
        // A dome: a hot highlight off-centre, darker crust towards the rim.
        shade: 'gl_FragColor.rgb *= 1.1 - d * 0.6 + 0.4 * (1.0 - smoothstep(0.0, 0.45, length(gl_PointCoord - vec2(0.38, 0.35)) * 2.0));',
      }));
      // Three embers per bubble, flung up and out as it bursts.
      const k = [0, 1, 2];
      this.root.add(points(spots.flatMap((s) => k.map(() => s)), seeds.flatMap((s) => k.map(() => s)), {
        uniforms, blending: AdditiveBlending,
        motion: `${cycle} float t = clamp((u - 0.8) / 0.9, 0.0, 1.0); float a = float(gl_VertexID % 3) * 2.0944 + seed * 6.0; p += vec3(cos(a) * 0.6 * t, t * 2.2 - t * t * 1.4, sin(a) * 0.6 * t);`,
        size: '(u >= 0.8 && t < 1.0 ? 0.11 : 0.0)',
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

/** At most this many bubbles on the lava at once. */
const BUBBLES = 12;

type Look = { uniforms: Record<string, { value: unknown }>; blending: typeof AdditiveBlending | typeof NormalBlending; motion: string; size: string; colour: string; alpha: string; shade?: string };

/** `count` points placed by `at`, each with a random seed; or the given places and seeds. */
function points(count: number, at: () => [number, number, number], rand: () => number, o: Look): Points;
function points(at: [number, number, number][], seeds: number[], o: Look): Points;
function points(a: number | [number, number, number][], b: (() => [number, number, number]) | number[], c: (() => number) | Look, d?: Look): Points {
  let pos: number[] = [];
  let seeds: number[] = [];
  const o = (d ?? c) as Look;
  if (typeof a === 'number') {
    for (let i = 0; i < a; i++) {
      pos.push(...(b as () => [number, number, number])());
      seeds.push((c as () => number)());
    }
  } else {
    pos = a.flat();
    seeds = b as number[];
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
        ${o.shade ?? ''}
      }`,
  });
  const p = new Points(g, m);
  p.frustumCulled = false;
  return p;
}
