"""Build the light web version of the 3D Yui model for the cottage.

Run with Blender 5.x (the source .blend is only read, never saved):
  blender -b <Yui_Final_opt.blend> --python tools/assets/export_yui_web.py -- <out.glb>

Steps: keep a few face shapes (blink, vowels, smile) and drop the cloth correctives; reduce the meshes that
have no shapes left; bake every material's colour into one small texture; export a GLB with WebP textures.
"""
import sys
from pathlib import Path

import bpy
import numpy as np

OUT = Path(sys.argv[sys.argv.index("--") + 1])
D = bpy.data

KEEP_SHAPES = {
    "Blink_L", "Blink_R", "Mouth_A", "Mouth_I", "Mouth_U", "Mouth_E", "Mouth_O", "Mouth_Smile", "Eye_HappyLift", "Eye_Wide",
    "Brow_Raise", "Brow_Worried", "Brow_Lower",
}
# Texture size per material (pixels); the face and hair stay a bit sharper.
SIZES = {"Yui_v143_Face_TextureConnectionsFixed_Visible": 2048, "Yui_v36_Hair": 2048}
DEFAULT_SIZE = 1024
# Materials whose look is not a plain diffuse colour: exported with their own image, unlit.
UNLIT = {"Yui_v42_EyeHighlight"}


def ratio_for(obj, tris):
    name = obj.name
    if tris < 1200:
        return 1.0
    if any(part in name for part in ("Hand", "Shoe", "Skin")):
        return .6
    if "Pendant" in name:
        return .25
    return .35


def meshes():
    return [o for o in D.objects if o.type == "MESH" and not o.hide_render]


# 1. Drop helper objects and the drivers that read them; keep the shapes' current values as their defaults.
for o in meshes():
    keys = o.data.shape_keys
    if keys and keys.animation_data:
        for driver in list(keys.animation_data.drivers):
            keys.animation_data.drivers.remove(driver)
for o in list(D.objects):
    if o.type not in ("MESH", "ARMATURE"):
        D.objects.remove(o, do_unlink=True)

# 2. Shapes: keep the face set, remove everything else.
for o in meshes():
    keys = o.data.shape_keys
    if not keys:
        continue
    for block in list(keys.key_blocks[1:]):
        if block.name not in KEEP_SHAPES:
            if abs(block.value) > 1e-4:
                print("SHAPE-DROP-NONZERO", o.name, block.name, round(block.value, 3))
            o.shape_key_remove(block)
        else:
            block.value = 0
    if len(keys.key_blocks) == 1:
        o.shape_key_clear()

# 3. Reduce meshes without shapes.
depsgraph = bpy.context.evaluated_depsgraph_get()
before = after = 0
for o in meshes():
    tris = len(o.evaluated_get(depsgraph).data.loop_triangles)
    before += tris
    ratio = ratio_for(o, tris)
    if o.data.shape_keys or ratio >= 1:
        continue
    bpy.context.view_layer.objects.active = o
    modifier = o.modifiers.new("WebDecimate", "DECIMATE")
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = True
    while o.modifiers[0] != modifier:
        bpy.ops.object.modifier_move_up(modifier=modifier.name)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
depsgraph = bpy.context.evaluated_depsgraph_get()
after = sum(len(o.evaluated_get(depsgraph).data.loop_triangles) for o in meshes())
print("TRIS", before, "->", after)


# The red eyeliner accents are full-strength pure red in the source and read as bloodshot at web scale:
# soften them to a rose tint at about half strength before baking.
EYELINER = {"OuterLidRed_Blend_v105", "LashGap_HardTriangle_Red_Blend_v135"}
for material in D.materials:
    if not material.use_nodes:
        continue
    tree = material.node_tree
    for node in list(tree.nodes):
        if node.name not in EYELINER or not node.inputs["Fac"].is_linked:
            continue
        node.inputs["Color2"].default_value = (.72, .26, .28, 1)
        source = node.inputs["Fac"].links[0].from_socket
        scale = tree.nodes.new("ShaderNodeMath")
        scale.operation = "MULTIPLY"
        scale.inputs[1].default_value = .55
        tree.links.new(source, scale.inputs[0])
        tree.links.new(scale.outputs["Value"], node.inputs["Fac"])
        print("EYELINER", material.name, node.name)


