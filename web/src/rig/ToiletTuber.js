// The toilet character. Builds a named, hierarchical rig from a theme and
// drives it every frame from {look, mouth} input plus one-shot actions.
//
// Rig (node names are stable: the Rust app animates the exported GLB by name)
//   ToiletTuber
//   └ body                      yaw/pitch toward the mouse, breathing squash
//     ├ bowl, water, hinge_L/R, neck_pipe
//     ├ seat_pivot └ seat       = LOWER LIP (SkinnedMesh, seat_bone_0..7 hinge -> front)
//     ├ lid_pivot  └ lid        = UPPER LIP (SkinnedMesh, lid_bone_0..7), opens with the mic
//     │              └ lid_bone_7 └ socket_lip_upper (mustaches)
//     ├ socket_face             (compat)
//     └ head                    tank, pivots on the pipe
//       ├ tank, tank_lid
//       ├ eye_L/eye_R └ pupil_L/pupil_R (googly)
//       ├ flush_handle
//       ├ paper_holder └ paper_roll   (tank front-left, axis X: unrolls toward the viewer)
//       └ socket_head_top, socket_tank_front, socket_side_right
// theme.body = { tank: {w,h,d}, eyes: {size, spacing, y} } resizes the tank (see bodyDims).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MaterialLib } from './materials.js';
import { swirlTexture, clamp, smooth as smoothstep, eggify, eggRevolve, lidProfile, seatProfile } from './geo.js';
import { buildAccessory } from '../accessories/index.js';
import { Spring } from '../anim/spring.js';
import { ACTIONS } from '../anim/actions.js';
import { WaterJet } from '../fx/waterJet.js';
import { PaperStrip } from '../fx/paperStrip.js';
import { loadWasm, WasmRig, BUF, SC } from './wasmrig.js';
import { tankShape, pillowGeometry } from './tank.js';

// The per-frame logic runs in Rust (crates/privada-core via web/pkg) when available;
// this file then only builds the meshes and APPLIES the Rust pose. Pure-JS fallback below.
const WASM = await loadWasm();
// physics metadata of the accessories (ACCESSORY_INFO[id].physics) for the Rust props simulation.
// JS fallback (no wasm): props stay attached and the paper never gets wet.
const ACC_INFO = WASM ? await import('../accessories/extra.js').then((m) => m.ACCESSORY_INFO || {}, () => ({})) : {};
const PROP_STRIDE = 12;
// furniture he can sit on (socket floor_under): FURNITURE_INFO[id] = { seatHeight (m), mass?, physics? }.
// web/src/accessories/furniture.js provides it (loaded lazily, optional); registerFurnitureInfo() adds more.
const FURN = {};
let furnVersion = 0;   // bumps when info arrives: rigs re-register their props (furniture physics entries)
export const registerFurnitureInfo = (info) => { Object.assign(FURN, info || {}); furnVersion++; };
/** seat height (m) of a floor_under entry: FURNITURE_INFO seatHeight (given at the default seatScale) x params.scale / seatScale */
const entrySeatHeight = (e) => {
  if (e.seatHeight != null) return +e.seatHeight || 0;
  const f = FURN[e.id];
  if (!f?.seatHeight) return 0;
  const k = Array.isArray(e.params?.scale) ? e.params.scale[1] : e.params?.scale;
  return k == null || !f.seatScale ? +f.seatHeight : (f.seatHeight * k) / f.seatScale;
};
import('../accessories/furniture.js').then((m) => registerFurnitureInfo(m.FURNITURE_INFO), () => {});
const _pm = new THREE.Matrix4(), _pm2 = new THREE.Matrix4(), _pv = new THREE.Vector3(), _pq = new THREE.Quaternion(), _ps = new THREE.Vector3();

/** All proportions in one place (meters-ish, origin on the floor). */
export const DIM = {
  bowlProfile: [
    [0.001, 0.0], [0.30, 0.0], [0.312, 0.012], [0.3, 0.035], [0.25, 0.1], [0.225, 0.2], [0.24, 0.3],
    [0.3, 0.39], [0.36, 0.47], [0.395, 0.55], [0.41, 0.6], [0.412, 0.622], [0.402, 0.636],
    [0.37, 0.638], [0.35, 0.62], [0.33, 0.57], [0.27, 0.48], [0.18, 0.4], [0.09, 0.37], [0.001, 0.365],
  ],
  bowlScaleZ: 1.22,
  rimY: 0.637,
  hingeZ: -0.45,
  waterY: 0.465,
  pipeZ: -0.56,
  headY: 1.0,
  // tank (head) = soft pillow: corner radius, face bulge, bottom width factor, tank-lid edge radius (theme.body.tank)
  // defaults measured on the reference image of the original: height/width 0.76 (hF = default body.tank.h,
  // grows upward from the fixed bottom), slight taper, corner radius ~11% of the width (bottom slightly rounder),
  // thick rounded tank lid (lidThick, slightly domed top) overhanging lidOver all around
  tank: { w: 0.95, h: 0.52, d: 0.36, y: 0.3, z: 0.14, hF: 1.38, round: 0.10, bulge: 0.02, taper: 0.93, lidRound: 0.035, lidThick: 0.14, lidOver: 0.045, lidDome: 0.012 },
  // default googly eyes on the taller face: radius ~0.167 / centre spacing ~0.35 of the tank width, at mid height
  eyeDefaults: { size: 1.13, spacing: 0.97 },
  neckDefault: 0.9,                            // a bit shorter so the taller head stays in frame
  eye: { x: 0.172, y: 0.33, r: 0.14 },
  // eye styles (theme.body.eyes.style; mirror of privada_core::dim::EYE_STYLES): classico (default, the
  // reference image), googly (3D dome), desenho (cartoon oval, no outline), serio (classico + upper eyelid),
  // sticker (flat printed, drifting pupils). outline / pupil = fractions of the radius, hl = highlight / pupil,
  // dome = slight convexity of the flat white (m), damp = pupil spring damping
  eyeStyles: {
    classico: { flat: true, outline: 0.12, pupil: 0.38, oval: 1, pupilZ: 0.002, damp: 16, hl: 0.28, dome: 0.003 },
    googly: { flat: false, outline: 0, pupil: 0.44, oval: 1, pupilZ: 0.03, damp: 9 },
    desenho: { flat: true, outline: 0, pupil: 0.42, oval: 1.15, pupilZ: 0.0005, damp: 14, hl: 0.45, dome: 0 },
    serio: { flat: true, outline: 0.12, pupil: 0.38, oval: 1, pupilZ: 0.002, damp: 16, hl: 0.28, dome: 0.003, lid: 0.3 },
    sticker: { flat: true, outline: 0.11, pupil: 0.3, oval: 1.1, pupilZ: 0.0005, damp: 9, hl: 0.28, dome: 0, drift: true, size: 1.15, spacing: 0.97 },
  },
  egg: 0.08,                                   // front of bowl/seat/lid narrower (elongated bowl)
  rimTop: 0.638, rimOuterR: 0.414,             // bowl rim glaze top / outer radius (lathe units)
  // seat = LOWER LIP: bone chain hinge -> front (bone 0 at z0, then (2rz+0.02)/7 apart); per bone 1..7:
  // front-down angle per unit drop, front-up per unit press, forward slide per unit drop (m)
  seat: {
    // maxDrop = sanity only: the lower lip rolls out and down OVER the bowl's front (never into it);
    // lift = bone lift per unit drop (the roll starts above the rim); pressSlide/tuckSlide = back on M/B/P, F/V
    rx: 0.405, rz: 0.495, hole: 0.62, h: 0.03, bones: 8, z0: 0.03, maxDrop: 0.15,
    dropAng: [0, 0, 0, 0, 0, 1.0, -0.3], pressAng: [0, 0, 0, 0, -0.06, -0.2, -0.08], slide: [0, 0, 0, 0.02, 0.03, 0.045, 0],
    lift: [0, 0, 0, 0, 0, 0.03, 0], pressSlide: [0, 0, 0, 0, -0.015, -0.02, 0], tuckSlide: [0, 0, 0, 0, -0.02, -0.025, 0],
  },
  mouth: { rest: 0.05, spout: [0, 0.69, 0.43], spoutDir: [0, 0.42, 0.9] }, // rest = lips slightly apart
  // thick, soft upper lip; archRest = permanent arch weight, restCurl = front droop (rad per bone x w^2)
  // curlW = share of the front-third fold per lid bone 1..7; curlUp/curlDown = full fold (rad) on O/U / open vowels;
  // poutSlide = lid bone forward slide (m) per unit pucker
  lid: {
    rx: 0.4, rz: 0.49, depth: 0.036, dome: 0.02, edge: 0.02, bones: 8, maxHinge: 1.45, archRest: 0.18, restCurl: -0.03,
    curlW: [0, 0, 0, 0.1, 0.25, 0.3, 0.35], curlUp: 1.0, curlDown: 0.6, poutSlide: [0, 0, 0, 0.01, 0.03, 0.035, 0.02],
  },
  headTalkTilt: 0.15,                          // head tilts back with the opening (rad per rad of hinge)
  jaw: { yaw: 0.1, fwd: 0.025 },               // lid + seat assembly: max yaw (jawSide 1), forward shift (jawFwd 1)
  neckBaseY: 0.62,                             // the pipe turns into the bowl here; body.neck.length scales above
  // paper roll, two mounts (theme.body.roll.mount): 'side' (default) = holder on the tank's left side face,
  // axis Z (side* = beyond the face / above the tank centre / ahead of its centre); 'front' = tank front-left
  // below the eye, axis X (xf, above, gap). x/y/z = the default side position (see bodyDims).
  roll: { x: -0.6, y: 0.38, z: 0.16, r: 0.085, len: 0.19, sideOut: 0.125, sideUp: 0.34, sideFwd: 0.02, xf: -0.3 / 0.95, above: 0.06, gap: 0.025 },
  paperTop: 0.735,                             // closed-lid top for the paper collision
};

/**
 * theme.body -> tank / eyes / handle / roll in head space (mirror of privada_core::dim::BodyDims).
 * tank {w,h,d} factors 0.6..1.6 (bottom and back stay put), eyes {size 0.5..1.8, spacing 0.6..1.6, y -0.12..0.12 m},
 * eyes.style 'classico' (default) | 'googly' | 'desenho' | 'serio' | 'sticker' (overrides: outline 0..0.2, pupil 0.2..0.5, oval 0.9..1.3),
 * neck {length 0.6..1.6} (the pipe above the bowl: moves the head up/down), roll {mount 'side' | 'front'}.
 */
export function bodyDims(body = {}) {
  const f = (v, a, b, d = 1) => (Number.isFinite(v) ? clamp(v, a, b) : d);
  const t = body?.tank || {}, e = body?.eyes || {}, nk = body?.neck || {};
  const w = f(t.w, 0.6, 1.6), h = f(t.h, 0.6, 1.6, DIM.tank.hF), d = f(t.d, 0.6, 1.6);
  const T0 = DIM.tank, E0 = DIM.eye, R = DIM.roll;
  const bottom = T0.y - T0.h / 2, back = T0.z - T0.d / 2;
  const tank = {
    w: T0.w * w, h: T0.h * h, d: T0.d * d, y: 0, z: 0,
    round: f(t.round, 0.02, 0.16, T0.round), bulge: f(t.bulge, 0, 0.06, T0.bulge),
    taper: f(t.taper, 0.7, 1.15, T0.taper), lidRound: f(t.lidRound, 0.01, 0.05, T0.lidRound),
    lidThick: f(t.lidThick, 0.04, 0.2, T0.lidThick), lidOver: f(t.lidOver, 0, 0.08, T0.lidOver),
  };
  tank.y = bottom + tank.h / 2; tank.z = back + tank.d / 2;
  const S = tankShape(tank, tank);
  tank.shape = S; tank.bottom = tank.y - S.topMax; tank.top = tank.y + S.topMax;
  tank.lidTop = tank.top - 0.006 + tank.lidThick + T0.lidDome;   // mirror of BodyDims::lid_top
  const front = tank.z + S.frontMax;                       // frontmost point of the bulged face
  const onFront = (x, y) => { const q = S.front(x, y - tank.y); return { p: [q.p[0], q.p[1] + tank.y, q.p[2] + tank.z], n: q.n }; };
  const style = DIM.eyeStyles[e.style] ? e.style : 'classico', ST = DIM.eyeStyles[style];
  const ED = ST.size ? ST : DIM.eyeDefaults;
  const ef = onFront(E0.x * f(e.spacing, 0.6, 1.6, ED.spacing) * w, tank.y + f(e.y, -0.12, 0.12, 0));   // mid height
  const eye = { x: ef.p[0], y: ef.p[1], z: ef.p[2] + 0.004, n: ef.n, r: E0.r * f(e.size, 0.5, 1.8, ED.size), style, st: ST };
  if (ST.flat) {
    Object.assign(eye, { outline: f(e.outline, 0, 0.2, ST.outline), pupil: f(e.pupil, 0.2, 0.5, ST.pupil), oval: f(e.oval, 0.9, 1.3, ST.oval), pupilZ: ST.pupilZ });
    eye.travel = eye.r * (1 - eye.pupil - eye.outline);
  } else Object.assign(eye, { outline: 0, pupil: ST.pupil, oval: 1, pupilZ: ST.pupilZ, travel: eye.r * 0.5 });
  const hf = onFront(0.34 * w, tank.y + 0.17 * h);
  const neck = f(nk.length, 0.6, 1.6, DIM.neckDefault);
  let roll;
  if (body?.roll?.mount === 'front') {
    const hp = onFront(R.xf * tank.w, bottom + R.above).p;
    roll = { ...R, mount: 'front', holder: hp, x: hp[0], y: hp[1], z: hp[2] + R.r + R.gap };
  } else {
    const q = S.side(-1, Math.min(bottom + R.sideUp - tank.y, S.hy - S.rTop), R.sideFwd), hp = [q.p[0], q.p[1] + tank.y, q.p[2] + tank.z];   // fixed height above the bottom
    roll = { ...R, mount: 'side', holder: hp, x: hp[0] - R.sideOut, y: hp[1], z: hp[2] };
  }
  return {
    ...DIM, tank, eye, front, neck, headY: DIM.neckBaseY + (DIM.headY - DIM.neckBaseY) * neck,
    handle: hf.p.map((v, k) => v + hf.n[k] * 0.005), handleN: hf.n, roll,
  };
}

