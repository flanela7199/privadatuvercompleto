"""Second half of the CK3 export (called by export_privada.mjs):

    python -I tools/ck3/build_ck3.py .tmp/ck3_privada_export.json mods/ck3-privada

writes gfx/models/portraits/privada/{privada_male.mesh, privada_female.mesh, privada.asset,
privada_diffuse/normal/properties/masks.dds}, the trait icon, thumbnail.png and .tmp previews of the
vanilla portrait cameras, then re-reads and validates every .mesh it wrote.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np  # noqa: E402

import dds  # noqa: E402
import pdxmesh as P  # noqa: E402
import render as R  # noqa: E402

src, mod = sys.argv[1], sys.argv[2]
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
data = json.load(open(src, encoding="utf-8"))
SK = json.load(open(os.path.join(HERE, "ck3_skeletons.json"), encoding="utf-8"))
MODEL_DIR = "gfx/models/portraits/privada"
out_dir = os.path.join(mod, MODEL_DIR)
os.makedirs(out_dir, exist_ok=True)

# ------------------------------------------------------------------ atlas (solid colour stripes)
# One full-height vertical stripe per material, sampled at v = 0.5: the result does not depend on
# whether the engine's v axis points up or down. Each triangle has a constant UV (zero derivatives),
# so the GPU always samples mip 0 and neighbouring stripes never bleed.
STRIPE = 8
tiles = data["atlas"]["tiles"]
size = 64
while size < len(tiles) * STRIPE:
    size *= 2
if len(tiles) * STRIPE > size or size > 1024:
    raise SystemExit(f"too many materials for the atlas: {len(tiles)}")


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# CK3 tweaks per material name (portrait lighting is darker/flatter than our web studio)
OVERRIDE = {
    "water": {"hex": "9fcbd8", "rough": 0.05},
    "paper": {"hex": "f2f0ea"}, "rollEnd": {"hex": "e9e5dc"},
    "eyeWhite": {"hex": "f4f3ee"},
}


def props_of(t):
    o = {**t, **OVERRIDE.get(t["name"], {})}
    metal = 1.0 if o["metal"] > 0.5 else 0.0
    rough = float(o["rough"])
    if o.get("clearcoat", 0) > 0.3:  # glazed porcelain / lacquer: the clear coat dominates the look
        rough = min(rough, 0.22)
    rough = min(1.0, max(0.1, rough))
    if metal:
        spec = 0.5                                   # unused by metals (MetalnessToSpec takes the albedo)
    elif o.get("transmission", 0) > 0.5:
        spec = 0.6                                   # gems/glass: strong reflection
    else:
        spec = 0.16 + 0.24 * min(1.0, o.get("clearcoat", 0))   # RemapSpec = 0.25 * spec -> F0 0.04 .. 0.1
    return hex_rgb(o["hex"]), spec, metal, rough


diff = bytearray(size * size * 4)
prop = bytearray(size * size * 4)
norm = bytearray(size * size * 4)
mask = bytearray(size * size * 4)
for i in range(size * size):
    norm[4 * i:4 * i + 4] = bytes((128, 128, 0, 128))  # UnpackRRxGNormal: x = G, y = -A  -> flat (0, 0, 1)
    diff[4 * i:4 * i + 4] = bytes((255, 0, 255, 255))  # magenta = unassigned
tile_rgb = []
for k, t in enumerate(tiles):
    rgb, spec, metal, rough = props_of(t)
    tile_rgb.append((rgb, metal))
    for y in range(size):
        for x in range(k * STRIPE, (k + 1) * STRIPE):
            o = 4 * (y * size + x)
            diff[o:o + 4] = bytes((*rgb, 255))
            # properties: R = subsurface/scattering mask (0 = none), G = specular, B = metalness, A = roughness
            prop[o:o + 4] = bytes((0, int(spec * 255 + 0.5), int(metal * 255), int(rough * 255 + 0.5)))


def tile_uv(k):
    return ((k + 0.5) * STRIPE / size, 0.5)


for name, buf in (("diffuse", diff), ("properties", prop), ("normal", norm), ("masks", mask)):
    dds.write(os.path.join(out_dir, f"privada_{name}.dds"), bytes(buf), size, size)

# ------------------------------------------------------------------ meshes
asset = []
report = {}
for sex, d in data["sexes"].items():
    sk = SK[sex]
    bones = [{"name": b["name"], "parent": b["parent"], "inv_bind": b["tx"]} for b in sk["bones"]]
    shape = f"privada_{sex}Shape"
    u0 = [c for k in d["tile"] for c in tile_uv(k)]
    mesh = {
        "p": d["p"], "n": d["n"], "ta": d["ta"], "u0": u0, "tri": d["tri"], "min": d["min"], "max": d["max"],
        "material": {"shader": "portrait_attachment", "diff": "privada_diffuse.dds", "n": "privada_normal.dds",
                     "spec": "privada_properties.dds"},
        "skin": {"bones": d["bones"], "ix": d["ix"], "w": d["w"]},
    }
    blob = P.build_mesh_file([{"name": shape, "meshes": [mesh]}], bones)
    path = os.path.join(out_dir, f"privada_{sex}.mesh")
    with open(path, "wb") as f:
        f.write(blob)
    # --- re-read and validate what we wrote
    root = P.read(path)
    errs = P.validate(root)
    info = P.summarize(root)
    assert P.write(root) == blob, "round trip changed bytes"
    used = [info["skeleton"][i]["name"] for i in info["shapes"][0]["meshes"][0]["skin"]["used_bone_ix"]]
    report[sex] = {"verts": d["verts"], "tris": d["tris"], "bones_used": used, "influences": d["bones"],
                   "skeleton_bones": len(info["skeleton"]), "validate": errs or "OK", "bytes": len(blob),
                   "scale_cm_per_unit": round(d["scale"], 2), "world_floor_y": round(d["world_floor_y"], 2),
                   "world_top_y": round(d["world_top_y"], 2), "aabb_head_space": [d["min"], d["max"]]}
    asset.append(f'''pdxmesh = {{
	name = "privada_{sex}_mesh"
	file = "privada_{sex}.mesh"

	meshsettings = {{
		name = "{shape}"
		index = 0
		texture_diffuse = "privada_diffuse.dds"
		texture_normal = "privada_normal.dds"
		texture_specular = "privada_properties.dds"
		shader = "portrait_attachment"
		shader_file = "gfx/FX/jomini/portrait.shader"
	}}
}}

entity = {{
	name = "privada_{sex}_entity"
	pdxmesh = "privada_{sex}_mesh"
}}
''')

with open(os.path.join(out_dir, "privada.asset"), "w", encoding="utf-8", newline="\n") as f:
    f.write("# Generated by tools/ck3/export_privada.mjs - do not edit by hand.\n"
            "# Skinned to the portrait HEAD skeleton (used with shared_pose_entity = head):\n"
            "#   head_root (= torso bn_sp_thoracic): bowl, seat, lid, mustache; bn_h_head: tank, eyes, crown, paper; pipe blended.\n\n"
            + "\n".join(asset))

# ------------------------------------------------------------------ previews / icon / thumbnail
def world_arrays(sex):
    d = data["sexes"][sex]
    th = np.asarray(SK[sex]["thoracic"], float)
    Pw = np.asarray(d["p"], float).reshape(-1, 3) + th
    Nw = np.asarray(d["n"], float).reshape(-1, 3)
    k = np.asarray(d["tile"], int)
    cols = np.asarray([np.asarray(tile_rgb[i][0], float) / 255 for i in k])
    metal = np.asarray([tile_rgb[i][1] for i in k], float)
    tri = np.asarray(d["tri"], int).reshape(-1, 3)
    return Pw, Nw, tri, cols, metal


def cam_cyl(sex, radius, height, angle_deg, look_node, look_off):
    # portrait_cameras.txt: position = cylindrical{ r h a } around camera_torso_look_at, look_at = node + offset
    tb = np.asarray(SK[sex]["torso_bones"]["camera_torso_look_at"], float)
    hm = np.asarray(SK[sex]["head_bones"]["bn_h_head_mid"]) + np.asarray(SK[sex]["thoracic"])
    a = np.radians(angle_deg)
    eye = tb + np.asarray([radius * np.sin(a), height, -radius * np.cos(a)])
    return eye, (hm if look_node == "head_mid" else tb) + np.asarray(look_off, float)


# a few vanilla cameras (gfx/portraits/cameras/portrait_cameras.txt): radius, height, angle, look-at node, offset, fov
CAMERAS = {
    "head": (150, 3, 0, "head_mid", (0, 3, 0), 20), "shoulders": (190, 0, 0, "head_mid", (0, -2, 0), 20),
    "torso": (240, -10, 0, "head_mid", (0, -10, 0), 20), "torso_right": (220, 0, -40, "head_mid", (-5, -2, 0), 20),
    "character_view_main": (190, 5, 0, "torso", (0, 5, 0), 30), "event_center": (270, 0, 5, "torso", (0, -15, 0), 30),
    "body": (335, -22, 0, "torso", (0, -22, 0), 20),
}
prev_dir = os.path.join(ROOT, ".tmp", "ck3_preview")
os.makedirs(prev_dir, exist_ok=True)
for sex in ("male", "female"):
    Pw, Nw, tri, cols, metal = world_arrays(sex)
    for cam, (rad, hgt, ang, node, off, fov) in CAMERAS.items():
        eye, tgt = cam_cyl(sex, rad, hgt, ang, node, off)
        img = R.render(Pw, Nw, tri, cols, metal, eye, tgt, fov, 200, 200, bg=(48, 40, 34, 255))
        R.write_png(os.path.join(prev_dir, f"{sex}_{cam}.png"), img)
    # full body, as in the court/throne room
    tgt = np.asarray([0, 100, 0], float)
    img = R.render(Pw, Nw, tri, cols, metal, tgt + np.asarray([-260, 60, -620]), tgt, 20, 240, 320, bg=(48, 40, 34, 255))
    R.write_png(os.path.join(prev_dir, f"{sex}_fullbody.png"), img)

Pw, Nw, tri, cols, metal = world_arrays("male")
ctr = (Pw.min(0) + Pw.max(0)) / 2
ext = (Pw.max(0) - Pw.min(0)).max()
eye = ctr + np.asarray([-0.55, 0.35, -1.0]) / np.linalg.norm([-0.55, 0.35, -1.0]) * ext * 3.2
# icon: tight 3/4 view from the lid (mustache) up to the crown, so it reads at 40 px
top, lid = Pw[:, 1].max(), Pw[:, 1].max() * 0.28
ictr = np.asarray([ctr[0], (top + lid) / 2, ctr[2]])
idir = np.asarray([-0.45, 0.12, -1.0]) / np.linalg.norm([-0.45, 0.12, -1.0])
ieye = ictr + idir * (top - lid) * 0.5 / np.tan(np.radians(10)) * 1.12
icon = R.render(Pw, Nw, tri, cols, metal, ieye, ictr, 20, 120, 120, bg=(0, 0, 0, 0), ssaa=3)
icon = R.outline(icon, width=2)
icon_dir = os.path.join(mod, "gfx/interface/icons/traits")
os.makedirs(icon_dir, exist_ok=True)
dds.write(os.path.join(icon_dir, "privada.dds"), icon.tobytes(), 120, 120)
R.write_png(os.path.join(prev_dir, "icon.png"), icon)
thumb = R.render(Pw, Nw, tri, cols, metal, eye, ctr, 20, 320, 320, bg=(40, 52, 70, 255))
R.write_png(os.path.join(mod, "thumbnail.png"), thumb)

report["textures"] = {"atlas_px": size, "stripe_px": STRIPE, "tiles": [t["key"] for t in tiles]}
report["source"] = {k: data[k] for k in ("budget", "source_tris", "decimation_ratio", "skipped")}
report["parts"] = data["parts"]
with open(os.path.join(ROOT, ".tmp", "ck3_export_report.json"), "w", encoding="utf-8") as f:
    json.dump(report, f, indent=1)
for sex in ("male", "female"):
    r = report[sex]
    print(f"{sex}.mesh: {r['verts']} verts {r['tris']} tris, {r['bytes']} bytes, bones used {r['bones_used']}, "
          f"floor {r['world_floor_y']} top {r['world_top_y']} cm, validate {r['validate']}")
print("textures", size, "px atlas,", len(tiles), "material stripes; previews in", prev_dir)