# Eyes (0.9.48): the source eyes read as a cat's (slit-like oval pupils, a red flick at the outer corners, reddish
# lashes). The project owner asked for an ordinary pretty anime girl's eyes: a round pupil in a layered iris with
# its own highlights, no red liner, dark lashes.
EYELINER_STRENGTH = 0  # the red liner and lash-gap accents are gone; 0.55 kept a rose tint before 0.9.48
for material in D.materials:
    if not material.use_nodes:
        continue
    for node in material.node_tree.nodes:
        if node.bl_idname == "ShaderNodeMath" and node.inputs[0].is_linked and node.outputs["Value"].is_linked \
                and node.outputs["Value"].links[0].to_node.name in EYELINER:
            node.inputs[1].default_value = EYELINER_STRENGTH


def paint_iris(size=1024):
    """An anime iris as RGBA rows (top row first), filling the iris UV square."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    u = (x + .5) / size * 2 - 1
    v = (y + .5) / size * 2 - 1  # -1 top .. 1 bottom
    rim = .94
    r = np.hypot(u, v) / rim
    angle = np.arctan2(v, u)
    hex_ = lambda h: np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)

    def blend(base, color, amount):
        return base + (color - base) * np.clip(amount, 0, 1)[..., None]

    # Deep indigo at the top to clear sky blue at the bottom.
    t = np.clip((v / rim + 1) / 2, 0, 1)[..., None]
    stops = [(0, hex_("#1a1a4e")), (.42, hex_("#2c4fb8")), (.72, hex_("#3d8fe6")), (1, hex_("#8fe3ff"))]
    color = np.zeros((size, size, 3), np.float32)
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        k = np.clip((t - t0) / (t1 - t0), 0, 1)
        color = np.where((t >= t0) & (t <= t1), c0 + (c1 - c0) * k, color)
    # Fine radial strands, brighter in the lower half.
    strands = .5 + .5 * np.sin(angle * 46) * np.sin(angle * 17 + 1.3)
    color = blend(color, color * 1.25, strands * .35 * np.clip(v + .2, 0, 1) * (r > .38) * (r < .92))
    # A soft light ring around the pupil, and a dark ring at the rim.
    color = blend(color, hex_("#6fb8ff"), .35 * np.exp(-((r - .46) / .07) ** 2) * np.clip(v + .6, 0, 1))
    color = blend(color, hex_("#101238"), np.clip((r - .8) / .14, 0, 1) * .9)
    # The upper lid's shadow.
    color = blend(color, color * .45, np.clip((-.2 - v) / .55, 0, 1) * .85)
    # Round pupil, a touch taller than wide.
    pupil = np.hypot(u / .30, (v - .03) / .33)
    color = blend(color, hex_("#0b0a24"), np.clip((1.06 - pupil) / .12, 0, 1))
    # Glow along the bottom inside the rim.
    glow = np.exp(-((r - .74) / .1) ** 2) * np.clip((v - .25) / .5, 0, 1) * (np.abs(u) < .85)
    color = blend(color, hex_("#b8f2ff"), glow * .55)
    # Highlights: a large soft one upper left, a small one lower right.
    big = np.hypot((u + .3) / .2, (v + .36) / .25)
    small = np.hypot((u - .3) / .09, (v - .34) / .08)
    color = blend(color, np.ones(3, np.float32), np.clip((1.05 - big) / .12, 0, 1) * .95)
    color = blend(color, np.ones(3, np.float32), np.clip((1.05 - small) / .2, 0, 1) * .85)
    rgba = np.concatenate([np.clip(color, 0, 1), np.ones((size, size, 1), np.float32)], axis=2)
    return rgba


def image_from(rows, name):
    size = rows.shape[0]
    image = D.images.new(name, size, size, alpha=True)
    image.colorspace_settings.name = "sRGB"
    image.pixels.foreach_set(rows[::-1].reshape(-1))  # Blender stores the bottom row first
    return image


iris = image_from(paint_iris(), "Yui_Iris_Round_v148")
for material in D.materials:
    if "Iris" in material.name and material.use_nodes:
        for node in material.node_tree.nodes:
            if node.bl_idname == "ShaderNodeTexImage" and node.image and "Iris" in node.image.name:
                node.image = iris
                print("IRIS", material.name)

# Lashes: the upper lash texture is a warm red-brown; make it a dark, slightly cool brown.
for material in D.materials:
    if "UpperLashes" not in material.name or not material.use_nodes:
        continue
    tree = material.node_tree
    shader = next(n for n in tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    link = shader.inputs["Base Color"].links[0] if shader.inputs["Base Color"].is_linked else None
    if not link:
        continue
    tone = tree.nodes.new("ShaderNodeHueSaturation")
    tone.inputs["Saturation"].default_value = .25
    tone.inputs["Value"].default_value = .38
    tree.links.new(link.from_socket, tone.inputs["Color"])
    tree.links.new(tone.outputs["Color"], shader.inputs["Base Color"])
    print("LASHES", material.name)


# Face shading (0.9.48). Anime faces are shaded as if the face were a smooth ball, so light makes one clean,
# simple shape across it instead of following the nose, cheeks and eye sockets (which read as dirty patches).
# The head's own corner normals are bent toward an ellipsoid round the skull, fully on the face, fading out
# down the neck. Shapes keep their own geometry; only the normals change.
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HEAD = D.objects.get("Base_Head")
HEAD_CENTER = Vector((0, -.03, 1.04))  # Blender axes: x right, -y front, z up
HEAD_RADII = Vector((.07, .075, .09))


def smoothstep(edge0, edge1, x):
    t = min(1, max(0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


if HEAD:
    mesh = HEAD.data
    world = HEAD.matrix_world
    turn = world.to_3x3().inverted().transposed()
    vertex_world = [world @ v.co for v in mesh.vertices]
    weight = [smoothstep(.95, .985, p.z) * .9 for p in vertex_world]

    def ball(p):
        d = p - HEAD_CENTER
        return Vector((d.x / HEAD_RADII.x ** 2, d.y / HEAD_RADII.y ** 2, d.z / HEAD_RADII.z ** 2)).normalized()

    local_turn = world.to_3x3().transposed()  # world direction -> object direction (rotation only here)
    normals = []
    for loop in mesh.loops:
        own = (turn @ mesh.corner_normals[loop.index].vector).normalized()
        w = weight[loop.vertex_index]
        bent = own.lerp(ball(vertex_world[loop.vertex_index]), w).normalized() if w > 0 else own
        normals.append((local_turn @ bent).normalized())
    mesh.normals_split_custom_set(normals)
    print("FACE-NORMALS", sum(1 for w in weight if w > .5), "of", len(weight))

    # The fringe's shadow on the face, baked into a vertex colour: rays from each face point toward a light
    # above and in front; where the front hair is in the way, the skin takes the shade colour. Static on purpose:
    # a fixed, well-shaped hair shadow is how anime faces are drawn, and it never flickers like a shadow map.
    depsgraph = bpy.context.evaluated_depsgraph_get()
    trees = [BVHTree.FromObject(D.objects[name], depsgraph) for name in ("Yui_Hair_Front", "Yui_Hair_FrontStrands")
             if name in D.objects]
    light = Vector((0, -.45, 1)).normalized()
    side = light.cross(Vector((1, 0, 0))).normalized()
    across = light.cross(side).normalized()
    rays = [light] + [(light + .14 * a).normalized() for a in (side, -side, across, -across)]
    SHADE = (.8, .7, .76, 1)
    shade = [0.0] * len(mesh.vertices)
    # Only just under the fringe (from the eyes up) and only hair close above: further down, the long side
    # strands caught the rays and left blotches over the nose and mouth.
    for index, p in enumerate(vertex_world):
        if p.z < 1.04 or p.y > -.02:
            continue
        hits = sum(1 for ray in rays for tree in trees if tree.ray_cast(p + ray * .0015, ray, .035)[0] is not None)
        shade[index] = min(1, hits / len(rays))
    # Two rounds of averaging with neighbours soften the edge into a clean band.
    neighbours = [[] for _ in mesh.vertices]
    for edge in mesh.edges:
        a, b = edge.vertices
        neighbours[a].append(b)
        neighbours[b].append(a)
    for _ in range(2):
        shade = [(s + sum(shade[n] for n in near)) / (1 + len(near)) if near else s for s, near in zip(shade, neighbours)]
    attribute = mesh.color_attributes.new("HairShadow", "BYTE_COLOR", "POINT")
    for index, amount in enumerate(shade):
        attribute.data[index].color = [1 + (s - 1) * amount for s in SHADE]
    mesh.color_attributes.active_color = attribute
    print("HAIR-SHADOW", sum(1 for s in shade if s > .5), "shaded vertices")


# 4. Bake colour. Each material gets an image; one bake writes all of them.
def uv_name(material):
    node = next((n for n in material.node_tree.nodes if n.bl_idname == "ShaderNodeUVMap"), None)
    return node.uv_map if node and node.uv_map else None


def alpha_source(material):
    """The image whose alpha drives the material's transparency, if any."""
    for node in material.node_tree.nodes:
        if node.bl_idname == "ShaderNodeBsdfPrincipled" and node.inputs["Alpha"].is_linked:
            link = node.inputs["Alpha"].links[0]
            if link.from_node.bl_idname == "ShaderNodeTexImage":
                return link.from_node.image
        if node.bl_idname == "ShaderNodeMixShader" and node.inputs["Fac"].is_linked:
            link = node.inputs["Fac"].links[0]
            if link.from_node.bl_idname == "ShaderNodeTexImage":
                return link.from_node.image
    return None


