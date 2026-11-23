"""Build the visitor's hand for the cottage's touch mode (an original model, generated here from numbers).

Run with Blender 5.x:
  blender -b --factory-startup --python tools/assets/build_hand.py -- static/models/hand.glb

A right hand in Blender's frame: fingers along -Y, the back of the hand +Z, the thumb at -X; the palm centre is the
origin. (In the GLB, as in three.js: fingers +Z, back +Y, thumb -X.) The palm, the heel of the thumb and the wrist are
one metaball family so they melt into each other; each finger and the thumb is its own family so neighbouring fingers
stay apart. The pieces are joined and voxel-remeshed into one closed surface, smoothed, reduced, and skinned to a
small skeleton (three joints per finger, three for the thumb) with weights from the distance to each bone.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector
from mathutils.geometry import intersect_point_line

OUT = Path(sys.argv[sys.argv.index("--") + 1])
RESOLUTION = .0007
VOXEL = .0008
TRIANGLES = 7000

# name, knuckle (x, y, z), segment lengths, root radius, spread (radians, + toward the little finger)
FINGERS = [
    ("index", (-.0265, -.040, .002), (.021, .0145, .0115), .0080, -.06),
    ("middle", (-.0088, -.043, .0025), (.0235, .016, .012), .0083, -.02),
    ("ring", (.0088, -.041, .002), (.022, .015, .0115), .0078, .03),
    ("little", (.0255, -.035, .0005), (.017, .012, .0098), .0068, .09),
]
THUMB_BASE = Vector((-.024, .022, -.006))
THUMB_DIRECTION = Vector((-.78, -.56, -.28)).normalized()
THUMB = ((.030, .0108), (.024, .0102), (.020, .0093))


def clear():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mball in list(bpy.data.metaballs):
        bpy.data.metaballs.remove(mball)


def metaball(name):
    data = bpy.data.metaballs.new(name)
    data.resolution = data.render_resolution = RESOLUTION
    data.threshold = .6
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return obj


def calibrate():
    """How far out the surface of a lone ball of radius 1 lies, to size every element by its visible radius."""
    obj = metaball("Calibrate")
    obj.data.resolution = obj.data.render_resolution = .02
    element = obj.data.elements.new(type="BALL")
    element.radius = 1
    mesh = to_mesh(obj)
    reach = max(v.co.length for v in mesh.data.vertices)
    bpy.data.objects.remove(mesh, do_unlink=True)
    return reach


def to_mesh(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    data = bpy.data.meshes.new_from_object(evaluated)
    mesh = bpy.data.objects.new(obj.name + "Mesh", data)
    bpy.context.collection.objects.link(mesh)
    bpy.data.objects.remove(obj, do_unlink=True)
    return mesh


def turn_x_to(direction):
    return Vector((1, 0, 0)).rotation_difference(direction.normalized())


def capsule(obj, start, end, radius, scale):
    element = obj.data.elements.new(type="CAPSULE")
    middle = (start + end) / 2
    element.co = middle
    element.radius = radius / scale
    element.size_x = (end - start).length / 2
    element.rotation = turn_x_to(end - start)
    return element


def ellipsoid(obj, centre, size, scale, rotation=None, stiffness=2.0):
    element = obj.data.elements.new(type="ELLIPSOID")
    element.co = centre
    element.radius = 1 / scale
    element.size_x, element.size_y, element.size_z = size
    element.stiffness = stiffness
    if rotation:
        element.rotation = rotation
    return element


def finger_points(knuckle, lengths, spread):
    direction = Vector((math.sin(spread), -math.cos(spread), -.04)).normalized()
    points = [Vector(knuckle)]
    for length in lengths:
        points.append(points[-1] + direction * length)
    return points


def thumb_points():
    points = [THUMB_BASE.copy()]
    direction = THUMB_DIRECTION.copy()
    bend = Quaternion(Vector((0, 0, 1)), .18)
    for length, _ in THUMB:
        points.append(points[-1] + direction * length)
        direction = bend @ direction
    return points


def build_shape(scale):
    parts = []
    palm = metaball("Palm")
    # The palm is wider at the knuckles than at the wrist, flat, with a soft heel under the little finger.
    ellipsoid(palm, Vector((0, -.021, .001)), (.036, .024, .0098), scale)
    ellipsoid(palm, Vector((.002, .014, 0)), (.031, .026, .0102), scale)
    ellipsoid(palm, Vector((.021, .010, -.004)), (.011, .024, .009), scale)
    ellipsoid(palm, Vector((-.022, .012, -.006)), (.013, .021, .0105), scale,
              Quaternion(Vector((0, 0, 1)), -.35))
    ellipsoid(palm, Vector((0, .056, -.001)), (.022, .026, .0155), scale)
    for _, knuckle, _, radius, _ in FINGERS:
        # A small rise for each knuckle on the back of the hand.
        ellipsoid(palm, Vector(knuckle) + Vector((0, .004, .001)), (radius * 1.15, radius * 1.3, radius * 1.05), scale,
                  stiffness=1.2)
    parts.append(to_mesh(palm))
    for name, knuckle, lengths, radius, spread in FINGERS:
        finger = metaball("Finger" + name.title())
        points = finger_points(knuckle, lengths, spread)
        # Start inside the palm so the remesh joins them; taper toward the tip; round the tip.
        inside = points[0] + (points[0] - points[1]).normalized() * .012
        capsule(finger, inside, points[0], radius * 1.02, scale)
        for i in range(3):
            capsule(finger, points[i], points[i + 1], radius * (1 - .11 * i), scale)
        parts.append(to_mesh(finger))
    thumb = metaball("Thumb")
    points = thumb_points()
    for i, (_, radius) in enumerate(THUMB):
        capsule(thumb, points[i], points[i + 1], radius, scale)
    parts.append(to_mesh(thumb))

    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    hand = bpy.context.view_layer.objects.active
    hand.name = "Hand"
    hand.data.name = "Hand"
    remesh = hand.modifiers.new("Remesh", "REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = VOXEL
    # Voxels leave a faint stair-step; smoothing takes it out (an outline follows every ripple of the surface).
    smooth = hand.modifiers.new("Smooth", "LAPLACIANSMOOTH")
    smooth.iterations = 12
    smooth.lambda_factor = .8
    smooth.use_volume_preserve = True
    relax = hand.modifiers.new("Relax", "CORRECTIVE_SMOOTH")
    relax.iterations = 10
    relax.use_only_smooth = True
    for modifier in list(hand.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    faces = len(hand.data.polygons)
    decimate = hand.modifiers.new("Decimate", "DECIMATE")
    decimate.ratio = min(1, TRIANGLES / max(1, faces * 2))
    bpy.ops.object.modifier_apply(modifier="Decimate")
    # Decimation leaves long thin triangles; a light pass evens their normals out again.
    even = hand.modifiers.new("Even", "SMOOTH")
    even.factor = .5
    even.iterations = 4
    bpy.ops.object.modifier_apply(modifier="Even")
    bpy.ops.object.shade_smooth()
    return hand


def build_skeleton():
    data = bpy.data.armatures.new("HandRig")
    rig = bpy.data.objects.new("HandRig", data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    bones = data.edit_bones
    root = bones.new("hand")
    root.head, root.tail = Vector((0, .075, 0)), Vector((0, .03, 0))
    segments = []
    for name, knuckle, lengths, _, spread in FINGERS:
        points = finger_points(knuckle, lengths, spread)
        meta = bones.new(f"{name}_0")
        meta.head = Vector((points[0].x * .45, .03, 0))
        meta.tail = points[0]
        meta.parent = root
        segments.append(meta.name)
        parent = meta
        for i in range(3):
            bone = bones.new(f"{name}_{i + 1}")
            bone.head, bone.tail = points[i], points[i + 1]
            bone.parent = parent
            bone.use_connect = i > 0
            segments.append(bone.name)
            parent = bone
    parent = root
    for i, point in enumerate(thumb_points()[:-1]):
        bone = bones.new(f"thumb_{i + 1}")
        bone.head, bone.tail = point, thumb_points()[i + 1]
        bone.parent = parent
        bone.use_connect = i > 0
        parent = bone
    for bone in bones:
        bone.align_roll(Vector((0, 0, 1)))
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def skin(hand, rig):
    """Weights from the distance to each bone's segment, so neighbouring fingers never share a vertex."""
    segments = [(bone.name, bone.head_local.copy(), bone.tail_local.copy()) for bone in rig.data.bones]
    groups = {name: hand.vertex_groups.new(name=name) for name, _, _ in segments}
    for vertex in hand.data.vertices:
        distances = []
        for name, head, tail in segments:
            point, along = intersect_point_line(vertex.co, head, tail)
            along = min(1, max(0, along))
            distances.append(((vertex.co - (head + (tail - head) * along)).length, name))
        distances.sort()
        nearest = distances[0][0]
        chosen = [(math.exp(-(d - nearest) / .0022), name) for d, name in distances[:3] if d - nearest < .007]
        total = sum(w for w, _ in chosen)
        for weight, name in chosen:
            groups[name].add([vertex.index], weight / total, "REPLACE")
    hand.parent = rig
    modifier = hand.modifiers.new("Rig", "ARMATURE")
    modifier.object = rig


def main():
    clear()
    scale = calibrate()
    hand = build_shape(scale)
    rig = build_skeleton()
    skin(hand, rig)
    print(f"hand: {len(hand.data.vertices)} vertices, {len(hand.data.polygons)} faces, "
          f"size {tuple(round(v, 4) for v in hand.dimensions)}")
    bpy.ops.object.select_all(action="DESELECT")
    hand.select_set(True)
    rig.select_set(True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(OUT), export_format="GLB", use_selection=True, export_skins=True,
                              export_animations=False, export_materials="NONE", export_yup=True,
                              export_texcoords=False, export_morph=False)


main()
