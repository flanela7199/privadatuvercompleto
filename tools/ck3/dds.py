"""Minimal DDS writer/reader: uncompressed 32-bit BGRA (A8R8G8B8) with a full mip chain.

Same pixel format vanilla CK3 uses for trait icons (pf flags 0x41, masks R=0xff0000 G=0xff00 B=0xff
A=0xff000000, caps 0x401008). Pixels are passed as rows of (r, g, b, a) bytes, top row first.
"""
import struct

DDSD = 0x1 | 0x2 | 0x4 | 0x8 | 0x1000 | 0x20000  # CAPS HEIGHT WIDTH PITCH PIXELFORMAT MIPMAPCOUNT
CAPS = 0x1000 | 0x8 | 0x400000                      # TEXTURE COMPLEX MIPMAP


def _half(rgba: bytes, w: int, h: int):
    nw, nh = max(1, w // 2), max(1, h // 2)
    out = bytearray(nw * nh * 4)
    for y in range(nh):
        for x in range(nw):
            acc = [0, 0, 0, 0]
            n = 0
            for dy in (0, 1):
                for dx in (0, 1):
                    sx, sy = min(w - 1, 2 * x + dx), min(h - 1, 2 * y + dy)
                    o = 4 * (sy * w + sx)
                    for c in range(4):
                        acc[c] += rgba[o + c]
                    n += 1
            o = 4 * (y * nw + x)
            for c in range(4):
                out[o + c] = (acc[c] + n // 2) // n
    return bytes(out), nw, nh


def encode(rgba: bytes, w: int, h: int, mips: bool = True) -> bytes:
    if len(rgba) != w * h * 4:
        raise ValueError("rgba size mismatch")
    levels = [(rgba, w, h)]
    if mips:
        while levels[-1][1] > 1 or levels[-1][2] > 1:
            levels.append(_half(*levels[-1]))
    hdr = struct.pack("<4s7I44x", b"DDS ", 124, DDSD, h, w, w * 4, 0, len(levels))
    pf = struct.pack("<2I4s5I", 32, 0x41, b"\0\0\0\0", 32, 0x00FF0000, 0x0000FF00, 0x000000FF, 0xFF000000)
    caps = struct.pack("<5I", CAPS, 0, 0, 0, 0)
    body = bytearray()
    for data, lw, lh in levels:
        b = bytearray(data)
        b[0::4], b[2::4] = data[2::4], data[0::4]  # RGBA -> BGRA
        body += b
    out = hdr + pf + caps + bytes(body)
    assert len(hdr + pf + caps) == 128
    return out


def write(path: str, rgba: bytes, w: int, h: int, mips: bool = True):
    with open(path, "wb") as f:
        f.write(encode(rgba, w, h, mips))


def read_header(path: str) -> dict:
    d = open(path, "rb").read(128)
    if d[:4] != b"DDS ":
        raise ValueError("not a DDS")
    size, flags, h, w, pitch, depth, mips = struct.unpack_from("<7I", d, 4)
    pfsize, pfflags, fourcc, bits, rm, gm, bm, am = struct.unpack_from("<2I4s5I", d, 76)
    caps = struct.unpack_from("<I", d, 108)[0]
    return {"w": w, "h": h, "mips": mips, "pfflags": pfflags, "fourcc": fourcc, "bits": bits,
            "masks": (rm, gm, bm, am), "caps": caps, "size": size}


def read_top(path: str):
    """Top mip of an uncompressed BGRA DDS written by encode() -> (rgba bytes, w, h)."""
    hd = read_header(path)
    d = open(path, "rb").read()
    n = hd["w"] * hd["h"] * 4
    b = bytearray(d[128:128 + n])
    b[0::4], b[2::4] = d[128 + 2:128 + n:4], d[128:128 + n:4]
    return bytes(b), hd["w"], hd["h"]
