"""Tiny numpy software rasterizer for previews of the CK3 export (no GPU, no deps beyond numpy).

render(P, N, TRI, colors, metal, eye, target, fov_deg, w, h) -> RGBA uint8 array (h, w, 4)
P/N: (n, 3) world positions/normals, TRI: (m, 3), colors: (n, 3) sRGB 0..1 per vertex.
Also writes PNGs (zlib, no PIL).
"""
import struct
import zlib

import numpy as np


def look_at(eye, target, up=(0, 1, 0)):
    eye, target, up = map(lambda v: np.asarray(v, float), (eye, target, up))
    f = target - eye
    f /= np.linalg.norm(f)
    r = np.cross(f, up)
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return r, u, f


def render(P, N, TRI, colors, metal, eye, target, fov_deg, w, h, light=(-0.4, 0.7, -0.6), bg=(0, 0, 0, 0), ssaa=2):
    W, H = w * ssaa, h * ssaa
    r, u, f = look_at(eye, target)
    rel = P - np.asarray(eye, float)
    cx, cy, cz = rel @ r, rel @ u, rel @ f
    t = np.tan(np.radians(fov_deg) / 2)
    aspect = W / H
    sx = (cx / (cz * t * aspect) * 0.5 + 0.5) * W
    sy = (0.5 - cy / (cz * t) * 0.5) * H
    L = np.asarray(light, float)
    L /= np.linalg.norm(L)
    V = -(rel / np.linalg.norm(rel, axis=1, keepdims=True))
    ndl = np.clip(N @ L, 0, 1)
    Hh = (L + V)
    Hh /= np.linalg.norm(Hh, axis=1, keepdims=True)
    spec = np.clip((N * Hh).sum(1), 0, 1) ** 40
    lin = colors ** 2.2
    shade = lin * (0.28 + 0.85 * ndl[:, None]) * (1 - 0.5 * metal[:, None]) + (0.25 + 0.75 * metal[:, None]) * spec[:, None] * (0.4 + 0.6 * lin)
    rim = np.clip(1 - np.abs((N * V).sum(1)), 0, 1) ** 3 * 0.15
    shade = np.clip(shade + rim[:, None], 0, 1) ** (1 / 2.2)
    zbuf = np.full((H, W), np.inf)
    img = np.zeros((H, W, 4))
    img[:] = np.asarray(bg, float) / 255
    for a, b, c in TRI:
        if cz[a] <= 1 or cz[b] <= 1 or cz[c] <= 1:
            continue
        x0, y0, x1, y1, x2, y2 = sx[a], sy[a], sx[b], sy[b], sx[c], sy[c]
        area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        if area >= 0:  # back-facing (screen y is down) or degenerate
            continue
        minx, maxx = int(max(0, np.floor(min(x0, x1, x2)))), int(min(W - 1, np.ceil(max(x0, x1, x2))))
        miny, maxy = int(max(0, np.floor(min(y0, y1, y2)))), int(min(H - 1, np.ceil(max(y0, y1, y2))))
        if minx > maxx or miny > maxy:
            continue
        ys, xs = np.mgrid[miny:maxy + 1, minx:maxx + 1]
        px, py = xs + 0.5, ys + 0.5
        w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area
        w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area
        w2 = 1 - w0 - w1
        m = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not m.any():
            continue
        z = w0 * cz[a] + w1 * cz[b] + w2 * cz[c]
        zb = zbuf[miny:maxy + 1, minx:maxx + 1]
        m &= z < zb
        if not m.any():
            continue
        zb[m] = z[m]
        col = w0[..., None] * shade[a] + w1[..., None] * shade[b] + w2[..., None] * shade[c]
        sub = img[miny:maxy + 1, minx:maxx + 1]
        sub[m, :3] = col[m]
        sub[m, 3] = 1
    img = img.reshape(h, ssaa, w, ssaa, 4).mean((1, 3))
    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)


def outline(img, color=(20, 16, 12), width=1):
    """Dark outline around the opaque silhouette (for icons)."""
    a = img[..., 3] > 40
    grow = a.copy()
    for _ in range(width):
        g = grow.copy()
        g[1:] |= grow[:-1]; g[:-1] |= grow[1:]; g[:, 1:] |= grow[:, :-1]; g[:, :-1] |= grow[:, 1:]
        grow = g
    ring = grow & ~a
    out = img.copy()
    out[ring, :3] = color
    out[ring, 3] = 255
    return out


def write_png(path, img):
    h, w = img.shape[:2]
    raw = b"".join(b"\0" + img[y].tobytes() for y in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
