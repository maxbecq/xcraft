import { AdditiveBlending, type DataArrayTexture, type DataTexture, DataTexture as Data, GLSL3, Group, LinearFilter, Mesh, NearestFilter, PlaneGeometry, RGFormat, ShaderMaterial, SRGBColorSpace, Texture, TextureLoader, UnsignedByteType, Vector2, Vector3, Vector4, WebGLArrayRenderTarget, type WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { type CameraRig, PITCH } from '../camera';
import type { GameMap } from '../map';
import { FOG_GLSL } from '../terrain';

/** public/textures/villenuit/tiles.json, written by tools/villenuit/tiles.py. */
interface Manifest {
  /** Pixels per map tile at level 0, and a picture's side in pixels. */
  ppu: number;
  size: number;
  /** The grid's top left corner in painting space, and its size in level 0 pictures. */
  left: number;
  top: number;
  cols: number;
  rows: number;
  /** The pictures that exist, "col_row": level 0 (full definition), level 1 (half). */
  0: string[];
  1: string[];
}

/**
 * The night city is a painting. The camera never turns, so the whole scenery is painted once at its angle
 * (tools/villenuit/: plain volumes rendered as the camera sees them, repainted piece by piece) and shown here as it
 * was painted: the picture is projected back, from the camera's own angle, onto the same plain volumes
 * (villenuit.glb). Whatever the volumes' shape, the screen shows the painting exactly; the volumes only give the depth
 * (a unit passes behind a building) and the place on the map (the fog of war).
 *
 * Painting space, in map tiles: sx = (x - z) / sqrt 2 to the right, sy = y cos(pitch) - (x + z) / sqrt 2 sin(pitch)
 * up: the screen's own axes, so what the camera shows is a rectangle of it.
 *
 * The painting is too big to hold whole (80 pixels per map tile: about 14 000 x 9 000): it comes in square pictures
 * loaded zone by zone, as maps do. Three levels: the whole city at 10 pixels per tile (always there), pictures at 40
 * and at 80 loaded for what the camera shows, at the level its zoom needs, kept in a few layers of one array texture
 * (the least recently seen gives its layer up). A small grid tells the shader which layer holds which picture.
 */
export class PaintedCity {
  readonly root = new Group();
  private readonly material: ShaderMaterial;
  private manifest: Manifest | null = null;
  private layers!: DataArrayTexture;
  private where!: DataTexture;
  /** Per layer: the picture it holds ("level/col_row") and when the camera last showed it. */
  private readonly held: { key: string; seen: number }[] = [];
  private readonly layerOf = new Map<string, number>();
  private readonly loading = new Set<string>();
  private readonly ready: { key: string; bitmap: ImageBitmap }[] = [];
  private frame = 0;
  /** Pictures fetched and their bytes, for the measures (`xcraft.painted.stats`). */
  readonly stats = { pictures: 0, bytes: 0, ms: 0 };

  /** `count`: how many pictures the graphics memory holds at once (4 MB each). */
  constructor(map: GameMap, fog: DataTexture, private readonly count: number) {
    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      uniforms: {
        base: { value: null as Texture | null },
        layers: { value: null as DataArrayTexture | null },
        where: { value: null as DataTexture | null },
        /** The grid in painting space: left, top, then 1 / a level 0 picture's side in map tiles. */
        grid: { value: new Vector4(0, 0, 1, 1) },
        cells: { value: new Vector2(1, 1) },
        /** 0: level 0 where loaded, 1: level 1 at best, 2: the whole-city picture only. */
        level: { value: 2 },
        time: { value: 0 },
        fogMap: { value: fog },
        mapSize: { value: new Vector2(map.width, map.height) },
        up: { value: new Vector2(Math.cos(PITCH), Math.sin(PITCH) / Math.SQRT2) },
      },
      vertexShader: /* glsl */ `
        uniform vec2 up;
        out vec2 vPaint;
        out vec2 vTile;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vPaint = vec2((w.x - w.z) * 0.70710678, w.y * up.x - (w.x + w.z) * up.y);
          vTile = w.xz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        precision highp sampler2DArray;
        uniform sampler2D base;
        uniform sampler2DArray layers;
        uniform sampler2D where;
        uniform sampler2D fogMap;
        uniform vec4 grid;
        uniform vec2 cells;
        uniform float level;
        uniform float time;
        uniform vec2 mapSize;
        in vec2 vPaint;
        in vec2 vTile;
        out vec4 fragColor;
        #define gl_FragColor fragColor
        // The picture must reach the screen as painted: the game's tone mapping (ACES filmic, three's) undone ahead.
        vec3 untone(vec3 c) {
          c = mat3(0.64304, 0.05927, 0.00596, 0.31119, 0.93144, 0.06393, 0.04578, 0.00929, 0.93012) * c;
          c = clamp(c, 0.0, 0.985);
          vec3 a = 0.983729 * c - 1.0, b = 0.432951 * c - 0.0245786, k = 0.238081 * c + 0.000090537;
          c = (-b - sqrt(max(b * b - 4.0 * a * k, 0.0))) / (2.0 * a);
          return mat3(1.76474, -0.14703, -0.03634, -0.67578, 1.16025, -0.16244, -0.08896, -0.01322, 1.19877) * c * 0.6;
        }
        void main() {
          // in level 0 pictures from the grid's top left corner, y down
          vec2 g = vec2(vPaint.x - grid.x, grid.y - vPaint.y) * grid.z;
          vec2 cell = floor(g);
          vec3 c = texture(base, vec2(g.x, cells.y - g.y) / cells).rgb;
          if (level < 1.5 && cell.x >= 0.0 && cell.y >= 0.0 && cell.x < cells.x && cell.y < cells.y) {
            vec2 at = texelFetch(where, ivec2(cell), 0).rg * 255.0; // the layers of its level 0 and level 1 pictures, + 1
            vec2 f = g - cell;
            if (level < 0.5 && at.r > 0.5) c = texture(layers, vec3(f.x, 1.0 - f.y, at.r - 1.0)).rgb;
            else if (at.g > 0.5) {
              f = g * 0.5 - floor(g * 0.5);
              c = texture(layers, vec3(f.x, 1.0 - f.y, at.g - 1.0)).rgb;
            }
          }
          // The lights live a little: what is bright and coloured (signs, lit windows, their reflections on the wet
          // ground) hums faintly, and here and there (one square of city in six) a sign stutters for a moment.
          float lit = smoothstep(0.2, 0.55, max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b))) * smoothstep(0.08, 0.4, dot(c, vec3(0.3, 0.59, 0.11)));
          float h = fract(sin(dot(floor(vPaint / 1.6), vec2(12.9898, 78.233))) * 43758.5453);
          float fit = step(0.72, fract(sin(floor(time * 0.4 + h * 10.0) * 12.3 + h * 5.0) * 43.5));
          float blink = h > 0.84 ? mix(1.0, 0.4 + 0.6 * step(0.4, fract(sin(floor(time * (7.0 + h * 6.0)) * 91.7 + h * 17.0) * 437.5)), fit) : 1.0;
          c *= mix(1.0, blink * (1.0 + 0.06 * sin(time * 2.5 + vPaint.y * 9.0 + h * 40.0)), lit);
          gl_FragColor = vec4(c, 1.0);
          vec2 fogUv = vTile / mapSize, fogLo = 0.5 / mapSize;
          ${FOG_GLSL('texture(fogMap, clamp(fogUv, fogLo, 1.0 - fogLo)).r')}
          // Past the map's edges the city goes on, dimmer.
          gl_FragColor.rgb *= 1.0 - 0.5 * smoothstep(1.0, 6.0, length((fogUv - clamp(fogUv, 0.0, 1.0)) * mapSize));
          // And further still it is lost in the night, before the painting's own end shows.
          float far = mapSize.x * 0.40558; // the map's half height on screen, in tiles
          gl_FragColor.rgb *= 1.0 - smoothstep(1.2, 1.5, abs(vPaint.x) / (mapSize.x * 0.70711) + abs(vPaint.y + far) / far);
          gl_FragColor.rgb = untone(gl_FragColor.rgb);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
  }

  /** The volumes, the list of pictures and the whole-city picture: what the first frame needs. */
  async load(renderer: WebGLRenderer): Promise<void> {
    const dir = `${import.meta.env.BASE_URL}textures/villenuit/`;
    const [gltf, manifest, base] = await Promise.all([
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env.BASE_URL}models/villenuit.glb`),
      fetch(`${dir}tiles.json`).then((r) => r.json() as Promise<Manifest>),
      new TextureLoader().loadAsync(`${dir}base.webp`),
    ]);
    this.manifest = manifest;
    base.colorSpace = SRGBColorSpace;
    base.generateMipmaps = false;
    base.minFilter = base.magFilter = LinearFilter;
    // A render target only to have its layers' memory set aside empty, for pictures to be copied in as they come.
    const target = new WebGLArrayRenderTarget(manifest.size, manifest.size, this.count, { depthBuffer: false, colorSpace: SRGBColorSpace, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false });
    renderer.initRenderTarget(target);
    this.layers = target.texture as DataArrayTexture;
    this.where = new Data(new Uint8Array(manifest.cols * manifest.rows * 2), manifest.cols, manifest.rows, RGFormat, UnsignedByteType);
    this.where.minFilter = this.where.magFilter = NearestFilter;
    this.where.needsUpdate = true;
    const u = this.material.uniforms;
    u.base.value = base;
    u.layers.value = this.layers;
    u.where.value = this.where;
    u.grid.value.set(manifest.left, manifest.top, manifest.ppu / manifest.size, 0);
    u.cells.value.set(manifest.cols, manifest.rows);
    gltf.scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      o.material = this.material;
      o.userData.painted = true; // no occlusion shading, no ink line over it (render/post.ts)
    });
    this.root.add(gltf.scene);
  }

  /**
   * Each frame: which level the zoom needs (`pixels`: screen pixels per map tile), the pictures the camera shows
   * asked for, and one arrived picture put in its layer (one a frame: each is a 4 MB upload).
   */
  update(rig: CameraRig, aspect: number, pixels: number, renderer: WebGLRenderer): void {
    const m = this.manifest;
    if (!m) return;
    this.frame++;
    this.material.uniforms.time.value = performance.now() / 1000;
    // A level serves from 0.6 to 1.2 times its definition (no mip maps: never drawn much smaller than it is).
    const level = pixels > m.ppu * 0.6 ? 0 : pixels > m.ppu * 0.3 ? 1 : 2;
    this.material.uniforms.level.value = level;
    const one = this.ready.shift();
    if (one) this.place(one.key, one.bitmap, renderer);
    if (level === 2) return;
    // What the camera shows, in painting space (the screen's own axes), and half a picture around it.
    const t = rig.target;
    const [sx, sy] = [(t.x - t.z) * Math.SQRT1_2, -(t.x + t.z) * Math.SQRT1_2 * Math.sin(PITCH)];
    const side = (m.size << level) / m.ppu;
    const [hw, hh] = [(rig.viewHeight * aspect) / 2 + side / 2, rig.viewHeight / 2 + side / 2];
    const have = new Set(m[level]);
    for (let r = Math.floor((m.top - sy - hh) / side); r <= Math.floor((m.top - sy + hh) / side); r++) {
      for (let c = Math.floor((sx - hw - m.left) / side); c <= Math.floor((sx + hw - m.left) / side); c++) {
        if (!have.has(`${c}_${r}`)) continue;
        const key = `${level}/${c}_${r}`;
        const layer = this.layerOf.get(key);
        if (layer !== undefined) this.held[layer].seen = this.frame;
        else if (!this.loading.has(key) && this.loading.size < 4) void this.fetch(key);
      }
    }
  }

  private async fetch(key: string): Promise<void> {
    this.loading.add(key);
    const t0 = performance.now();
    try {
      const blob = await (await fetch(`${import.meta.env.BASE_URL}textures/villenuit/${key}.webp`)).blob();
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' }); // decoded off the main thread
      this.stats.pictures++;
      this.stats.bytes += blob.size;
      this.stats.ms += performance.now() - t0;
      this.ready.push({ key, bitmap });
    } catch {
      this.loading.delete(key); // asked again while the camera still shows it
    }
  }

  /** An arrived picture into a free layer, or the layer of the picture seen longest ago. */
  private place(key: string, bitmap: ImageBitmap, renderer: WebGLRenderer): void {
    this.loading.delete(key);
    let layer = this.held.length;
    if (layer >= this.count) {
      layer = 0;
      for (let i = 1; i < this.count; i++) if (this.held[i].seen < this.held[layer].seen) layer = i;
      if (this.held[layer].seen >= this.frame - 1) return bitmap.close(); // every layer is on screen: it waits
      this.mark(this.held[layer].key, 0);
      this.layerOf.delete(this.held[layer].key);
    }
    const source = new Texture(bitmap);
    renderer.copyTextureToTexture(source, this.layers, null, new Vector3(0, 0, layer));
    source.dispose();
    bitmap.close();
    this.held[layer] = { key, seen: this.frame };
    this.layerOf.set(key, layer);
    this.mark(key, layer + 1);
  }

  /** Writes in the grid which layer (+ 1; 0: none) holds a picture: one cell at level 0, four at level 1. */
  private mark(key: string, value: number): void {
    const m = this.manifest!;
    const [level, c, r] = key.split(/[/_]/).map(Number);
    const data = this.where.image.data as Uint8Array;
    for (let y = r << level; y < (r + 1) << level; y++) {
      for (let x = c << level; x < (c + 1) << level; x++) if (x >= 0 && y >= 0 && x < m.cols && y < m.rows) data[(y * m.cols + x) * 2 + level] = value;
    }
    this.where.needsUpdate = true;
  }
}

