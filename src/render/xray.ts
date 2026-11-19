import { type Camera, DepthTexture, MeshBasicMaterial, type Object3D, type Material, type Mesh, type Scene, Vector2, type WebGLRenderer, WebGLRenderTarget } from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { TEAM_COLORS } from './units';

/**
 * Units seen through the buildings that hide them (SC2's silhouettes): a unit behind a building shows as a flat shape
 * in its side's colour. The buildings alone are first drawn into a depth texture of their own (their meshes carry
 * BUILDINGS); then each side's units (layer 1 + side) are drawn again, a pass per side present, with a material that
 * keeps a pixel only where a building stands nearer, and there takes the building's depth, so the usual depth test
 * also drops it where something else (a unit flying in front) hides that building. Only buildings count: a unit never
 * tints itself (a Mastodonte's wings ahead of its body), nor shows through another unit or the ground.
 */
const layerOf = (owner: number) => 1 + (owner % TEAM_COLORS.length);
const used = new Set<number>();
const BUILDINGS = 6;

/** The buildings' depth, sized to the target drawn into. */
const depth = new WebGLRenderTarget(1, 1, { depthBuffer: true, depthTexture: new DepthTexture(1, 1) });
const behind = { tBuild: { value: depth.depthTexture }, uSize: { value: new Vector2(1, 1) } };
const depthOnly = new MeshBasicMaterial({ colorWrite: false });

/** Made on first use: units.ts (TEAM_COLORS) imports this module. */
let materials: MeshBasicMaterial[] | undefined;
const makeMaterials = () => TEAM_COLORS.map((color) => {
  const m = new MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false, fog: false });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, behind);
    sh.fragmentShader = `uniform sampler2D tBuild;\nuniform vec2 uSize;\n${sh.fragmentShader.replace('void main() {', 'void main() {\n  float b = texture2D(tBuild, gl_FragCoord.xy / uSize).x;\n  if (gl_FragCoord.z <= b + 1e-5) discard;\n  gl_FragDepth = b - 1e-5;')}`;
  };
  return m;
});

/** Puts a building's meshes on the layer the silhouettes are cut against. */
export function occluder(model: Object3D): void {
  model.traverse((o) => {
    const m = o as Mesh;
    const mat = m.material as Material | undefined;
    if (!m.isMesh || !o.layers.isEnabled(0) || o.userData.noPick || !mat || Array.isArray(mat) || !mat.visible || mat.transparent) return;
    o.layers.enable(BUILDINGS);
  });
}

/** Puts a unit's visible meshes on its side's layer (not its pick proxy, rings or see-through glows). */
export function xrayable(model: Object3D, owner: number): void {
  if (owner < 0) return;
  const layer = layerOf(owner);
  used.add(layer);
  model.traverse((o) => {
    const m = o as Mesh;
    const mat = m.material as Material | undefined;
    if (!m.isMesh || !o.layers.isEnabled(0) || o.userData.noPick || !mat || Array.isArray(mat) || !mat.visible || mat.transparent) return;
    o.layers.enable(layer);
  });
}

/** Whether this mesh is drawn as a silhouette where a building hides it (a living unit's, on its side's layer). */
export function silhouetted(o: Object3D): boolean {
  for (let l = 1; l <= TEAM_COLORS.length; l++) if (o.layers.isEnabled(l)) return true;
  return false;
}

/** Takes a unit off the silhouettes (a corpse). */
export function unxray(model: Object3D): void {
  model.traverse((o) => {
    for (let l = 1; l <= TEAM_COLORS.length; l++) o.layers.disable(l);
  });
}

/**
 * Draws the silhouettes over what is already in the target (colour and depth): one pass per side present. It comes
 * right after the scene's own render, nothing moved since: each pass keeps the frame count of that render, so three
 * neither works the skeletons out and uploads their bones again nor re-sends the geometry, and the scene's matrices
 * are not updated again. That work, done twice more a frame, was most of the passes' cost (6.5 to 2.5 ms a frame with
 * 80 units, CPU slowed 4 times).
 */
export function drawXray(renderer: WebGLRenderer, scene: Scene, camera: Camera, target: WebGLRenderTarget | null = null): void {
  if (!used.size) return;
  const [mask, override, background, autoClear, autoUpdate] = [camera.layers.mask, scene.overrideMaterial, scene.background, renderer.autoClear, scene.matrixWorldAutoUpdate];
  scene.background = null;
  scene.matrixWorldAutoUpdate = false;
  renderer.autoClear = false;
  // The buildings' depth first, at the target's size.
  const size = target ? behind.uSize.value.set(target.width, target.height) : renderer.getDrawingBufferSize(behind.uSize.value);
  if (depth.width !== size.x || depth.height !== size.y) depth.setSize(size.x, size.y);
  renderer.setRenderTarget(depth);
  renderer.clear(false, true, false);
  camera.layers.set(BUILDINGS);
  scene.overrideMaterial = depthOnly;
  renderer.info.render.frame--;
  renderer.render(scene, camera);
  renderer.setRenderTarget(target);
  for (const layer of used) {
    camera.layers.set(layer);
    scene.overrideMaterial = (materials ??= makeMaterials())[layer - 1];
    renderer.info.render.frame--; // render() counts it back up: the same frame as the scene's render
    renderer.render(scene, camera);
  }
  camera.layers.mask = mask;
  scene.overrideMaterial = override;
  scene.background = background;
  scene.matrixWorldAutoUpdate = autoUpdate;
  renderer.autoClear = autoClear;
}

/** The same as a composer pass, drawn into the scene's own render. */
export class XrayPass extends Pass {
  constructor(private readonly scene: Scene, private readonly camera: Camera) {
    super();
    this.needsSwap = false;
  }

  render(renderer: WebGLRenderer, _write: WebGLRenderTarget, read: WebGLRenderTarget): void {
    const target = this.renderToScreen ? null : read;
    renderer.setRenderTarget(target);
    drawXray(renderer, this.scene, this.camera, target);
  }
}
