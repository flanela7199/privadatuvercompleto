use super::*;
use crate::rig::Mouth;
use std::collections::HashMap;

const D: f32 = 0.5; // quick meshes for tests

fn edge_stats(idx: &[u32]) -> (usize, usize) {
    // (edges used by exactly 2 triangles, other edges)
    let mut e: HashMap<(u32, u32), u32> = HashMap::new();
    for t in idx.chunks_exact(3) {
        for k in 0..3 {
            let (a, b) = (t[k], t[(k + 1) % 3]);
            *e.entry((a.min(b), a.max(b))).or_default() += 1;
        }
    }
    let good = e.values().filter(|&&c| c == 2).count();
    (good, e.len() - good)
}

fn signed_volume(pos: &[Vec3], idx: &[u32]) -> f32 {
    idx.chunks_exact(3).map(|t| pos[t[0] as usize].dot(pos[t[1] as usize].cross(pos[t[2] as usize])) / 6.0).sum()
}

#[test]
fn surface_nets_sphere_is_closed_and_outward() {
    let f = |p: Vec3| p.length() - 0.05;
    let g = iso::uniform(-0.07, 0.07, 0.004);
    let m = iso::surface_nets(&f, &g, &g, &g, 1.5);
    let (good, bad) = edge_stats(&m.indices);
    assert!(good > 500 && bad == 0, "closed manifold: {good} good, {bad} bad edges");
    let vol = signed_volume(&m.positions, &m.indices);
    let exact = 4.0 / 3.0 * std::f32::consts::PI * 0.05f32.powi(3);
    assert!((vol - exact).abs() / exact < 0.05, "volume {vol} vs {exact} (positive = CCW outside)");
    for (p, n) in m.positions.iter().zip(&m.normals) {
        assert!((p.length() - 0.05).abs() < 0.003);
        assert!(n.dot(p.normalize()) > 0.95);
    }
}

#[test]
fn head_mesh_is_finite_and_watertight() {
    let h = part("head", D).unwrap();
    assert!(h.tri_count() > 8_000, "tris {}", h.tri_count());
    assert!(h.pos.iter().chain(&h.nrm).chain(&h.col).all(|p| p.is_finite()));
    assert_eq!(h.pos.len(), h.nrm.len());
    assert_eq!(h.pos.len(), h.col.len());
    assert_eq!(h.pos.len(), h.skin.len());
    assert!(h.idx.iter().all(|&i| (i as usize) < h.pos.len()));
    let (good, bad) = edge_stats(&h.idx);
    assert!((bad as f32) < 0.002 * good as f32, "watertight-ish: {bad} open / non-manifold edges of {good}");
    assert!(signed_volume(&h.pos, &h.idx) > 0.002, "outward winding, plausible volume");
    for n in &h.nrm {
        assert!((n.length() - 1.0).abs() < 1e-3);
    }
    for w in &h.skin {
        assert!((w[0] + w[1] + w[2] - 1.0).abs() < 1e-4 && w.iter().all(|x| (-1e-5..=1.0001).contains(x)));
    }
    // the bounding box is a head with a neck
    let (mut lo, mut hi) = (Vec3::splat(1e9), Vec3::splat(-1e9));
    for p in &h.pos {
        lo = lo.min(*p);
        hi = hi.max(*p);
    }
    assert!(hi.y > 0.11 && hi.y < 0.13 && lo.y < -0.19, "y {}..{}", lo.y, hi.y);
    assert!(hi.x > 0.07 && hi.x < 0.095 && (hi.x + lo.x).abs() < 0.004, "symmetric x {}..{}", lo.x, hi.x);
    assert!(hi.z > 0.105 && hi.z < 0.125, "nose tip z {}", hi.z);
}

#[test]
fn mouth_is_closed_at_rest_and_opens_with_the_jaw() {
    let h = part("head", D).unwrap();
    let jaw = &h.morphs.iter().find(|(i, _)| *i == morph::m::JAW_OPEN).unwrap().1;
    // lip vertices near the centre line of the mouth, at the front
    let (mut up, mut low) = (f32::MAX, f32::MIN);
    let (mut up_o, mut low_o) = (f32::MAX, f32::MIN);
    for (i, p) in h.pos.iter().enumerate() {
        if p.x.abs() < 0.006 && p.z > 0.088 && (p.y - head::MOUTH_Y).abs() < 0.012 {
            let d = jaw[i];
            if d.length() < 1e-4 {
                up = up.min(p.y);
                up_o = up_o.min(p.y + d.y);
            } else if d.y < -0.01 {
                low = low.max(p.y);
                low_o = low_o.max(p.y + d.y);
            }
        }
    }
    assert!(up - low < 0.0035, "lips meet at rest: gap {}", up - low);
    assert!(up_o - low_o > 0.02, "jaw_open parts the lips: {}", up_o - low_o);
}

