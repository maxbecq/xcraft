"""Shared helpers for the Dieux concept renders: painted materials, organic bodies (skin modifier),
tapered curves (hair, vines, lightning), cloth sheets, light motes, dreamy staging with bloom."""
import math
import random

import bmesh
import bpy
from mathutils import Vector

MATS = {}
#: Flat stand-in of every material for the game export: name -> (colour, metallic, roughness, emission, strength, alpha).
FLAT = {}
#: Names of the light materials (glow()): kept as their own meshes, not baked into the texture.
GLOWS = set()


def lin(h):
    out = []
    for i in (16, 8, 0):
        c = ((h >> i) & 255) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out


def paint(name, color, metallic=0.0, rough=0.8, dark=0.55, light=1.1, grain=0.2, emission=None, strength=0.0, kind="plain", scale=1.0):
    """Matte, hand-painted look: a dark-to-light ramp up each object, a procedural surface pattern
    (masonry, hammered metal, weave, fur, grain...) that both tints and embosses, and cavities darkened by AO."""
    if name in MATS:
        return MATS[name]
    FLAT[name] = (color, metallic, rough, emission, strength, 1.0)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    n, L = nt.nodes, nt.links
    b = n["Principled BSDF"]
    tc = n.new("ShaderNodeTexCoord")
    sep = n.new("ShaderNodeSeparateXYZ")
    L.new(tc.outputs["Generated"], sep.inputs[0])
    ramp = n.new("ShaderNodeValToRGB")
    c = lin(color)
    ramp.color_ramp.elements[0].color = (*[min(1, x * dark) for x in c], 1)
    ramp.color_ramp.elements[1].color = (*[min(1, x * light) for x in c], 1)
    L.new(sep.outputs["Z"], ramp.inputs[0])
    mp = n.new("ShaderNodeMapping")
    L.new(tc.outputs["Object"], mp.inputs["Vector"])
    vec = mp.outputs["Vector"]

    def tex(t, **inputs):
        node = n.new(t)
        L.new(vec, node.inputs["Vector"])
        for k, v in inputs.items():
            node.inputs[k].default_value = v
        return node

    def math_node(op, a, b_val=None):
        node = n.new("ShaderNodeMath")
        node.operation = op
        L.new(a, node.inputs[0])
        if isinstance(b_val, float) or isinstance(b_val, int):
            node.inputs[1].default_value = b_val
        elif b_val is not None:
            L.new(b_val, node.inputs[1])
        return node.outputs[0]

    fine = tex("ShaderNodeTexNoise", Scale=30.0 * scale, Detail=6.0, Roughness=0.65)
    broad = tex("ShaderNodeTexNoise", Scale=4.0 * scale, Detail=4.0)
    pattern, height, depth, bump_s = fine.outputs["Fac"], fine.outputs["Fac"], 0.35, 0.25
    if kind == "masonry":
        br = tex("ShaderNodeTexBrick", Scale=2.2 * scale, **{"Mortar Size": 0.03, "Mortar Smooth": 0.2, "Bias": 0.0, "Brick Width": 0.6, "Row Height": 0.28})
        br.inputs["Color1"].default_value = (1, 1, 1, 1)
        br.inputs["Color2"].default_value = (0.82, 0.82, 0.82, 1)
        br.inputs["Mortar"].default_value = (0.25, 0.25, 0.25, 1)
        pattern = math_node("MULTIPLY", n.new("ShaderNodeRGBToBW").outputs[0] if False else br.outputs["Fac"], 1.0)
        bw = n.new("ShaderNodeRGBToBW")
        L.new(br.outputs["Color"], bw.inputs[0])
        pattern = math_node("MULTIPLY", bw.outputs[0], math_node("ADD", math_node("MULTIPLY", fine.outputs["Fac"], 0.35), 0.75))
        height = math_node("SUBTRACT", 1.0, br.outputs["Fac"]) if False else bw.outputs[0]
        depth, bump_s = 0.0, 0.6
    elif kind == "stone":
        vo = tex("ShaderNodeTexVoronoi", Scale=5.0 * scale)
        vo.feature = "DISTANCE_TO_EDGE"
        crack = math_node("POWER", math_node("MULTIPLY", vo.outputs["Distance"], 12.0), 0.5)
        crack = math_node("MINIMUM", crack, 1.0)
        pattern = math_node("MULTIPLY", crack, math_node("ADD", math_node("MULTIPLY", fine.outputs["Fac"], 0.5), 0.6))
        height = pattern
        depth, bump_s = 0.0, 0.5
    elif kind == "metal":
        vo = tex("ShaderNodeTexVoronoi", Scale=14.0 * scale)
        dents = vo.outputs["Distance"]
        mp.inputs["Scale"].default_value = (1, 1, 1)
        scr = tex("ShaderNodeTexNoise", Scale=60.0 * scale, Detail=2.0)
        pattern = math_node("ADD", math_node("MULTIPLY", dents, 0.5), math_node("MULTIPLY", scr.outputs["Fac"], 0.5))
        height, depth, bump_s = dents, 0.45, 0.35
    elif kind == "cloth":
        w1 = tex("ShaderNodeTexWave", Scale=70.0 * scale)
        w1.bands_direction = "X"
        w2 = tex("ShaderNodeTexWave", Scale=70.0 * scale)
        w2.bands_direction = "Z"
        weave = math_node("MULTIPLY", w1.outputs["Fac"], w2.outputs["Fac"])
        pattern = math_node("ADD", math_node("MULTIPLY", weave, 0.3), math_node("MULTIPLY", broad.outputs["Fac"], 0.7))
        height, depth, bump_s = weave, 0.4, 0.2
    elif kind == "fur":
        w = tex("ShaderNodeTexWave", Scale=28.0 * scale, Distortion=9.0, Detail=4.0)
        w.bands_direction = "Z"
        pattern = math_node("ADD", math_node("MULTIPLY", w.outputs["Fac"], 0.6), math_node("MULTIPLY", fine.outputs["Fac"], 0.4))
        height, depth, bump_s = w.outputs["Fac"], 0.55, 0.6
    elif kind == "wood":
        w = tex("ShaderNodeTexWave", Scale=6.0 * scale, Distortion=10.0, Detail=5.0)
        w.bands_direction = "Z"
        w.wave_type = "RINGS"
        pattern = w.outputs["Fac"]
        height, depth, bump_s = pattern, 0.5, 0.5
    elif kind == "leaf":
        vo = tex("ShaderNodeTexVoronoi", Scale=16.0 * scale)
        pattern = math_node("ADD", math_node("MULTIPLY", vo.outputs["Distance"], 0.6), math_node("MULTIPLY", fine.outputs["Fac"], 0.4))
        height, depth, bump_s = vo.outputs["Distance"], 0.6, 0.6
    elif kind == "marble":
        # sculpture marble: fine veins wandering through a soft cloudy ground
        v = tex("ShaderNodeTexWave", Scale=2.5 * scale, Distortion=14.0, Detail=6.0, **{"Detail Scale": 2.0})
        vein = math_node("POWER", math_node("ABSOLUTE", math_node("SUBTRACT", v.outputs["Fac"], 0.5)), 0.35)
        pattern = math_node("ADD", math_node("MULTIPLY", vein, 0.55), math_node("MULTIPLY", broad.outputs["Fac"], 0.45))
        height, depth, bump_s = fine.outputs["Fac"], 0.2, 0.06
    elif kind == "skin":
        pattern = math_node("ADD", math_node("MULTIPLY", broad.outputs["Fac"], 0.6), 0.4)
        height, depth, bump_s = fine.outputs["Fac"], 0.25, 0.08
    # tint: darken the low parts of the pattern
    lo = 1.0 - grain * 2.2
    fac = math_node("ADD", math_node("MULTIPLY", pattern, 1.0 - lo), lo)
    col = n.new("ShaderNodeMix")
    col.data_type = "RGBA"
    col.blend_type = "MULTIPLY"
    col.inputs["Factor"].default_value = 1.0
    L.new(ramp.outputs["Color"], col.inputs[6])
    L.new(fac, col.inputs[7])
    # cavities and contact shadows, painted in
    ao = n.new("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 0.25
    aof = math_node("ADD", math_node("MULTIPLY", ao.outputs["AO"], 0.55), 0.45)
    col2 = n.new("ShaderNodeMix")
    col2.data_type = "RGBA"
    col2.blend_type = "MULTIPLY"
    col2.inputs["Factor"].default_value = 1.0
    L.new(col.outputs[2], col2.inputs[6])
    L.new(aof, col2.inputs[7])
    L.new(col2.outputs[2], b.inputs["Base Color"])
    bump = n.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = bump_s
    bump.inputs["Distance"].default_value = 0.02
    L.new(height, bump.inputs["Height"])
    L.new(bump.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    try:
        b.inputs["Specular IOR Level"].default_value = 0.2 if metallic < 0.5 else 0.4
    except KeyError:
        pass
    if emission is not None:
        b.inputs["Emission Color"].default_value = (*lin(emission), 1)
        b.inputs["Emission Strength"].default_value = strength
    MATS[name] = m
    return m


def glow(name, color, strength=6.0, alpha=1.0):
    if name in MATS:
        return MATS[name]
    GLOWS.add(name)
    FLAT[name] = (color, 0.0, 0.3, color, min(strength * 0.3, 1.2), alpha)  # the game blooms: glows kept soft
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*lin(color), 1)
    b.inputs["Emission Color"].default_value = (*lin(color), 1)
    b.inputs["Emission Strength"].default_value = strength
    b.inputs["Roughness"].default_value = 0.3
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            pass
    MATS[name] = m
    return m


def palette():
    return {
        "marble": paint("marble", 0xE8E2D6, kind="masonry", dark=0.62, light=1.05, grain=0.2),
        "marble2": paint("marble2", 0xCFC5B4, kind="stone", dark=0.6, grain=0.2),
        "gold": paint("gold", 0xD8A63A, metallic=0.85, rough=0.45, kind="metal", dark=0.5, light=1.15, grain=0.2),
        "navy": paint("navy", 0x26305A, kind="cloth", grain=0.2),
        "lapis": paint("lapis", 0x2A4EA8, kind="stone", rough=0.6, dark=0.6, grain=0.15),
        "turq": paint("turq", 0x2A9E90, kind="stone", rough=0.6, dark=0.6, grain=0.15),
        "bark": paint("bark", 0x5A3E2C, kind="wood", rough=0.95, grain=0.3, scale=1.5),
        "bark2": paint("bark2", 0x7E5E44, kind="wood", rough=0.95, grain=0.3, scale=2.0),
        "moss": paint("moss", 0x5A8A42, kind="leaf", rough=0.95, dark=0.5, light=1.15, grain=0.3),
        "leaf": paint("leaf", 0x6EAE52, kind="leaf", dark=0.5, light=1.2, grain=0.3),
        "leafglow": paint("leafglow", 0x7ECCA4, kind="leaf", dark=0.5, light=1.15, grain=0.3, emission=0x30A888, strength=0.25),
        "jade": paint("jade", 0x96C8A4, kind="stone", rough=0.7, dark=0.6, light=1.08, grain=0.12, scale=2.0),
        "skin": paint("skin", 0xD8A07A, kind="skin", dark=0.62, light=1.08, grain=0.15),
        "bronze_skin": paint("bronze_skin", 0x8E603E, kind="skin", dark=0.6, grain=0.15),
        "steel": paint("steel", 0x8C939C, metallic=0.6, rough=0.55, kind="metal", dark=0.45, light=1.2, grain=0.25),
        "iron": paint("iron", 0x4E545E, metallic=0.6, rough=0.6, kind="metal", dark=0.5, grain=0.25),
        "copper": paint("copper", 0xB85A26, kind="fur", rough=0.95, dark=0.5, light=1.2, grain=0.3, scale=1.6),
        "fur": paint("fur", 0x664330, kind="fur", rough=1.0, dark=0.5, light=1.15, grain=0.3),
        "fur_light": paint("fur_light", 0xB8A488, kind="fur", rough=1.0, grain=0.3),
        "horn": paint("horn", 0xE2D4B4, kind="wood", rough=0.7, dark=0.5, grain=0.15, scale=3.0),
        "white": paint("white", 0xEDE6D8, kind="cloth", dark=0.65, grain=0.15),
        "sand": paint("sand", 0xCDA868, kind="stone", rough=0.95, grain=0.2, scale=1.5),
        "jackal": paint("jackal", 0x23222E, kind="fur", rough=0.9, dark=0.6, light=1.5, grain=0.2, scale=2.0),
        "leather": paint("leather", 0x5E3A24, kind="cloth", rough=0.85, grain=0.2, scale=0.5),
        "statue": paint("statue", 0xF0E9DC, kind="marble", rough=0.55, dark=0.72, light=1.04, grain=0.18, scale=1.2),
        "statue2": paint("statue2", 0xE2D8C4, kind="marble", rough=0.6, dark=0.66, light=1.04, grain=0.2, scale=1.6),
        "team": paint("team", 0xB83232, kind="cloth", dark=0.5, light=1.12, grain=0.22),
        "stone": paint("stone", 0xC4B496, kind="stone", rough=0.95, grain=0.22),
        "wood_dark": paint("wood_dark", 0x3E2A1E, kind="wood", rough=0.9, grain=0.3, scale=4.0),
        "granite": paint("granite", 0x6A6660, kind="stone", rough=0.9, grain=0.25, scale=2.0),
        "shadow": paint("shadow", 0x1A1210, rough=1.0, dark=1.0, light=1.0, grain=0.05),
        "embroid": paint("embroid", 0xC89A3A, kind="cloth", rough=0.8, grain=0.25, scale=2.0),
        "ether": glow("ether", 0x5FF4E4, 6.0),
        "ether_veil": glow("ether_veil", 0x6FF0E0, 1.6, alpha=0.45),
        "ether_soft": glow("ether_soft", 0x70E8D8, 1.4, alpha=0.8),
        "bloom_pink": glow("bloom_pink", 0xFFA8E0, 5.0),
        "firefly": glow("firefly", 0xF4FF90, 8.0),
        "sun": glow("sun", 0xFFC050, 8.0),
        "sun_veil": glow("sun_veil", 0xFFB040, 2.0, alpha=0.22),
        "bolt": glow("bolt", 0xBFE4FF, 12.0),
        "amber": glow("amber", 0xFFAA30, 8.0),
        "sand_veil": glow("sand_veil", 0xF0D49A, 1.5, alpha=0.25),
    }


def _fin(o, m, smooth=False):
    o.data.materials.clear()
    o.data.materials.append(m)
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    return o


def _apply(o, mod):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=mod.name)