/**
 * Light rain over the night city: thin streaks drawn over the whole screen (two layers, the far one finer and
 * slower), from the clock alone. One quad, no texture.
 */
export class Rain {
  readonly mesh: Mesh;
  private readonly uniforms = { time: { value: 0 }, size: { value: new Vector2(1, 1) } };

  constructor() {
    this.mesh = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: /* glsl */ `
          uniform float time;
          uniform vec2 size;
          float layer(vec2 p, float columns, float speed, float len) {
            p.x += p.y * 0.12; // a slight slant
            float col = floor(p.x * columns);
            float r = fract(sin(col * 127.1) * 43758.5453);
            float along = fract(p.y * (0.9 + r * 0.6) + time * speed * (0.7 + r * 0.6) + r * 9.0);
            float thin = 1.0 - smoothstep(0.0, 0.12, abs(fract(p.x * columns) - 0.5));
            return thin * smoothstep(1.0 - len, 1.0, along) * step(0.45, r);
          }
          void main() {
            vec2 p = gl_FragCoord.xy / size.y; // the same streaks whatever the window's shape
            float a = layer(p, 90.0, 1.5, 0.1) * 0.5 + layer(p + 3.7, 170.0, 1.1, 0.07) * 0.3;
            gl_FragColor = vec4(vec3(0.55, 0.62, 0.72) * a * 0.22, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 999;
  }

  /** Each frame; `width`, `height`: the drawing's size in pixels. */
  update(width: number, height: number): void {
    this.uniforms.time.value = performance.now() / 1000;
    this.uniforms.size.value.set(width, height);
  }
}
