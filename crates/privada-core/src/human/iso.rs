//! Isosurface extraction: naive surface nets on a rectilinear grid (per-axis variable
//! spacing, so the face can be sampled finer than the back of the head), with coarse
//! block culling and SDF-gradient normals. Output: indexed triangles, CCW seen from outside.
use glam::Vec3;

/// node coordinates from `min` to `max` (inclusive) with local spacing `step(x)`
pub fn axis(min: f32, max: f32, step: impl Fn(f32) -> f32) -> Vec<f32> {
    let mut out = vec![min];
    let mut x = min;
    while x < max {
        x += step(x).max(1e-5);
        out.push(x);
    }
    out
}

pub struct Iso {
    pub positions: Vec<Vec3>,
    pub normals: Vec<Vec3>,
    pub indices: Vec<u32>,
}

const BLOCK: usize = 4;

/// Extract the zero level set of `f` (negative inside) on the grid `xs` x `ys` x `zs`.
/// `lipschitz` >= 1 widens the culling margin for fields that are not exact distances.
pub fn surface_nets(f: &dyn Fn(Vec3) -> f32, xs: &[f32], ys: &[f32], zs: &[f32], lipschitz: f32) -> Iso {
    let (nx, ny, nz) = (xs.len(), ys.len(), zs.len());
    let idx = |i: usize, j: usize, k: usize| (k * ny + j) * nx + i;
    let mut val = vec![f32::NAN; nx * ny * nz];
    // coarse pass: nodes on multiples of BLOCK (and the last node of each axis)
    let coarse = |n: usize| -> Vec<usize> {
        let mut c: Vec<usize> = (0..n).step_by(BLOCK).collect();
        if *c.last().unwrap() != n - 1 {
            c.push(n - 1);
        }
        c
    };
    let (cx, cy, cz) = (coarse(nx), coarse(ny), coarse(nz));
    for &k in &cz {
        for &j in &cy {
            for &i in &cx {
                val[idx(i, j, k)] = f(Vec3::new(xs[i], ys[j], zs[k]));
            }
        }
    }
    // far blocks only need a sign: remember it per node, exact values win
    let mut sign_only = vec![false; nx * ny * nz];
    for wk in cz.windows(2) {
        for wj in cy.windows(2) {
            for wi in cx.windows(2) {
                let diag = Vec3::new(xs[wi[1]] - xs[wi[0]], ys[wj[1]] - ys[wj[0]], zs[wk[1]] - zs[wk[0]]).length();
                let mut m = f32::MAX;
                for (i, j, k) in [(0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0), (0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1)] {
                    m = m.min(val[idx(wi[i], wj[j], wk[k])].abs());
                }
                let first = val[idx(wi[0], wj[0], wk[0])];
                let far = m > diag * lipschitz;
                for k in wk[0]..=wk[1] {
                    for j in wj[0]..=wj[1] {
                        for i in wi[0]..=wi[1] {
                            let o = idx(i, j, k);
                            if far {
                                if val[o].is_nan() {
                                    val[o] = first;
                                    sign_only[o] = true;
                                }
                            } else if val[o].is_nan() || sign_only[o] {
                                val[o] = f(Vec3::new(xs[i], ys[j], zs[k]));
                                sign_only[o] = false;
                            }
                        }
                    }
                }
            }
        }
    }
    // one vertex per cell that the surface crosses
    let cidx = |i: usize, j: usize, k: usize| (k * (ny - 1) + j) * (nx - 1) + i;
    let mut cell_v = vec![u32::MAX; (nx - 1) * (ny - 1) * (nz - 1)];
    let mut positions: Vec<Vec3> = Vec::new();
    const EDGES: [(usize, usize); 12] = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)];
    for k in 0..nz - 1 {
        for j in 0..ny - 1 {
            for i in 0..nx - 1 {
                let mut d = [0f32; 8];
                let mut p = [Vec3::ZERO; 8];
                let mut neg = 0;
                for c in 0..8 {
                    let (a, b, cc) = (i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
                    d[c] = val[idx(a, b, cc)];
                    p[c] = Vec3::new(xs[a], ys[b], zs[cc]);
                    neg += (d[c] < 0.0) as u32;
                }
                if neg == 0 || neg == 8 {
                    continue;
                }
                let mut sum = Vec3::ZERO;
                let mut n = 0.0;
                for (a, b) in EDGES {
                    if (d[a] < 0.0) != (d[b] < 0.0) {
                        let t = (d[a] / (d[a] - d[b])).clamp(0.0, 1.0);
                        sum += p[a] + (p[b] - p[a]) * t;
                        n += 1.0;
                    }
                }
                cell_v[cidx(i, j, k)] = positions.len() as u32;
                positions.push(sum / n);
            }
        }
    }
    // one quad per grid edge that crosses the surface
    let mut indices: Vec<u32> = Vec::new();
    let dims = [nx, ny, nz];
    for k in 0..nz {
        for j in 0..ny {
            for i in 0..nx {
                let n0 = [i, j, k];
                let d0 = val[idx(i, j, k)];
                for a in 0..3 {
                    let (u, w) = ((a + 1) % 3, (a + 2) % 3);
                    if n0[a] + 1 >= dims[a] || n0[u] == 0 || n0[w] == 0 || n0[u] >= dims[u] - 1 || n0[w] >= dims[w] - 1 {
                        continue;
                    }
                    let mut n1 = n0;
                    n1[a] += 1;
                    let d1 = val[idx(n1[0], n1[1], n1[2])];
                    if (d0 < 0.0) == (d1 < 0.0) {
                        continue;
                    }
                    let cell = |du: usize, dw: usize| {
                        let mut c = n0;
                        c[u] -= du;
                        c[w] -= dw;
                        cell_v[cidx(c[0], c[1], c[2])]
                    };
                    let q = [cell(1, 1), cell(0, 1), cell(0, 0), cell(1, 0)];
                    if q.iter().any(|&x| x == u32::MAX) {
                        continue;
                    }
                    let q = if d0 < 0.0 { q } else { [q[3], q[2], q[1], q[0]] };
                    let pp = |x: u32| positions[x as usize];
                    if (pp(q[0]) - pp(q[2])).length_squared() <= (pp(q[1]) - pp(q[3])).length_squared() {
                        indices.extend_from_slice(&[q[0], q[1], q[2], q[0], q[2], q[3]]);
                    } else {
                        indices.extend_from_slice(&[q[0], q[1], q[3], q[1], q[2], q[3]]);
                    }
                }
            }
        }
    }
    let normals = positions.iter().map(|&p| gradient(f, p, 0.0008)).collect();
    Iso { positions, normals, indices }
}

/// normalized SDF gradient (outward normal)
pub fn gradient(f: &dyn Fn(Vec3) -> f32, p: Vec3, h: f32) -> Vec3 {
    let g = Vec3::new(
        f(p + Vec3::X * h) - f(p - Vec3::X * h),
        f(p + Vec3::Y * h) - f(p - Vec3::Y * h),
        f(p + Vec3::Z * h) - f(p - Vec3::Z * h),
    );
    let l = g.length();
    if l > 1e-12 && l.is_finite() { g / l } else { Vec3::Y }
}

/// uniform grid helper: nodes covering [min, max] with spacing `cell`
pub fn uniform(min: f32, max: f32, cell: f32) -> Vec<f32> {
    axis(min, max, |_| cell)
}
