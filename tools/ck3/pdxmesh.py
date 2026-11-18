"""Reader/writer for Paradox (Clausewitz/Jomini) binary ``.mesh`` files ("@@b@" pdxasset).

Format (reimplemented from observation of vanilla CK3 files; the layout is the same one the
open-source io_pdx_mesh Blender add-on documents):

    file      := b"@@b@" item*
    item      := property | object
    property  := b"!" u8 name_len name type:(b"i"|b"f"|b"s") u32 count data
                 i: count * int32, f: count * float32,
                 s: count * (u32 byte_len, bytes incl. trailing NUL)
    object    := b"[" * depth name b"\\0"      (children follow; depth gives the nesting)

Tree used by portrait meshes:

    !pdxasset i[2] = (1, 0)
    [object
      [[<shape name>                         one per Maya shape (meshsettings name in .asset)
        [[[mesh                              one per material group
          !p f[3n] !n f[3n] !ta f[4n] !u0 f[2n] (!u1 ...) !tri i[3t] !boundingsphere f[4]
          [[[[aabb  !min f[3] !max f[3]
          [[[[material  !shader s !diff s !n s (!spec s)
          [[[[skin  !bones i[1] (max influences)  !ix i[4n] (-1 = unused)  !w f[4n]
        [[[skeleton                          inside the shape, after its meshes
          [[[[<bone name>  !ix i[1]  (!pa i[1] parent index; absent on the root)  !tx f[12]
                           tx = inverse bind matrix, 4 columns x 3 rows (affine, column-major)
    [locator ...                             (top level, optional)
"""
from __future__ import annotations

import struct
import sys
from dataclasses import dataclass, field
from typing import Any

MAGIC = b"@@b@"


@dataclass
class Node:
    name: str
    props: dict[str, Any] = field(default_factory=dict)  # name -> list (or str for 1 string)
    children: list["Node"] = field(default_factory=list)

    def child(self, name: str) -> "Node | None":
        for c in self.children:
            if c.name == name:
                return c
        return None

    def walk(self, depth=0):
        yield depth, self
        for c in self.children:
            yield from c.walk(depth + 1)


# ----------------------------------------------------------------------------- read
def read(path_or_bytes) -> Node:
    data = path_or_bytes if isinstance(path_or_bytes, (bytes, bytearray)) else open(path_or_bytes, "rb").read()
    if data[:4] != MAGIC:
        raise ValueError("not a binary pdxasset (missing @@b@)")
    root = Node("<root>")
    stack = [root]  # stack[d] = current object at depth d
    pos = 4
    n = len(data)
    while pos < n:
        c = data[pos:pos + 1]
        if c == b"!":
            ln = data[pos + 1]
            name = data[pos + 2:pos + 2 + ln].decode("ascii")
            pos += 2 + ln
            t = data[pos:pos + 1]
            cnt = struct.unpack_from("<I", data, pos + 1)[0]
            pos += 5
            if t == b"i":
                val = list(struct.unpack_from(f"<{cnt}i", data, pos)); pos += 4 * cnt
            elif t == b"f":
                val = list(struct.unpack_from(f"<{cnt}f", data, pos)); pos += 4 * cnt
            elif t == b"s":
                val = []
                for _ in range(cnt):
                    sl = struct.unpack_from("<I", data, pos)[0]; pos += 4
                    val.append(data[pos:pos + sl].rstrip(b"\0").decode("utf-8")); pos += sl
                if cnt == 1:
                    val = val[0]
            else:
                raise ValueError(f"unknown property type {t!r} at {pos}")
            stack[-1].props[name] = val
        elif c == b"[":
            d = 0
            while data[pos + d:pos + d + 1] == b"[":
                d += 1
            end = data.index(b"\0", pos + d)
            name = data[pos + d:end].decode("utf-8")
            pos = end + 1
            node = Node(name)
            del stack[d:]
            stack[-1].children.append(node)
            stack.append(node)
        else:
            raise ValueError(f"unexpected byte {c!r} at {pos}")
    return root


