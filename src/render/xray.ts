import { type Camera, GreaterDepth, MeshBasicMaterial, type Object3D, type Material, type Mesh, type Scene, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { TEAM_COLORS } from './units';

/**
 * Units seen through what hides them (SC2's silhouettes): a unit behind a building shows as a flat shape in its
 * side's colour, drawn only where something stands in front of it. Each side's units carry a layer of their own
 * (1 + side); a pass per side present draws them again with a material that passes only behind the depth already
 * drawn. That material brings each unit forward by DEPTH_MARGIN first, so a unit's own parts (an arm across its chest)
 * never tint it: only something thicker than that, in front, makes a silhouette.
 */
const DEPTH_MARGIN = 1;
const layerOf = (owner: number) => 1 + (owner % TEAM_COLORS.length);
const used = new Set<number>();

/** Made on first use: units.ts (TEAM_COLORS) imports this module. */
let materials: MeshBasicMaterial[] | undefined;
const makeMaterials = () => TEAM_COLORS.map((color) => {
  const m = new MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthFunc: GreaterDepth, depthWrite: false, fog: false });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\nmvPosition.z += ${DEPTH_MARGIN.toFixed(1)};\ngl_Position = projectionMatrix * mvPosition;`);
  };
  return m;
});

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

/** Takes a unit off the silhouettes (a corpse). */
export function unxray(model: Object3D): void {
  model.traverse((o) => {
    for (let l = 1; l <= TEAM_COLORS.length; l++) o.layers.disable(l);
  });
}

/** Draws the silhouettes over what is already in the target (colour and depth): one pass per side present. */
export function drawXray(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
  if (!used.size) return;
  const [mask, override, background, autoClear] = [camera.layers.mask, scene.overrideMaterial, scene.background, renderer.autoClear];
  scene.background = null;
  renderer.autoClear = false;
  for (const layer of used) {
    camera.layers.set(layer);
    scene.overrideMaterial = (materials ??= makeMaterials())[layer - 1];
    renderer.render(scene, camera);
  }
  camera.layers.mask = mask;
  scene.overrideMaterial = override;
  scene.background = background;
  renderer.autoClear = autoClear;
}

/** The same as a composer pass, drawn into the scene's own render (its depth still there). */
export class XrayPass extends Pass {
  constructor(private readonly scene: Scene, private readonly camera: Camera) {
    super();
    this.needsSwap = false;
  }

  render(renderer: WebGLRenderer, _write: WebGLRenderTarget, read: WebGLRenderTarget): void {
    renderer.setRenderTarget(this.renderToScreen ? null : read);
    drawXray(renderer, this.scene, this.camera);
  }
}
