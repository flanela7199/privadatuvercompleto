//! Minimal JSON reader for mesh parameters (no external deps; keeps the wasm small).
//! Numbers use Rust's correctly-rounded `f64` parser, so values written by
//! `JSON.stringify` round-trip bit-exactly.
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(BTreeMap<String, Json>),
}

impl Json {
    pub fn parse(s: &str) -> Result<Json, String> {
        let mut p = P { b: s.as_bytes(), i: 0 };
        p.ws();
        if p.i >= p.b.len() {
            return Ok(Json::Obj(BTreeMap::new()));
        }
        let v = p.val()?;
        p.ws();
        if p.i != p.b.len() {
            return Err(format!("json: trailing data at {}", p.i));
        }
        Ok(v)
    }
    pub fn get(&self, k: &str) -> Option<&Json> {
        match self {
            Json::Obj(m) => m.get(k).filter(|v| !matches!(v, Json::Null)),
            _ => None,
        }
    }
    pub fn num(&self) -> Option<f64> {
        if let Json::Num(n) = self { Some(*n) } else { None }
    }
    pub fn str(&self) -> Option<&str> {
        if let Json::Str(s) = self { Some(s) } else { None }
    }
    pub fn arr(&self) -> Option<&[Json]> {
        if let Json::Arr(a) = self { Some(a) } else { None }
    }
    /// `obj.k` as f64 or `def`
    pub fn f(&self, k: &str, def: f64) -> f64 {
        self.get(k).and_then(Json::num).unwrap_or(def)
    }
    pub fn opt_f(&self, k: &str) -> Option<f64> {
        self.get(k).and_then(Json::num)
    }
    pub fn s<'a>(&'a self, k: &str, def: &'a str) -> &'a str {
        self.get(k).and_then(Json::str).unwrap_or(def)
    }
    /// `[[a, b], ...]` -> Vec<[f64; 2]>
    pub fn pairs(&self) -> Option<Vec<[f64; 2]>> {
        let a = self.arr()?;
        a.iter()
            .map(|p| {
                let q = p.arr()?;
                Some([q.first()?.num()?, q.get(1)?.num()?])
            })
            .collect()
    }
}

struct P<'a> {
    b: &'a [u8],
    i: usize,
}

impl P<'_> {
    fn ws(&mut self) {
        while self.i < self.b.len() && matches!(self.b[self.i], b' ' | b'\n' | b'\r' | b'\t') {
            self.i += 1;
        }
    }
    fn lit(&mut self, s: &str, v: Json) -> Result<Json, String> {
        if self.b[self.i..].starts_with(s.as_bytes()) {
            self.i += s.len();
            Ok(v)
        } else {
            Err(format!("json: bad literal at {}", self.i))
        }
    }
    fn val(&mut self) -> Result<Json, String> {
        self.ws();
        let c = *self.b.get(self.i).ok_or("json: unexpected end")?;
        match c {
            b'{' => {
                self.i += 1;
                let mut m = BTreeMap::new();
                self.ws();
                if self.b.get(self.i) == Some(&b'}') {
                    self.i += 1;
                    return Ok(Json::Obj(m));
                }
                loop {
                    self.ws();
                    let k = match self.val()? {
                        Json::Str(s) => s,
                        _ => return Err("json: object key must be a string".into()),
                    };
                    self.ws();
                    if self.b.get(self.i) != Some(&b':') {
                        return Err(format!("json: expected ':' at {}", self.i));
                    }
                    self.i += 1;
                    let v = self.val()?;
                    m.insert(k, v);
                    self.ws();
                    match self.b.get(self.i) {
                        Some(b',') => self.i += 1,
                        Some(b'}') => {
                            self.i += 1;
                            return Ok(Json::Obj(m));
                        }
                        _ => return Err(format!("json: expected ',' or '}}' at {}", self.i)),
                    }
                }
            }
            b'[' => {
                self.i += 1;
                let mut a = Vec::new();
                self.ws();
                if self.b.get(self.i) == Some(&b']') {
                    self.i += 1;
                    return Ok(Json::Arr(a));
                }
                loop {
                    a.push(self.val()?);
                    self.ws();
                    match self.b.get(self.i) {
                        Some(b',') => self.i += 1,
                        Some(b']') => {
                            self.i += 1;
                            return Ok(Json::Arr(a));
                        }
                        _ => return Err(format!("json: expected ',' or ']' at {}", self.i)),
                    }
                }
            }
            b'"' => {
                self.i += 1;
                let mut s = String::new();
                loop {
                    let c = *self.b.get(self.i).ok_or("json: unterminated string")?;
                    self.i += 1;
                    match c {
                        b'"' => return Ok(Json::Str(s)),
                        b'\\' => {
                            let e = *self.b.get(self.i).ok_or("json: bad escape")?;
                            self.i += 1;
                            match e {
                                b'n' => s.push('\n'),
                                b't' => s.push('\t'),
                                b'r' => s.push('\r'),
                                b'b' => s.push('\u{8}'),
                                b'f' => s.push('\u{c}'),
                                b'u' => {
                                    let h = std::str::from_utf8(&self.b[self.i..self.i + 4]).map_err(|_| "json: bad \\u")?;
                                    let cp = u32::from_str_radix(h, 16).map_err(|_| "json: bad \\u")?;
                                    s.push(char::from_u32(cp).unwrap_or('\u{fffd}'));
                                    self.i += 4;
                                }
                                o => s.push(o as char),
                            }
                        }
                        _ => {
                            // copy the raw UTF-8 run
                            let st = self.i - 1;
                            let mut en = self.i;
                            while en < self.b.len() && self.b[en] != b'"' && self.b[en] != b'\\' {
                                en += 1;
                            }
                            s.push_str(std::str::from_utf8(&self.b[st..en]).map_err(|_| "json: bad utf8")?);
                            self.i = en;
                        }
                    }
                }
            }
            b't' => self.lit("true", Json::Bool(true)),
            b'f' => self.lit("false", Json::Bool(false)),
            b'n' => self.lit("null", Json::Null),
            _ => {
                let st = self.i;
                while self.i < self.b.len() && matches!(self.b[self.i], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9') {
                    self.i += 1;
                }
                let t = std::str::from_utf8(&self.b[st..self.i]).unwrap_or("");
                t.parse::<f64>().map(Json::Num).map_err(|_| format!("json: bad number '{t}' at {st}"))
            }
        }
    }
}
