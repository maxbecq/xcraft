import { type DirectionalLight, type Object3D, type Scene, Vector3, type WebGLRenderer } from 'three';
import type { CameraRig } from '../camera';
import { DEFS } from '../data';
import { FP } from '../sim/fixed';
import { type Entity, World } from '../sim/world';
import type { Post } from './post';
import { stableShadowDepth } from './shadowdepth';
import { burstSamples, EntityRenderer } from './units';
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
  units.sync(world, 0, m.selected, m.player, m.sees, m.seenAt);
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
  stableShadowDepth(scene); // the decor, deposits and ground (each entity's view gets it when made)
  const into = post.sceneTarget;
  renderer.setRenderTarget(into);
  await renderer.compileAsync(scene, rig.camera);
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
    drawXray(renderer, scene, rig.camera, into); // the buildings' depth and the silhouettes, one per side
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
    shapes.clear();
    for (const b of bursts) {
      scene.remove(b);
      b.geometry.dispose();
    }
  }
}
