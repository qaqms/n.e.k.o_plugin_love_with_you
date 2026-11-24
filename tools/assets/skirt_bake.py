"""Seated skirt bake, step 2 of 2 (0.9.50): drapes Yui's skirt as cloth over her seated legs in Blender.

Reads what tools/assets/skirt_bake_export.mjs wrote (meta.json and the point caches), builds for each job:
  - her lower body and hands as a collision mesh, moving with the clip (Mesh Cache modifier);
  - the seat as a collision box;
  - the skirt as a cloth sheet through her skirt bones, its top row pinned to her waist.
She starts seated with the skirt spread out flat from her waist (above her legs and the seat), it falls onto them
during a hold, then the clip plays. The cloth's points at the skirt joints are
written to static/models/skirt-seated.json in her pelvis's frame, by clip and clip time, for cottage-yui.mjs.

Usage: D:/blender.exe -b --factory-startup -P tools/assets/skirt_bake.py -- <export dir> <output json> [job ...]
"""
import json
import os
import struct
import sys

import bpy
import numpy as np
from mathutils import Matrix

HOLD = 75
# The skirt starts spread out this far below level (radians), so it lies above her thighs and falls onto them.
SPREAD_DROOP = 0.15
# Stored every other recorded frame (15 a second), to the millimetre.
KEEP_EVERY = 2


def read_pc2(path):
    with open(path, "rb") as file:
        head = file.read(32)
        points, = struct.unpack_from("<i", head, 16)
        samples, = struct.unpack_from("<i", head, 28)
        data = np.frombuffer(file.read(), dtype="<f4").reshape(samples, points, 3)
    return data


def write_pc2(path, frames):
    samples, points, _ = frames.shape
    with open(path, "wb") as file:
        file.write(b"POINTCACHE2\0" + struct.pack("<iiffi", 1, points, 0.0, 1.0, samples))
        file.write(frames.astype("<f4").tobytes())


def held(frames, start=None):
    """The first seated frame held (beginning from `start` when given), then the clip (sample 0, standing, is not used)."""
    hold = [frames[1]] * HOLD
    if start is not None:
        hold[0] = start
    return np.concatenate([np.array(hold), frames[1:]])


def to_blender(points):
    return np.stack([points[:, 0], -points[:, 2], points[:, 1]], axis=1)


def spread(sheet, pelvis):
    """The skirt sheet spread out like an umbrella from its top row (outward and a little down, in the room's own
    up and down, not the pelvis bone's), in Blender's axes, with her pelvis at `pelvis`."""
    matrix = np.array(pelvis).reshape(4, 4).T
    rest = np.array(sheet["rest"])
    world = (matrix @ np.c_[rest, np.ones(len(rest))].T).T[:, :3]
    centre = matrix[:3, 3]
    columns = sheet["columns"]
    grid = world.reshape(-1, columns, 3)
    out = grid.copy()
    for c in range(columns):
        top = grid[0, c]
        outward = np.array([top[0] - centre[0], 0, top[2] - centre[2]])
        outward /= np.linalg.norm(outward)
        length = 0.0
        for r in range(1, len(grid)):
            length += np.linalg.norm(grid[r, c] - grid[r - 1, c])
            out[r, c] = top + outward * length * np.cos(SPREAD_DROOP) - np.array([0, 1, 0]) * length * np.sin(SPREAD_DROOP)
    return to_blender(out.reshape(-1, 3))


# The game's axes (Y up) to Blender's (Z up): (x, y, z) -> (x, -z, y).
AXES = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], dtype=float)


def object_matrix(pelvis):
    """Her pelvis's world matrix (three.js, column-major) as a Blender object matrix."""
    return AXES @ np.array(pelvis).reshape(4, 4).T @ AXES.T