const tmpV = new THREE.Vector3();

// Derived rig constants (mirror of crates/privada-core/src/dim.rs)
const SEAT_Y0 = 0.006;                                            // seat geometry above its pivot
const SEAT_SEG = (2 * DIM.seat.rz + 0.02) / (DIM.seat.bones - 1);
const LID_Z0 = -0.01;
const LID_SEG = (2 * DIM.lid.rz + 0.02) / (DIM.lid.bones - 1);
const LID_FRONT_Z = DIM.lid.rz - DIM.hingeZ + 0.004;              // lid front point, lid-pivot space
const LID_PIVOT = [0, DIM.rimY + SEAT_Y0 + DIM.seat.h + 0.004, DIM.hingeZ - 0.004];
/** socket mouth_corner: [x, centred z] of the seat's outer outline at x = 0.17 (character's right corner) */
const MOUTH_CORNER = (() => {
  const { rx, rz } = DIM.seat;
  let lo = 0, hi = Math.PI / 2;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (rx * Math.cos(m) * (1 - DIM.egg * Math.sin(m)) > 0.17) lo = m; else hi = m; }
  return [0.17, rz * Math.sin((lo + hi) / 2)];
})();

/** Mouth channels beyond the base five (all optional, default 0); see input/visemes.js */
export const MOUTH_EXT = ['cornerL', 'cornerR', 'jawSide', 'jawFwd', 'upperRaise', 'lips'];
/** blend shapes in morph-buffer order: lid (upper lip) first, then the seat (lower lip); L = the -x side (like eye_L) */
export const LID_MORPHS = ['smile', 'pucker', 'arch', 'corner_L_up', 'corner_L_down', 'corner_R_up', 'corner_R_down', 'pucker_L', 'pucker_R'];
export const SEAT_MORPHS = ['corner_L_up', 'corner_L_down', 'corner_R_up', 'corner_R_down', 'pucker_L', 'pucker', 'pucker_R'];
function sidePucker(u, v, side, a) {
  const c = 0.4 * side, w = Math.max(0, 1 - ((u - c) / 0.7) ** 2), v2 = v * v;
  return [a[0] * side * (1 - u * u) * v2 - a[1] * (u - c) * w * v2, a[2] * w * v2, a[3] * w * v2];
}
/** lid blend shape k at a rest point (lid-pivot space x, z from the hinge) -> [dx, dy, dz] (mirror of rig.rs lid_morph) */
export function lidMorph(k, x, z) {
  const u = clamp(x / DIM.lid.rx, -1, 1), v = clamp(z / (2 * DIM.lid.rz), 0, 1);
  const ul = Math.max(0, -u), ur = Math.max(0, u), fv = v ** 1.5, mid = 1 - u * u;
  switch (k) {
    case 0: return [0, 0.05 * u * u * fv - 0.012 * mid * v, 0];                         // smile: corners lift, centre tenses
    case 1: return [-0.05 * u * v * v, 0.04 * mid * v * v, 0.05 * mid * v * v];        // pucker: centre up/out, corners in
    case 2: { const vv = v ** 1.6; return [-0.025 * u * Math.abs(u) * vv, -0.11 * Math.abs(u) ** 2.2 * vv + 0.02 * mid * vv, 0]; } // arch
    case 3: return [0, 0.09 * ul ** 2.2 * fv, 0];
    case 4: return [-0.024 * ul * ul * fv, -0.12 * ul ** 2.2 * fv, 0];
    case 5: return [0, 0.09 * ur ** 2.2 * fv, 0];
    case 6: return [0.024 * ur * ur * fv, -0.12 * ur ** 2.2 * fv, 0];
    case 7: return sidePucker(u, v, -1, [0.035, 0.03, 0.04, 0.045]);
    case 8: return sidePucker(u, v, 1, [0.035, 0.03, 0.04, 0.045]);
  }
  return [0, 0, 0];
}
/** seat blend shape k at a rest point (seat-pivot space); never moves down (it lies on the rim) */
export function seatMorph(k, x, z) {
  const SS = DIM.seat;
  const u = clamp(x / SS.rx, -1, 1), v = clamp((z + DIM.hingeZ + SS.rz) / (2 * SS.rz), 0, 1);
  const ul = Math.max(0, -u), ur = Math.max(0, u), fv = v ** 1.5, mid = 1 - u * u, v2 = v * v;
  switch (k) {
    case 0: return [0, 0.06 * ul * ul * fv, 0];                                          // corner up (smile)
    case 1: return [0, 0.036 * mid * (1 - 0.5 * u) * v2, 0.016 * mid * v2];             // frown: lip pouts up by the corner
    case 2: return [0, 0.06 * ur * ur * fv, 0];
    case 3: return [0, 0.036 * mid * (1 + 0.5 * u) * v2, 0.016 * mid * v2];
    case 4: return sidePucker(u, v, -1, [0.03, 0.025, 0.02, 0.04]);
    case 5: return [-0.03 * u * v2, 0.02 * mid * v2, 0.04 * mid * v2];
    case 6: return sidePucker(u, v, 1, [0.03, 0.025, 0.02, 0.04]);
  }
  return [0, 0, 0];
}
/** relative morph targets (positions + normal deltas) on a geometry from a delta function */
function addMorphs(geo, names, fn) {
  const pos = geo.attributes.position, n = pos.count;
  const base = geo.attributes.normal.array;
  const P = [], N = [];
  names.forEach((name, k) => {
    const d = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) d.set(fn(k, pos.getX(i), pos.getZ(i)), i * 3);
    const g2 = geo.clone(), p2 = g2.attributes.position;
    for (let i = 0; i < n; i++) p2.setXYZ(i, p2.getX(i) + d[i * 3], p2.getY(i) + d[i * 3 + 1], p2.getZ(i) + d[i * 3 + 2]);
    g2.computeVertexNormals();
    const a = g2.attributes.normal.array, dn = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) dn[i] = a[i] - base[i];
    g2.dispose();
    const pa = new THREE.Float32BufferAttribute(d, 3); pa.name = name;
    P.push(pa); N.push(new THREE.Float32BufferAttribute(dn, 3));
  });
  geo.morphAttributes.position = P;
  geo.morphAttributes.normal = N;
  geo.morphTargetsRelative = true;
}
const _qy = new THREE.Quaternion(), _qx = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0), _X = new THREE.Vector3(1, 0, 0), _HZ = new THREE.Vector3(0, 0, 1);
/** pivot rotation: jaw yaw, then the hinge about the (yawed) hinge axis (= Ry * Rx, as in Rust) */
function setPivotQ(obj, yaw, ang) {
  obj.quaternion.copy(_qy.setFromAxisAngle(_Y, yaw)).multiply(_qx.setFromAxisAngle(_X, ang));
}

/** egg outline radius of a body-space point in bowl-lathe units (undo eggify + z scale) */
export function bowlR(x, z) {
  const r = Math.hypot(x, z);
  const x0 = r > 1e-5 ? x / (1 - DIM.egg * z / r) : x;
  return Math.hypot(x0, z / DIM.bowlScaleZ);
}
const _t4 = new THREE.Matrix4(), _r4 = new THREE.Matrix4();
/** bone chain matrices (pivot space): bone 0 at z0, then seg (+ slide[i]) apart, lifted lift[i], rotated ang[i]*gain about X */
function chainInto(out, z0, seg, ang, slide, gain, lift = null) {
  for (let i = 0; i < out.length; i++) {
    _t4.makeTranslation(0, lift ? lift[i] : 0, i === 0 ? z0 : seg + slide[i]);
    _r4.makeRotationX(ang[i] * gain);
    (i === 0 ? out[i].identity() : out[i].copy(out[i - 1])).multiply(_t4).multiply(_r4);
  }
  return out;
}
const _sa = new THREE.Vector3(), _sb = new THREE.Vector3();
/** linear-blend skinning of a rest point (same weights as the meshes: 2 bones, linear in z) */
function skinPoint(chain, z0, seg, x, y, z, out) {
  const n = chain.length;
  const f = clamp(z - z0, 0, seg * (n - 1) - 1e-4) / seg;
  const b = Math.min(n - 2, Math.floor(f)), t = f - b;
  _sa.set(x, y, z - (z0 + b * seg)).applyMatrix4(chain[b]);
  _sb.set(x, y, z - (z0 + (b + 1) * seg)).applyMatrix4(chain[b + 1]);
  return out.copy(_sa).multiplyScalar(1 - t).addScaledVector(_sb, t);
}
/** seat underside samples (seat-pivot space) over the front half of the ring, for the rim clamp */
// (dense at the front edge, which curls down; the clamp keeps SEAT_RIM_MARGIN extra from the rim)
const SEAT_UNDER = [], SEAT_RIM_MARGIN = 0.008;
for (let j = 0; j < 11; j++) {
  const th = 0.2 + (j * (Math.PI - 0.4)) / 10, sn = Math.sin(th);
  const ex = DIM.seat.rx * Math.cos(th) * (1 - DIM.egg * sn), ez = DIM.seat.rz * sn;
  for (const k of [DIM.seat.hole, 0.715, 0.81, 0.86, 0.9, 0.93, 0.955, 0.978, 1]) SEAT_UNDER.push([ex * k, SEAT_Y0, ez * k - DIM.hingeZ]);
}
// seat top samples (rest x, centred z) over the front ring, for the lid-above-seat floor
const SEAT_TOP_XZ = [];
for (const d of [-0.7, -0.35, 0, 0.35, 0.7]) {
  const th = Math.PI / 2 + d, sn = Math.sin(th);
  const ex = DIM.seat.rx * Math.cos(th) * (1 - DIM.egg * sn), ez = DIM.seat.rz * sn;
  for (const k of [0.7, 0.85, 1]) SEAT_TOP_XZ.push([ex * k, ez * k]);
}
const LID_ZC = -DIM.hingeZ + 0.004;
// outside of the bowl profile [y, r] (lathe units) for the paper collision
const BOWL_OUTER = [[0, 0.3], [0.012, 0.312], [0.035, 0.3], [0.1, 0.25], [0.2, 0.225], [0.3, 0.24], [0.39, 0.3], [0.47, 0.36], [0.55, 0.395], [0.6, 0.41], [0.622, 0.412]];
const PAPER_MARGIN = 0.012;
function bowlOuterR(y) {
  if (y >= 0.622) return 0.415;
  for (let i = 1; i < BOWL_OUTER.length; i++) {
    const [y0, r0] = BOWL_OUTER[i - 1], [y1, r1] = BOWL_OUTER[i];
    if (y <= y1) return r0 + (r1 - r0) * clamp((y - y0) / (y1 - y0), 0, 1);
  }
  return 0.415;
}
/** true if a body-space point is inside the bowl (rim, opening or wall), with an extra radial margin (mirror of rig.rs in_bowl) */
export function inBowl(p, margin = 0) {
  if (p.y >= DIM.rimTop + 0.002 + margin * 0.25) return false;
  const lim = p.y >= 0.622 ? DIM.rimOuterR : bowlOuterR(p.y) + 0.002;
  return bowlR(p.x, p.z) < lim + margin;
}
/** body-space point inside the bowl / closed-lid volume -> pushed out (in place); false if outside */
export function pushOutOfBowl(b) {
  const top = DIM.paperTop + PAPER_MARGIN;
  if (b.y < 0 || b.y > top) return false;
  const r = bowlR(b.x, b.z), rw = bowlOuterR(b.y) + PAPER_MARGIN;
  if (r >= rw) return false;
  if (top - b.y <= (rw - r) * DIM.bowlScaleZ || r < 1e-4) b.y = top;
  else { const k = rw / r; b.x *= k; b.z *= k; }
  return true;
}

