import { type InstancedMesh, type Material, type Mesh, MeshDepthMaterial, type Object3D, type SkinnedMesh } from 'three';

type Shown = Material & { map?: unknown; alphaMap?: unknown; displacementMap?: unknown; wireframe?: boolean };

/** Shadow depth materials, one per kind of shadow caster. */
const depths = new Map<string, MeshDepthMaterial>();
/** For each material drawn, its depth material by kind of object (see `kindOf`): looked up at every shadow draw. */
const byMaterial = new WeakMap<Material, MeshDepthMaterial[]>();

/** What of the object, not its material, changes the depth program: skinned, instanced (coloured), morphed. */
const kindOf = (o: Mesh) =>
  ((o as SkinnedMesh).isSkinnedMesh ? 1 : 0) |
  ((o as InstancedMesh).isInstancedMesh ? 2 : 0) |
  ((o as InstancedMesh).instanceColor ? 4 : 0) |
  (o.geometry.morphAttributes.position || o.geometry.morphAttributes.normal ? 8 : 0);

function depthFor(o: Mesh, m: Shown): MeshDepthMaterial {
  const kind = kindOf(o);
  let list = byMaterial.get(m);
  if (!list) byMaterial.set(m, (list = []));
  const known = list[kind];
  if (known) return known;
  const key = [kind, m.side, m.shadowSide, !!m.map, !!m.alphaMap, m.alphaTest > 0, m.alphaToCoverage, !!m.displacementMap, m.clipShadows && (m.clippingPlanes?.length ?? 0), m.wireframe].join('-');
  let depth = depths.get(key);
  if (!depth) depths.set(key, (depth = new MeshDepthMaterial()));
  list[kind] = depth;
  return depth;
}

/**
 * Gives every shadow caster under `root` a shadow depth material of its own kind. Three draws the shadow map with one
 * shared depth material, whose program depends on what it draws (skinned or not, instanced or not, textured, which
 * side): units, weapons and rings taking turns, it rebuilt its program parameters at each switch, some 11 000 times
 * a second in a fight (about 8 MB of garbage a second, and the time). One material per kind keeps each program put.
 * Chosen from the material worn now. A material swapped later (hit flash, corpse, a Z building's fabrication cut)
 * still casts the right shadow: three copies its texture, side and clipping onto the depth material at each draw; at
 * worst that depth material changes program while it lasts. A plain value, not a getter: an accessor on every mesh
 * changed their shape for V8 and slowed every property read of three's render loop (about 5 ms a frame, CPU slowed
 * 4 times).
 */
export function stableShadowDepth(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || o.customDepthMaterial || Array.isArray(mesh.material)) return;
    o.customDepthMaterial = depthFor(mesh, mesh.material as Shown);
  });
}
