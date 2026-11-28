"""The Conseil des échevins (its glass dome board), from its Rodin Low Poly model after tools/meshy/normalize.py
(FOOTPRINT=4.15, height 4.5), in one pass:
1. walls stretched up (k below the eave), the roof and dome lifted unchanged: the wings read slenderer, as the sketch;
2. the dome's glass repainted from the sketch (conseil-chatgpt-dome-hd.png), projected along the game's fixed view,
   so its cyan light column shows;
3. colours: the blue slate and cyan glass held just under teamSkin's mask (civils.py greys the slate instead), the
   stone greyed toward the board's and darkened, its highlights compressed (bloom and rim light blew the stepped
   gables' edges to white);
4. team-colour banners flat on the four corner piers' outward faces, swallow-tailed.
Usage: Blender -b --factory-startup -P tools/meshy/conseildome.py -- in.glb board.png out.glb 1.15 0.6 [0.41 [light]]
(k the walls' stretch, the glass's darkening, where the board's dome ends; the Grand Conseil: 0.46 light), then SIZE=1024 tools/meshy/compress.sh."""
import bpy, bmesh, sys, math, numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
a = sys.argv[sys.argv.index("--") + 1:]
src, sketch, dst = a[:3]; K = float(a[3]) if len(a) > 3 else 1.3
ZC = 1.55  # eave: walls below it stretched by K
GLASS = float(a[4]) if len(a) > 4 else 0.6
DOME_BOTTOM = float(a[5]) if len(a) > 5 else 0.41  # where the board's dome ends, a fraction of its height
# 'light': only the board's light column is taken (the Grand Conseil, whose own glass and gold ribs fit its mesh better).
LIGHT_ONLY = len(a) > 6 and a[6] == "light"
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
o = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]; me = o.data
im = bpy.data.images[0]; S = im.size[0]
tex = np.array(im.pixels[:], dtype=np.float32).reshape(S, S, 4)  # row 0 = bottom
uvd = me.uv_layers.active.data

def col(p):
    u = np.mean([uvd[l].uv[:] for l in p.loop_indices], 0)
    return tex[int(u[1] * S) % S, int(u[0] * S) % S, :3]

# Dome faces, on the original heights: cyan glass or its dark frame, inside the ring, above it.
dome = set()
for p in me.polygons:
    c = col(p); r = math.hypot(p.center.x, p.center.y)
    cyan = c[1] > 0.4 and c[2] > 0.4 and c[1] > 1.2 * c[0]
    if r < 1.05 and p.center.z > 2.5 and (cyan or c.mean() < 0.3): dome.add(p.index)

# 1. stretch
for v in me.vertices:
    v.co.z = v.co.z * K if v.co.z < ZC else v.co.z + ZC * (K - 1)
me.update()

# 2. dome from the sketch, projected along the view (camera at +x -y, 35° up, as in game: door on the left face)
sk = bpy.data.images.load(sketch); W, H = sk.size
skp = np.array(sk.pixels[:], dtype=np.float32).reshape(H, W, 4)[::-1, :, :3]  # row 0 = top
g = skp; m = (g[:, :, 1] > 0.5) & (g[:, :, 2] > 0.5) & (g[:, :, 0] < 0.55 * g[:, :, 1]); m[int(H * DOME_BOTTOM):] = False; m[:, :int(W * 0.29)] = False; m[:, int(W * 0.71):] = False  # the dome only, not the piers' bands
ys, xs = np.nonzero(m); X0, X1, Y0 = np.percentile(xs, 0.5), np.percentile(xs, 99.5), np.percentile(ys, 0.5)
az = math.radians(315); d = Vector((math.cos(az), math.sin(az), 0.7)).normalized()
right = (-d).cross(Vector((0, 0, 1))).normalized(); up = right.cross(-d)
V = np.array([v.co[:] for v in me.vertices]); R = np.array(right[:]); U = np.array(up[:])
dv = np.array(sorted({v for i in dome for v in me.polygons[i].vertices}))
pu, pw = V[dv] @ R, V[dv] @ U
s = (X1 - X0) / (pu.max() - pu.min())
def to_sketch(P):
    return X0 + (P @ R - pu.min()) * s, Y0 + (pw.max() - P @ U) * s