#[test]
fn morph_deltas_are_bounded_and_local() {
    let h = part("head", D).unwrap();
    assert_eq!(h.morphs.len(), morph::N);
    for (i, d) in &h.morphs {
        let name = morph::MORPH_NAMES[*i];
        let max = d.iter().map(|x| x.length()).fold(0.0, f32::max);
        assert!(d.iter().all(|x| x.is_finite()), "{name}");
        let limit = if name == "jaw_open" { 0.06 } else { 0.02 };
        assert!(max > 0.0005 && max < limit, "{name}: max delta {max}");
        // nothing moves the back of the skull or the neck base
        for (p, x) in h.pos.iter().zip(d.iter()) {
            if p.z < -0.05 || p.y < -0.19 || p.y > 0.09 {
                assert!(x.length() < 1e-4, "{name} moves {p:?} by {x:?}");
            }
        }
    }
    // L / R shapes mirror each other
    let get = |n: &str| &h.morphs[morph::MORPH_NAMES.iter().position(|m| *m == n).unwrap()].1;
    for (l, r) in [("smile_L", "smile_R"), ("blink_L", "blink_R"), ("brow_up_L", "brow_up_R"), ("wide_L", "wide_R")] {
        let (dl, dr) = (get(l), get(r));
        let (sl, sr): (f32, f32) = (dl.iter().map(|x| x.length()).sum(), dr.iter().map(|x| x.length()).sum());
        assert!((sl - sr).abs() < 0.08 * sl.max(sr), "{l}/{r}: {sl} vs {sr}");
        // L lives on -x
        let lx: f32 = h.pos.iter().zip(dl.iter()).map(|(p, d)| d.length() * p.x).sum();
        assert!(lx < 0.0, "{l} is on the -x side");
    }
    // blink brings the upper lid down to the lower one
    let b = get("blink_R");
    let moved = h.pos.iter().zip(b.iter()).filter(|(p, d)| p.x > 0.0 && d.y < -0.004).count();
    assert!(moved > 5, "upper lid vertices travel > 4 mm: {moved}");
}

#[test]
fn rooted_hair_follows_the_skin() {
    let beard = part("beard", D).unwrap();
    let brows = part("brows", D).unwrap();
    for (p, name) in [(&beard, "beard"), (&brows, "brows")] {
        assert!(p.tri_count() > 500, "{name} tris {}", p.tri_count());
        assert_eq!(p.skin.len(), p.pos.len());
        assert!(p.pos.iter().chain(&p.nrm).all(|x| x.is_finite()));
        for (_, d) in &p.morphs {
            assert_eq!(d.len(), p.pos.len());
        }
    }
    let names = |p: &Part| p.morphs.iter().map(|(i, _)| morph::MORPH_NAMES[*i]).collect::<Vec<_>>();
    assert!(names(&beard).contains(&"jaw_open") && names(&beard).contains(&"smile_L"));
    assert!(names(&brows).contains(&"brow_up_L") && !names(&brows).contains(&"jaw_open"), "{:?}", names(&brows));
}

#[test]
fn every_part_builds_and_encodes() {
    for name in PARTS {
        let kind = format!("human_{name}");
        let m = build(&kind, "{\"detail\":0.5}").unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(m.vertex_count() > 50 && !m.indices.is_empty(), "{name}");
        assert!(m.positions.iter().chain(&m.normals).chain(&m.uvs).all(|x| x.is_finite()), "{name}");
        assert!(m.indices.iter().all(|&i| (i as usize) < m.vertex_count()), "{name}");
        let col = build(&kind, "{\"detail\":0.5,\"attr\":\"color\"}").unwrap();
        assert_eq!(col.vertex_count(), m.vertex_count(), "{name} colours");
        assert!(col.positions.iter().all(|c| (0.0..=1.5).contains(c)), "{name} colour range");
        let bytes = crate::geo::encode(&m);
        assert_eq!(crate::geo::decode(&bytes).unwrap(), m, "{name} PRVM round trip");
        assert!(part_info(&kind, "{\"detail\":0.5}").unwrap().contains("\"tris\""));
    }
    assert!(build("human_head", "{\"detail\":0.5,\"attr\":\"morph\",\"morph\":\"jaw_open\"}").is_ok());
    assert!(build("human_head", "{\"detail\":0.5,\"attr\":\"skin\"}").is_ok());
    assert!(build("human_hair", "{\"detail\":0.5,\"attr\":\"skin\"}").is_err());
    assert!(build("human_nope", "{}").is_err());
    free();
}

