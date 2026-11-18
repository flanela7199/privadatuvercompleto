//! `crownShell(R, H, band, n, th, cols, rows)` from web/src/accessories/index.js.
use super::mesh::{push3, Mesh};
use std::f64::consts::PI;

pub fn crown_shell(r: f64, h: f64, band: f64, n: f64, th: f64, cols: usize, rows: usize) -> Mesh {
    let top = |a: f64| {
        let mut f = ((a / (PI * 2.0)) * n) % 1.0;
        if f < 0.0 {
            f += 1.0;
        }
        let s = 1.0 - (2.0 * f - 1.0).abs();
        band + (h - band) * s.powf(1.7)
    };
    let flare = |y: f64| r * (0.94 + 0.06 * (y / h));
    let per = (rows + 1) * 2;
    let mut m = Mesh::default();
    for c in 0..=cols {
        let a = (c as f64 / cols as f64) * PI * 2.0;
        let (ca, sa, ht) = (a.cos(), a.sin(), top(a));
        for row in 0..=rows {
            let y = (row as f64 / rows as f64) * ht;
            let ro = flare(y);
            push3(&mut m.positions, ca * ro, y, sa * ro);
        }
        for row in (0..=rows).rev() {
            let y = (row as f64 / rows as f64) * ht;
            let ri = flare(y) - th;
            push3(&mut m.positions, ca * ri, y, sa * ri);
        }
    }
    for c in 0..cols {
        for row in 0..per {
            let a = (c * per + row) as u32;
            let b = (c * per + ((row + 1) % per)) as u32;
            let (a2, b2) = (a + per as u32, b + per as u32);
            m.indices.extend_from_slice(&[a, b, a2, b, b2, a2]);
        }
    }
    m.compute_vertex_normals();
    m
}