me.calc_loop_triangles(); n = 0
for t in me.loop_triangles:
    if t.polygon_index not in dome: continue
    uv = np.array([uvd[l].uv[:] for l in t.loops]) * S - 0.5; P = V[list(t.vertices)]
    lo = np.floor(uv.min(0)).astype(int) - 1; hi = np.ceil(uv.max(0)).astype(int) + 1
    gx, gy = np.meshgrid(np.arange(lo[0], hi[0] + 1), np.arange(lo[1], hi[1] + 1)); q = np.stack([gx.ravel(), gy.ravel()], 1).astype(float)
    T = np.array([uv[1] - uv[0], uv[2] - uv[0]]).T
    if abs(np.linalg.det(T)) < 1e-9: continue
    b = np.linalg.solve(T, (q - uv[0]).T).T; b = np.column_stack([1 - b.sum(1), b])
    ok = (b > -0.15).all(1); q, b = q[ok].astype(int), b[ok]
    ok = (q[:, 0] >= 0) & (q[:, 0] < S) & (q[:, 1] >= 0) & (q[:, 1] < S); q, b = q[ok], b[ok]
    sx, sy = to_sketch(b @ P)
    px = skp[np.clip(sy.astype(int), 0, H - 1), np.clip(sx.astype(int), 0, W - 1)]
    # The Human skin brightens by 1.3: the glass darkened so the light column (the sketch's brightest) stands out of it.
    lum = px @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
    # Only the sketch's glass and frame: where the fit lands on its stone ring or roof, the model's own glass stays.
    glass = ((px[:, 1] > 0.4) & (px[:, 2] > 0.4) & (px[:, 1] > 1.2 * px[:, 0])) | (lum < 0.3)
    if LIGHT_ONLY: glass = (lum > 0.72) & (px[:, 1] > 1.2 * px[:, 0]) & (px[:, 2] > 1.2 * px[:, 0])  # cyan light, not the gold ribs' highlights
    old = tex[q[:, 1], q[:, 0], :3]
    tex[q[:, 1], q[:, 0], :3] = np.where(glass[:, None], px * np.where(lum > 0.72, 1.0, GLASS)[:, None], old * GLASS); n += len(q)
print("dome faces", len(dome), "texels", n, "sketch box", X0, X1, Y0)

# 3. colours
c = tex.reshape(-1, 4)[:, :3]
mm = np.maximum(c[:, 0] * 1.5, c[:, 1]); team = c[:, 2] - mm
cyan = (c[:, 1] > 0.45) & (c[:, 2] > 0.45) & (c[:, 1] > 1.2 * c[:, 0])
c[:, 2] = np.minimum(c[:, 2], mm + 0.01)
warm = (c[:, 0] - c[:, 2] > 0.12) & (c[:, 1] < 0.85 * c[:, 0]) & (c[:, 0] > 0.45)  # lit windows: left for lifeGlow
rest = (team <= -0.02) & ~cyan
stone = rest & ~((c[:, 0] - c[:, 2] > 0.12) & (c[:, 1] < 0.85 * c[:, 0]) & (c[:, 0] > 0.45))
c[rest & ~stone] *= np.array([0.8, 0.77, 0.71], dtype=np.float32)
# The stone greyed toward the sketch's (its chroma kept at 35 %), darkened as civils.py does for the Human skin's 1.3.
sl = (c[stone] @ np.array([0.3, 0.59, 0.11], dtype=np.float32))[:, None]
c[stone] = (sl + (c[stone] - sl) * 0.35) * 0.8
st = rest & ~warm; lum = c[st] @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
L0 = 0.5; nl = np.where(lum > L0, L0 + (lum - L0) * 0.35, lum)
c[st] *= (nl / np.maximum(lum, 1e-4))[:, None]
tex.reshape(-1, 4)[:, :3] = c

# 4. banners
CELL = (53, 9); k = S // 64
tex[CELL[1]*k+2:(CELL[1]+1)*k-2, CELL[0]*k+2:(CELL[0]+1)*k-2, :3] = (0.10, 0.20, 0.72)
im.pixels[:] = tex.ravel(); im.pack()
UV = ((CELL[0] + 0.5) / 64, (CELL[1] + 0.5) / 64)
bm = bmesh.new(); bm.from_mesh(me); tree = BVHTree.FromBMesh(bm); uvl = bm.loops.layers.uv.active
Z0, Z1, BW, TAIL, PC = 0.62 * K, 1.18 * K, 0.24, 0.09, 1.6
nb = 0
for sx in (-1, 1):
    for sy in (-1, 1):
        for axis in (0, 1):
            dn = Vector((sx, 0, 0)) if axis == 0 else Vector((0, sy, 0))
            side = Vector((0, 1, 0)) if axis == 0 else Vector((1, 0, 0))
            at = Vector((sx * PC, sy * PC, (Z0 + Z1) / 2)) if axis == 0 else Vector((sx * PC, sy * PC, (Z0 + Z1) / 2))
            hit = tree.ray_cast(at + dn * 4, -dn)
            if hit[0] is None: continue
            base = hit[0] + dn * 0.012; base.z = 0
            mid = base.copy() if axis else base.copy()
            ctr = Vector((base.x, sy * PC, 0)) if axis == 0 else Vector((sx * PC, base.y, 0))
            L, Rr = ctr - side * BW / 2, ctr + side * BW / 2; M = ctr
            pts = [L + Vector((0, 0, Z1)), M + Vector((0, 0, Z1)), M + Vector((0, 0, Z0 + TAIL)), L + Vector((0, 0, Z0))], \
                  [M + Vector((0, 0, Z1)), Rr + Vector((0, 0, Z1)), Rr + Vector((0, 0, Z0)), M + Vector((0, 0, Z0 + TAIL))]
            for quad in pts:
                f = bm.faces.new([bm.verts.new(v) for v in quad])
                f.normal_update()
                if f.normal.dot(dn) < 0: f.normal_flip()
                for l in f.loops: l[uvl].uv = UV
            nb += 1
bm.to_mesh(me); bm.free()
print("banners", nb, "height", max(v.co.z for v in me.vertices))
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=90)