used = {}
for o in meshes():
    for slot in o.material_slots:
        if slot.material:
            used.setdefault(slot.material.name, []).append(o)

baked = {}
for name in used:
    material = D.materials[name]
    if name in UNLIT:
        continue
    size = SIZES.get(name, DEFAULT_SIZE)
    image = D.images.new(f"web_{name}", size, size, alpha=True)
    image.colorspace_settings.name = "sRGB"
    node = material.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    material.node_tree.nodes.active = node
    baked[name] = image

for o in meshes():
    wanted = {uv_name(s.material) for s in o.material_slots if s.material}
    wanted.discard(None)
    if len(wanted) > 1:
        print("UV-CONFLICT", o.name, wanted)
    if wanted:
        o.data.uv_layers.active = o.data.uv_layers[next(iter(wanted))]

scene = bpy.context.scene
scene.render.engine = "CYCLES"
try:
    preferences = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            preferences.compute_device_type = kind
            preferences.get_devices()
            if any(d.type == kind for d in preferences.devices):
                for d in preferences.devices:
                    d.use = True
                scene.cycles.device = "GPU"
                print("BAKE-DEVICE", kind)
                break
        except TypeError:
            continue
except KeyError:
    pass
scene.cycles.samples = 4
scene.render.bake.margin = 8
bpy.ops.object.select_all(action="DESELECT")
targets = [o for o in meshes() if any(s.material and s.material.name in baked for s in o.material_slots)]
for o in targets:
    o.select_set(True)
