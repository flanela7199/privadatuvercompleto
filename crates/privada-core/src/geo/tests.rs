use super::*;

fn counts(kind: &str, params: &str) -> (usize, usize) {
    let m = build(kind, params).unwrap();
    (m.vertex_count(), m.indices.len())
}

#[test]
fn json_roundtrip_numbers() {
    let j = Json::parse(r#"{"a":0.1,"b":[1e-3,-2.5],"c":"x","d":null,"e":true}"#).unwrap();
    assert_eq!(j.f("a", 0.0), 0.1);
    assert_eq!(j.get("b").unwrap().arr().unwrap()[0].num(), Some(1e-3));
    assert_eq!(j.s("c", ""), "x");
    assert!(j.get("d").is_none());
}

#[test]
fn prvm_roundtrip() {
    let m = build("crown_shell", r#"{"R":0.15,"H":0.145,"band":0.055,"n":8}"#).unwrap();
    let b = encode(&m);
    assert_eq!(&b[0..4], b"PRVM");
    assert_eq!(decode(&b).unwrap(), m);
}

#[test]
fn cache_key_is_stable_and_param_sensitive() {
    let a = cache_key("mustache", r#"{"part":"hair","style":"mustache_handlebar"}"#);
    assert_eq!(a, cache_key("mustache", r#"{"part":"hair","style":"mustache_handlebar"}"#));
    assert_ne!(a, cache_key("mustache", r#"{"part":"core","style":"mustache_handlebar"}"#));
    assert!(a.starts_with("mustache-"));
}

// Golden vertex/index counts captured from the JS builders (web/tests/bench/geo_bench.mjs).
#[test]
fn golden_counts_match_js() {
    // seat / lid (ToiletTuber DIM)
    assert_eq!(counts("egg_revolve", r#"{"rx":0.405,"rz":0.495,"k":0.08,"seg":160,"profile":{"seat":[0.405,0.62,0.03]}}"#), (161 * 57, 160 * 56 * 6));
    assert_eq!(counts("egg_revolve", r#"{"rx":0.4,"rz":0.49,"k":0.08,"seg":160,"profile":{"lid":[0.4,0.018,0.018,0.012]}}"#), (161 * 35, 160 * 34 * 6));
    assert_eq!(counts("crown_shell", r#"{"R":0.15,"H":0.145,"band":0.055,"n":8}"#), (257 * 18, 256 * 18 * 6));
    // mustaches: core = (96+1)*(12+1); hair = count*(seg+1)*3
    for (id, count, seg, mid) in [
        ("mustache_handlebar", 1100, 10, 220), ("mustache_walrus", 1500, 9, 220), ("mustache_chevron", 900, 8, 220),
        ("mustache_pencil", 420, 8, 80), ("mustache_fu_manchu", 600, 12, 120), ("mustache_horseshoe", 800, 10, 220),
        ("mustache_english", 700, 10, 220), ("mustache_dali", 600, 10, 100), ("mustache_imperial", 860, 9, 220),
        ("mustache_lampshade", 900, 8, 220), ("mustache_pancho", 860, 9, 220), ("mustache_curly", 550, 14, 220),
    ] {
        let p = |part: &str, side: i32| format!(r#"{{"style":"{id}","part":"{part}","side":{side}}}"#);
        assert_eq!(counts("mustache", &p("core", 1)), (97 * 13, 96 * 12 * 6), "{id} core");
        assert_eq!(counts("mustache", &p("hair", -1)), (count * (seg + 1) * 3, count * seg * 3 * 6), "{id} hair");
        assert_eq!(counts("mustache", &p("mid", 1)), (mid * 7 * 3, mid * 6 * 3 * 6), "{id} mid");
    }
    let rb = build("rounded_box", r#"{"w":0.56,"h":0.1,"d":0.47,"segments":5,"radius":0.045}"#).unwrap();
    assert_eq!((rb.vertex_count(), rb.indices.len()), (6 * 11 * 11 * 6, 0));
}

#[test]
fn rng_matches_js_sequence() {
    // rng(11) / rng(112) from accessories/index.js, captured in node
    let mut r = v3::JsRng::new(11);
    for want in [0.51158704864792526, 0.52994640823453665, 0.60811856412328780] {
        assert_eq!(r.next(), want);
    }
    assert_eq!(v3::JsRng::new(112).next(), 0.61496296012774110);
}

#[test]
fn meshes_are_finite() {
    for id in hair::STYLE_IDS {
        for part in ["core", "hair", "mid"] {
            let m = build("mustache", &format!(r#"{{"style":"{id}","part":"{part}","side":1,"length":1.2,"thickness":0.8}}"#)).unwrap();
            assert!(m.positions.iter().chain(&m.normals).chain(&m.uvs).all(|v| v.is_finite()), "{id} {part}");
        }
    }
}
