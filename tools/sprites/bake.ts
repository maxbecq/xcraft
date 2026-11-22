/**
 * Renders a building's model from the game camera's exact angle, for the painted sprites (src/render/sprites.ts):
 * the colour (transparent background), the depth of each pixel along the line of sight, and the framing.
 * Open /xcraft/tools/sprites/bake.html?types=pod,armement with `python3 tools/sprites/receive.py OUT` running.
 */
import { ACESFilmicToneMapping, Box3, DirectionalLight, Group, HemisphereLight, OrthographicCamera, PMREMGenerator, Scene, ShaderMaterial, Vector3, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadModels, preview } from '../../src/render/models';
import { cameraAxes, DEPTH_RANGE, isLive, SPRITE_PPU, SPRITE_YAW } from '../../src/render/sprites';

const params = new URLSearchParams(location.search);
const types = (params.get('types') ?? 'pod,armement,intelligence').split(',');
const ppu = Number(params.get('ppu')) || SPRITE_PPU;
const suffix = params.get('suffix') ?? '';
const post = (name: string, body: Blob | string) => fetch(`http://127.0.0.1:8765/${name.replace('.', `${suffix}.`)}`, { method: 'POST', body });
const log = (s: string) => (document.getElementById('log')!.textContent += `${s}\n`);

// The desert's light (src/render/biome.ts), imported there through a cycle that breaks this page.
const biome = { exposure: 1.05, sun: { color: 0xffe2b8, intensity: 3.2 }, sky: { color: 0xb8c8e8, ground: 0x4a3820, intensity: 1.1 } };
const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = biome.exposure;
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);

const depthMaterial = new ShaderMaterial({
  vertexShader: 'varying float vZ; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }',
  fragmentShader: `varying float vZ; void main() { float v = clamp((vZ - 50.0) / ${DEPTH_RANGE.toFixed(1)} + 0.5, 0.0, 1.0) * 255.0; gl_FragColor = vec4(floor(v) / 255.0, fract(v), 0.0, 1.0); }`,
});
depthMaterial.toneMapped = false;

const blob = () => new Promise<Blob>((ok) => renderer.domElement.toBlob((b) => ok(b!), 'image/png'));

await loadModels(types);
const { right, up, back } = cameraAxes();
for (const type of types) {
  const scene = new Scene();
  scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  scene.add(new HemisphereLight(biome.sky.color, biome.sky.ground, biome.sky.intensity));
  const sun = new DirectionalLight(biome.sun.color, biome.sun.intensity);
  sun.position.set(-22, 40, -12);
  scene.add(sun, sun.target);
  const holder = new Group();
  holder.rotation.y = params.has('yaw') ? Number(params.get('yaw')) : (SPRITE_YAW[type] ?? 0);
  holder.add(preview(type, 0).object);
  holder.traverse((o) => (o.visible &&= !isLive(type, o)));
  scene.add(holder);
  holder.updateMatrixWorld(true);
  // Framing: the model's box projected on the camera's axes, with a margin.
  const box = new Box3().setFromObject(holder);
  let [r0, r1, u0, u1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const c = new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    [r0, r1] = [Math.min(r0, c.dot(right)), Math.max(r1, c.dot(right))];
    [u0, u1] = [Math.min(u0, c.dot(up)), Math.max(u1, c.dot(up))];
  }
  const margin = 24;
  const w = Math.ceil((r1 - r0) * ppu) + 2 * margin;
  const h = Math.ceil((u1 - u0) * ppu) + 2 * margin;
  const ax = -r0 * ppu + margin;
  const ay = u1 * ppu + margin;
  renderer.setSize(w, h, false);
  const camera = new OrthographicCamera(-ax / ppu, (w - ax) / ppu, ay / ppu, (ay - h) / ppu, 1, 100);
  camera.position.copy(back).multiplyScalar(50);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  await post(`${type}-ref.png`, await blob());
  scene.overrideMaterial = depthMaterial;
  renderer.render(scene, camera);
  await post(`${type}-depth.png`, await blob());
  await post(`${type}.json`, JSON.stringify({ w, h, ax, ay, ppu }));
  log(`${type}: ${w}×${h}`);
}
log('done');