# ---------------------------------------------------------------------------- write
def _prop_raw(name: str, val) -> bytes:
    nb = name.encode("ascii")
    out = b"!" + bytes([len(nb)]) + nb
    if isinstance(val, str):
        val = [val]
    if val and isinstance(val[0], str):
        out += b"s" + struct.pack("<I", len(val))
        for s in val:
            sb = s.encode("utf-8") + b"\0"
            out += struct.pack("<I", len(sb)) + sb
        return out
    if all(isinstance(v, int) for v in val):
        return out + b"i" + struct.pack(f"<I{len(val)}i", len(val), *val)
    return out + b"f" + struct.pack(f"<I{len(val)}f", len(val), *map(float, val))


def _node(node: Node, depth: int) -> bytes:
    out = b"[" * depth + node.name.encode("utf-8") + b"\0"
    for k, v in node.props.items():
        out += _prop(k, v)
    for c in node.children:
        out += _node(c, depth + 1)
    return out


def write(root: Node) -> bytes:
    out = MAGIC
    for k, v in root.props.items():
        out += _prop(k, v)
    for c in root.children:
        out += _node(c, 1)
    return out


class F(list):
    """Marks a list as float data even when all values are integral."""


def _prop(name, val) -> bytes:
    if isinstance(val, F) or (isinstance(val, list) and val and isinstance(val[0], float)):
        nb = name.encode("ascii")
        return b"!" + bytes([len(nb)]) + nb + b"f" + struct.pack(f"<I{len(val)}f", len(val), *map(float, val))
    return _prop_raw(name, val)