def box(m, size, loc, rot=(0, 0, 0), bevel=0.3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    mod = o.modifiers.new("b", "BEVEL")
    mod.width = min(size) * bevel * 0.5
    mod.segments = 2
    _apply(o, mod)
    return _fin(o, m, True)


def cyl(m, r, d, loc, rot=(0, 0, 0), v=24, r2=None, smooth=True):
    bpy.ops.mesh.primitive_cone_add(vertices=v, radius1=r, radius2=r if r2 is None else r2, depth=d, location=loc, rotation=rot)
    return _fin(bpy.context.active_object, m, smooth)


def ball(m, r, loc, scale=(1, 1, 1), rot=(0, 0, 0), seg=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = scale
    return _fin(o, m, True)


def ico(m, r, loc, sub=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r, location=loc)
    return _fin(bpy.context.active_object, m, False)


def torus(m, R, r, loc, rot=(0, 0, 0), seg=48):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc, rotation=rot, major_segments=seg, minor_segments=10)
    return _fin(bpy.context.active_object, m, True)


def body(m, pts, edges, radii, sub=2):
    """Organic volume from a stick skeleton (skin modifier + subdivision)."""
    me = bpy.data.meshes.new("skin")
    me.from_pydata([Vector(p) for p in pts], edges, [])
    o = bpy.data.objects.new("skin", me)
    bpy.context.scene.collection.objects.link(o)
    o.modifiers.new("skin", "SKIN")
    for i, r in enumerate(radii):
        rr = r if isinstance(r, (tuple, list)) else (r, r)
        me.skin_vertices[0].data[i].radius = rr
    me.skin_vertices[0].data[0].use_root = True
    s = o.modifiers.new("sub", "SUBSURF")
    s.levels = sub
    for mod in list(o.modifiers):
        _apply(o, mod)
    return _fin(o, m, True)


def strand(m, pts, r0, r1=0.0, res=6):
    """Tapered tube along points: hair, beards, vines, roots, ribbons, lightning."""
    cu = bpy.data.curves.new("c", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 1.0
    cu.bevel_resolution = 2
    cu.resolution_u = res
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(len(pts) - 1)
    for i, (p, bp) in enumerate(zip(pts, sp.bezier_points)):
        bp.co = Vector(p)
        bp.handle_left_type = bp.handle_right_type = "AUTO"
        t = i / max(1, len(pts) - 1)
        bp.radius = r0 + (r1 - r0) * t
    o = bpy.data.objects.new("c", cu)
    bpy.context.scene.collection.objects.link(o)
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    return _fin(o, m, True)


def bolt(m, a, b, seed, jag=0.12, n=7, r=0.012):
    rng = random.Random(seed)
    a, b = Vector(a), Vector(b)
    pts = []
    for i in range(n + 1):
        t = i / n
        p = a.lerp(b, t)
        if 0 < i < n:
            p += Vector((rng.uniform(-jag, jag), rng.uniform(-jag, jag), rng.uniform(-jag, jag)))
        pts.append(p)
    cu = bpy.data.curves.new("bolt", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, sp_p in zip(pts, sp.points):
        sp_p.co = (*p, 1)
    o = bpy.data.objects.new("bolt", cu)
    bpy.context.scene.collection.objects.link(o)
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target="MESH")
    return _fin(bpy.context.active_object, m)


def sheet(m, w, h, fn, loc=(0, 0, 0), cuts=16, thick=0.02):
    """Cloth: a grid whose vertices fn(u, v) places (u across, v down, both 0..1)."""
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=cuts, y_subdivisions=cuts, size=1, location=(0, 0, 0))
    o = bpy.context.active_object
    for v in o.data.vertices:
        u, t = v.co.x + 0.5, 0.5 - v.co.y
        v.co = Vector(fn(u, t)) + Vector(loc)
    s = o.modifiers.new("s", "SOLIDIFY")
    s.thickness = thick
    _apply(o, s)
    return _fin(o, m, True)


def motes(m, centre, radius, n, seed, size=0.02, zmin=0.0, zmax=None):
    rng = random.Random(seed)
    c = Vector(centre)
    out = []
    for _ in range(n):
        a = rng.uniform(0, math.tau)
        r = radius * math.sqrt(rng.random())
        z = rng.uniform(zmin, zmax if zmax is not None else radius)
        out.append(ico(m, size * rng.uniform(0.6, 1.4), (c.x + math.cos(a) * r, c.y + math.sin(a) * r, c.z + z), 1))
    return out


def ring_of(n, R, fn, phase=0.0):
    for i in range(n):
        a = i / n * math.tau + phase
        fn(a, math.cos(a) * R, math.sin(a) * R)


# ------------------------------------------------------------------ staging
def stage(ground=0xA08058, sky=0xA8B0D0, bloom=0.5):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    try:
        sc.eevee.taa_render_samples = 64
        sc.eevee.use_shadows = True
    except Exception:
        pass
    p = palette()
    bpy.ops.mesh.primitive_plane_add(size=300)
    _fin(bpy.context.active_object, paint("ground", ground, rough=1.0, dark=1.0, light=1.0, grain=0.18, kind="stone", scale=0.7))
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.6
    sun.data.color = lin(0xFFE6C4)
    sun.data.angle = math.radians(4)
    sun.rotation_euler = (math.radians(45), math.radians(-28), math.radians(32))
    sc.collection.objects.link(sun)
    fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "SUN"))
    fill.data.energy = 0.9
    fill.data.color = lin(0x9FB4FF)
    fill.rotation_euler = (math.radians(60), math.radians(30), math.radians(-150))
    sc.collection.objects.link(fill)
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (*lin(sky), 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    sc.world = w
    # bloom: the glows bleed softly into the air
    ng = bpy.data.node_groups.new("comp", "CompositorNodeTree")
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    rl = ng.nodes.new("CompositorNodeRLayers")
    gl = ng.nodes.new("CompositorNodeGlare")
    try:
        gl.inputs["Type"].default_value = "Bloom"
    except Exception:
        pass
    gl.inputs["Strength"].default_value = bloom
    gl.inputs["Threshold"].default_value = 0.9
    gl.inputs["Size"].default_value = 0.55
    out = ng.nodes.new("NodeGroupOutput")
    ng.links.new(rl.outputs["Image"], gl.inputs["Image"])
    ng.links.new(gl.outputs[0], out.inputs[0])
    sc.compositing_node_group = ng
    # ink outlines, like the game's ink pass
    try:
        sc.render.use_freestyle = True
        sc.render.line_thickness_mode = "ABSOLUTE"
        sc.render.line_thickness = 1.1
        fs = sc.view_layers[0].freestyle_settings
        ls = fs.linesets[0] if len(fs.linesets) else fs.linesets.new("ink")
        if ls.linestyle is None:
            ls.linestyle = bpy.data.linestyles.new("ink")
        ls.linestyle.color = lin(0x2A1C12)
        ls.linestyle.alpha = 0.85
        ls.select_by_visibility = True
        ls.select_silhouette = True
        ls.select_border = True
        ls.select_crease = False
    except Exception as e:
        print("FREESTYLE", e)
    return p


def group(fn, p, at=(0, 0, 0), scale=1.0, yaw=0.0):
    before = set(bpy.data.objects)
    fn(p)
    objs = [o for o in bpy.data.objects if o not in before]
    e = bpy.data.objects.new(fn.__name__, None)
    bpy.context.scene.collection.objects.link(e)
    for o in objs:
        o.parent = e
    e.location = at
    e.scale = (scale,) * 3
    e.rotation_euler = (0, 0, yaw)
    return objs


def shoot(objs, path, w, h, pad=1.1, fixed=None, az=-28):
    sc = bpy.context.scene
    bpy.context.view_layer.update()
    corners = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
    centre = sum(corners, Vector()) / len(corners)
    elev, a = math.radians(35), math.radians(az)
    d = Vector((math.sin(a) * math.cos(elev), -math.cos(a) * math.cos(elev), math.sin(elev)))
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    cam.location = centre + d * 80
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    xs = [(inv @ c).x for c in corners]
    ys = [(inv @ c).y for c in corners]
    cam.location = cam.matrix_world @ Vector(((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, 0))
    cd.ortho_scale = fixed or max((max(xs) - min(xs)) * pad, (max(ys) - min(ys)) * pad * w / h)
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def along(m, a, b, r1, r2=None, v=16):
    """A tapered cylinder from point a to point b (bracers, greaves, staffs)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    o = cyl(m, r1, d.length, tuple((a + b) / 2), v=v, r2=r2)
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return o


def skirt(m, z0, z1, r0, r1, pleats=18, depth=0.02, gap=0.0, front=-1, sway=0.0):
    """Pleated cloth hanging from z0 down to z1, flaring from radius r0 to r1; gap opens it at the front."""
    def f(u, t):
        a = (gap / 2 + u * (math.tau - gap)) + (math.pi / 2 if front < 0 else -math.pi / 2) * 0 - math.pi / 2
        r = r0 + (r1 - r0) * t + depth * math.sin(u * pleats * math.tau) * t
        return (math.cos(a) * r, math.sin(a) * r + sway * t * t, z0 + (z1 - z0) * t)
    return sheet(m, 1, 1, f, cuts=max(24, pleats * 3), thick=0.012)


K_META = 0.574  # visible radius of a metaball element of radius 1 (stiffness 2, threshold 0.6)


def meta(m, caps=(), blobs=(), res=0.018):
    """Organic sculpt from metaballs that melt together: capsules (a, b, r) for limbs,
    ellipsoids (centre, r, (sx, sy, sz), euler) for muscles and masses. Radii are visible radii."""
    from mathutils import Euler, Quaternion
    mb = bpy.data.metaballs.new("mb")
    mb.resolution = res
    mb.render_resolution = res
    mb.threshold = 0.6
    o = bpy.data.objects.new("mb", mb)
    bpy.context.scene.collection.objects.link(o)
    for a, b, r in caps:
        a, b = Vector(a), Vector(b)
        d = b - a
        e = mb.elements.new(type="CAPSULE")
        e.co = (a + b) / 2
        e.radius = r / K_META
        e.size_x = max(d.length / 2, 1e-4)
        e.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized()) if d.length > 1e-6 else Quaternion()
    for c, r, s, rot in blobs:
        e = mb.elements.new(type="ELLIPSOID")
        e.co = Vector(c)
        e.radius = r / K_META
        e.size_x, e.size_y, e.size_z = s
        e.rotation = Euler(rot).to_quaternion()
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    out = bpy.context.active_object
    return _fin(out, m, True)


def fist(p, m, at, facing=(0, -1, 0), r=0.05, grip_axis=(0, 0, 1)):
    """A closed hand: palm, four curled fingers, thumb over them."""
    at = Vector(at)
    f = Vector(facing).normalized()
    g = Vector(grip_axis).normalized()
    side = f.cross(g).normalized()
    blobs = [(tuple(at), r, (1.0, 1.0, 1.15), (0, 0, 0))]
    caps = []
    for i in range(4):
        base = at + g * (r * (0.75 - i * 0.5)) + f * r * 0.6
        caps.append((tuple(base), tuple(base + f * r * 0.5 - side * r * 0.6), r * 0.34))
    tb = at + side * r * 0.7 + g * r * 0.6
    caps.append((tuple(tb), tuple(tb + f * r * 0.8 - g * r * 0.2), r * 0.32))
    return meta(m, caps, blobs, res=0.01)


def face(p, skin, centre, s=1.0, eye="ether", brow=True):
    """Head with brow ridge, cheekbones, nose, jaw and ears; eyes as small glowing points in shadowed sockets."""
    cx, cy, cz = centre
    meta(skin, caps=[((cx, cy - 0.02 * s, cz - 0.07 * s), (cx, cy - 0.06 * s, cz - 0.1 * s), 0.055 * s)],
         blobs=[((cx, cy + 0.01 * s, cz + 0.01 * s), 0.115 * s, (0.88, 1.0, 1.05), (0, 0, 0)),
                ((cx, cy - 0.085 * s, cz + 0.035 * s), 0.05 * s, (1.9, 0.6, 0.55), (0, 0, 0)),
                ((cx, cy - 0.11 * s, cz - 0.01 * s), 0.025 * s, (0.7, 1.0, 1.6), (0.4, 0, 0)),
                ((cx - 0.055 * s, cy - 0.07 * s, cz - 0.015 * s), 0.035 * s, (1, 0.8, 0.8), (0, 0, 0)),
                ((cx + 0.055 * s, cy - 0.07 * s, cz - 0.015 * s), 0.035 * s, (1, 0.8, 0.8), (0, 0, 0)),
                ((cx - 0.105 * s, cy + 0.01 * s, cz), 0.03 * s, (0.5, 0.9, 1.3), (0, 0, 0)),
                ((cx + 0.105 * s, cy + 0.01 * s, cz), 0.03 * s, (0.5, 0.9, 1.3), (0, 0, 0))], res=0.008)
    for x in (-0.04, 0.04):
        ball(p["shadow"], 0.022 * s, (cx + x * s, cy - 0.08 * s, cz + 0.01 * s))
        ball(p[eye], 0.011 * s, (cx + x * s, cy - 0.097 * s, cz + 0.01 * s))
    box(p["shadow"], (0.05 * s, 0.01 * s, 0.008 * s), (cx, cy - 0.105 * s, cz - 0.065 * s))
