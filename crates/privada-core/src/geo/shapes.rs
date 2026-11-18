//! Ports of web/src/rig/geo.js builders + three.js LatheGeometry / RoundedBoxGeometry.
use super::curve::CatmullRom;
use super::mesh::{push3, Mesh};
use super::v3::{js_hypot, v3, V3};
use std::f64::consts::PI;

/// `taperedTube(points, radiusFn, tubular, radial)`
pub fn tapered_tube(points: &[V3], radius: &dyn Fn(f64) -> f64, tubular: usize, radial: usize) -> Mesh {
    let curve = CatmullRom::new(points.to_vec());
    let (normals, binormals) = curve.frenet(tubular);
    let nv = (tubular + 1) * (radial + 1);
    let mut m = Mesh {
        positions: Vec::with_capacity(nv * 3),
        normals: Vec::with_capacity(nv * 3),
        uvs: Vec::with_capacity(nv * 2),
        indices: Vec::with_capacity(tubular * radial * 6),
    };
    for i in 0..=tubular {
        let t = i as f64 / tubular as f64;
        let p = curve.point_at(t);
        let (n, b) = (normals[i], binormals[i]);
        let r = radius(t);
        for j in 0..=radial {
            let a = (j as f64 / radial as f64) * PI * 2.0;
            let c = a.cos();
            let s = -a.sin();
            let nx = c * n.x + s * b.x;
            let ny = c * n.y + s * b.y;
            let nz = c * n.z + s * b.z;
            push3(&mut m.normals, nx, ny, nz);
            push3(&mut m.positions, p.x + r * nx, p.y + r * ny, p.z + r * nz);
            m.uvs.push(t as f32);
            m.uvs.push((j as f64 / radial as f64) as f32);
        }
    }
    for i in 0..tubular {
        for j in 0..radial {
            let a = (i * (radial + 1) + j) as u32;
            let b = ((i + 1) * (radial + 1) + j) as u32;
            m.indices.extend_from_slice(&[a, b, a + 1, b, b + 1, a + 1]);
        }
    }
    m
}

/// `eggPoint(theta, rx, rz, k)`
#[inline]
pub fn egg_point(theta: f64, rx: f64, rz: f64, k: f64) -> (f64, f64) {
    let s = theta.sin();
    (rx * theta.cos() * (1.0 - k * s), rz * s)
}

/// `eggRevolve(rx, rz, k, profile, seg)` (with computeVertexNormals)
pub fn egg_revolve(rx: f64, rz: f64, k: f64, profile: &[[f64; 2]], seg: usize) -> Mesh {
    let np = profile.len();
    let mut m = Mesh::default();
    for i in 0..=seg {
        let th = (i as f64 / seg as f64) * PI * 2.0;
        let (ex, ez) = egg_point(th, rx, rz, k);
        for &[s, y] in profile {
            push3(&mut m.positions, ex * s, y, ez * s);
            m.uvs.push((0.5 + (ex * s) / (2.0 * rx)) as f32);
            m.uvs.push((0.5 + (ez * s) / (2.0 * rz)) as f32);
        }
    }
    for i in 0..seg {
        for j in 0..np - 1 {
            let a = (i * np + j) as u32;
            let b = ((i + 1) * np + j) as u32;
            m.indices.extend_from_slice(&[a, b, a + 1, b, b + 1, a + 1]);
        }
    }
    m.compute_vertex_normals();
    m
}

/// `lidProfile(rx, depth, dome, e)`
pub fn lid_profile(rx: f64, depth: f64, dome: f64, e: f64) -> Vec<[f64; 2]> {
    let mut p = Vec::new();
    let se = e / rx;
    for i in 0..=14 {
        let s = (i as f64 / 14.0) * (1.0 - se);
        p.push([s, depth + dome * (1.0 - s * s)]);
    }
    for i in 1..=10 {
        let a = PI / 2.0 - (i as f64 / 10.0) * PI;
        p.push([1.0 - se + se * a.cos(), depth / 2.0 + (depth / 2.0) * a.sin()]);
    }
    for i in 1..=10 {
        p.push([(1.0 - se) * (1.0 - i as f64 / 10.0), 0.0]);
    }
    p
}

