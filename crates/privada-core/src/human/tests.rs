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
        let limit = if name == "jaw_open" { 0.10 } else { 0.02 };
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
    assert!(w("AA")[JAW_OPEN] > 0.5 && w("AA")[JAW_OPEN] < 0.65, "speech opens ~20 deg, not the 36 deg spit pose");
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
    assert!(rig_info().contains("\"nodes\":[\"root\",\"pelvis\"") && rig_info().contains("mouth_spout") && rig_info().contains("colliders"));
}

#[test]
fn rig_is_stable_for_10k_frames() {
    let mut r = rig::HumanRig::new(3);
    let acts = ["laugh", "nod", "no", "surprise", "wink", "blink", "jump", "backflip", "gargle", "blargh", "sit", "stand", "flush", "paper"];
    r.set_seat_height(0.45);
    assert!(!r.play("handstand"));
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
        assert!(r.cable_pos().iter().chain(r.cable_nrm()).all(|x| x.is_finite() && x.abs() < 4.0), "frame {i}");
        assert!(r.scalars().iter().all(|x| x.is_finite()), "frame {i}");
        let (y, p, ro) = r.head_angles();
        assert!(y.abs() < 1.7 && p.abs() < 1.0 && ro.abs() < 0.5, "frame {i}: {y} {p} {ro}");
        for n in 0..rig::NODES {
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
    assert!(a.morphs()[morph::m::JAW_OPEN] > 0.5);
    // rest: closed mouth, friendly smile, eyes open
    let mut r = rig::HumanRig::new(1);
    r.blink_timer = 1e9;
    for _ in 0..120 {
        r.update(1.0 / 60.0, (0.0, 0.0), Mouth::default());
    }
    assert!(r.morphs()[morph::m::JAW_OPEN] < 0.01 && r.morphs()[morph::m::BLINK_L] < 0.05);
    assert!(r.morphs()[morph::m::SMILE_L] > 0.1);
}

#[test]
fn faces_wind_counter_clockwise_seen_from_outside() {
    // back-face culling on the GPU: the triangle winding must agree with the vertex normals
    // (lathes, tubes and isosurfaces; ribbons are double sided but still consistent)
    for name in ["eye", "cornea", "torso", "pants", "hands", "hp_shell", "plug", "mouth_upper", "hair_cap", "chair"] {
        let p = part(name, D).unwrap();
        let (mut ok, mut n) = (0usize, 0usize);
        for t in p.idx.chunks_exact(3) {
            let (a, b, c) = (t[0] as usize, t[1] as usize, t[2] as usize);
            let f = (p.pos[b] - p.pos[a]).cross(p.pos[c] - p.pos[a]);
            if f.length() < 1e-12 {
                continue;
            }
            n += 1;
            ok += (f.dot(p.nrm[a] + p.nrm[b] + p.nrm[c]) > 0.0) as usize;
        }
        assert!(ok as f32 > 0.97 * n as f32, "{name}: {ok} of {n} faces agree with their normals");
    }
    assert_eq!(rig::cable_indices().len() % 3, 0);
}

#[test]
fn procedural_textures() {
    let e = parts::eye_texture(64);
    assert_eq!(e.len(), 64 * 64 * 4);
    let px = |x: usize, y: usize| &e[(y * 64 + x) * 4..(y * 64 + x) * 4 + 4];
    assert!(px(32, 32)[0] < 12, "pupil is black: {:?}", px(32, 32));
    assert!(px(2, 32)[0] > 190 && px(2, 32)[3] == 255, "sclera is light: {:?}", px(2, 32));
    let iris = px(32 + 10, 32);
    assert!(iris[0] > iris[2] + 15 && iris[0] < 200, "iris is brown: {iris:?}");
    let h = parts::hair_texture(64, 128);
    assert_eq!(h.len(), 64 * 128 * 4);
    let alpha = |y: usize| (0..64).map(|x| h[(y * 64 + x) * 4 + 3] as u32).sum::<u32>() / 64;
    assert!(alpha(120) < alpha(4) && alpha(4) > 60 && alpha(4) < 250, "strands with gaps, thinning out toward the tip: {} {}", alpha(4), alpha(120));
    // the hair part carries card UVs for every vertex
    let hair = part("hair", D).unwrap();
    assert_eq!(hair.uv.len(), hair.pos.len());
}

#[test]
fn skeleton_and_body_are_consistent() {
    use body::{node, SKELETON, SKIN_BONES};
    // parents come before children; names are unique
    for (i, (name, parent, _)) in SKELETON.iter().enumerate() {
        assert!(*parent < i as i32, "{name}");
        assert_eq!(SKELETON.iter().filter(|b| b.0 == *name).count(), 1);
    }
    assert_eq!(SKELETON[node::HEAD].0, "head");
    assert_eq!(SKELETON[node::FOOT_R].0, "foot_R");
    assert_eq!(SKELETON[SKIN_BONES[body::SKIN_CHEST_NECK_HEAD[2] as usize]].0, "head");
    // every clothed part is skinned with normalized weights on existing bones
    for name in ["torso", "pants", "pants_jeans", "shoes", "hands"] {
        let p = part(name, D).unwrap();
        assert!(p.tri_count() > 300, "{name}");
        assert_eq!(p.skin.len(), p.pos.len(), "{name}");
        assert_eq!(p.skin_idx.len(), p.pos.len(), "{name}");
        for (w, i) in p.skin.iter().zip(&p.skin_idx) {
            assert!((w[0] + w[1] + w[2] - 1.0).abs() < 1e-4 && w.iter().all(|x| *x >= 0.0));
            assert!(i.iter().all(|&b| (b as usize) < SKIN_BONES.len()));
        }
        assert!(build(&format!("human_{name}"), "{\"detail\":0.5,\"attr\":\"skin_index\"}").is_ok());
    }
    // a hand vertex belongs to the hand bone of that side, a sole to the foot
    let (idx, w) = body::auto_skin(Vec3::new(-0.262, -0.86, 0.0));
    assert_eq!(SKELETON[SKIN_BONES[idx[0] as usize]].0, "hand_L");
    assert!(w[0] > 0.5);
    // a finger tip belongs to its own last phalanx, on its own side
    let tip = Vec3::from_array(body::HAND_SEGS[8].1); // middle finger tip (right hand)
    let (idx, w) = body::auto_skin(tip);
    assert_eq!(SKELETON[SKIN_BONES[idx[0] as usize]].0, "middle3_R");
    assert!(w[0] > 0.6, "{w:?}");
    let (idx, _) = body::auto_skin(Vec3::new(-tip.x, tip.y, tip.z));
    assert_eq!(SKELETON[SKIN_BONES[idx[0] as usize]].0, "middle3_L");
    assert_eq!(SKELETON.len(), 55);
    assert_eq!(SKIN_BONES.len(), 50);
    let (idx, _) = body::auto_skin(Vec3::new(0.10, -1.61, 0.08));
    assert_eq!(SKELETON[SKIN_BONES[idx[0] as usize]].0, "foot_R");
    // the feet stand on the floor
    let shoes = part("shoes", D).unwrap();
    let low = shoes.pos.iter().map(|p| p.y).fold(f32::MAX, f32::min);
    assert!((low - body::FLOOR).abs() < 0.006, "soles at the floor: {low}");
}

#[test]
fn actions_use_the_override_engine() {
    use body::node;
    let step = |r: &mut rig::HumanRig, n: usize| {
        for _ in 0..n {
            r.update(1.0 / 60.0, (0.0, 0.0), Mouth::default());
        }
    };
    let y = |r: &rig::HumanRig, n: usize| r.world(n).translation.y;
    // jump: the whole skeleton leaves the floor and comes back
    let mut r = rig::HumanRig::new(2);
    r.blink_timer = 1e9;
    step(&mut r, 30);
    let foot0 = y(&r, node::FOOT_L);
    r.play("jump");
    let mut peak = foot0;
    for _ in 0..70 {
        step(&mut r, 1);
        peak = peak.max(y(&r, node::FOOT_L));
    }
    assert!(peak - foot0 > 0.25, "feet rise {}", peak - foot0);
    step(&mut r, 30);
    assert!((y(&r, node::FOOT_L) - foot0).abs() < 0.01 && !r.is_playing());
    // backflip: the head passes below the pelvis
    r.play("backflip");
    let mut inverted = false;
    for _ in 0..100 {
        step(&mut r, 1);
        inverted |= y(&r, node::HEAD) < y(&r, node::PELVIS);
    }
    assert!(inverted, "upside down during the flip");
    step(&mut r, 20);
    assert!(y(&r, node::HEAD) > y(&r, node::PELVIS) + 0.5);
    // blargh: the jaw opens to the full range and the spout points forward / down
    r.play("blargh");
    step(&mut r, 70);
    assert!(r.morphs()[morph::m::JAW_OPEN] > 0.9, "wide open: {}", r.morphs()[morph::m::JAW_OPEN]);
    assert!(morph::JAW_MAX.to_degrees() >= 35.0);
    let s = r.spout();
    assert!(s[5] > 0.7 && s[4] < 0.0, "jet leaves forward and a bit down: {s:?}");
    step(&mut r, 120);
    assert!(r.morphs()[morph::m::JAW_OPEN] < 0.05);
    // sit: pelvis drops to the seat, knees fold, feet stay near the floor; stand undoes it
    let pelvis0 = y(&r, node::PELVIS);
    r.set_seat_height(0.45);
    r.play("sit");
    step(&mut r, 150);
    assert!(r.is_sitting());
    assert!(pelvis0 - y(&r, node::PELVIS) > 0.25, "pelvis drops {}", pelvis0 - y(&r, node::PELVIS));
    assert!((y(&r, node::PELVIS) - (0.45 + 0.105)).abs() < 0.02, "root space has the floor at y = 0");
    assert!(y(&r, node::FOOT_L) < 0.16, "feet near the floor: {}", y(&r, node::FOOT_L));
    r.play("stand");
    step(&mut r, 150);
    assert!((y(&r, node::PELVIS) - pelvis0).abs() < 0.01 && !r.is_sitting());
    // external overrides (for ported timelines)
    r.ext.lift = 0.3;
    step(&mut r, 2);
    assert!((y(&r, node::PELVIS) - pelvis0 - 0.3).abs() < 0.01);
}

#[test]
fn rig_is_stable_at_very_low_frame_rates() {
    // 20 fps and below (dt clamps to 0.05 s): the stiff eye springs must not blow up
    let mut r = rig::HumanRig::new(4);
    for i in 0..1200 {
        let t = i as f32 * 0.05;
        r.update(0.05, ((t * 2.0).sin(), (t * 1.3).cos()), Mouth { open: (t * 5.0).sin().abs(), ..Default::default() });
        let p = r.pose();
        for n in [body::node::EYE_L, body::node::EYE_R] {
            let q = glam::Quat::from_xyzw(p[n * 10 + 3], p[n * 10 + 4], p[n * 10 + 5], p[n * 10 + 6]);
            let gaze = q * Vec3::Z;
            assert!(gaze.z > 0.75, "frame {i}: the eye looks {gaze:?} (iris must stay in the opening)");
        }
        assert!(r.pose().iter().all(|x| x.is_finite() && x.abs() < 10.0));
    }
}

fn run(r: &mut rig::HumanRig, seconds: f32) {
    for _ in 0..(seconds * 60.0) as usize {
        r.update(1.0 / 60.0, (0.0, 0.0), Mouth::default());
    }
}

#[test]
fn flush_spits_water_from_the_mouth_spout() {
    let mut r = rig::HumanRig::new(6);
    r.blink_timer = 1e9;
    run(&mut r, 0.5);
    assert_eq!(r.jet.live_count, 0);
    assert!(r.play("flush") && r.play("spit"), "same action under both names");
    run(&mut r, 1.2);
    assert!(r.morphs()[morph::m::CHEEK_PUFF] > 0.3, "gurgle: cheeks full");
    assert!(!r.jet.emitting && r.jet.live_count == 0);
    run(&mut r, 1.1); // t = 2.3: spewing
    assert!(r.jet.emitting && r.morphs()[morph::m::JAW_OPEN] > 0.9, "jaw wide open while spewing");
    assert!(r.jet.live_count > 80, "drops in the air: {}", r.jet.live_count);
    let sp = r.spout();
    let (mouth, dir) = (Vec3::new(sp[0], sp[1], sp[2]), Vec3::new(sp[3], sp[4], sp[5]));
    assert!(mouth.y > 1.3 && mouth.y < 1.65 && dir.z > 0.6, "spout at head height, pointing forward: {sp:?}");
    assert!((r.jet.mouth - mouth).length() < 1e-4 && r.jet.dir.dot(dir) > 0.999, "the jet is wired to the spout");
    // every live drop is in front of his face plane or falling, none behind him
    let mut ahead = 0;
    for i in 0..crate::water::DROPS {
        if let Some((p, _, _)) = r.jet.drop_state(i) {
            assert!(p.is_finite());
            ahead += (p.z > 0.05) as u32;
        }
    }
    assert!(ahead > 60, "the water flies forward: {ahead}");
    run(&mut r, 3.4);
    let pu = r.jet.puddle_out;
    assert!(pu[4] > 0.05 && pu[1] > 0.2, "a puddle on the floor in front of him: {pu:?}");
    assert!(r.morphs()[morph::m::JAW_OPEN] < 0.05 && !r.is_playing());
    let ev = r.drain_events();
    assert!(ev.iter().any(|e| e == "flush") && ev.iter().any(|e| e == "splash"), "{ev:?}");
}

#[test]
fn paper_streams_from_the_right_hand_and_tears() {
    let mut r = rig::HumanRig::new(7);
    run(&mut r, 0.3);
    assert!(r.paper.length() < 0.05 && r.scalars()[rig::sc_h::ROLL] == 0.0);
    r.play("paper");
    run(&mut r, 2.0);
    assert!(r.scalars()[rig::sc_h::ROLL] > 0.9, "the roll is in his hand");
    assert!(r.paper.length() > 1.0, "the strip is out: {} m", r.paper.length());
    let hand = r.world(body::node::HAND_R).translation;
    assert!(hand.y > 1.0 && hand.z > 0.15, "right arm stretched forward: {hand:?}");
    assert!((r.paper.pts[0].p - Vec3::from(hand)).length() < 0.25, "anchored at the hand");
    let far = r.paper.pts.iter().map(|p| p.p.z).fold(f32::MIN, f32::max);
    assert!(far > hand.z + 0.3, "it streams forward: {far}");
    run(&mut r, 1.3); // t = 3.3: torn
    assert!(r.drain_events().iter().any(|e| e == "rip"));
    assert!(r.torn.pts.len() > 10 && r.torn.fade > 0.0, "the torn piece falls");
    run(&mut r, 1.5);
    assert!(!r.is_playing() && r.scalars()[rig::sc_h::ROLL] == 0.0 && r.paper.length() < 0.05);
    assert!(r.world(body::node::HAND_R).translation.y < 0.95, "arm back down");
    // spitting on the streaming paper wets it
    let mut r = rig::HumanRig::new(8);
    r.play("flush");
    run(&mut r, 1.0);
    r.play("paper");
    let mut wet = 0.0f32;
    for _ in 0..300 {
        run(&mut r, 1.0 / 60.0);
        wet = wet.max(r.paper.max_wet).max(r.torn.max_wet);
    }
    assert!(wet > 0.2, "the paper got wet: {wet}");
}

fn floor_prop(r: &mut rig::HumanRig, id: &str, json: &str, at: Vec3) -> usize {
    let slot = r.props.register(id, crate::props::PropDef::from_json(json).unwrap(), glam::Mat4::from_translation(at));
    assert!(slot >= 0);
    slot as usize
}

#[test]
fn props_are_knocked_by_his_body_and_by_the_water() {
    // a tall box right where his thighs go when he sits down
    let mut r = rig::HumanRig::new(9);
    let k = floor_prop(&mut r, "box", "{\"kind\":\"box\",\"size\":[0.12,0.6,0.12],\"mass\":0.4,\"center\":[0,0.3,0]}", Vec3::new(0.10, 0.0, 0.33));
    run(&mut r, 1.0);
    assert_eq!(r.props.state(k), crate::props::REST, "standing still does not touch it");
    r.set_seat_height(0.45);
    r.set_sit(1.0);
    run(&mut r, 1.5);
    assert!(r.props.state(k) != crate::props::REST, "the thigh pushed it over");
    assert!(r.drain_events().iter().any(|e| e.starts_with("prop_hit")) || r.props.com(k).is_some_and(|c| c.z > 0.36 || c.y < 0.28));
    // a light cylinder in the path of the jet
    let mut r = rig::HumanRig::new(10);
    let k = floor_prop(&mut r, "can", "{\"kind\":\"cylinder\",\"size\":{\"r\":0.04,\"h\":0.22},\"mass\":0.12,\"center\":[0,0.11,0]}", Vec3::new(0.0, 0.0, 1.0));
    r.play("flush");
    run(&mut r, 4.5);
    assert!(r.props.state(k) != crate::props::REST || r.props.com(k).is_some_and(|c| (c - Vec3::new(0.0, 0.11, 1.0)).length() > 0.02), "the water knocked the can");
    // the 13 capsules follow the skeleton
    let caps = r.capsules();
    assert_eq!(caps.len(), 13);
    assert!(caps[0].0.y > 1.5 && caps.iter().all(|c| c.0.is_finite() && c.1.y > -0.05 && c.2 > 0.03));
}

#[test]
fn backflip_from_the_chair_kicks_it_away_and_he_sits_again() {
    let mut r = rig::HumanRig::new(11);
    r.props.configure("{\"resetAfter\":2}");
    let k = floor_prop(&mut r, "chair", "{\"kind\":\"box\",\"size\":[0.5,0.45,0.5],\"mass\":3,\"center\":[0,0.225,0],\"seat\":true}", Vec3::ZERO);
    r.set_seat_height(0.45);
    assert!(r.play("sit"));
    run(&mut r, 1.5);
    assert!(r.is_sitting() && r.props.state(k) == crate::props::REST);
    let seated = r.world(body::node::PELVIS).translation.y;
    assert!((seated - 0.555).abs() < 0.03, "pelvis on the seat: {seated}");
    r.play("backflip");
    run(&mut r, 1.0);
    assert!(r.props.state(k) != crate::props::REST, "the chair was kicked");
    let far = r.props.com(k).unwrap();
    assert!(Vec3::new(far.x, 0.0, far.z).length() > 0.3 || far.y > 0.4, "it flew away: {far:?}");
    run(&mut r, 1.0);
    assert!(!r.is_sitting(), "he landed on the floor");
    assert!(r.world(body::node::PELVIS).translation.y > 0.8);
    run(&mut r, 9.0);
    assert!(r.props.state(k) == crate::props::REST && r.is_sitting(), "the chair came back and he sat down again");
}

#[test]
fn actions_with_fx_are_deterministic() {
    let sim = || {
        let mut r = rig::HumanRig::new(12);
        floor_prop(&mut r, "can", "{\"kind\":\"cylinder\",\"size\":{\"r\":0.04,\"h\":0.22},\"mass\":0.12,\"center\":[0,0.11,0]}", Vec3::new(0.1, 0.0, 0.9));
        r.play("flush");
        run(&mut r, 1.2);
        r.play("paper");
        run(&mut r, 3.0);
        r.play("backflip");
        run(&mut r, 2.0);
        (r.pose().to_vec(), r.jet.live_count, r.paper.pts.len(), r.props.out[..12].to_vec(), r.drain_events())
    };
    let (a, b) = (sim(), sim());
    assert_eq!(a.0, b.0);
    assert_eq!((a.1, a.2), (b.1, b.2));
    assert_eq!(a.3, b.3);
    assert_eq!(a.4, b.4);
    assert!(a.4.iter().any(|e| e == "whoosh") && a.4.iter().any(|e| e == "paper"));
}

#[test]
fn hands_have_five_fingers_that_curl() {
    use body::{node, FINGERS_R};
    assert_eq!(body::SKELETON[FINGERS_R].0, "thumb1_R");
    assert_eq!(body::SKELETON[FINGERS_R + 14].0, "pinky3_R");
    // the sculpt: every finger segment is inside the hand mesh, the gaps between fingers are outside
    for s in body::HAND_SEGS.iter() {
        let mid = (Vec3::from_array(s.0) + Vec3::from_array(s.1)) * 0.5;
        assert!(body::hands_sdf(mid) < -0.004, "finger flesh at {mid:?}");
        assert!(body::hands_sdf(Vec3::new(-mid.x, mid.y, mid.z)) < -0.004, "left hand mirrors the right");
    }
    let between = (Vec3::from_array(body::HAND_SEGS[4].1) + Vec3::from_array(body::HAND_SEGS[7].1)) * 0.5; // index / middle
    assert!(body::hands_sdf(between) > 0.0005, "fingers are separate: {}", body::hands_sdf(between));
    // the rig: relaxed at rest, a fist around the paper roll
    let mut r = rig::HumanRig::new(3);
    run(&mut r, 1.0);
    let tip = |r: &rig::HumanRig| r.world(FINGERS_R + 8).transform_point3(Vec3::from_array(body::HAND_SEGS[8].1) - body::bind(FINGERS_R + 8));
    let palm = |r: &rig::HumanRig| r.world(node::HAND_R).transform_point3(rig::PALM_R - body::bind(node::HAND_R));
    let open = (tip(&r) - palm(&r)).length();
    assert!(r.grip()[1] < 0.2 && open > 0.10, "relaxed: tip {open} m from the palm");
    r.play("paper");
    run(&mut r, 1.5);
    let closed = (tip(&r) - palm(&r)).length();
    assert!(r.grip()[1] > 0.6 && closed < open - 0.04, "fist: {closed} vs {open}");
    assert!(r.grip()[0] < 0.25, "the left hand stays relaxed");
    run(&mut r, 4.0);
    r.grip_ext = [1.0, -1.0];
    run(&mut r, 0.5);
    assert!(r.grip()[0] > 0.9 && r.grip()[1] < 0.25);
}

#[test]
fn fabric_textures_are_normal_maps() {
    for kind in [0, 1] {
        let t = body::fabric_texture(64, kind);
        assert_eq!(t.len(), 64 * 64 * 4);
        let (mut zmin, mut var) = (255u8, 0u32);
        for px in t.chunks_exact(4) {
            zmin = zmin.min(px[2]);
            var += (px[0] as i32 - 128).unsigned_abs() + (px[1] as i32 - 128).unsigned_abs();
        }
        assert!(zmin > 110, "normals point out of the surface (kind {kind}): {zmin}");
        assert!(var / (64 * 64) > 4, "there is relief (kind {kind}): {}", var / (64 * 64));
    }
    // cloth parts carry their own UVs for it
    let h = part("torso", D).unwrap();
    assert_eq!(h.uv.len(), h.pos.len());
}
