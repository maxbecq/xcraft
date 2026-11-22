import { type DirectionalLight, DoubleSide, type Material, Mesh, type Object3D, Plane, type Scene, Vector3, type WebGLRenderer } from 'three';
import type { CameraRig } from '../camera';
import { DEFS } from '../data';
import { FP } from '../sim/fixed';
import { type Entity, World } from '../sim/world';
import type { Effects } from './effects';
import type { Post } from './post';
import { stableShadowDepth } from './shadowdepth';
import { burstSamples, EntityRenderer } from './units';
import { hitTint } from './views';
import { drawXray } from './xray';

/** What the match's warm-up draws with: the match's own renderer, scene, camera and sun. */
export interface Prewarm {
  renderer: WebGLRenderer;
  scene: Scene;
  world: World;
  units: EntityRenderer;
  selected: Set<number>;
  player: number;
  sees: (e: Entity) => boolean;
  seenAt: (x: number, y: number) => boolean;
  rig: CameraRig;
  sun: DirectionalLight;
  sunOffset: Vector3;
  post: Post;
  /** The effects, for their particles' and stains' programs. */
  effects?: Effects;
  /** Hidden meshes of what only shows later (an enemy's power network, the paving): compiled with the scene, kept. */
  extras?: Object3D[];
  /** The loading screen stopped waiting, or its time is up: asked before each pass, the rest of the warm-up is dropped
   * (never run over the match in play, never past the time an online match gives it by more than the pass under way). */
  stop?: () => boolean;
  /** Whether the viewer has a fog of war (not a spectator): enemy buildings then turn to grey ghosts out of sight. */
  ghosts?: boolean;
}

/**
 * The match's own shader programs, compiled behind the loading screen: what lies off screen at first (decor,
 * deposits, the other base under the fog) would otherwise compile when the camera first scrolls over it, a frame
 * held up for 60 to 380 ms (CPU slowed 4 times). The entities' views are made first (before the first frame there
 * are none), then one draw of the whole map and its unit silhouettes through an empty scissor, hidden things shown
 * for it: the shadow pass's programs, the silhouettes' and those that differ from one object to the next (skinned,
 * shadowed) are built too.
 */
