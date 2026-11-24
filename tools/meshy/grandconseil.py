"""The Grand Conseil built from the Conseil des échevins itself: its model and dress as they are, its whole corner
tower replaced, from the ground up, by a Brussels belfry tower (Rodin, from the tower alone cut out of the chosen
board: stepped buttresses, a blue band and banner, a cyan clock, storeys of gothic lancets lit cyan, pinnacles and an
openwork spire with its lights and gilt finial).
The Conseil's texture uses only its left half: it is doubled to 1024 (nothing lost) and the tower's own texture baked
into the free right half, on UVs of its own, then tinted to the Conseil's pale stone (its cyan lights and blue kept).
One mesh, one material: it takes the team colour and the living Human skin like the rest, and render/models.ts
belfryGlow lights its cyan, its lancets steady and the lights high on its spire blinking.
Usage: Blender -b --factory-startup -P tools/meshy/grandconseil.py -- conseil-meshy.glb conseil-dress.glb tower.glb out.glb
(tower.glb: the Rodin tower, its texture moved to base colour by rewire.py), then compress with SIZE=1024.
"""
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

body_src, dress_src, old_src, dst = sys.argv[sys.argv.index("--") + 1:][:4]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=body_src)
body = next(o for o in bpy.context.scene.objects if o.type == "MESH")
before = set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=dress_src)
dress = [o for o in bpy.context.scene.objects if o not in before and o.type == "MESH" and not o.name.startswith("armillary")]
before = set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=old_src)
old = next(o for o in bpy.context.scene.objects if o not in before and o.type == "MESH")
for o in set(bpy.context.scene.objects) - before - {old}:
    bpy.data.objects.remove(o, do_unlink=True)
conseil_img = next(n.image for n in body.data.materials[0].node_tree.nodes if n.type == "TEX_IMAGE")
S = 1024
conseil_img.scale(S, S)


def keep_only(o, test):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    W = o.matrix_world
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not test(W @ f.calc_center_median())], context="FACES")
    bm.to_mesh(o.data)
    bm.free()


# --- The Conseil's whole corner off, its old tower with it: the new tower stands there from the ground, its foot flush
# with the Conseil's plinth (x -2.03, y -1.8 at the ground) and a little proud of it.
TX, TY, WIDE = -1.32, -1.09, 1.5  # the new tower's middle and its width at the foot (world)
H = WIDE / 2 - 0.08
keep_only(body, lambda c: not (abs(c.x - TX) < H and abs(c.y - TY) < H))
keep_only(body, lambda c: not (-1.75 < c.x < -0.35 and -1.5 < c.y < -0.1 and c.z > 2.45))  # the old tower above the roof
for d in dress:  # the dress's pipes that ran round that corner too
    keep_only(d, lambda c: not (abs(c.x - TX) < WIDE / 2 + 0.05 and abs(c.y - TY) < WIDE / 2 + 0.05))
print("TOWER", len(old.data.polygons), "faces")

# Its texture baked into the right half of the Conseil's, on UVs of its own.
src_uv = old.data.uv_layers.active.name
nt = old.data.materials[0].node_tree
tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
uvnode = nt.nodes.new("ShaderNodeUVMap")
uvnode.uv_map = src_uv
nt.links.new(uvnode.outputs["UV"], tex.inputs["Vector"])
bake_uv = old.data.uv_layers.new(name="bake")
old.data.uv_layers.active = bake_uv
bpy.ops.object.select_all(action="DESELECT")
old.select_set(True)
bpy.context.view_layer.objects.active = old
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(island_margin=0.01)
bpy.ops.object.mode_set(mode="OBJECT")
U0, U1, V0, V1 = 0.56, 0.98, 0.02, 0.98  # the free half, a margin kept
bake_uv = old.data.uv_layers["bake"]  # fetched again: the layer moved in memory going through edit mode
for d in bake_uv.data:
    d.uv = (U0 + d.uv.x * (U1 - U0), V0 + d.uv.y * (V1 - V0))
baked = bpy.data.images.new("belfry_bake", S, S, alpha=True)
baked.generated_color = (0, 0, 0, 0)  # what the bake leaves untouched stays the Conseil's
target = nt.nodes.new("ShaderNodeTexImage")
target.image = baked
nt.nodes.active = target
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 1
scene.render.bake.use_pass_direct = False
scene.render.bake.use_pass_indirect = False
scene.render.bake.margin = 4
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"})

# Tinted to the Conseil's stone: pale and warm-grey, as on the Conseil's walls; its cyan and blue glass kept.
b = np.array(baked.pixels[:]).reshape(S, S, 4)
c = np.array(conseil_img.pixels[:]).reshape(S, S, 4)
rgb = b[..., :3]
# Only the free half is written: what the bake covered there (its margin round each island included).
rect = np.zeros((S, S), bool)
rect[int(V0 * S) - 4:int(V1 * S) + 4, int(U0 * S) - 4:int(U1 * S) + 4] = True
alpha = rect & (b[..., 3] > 0.5) & (rgb.sum(axis=-1) > 0.01)
r, g, bl = rgb[..., 0], rgb[..., 1], rgb[..., 2]
glow = (g - r > 0.12) & (bl - r > 0.12)
stone = alpha & ~glow
lum = rgb.mean(axis=-1, keepdims=True)
grey = rgb * 0.45 + lum * 0.55  # half its brown out
gain = 0.38 / max(1e-3, float(np.median(lum[..., 0][stone])))
tinted = np.clip(grey * gain * np.array([1.04, 1.0, 0.92]), 0, 1)
out = np.where(stone[..., None], tinted, rgb)
out = np.where((glow & alpha)[..., None], np.clip(rgb * np.array([0.8, 1.15, 1.15]), 0, 1), out)
c[..., :3] = np.where(alpha[..., None], out, c[..., :3])
conseil_img.pixels[:] = c.ravel()
conseil_img.pack()
print("UV", [round(min(d.uv[i] for d in bake_uv.data), 3) for i in (0, 1)], [round(max(d.uv[i] for d in bake_uv.data), 3) for i in (0, 1)])
print("STONE median", round(float(np.median(lum[..., 0][stone])), 3), "glow px", int((glow & alpha).sum()))

# Its UVs now the baked ones, under the Conseil's layer name; the Conseil's material.
name = body.data.uv_layers.active.name
for layer in [l for l in old.data.uv_layers if l.name != "bake"]:
    old.data.uv_layers.remove(layer)
old.data.uv_layers["bake"].name = name
old.data.materials.clear()
old.data.materials.append(body.data.materials[0])

# Onto the corner, standing on the ground, its foot as wide as WIDE; its clock and banner to the front (-y) as made.
old.data.transform(old.matrix_world)
old.matrix_world.identity()
vs = [v.co for v in old.data.vertices]
lo = Vector([min(v[i] for v in vs) for i in range(3)])
hi = Vector([max(v[i] for v in vs) for i in range(3)])
K = WIDE / max(hi.x - lo.x, hi.y - lo.y)
mx, my = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
for v in old.data.vertices:
    v.co = Vector((TX + (v.co.x - mx) * K, TY + (v.co.y - my) * K, (v.co.z - lo.z) * K))
bpy.ops.object.select_all(action="DESELECT")
old.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
print("TOP", round((hi.z - lo.z) * K, 2))
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_extras=True)