export class ToiletTuber {
  constructor(theme) {
    this.root = new THREE.Group();
    this.root.name = 'ToiletTuber_root';
    this.listeners = new Set();
    this.time = 0;
    this.active = [];
    this.s = {
      yaw: new Spring(60, 11), pitch: new Spring(60, 11),
      hYaw: new Spring(110, 9), hPitch: new Spring(110, 9), hRoll: new Spring(90, 7),
      lid: new Spring(260, 15), seat: new Spring(180, 10),
      px: new Spring(320, 9), py: new Spring(320, 9),
      lift: new Spring(200, 18), squash: new Spring(260, 10), eyeScale: new Spring(200, 12),
      handle: new Spring(400, 20),
      smile: new Spring(220, 18), pucker: new Spring(220, 18), arch: new Spring(200, 14),
      lean: new Spring(60, 11),
      drop: new Spring(200, 16),     // lower lip drop 0..1 (slides the seat front out + curls it down)
      cornerL: new Spring(220, 18), cornerR: new Spring(220, 18),
      jawSide: new Spring(160, 16), jawFwd: new Spring(160, 16), upperRaise: new Spring(220, 18),
      press: new Spring(220, 18), tuck: new Spring(220, 18),   // lower lip up/in (M/B/P), under the upper lip (F/V)
    };
    this.morphW = new Array(LID_MORPHS.length + SEAT_MORPHS.length).fill(0);
    this.jawYaw = 0; this.jawFwd = 0;
    // total look range (body + head): body ~55% of yaw / 30% of pitch, head the rest
    this.lookLimits = { yaw: (80 * Math.PI) / 180, pitch: (35 * Math.PI) / 180 };
    this.mouthVec = { open: 0, round: 0, wide: 0, closed: 0, sib: 0 };
    this.rust = WASM ? new WasmRig(WASM, (Math.random() * 4294967295) >>> 0) : null;
    this.sitS = new Spring(110, 21);   // JS path: base height (Rust keeps its own)
    this._seatSent = -1;
    this.restOpen = DIM.mouth.rest;
    this.blinkTimer = 2 + Math.random() * 3;
    this.blinkT = -1;
    this.swirlSpeed = 0;
    this.setTheme(theme);
  }

  /** true when the Rust/wasm rig drives the character */
  get usesRust() { return !!this.rust; }

  /* ------------------------------------------------------- sitting on furniture */
  /** persistent sit height (m): raises the whole body base, smoothly (~0.3 s); 0 = on the floor */
  get sitHeight() { return this.rust ? this.rust.r.sit_height() : this.sitS.x; }
  set sitHeight(h) {
    h = Number.isFinite(+h) ? clamp(+h, 0, 2) : 0;
    if (this.rust) this.rust.r.set_sit_height(h); else this.sitS.target = h;
  }
  get isSitting() { return this.rust ? this.rust.r.is_sitting() : this.sitS.target > 0.01; }
  /** seat height of the furniture equipped on floor_under (FURNITURE_INFO[id].seatHeight x its scale), 0 = none */
  seatHeight() {
    let h = 0;
    for (const w of this.accessories || []) {
      if (w.userData.slot !== 'floor_under') continue;
      const sh = entrySeatHeight(w.userData.entry || {});   // honours params.scale
      if (sh > 0) h = Math.max(h, sh * w.scale.y + w.position.y);   // + the slot's transform (scale / lift)
    }
    return h;
  }
  /** keep the rig's seat height in sync with the equipped furniture (cheap; every frame) */
  syncSeat() {
    if (this._furnV !== furnVersion) { this._furnV = furnVersion; if (this.rust && this.accessories) this.registerProps(); }
    const h = this.seatHeight();
    if (h === this._seatSent) return;
    this._seatSent = h;
    this.rust?.r.set_seat_height?.(h);
    if (!this.rust && h <= 0) this.sitS.target = 0;
  }
  /** total look range in radians (default 80° yaw, 35° pitch) */
  setLookLimits(maxYaw, maxPitch) {
    this.lookLimits = { yaw: clamp(maxYaw, 0, 1.6), pitch: clamp(maxPitch, 0, 0.9) };
    this.rust?.r.set_look_limits(maxYaw, maxPitch);
  }
  get restOpen() { return this._restOpen; }
  set restOpen(v) { this._restOpen = v; this.rust?.r.set_rest(v); }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  /* ------------------------------------------------------------ build */
  setTheme(theme) {
    this.theme = theme;
    if (this.body) {
      this.root.remove(this.body, this.fx);
      this.body.traverse((o) => o.geometry?.dispose());
      this.mats.dispose();
    }
    this.mats = new MaterialLib(theme.materials);
    this.dim = bodyDims(theme.body);
    this.rust?.r.set_body_dims(JSON.stringify(theme.body || {}));
    this.build();
  }

  build() {
    const M = this.mats, D = this.dim || (this.dim = bodyDims(this.theme?.body));
    const mesh = (name, geo, mat, parent) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name; m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const group = (name, parent, x = 0, y = 0, z = 0) => {
      const g = new THREE.Group();
      g.name = name; g.position.set(x, y, z);
      parent.add(g);
      return g;
    };
    const porcelain = M.get('porcelain');
    const chrome = M.get('chrome');

    const body = this.body = group('body', this.root);
    this.nodes = { body };

    // Bowl + pedestal (one lathe, elongated front-to-back)
    const bowlGeo = new THREE.LatheGeometry(D.bowlProfile.map(([r, y]) => new THREE.Vector2(r, y)), 96);
    bowlGeo.scale(1, 1, D.bowlScaleZ);
    eggify(bowlGeo, D.egg);
    // the bowl interior reads as the MOUTH CAVITY: vertex colours darken the inside toward the bottom
    {
      const np = D.bowlProfile.length, inner = D.bowlProfile.findIndex(([r, y], i) => i > 0 && y >= D.rimY - 0.001 && r < 0.39);
      const bp = bowlGeo.attributes.position, col = new Float32Array(bp.count * 3);
      for (let i = 0; i < bp.count; i++) {
        const j = i % np, y = bp.getY(i);
        const c = j < inner ? 1 : 0.3 + 0.7 * smoothstep(D.waterY - 0.02, D.rimY, y) ** 1.5;
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c;
      }
      bowlGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    }
    const bowlMat = porcelain.clone(); bowlMat.side = THREE.DoubleSide; bowlMat.vertexColors = true;
    this.nodes.bowl = mesh('bowl', bowlGeo, bowlMat, body);

    // Water inside the bowl
    const waterMat = M.get('water').clone();
    this.waterTex = waterMat.normalMap || null;
    const waterGeo = new THREE.CircleGeometry(0.262, 64);
    waterGeo.rotateX(-Math.PI / 2); waterGeo.scale(1, 1, D.bowlScaleZ); eggify(waterGeo, D.egg);
    this.nodes.water = mesh('water', waterGeo, waterMat, body);
    this.nodes.water.position.y = D.waterY;
    this.nodes.water.castShadow = false;
    const swirlMat = new THREE.MeshBasicMaterial({ map: swirlTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.swirlTex = swirlMat.map;
    this.nodes.swirl = mesh('water_swirl', waterGeo.clone(), swirlMat, body);
    this.nodes.swirl.position.y = D.waterY + 0.002;
    this.nodes.swirl.castShadow = false;

    // Seat (rounded ring) = LOWER LIP and lid = UPPER LIP, both hinged at the back.
    // The seat is a SkinnedMesh with a bone chain hinge -> front (like the lid): open vowels
    // slide its front out over the bowl's front edge and curl it down, M/B/P press it up.
    const rubber = M.get('rubber', { color: '#1c1c1c', roughness: 0.85 });
    const seatPivot = group('seat_pivot', body, 0, D.rimY, D.hingeZ);
    const seatMat = M.get('seat', 'porcelain').clone();
    seatMat.side = THREE.DoubleSide;
    const SS = D.seat;
    const seatGeo = eggRevolve(SS.rx, SS.rz, D.egg, seatProfile(SS.rx, SS.hole, SS.h), 160);
    seatGeo.translate(0, SEAT_Y0, -D.hingeZ);             // hinge at the pivot origin
    const sB = SS.bones, sSeg = SEAT_SEG;
    {
      const si = [], sw = [], sp = seatGeo.attributes.position;
      for (let i = 0; i < sp.count; i++) {
        const f = clamp(sp.getZ(i) - SS.z0, 0, sSeg * (sB - 1) - 1e-4) / sSeg;
        const b = Math.min(sB - 2, Math.floor(f)), t = f - b;
        si.push(b, b + 1, 0, 0); sw.push(1 - t, t, 0, 0);
      }
      seatGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      seatGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    }
    addMorphs(seatGeo, SEAT_MORPHS, seatMorph);   // lower-lip corners / purse (never down)
    const seat = new THREE.SkinnedMesh(seatGeo, seatMat);
    seat.name = 'seat'; seat.castShadow = seat.receiveShadow = true;
    seat.frustumCulled = false;
    this.seatBones = [];
    for (let i = 0; i < sB; i++) {
      const b = new THREE.Bone();
      b.name = `seat_bone_${i}`;
      b.position.z = i === 0 ? SS.z0 : sSeg;
      (i === 0 ? seat : this.seatBones[i - 1]).add(b);
      this.seatBones.push(b);
    }
    seat.updateMatrixWorld(true);
    seat.bind(new THREE.Skeleton(this.seatBones));
    seatPivot.add(seat);
    this.seatLip = this.seatBones.slice(1).map((_, i) => new Spring(260 - i * 18, 13 + i * 0.5));
    this.seatAng = new Array(sB).fill(0); this.seatSlide = new Array(sB).fill(0); this.seatLift = new Array(sB).fill(0);
    this.seatGain = 1; this.seatFloor = 0;
    // rubber bumpers ride on the bone right behind them (pivot-space z -> bone-local z)
    const onSeatBone = (name, geo, x, y, zc) => {
      const z = zc - D.hingeZ, k = clamp(Math.floor((z - SS.z0) / sSeg), 0, sB - 1);
      const b = mesh(name, geo, rubber, this.seatBones[k]);
      b.position.set(x, y, z - (SS.z0 + k * sSeg));
      return b;
    };
    for (const [x, z] of [[0.3, 0.12], [-0.3, 0.12], [0.24, -0.3], [-0.24, -0.3]])
      onSeatBone('seat_bumper', new THREE.CylinderGeometry(0.018, 0.02, 0.008, 16), x, SEAT_Y0 - 0.003, z);

    // Lid is a SkinnedMesh with a bone chain hinge->front so it bends like a lip.
    const lidPivot = group('lid_pivot', body, 0, D.rimY + 0.006 + D.seat.h + 0.004, D.hingeZ - 0.004);
    const L = D.lid;
    const lidGeo = eggRevolve(L.rx, L.rz, D.egg, lidProfile(L.rx, L.depth, L.dome, L.edge), 160);
    lidGeo.translate(0, 0, LID_FRONT_Z - L.rz);           // hinge at the pivot origin
    const span = 2 * L.rz + 0.02, nB = L.bones, segL = span / (nB - 1);
    const si = [], sw = [];
    const lp = lidGeo.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const f = clamp(lp.getZ(i) + 0.01, 0, span - 1e-4) / segL;
      const b = Math.min(nB - 2, Math.floor(f)), t = f - b;
      si.push(b, b + 1, 0, 0); sw.push(1 - t, t, 0, 0);
    }
    lidGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    lidGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    // Blend shapes so the upper lip can curve with the sound (formulas shared with Rust: lidMorph):
    //  smile = corners lift, centre tenses (E, I); pucker = centre front up/out (O, U);
    //  arch = upper-lip curve (corners fold down); corner_L/R_up/down; pucker_L/R (pursed to a side)
    addMorphs(lidGeo, LID_MORPHS, lidMorph);
    const lidMat = M.get('lid', 'porcelain').clone();
    lidMat.side = THREE.DoubleSide;
    const lid = new THREE.SkinnedMesh(lidGeo, lidMat);
    lid.name = 'lid'; lid.castShadow = lid.receiveShadow = true;
    lid.frustumCulled = false;
    this.lidBones = [];
    for (let i = 0; i < nB; i++) {
      const b = new THREE.Bone();
      b.name = `lid_bone_${i}`;
      b.position.z = i === 0 ? -0.01 : segL;
      (i === 0 ? lid : this.lidBones[i - 1]).add(b);
      this.lidBones.push(b);
    }
    lid.updateMatrixWorld(true);
    lid.bind(new THREE.Skeleton(this.lidBones));
    lidPivot.add(lid);
    this.lipSprings = this.lidBones.slice(1).map((_, i) => new Spring(300 - i * 28, 8 + i * 0.8));
    this.lidSlide = new Array(nB).fill(0);
    for (const [x, z] of [[0.26, 0.2], [-0.26, 0.2]])
      onSeatBone('lid_bumper', new THREE.CylinderGeometry(0.016, 0.018, 0.006, 16), x, SEAT_Y0 + D.seat.h + 0.004, z);
    Object.assign(this.nodes, { seatPivot, seat, lidPivot, lid });

    // Hinge: porcelain-colored covers over chrome posts, like a real seat hinge
    for (const s of [1, -1]) {
      const post = mesh(s > 0 ? 'hinge_post_R' : 'hinge_post_L', new THREE.CylinderGeometry(0.014, 0.014, 0.05, 16), chrome, body);
      post.position.set(0.16 * s, D.rimY + 0.01, D.hingeZ - 0.035);
      const cover = mesh(s > 0 ? 'hinge_R' : 'hinge_L', new RoundedBoxGeometry(0.075, 0.042, 0.07, 3, 0.016), M.get('seat', 'porcelain'), body);
      cover.position.set(0.16 * s, D.rimY + 0.034, D.hingeZ - 0.035);
      const pin = mesh('hinge_pin', new THREE.CylinderGeometry(0.009, 0.009, 0.24, 12), chrome, body);
      pin.rotation.z = Math.PI / 2; pin.position.set(0.16 * s - 0.06 * s, D.rimY + 0.034, D.hingeZ - 0.035);
      pin.scale.y = 0.35;
    }
    // Floor bolt caps
    for (const s of [1, -1]) {
      const cap = mesh('bolt_cap', new THREE.SphereGeometry(0.028, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.get('boltCap', 'porcelain'), body);
      cap.scale.set(1, 0.8, 1.3); cap.position.set(0.27 * s, 0.0, 0.02);
    }

    // Neck pipe from bowl back up into the tank
    const pipeCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, D.headY + 0.06, D.pipeZ), new THREE.Vector3(0, 0.62, D.pipeZ),
      new THREE.Vector3(0, 0.5, D.pipeZ + 0.03), new THREE.Vector3(0, 0.46, -0.43),
    ]);
    mesh('neck_pipe', new THREE.TubeGeometry(pipeCurve, 48, 0.032, 16), chrome, body);
    for (const [y, z] of [[D.headY - 0.005, D.pipeZ], [0.7, D.pipeZ]]) {
      const nut = mesh('pipe_nut', new THREE.CylinderGeometry(0.048, 0.048, 0.035, 6), chrome, body);
      nut.position.set(0, y, z);
    }