export async function compileScene(m: Prewarm, catalog: [string, number][]): Promise<void> {
  const { renderer, scene, world, units, rig, sun, sunOffset: SUN_OFFSET, post } = m;
  const map = world.map;
  if (m.stop?.()) return;
  units.sync(world, 0, m.selected, m.player, m.sees, m.seenAt);
  if (m.stop?.()) return;
  // Every type the match can show (`catalog`: type and owner, for its colours), built and, for buildings, being built,
  // in a world of its own never stepped (the match's ids and simulation untouched), drawn by a renderer of its own:
  // a type first trained or built mid-game compiled its shaders then (the Marché held a frame 1.25 s, CPU slowed 4 times).
  const spare = new World(map, world.players.length);
  spare.players.forEach((p, i) => (p.faction = world.players[i].faction));
  for (const [type, owner] of catalog) {
    if (DEFS[type].kind === 'resource') continue; // already on the map
    spare.spawn(type, owner, (map.width / 2) * FP, (map.height / 2) * FP);
    // Each weapon module on its socles too: a weapon first seen mid-game would compile then.
    for (const kit of (DEFS[type] as { weapons?: string[] }).weapons ?? []) spare.spawn(type, owner, (map.width / 2) * FP, (map.height / 2) * FP).kit = kit;
    if (DEFS[type].kind === 'building') spare.spawn(type, owner, (map.width / 2) * FP, (map.height / 2) * FP).buildLeft = 1;
  }
  const shapes = new EntityRenderer(scene, map);
  shapes.sync(spare, 0, new Set(), m.player, () => true, () => true);
  // The death bursts' points too: the first death of a match compiled their two programs.
  const bursts = burstSamples(new Vector3(map.width / 2, 1, map.height / 2));
  scene.add(...bursts);
  // The effects' particles and stains too: an ability's first cloud in play compiled them.
  const fx = [...(m.effects?.samples(new Vector3(map.width / 2, 1, map.height / 2)) ?? []), ...(m.extras ?? [])];
  scene.add(...fx);
  stableShadowDepth(scene); // the decor, deposits and ground (each entity's view gets it when made)
  // Hidden while their programs compile (hidden things are compiled too, and shown for the draws below): should the
  // match start before the compiling ends, none of the catalogue ever shows in the middle of the map.
  for (const o of [...shapes.roots, ...bursts, ...fx]) o.visible = false;
  const drop = () => {
    shapes.clear();
    for (const b of bursts) {
      scene.remove(b);
      b.geometry.dispose();
    }
    for (const o of fx) {
      scene.remove(o);
      if (!o.userData.keep) ((o as Mesh).material as Material).dispose();
    }
  };
  const into = post.sceneTarget;
  if (m.stop?.()) return drop();
  try {
    // The programs are made as the call begins, for the target then set (tone mapping and colour space differ by
    // target); it is let go before waiting for them, so a match started meanwhile draws where it should.
    renderer.setRenderTarget(into);
    const compiled = renderer.compileAsync(scene, rig.camera);
    renderer.setRenderTarget(null);
    await compiled;
  } finally {
    // Stopped meanwhile (the match may be running): the catalogue goes, nothing else is touched.
    if (m.stop?.()) drop();
  }
  if (m.stop?.()) return;
  const aspect = window.innerWidth / window.innerHeight;
  const [target, view, box] = [rig.target.clone(), rig.viewHeight, { ...sun.shadow.camera }];
  // An empty scissor: drawn, nothing shows.
  const scissor = (on: boolean) => {
    if (into) [into.scissorTest, into.scissor.x, into.scissor.y, into.scissor.z, into.scissor.w] = on ? [true, 0, 0, 0, 0] : [false, 0, 0, into.width, into.height];
    else renderer.setScissorTest(on);
  };
  const hidden: Object3D[] = [];
  scene.traverse((o) => {
    if (o.visible) return;
    hidden.push(o);
    o.visible = true;
  });
  try {
    rig.lookAt(map.width / 2, map.height / 2);
    rig.viewHeight = rig.overview(aspect);
    rig.update(aspect);
    const reach = Math.max(map.width, map.height);
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, far: 400 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.copy(rig.target);
    sun.position.copy(rig.target).add(SUN_OFFSET);
    renderer.setScissor(0, 0, 0, 0);
    renderer.setRenderTarget(into);
    scissor(true);
    renderer.shadowMap.needsUpdate = true; // its programs too (the map is only drawn when asked for)
    renderer.render(scene, rig.camera);
    // The buildings' depth and the silhouettes, one per side; not where they are off (the basse level): their programs
    // and their depth buffer, the size of the picture, would be kept for nothing.
    if (post.xray) drawXray(renderer, scene, rig.camera, into, m.stop);
    if (m.stop?.()) return;
    // Once more with every unit of the catalogue lit by a hit (views.ts hitTint): a material that loses its emissive
    // map then needs a program of its own, which the first hits of a fight compiled.
    const lit: [Mesh, Material | Material[]][] = [];
    for (const root of shapes.roots)
      root.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        lit.push([o, o.material]);
        o.material = Array.isArray(o.material) ? o.material.map(hitTint) : hitTint(o.material);
      });
    renderer.render(scene, rig.camera);
    for (const [o, mat] of lit) o.material = mat;
    if (m.stop?.()) return;
    // Once more with every Z unit cut by a plane, as a Plate-forme fabricates it layer by layer (units.ts): a cut,
    // two-sided material is a program of its own, which the first socle of each kind compiled in play (0.5 s of one
    // frame on an Intel HD). The copies are kept: freeing them would free their programs.
    const plane = new Plane(new Vector3(0, -1, 0), 1e6);
    const cut = (mat: Material) => Object.assign(mat.clone(), { clippingPlanes: [plane], clipShadows: true, side: DoubleSide });
    const whole: [Mesh, Material | Material[]][] = [];
    for (const root of shapes.rootsOf('z'))
      root.traverse((o) => {
        if (!(o instanceof Mesh) || o.userData.noPick) return;
        whole.push([o, o.material]);
        o.material = Array.isArray(o.material) ? o.material.map(cut) : cut(o.material);
      });
    if (whole.length) {
      renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, rig.camera);
      for (const [o, mat] of whole) o.material = mat;
    }
    if (m.stop?.()) return;
    // And with every building as the grey ghost an enemy's turns into once out of sight (views.ts): compiled when the
    // first enemy building left the view.
    if (m.ghosts) {
      shapes.ghostAll();
      renderer.render(scene, rig.camera);
    }
    if (m.stop?.()) return;
    // Once more through the ambient occlusion's normal pass (post.ts): its skinned variant compiled in play when the
    // first animated character (a Human soldier, under a Z player's first Lance-flammes jet) came into view.
    if (post.normalMaterial) {
      scene.overrideMaterial = post.normalMaterial;
      renderer.render(scene, rig.camera);
      scene.overrideMaterial = null;
    }
  } finally {
    scissor(false);
    renderer.setScissorTest(false);
    renderer.setRenderTarget(null);
    for (const o of hidden) o.visible = false;
    Object.assign(sun.shadow.camera, { left: box.left, right: box.right, top: box.top, bottom: box.bottom, far: box.far });
    sun.shadow.camera.updateProjectionMatrix();
    rig.target.copy(target);
    rig.viewHeight = view;
    rig.update(aspect);
    drop();
  }
}