bpy.context.view_layer.objects.active = targets[0]
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_clear=True, margin=8)


def copy_alpha(target, source):
    copy = source.copy()
    copy.scale(target.size[0], target.size[1])
    alpha = np.empty(len(copy.pixels), dtype=np.float32)
    copy.pixels.foreach_get(alpha)
    pixels = np.empty(len(target.pixels), dtype=np.float32)
    target.pixels.foreach_get(pixels)
    pixels[3::4] = alpha[3::4]
    target.pixels.foreach_set(pixels)
    D.images.remove(copy)


# 5. Replace each material with a plain one the glTF exporter understands.
for name in used:
    material = D.materials[name]
    source_alpha = alpha_source(material)
    uv = uv_name(material)
    if name in UNLIT:
        source = next(n.image for n in material.node_tree.nodes if n.bl_idname == "ShaderNodeTexImage" and n.image)
        image = source
    else:
        image = baked[name]
        if source_alpha:
            copy_alpha(image, source_alpha)
        else:
            pixels = np.empty(len(image.pixels), dtype=np.float32)
            image.pixels.foreach_get(pixels)
            pixels[3::4] = 1
            image.pixels.foreach_set(pixels)
    image.pack()
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    if uv:
        uv_node = tree.nodes.new("ShaderNodeUVMap")
        uv_node.uv_map = uv
        tree.links.new(uv_node.outputs["UV"], texture.inputs["Vector"])
    shader = tree.nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Roughness"].default_value = .7
    shader.inputs["Specular IOR Level"].default_value = .25
    tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    if name in UNLIT:
        tree.links.new(texture.outputs["Color"], shader.inputs["Emission Color"])
        shader.inputs["Emission Strength"].default_value = 1
        shader.inputs["Base Color"].default_value = (0, 0, 0, 1)
    transparent = name in UNLIT or source_alpha is not None
    if transparent:
        tree.links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
    material.surface_render_method = "BLENDED" if transparent else "DITHERED"
    tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    print("MATERIAL", name, image.size[:], "alpha" if transparent else "opaque")

# Keep only the UV map each mesh uses.
for o in meshes():
    keep = {uv_name(s.material) for s in o.material_slots if s.material} - {None}
    for layer in list(o.data.uv_layers):
        if keep and layer.name not in keep:
            o.data.uv_layers.remove(layer)

# 6. Export.
OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(OUT), export_format="GLB", export_image_format="WEBP", export_image_quality=82,
    export_yup=True, export_apply=False, export_skins=True, export_morph=True, export_morph_normal=False,
    export_animations=False, export_cameras=False, export_lights=False, export_extras=False,
    export_tangents=False, use_visible=False,
    # Only the baked fringe shadow on the head (see "Face shading"); no other colour layers.
    export_vertex_color="NAME", export_vertex_color_name="HairShadow", export_all_vertex_colors=False,
)
print("EXPORTED", OUT, OUT.stat().st_size)