    const faceSock = group('socket_face', body, 0, 0.5, 0.464);

    // Head = tank
    const head = this.head = group('head', body, 0, D.headY, D.pipeZ);
    const T = D.tank;
    // soft pillow tank (tank.js: rounded + bulged + tapered, same surface math as Rust TankShape)
    const tank = mesh('tank', pillowGeometry(T.shape), porcelain, head);
    tank.position.set(0, T.y, T.z);
    // thick rounded tank lid: a slab overhanging lidOver all around, slightly domed on top
    const lidT = T.lidThick, lidOv = T.lidOver, lidTop = T.lidTop;
    const lidW = 2 * (T.shape.hx + lidOv), lidD = 2 * (T.shape.hz + lidOv);
    const tankLidGeo = new RoundedBoxGeometry(lidW, lidT, lidD, 4, Math.min(T.lidRound, lidT / 2 - 0.002));
    {
      const lp = tankLidGeo.attributes.position;
      for (let i = 0; i < lp.count; i++) {
        const y = lp.getY(i);
        if (y <= 0) continue;
        const ux = clamp(lp.getX(i) / (lidW / 2), -1, 1), uz = clamp(lp.getZ(i) / (lidD / 2), -1, 1);
        lp.setY(i, y + DIM.tank.lidDome * (y / (lidT / 2)) * (1 - ux * ux) * (1 - uz * uz));
      }
    }
    const tankLid = mesh('tank_lid', tankLidGeo, M.get('tankLid', 'porcelain'), head);
    tankLid.position.set(0, lidTop - DIM.tank.lidDome - lidT / 2, T.z);
    const front = D.front;                                   // frontmost point of the bulged face
    const _Z = new THREE.Vector3(0, 0, 1), faceQ = (n) => new THREE.Quaternion().setFromUnitVectors(_Z, new THREE.Vector3(...n));
    for (const sx of [1, -1]) {
      const bolt = mesh('tank_bolt', new THREE.CylinderGeometry(0.02, 0.02, 0.025, 6), M.get('bolt', 'chrome'), head);
      bolt.position.set(0.3 * sx * (T.w / DIM.tank.w), T.bottom - 0.012, T.z);
      const washer = mesh('tank_washer', new THREE.CylinderGeometry(0.03, 0.03, 0.005, 24), rubber, head);
      washer.position.set(0.3 * sx * (T.w / DIM.tank.w), T.bottom - 0.002, T.z);
    }
    // fill-valve inlet under the tank (left)
    const inlet = mesh('tank_inlet', new THREE.CylinderGeometry(0.03, 0.03, 0.04, 6), M.get('valve', 'chrome'), head);
    inlet.position.set(-0.36 * (T.w / DIM.tank.w), T.bottom - 0.02, T.z - 0.06);

    // Eyes: flat printed STICKER eyes (default: white vertical oval, thick black outline, small pupil
    // dot with a highlight, conformed to the curved tank face) or the 3D GOOGLY ones (eyes.style)
    this.eyes = []; this.eyelids = null;
    const E = D.eye;   // follows theme.body (style, size, spacing, height)
    for (const s of [-1, 1]) {
      const eye = group(s < 0 ? 'eye_L' : 'eye_R', head, E.x * s, E.y, E.z);
      eye.quaternion.copy(faceQ([E.n[0] * s, E.n[1], E.n[2]]));   // flush with the curved front face
      let pupil;
      if (E.st.flat) {
        // flat white disc on the curved face (slight convexity, no glass dome), thick outline, pupil + highlight
        const conform = this.stickerConform(eye, T, E.oval, E.r, E.st.dome);
        const white = mesh('eye_white', conform(new THREE.CircleGeometry(E.r, 72), 0.0015), M.get('eyeWhite'), eye);
        white.castShadow = false;
        if (E.outline > 0) {
          const rim = mesh('eye_rim', conform(new THREE.RingGeometry(E.r * (1 - E.outline), E.r, 72, 2), 0.0025), M.get('outline'), eye);
          rim.castShadow = false;
        }
        pupil = mesh(s < 0 ? 'pupil_L' : 'pupil_R', new THREE.CylinderGeometry(E.r * E.pupil, E.r * E.pupil, 0.002, 40), M.get('pupil'), eye);
        pupil.rotation.x = Math.PI / 2; pupil.position.z = E.pupilZ; pupil.castShadow = false;
        // white highlight up-right on the pupil (pupil-local: +x right, -z up, +y out)
        const hr = E.r * E.pupil * E.st.hl;
        const hl = mesh('pupil_highlight', new THREE.CylinderGeometry(hr, hr, 0.001, 20), M.get('eyeWhite'), pupil);
        hl.position.set(E.r * E.pupil * 0.4, 0.0012, -E.r * E.pupil * 0.4); hl.castShadow = false;
        if (E.st.lid) {
          // serio: porcelain upper eyelid over the top part of the eye (segment rebuilt as it lowers)
          const lid = mesh('eyelid', new THREE.BufferGeometry(), porcelain, eye);
          lid.castShadow = false;
          this.eyelids = this.eyelids || [];
          this.eyelids.push({ lid, e: null });
        }
      } else {
        const white = mesh('eye_white', new THREE.CylinderGeometry(E.r, E.r, 0.025, 48), M.get('eyeWhite'), eye);
        white.rotation.x = Math.PI / 2; white.position.z = 0.0125;
        const rim = mesh('eye_rim', new THREE.TorusGeometry(E.r, 0.009, 10, 64), M.get('outline'), eye);
        rim.position.z = 0.025;
        pupil = mesh(s < 0 ? 'pupil_L' : 'pupil_R', new THREE.CylinderGeometry(E.r * 0.44, E.r * 0.44, 0.012, 40), M.get('pupil'), eye);
        pupil.rotation.x = Math.PI / 2; pupil.position.z = 0.03;
        const dome = mesh('eye_dome', new THREE.SphereGeometry(E.r, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.get('eyeDome', { color: '#ffffff', transparent: true, opacity: 0.12, roughness: 0.02, clearcoat: 1 }), eye);
        dome.rotation.x = Math.PI / 2; dome.scale.y = 0.35; dome.position.z = 0.025; dome.castShadow = false;
      }
      this.eyes.push({ eye, pupil, s });
    }
    this.s.px.d = this.s.py.d = E.st.damp;   // calmer pupils for the flat eye styles (as in Rust)

    // Flush handle (front, upper right)
    const handle = this.nodes.handle = group('flush_handle', head, ...D.handle);
    this.handleBaseQ = faceQ(D.handleN);                          // on the curved face; the lever turns about its local z
    handle.quaternion.copy(this.handleBaseQ);
    const esc = mesh('handle_escutcheon', new THREE.CylinderGeometry(0.036, 0.04, 0.012, 32), chrome, handle);
    esc.rotation.x = Math.PI / 2; esc.position.z = 0.006;
    const nut = mesh('handle_nut', new THREE.CylinderGeometry(0.022, 0.022, 0.016, 6), chrome, handle);
    nut.rotation.x = Math.PI / 2; nut.position.z = 0.02;
    const leverPts = [[0, 0, 0.028], [-0.05, -0.004, 0.036], [-0.1, -0.012, 0.04], [-0.13, -0.02, 0.04]];
    const lever = mesh('handle_lever', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(leverPts.map((q) => new THREE.Vector3(...q))), 24, 0.009, 12), chrome, handle);
    lever.scale.set(1, 1.15, 0.8);
    const knob = mesh('handle_knob', new THREE.SphereGeometry(0.014, 16, 12), chrome, handle);
    knob.position.set(-0.132, -0.02, 0.04);

    // Toilet-paper holder, two mounts (theme.body.roll.mount):
    //  'side'  (default): plate on the tank's left side face, an arm out to the side, rod + roll along Z;
    //  'front': two arms out of the tank FRONT-LEFT face (below the left eye), rod + roll along X.
    // Either way the paper action streams the strip FORWARD toward the camera.
    const R = D.roll, front_ = R.mount === 'front';
    const paperMat = M.get('paper');
    let roll;
    if (front_) {
      const holder = group('paper_holder', head, ...R.holder);   // on the curved front face
      const out = R.z - R.holder[2];                            // roll axis in front of the face
      const ax = R.len / 2 + 0.022;
      for (const sx of [1, -1]) {
        const plate = mesh('holder_plate', new RoundedBoxGeometry(0.05, 0.07, 0.014, 3, 0.006), chrome, holder);
        plate.position.set(ax * sx, 0, 0.007);
        const arm = mesh('holder_arm', new THREE.CylinderGeometry(0.011, 0.011, out, 12), chrome, holder);
        arm.rotation.x = Math.PI / 2; arm.position.set(ax * sx, 0, out / 2);
      }
      const rod = mesh('holder_rod', new THREE.CylinderGeometry(0.01, 0.01, 2 * ax + 0.02, 12), chrome, holder);
      rod.rotation.z = Math.PI / 2; rod.position.set(0, 0, out);
      roll = this.nodes.roll = group('paper_roll', holder, 0, 0, out);
    } else {
      const holder = group('paper_holder', head, ...R.holder);   // on the curved left side face
      const off = R.x - R.holder[0];                            // roll axis out to the side (< 0)
      const plate = mesh('holder_plate', new RoundedBoxGeometry(0.02, 0.07, 0.07, 3, 0.008), chrome, holder);
      plate.position.set(-0.008, 0, -R.len / 2 - 0.03);
      const arm = mesh('holder_arm', new THREE.CylinderGeometry(0.012, 0.012, Math.abs(off), 12), chrome, holder);
      arm.rotation.z = Math.PI / 2; arm.position.set(off / 2, 0, -R.len / 2 - 0.03);
      const rod = mesh('holder_rod', new THREE.CylinderGeometry(0.01, 0.01, R.len + 0.07, 12), chrome, holder);
      rod.rotation.x = Math.PI / 2; rod.position.set(off, 0, 0);
      roll = this.nodes.roll = group('paper_roll', holder, off, 0, 0);
    }
    // roll meshes: cylinders along the mount's axis (X front, Z side)
    const axisRot = (o) => { if (front_) o.rotation.z = Math.PI / 2; else o.rotation.x = Math.PI / 2; };
    const outer = mesh('roll_paper', new THREE.CylinderGeometry(R.r, R.r, R.len, 48, 1, true), paperMat, roll);
    axisRot(outer);
    const core = mesh('roll_core', new THREE.CylinderGeometry(0.024, 0.024, R.len + 0.004, 24, 1, true), M.get('cardboard'), roll);
    axisRot(core); core.material.side = THREE.DoubleSide;
    for (const sg of [1, -1]) {
      const cap = mesh('roll_end', new THREE.RingGeometry(0.024, R.r, 48), M.get('rollEnd', 'paper'), roll);
      if (front_) { cap.position.x = (R.len / 2) * sg; cap.rotation.y = (Math.PI / 2) * sg; }
      else { cap.position.z = (R.len / 2) * sg; if (sg < 0) cap.rotation.y = Math.PI; }
    }
    const seam = mesh('roll_seam', front_ ? new THREE.BoxGeometry(R.len, 0.004, 0.004) : new THREE.BoxGeometry(0.004, 0.004, R.len), M.get('outline'), roll);
    seam.position.set(0, R.r, 0);