def mesh_object(name, points, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(p) for p in points], [], [tuple(f) for f in faces])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def cached(obj, path):
    cache = obj.modifiers.new("cache", "MESH_CACHE")
    cache.cache_format = "PC2"
    cache.filepath = path
    cache.time_mode = "FRAME"
    cache.play_mode = "SCENE"
    cache.frame_start = 1
    cache.forward_axis = "POS_Y"
    cache.up_axis = "POS_Z"
    return cache


def sheet_faces(columns, rows):
    faces = []
    for r in range(rows - 1):
        for c in range(columns):
            a, b = r * columns + c, r * columns + (c + 1) % columns
            faces.append((a, b, b + columns, a + columns))
    return faces


def seat_box(seat):
    # Her root is at the origin facing +Z in the game (here -Y): the seat runs from `back` behind her to `front`
    # ahead, 1.2 m wide, from the floor to its top.
    x, back, front, top = 0.6, seat["back"], seat["front"], seat["seat"]
    points = [(sx * x, -sy, sz) for sz in (0.0, top) for sy in (-back, front) for sx in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return mesh_object("seat", points, faces)


# Checking a bake: SKIRT_BAKE_RENDER=<dir> renders some frames from the front and the side (workbench).
RENDER = os.environ.get("SKIRT_BAKE_RENDER")


def snapshot(label):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = 420
    scene.display.shading.color_type = "OBJECT"
    colours = {"body": (0.95, 0.8, 0.7, 1), "skirt": (0.3, 0.35, 0.8, 1), "seat": (0.5, 0.4, 0.3, 1)}
    for obj in scene.objects:
        if obj.name in colours:
            obj.color = colours[obj.name]
    camera = scene.objects.get("camera")
    if not camera:
        camera = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
        scene.collection.objects.link(camera)
        scene.camera = camera
    for side, (location, rotation) in {"front": ((0.25, -2.4, 0.9), (1.45, 0, 0.1)), "side": ((2.4, -0.3, 0.9), (1.45, 0, 1.45))}.items():
        camera.location = location
        camera.rotation_euler = rotation
        scene.render.filepath = os.path.join(RENDER, f"{label}-{side}.png")
        bpy.ops.render.render(write_still=True)


def bake(directory, meta, name, work):
    job = meta["jobs"][name]
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    body = read_pc2(os.path.join(directory, f"{name}-body.pc2"))
    body_path = os.path.join(work, f"{name}-body-held.pc2")
    body_frames = held(body)
    write_pc2(body_path, body_frames)
    total = len(body_frames)
    # The skirt object goes where her pelvis goes (keyframed: a Mesh Cache under the cloth upsets its rest shape), so
    # its pinned waist follows her; in the object's own space a point is (x, -z, y) of her pelvis's frame.
    pelvis = [object_matrix(job["pelvis"][max(1, frame - HOLD)]) for frame in range(1, total + 1)]
    start = np.linalg.inv(pelvis[0]) @ np.c_[spread(meta["sheet"], job["pelvis"][1]), np.ones(len(meta["sheet"]["rest"]))].T
    start = start.T[:, :3]

    collider = mesh_object("body", body[1], meta["faces"])
    cached(collider, body_path)
    collider.modifiers.new("collision", "COLLISION")
    collider.collision.thickness_outer = 0.012
    collider.collision.cloth_friction = 3
    collider.collision.damping = 0.6

    seat = seat_box(job["seat"])
    seat.modifiers.new("collision", "COLLISION")
    seat.collision.thickness_outer = 0.01
    seat.collision.cloth_friction = 10

    sheet = meta["sheet"]
    cloth_obj = mesh_object("skirt", start, sheet_faces(sheet["columns"], sheet["rows"]))
    pins = cloth_obj.vertex_groups.new(name="pin")
    pins.add(list(range(sheet["columns"])), 1.0, "REPLACE")
    cloth_obj.rotation_mode = "QUATERNION"
    for frame, matrix in enumerate(pelvis, start=1):
        cloth_obj.matrix_world = Matrix(matrix.tolist())
        for path in ("location", "rotation_quaternion", "scale"):
            cloth_obj.keyframe_insert(path, frame=frame)
    cloth = cloth_obj.modifiers.new("cloth", "CLOTH")
    settings = cloth.settings
    settings.quality = 12
    settings.mass = 0.15
    settings.air_damping = 2
    settings.tension_stiffness = 40
    settings.compression_stiffness = 40
    settings.shear_stiffness = 20
    settings.bending_stiffness = 0.05
    settings.tension_damping = 5
    settings.bending_damping = 0.5
    settings.vertex_group_mass = "pin"
    settings.pin_stiffness = 1
    cloth.collision_settings.use_collision = True
    cloth.collision_settings.distance_min = 0.01
    cloth.collision_settings.collision_quality = 4
    cloth.collision_settings.use_self_collision = False
    cloth.point_cache.frame_start = 1
    cloth.point_cache.frame_end = total

    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = total
    joints = np.array(sheet["joints"])  # [3 levels][8 chains] -> sheet index
    first = HOLD  # scene frame f shows cache sample f - 1; after the hold come the clip's samples 1, 2, ...
    out_times, out_frames = [], []
    loop = len(job["clips"]) - 1
    per_loop = loop // max(1, job["loops"])
    for frame in range(1, total + 1):
        scene.frame_set(frame)
        if os.environ.get("SKIRT_BAKE_DEBUG") and frame <= 3:
            ev = cloth_obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            co = np.array([v.co[:] for v in ev.data.vertices])
            cols = sheet["columns"]
            print("DEBUG frame", frame, "row0", co[:cols].mean(axis=0), "hem", co[-cols:].mean(axis=0))
        if RENDER and str(frame) in os.environ.get("SKIRT_BAKE_FRAMES", "").split(","):
            snapshot(f"{name}-at-{frame:04d}")
        sample = frame - 1 - first + 1  # index into the exported samples (0 is standing)
        if sample < 1:
            continue
        # Loops: keep the last one (the cloth has settled into the clip by then).
        if job["loops"] > 1 and sample <= loop - per_loop:
            continue
        if (sample - 1) % KEEP_EVERY:
            continue
        if RENDER and len(out_times) % 12 == 0:
            snapshot(f"{name}-{frame:04d}")
        evaluated = cloth_obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        coords = np.array([v.co[:] for v in evaluated.data.vertices])
        # The cloth's points are in the skirt object's space: her pelvis's frame in Blender's axes.
        local = np.stack([coords[:, 0], coords[:, 2], -coords[:, 1]], axis=1)
        clip_name, clip_time = job["clips"][sample]
        out_times.append(round(clip_time, 4))
        out_frames.append([round(float(x), 4) for x in local[joints.reshape(-1)].reshape(-1)])
    order = np.argsort(out_times)
    print(f"{name}: {len(out_times)} frames kept of {total}")
    return {"times": [out_times[i] for i in order], "frames": [out_frames[i] for i in order],
            "loop": job["loops"] > 1, "duration": job["clip"]["duration"]}


def main():
    args = sys.argv[sys.argv.index("--") + 1:]
    directory, output = args[0], args[1]
    with open(os.path.join(directory, "meta.json"), encoding="utf-8") as file:
        meta = json.load(file)
    names = args[2:] or list(meta["jobs"])
    work = os.path.join(directory, "work")
    os.makedirs(work, exist_ok=True)
    result = {"note": "Yui's skirt draped over her seated legs (tools/assets/skirt_bake.py): for each clip, by clip time, "
                      "the skirt joints' tails (3 levels x 8 chains) in her pelvis's frame.", "clips": {}}
    if os.path.exists(output):
        with open(output, encoding="utf-8") as file:
            result["clips"].update(json.load(file).get("clips", {}))
    for name in names:
        result["clips"][meta["jobs"][name]["clip"]["name"]] = bake(directory, meta, name, work)
    with open(output, "w", encoding="utf-8", newline="\n") as file:
        json.dump(result, file, separators=(",", ":"))


main()
