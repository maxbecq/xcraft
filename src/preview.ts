/**
 * Off-game preview of a planet's terrain (dev only): a map's ground, cliffs and chasms under the planet's light, seen
 * from the game's camera, with no units. /preview-biomes.html?biome=volcan&map=les-ponts&x=40&z=36&zoom=24
 * Arrow keys move the view (to see the layers of space slide by).
 */
import { ACESFilmicToneMapping, Color, DirectionalLight, HemisphereLight, PCFShadowMap, Scene, Vector3, WebGLRenderer } from 'three';
// terrain first: it and render/biome import each other, and terrain needs BIOMES ready (as in main.ts).
import { buildTerrain, setBiome } from './terrain';
import { CameraRig } from './camera';
import { buildMap, mapFile } from './maps';
import { BIOMES } from './render/biome';
import { Space } from './render/space';

const params = new URLSearchParams(location.search);
const biome = BIOMES[params.get('biome') ?? 'volcan'] ?? BIOMES.volcan;
const def = mapFile(params.get('map') ?? 'les-ponts');
setBiome(biome);
const map = buildMap(def, 2, biome.id);
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = biome.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(biome.background);
scene.add(buildTerrain(map));
const space = biome.space ? new Space(map.width, map.height) : null;
if (space) scene.add(space.root);
scene.add(new HemisphereLight(biome.sky.color, biome.sky.ground, biome.sky.intensity));
const sun = new DirectionalLight(biome.sun.color, biome.sun.intensity);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 });
scene.add(sun, sun.target);

const SUN_OFFSET = new Vector3(-22, 40, -12);
const rig = new CameraRig(map.width, map.height);
rig.lookAt(Number(params.get('x') ?? map.width / 2), Number(params.get('z') ?? map.height / 2));
rig.viewHeight = Number(params.get('zoom') ?? 22);
const held = new Set<string>();
addEventListener('keydown', (e) => held.add(e.key));
addEventListener('keyup', (e) => held.delete(e.key));
let last = performance.now();
const frame = (now: number) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  rig.pan((held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0), (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0), dt);
  rig.update(innerWidth / innerHeight);
  sun.position.copy(rig.target).add(SUN_OFFSET);
  sun.target.position.copy(rig.target);
  space?.update(rig.target);
  renderer.render(scene, rig.camera);
  requestAnimationFrame(frame);
};
addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight));
requestAnimationFrame(frame);
Object.assign(window, { preview: { rig } });