#[test]
fn visemes_map_to_distinct_mouth_shapes() {
    let t = morph::viseme_table();
    assert_eq!(t.len(), 17, "rest + 16 standard visemes");
    use morph::m::*;
    let w = |n: &str| morph::viseme_weights(n).unwrap();
    assert!(w("rest").iter().all(|x| *x == 0.0));
    assert!(w("AA")[JAW_OPEN] > 0.9);
    assert!(w("M_P_B")[PRESS] > 0.9 && w("M_P_B")[JAW_OPEN] < 0.05);
    assert!(w("FV")[TUCK] > 0.7 && w("FV")[PRESS] < 0.2);
    assert!(w("OY_UH_UW")[PUCKER] > 0.9 && w("W")[PUCKER] > 0.9);
    assert!(w("Y_IY")[WIDE_L] > 0.6 && w("Y_IY")[SMILE_R] > 0.2);
    assert!(w("CH_J_SH")[UPPER_RAISE] > 0.3);
    for (n, ws) in &t {
        assert!(ws.iter().all(|x| (0.0..=1.0).contains(x)), "{n}");
        // every non-rest viseme differs from every other one
        for (n2, w2) in &t {
            if n != n2 {
                let d: f32 = ws.iter().zip(w2).map(|(a, b)| (a - b).abs()).sum();
                assert!(d > 0.05, "{n} vs {n2}");
            }
        }
    }
    // the plain mouth vector: F/V is found from closed + raised upper lip, corners smile / frown
    let fv = morph::mouth_to_morphs(&Mouth { closed: 0.6, upper_raise: 0.4, ..Default::default() });
    assert!(fv[TUCK] > 0.7);
    let c = morph::mouth_to_morphs(&Mouth { corner_l: 1.0, corner_r: -1.0, jaw_side: -1.0, ..Default::default() });
    assert!(c[SMILE_L] > 0.9 && c[FROWN_R] > 0.9 && c[SMILE_R] == 0.0 && c[JAW_LEFT] > 0.9);
    assert!(visemes_json().contains("\"M_P_B\":{\"press\":1}"));
    assert!(rig_info().contains("\"nodes\":[\"root\",\"chest\""));
}

#[test]
fn rig_is_stable_for_10k_frames() {
    let mut r = rig::HumanRig::new(3);
    let acts = ["laugh", "nod", "no", "surprise", "wink", "blink"];
    assert!(!r.play("flush"));
    let mut blinked = false;
    for i in 0..10_000 {
        let t = i as f32 / 60.0;
        let look = ((t * 0.7).sin() * 1.3, (t * 0.45).cos() * 1.2);
        let mouth = Mouth { open: (t * 9.0).sin().abs(), round: (t * 1.3).sin().max(0.0), wide: (t * 1.7).cos().max(0.0), closed: ((t * 0.9).sin() - 0.8).max(0.0) * 5.0, corner_l: (t * 0.5).sin(), ..Default::default() };
        if i % 500 == 250 {
            assert!(r.play(acts[(i / 500) % acts.len()]));
        }
        // irregular frame times, including a long hitch
        let dt = if i % 977 == 0 { 0.4 } else { 1.0 / 60.0 + 0.004 * (i as f32).sin() };
        r.update(dt, look, mouth);
        assert!(r.pose().iter().all(|x| x.is_finite()), "frame {i}");
        assert!(r.morphs().iter().all(|x| (0.0..=1.0).contains(x)), "frame {i}: {:?}", r.morphs());
        assert!(r.cable_pos().iter().chain(r.cable_nrm()).all(|x| x.is_finite() && x.abs() < 2.0), "frame {i}");
        let (y, p, ro) = r.head_angles();
        assert!(y.abs() < 1.7 && p.abs() < 1.0 && ro.abs() < 0.5, "frame {i}: {y} {p} {ro}");
        for n in 0..rig::NODES.len() {
            let q = &r.pose()[n * rig::STRIDE + 3..n * rig::STRIDE + 7];
            let l = q.iter().map(|x| x * x).sum::<f32>().sqrt();
            assert!((l - 1.0).abs() < 1e-3, "unit quaternion, node {n}");
        }
        blinked |= r.morphs()[morph::m::BLINK_L] > 0.9;
    }
    assert!(blinked, "auto blink happened");
    assert!(r.drain_events().iter().any(|e| e == "laugh"));
    assert_eq!(rig::cable_indices().len(), (rig::CABLE_PTS - 1) * rig::CABLE_SIDES * 6);
}

#[test]
fn rig_follows_the_look_and_is_deterministic() {
    let run = |seed| {
        let mut r = rig::HumanRig::new(seed);
        for _ in 0..240 {
            r.update(1.0 / 60.0, (1.0, 0.5), Mouth { open: 1.0, ..Default::default() });
        }
        r
    };
    let (a, b) = (run(5), run(5));
    assert_eq!(a.pose(), b.pose());
    assert_eq!(a.morphs(), b.morphs());
    let (yaw, pitch, _) = a.head_angles();
    assert!(yaw > 0.8 && yaw < 1.3, "turns toward +x: {yaw}");
    assert!(pitch < -0.1, "looks up: {pitch}");
    assert!(a.morphs()[morph::m::JAW_OPEN] > 0.9);
    // rest: closed mouth, friendly smile, eyes open
    let mut r = rig::HumanRig::new(1);
    r.blink_timer = 1e9;
    for _ in 0..120 {
        r.update(1.0 / 60.0, (0.0, 0.0), Mouth::default());
    }
    assert!(r.morphs()[morph::m::JAW_OPEN] < 0.01 && r.morphs()[morph::m::BLINK_L] < 0.05);
    assert!(r.morphs()[morph::m::SMILE_L] > 0.1);
}