def build_mesh_file(shapes: list[dict], bones: list[dict] | None) -> bytes:
    """shapes: [{name, meshes: [{p, n, ta, u0, tri, min, max, material: {shader, diff, n, spec}, skin: {bones, ix, w}}]}]
    bones: [{name, parent (index or None), inv_bind (12 floats, 4 cols x 3 rows)}]"""
    root = Node("<root>", {"pdxasset": [1, 0]})
    obj = Node("object")
    root.children.append(obj)
    for sh in shapes:
        sn = Node(sh["name"])
        obj.children.append(sn)
        for m in sh["meshes"]:
            mn = Node("mesh")
            mn.props["p"] = F(m["p"])
            mn.props["n"] = F(m["n"])
            if m.get("ta") is not None:
                mn.props["ta"] = F(m["ta"])
            mn.props["u0"] = F(m["u0"])
            if m.get("u1") is not None:
                mn.props["u1"] = F(m["u1"])
            mn.props["tri"] = list(map(int, m["tri"]))
            lo, hi = m["min"], m["max"]
            c = [(lo[a] + hi[a]) / 2 for a in range(3)]
            p = m["p"]
            r = max((sum((p[3 * v + a] - c[a]) ** 2 for a in range(3)) for v in range(len(p) // 3)), default=0) ** 0.5
            mn.props["boundingsphere"] = F(c + [r])
            mn.children.append(Node("aabb", {"min": F(m["min"]), "max": F(m["max"])}))
            mat = m["material"]
            mn.children.append(Node("material", {k: mat[k] for k in ("shader", "diff", "n", "spec") if k in mat}))
            if m.get("skin"):
                s = m["skin"]
                mn.children.append(Node("skin", {"bones": [int(s["bones"])], "ix": list(map(int, s["ix"])), "w": F(s["w"])}))
            sn.children.append(mn)
        if bones:
            sk = Node("skeleton")
            for i, b in enumerate(bones):
                props = {"ix": [i]}
                if b.get("parent") is not None:
                    props["pa"] = [int(b["parent"])]
                props["tx"] = F(b["inv_bind"])
                sk.children.append(Node(b["name"], props))
            sn.children.append(sk)
    return write(root)


# ------------------------------------------------------------------------- analysis
def summarize(root: Node) -> dict:
    """Shapes, meshes (vertex/tri counts, attributes, aabb, material, skin) and skeleton."""
    info = {"version": root.props.get("pdxasset"), "shapes": [], "skeleton": [], "locators": []}
    obj = root.child("object")
    if obj is None:
        return info
    loc = root.child("locator") or obj.child("locator")
    if loc:
        info["locators"] = [c.name for c in loc.children]
    for sh in obj.children:
        if sh.name == "locator":
            continue
        skel = sh.child("skeleton")
        if skel:
            for b in skel.children:
                info["skeleton"].append({"name": b.name, "ix": b.props.get("ix", [None])[0],
                                         "pa": b.props.get("pa", [None])[0], "tx": b.props.get("tx")})
        sd = {"name": sh.name, "meshes": []}
        for m in sh.children:
            if m.name != "mesh":
                continue
            p = m.props.get("p", [])
            nv = len(p) // 3
            md = {"verts": nv, "tris": len(m.props.get("tri", [])) // 3,
                  "attrs": {k: len(v) // max(nv, 1) for k, v in m.props.items() if isinstance(v, list)}}
            if nv:
                md["bbox"] = ([min(p[0::3]), min(p[1::3]), min(p[2::3])], [max(p[0::3]), max(p[1::3]), max(p[2::3])])
            for c in m.children:
                if c.name == "aabb":
                    md["aabb"] = (c.props.get("min"), c.props.get("max"))
                elif c.name == "material":
                    md["material"] = c.props
                elif c.name == "skin":
                    ix, w = c.props.get("ix", []), c.props.get("w", [])
                    used = sorted({i for i in ix if i >= 0})
                    md["skin"] = {"bones": c.props.get("bones"), "used_bone_ix": used,
                                  "max_infl": max((sum(1 for k in range(4) if ix[4 * v + k] >= 0) for v in range(len(ix) // 4)), default=0),
                                  "wsum_range": (min((sum(w[4 * v:4 * v + 4]) for v in range(len(w) // 4)), default=0),
                                                 max((sum(w[4 * v:4 * v + 4]) for v in range(len(w) // 4)), default=0))}
            sd["meshes"].append(md)
        info["shapes"].append(sd)
    return info


def validate(root: Node) -> list[str]:
    """Structural checks mirroring what vanilla files always satisfy."""
    errs = []
    if root.props.get("pdxasset") != [1, 0]:
        errs.append(f"pdxasset version {root.props.get('pdxasset')} != [1, 0]")
    obj = root.child("object")
    if obj is None:
        return errs + ["no [object"]
    for sh in obj.children:
        if sh.name == "locator":
            continue
        skel = sh.child("skeleton")
        nb = len(skel.children) if skel else 0
        if skel:
            for i, b in enumerate(skel.children):
                if b.props.get("ix") != [i]:
                    errs.append(f"bone {b.name} ix {b.props.get('ix')} != {i}")
                pa = b.props.get("pa")
                if pa is not None and not (0 <= pa[0] < len(skel.children)):
                    errs.append(f"bone {b.name} parent {pa} out of range")
                if len(b.props.get("tx", [])) != 12:
                    errs.append(f"bone {b.name} tx len != 12")
        for m in sh.children:
            if m.name != "mesh":
                continue
            P = m.props
            nv = len(P.get("p", [])) // 3
            for k, d in (("p", 3), ("n", 3), ("ta", 4), ("u0", 2), ("u1", 2)):
                if k in P and len(P[k]) != nv * d:
                    errs.append(f"{sh.name}: {k} len {len(P[k])} != {nv}*{d}")
            for k in ("p", "n", "u0", "tri"):
                if k not in P:
                    errs.append(f"{sh.name}: missing {k}")
            tri = P.get("tri", [])
            if len(tri) % 3:
                errs.append(f"{sh.name}: tri len not multiple of 3")
            if tri and (min(tri) < 0 or max(tri) >= nv):
                errs.append(f"{sh.name}: tri index out of range")
            if nv > 65535:
                errs.append(f"{sh.name}: {nv} verts > 65535 (16-bit index buffers)")
            kids = {c.name: c for c in m.children}
            if "aabb" not in kids or "material" not in kids:
                errs.append(f"{sh.name}: missing aabb/material")
            else:
                p = P["p"]
                lo, hi = kids["aabb"].props["min"], kids["aabb"].props["max"]
                for a in range(3):
                    if min(p[a::3]) < lo[a] - 1e-3 or max(p[a::3]) > hi[a] + 1e-3:
                        errs.append(f"{sh.name}: aabb does not contain vertices (axis {a})")
            if "skin" in kids:
                s = kids["skin"].props
                ix, w = s.get("ix", []), s.get("w", [])
                if len(ix) != nv * 4 or len(w) != nv * 4:
                    errs.append(f"{sh.name}: skin ix/w len != 4*verts")
                if ix and max(ix) >= nb:
                    errs.append(f"{sh.name}: skin bone index {max(ix)} >= {nb} bones")
                for v in range(nv):
                    sw = sum(w[4 * v:4 * v + 4])
                    if abs(sw - 1) > 1e-3:
                        errs.append(f"{sh.name}: vertex {v} weights sum {sw:.4f}")
                        break
    return errs


def mat_from_tx(tx):
    """12 floats (4 columns x 3 rows) -> 4x4 row-major nested list."""
    c = [tx[0:3], tx[3:6], tx[6:9], tx[9:12]]
    return [[c[0][r], c[1][r], c[2][r], c[3][r]] for r in range(3)] + [[0.0, 0.0, 0.0, 1.0]]


def inv_affine(m):
    """Inverse of a 4x4 affine (row-major nested)."""
    a = [row[:3] for row in m[:3]]
    t = [m[0][3], m[1][3], m[2][3]]
    det = (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
           + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]))
    inv = [[(a[(j + 1) % 3][(i + 1) % 3] * a[(j + 2) % 3][(i + 2) % 3] - a[(j + 1) % 3][(i + 2) % 3] * a[(j + 2) % 3][(i + 1) % 3]) / det
            for j in range(3)] for i in range(3)]
    it = [-sum(inv[r][k] * t[k] for k in range(3)) for r in range(3)]
    return [inv[0] + [it[0]], inv[1] + [it[1]], inv[2] + [it[2]], [0.0, 0.0, 0.0, 1.0]]


def bone_world_positions(info) -> dict[str, list[float]]:
    """Bind-pose world position of every bone (translation of inverse(inv_bind))."""
    out = {}
    for b in info["skeleton"]:
        if not any(b["tx"] or []):  # unused bones are written as all-zero matrices
            out[b["name"]] = None
            continue
        m = inv_affine(mat_from_tx(b["tx"]))
        out[b["name"]] = [m[0][3], m[1][3], m[2][3]]
    return out


def main(argv):
    import json
    if len(argv) < 2:
        print("usage: python -I pdxmesh.py <file.mesh> [--bones] [--validate]")
        return 2
    root = read(argv[1])
    info = summarize(root)
    show_bones = "--bones" in argv
    for sh in info["shapes"]:
        print(f"shape {sh['name']}")
        for m in sh["meshes"]:
            print(f"  mesh verts={m['verts']} tris={m['tris']} attrs={m['attrs']}")
            if "bbox" in m:
                print("    bbox", [round(v, 3) for v in m["bbox"][0]], [round(v, 3) for v in m["bbox"][1]])
            print("    material", json.dumps(m.get("material")))
            if "skin" in m:
                s = m["skin"]
                names = [info["skeleton"][i]["name"] for i in s["used_bone_ix"] if i < len(info["skeleton"])]
                print(f"    skin bones={s['bones']} max_infl={s['max_infl']} wsum={s['wsum_range']} used={names[:12]}{'...' if len(names) > 12 else ''} ({len(names)})")
    print(f"skeleton: {len(info['skeleton'])} bones; locators: {info['locators']}")
    if show_bones:
        wp = bone_world_positions(info)
        for b in info["skeleton"]:
            par = info["skeleton"][b["pa"]]["name"] if b["pa"] is not None else "-"
            print(f"  {b['ix']:3d} {b['name']:<48} parent={par:<44} pos={[round(v, 3) for v in wp[b['name']]] if wp[b['name']] else 'zero'}")
    if "--validate" in argv:
        errs = validate(root)
        print("validate:", "OK" if not errs else "\n  ".join(["FAIL"] + errs))
        data = open(argv[1], "rb").read()
        print("roundtrip:", "byte-identical" if write(root) == data else "DIFFERENT")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
