"""Static checks for mods/ck3-privada against the vanilla CK3 install (read-only).

    python -I tools/ck3/check_mod.py [mod_dir] [game_dir]

Checks: brace balance; no vanilla file is overridden; genes/templates used by the portrait modifier
exist; accessory -> entity -> pdxmesh -> .mesh/.dds chain resolves; mesh shape names match the
.asset meshsettings; mesh bones are portrait head bones; DDS headers; localization keys/BOM;
keys used in trait/decision/event exist somewhere in vanilla script.
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dds  # noqa: E402
import pdxmesh as P  # noqa: E402

MOD = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "../../mods/ck3-privada"))
GAME = sys.argv[2] if len(sys.argv) > 2 else "D:/SteamLibrary/steamapps/common/Crusader Kings III/game"
fails, notes = [], []


def fail(msg):
    fails.append(msg)


def strip(s):
    s = re.sub(r'"[^"\n]*"', '""', s)
    return re.sub(r"#[^\n]*", "", s)


def read(p):
    return open(p, encoding="utf-8-sig", errors="replace").read()


def blocks(s):
    """Parse a Paradox script into nested (key, value) lists (enough for our checks)."""
    toks = re.findall(r'"[^"]*"|[{}=]|[^\s{}=]+', re.sub(r"#[^\n]*", "", s))
    pos = 0

    def parse():
        nonlocal pos
        out = []
        while pos < len(toks):
            t = toks[pos]
            if t == "}":
                pos += 1
                return out
            if pos + 1 < len(toks) and toks[pos + 1] in ("=", "<", ">"):
                key = t
                pos += 2
                if toks[pos] == "{":
                    pos += 1
                    out.append((key, parse()))
                else:
                    out.append((key, toks[pos].strip('"')))
                    pos += 1
            elif t == "{":
                pos += 1
                out.append((None, parse()))
            else:
                out.append((None, t.strip('"')))
                pos += 1
        return out
    return parse()


def get(bl, key):
    return [v for k, v in bl if k == key]


mod_files = [p for p in glob.glob(os.path.join(MOD, "**/*"), recursive=True) if os.path.isfile(p)]
rel = {os.path.relpath(p, MOD).replace("\\", "/"): p for p in mod_files}

# 1. no overrides of vanilla files
for r in rel:
    if r in ("descriptor.mod", "thumbnail.png"):
        continue
    if os.path.exists(os.path.join(GAME, r)):
        fail(f"overrides vanilla file: {r}")

# 2. brace balance in every script/asset
for r, p in rel.items():
    if r.endswith((".txt", ".asset", ".mod")):
        s = strip(read(p))
        depth = 0
        for ch in s:
            depth += ch == "{"
            depth -= ch == "}"
            if depth < 0:
                break
        if depth != 0:
            fail(f"unbalanced braces in {r} (depth {depth})")

# 3. genes: vanilla + ours, with their templates
genes = {}
for p in glob.glob(os.path.join(GAME, "common/genes/*.txt")) + [rel[r] for r in rel if r.startswith("common/genes/")]:
    for top, body in blocks(read(p)):
        if not isinstance(body, list):
            continue
        groups = body if top != "special_genes" else [x for _, b in body if isinstance(b, list) for x in b]
        if top == "special_genes":
            groups = []
            for k, b in body:
                if isinstance(b, list):
                    groups += b
        for gname, gbody in groups:
            if isinstance(gbody, list):
                genes.setdefault(gname, set()).update(k for k, v in gbody if isinstance(v, list))
accessories = {}
for p in glob.glob(os.path.join(GAME, "gfx/portraits/accessories/*.txt")) + [rel[r] for r in rel if r.startswith("gfx/portraits/accessories/")]:
    for k, v in blocks(read(p)):
        if isinstance(v, list):
            accessories[k] = v

pm = blocks(read(rel["gfx/portraits/portrait_modifiers/zz_privada.txt"]))
for gname, group in pm:
    for mname, mod in group:
        if not isinstance(mod, list):
            continue
        for dm in get(mod, "dna_modifiers"):
            for kind, spec in dm:
                g, t = get(spec, "gene"), get(spec, "template")
                g, t = (g[0] if g else None), (t[0] if t else None)
                if g not in genes:
                    fail(f"portrait modifier uses unknown gene {g}")
                elif t and t not in genes[g]:
                    fail(f"gene {g} has no template {t}")
notes.append(f"portrait modifier: {sum(1 for _ in pm)} group(s); genes known: {len(genes)}")

# our gene -> accessories -> entities
ours = blocks(read(rel["common/genes/zz_privada_genes.txt"]))
acc_names = set()
for _, b in ours:
    for _, ag in b:
        for gname, gbody in ag:
            for tname, tbody in gbody:
                if isinstance(tbody, list):
                    for sex, lst in tbody:
                        if isinstance(lst, list):
                            acc_names.update(v for k, v in lst if k is not None)
for a in sorted(acc_names):
    if a not in accessories:
        fail(f"gene references missing accessory {a}")
entities_needed = set()
for a in acc_names:
    for k, e in accessories.get(a, []):
        if k == "entity" and isinstance(e, list):
            ent = get(e, "entity")
            if ent:
                entities_needed.add(ent[0])
            if get(e, "shared_pose_entity") != ["head"]:
                fail(f"{a}: expected shared_pose_entity = head")

# 4. asset chain
asset_p = rel["gfx/models/portraits/privada/privada.asset"]
ab = blocks(read(asset_p))
meshes = {get(b, "name")[0]: b for k, b in ab if k == "pdxmesh"}
ents = {get(b, "name")[0]: b for k, b in ab if k == "entity"}
for e in entities_needed:
    if e not in ents:
        fail(f"entity {e} not defined in privada.asset")
        continue
    mname = get(ents[e], "pdxmesh")[0]
    if mname not in meshes:
        fail(f"entity {e} -> unknown pdxmesh {mname}")
        continue
    mb = meshes[mname]
    mfile = os.path.join(os.path.dirname(asset_p), get(mb, "file")[0])
    if not os.path.exists(mfile):
        fail(f"{mname}: missing {mfile}")
        continue
    root = P.read(mfile)
    errs = P.validate(root)
    for x in errs:
        fail(f"{os.path.basename(mfile)}: {x}")
    info = P.summarize(root)
    shapes = {s["name"] for s in info["shapes"]}
    for ms in get(mb, "meshsettings"):
        if get(ms, "name")[0] not in shapes:
            fail(f"{mname}: meshsettings name {get(ms, 'name')[0]} not a shape in {os.path.basename(mfile)} ({shapes})")
        for tk in ("texture_diffuse", "texture_normal", "texture_specular"):
            tf = os.path.join(os.path.dirname(asset_p), get(ms, tk)[0])
            if not os.path.exists(tf):
                fail(f"missing texture {tf}")
            else:
                h = dds.read_header(tf)
                if h["size"] != 124 or h["bits"] != 32 or h["pfflags"] != 0x41 or h["w"] & (h["w"] - 1):
                    fail(f"bad dds header {tf}: {h}")
        sh = get(ms, "shader")[0]
        if sh != "portrait_attachment":
            notes.append(f"shader {sh}")
    sex = "female" if "female" in mname else "male"
    vanilla_head = P.summarize(P.read(os.path.join(GAME, f"gfx/models/portraits/{sex}_head/{sex}_head.mesh")))
    vnames = [b["name"] for b in vanilla_head["skeleton"]]
    names = [b["name"] for b in info["skeleton"]]
    if names != vnames:
        fail(f"{os.path.basename(mfile)}: skeleton differs from vanilla {sex}_head.mesh")
    m0 = info["shapes"][0]["meshes"][0]
    used = [names[i] for i in m0["skin"]["used_bone_ix"]]
    notes.append(f"{os.path.basename(mfile)}: {m0['verts']} verts, {m0['tris']} tris, skin bones {used}, max influences {m0['skin']['max_infl']}, "
                 f"bbox {[round(v, 1) for v in m0['bbox'][0]]}..{[round(v, 1) for v in m0['bbox'][1]]} (head space, cm)")

# 5. trait icon
icon = os.path.join(MOD, "gfx/interface/icons/traits/privada.dds")
h = dds.read_header(icon)
van = dds.read_header(os.path.join(GAME, "gfx/interface/icons/traits/_frame_commander.dds"))
if (h["w"], h["h"], h["pfflags"], h["masks"]) != (van["w"], van["h"], van["pfflags"], van["masks"]):
    fail(f"trait icon header differs from vanilla trait icons: {h} vs {van}")

# 6. localization
loc_p = rel["localization/english/privada_l_english.yml"]
raw = open(loc_p, "rb").read()
if not raw.startswith(b"\xef\xbb\xbf"):
    fail("localization file has no UTF-8 BOM")
loc = raw.decode("utf-8-sig")
if not loc.startswith("l_english:"):
    fail("localization header is not l_english:")
keys = set(re.findall(r"^ ([A-Za-z0-9_.]+):\d* ", loc, re.M))
needed = {"trait_privada", "trait_privada_desc", "trait_privada_character_desc"}
for r in rel:
    if r.startswith(("common/decisions/", "events/")):
        s = read(rel[r])
        for k in re.findall(r"^\s*(?:desc|title|name|selection_tooltip|confirm_text)\s*=\s*([A-Za-z0-9_.]+)", s, re.M):
            needed.add(k)
        for d in re.findall(r"^([a-z_]+_decision) = \{", s, re.M):
            needed.add(d)
for k in sorted(needed - keys):
    fail(f"missing loc key {k}")
for k in re.findall(r"\$([A-Za-z0-9_]+)\$", loc):
    if k not in keys:
        fail(f"loc references unknown key ${k}$")

# 7. script keys exist in vanilla
vanilla_traits = read(os.path.join(GAME, "common/traits/00_traits.txt"))
tb = blocks(read(rel["common/traits/privada_traits.txt"]))
for k, v in tb[0][1]:
    if k in ("desc",):
        continue
    if not re.search(rf"^\s*{re.escape(k)}\s*=", vanilla_traits, re.M):
        fail(f"trait key '{k}' not used by any vanilla trait")
    if isinstance(v, str) and v.endswith("_ai_value") and not re.search(rf"\b{v}\b", vanilla_traits):
        fail(f"unknown ai value {v}")
vanilla_dec = "".join(read(p) for p in glob.glob(os.path.join(GAME, "common/decisions/**/*.txt"), recursive=True))
for k, v in blocks(read(rel["common/decisions/privada_decisions.txt"])):
    for kk, vv in v:
        if not re.search(rf"^\s*{re.escape(kk)}\s*=", vanilla_dec, re.M):
            fail(f"decision key '{kk}' unknown")
    for pic in get(v, "picture"):
        ref = get(pic, "reference")[0]
        if not os.path.exists(os.path.join(GAME, ref)):
            fail(f"decision picture missing {ref}")
themes = read(os.path.join(GAME, "common/event_themes/00_event_themes.txt"))
ev = read(rel["events/privada_events.txt"])
for th in re.findall(r"theme = (\w+)", ev):
    if not re.search(rf"^{th} = \{{", themes, re.M):
        fail(f"unknown event theme {th}")
anims = "".join(read(p) for p in glob.glob(os.path.join(GAME, "gfx/portraits/portrait_animations/*.txt")))
for an in re.findall(r"animation = (\w+)", ev):
    if not re.search(rf"\b{an}\b", anims):
        fail(f"unknown portrait animation {an}")

print("\n".join("  " + n for n in notes))
print("FAIL\n  " + "\n  ".join(fails) if fails else "ALL CHECKS PASSED")
sys.exit(1 if fails else 0)
