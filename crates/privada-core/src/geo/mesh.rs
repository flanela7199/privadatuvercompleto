//! Mesh buffers + three.js `computeVertexNormals` (indexed) with Float32 storage
//! semantics (every accumulation is rounded to f32, like BufferAttribute.setXYZ).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Mesh {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    /// empty = non-indexed
    pub indices: Vec<u32>,
}

impl Mesh {
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }

    /// three.js `BufferGeometry.computeVertexNormals()` for indexed geometry
    pub fn compute_vertex_normals(&mut self) {
        let n = self.vertex_count();
        let mut nor = vec![0f32; n * 3];
        let p = &self.positions;
        let get = |a: &[f32], i: usize| [a[i * 3] as f64, a[i * 3 + 1] as f64, a[i * 3 + 2] as f64];
        if self.indices.is_empty() {
            for f in (0..n).step_by(3) {
                let (a, b, c) = (get(p, f), get(p, f + 1), get(p, f + 2));
                let cb = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
                let ab = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
                let x = cb[1] * ab[2] - cb[2] * ab[1];
                let y = cb[2] * ab[0] - cb[0] * ab[2];
                let z = cb[0] * ab[1] - cb[1] * ab[0];
                for k in 0..3 {
                    nor[(f + k) * 3] = x as f32;
                    nor[(f + k) * 3 + 1] = y as f32;
                    nor[(f + k) * 3 + 2] = z as f32;
                }
            }
        } else {
            for tri in self.indices.chunks_exact(3) {
                let (va, vb, vc) = (tri[0] as usize, tri[1] as usize, tri[2] as usize);
                let (a, b, c) = (get(p, va), get(p, vb), get(p, vc));
                let cb = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
                let ab = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
                let x = cb[1] * ab[2] - cb[2] * ab[1];
                let y = cb[2] * ab[0] - cb[0] * ab[2];
                let z = cb[0] * ab[1] - cb[1] * ab[0];
                // read all three, add, then write in order A, B, C (same as three)
                let na = get(&nor, va);
                let nb = get(&nor, vb);
                let nc = get(&nor, vc);
                for (vi, nv) in [(va, na), (vb, nb), (vc, nc)] {
                    nor[vi * 3] = (nv[0] + x) as f32;
                    nor[vi * 3 + 1] = (nv[1] + y) as f32;
                    nor[vi * 3 + 2] = (nv[2] + z) as f32;
                }
            }
        }
        // normalizeNormals()
        for i in 0..n {
            let (x, y, z) = (nor[i * 3] as f64, nor[i * 3 + 1] as f64, nor[i * 3 + 2] as f64);
            let l = (x * x + y * y + z * z).sqrt();
            let s = 1.0 / if l == 0.0 || l.is_nan() { 1.0 } else { l };
            nor[i * 3] = (x * s) as f32;
            nor[i * 3 + 1] = (y * s) as f32;
            nor[i * 3 + 2] = (z * s) as f32;
        }
        self.normals = nor;
    }
}

/// push an f64 triple as f32 (Float32BufferAttribute rounding)
#[inline]
pub fn push3(v: &mut Vec<f32>, x: f64, y: f64, z: f64) {
    v.push(x as f32);
    v.push(y as f32);
    v.push(z as f32);
}