    // Sockets for theme accessories
    const tf = T.shape.front(0, -0.17 * (T.h / DIM.tank.h));
    const tankFront = [tf.p[0] + tf.n[0] * 0.01, tf.p[1] + T.y + tf.n[1] * 0.01, tf.p[2] + T.z + tf.n[2] * 0.01];
    this.sockets = {
      face: faceSock,
      head_top: group('socket_head_top', head, 0, lidTop, T.z),
      tank_front: group('socket_tank_front', head, ...tankFront),
      side_right: group('socket_side_right', head, T.shape.halfW + 0.01, T.y, T.z),
      body_front: group('socket_body_front', body, 0, 0.25, 0.27),
      neck: group('socket_neck', body, 0, D.neckBaseY + (0.86 - D.neckBaseY) * D.neck, D.pipeZ + 0.09),
      eyes: group('socket_eyes', head, 0, D.eye.y, D.eye.z + 0.041),
      back: group('socket_back', head, 0, T.y, T.z - T.shape.hz - T.bulge - 0.01),
      lid_top: group('socket_lid_top', this.lidBones[6], 0, L.depth + 0.006, 0.06),
      // upper lip: the lid's front point (underside), child of the front-most lid bone, +z out
      // lower lip: centre of the lip gap at the seat's top front edge / its right (+x) corner, turned 25 deg
      // outward; children of seat_bone_6 (the bone that carries most of the front edge's skin weight)
      mouth: group('socket_mouth', this.seatBones[6], 0, SEAT_Y0 + SS.h, SS.rz - D.hingeZ - (SS.z0 + 6 * sSeg)),
      mouth_corner: group('socket_mouth_corner', this.seatBones[6], MOUTH_CORNER[0], SEAT_Y0 + SS.h, MOUTH_CORNER[1] - D.hingeZ - (SS.z0 + 6 * sSeg)),
      lip_upper: group('socket_lip_upper', this.lidBones[nB - 1], 0, 0, LID_FRONT_Z - (LID_Z0 + (nB - 1) * segL)),
      floor_left: group('socket_floor_left', this.root, -0.62, 0, 0.15),
      floor_right: group('socket_floor_right', this.root, 0.62, 0, 0.15),
      // root space, on the floor right under the pedestal (+z = his forward): chairs / thrones he sits on
      floor_under: group('socket_floor_under', this.root, 0, 0, 0),
    };
    this.sockets.back.rotation.y = Math.PI;
    this.sockets.mouth_corner.rotation.y = (25 * Math.PI) / 180;
    this.buildAccessories();