/// `seatProfile(rx, s0, h)`
pub fn seat_profile(_rx: f64, s0: f64, h: f64) -> Vec<[f64; 2]> {
    let mut p = Vec::new();
    let n = 28;
    for i in 0..=n {
        let a = PI - (i as f64 / n as f64) * PI;
        let s = (s0 + 1.0) / 2.0 + ((1.0 - s0) / 2.0) * a.cos();
        p.push([s, h * 0.35 + h * 0.65 * a.sin()]);
    }
    for i in 1..=n {
        let a = (i as f64 / n as f64) * PI;
        let s = (s0 + 1.0) / 2.0 + ((1.0 - s0) / 2.0) * a.cos();
        p.push([s, h * 0.35 - h * 0.35 * a.sin()]);
    }
    p
}

/// three.js `LatheGeometry(points, segments)` (phiStart 0, phiLength 2π)
pub fn lathe(points: &[[f64; 2]], segments: usize) -> Mesh {
    let np = points.len();
    let mut init = Vec::with_capacity(np * 3);
    let mut prev = V3::default();
    for j in 0..np {
        if j == 0 {
            let dx = points[j + 1][0] - points[j][0];
            let dy = points[j + 1][1] - points[j][1];
            let normal = v3(dy * 1.0, -dx, dy * 0.0);
            prev = normal;
            let n = normal.normalize();
            init.extend_from_slice(&[n.x, n.y, n.z]);
        } else if j == np - 1 {
            init.extend_from_slice(&[prev.x, prev.y, prev.z]);
        } else {
            let dx = points[j + 1][0] - points[j][0];
            let dy = points[j + 1][1] - points[j][1];
            let normal = v3(dy * 1.0, -dx, dy * 0.0);
            let cur = normal;
            let n = v3(normal.x + prev.x, normal.y + prev.y, normal.z + prev.z).normalize();
            init.extend_from_slice(&[n.x, n.y, n.z]);
            prev = cur;
        }
    }
    let inv = 1.0 / segments as f64;
    let phi_len = PI * 2.0;
    let mut m = Mesh::default();
    for i in 0..=segments {
        let phi = 0.0 + i as f64 * inv * phi_len;
        let (sin, cos) = (phi.sin(), phi.cos());
        for j in 0..np {
            push3(&mut m.positions, points[j][0] * sin, points[j][1], points[j][0] * cos);
            m.uvs.push((i as f64 / segments as f64) as f32);
            m.uvs.push((j as f64 / (np - 1) as f64) as f32);
            push3(&mut m.normals, init[3 * j] * sin, init[3 * j + 1], init[3 * j] * cos);
        }
    }
    for i in 0..segments {
        for j in 0..np - 1 {
            let base = (j + i * np) as u32;
            let (a, b, c, d) = (base, base + np as u32, base + np as u32 + 1, base + 1);
            m.indices.extend_from_slice(&[a, b, d, c, d, b]);
        }
    }
    m
}

/// `geometry.scale(1, 1, sz)` on positions (+ normal matrix on normals, as three does)
pub fn scale_z(m: &mut Mesh, sz: f64) {
    for i in 0..m.vertex_count() {
        let (x, y, z) = (m.positions[i * 3] as f64, m.positions[i * 3 + 1] as f64, m.positions[i * 3 + 2] as f64);
        // applyMatrix4(makeScale(1,1,sz)): (e0 x + e4 y + e8 z + e12) * w, w = 1
        let w = 1.0 / (0.0 * x + 0.0 * y + 0.0 * z + 1.0);
        m.positions[i * 3] = ((1.0 * x + 0.0 * y + 0.0 * z + 0.0) * w) as f32;
        m.positions[i * 3 + 1] = ((0.0 * x + 1.0 * y + 0.0 * z + 0.0) * w) as f32;
        m.positions[i * 3 + 2] = ((0.0 * x + 0.0 * y + sz * z + 0.0) * w) as f32;
    }
    if !m.normals.is_empty() {
        let iz = 1.0 / sz;
        for i in 0..m.vertex_count() {
            let n = v3(m.normals[i * 3] as f64, m.normals[i * 3 + 1] as f64, m.normals[i * 3 + 2] as f64);
            let t = v3(1.0 * n.x + 0.0 * n.y + 0.0 * n.z, 0.0 * n.x + 1.0 * n.y + 0.0 * n.z, 0.0 * n.x + 0.0 * n.y + iz * n.z).normalize();
            m.normals[i * 3] = t.x as f32;
            m.normals[i * 3 + 1] = t.y as f32;
            m.normals[i * 3 + 2] = t.z as f32;
        }
    }
}

