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
)
print("EXPORTED", OUT, OUT.stat().st_size)