    // FX (world space, not part of the exported rig)
    this.fx = new THREE.Group();
    this.fx.name = 'fx';
    this.root.add(this.fx);
    const jetMat = M.get('water').clone();
    this.jet = new WaterJet(jetMat);
    this.jet.levelOffset = 0;
    this.jet.onSplash = () => { if (Math.random() < 0.05) this.emit('sfx', 'drip'); };
    this.fx.add(this.jet.group);
    const stripMat = M.get('paperStrip', 'paper');
    this.paper = new PaperStrip(stripMat, R.len * 0.96);
    this.torn = new PaperStrip(stripMat, R.len * 0.96);
    this.torn.anchored = false; this.torn.fade = 0;
    this.fx.add(this.paper.mesh, this.torn.mesh);
    if (this.rust) {   // wet paper: per-vertex RGBA from Rust (darker + translucent where wet)
      for (const ps of [this.paper, this.torn]) {
        const n = ps.geo.attributes.position.count;
        ps.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4).fill(1), 4).setUsage(THREE.DynamicDrawUsage));
        ps.mat.vertexColors = true;
        ps._wet = false;
      }
    }
    this.paperOutDir = new THREE.Vector3(0, 0, 1);
    this.root.updateMatrixWorld(true);
    this.updatePaperAnchor();
    this.paper.reset(this.paper.anchor);
    this.poseNodes = null;      // Rust pose -> node map (rebuilt lazily after a rebuild)
    this.puddleVersion = -1;
  }

  /** (Re)build only the accessories from this.theme.slots (cheap: no full rebuild). */
  buildAccessories() {
    for (const a of this.accessories || []) {
      a.parent?.remove(a);
      a.traverse((o) => { if (o.isMesh && !o.userData.keepGeo) o.geometry?.dispose(); });
    }
    this.accessories = [];
    const ctx = { THREE, mats: this.mats, theme: this.theme, dim: this.dim || DIM };
    for (const [slot, entries] of Object.entries(this.theme.slots || {})) {
      const sock = this.sockets[slot];
      if (!sock) { console.warn(`[theme] unknown socket "${slot}"`); continue; }
      entries.forEach((e, i) => {
        if (e.hidden) return;
        const inner = buildAccessory(ctx, { id: e.id, params: e.params });
        if (!inner) return;
        const wrap = new THREE.Group();            // user transform lives on the wrapper,
        wrap.name = `slot_${slot}_${i}_${e.id}`;   // so accessory animations stay intact
        wrap.userData = { slot, index: i, entry: e };
        wrap.add(inner);
        ToiletTuber.applyTransform(wrap, e.transform);
        sock.add(wrap);
        this.accessories.push(wrap);
      });
    }
    this.registerProps();
  }

  /* ------------------------------------------------------- props physics (Rust only) */
  // Accessories with ACCESSORY_INFO[id].physics (or a slot entry `physics: {...}` / `physical: true`;
  // `physics: false` opts out) become rigid bodies in Rust when water / paper / another prop hits them.
  // Each frame: rest matrices (socket moves with him) -> Rust; while not at rest the Rust pose drives
  // the wrapper (or the part); back at rest the original local transform is restored.
  registerProps() {
    this.props = [];
    const r = this.rust?.r;
    if (!r?.register_prop) return;
    r.clear_props();
    if (!this.root) return;
    this.root.updateMatrixWorld(true);
    const rootInv = _pm2.copy(this.root.matrixWorld).invert();
    for (const wrap of this.accessories) {
      const e = wrap.userData.entry || {};
      if (e.physics === false || e.physical === false) continue;
      let meta = (e.physics && typeof e.physics === 'object' ? e.physics : null) ||
        ACC_INFO[e.id]?.physics || FURN[e.id]?.physics || (e.physical ? { shape: 'box', fit: true, mass: 0.3 } : null);
      // furniture he sits on: a box up to the seat (the backrest does not collide)
      const seatH = wrap.userData.slot === 'floor_under' ? entrySeatHeight(e) : 0;
      if (seatH > 0) meta = { shape: 'box', fit: true, mass: FURN[e.id]?.mass ?? 3, ...(meta || {}), seat: true, seatHeight: seatH };
      if (!meta) continue;
      const onBody = wrap.parent?.parent !== this.root;
      const obj = wrap.children[0];
      if (!obj) continue;
      if (meta.parts) {
        let n = obj;
        while (n.children.length === 1) n = n.children[0];
        n.children.forEach((part, i) => this.addProp(`${wrap.name}#${i}`, part, null, { group: wrap.name, onBody, ...meta.parts }, rootInv));
      } else this.addProp(wrap.name, wrap, obj, { onBody, ...meta }, rootInv);
    }
  }

  /** register one body: `target` is the object the pose drives; metadata is in `obj` space (null = target space) */
  addProp(id, target, obj, meta, rootInv) {
    const box = new THREE.Box3();
    let center, size;   // target-local
    const cyl = meta.shape === 'cylinder';
    if (meta.fit || !meta.size) {
      const inv = new THREE.Matrix4().copy(target.matrixWorld).invert(), tmp = new THREE.Box3();
      target.traverse((m) => {
        if (!m.isMesh || !m.geometry?.attributes?.position) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        box.union(tmp.copy(m.geometry.boundingBox).applyMatrix4(_pm.multiplyMatrices(inv, m.matrixWorld)));
      });
    }
    if (!box.isEmpty()) {
      center = box.getCenter(new THREE.Vector3()); size = box.getSize(new THREE.Vector3());
    } else {
      // metadata (accessory-local) -> target space through the accessory root (+ its inner scale, e.g. params.scale)
      const M = new THREE.Matrix4();
      if (obj) { obj.updateMatrix(); M.copy(obj.matrix); if (obj.children[0]) { obj.children[0].updateMatrix(); M.multiply(_pm.makeScale(...obj.children[0].scale.toArray())); } }
      const sc = new THREE.Vector3().setFromMatrixScale(M);
      center = new THREE.Vector3().fromArray(meta.center || [0, 0, 0]).applyMatrix4(M);
      const sz = meta.size || [0.1, 0.1, 0.1];
      size = Array.isArray(sz) ? new THREE.Vector3().fromArray(sz) : new THREE.Vector3(2 * sz.r, sz.h, 2 * sz.r);
      size.multiply(sc);
    }
    if (meta.seatHeight > 0) {   // seat: collider from the floor up to the seat (wrapper space, like seatHeight)
      center.y = meta.seatHeight / 2; size.y = meta.seatHeight;
    }
    if (!(size.x > 0.002 && size.y > 0.002 && size.z > 0.002)) return;
    const com = center.clone(); com.y += ((meta.comY ?? 0.5) - 0.5) * size.y;
    const shape = {
      kind: cyl ? 'cylinder' : 'box',
      size: cyl ? { r: Math.max(size.x, size.z) / 2, h: size.y } : size.toArray(),
      mass: meta.mass ?? 0.3, center: center.toArray(), com: com.toArray(),
      group: meta.group || '', buoyant: !!meta.buoyant, seat: !!meta.seat, onBody: !!meta.onBody,
    };
    target.updateMatrix();
    const restLocal = target.matrix.clone();
    const rest = _pm.multiplyMatrices(rootInv, target.parent.matrixWorld).multiply(restLocal);
    const slot = this.rust.r.register_prop(id, JSON.stringify(shape), new Float32Array(rest.elements));
    if (slot < 0) return;
    this.props.push({
      id, slot, target, restLocal, dyn: false,
      p0: target.position.clone(), q0: target.quaternion.clone(), s0: target.scale.clone(),
    });
  }

  /** settings.props = { resetAfter: seconds (default 8, 0 = never), enabled: true } */
  setPropSettings(cfg = {}) {
    this.propSettings = { resetAfter: cfg?.resetAfter ?? 8, enabled: cfg?.enabled !== false };
    this.rust?.r.set_props_config?.(JSON.stringify(this.propSettings));
  }

  /** debug: shove a prop (wrapper name, e.g. 'slot_floor_left_0_toilet_paper_stack#1') with an impulse (N s, rig-root space) */
  kickProp(id, x = 0, y = 0.05, z = 0.1) { return !!this.rust?.r.prop_kick?.(id, x, y, z); }

  /** before the Rust update: rest matrices (rig-root space) into the shared buffer */
  writePropRest() {
    const R = this.rust;
    if (!this.props?.length) return;
    const view = R.view(BUF.PROP_REST);
    const rootInv = _pm2.copy(this.root.matrixWorld).invert();
    for (const p of this.props) {
      _pm.multiplyMatrices(rootInv, p.target.parent.matrixWorld).multiply(p.restLocal);
      _pm.toArray(view, p.slot * 16);
    }
  }

  /** after the Rust update: drive the props that are not at rest */
  applyPropPoses() {
    if (!this.props?.length) return;
    const P = this.rust.view(BUF.PROP_POSES);
    let rootW = null;
    for (const p of this.props) {
      const k = p.slot * PROP_STRIDE, st = P[k];
      if (st > 0) {
        rootW ??= this.root.matrixWorld;
        _pv.set(P[k + 1], P[k + 2], P[k + 3]); _pq.set(P[k + 4], P[k + 5], P[k + 6], P[k + 7]); _ps.set(P[k + 8], P[k + 9], P[k + 10]);
        _pm.compose(_pv, _pq, _ps).premultiply(rootW);
        const par = p.target.parent;
        par.updateWorldMatrix(true, false);
        _pm.premultiply(_pm2.copy(par.matrixWorld).invert());
        _pm.decompose(p.target.position, p.target.quaternion, p.target.scale);
        p.dyn = true;
      } else if (p.dyn) {
        p.target.position.copy(p.p0); p.target.quaternion.copy(p.q0); p.target.scale.copy(p.s0);
        p.dyn = false;
      }
    }
  }

  static applyTransform(obj, t = {}) {
    obj.position.fromArray(t.position || [0, 0, 0]);
    obj.rotation.fromArray([...(t.rotation || [0, 0, 0]), 'XYZ']);
    const sc = t.scale ?? 1;
    Array.isArray(sc) ? obj.scale.fromArray(sc) : obj.scale.setScalar(sc);
  }

  /* ------------------------------------------------------- actions API */
  play(name) {
    if (this.rust) { if (!this.rust.r.play(name)) console.warn(`[action] unknown "${name}"`); return; }
    const def = ACTIONS[name];
    if (!def) return console.warn(`[action] unknown "${name}"`);
    this.active = this.active.filter((a) => a.def !== def);
    const inst = Object.create(def);
    inst.def = def; inst.t = 0;
    inst.start?.(this);
    this.active.push(inst);
  }

  tearPaper() {
    this.torn.copyFrom(this.paper);
    this.torn.fade = 1;
    this.paper.reset(this.paper.anchor);
  }

  // The paper leaves the roll along its tangent (down) and the paper action blows it FORWARD (his +z)
  // on both mounts (side: from the roll's outer side; front: from the roll's front).
  updatePaperAnchor() {
    const R = this.dim.roll;
    const roll = this.nodes.roll;
    roll.getWorldPosition(tmpV);
    const q = new THREE.Quaternion();
    this.head.getWorldQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const rs = this.paper.rollRadiusScale ?? 1;
    if (R.mount === 'front') {               // leaves from the roll's front
      this.nodes.roll.scale.set(1, rs, rs);
      this.paper.anchor.copy(tmpV).addScaledVector(fwd, R.r * rs);
      this.paper.widthDir.set(1, 0, 0).applyQuaternion(q);
    } else {                                 // side mount: leaves from the roll's outer side, tangent down
      this.nodes.roll.scale.set(rs, rs, 1);
      this.paper.anchor.copy(tmpV).addScaledVector(new THREE.Vector3(-1, 0, 0).applyQuaternion(q), R.r * rs);
      this.paper.widthDir.set(0, 0, 1).applyQuaternion(q);
    }
    this.paper.emitDir.set(0, -1, 0).applyQuaternion(q);
    this.paperOutDir.copy(fwd);
  }

  /** paper rests on the lid / drapes over the bowl instead of passing through it (as in Rust) */
  collidePaper(ps) {
    if (!ps.pts.length) return;
    const inv = this._binv || (this._binv = new THREE.Matrix4());
    inv.copy(this.body.matrixWorld).invert();
    const b = this._pb || (this._pb = new THREE.Vector3());
    for (let i = ps.anchored ? 1 : 0; i < ps.pts.length; i++) {
      const { p, q } = ps.pts[i];
      b.copy(p).applyMatrix4(inv);
      if (!pushOutOfBowl(b)) continue;
      b.applyMatrix4(this.body.matrixWorld);
      q.add(b).sub(p).multiplyScalar(0.45).addScaledVector(b, 0.55);   // move with the push + friction
      p.copy(b);
    }
  }

  /* ------------------------------------------------------- lower lip */
  // Seat = LOWER LIP (mirror of Rig::apply_seat): open vowels slide its front out over the
  // bowl's front edge and curl it down (max DIM.seat.maxDrop), M/B/P/F press it up toward the
  // lid; a binary search on the curl keeps it out of the bowl rim.
  applySeat(dt) {
    const SS = DIM.seat;
    const drop = Math.max(0, this.s.drop.x), press = Math.max(0, this.s.press.x), tuck = Math.max(0, this.s.tuck.x);
    const slide = drop * (2 - Math.min(drop, 1));     // the front slides out first, so a small drop clears the rim
    const S = this.seatLip;
    for (let i = 0; i < S.length; i++) {
      // lip chatter while talking (talkAmt includes `lips`)
      const flap = i >= 5 ? Math.sin(this.time * 14 - i * 0.9 + 2) * 0.06 * this.talkAmt : 0;
      S[i].target = SS.dropAng[i] * drop + SS.pressAng[i] * press + flap;
      for (let k = 0; k < 3; k++) S[i].step(dt / 3);
      this.seatAng[i + 1] = S[i].x;
      this.seatSlide[i + 1] = SS.slide[i] * slide + SS.pressSlide[i] * press + SS.tuckSlide[i] * tuck;
      this.seatLift[i + 1] = SS.lift[i] * drop;
    }
    let gain = 1;
    if (this.seatHitsBowl(1)) {
      let lo = 0, hi = 1;
      for (let it = 0; it < 7; it++) {
        const mid = (lo + hi) / 2;
        this.seatHitsBowl(mid) ? (hi = mid) : (lo = mid);
      }
      gain = lo;
    }
    this.seatGain = gain;
    this.seatBones.forEach((b, i) => {
      if (!i) return;
      b.position.set(0, this.seatLift[i], SEAT_SEG + this.seatSlide[i]);
      b.rotation.x = this.seatAng[i] * gain;
    });
  }

  seatChain(gain) {
    const ch = this._seatChain || (this._seatChain = this.seatBones.map(() => new THREE.Matrix4()));
    return chainInto(ch, DIM.seat.z0, SEAT_SEG, this.seatAng, this.seatSlide, gain, this.seatLift);
  }

  /** the seat pivot (body space) from the current seat lift */
  seatPivotMatrix() {
    const piv = this.nodes.seatPivot;
    piv.updateMatrix();
    return piv.matrix;
  }

  /** true if the deformed seat underside enters the bowl rim or drops > maxDrop below rest */
  /** rest point + this frame's blend shapes (seat: k0 = LID_MORPHS.length) -> out */
  morphed(fn, k0, nk, x, y, z, out) {
    out.set(x, y, z);
    const w = this.morphW;
    for (let k = 0; k < nk; k++) {
      if (!w[k0 + k]) continue;
      const d = fn(k, x, z);
      out.x += d[0] * w[k0 + k]; out.y += d[1] * w[k0 + k]; out.z += d[2] * w[k0 + k];
    }
    return out;
  }

  seatHitsBowl(gain) {
    const ch = this.seatChain(gain), pm = this.seatPivotMatrix();
    const p = this._sp || (this._sp = new THREE.Vector3()), mv = this._mv || (this._mv = new THREE.Vector3());
    const minY = DIM.rimY + SEAT_Y0 - DIM.seat.maxDrop;
    for (const [x, y, z] of SEAT_UNDER) {
      this.morphed(seatMorph, LID_MORPHS.length, SEAT_MORPHS.length, x, y, z, mv);
      skinPoint(ch, DIM.seat.z0, SEAT_SEG, mv.x, mv.y, mv.z, p).applyMatrix4(pm);
      if (p.y < minY || inBowl(p, SEAT_RIM_MARGIN)) return true;
    }
    return false;
  }

  /**
   * Lowest lid hinge keeping the lid underside above the seat top (both curled + morphed, jaw
   * included): seat-top points over the front ring vs the lid underside at the same rest x
   * (z +- 5 cm), compared as angles around the lid hinge. Mirror of Rig::seat_lid_floor.
   */
  seatLidFloor() {
    const ch = this.seatChain(this.seatGain);
    const lp = this.nodes.lidPivot;
    const lid0 = this._lid0 || (this._lid0 = new THREE.Matrix4());
    const q0 = this._q0 || (this._q0 = new THREE.Quaternion());
    q0.setFromAxisAngle(_Y, this.jawYaw);
    lid0.compose(lp.position, q0, lp.scale).invert().multiply(this.seatPivotMatrix());
    const lb = this.lidBones;
    const lc = this._lidChain || (this._lidChain = lb.map(() => new THREE.Matrix4()));
    const ang = this._lidAng || (this._lidAng = lb.map(() => 0));
    lb.forEach((b, i) => { ang[i] = b.rotation.x; });
    chainInto(lc, LID_Z0, LID_SEG, ang, this.lidSlide, 1);
    const p = this._sp || (this._sp = new THREE.Vector3()), mv = this._mv || (this._mv = new THREE.Vector3());
    const nl = LID_MORPHS.length;
    let floor = -Infinity;
    for (const [x, zc] of SEAT_TOP_XZ) {
      this.morphed(seatMorph, nl, SEAT_MORPHS.length, x, SEAT_Y0 + DIM.seat.h, zc - DIM.hingeZ, mv);
      skinPoint(ch, DIM.seat.z0, SEAT_SEG, mv.x, mv.y, mv.z, p).applyMatrix4(lid0);
      const aSeat = Math.atan2(p.y, p.z);
      let aLid = Infinity;
      for (const dz of [-0.05, 0, 0.05]) {
        this.morphed(lidMorph, 0, nl, x, 0, zc + LID_ZC + dz, mv);
        skinPoint(lc, LID_Z0, LID_SEG, mv.x, mv.y, mv.z, p);
        aLid = Math.min(aLid, Math.atan2(p.y, p.z));
      }
      floor = Math.max(floor, aSeat - aLid);
    }
    return floor + 0.004;
  }

  /* -------------------------------------------------------------- lip */
  // Lid = lip: hinge angle + per-bone springs that curl the front outward (away from
  // the head), so it bends like a lip while talking. Then a collision clamp keeps the
  // whole lid out of the tank/head no matter how the head is posed.
  applyLid(dt, open) {
    const bones = this.lidBones, S = this.lipSprings, L = DIM.lid;
    const n = S.length, m = this.mouthVec;
    // the front third folds: up/out on O/U (pucker) and upperRaise, down on open vowels (mirror of rig.rs)
    const rnd = Math.min(1, 2 * m.round);
    const curl = L.curlUp * rnd + 0.3 * m.upperRaise - L.curlDown * Math.max(m.open, m.lips) * (1 - rnd) - 0.08 * Math.min(1, m.wide + m.sib);
    const pucker = Math.max(0, this.s.pucker.x);
    for (let i = 0; i < n; i++) {
      const w = i / (n - 1);                       // 0 near hinge -> 1 at the front edge
      const lift = i === 0 ? 0.1 * m.open : 0;     // more lift right after the hinge
      const flap = Math.sin(this.time * 14 - i * 0.9) * 0.05 * w * this.talkAmt;   // chatter (talkAmt includes lips)
      // rest: the front droops a little (thick upper lip)
      S[i].target = lift + L.curlW[i] * curl + L.restCurl * w * w + flap + (open > 1.2 ? -0.12 * w : 0);
      for (let k = 0; k < 3; k++) S[i].step(dt / 3);
      this.lidSlide[i + 1] = L.poutSlide[i] * pucker;
      bones[i + 1].position.z = LID_SEG + this.lidSlide[i + 1];
      bones[i + 1].rotation.x = -S[i].x;
    }
    // hinge: never below the seat (lower lip: rigid lift + its curl), then the collision
    // clamp against the tank (binary search on the angle)
    const floor = Math.max(0, this.seatLidFloor(), this.s.seat.x + 0.006);
    this.seatFloor = floor;
    let hinge = Math.min(Math.max(open, floor), DIM.lid.maxHinge);
    if (this.lidHitsHead(hinge)) {
      let lo = Math.min(floor, hinge), hi = hinge;
      for (let it = 0; it < 7; it++) {
        const mid = (lo + hi) / 2;
        this.lidHitsHead(mid) ? (hi = mid) : (lo = mid);
      }
      hinge = lo;
      if (this.lidHitsHead(hinge)) {
        // head tilted onto the (nearly) closed lid at extreme look angles: ease its pitch
        const [hx, hy, hz] = this.headE, base = Math.min(hx, 0);
        let lf = 0, hf = 1;
        for (let it = 0; it < 8; it++) {
          const f = (lf + hf) / 2;
          this.head.rotation.set(base + (hx - base) * f, hy, hz); this.head.updateMatrixWorld(true);
          this.lidHitsHead(hinge) ? (hf = f) : (lf = f);
        }
        this.head.rotation.set(base + (hx - base) * lf, hy, hz);
      }
      if (!this.lidTouching && this.s.lid.v > 2) this.emit('sfx', { type: 'clack', v: this.s.lid.v * 0.5 });
      this.lidTouching = true;
    } else this.lidTouching = false;
    setPivotQ(this.nodes.lidPivot, this.jawYaw, -hinge);
    this.hinge = hinge;
    this.applyMorphs(this.morphW);
  }

  /** headless lip measurements, JS rig (mirror of Rig::lip_metrics): seat front travel (m) / roll (deg, + = out/down),
   *  lid front-third curl (deg, + = up/out), lid front forward shift (m) */
  lipMetrics() {
    const ch = this.seatChain(this.seatGain), pm = this.seatPivotMatrix(), y = SEAT_Y0 + DIM.seat.h * 0.5;
    const mv = new THREE.Vector3();
    const sp = (k) => { this.morphed(seatMorph, LID_MORPHS.length, SEAT_MORPHS.length, 0, y, -DIM.hingeZ + DIM.seat.rz * k, mv); return skinPoint(ch, DIM.seat.z0, SEAT_SEG, mv.x, mv.y, mv.z, new THREE.Vector3()).applyMatrix4(pm); };
    const front = sp(1), back = sp(0.85), rest = new THREE.Vector3(0, DIM.rimY + y, DIM.seat.rz);
    const lb = this.lidBones, lc = lb.map(() => new THREE.Matrix4());
    chainInto(lc, LID_Z0, LID_SEG, lb.map((b) => b.rotation.x), this.lidSlide, 1);
    const lp = (z) => { this.morphed(lidMorph, 0, LID_MORPHS.length, 0, 0, z, mv); return skinPoint(lc, LID_Z0, LID_SEG, mv.x, mv.y, mv.z, new THREE.Vector3()); };
    const lf = lp(LID_FRONT_Z), lbk = lp(0.8);
    return {
      seatTravel: front.distanceTo(rest),
      seatRoll: (Math.atan2(back.y - front.y, front.z - back.z) * 180) / Math.PI,
      lidCurl: (Math.atan2(lf.y - lbk.y, lf.z - lbk.z) * 180) / Math.PI,
      lidFwd: lf.z - LID_FRONT_Z,
    };
  }

  /**
   * Sticker eyes lie ON the curved tank face: returns conform(geo, lift) which stretches a flat
   * (xy) geometry by the oval factor and sets each vertex's local z to the tank surface (+ lift).
   */
  stickerConform(eye, T, oval, r = 1, dome = 0) {
    eye.updateMatrix();
    const m = eye.matrix, inv = m.clone().invert(), S = T.shape, v = new THREE.Vector3();
    return (geo, lift) => {
      geo.scale(1, oval, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const rr = Math.hypot(pos.getX(i), pos.getY(i) / oval) / r, bump = dome * Math.max(0, 1 - rr * rr);
        v.set(pos.getX(i), pos.getY(i), 0).applyMatrix4(m);          // head space, on the eye plane
        let bx = v.x, by = v.y - T.y, q = null;
        for (let it = 0; it < 4; it++) {                              // box coords whose surface point has this x/y
          q = S.front(bx, by);
          bx += v.x - q.p[0]; by += v.y - T.y - q.p[1];
        }
        v.set(q.p[0], q.p[1] + T.y, q.p[2] + T.z).applyMatrix4(inv);
        pos.setZ(i, v.z + lift + bump);
      }
      geo.computeVertexNormals();
      return geo;
    };
  }

  /** serio eyes: the upper eyelid edge (rest: covers the top `lid` of the eye) lowers on M/closed and on blink */
  updateEyelids(dt, closed) {
    if (!this.eyelids) return;
    const E = this.dim.eye, R = E.r * 1.03, ov = E.oval;
    this._lidClosed = (this._lidClosed ?? 0) + (clamp(closed || 0, 0, 1) - (this._lidClosed ?? 0)) * Math.min(1, dt * 12);
    this.eyelids.forEach((L, i) => {
      const es = this.eyes[i].eye.scale, blink = clamp((1 - es.y / Math.max(1e-4, es.x)) / 0.92, 0, 1);
      let edge = R * (1 - 2 * E.st.lid) - 0.5 * R * this._lidClosed;
      edge = Math.max(-R * 0.98, edge + (-R - edge) * blink);
      if (L.e != null && Math.abs(L.e - edge) < 1e-4) return;
      L.e = edge;
      // circle segment above y = edge (oval), as a fan from the chord centre
      const a0 = Math.asin(clamp(edge / R, -1, 1)), n = 32, pos = [0, edge * ov, 0.006];
      for (let k = 0; k <= n; k++) { const a = a0 + ((Math.PI - 2 * a0) * k) / n; pos.push(R * Math.cos(a), R * Math.sin(a) * ov, 0.006 + E.st.dome); }
      const idx = []; for (let k = 1; k <= n; k++) idx.push(0, k, k + 1);
      const g = L.lid.geometry;
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      g.computeBoundingSphere();
    });
  }

  /** blend-shape weights (lid first, then seat) onto the meshes */
  applyMorphs(w) {
    const li = this.nodes.lid.morphTargetInfluences, si = this.nodes.seat.morphTargetInfluences, nl = LID_MORPHS.length;
    if (li) for (let k = 0; k < nl; k++) li[k] = w[k];
    if (si) for (let k = 0; k < SEAT_MORPHS.length; k++) si[k] = w[nl + k];
  }

  lidHitsHead(hinge) {
    const piv = this.nodes.lidPivot;
    setPivotQ(piv, this.jawYaw, -hinge);
    piv.updateMatrixWorld(true);
    const T = this.dim.tank, m = 0.035, front = this.dim.front + 0.07; // eyes/handle stick out in front
    const R = this.dim.roll;                                          // + the paper roll / holder
    const rlx = R.len / 2 + 0.05, rly = R.r + 0.03, rz0 = this.dim.front - 0.01, rz1 = R.z + R.r + 0.03;
    const p = this._p || (this._p = new THREE.Vector3());
    const bones = this.lidBones;
    const seg = bones[1].position.z;
    for (let i = 1; i <= bones.length; i++) {
      // sample along each bone segment, at the lid's top surface
      const b = bones[Math.min(i, bones.length - 1)];
      for (const f of [0, 0.5, 1]) {
        if (i === bones.length && f > 0) break;
        p.set(0, DIM.lid.depth + DIM.lid.dome + 0.01, i === bones.length ? 0 : -seg * (1 - f));
        b.localToWorld(p);
        this.head.worldToLocal(p);
        if (p.y > T.bottom - m && p.y < T.lidTop + 0.02 &&
            p.z > T.z - T.shape.hz - T.bulge - m && p.z < front && Math.abs(p.x) < T.shape.halfW + m) return true;
        if (R.mount === 'front' && Math.abs(p.x - R.x) < rlx && Math.abs(p.y - R.y) < rly && p.z > rz0 && p.z < rz1) return true;
      }
    }
    // also never fold back through the neck pipe
    p.set(0, 0, seg).applyMatrix4(bones[1].matrixWorld);
    this.body.worldToLocal(p);
    return p.z < DIM.pipeZ + 0.06;
  }

  /* ----------------------------------------------------------- update */
  /* ------------------------------------------------ Rust-driven update */
  updateRust(dtRaw, input) {
    const R = this.rust, r = R.r;
    const look = input.look ?? { x: 0, y: 0 };
    const mi = typeof input.mouth === 'number' ? { open: input.mouth } : (input.mouth || {});
    r.set_input(look.x || 0, look.y || 0, mi.open || 0, mi.round || 0, mi.wide || 0, mi.closed || 0, mi.sib || 0);
    r.set_input_ext?.(mi.cornerL || 0, mi.cornerR || 0, mi.jawSide || 0, mi.jawFwd || 0, mi.upperRaise || 0, mi.lips || 0);
    this.syncSeat();
    this.writePropRest();
    r.update(dtRaw);

    // pose: local TRS per animated node
    if (!this.poseNodes) {
      const eye = (s) => this.eyes.find((e) => e.s === s);
      const by = {
        body: this.body, head: this.head, lid_pivot: this.nodes.lidPivot, seat_pivot: this.nodes.seatPivot,
        eye_L: eye(-1).eye, eye_R: eye(1).eye, pupil_L: eye(-1).pupil, pupil_R: eye(1).pupil,
        flush_handle: this.nodes.handle, paper_roll: this.nodes.roll, water: this.nodes.water, water_swirl: this.nodes.swirl,
      };
      this.lidBones.forEach((b, i) => { by[`lid_bone_${i}`] = b; });
      this.seatBones.forEach((b, i) => { by[`seat_bone_${i}`] = b; });
      this.poseNodes = R.order.map((n) => by[n] || null);
    }
    const P = R.view(BUF.POSE);
    this.poseNodes.forEach((o, i) => {
      if (!o) return;
      const k = i * 10;
      o.position.set(P[k], P[k + 1], P[k + 2]);
      o.quaternion.set(P[k + 3], P[k + 4], P[k + 5], P[k + 6]);
      o.scale.set(P[k + 7], P[k + 8], P[k + 9]);
    });
    const S = R.view(BUF.SCALARS);
    this.applyMorphs(R.view(BUF.MORPHS));
    this.updateEyelids(S[SC.DT], mi.closed);
    this.hinge = S[SC.HINGE];
    this.time = S[SC.TIME];
    if (this.waterTex) this.waterTex.offset.x = S[SC.WATER_TEX_OFFSET];
    this.swirlTex.rotation = S[SC.SWIRL_ROT];
    this.nodes.swirl.material.opacity = S[SC.SWIRL_OPACITY];

    // accessories keep their JS secondary motion, fed from Rust state
    const st = {
      dt: S[SC.DT], time: S[SC.TIME], mouth: S[SC.ST_MOUTH], talk: S[SC.ST_TALK],
      headYawVel: S[SC.HEAD_YAW_VEL], headPitchVel: S[SC.HEAD_PITCH_VEL], lift: S[SC.ST_LIFT],
    };
    for (const a of this.accessories) a.traverse((x) => x.userData.update?.(st));
    this.applyPropPoses();

    // water FX
    const J = this.jet;
    J.drops.mesh.instanceMatrix.array.set(R.view(BUF.DROPS)); J.drops.mesh.instanceMatrix.needsUpdate = true;
    J.foam.mesh.instanceMatrix.array.set(R.view(BUF.FOAM)); J.foam.mesh.instanceMatrix.needsUpdate = true;
    const streamOn = S[SC.STREAM_VISIBLE] > 0.5;
    J.stream.visible = streamOn;
    if (streamOn) {   // positions, normals (computed in Rust) and uvs: no computeVertexNormals here
      const g = J.stream.geometry;
      if (!g.attributes.normal) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
      g.attributes.position.array.set(R.view(BUF.STREAM_POS)); g.attributes.position.needsUpdate = true;
      g.attributes.normal.array.set(R.view(BUF.STREAM_NRM)); g.attributes.normal.needsUpdate = true;
      g.attributes.uv.array.set(R.view(BUF.STREAM_UV)); g.attributes.uv.needsUpdate = true;
    }
    const RP = R.view(BUF.RIPPLES);
    J.ripples.forEach((m, i) => {
      const k = i * 5;
      m.visible = RP[k + 4] > 0.5;
      if (!m.visible) return;
      m.position.x = RP[k]; m.position.z = RP[k + 1];
      m.scale.set(RP[k + 2], 1, RP[k + 2]);
      m.material.opacity = RP[k + 3];
    });
    const PU = R.view(BUF.PUDDLE);
    J.puddle.position.x = PU[0]; J.puddle.position.z = PU[1];
    J.puddle.scale.set(PU[2], 1, PU[3]);
    J.puddle.material.opacity = PU[4];
    if (S[SC.PUDDLE_VERSION] !== this.puddleVersion) {
      this.puddleVersion = S[SC.PUDDLE_VERSION];
      const rad = R.view(BUF.PUDDLE_RADIAL), pos = J.puddle.geometry.attributes.position, base = J.puddleBase;
      for (let i = 1; i < pos.count; i++) { const f = rad[i - 1] ?? 1; pos.setXYZ(i, base[i * 3] * f, 0, base[i * 3 + 2] * f); }
      pos.needsUpdate = true;
    }

    // paper strips
    const strip = (ps, pos, nrm, uv, perf, count, np, op, col, wetSc) => {
      const n = S[count] | 0, nperf = S[np] | 0;
      // wet paper colours: upload only while wet (+ one reset to dry)
      const ca = ps.geo.attributes.color;
      if (ca && col != null) {
        const wet = S[wetSc] > 0;
        if (wet && n > 0) { ca.array.set(R.view(col).subarray(0, n * 8)); ca.needsUpdate = true; }
        else if (!wet && ps._wet) { ca.array.fill(1); ca.needsUpdate = true; }
        ps._wet = wet;
      }
      if (n === 0 && ps._rustN === 0) return;          // empty and already cleared
      ps._rustN = n;
      const g = ps.geo;
      if (!g.attributes.normal) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
      if (n > 0) {   // copy only the live part of the ribbon; normals come from Rust
        g.attributes.position.array.set(R.view(pos).subarray(0, n * 6)); g.attributes.position.needsUpdate = true;
        g.attributes.normal.array.set(R.view(nrm).subarray(0, n * 6)); g.attributes.normal.needsUpdate = true;
        g.attributes.uv.array.set(R.view(uv).subarray(0, n * 4)); g.attributes.uv.needsUpdate = true;
      }
      g.setDrawRange(0, Math.max(0, n - 1) * 6);
      if (nperf) {
        ps.perfGeo.attributes.position.array.set(R.view(perf).subarray(0, nperf * 6)); ps.perfGeo.attributes.position.needsUpdate = true;
        ps.perf.computeLineDistances();
      }
      ps.perfGeo.setDrawRange(0, nperf * 2);
      ps.mat.opacity = S[op];
      ps.perfMat.opacity = S[op] * 0.9;
    };
    strip(this.paper, BUF.PAPER_POS, BUF.PAPER_NRM, BUF.PAPER_UV, BUF.PAPER_PERF, SC.PAPER_COUNT, SC.PAPER_PERF, SC.PAPER_OPACITY, BUF.PAPER_COL, SC.PAPER_WET);
    strip(this.torn, BUF.TORN_POS, BUF.TORN_NRM, BUF.TORN_UV, BUF.TORN_PERF, SC.TORN_COUNT, SC.TORN_PERF, SC.TORN_OPACITY, BUF.TORN_COL, SC.TORN_WET);

    // sound events (no string allocation on the common empty frame)
    if (r.pending_events() > 0) {
      for (const e of r.drain_events().split(String.fromCharCode(10))) {
        if (e.startsWith('clack:')) this.emit('sfx', { type: 'clack', v: parseFloat(e.slice(6)) });
        else if (e.startsWith('prop_hit:')) {   // prop_hit:<id>:<speed>
          const i = e.lastIndexOf(':');
          this.emit('sfx', { type: 'thud', v: parseFloat(e.slice(i + 1)), id: e.slice(9, i) });
        } else if (e.startsWith('prop_reset:')) this.emit('sfx', 'pop');
        else this.emit('sfx', e);
      }
    }
  }
  /* ----------------------------------------------------------- update */
  update(dtRaw, input) {
    if (this.rust) return this.updateRust(dtRaw, input);
    const dt = Math.min(dtRaw, 1 / 20);
    this.time += dt;
    const o = { mouth: null, headPitch: 0, headYaw: 0, lift: 0, shake: 0, squash: 0, eyeScale: 1, swirl: 0, handle: 0, blink: null, look: null, flip: 0, spin: 0, sitTo: null, impact: 0 };
    for (const a of this.active) { a.t += dt; a.update(Math.min(a.t, a.def.duration), dt, this, o); }
    for (const a of this.active) if (a.t >= a.def.duration) a.end?.(this);
    this.active = this.active.filter((a) => a.t < a.def.duration);
    // sitting (JS path; no chair physics here: the chair stays put, a backflip lands back on the seat)
    this.syncSeat();
    if (o.sitTo != null) this.sitS.target = o.sitTo > 0.5 ? this.seatHeight() : 0;
    this.sitS.step(dt);
    if (this.sitS.x < 0) { this.sitS.x = 0; this.sitS.v = Math.max(0, this.sitS.v); }

    const S = this.s;
    const look = o.look ?? input.look ?? { x: 0, y: 0 };
    const lx = clamp(look.x, -1, 1), ly = clamp(look.y, -1, 1);
    // mouth: number (0..1 open) or viseme vector {open, round, wide, closed, sib}
    const mi = typeof input.mouth === 'number' ? { open: input.mouth } : (input.mouth || {});
    const c01 = (v) => clamp(v || 0, 0, 1), c11 = (v) => clamp(v || 0, -1, 1);
    const m = o.mouth != null
      ? { open: o.mouth, round: 0, wide: 0, closed: 0, sib: 0, cornerL: 0, cornerR: 0, jawSide: 0, jawFwd: 0, upperRaise: 0, lips: 0 }
      : { open: c01(mi.open), round: c01(mi.round), wide: c01(mi.wide), closed: c01(mi.closed), sib: c01(mi.sib),
          cornerL: c11(mi.cornerL), cornerR: c11(mi.cornerR), jawSide: c11(mi.jawSide), jawFwd: c01(mi.jawFwd), upperRaise: c01(mi.upperRaise), lips: c01(mi.lips) };
    this.mouthVec = m;
    const mouthIn = m.open;
    this.talkAmt = Math.max(m.open, m.round, m.wide, m.sib, m.lips);
    const rest = o.mouth != null ? 0 : this.restOpen * (1 - m.closed);

    const LL = this.lookLimits;
    S.yaw.target = lx * LL.yaw * 0.55;
    S.pitch.target = -ly * LL.pitch * 0.3;
    S.hYaw.target = lx * LL.yaw * 0.45 + o.headYaw;
    S.hPitch.target = -ly * LL.pitch * 0.7 + o.headPitch;
    const side = smoothstep(0.55, 1, Math.abs(lx)) * Math.sign(lx);   // lean toward the side near the extremes
    S.lean.target = -side * 0.07;
    S.hRoll.target = -lx * 0.06 - side * 0.05;
    S.lid.target = o.mouth != null && o.mouth > 0.9 ? 1.45
      : Math.max(0, rest + m.open * 0.9 + m.round * 0.12 + m.sib * 0.04 + m.upperRaise * 0.06);
    S.smile.target = m.wide * 0.9 - m.round * 0.3;
    S.pucker.target = m.round;
    // the arch (visible upper-lip curve) grows with the opening; smiling flattens it
    S.arch.target = clamp(m.open * 1.1 + m.round * 0.5 + m.sib * 0.3 + (o.mouth != null && o.mouth > 0.9 ? 0.6 : 0) - m.wide * 0.35, 0, 1.3);
    // lower lip: open vowels drop it (O/U pout it out a little), M/B/P closes it
    // amplitude from max(open, lips): the lips still fold when the opening is capped
    S.drop.target = clamp(1.3 * Math.max(m.open, m.lips) + 0.3 * m.round - 0.8 * m.closed, 0, 1);
    S.press.target = clamp(m.closed + 0.2 * m.sib, 0, 1);
    S.tuck.target = clamp(2 * Math.min(m.closed, m.upperRaise), 0, 1);
    S.cornerL.target = m.cornerL; S.cornerR.target = m.cornerR;
    S.jawSide.target = m.jawSide; S.jawFwd.target = m.jawFwd; S.upperRaise.target = m.upperRaise;
    S.lift.target = o.lift;
    S.squash.target = o.squash;
    S.eyeScale.target = o.eyeScale;
    S.handle.target = o.handle;

    // substep springs for stability
    const n = 3, h = dt / n;
    for (let i = 0; i < n; i++) {
      for (const k in S) S[k].step(h);
      if (S.lid.x < 0) {             // lid hits the seat: bounce + clack
        if (S.lid.v < -2.5) this.emit('sfx', { type: 'clack', v: -S.lid.v });
        S.lid.x = 0; S.lid.v = -S.lid.v * 0.3;
      }
      // lower lip (seat) rises to meet the upper lip on M/B/P, F/V (a bit on S)
      S.seat.target = m.closed * 0.035 + m.sib * 0.01;
      S.hRoll.target += -S.hYaw.v * 0.002;
    }

    // body
    const breath = Math.sin(this.time * 2.2) * 0.012;
    const talk = clamp(S.lid.x, 0, 1.6);
    const sq = S.squash.x + breath + talk * 0.015;
    this.body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
    this.body.rotation.set(S.pitch.x + o.flip, S.yaw.x + o.spin, S.lean.x);
    // flips rotate around the center of mass (~0.75 up), not around the floor
    const cm = 0.75, fy = cm - cm * Math.cos(o.flip), fz = -cm * Math.sin(o.flip);
    this.body.position.set(Math.sin(this.time * 63) * 0.008 * o.shake, S.lift.x + this.sitS.x + (o.flip ? fy + o.flipLift : 0),
      Math.cos(this.time * 51) * 0.005 * o.shake + (o.flip ? fz : 0));

    // head
    this.headE = [S.hPitch.x - talk * DIM.headTalkTilt + Math.sin(this.time * 70) * 0.02 * o.shake,
      S.hYaw.x, S.hRoll.x + Math.sin(this.time * 1.3) * 0.015];
    this.head.rotation.set(...this.headE);
    this.root.updateMatrixWorld(true);   // collision checks use this frame's body/head (as in Rust)
    this.head.position.y = this.dim.headY + talk * 0.025;

    // mouth blend shapes (lid, then seat); L/R corners are signed (up / down)
    {
      const side = clamp(S.jawSide.x, -1, 1), pk = S.pucker.x, cl = S.cornerL.x, cr = S.cornerR.x;
      const pl = pk * Math.max(0, -side), pm = pk * (1 - Math.abs(side)), pr = pk * Math.max(0, side);
      const up = (v) => Math.max(0, v), dn = (v) => Math.max(0, -v);
      const W = this.morphW;
      [S.smile.x, pm, S.arch.x + DIM.lid.archRest, up(cl), dn(cl), up(cr), dn(cr), pl, pr,
        up(cl), dn(cl), up(cr), dn(cr), pl * 0.8, pm * 0.8, pr * 0.8].forEach((v, i) => { W[i] = v; });
      // jaw: the lid + seat assembly yaws to the side and slides forward together
      this.jawYaw = DIM.jaw.yaw * side;
      this.jawFwd = DIM.jaw.fwd * clamp(S.jawFwd.x, 0, 1);
      this.nodes.seatPivot.position.z = DIM.hingeZ + this.jawFwd;
      this.nodes.lidPivot.position.z = LID_PIVOT[2] + this.jawFwd;
    }
    // mouth: lower lip first (the lid stays above it), then the lid
    setPivotQ(this.nodes.seatPivot, this.jawYaw, -Math.max(0, S.seat.x));
    this.applySeat(dt);
    this.applyLid(dt, talk);

    // eyes (googly: springy pupils that sag a bit with gravity)
    const lead = (v) => Math.tanh(v * 2.2) / Math.tanh(2.2);   // pupils lead and saturate early
    S.px.target = lead(lx) * 0.95 - S.hYaw.v * 0.05;
    S.py.target = lead(ly) * 0.9 - 0.15 + S.hPitch.v * 0.05 - S.lift.v * 0.3;
    let blink = o.blink;
    if (blink == null) {
      this.blinkTimer -= dt;
      if (this.blinkTimer < 0) { this.blinkT = 0; this.blinkTimer = 1.8 + Math.random() * 4.5; }
      if (this.blinkT >= 0) { this.blinkT += dt; blink = Math.sin(Math.min(1, this.blinkT / 0.15) * Math.PI); if (this.blinkT > 0.15) this.blinkT = -1; }
      else blink = 0;
    }
    // pupil travel = eye radius - pupil - outline (sticker; y scaled by the oval); sticker pupils also
    // drift a little, independently per eye (the slightly "derp" stare) - mirror of rig.rs
    const EY = this.dim.eye, tx = EY.travel, ty = EY.travel * EY.oval, drift = EY.st.drift ? 0.1 : 0;
    for (const e of this.eyes) {
      const ph = e.s < 0 ? 0 : 1.7;
      let px = S.px.x + drift * Math.sin(this.time * 0.71 + ph + 0.4), py = S.py.x + drift * Math.sin(this.time * 0.53 + 2.3 * ph + 1.1);
      const len = Math.hypot(px, py);
      if (len > 1) { px /= len; py /= len; }
      e.pupil.position.x = px * tx;
      e.pupil.position.y = py * ty;
      const es = S.eyeScale.x;
      e.eye.scale.set(es, es * (1 - 0.92 * blink), es);
    }
    this.updateEyelids(dt, m.closed);

    // water & handle
    this.swirlSpeed += (o.swirl - this.swirlSpeed) * Math.min(1, dt * 3);
    if (this.waterTex) this.waterTex.offset.x += 0.02 * dt;
    this.swirlTex.rotation += (this.swirlSpeed + 0.3) * dt;
    this.nodes.swirl.material.opacity = clamp(this.swirlSpeed / 14, 0, 1) * 0.55;
    const rise = this.jet.bowlRise || 0, ws = 1 + Math.max(0, rise) * 0.28;
    this.nodes.water.position.y = DIM.waterY + rise * 0.12 + (this.jet.bowlSlosh || 0) * 0.004 + Math.sin(this.time * 12) * 0.004 * talk;
    this.nodes.water.scale.set(ws, 1, ws);
    this.nodes.swirl.position.y = this.nodes.water.position.y + 0.002;
    this.nodes.swirl.scale.set(ws, 1, ws);
    this.nodes.handle.quaternion.copy(this.handleBaseQ).multiply(_qx.setFromAxisAngle(_HZ, S.handle.x * 0.6));

    // accessories
    const st = {
      dt, time: this.time, mouth: clamp(S.lid.x / 1.15, 0, 1.4), talk: clamp(mouthIn, 0, 1),
      headYawVel: S.hYaw.v, headPitchVel: S.hPitch.v, lift: S.lift.v * 0.05,
    };
    for (const a of this.accessories) a.traverse((x) => x.userData.update?.(st));

    // fx
    this.root.updateMatrixWorld(true);
    this.updatePaperAnchor();
    const feeding = this.paper.length() < this.paper.targetLen;
    // the roll's axis is X: its front turns down while the paper feeds
    if (feeding) this.nodes.roll.rotation[this.dim.roll.mount === 'front' ? 'x' : 'z'] += (this.paper.feedSpeed / (DIM.roll.r * (this.paper.rollRadiusScale ?? 1))) * dt;
    this.paper.update(dt);
    if (this.torn.fade > 0) {
      this.torn.update(dt);
      this.torn.fade -= dt * 0.5;
      if (this.torn.fade <= 0) { this.torn.pts = []; this.torn.update(0); }
    }
    this.collidePaper(this.paper);
    this.collidePaper(this.torn);
    this.jet.origin.copy(this.body.localToWorld(tmpV.set(0, DIM.waterY, 0)));   // bowl center
    this.jet.mouth.copy(this.body.localToWorld(tmpV.fromArray(DIM.mouth.spout)));  // between the lips
    const q = new THREE.Quaternion();
    this.body.getWorldQuaternion(q);
    this.jet.dir.fromArray(DIM.mouth.spoutDir).normalize().applyQuaternion(q);
    this.jet.side.set(1, 0, 0).applyQuaternion(q);
    this.jet.update(dt);
  }
}