/// `eggify(geo, k)` (x *= 1 - k * z / hypot(x, z)) + computeVertexNormals
pub fn eggify(m: &mut Mesh, k: f64) {
    for i in 0..m.vertex_count() {
        let x = m.positions[i * 3] as f64;
        let z = m.positions[i * 3 + 2] as f64;
        let r = js_hypot(&[x, z]);
        if r > 1e-5 {
            m.positions[i * 3] = (x * (1.0 - k * (z / r))) as f32;
        }
    }
    m.compute_vertex_normals();
}

/* ------------------------------------------------- RoundedBoxGeometry */

fn js_sign(x: f64) -> f64 {
    if x > 0.0 {
        1.0
    } else if x < 0.0 {
        -1.0
    } else {
        x // ±0 / NaN
    }
}

/// three.js `BoxGeometry(1,1,1,s,s,s)` -> toNonIndexed() -> RoundedBoxGeometry transform
pub fn rounded_box(width: f64, height: f64, depth: f64, segments: usize, radius: f64) -> Mesh {
    let segs = segments * 2 + 1;
    let radius = (width / 2.0).min(height / 2.0).min(depth / 2.0).min(radius);
    // BoxGeometry(1, 1, 1, segs, segs, segs)
    let (mut pos, mut nor, mut uv, mut idx) = (Vec::<f32>::new(), Vec::<f32>::new(), Vec::<f32>::new(), Vec::<u32>::new());
    let mut nverts = 0u32;
    // (u, v, w) axes as indices 0=x 1=y 2=z
    let planes: [(usize, usize, usize, f64, f64, f64, f64, f64); 6] = [
        (2, 1, 0, -1.0, -1.0, 1.0, 1.0, 1.0),
        (2, 1, 0, 1.0, -1.0, 1.0, 1.0, -1.0),
        (0, 2, 1, 1.0, 1.0, 1.0, 1.0, 1.0),
        (0, 2, 1, 1.0, -1.0, 1.0, 1.0, -1.0),
        (0, 1, 2, 1.0, -1.0, 1.0, 1.0, 1.0),
        (0, 1, 2, -1.0, -1.0, 1.0, 1.0, -1.0),
    ];
    for &(u, v, w, udir, vdir, pw, ph, pd) in &planes {
        let (gx, gy) = (segs, segs);
        let seg_w = pw / gx as f64;
        let seg_h = ph / gy as f64;
        let (wh, hh, dh) = (pw / 2.0, ph / 2.0, pd / 2.0);
        for iy in 0..=gy {
            let y = iy as f64 * seg_h - hh;
            for ix in 0..=gx {
                let x = ix as f64 * seg_w - wh;
                let mut vec = [0.0f64; 3];
                vec[u] = x * udir;
                vec[v] = y * vdir;
                vec[w] = dh;
                push3(&mut pos, vec[0], vec[1], vec[2]);
                let mut nv = [0.0f64; 3];
                nv[w] = if pd > 0.0 { 1.0 } else { -1.0 };
                push3(&mut nor, nv[0], nv[1], nv[2]);
                uv.push((ix as f64 / gx as f64) as f32);
                uv.push((1.0 - iy as f64 / gy as f64) as f32);
            }
        }
        let gx1 = (gx + 1) as u32;
        for iy in 0..gy as u32 {
            for ix in 0..gx as u32 {
                let a = nverts + ix + gx1 * iy;
                let b = nverts + ix + gx1 * (iy + 1);
                let c = nverts + (ix + 1) + gx1 * (iy + 1);
                let d = nverts + (ix + 1) + gx1 * iy;
                idx.extend_from_slice(&[a, b, d, b, c, d]);
            }
        }
        nverts += ((gx + 1) * (gy + 1)) as u32;
    }
    // toNonIndexed
    let n = idx.len();
    let mut positions = Vec::with_capacity(n * 3);
    let mut normals = Vec::with_capacity(n * 3);
    let mut uvs = Vec::with_capacity(n * 2);
    for &i in &idx {
        let i = i as usize;
        positions.extend_from_slice(&pos[i * 3..i * 3 + 3]);
        normals.extend_from_slice(&nor[i * 3..i * 3 + 3]);
        uvs.extend_from_slice(&uv[i * 2..i * 2 + 2]);
    }
    let bx = width * (1.0 / 2.0) - radius;
    let by = height * (1.0 / 2.0) - radius;
    let bz = depth * (1.0 / 2.0) - radius;
    let face_tris = positions.len() as f64 / 6.0;
    let half = 0.5 / segs as f64;
    let mut i = 0;
    let mut j = 0;
    while i < positions.len() {
        let p = v3(positions[i] as f64, positions[i + 1] as f64, positions[i + 2] as f64);
        let mut nn = p;
        nn.x -= js_sign(nn.x) * half;
        nn.y -= js_sign(nn.y) * half;
        nn.z -= js_sign(nn.z) * half;
        let nn = nn.normalize();
        positions[i] = (bx * js_sign(p.x) + nn.x * radius) as f32;
        positions[i + 1] = (by * js_sign(p.y) + nn.y * radius) as f32;
        positions[i + 2] = (bz * js_sign(p.z) + nn.z * radius) as f32;
        normals[i] = nn.x as f32;
        normals[i + 1] = nn.y as f32;
        normals[i + 2] = nn.z as f32;
        let side = (i as f64 / face_tris).floor() as usize;
        let (u0, u1) = match side {
            0 => (get_uv(v3(1.0, 0.0, 0.0), nn, 2, 1, radius, depth), 1.0 - get_uv(v3(1.0, 0.0, 0.0), nn, 1, 2, radius, height)),
            1 => (1.0 - get_uv(v3(-1.0, 0.0, 0.0), nn, 2, 1, radius, depth), 1.0 - get_uv(v3(-1.0, 0.0, 0.0), nn, 1, 2, radius, height)),
            2 => (1.0 - get_uv(v3(0.0, 1.0, 0.0), nn, 0, 2, radius, width), get_uv(v3(0.0, 1.0, 0.0), nn, 2, 0, radius, depth)),
            3 => (1.0 - get_uv(v3(0.0, -1.0, 0.0), nn, 0, 2, radius, width), 1.0 - get_uv(v3(0.0, -1.0, 0.0), nn, 2, 0, radius, depth)),
            4 => (1.0 - get_uv(v3(0.0, 0.0, 1.0), nn, 0, 1, radius, width), 1.0 - get_uv(v3(0.0, 0.0, 1.0), nn, 1, 0, radius, height)),
            _ => (get_uv(v3(0.0, 0.0, -1.0), nn, 0, 1, radius, width), 1.0 - get_uv(v3(0.0, 0.0, -1.0), nn, 1, 0, radius, height)),
        };
        uvs[j] = u0 as f32;
        uvs[j + 1] = u1 as f32;
        i += 3;
        j += 2;
    }
    Mesh { positions, normals, uvs, indices: Vec::new() }
}

fn comp(v: V3, a: usize) -> f64 {
    match a {
        0 => v.x,
        1 => v.y,
        _ => v.z,
    }
}

fn get_uv(face_dir: V3, normal: V3, uv_axis: usize, proj_axis: usize, radius: f64, side: f64) -> f64 {
    let tot_arc = 2.0 * PI * radius / 4.0;
    let center = (side - 2.0 * radius).max(0.0);
    let half_arc = PI / 4.0;
    let mut t = normal;
    match proj_axis {
        0 => t.x = 0.0,
        1 => t.y = 0.0,
        _ => t.z = 0.0,
    }
    let t = t.normalize();
    let arc_uv = 0.5 * tot_arc / (tot_arc + center);
    // angleTo
    let den = (t.length_sq() * face_dir.length_sq()).sqrt();
    let ang = if den == 0.0 { PI / 2.0 } else { super::v3::clamp(t.dot(face_dir) / den, -1.0, 1.0).acos() };
    let arc_angle = 1.0 - ang / half_arc;
    if js_sign(comp(t, uv_axis)) == 1.0 {
        arc_angle * arc_uv
    } else {
        let len_uv = center / (tot_arc + center);
        len_uv + arc_uv + arc_uv * (1.0 - arc_angle)
    }
}
