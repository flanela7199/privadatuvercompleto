// The toilet character. Builds a named, hierarchical rig from a theme and
// drives it every frame from {look, mouth} input plus one-shot actions.
//
// Rig (node names are stable: the Rust app animates the exported GLB by name)
//   ToiletTuber
//   └ body                      yaw/pitch toward the mouse, breathing squash
//     ├ bowl, water, hinge_L/R, neck_pipe
//     ├ seat_pivot └ seat
//     ├ lid_pivot  └ lid        = the MOUTH (opens with the microphone)
//     ├ socket_face             (mustache...)
//     └ head                    tank, pivots on the pipe
//       ├ tank, tank_lid
//       ├ eye_L/eye_R └ pupil_L/pupil_R (googly)
//       ├ flush_handle
//       ├ paper_holder └ paper_roll
//       └ socket_head_top, socket_tank_front, socket_side_right
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MaterialLib } from './materials.js';
import { swirlTexture, clamp, eggify, eggRevolve, lidProfile, seatProfile } from './geo.js';
import { buildAccessory } from '../accessories/index.js';
import { Spring } from '../anim/spring.js';
import { ACTIONS } from '../anim/actions.js';
import { WaterJet } from '../fx/waterJet.js';
import { PaperStrip } from '../fx/paperStrip.js';
import { loadWasm, WasmRig, BUF, SC } from './wasmrig.js';

// The per-frame logic runs in Rust (crates/privada-core via web/pkg) when available;
// this file then only builds the meshes and APPLIES the Rust pose. Pure-JS fallback below.
const WASM = await loadWasm();

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
  tank: { w: 0.95, h: 0.52, d: 0.36, y: 0.3, z: 0.14 },
  eye: { x: 0.172, y: 0.33, r: 0.14 },
  egg: 0.08,                                   // front of bowl/seat/lid narrower (elongated bowl)
  seat: { rx: 0.405, rz: 0.495, hole: 0.62, h: 0.03 },
  mouth: { rest: 0.05, spout: [0, 0.69, 0.43], spoutDir: [0, 0.42, 0.9] }, // rest = lips slightly apart
  lid: { rx: 0.4, rz: 0.49, depth: 0.018, dome: 0.018, edge: 0.012, bones: 8, maxHinge: 1.45 },
  roll: { x: -0.6, y: 0.38, z: 0.16, r: 0.085, len: 0.19 },
};

const tmpV = new THREE.Vector3();

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
    };
    this.mouthVec = { open: 0, round: 0, wide: 0, closed: 0, sib: 0 };
    this.rust = WASM ? new WasmRig(WASM, (Math.random() * 4294967295) >>> 0) : null;
    this.restOpen = DIM.mouth.rest;
    this.blinkTimer = 2 + Math.random() * 3;
    this.blinkT = -1;
    this.swirlSpeed = 0;
    this.setTheme(theme);
  }

  /** true when the Rust/wasm rig drives the character */
  get usesRust() { return !!this.rust; }
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
    this.build();
  }

  build() {
    const M = this.mats, D = DIM;
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
    const bowlMat = porcelain.clone(); bowlMat.side = THREE.DoubleSide;
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

    // Seat (rounded ring) and lid (= MOUTH), both hinged at the back
    const rubber = M.get('rubber', { color: '#1c1c1c', roughness: 0.85 });
    const seatPivot = group('seat_pivot', body, 0, D.rimY, D.hingeZ);
    const seatMat = M.get('seat', 'porcelain').clone();
    seatMat.side = THREE.DoubleSide;
    const seat = mesh('seat', eggRevolve(D.seat.rx, D.seat.rz, D.egg, seatProfile(D.seat.rx, D.seat.hole, D.seat.h), 160), seatMat, seatPivot);
    seat.position.set(0, 0.006, -D.hingeZ);
    for (const [x, z] of [[0.3, 0.12], [-0.3, 0.12], [0.24, -0.3], [-0.24, -0.3]]) {
      const b = mesh('seat_bumper', new THREE.CylinderGeometry(0.018, 0.02, 0.008, 16), rubber, seat);
      b.position.set(x, -0.003, z);
    }

    // Lid is a SkinnedMesh with a bone chain hinge->front so it bends like a lip.
    const lidPivot = group('lid_pivot', body, 0, D.rimY + 0.006 + D.seat.h + 0.004, D.hingeZ - 0.004);
    const L = D.lid;
    const lidGeo = eggRevolve(L.rx, L.rz, D.egg, lidProfile(L.rx, L.depth, L.dome, L.edge), 160);
    lidGeo.translate(0, 0, -D.hingeZ + 0.004);           // hinge at the pivot origin
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
    // Blend shapes so the upper lip can curve with the sound:
    //  smile  = corners lift, center tenses (E, I)
    //  pucker = center front pushes up/out, corners pull in (O, U)
    {
      const n = lp.count, sm = new Float32Array(n * 3), pu = new Float32Array(n * 3), ar = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = clamp(lp.getX(i) / L.rx, -1, 1), v = clamp(lp.getZ(i) / (2 * L.rz), 0, 1);
        sm[i * 3 + 1] = 0.05 * u * u * v ** 1.5 - 0.012 * (1 - u * u) * v;
        pu[i * 3] = -0.05 * u * v * v;
        pu[i * 3 + 1] = 0.035 * (1 - u * u) * v * v;
        pu[i * 3 + 2] = 0.03 * (1 - u * u) * v * v;
        // arch: the upper-lip curve seen from the front - corners fold down toward the
        // seat, the middle stays up, tight near the front edge
        const vv = v ** 1.6;
        ar[i * 3 + 1] = -0.11 * Math.pow(Math.abs(u), 2.2) * vv + 0.02 * (1 - u * u) * vv;
        ar[i * 3] = -0.025 * u * Math.abs(u) * vv;   // corners tuck in a little
      }
      const morphNormal = (d) => {
        const g2 = lidGeo.clone();
        const p2 = g2.attributes.position;
        for (let i = 0; i < n; i++) p2.setXYZ(i, p2.getX(i) + d[i * 3], p2.getY(i) + d[i * 3 + 1], p2.getZ(i) + d[i * 3 + 2]);
        g2.computeVertexNormals();
        const a = g2.attributes.normal.array, b = lidGeo.attributes.normal.array;
        const out = new Float32Array(a.length);
        for (let i = 0; i < a.length; i++) out[i] = a[i] - b[i];
        g2.dispose();
        return out;
      };
      const smA = new THREE.Float32BufferAttribute(sm, 3); smA.name = 'smile';
      const puA = new THREE.Float32BufferAttribute(pu, 3); puA.name = 'pucker';
      const arA = new THREE.Float32BufferAttribute(ar, 3); arA.name = 'arch';
      lidGeo.morphAttributes.position = [smA, puA, arA];
      lidGeo.morphAttributes.normal = [smA, puA, arA].map((a) => new THREE.Float32BufferAttribute(morphNormal(a.array), 3));
      lidGeo.morphTargetsRelative = true;
    }
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
    for (const [x, z] of [[0.26, 0.2], [-0.26, 0.2]]) {
      const b = mesh('lid_bumper', new THREE.CylinderGeometry(0.016, 0.018, 0.006, 16), rubber, seat);
      b.position.set(x, D.seat.h + 0.004, z);
    }
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
    const tank = mesh('tank', new RoundedBoxGeometry(T.w, T.h, T.d, 5, 0.04), porcelain, head);
    tank.position.set(0, T.y, T.z);
    const tankLid = mesh('tank_lid', new RoundedBoxGeometry(T.w + 0.04, 0.065, T.d + 0.05, 4, 0.022), M.get('tankLid', 'porcelain'), head);
    tankLid.position.set(0, T.y + T.h / 2 + 0.03, T.z);
    const front = T.z + T.d / 2;
    for (const sx of [1, -1]) {
      const bolt = mesh('tank_bolt', new THREE.CylinderGeometry(0.02, 0.02, 0.025, 6), M.get('bolt', 'chrome'), head);
      bolt.position.set(0.3 * sx, T.y - T.h / 2 - 0.012, T.z);
      const washer = mesh('tank_washer', new THREE.CylinderGeometry(0.03, 0.03, 0.005, 24), rubber, head);
      washer.position.set(0.3 * sx, T.y - T.h / 2 - 0.002, T.z);
    }
    // fill-valve inlet under the tank (left)
    const inlet = mesh('tank_inlet', new THREE.CylinderGeometry(0.03, 0.03, 0.04, 6), M.get('valve', 'chrome'), head);
    inlet.position.set(-0.36, T.y - T.h / 2 - 0.02, T.z - 0.06);

    // Googly eyes
    this.eyes = [];
    for (const s of [-1, 1]) {
      const E = D.eye;
      const eye = group(s < 0 ? 'eye_L' : 'eye_R', head, E.x * s, E.y, front + 0.004);
      const white = mesh('eye_white', new THREE.CylinderGeometry(E.r, E.r, 0.025, 48), M.get('eyeWhite'), eye);
      white.rotation.x = Math.PI / 2; white.position.z = 0.0125;
      const rim = mesh('eye_rim', new THREE.TorusGeometry(E.r, 0.009, 10, 64), M.get('outline'), eye);
      rim.position.z = 0.025;
      const pupil = mesh(s < 0 ? 'pupil_L' : 'pupil_R', new THREE.CylinderGeometry(E.r * 0.44, E.r * 0.44, 0.012, 40), M.get('pupil'), eye);
      pupil.rotation.x = Math.PI / 2; pupil.position.z = 0.03;
      const dome = mesh('eye_dome', new THREE.SphereGeometry(E.r, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.get('eyeDome', { color: '#ffffff', transparent: true, opacity: 0.12, roughness: 0.02, clearcoat: 1 }), eye);
      dome.rotation.x = Math.PI / 2; dome.scale.y = 0.35; dome.position.z = 0.025; dome.castShadow = false;
      this.eyes.push({ eye, pupil, s });
    }

    // Flush handle (front, upper right)
    const handle = this.nodes.handle = group('flush_handle', head, 0.34, T.y + 0.17, front + 0.005);
    const esc = mesh('handle_escutcheon', new THREE.CylinderGeometry(0.036, 0.04, 0.012, 32), chrome, handle);
    esc.rotation.x = Math.PI / 2; esc.position.z = 0.006;
    const nut = mesh('handle_nut', new THREE.CylinderGeometry(0.022, 0.022, 0.016, 6), chrome, handle);
    nut.rotation.x = Math.PI / 2; nut.position.z = 0.02;
    const leverPts = [[0, 0, 0.028], [-0.05, -0.004, 0.036], [-0.1, -0.012, 0.04], [-0.13, -0.02, 0.04]];
    const lever = mesh('handle_lever', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(leverPts.map((q) => new THREE.Vector3(...q))), 24, 0.009, 12), chrome, handle);
    lever.scale.set(1, 1.15, 0.8);
    const knob = mesh('handle_knob', new THREE.SphereGeometry(0.014, 16, 12), chrome, handle);
    knob.position.set(-0.132, -0.02, 0.04);

    // Toilet-paper holder on the left side of the tank
    const R = D.roll;
    const holder = group('paper_holder', head, -T.w / 2, R.y, R.z);
    const plate = mesh('holder_plate', new RoundedBoxGeometry(0.02, 0.07, 0.07, 3, 0.008), chrome, holder);
    plate.position.set(-0.008, 0, -R.len / 2 - 0.03);
    const arm = mesh('holder_arm', new THREE.CylinderGeometry(0.012, 0.012, Math.abs(R.x + T.w / 2), 12), chrome, holder);
    arm.rotation.z = Math.PI / 2; arm.position.set((R.x + T.w / 2) / 2, 0, -R.len / 2 - 0.03);
    const rod = mesh('holder_rod', new THREE.CylinderGeometry(0.01, 0.01, R.len + 0.07, 12), chrome, holder);
    rod.rotation.x = Math.PI / 2; rod.position.set(R.x + T.w / 2, 0, 0);
    const roll = this.nodes.roll = group('paper_roll', holder, R.x + T.w / 2, 0, 0);
    const paperMat = M.get('paper');
    const outer = mesh('roll_paper', new THREE.CylinderGeometry(R.r, R.r, R.len, 48, 1, true), paperMat, roll);
    outer.rotation.x = Math.PI / 2;
    const core = mesh('roll_core', new THREE.CylinderGeometry(0.024, 0.024, R.len + 0.004, 24, 1, true), M.get('cardboard'), roll);
    core.rotation.x = Math.PI / 2; core.material.side = THREE.DoubleSide;
    for (const s of [1, -1]) {
      const cap = mesh('roll_end', new THREE.RingGeometry(0.024, R.r, 48), M.get('rollEnd', 'paper'), roll);
      cap.position.z = (R.len / 2) * s; if (s < 0) cap.rotation.y = Math.PI;
    }
    const seam = mesh('roll_seam', new THREE.BoxGeometry(0.004, 0.004, R.len), M.get('outline'), roll);
    seam.position.set(0, R.r, 0);

    // Sockets for theme accessories
    this.sockets = {
      face: faceSock,
      head_top: group('socket_head_top', head, 0, T.y + T.h / 2 + 0.065, T.z),
      tank_front: group('socket_tank_front', head, 0, T.y - 0.17, front + 0.01),
      side_right: group('socket_side_right', head, T.w / 2 + 0.01, T.y, T.z),
      body_front: group('socket_body_front', body, 0, 0.25, 0.27),
      neck: group('socket_neck', body, 0, 0.86, D.pipeZ + 0.09),
      eyes: group('socket_eyes', head, 0, DIM.eye.y, front + 0.045),
      back: group('socket_back', head, 0, T.y, T.z - T.d / 2 - 0.01),
      lid_top: group('socket_lid_top', this.lidBones[6], 0, L.depth + 0.006, 0.06),
      floor_left: group('socket_floor_left', this.root, -0.62, 0, 0.15),
      floor_right: group('socket_floor_right', this.root, 0.62, 0, 0.15),
    };
    this.sockets.back.rotation.y = Math.PI;
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
    this.paperOutDir = new THREE.Vector3(-1, 0, 0);
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
    const ctx = { THREE, mats: this.mats, theme: this.theme, dim: DIM };
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

  updatePaperAnchor() {
    const R = DIM.roll;
    const roll = this.nodes.roll;
    roll.getWorldPosition(tmpV);
    const q = new THREE.Quaternion();
    this.head.getWorldQuaternion(q);
    const left = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
    const rs = this.paper.rollRadiusScale ?? 1;
    this.nodes.roll.scale.set(rs, rs, 1);
    this.paper.anchor.copy(tmpV).addScaledVector(left, R.r * rs);
    this.paper.widthDir.set(0, 0, 1).applyQuaternion(q);
    this.paper.emitDir.set(0, -1, 0).applyQuaternion(q);
    this.paperOutDir.copy(left);
  }

  /* -------------------------------------------------------------- lip */
  // Lid = lip: hinge angle + per-bone springs that curl the front outward (away from
  // the head), so it bends like a lip while talking. Then a collision clamp keeps the
  // whole lid out of the tank/head no matter how the head is posed.
  applyLid(dt, open) {
    const bones = this.lidBones, S = this.lipSprings;
    const n = S.length;
    for (let i = 0; i < n; i++) {
      const w = i / (n - 1);                       // 0 near hinge -> 1 at the front edge
      const m = this.mouthVec;
      const lift = i === 0 ? 0.1 * m.open : 0;     // more lift right after the hinge
      const sag = -0.32 * w ** 3 * m.open;         // A: lip front curls down, tight at the edge
      const pout = 0.3 * w * w * m.round;          // O/U: front edge curls up and out
      const tense = -0.06 * w * (m.wide + m.sib);  // E/I/S: tight, flatter lip
      const flap = Math.sin(this.time * 14 - i * 0.9) * 0.04 * w * this.talkAmt;
      S[i].target = lift + sag + pout + tense + flap + (open > 1.2 ? -0.12 * w : 0);
      for (let k = 0; k < 3; k++) S[i].step(dt / 3);
      bones[i + 1].rotation.x = -S[i].x;
    }
    // hinge with collision clamp against the tank (binary search on the angle)
    let hinge = Math.min(Math.max(0, open, this.s.seat.x + 0.006), DIM.lid.maxHinge);
    if (hinge > 0.3 && this.lidHitsHead(hinge)) {
      let lo = 0, hi = hinge;
      for (let it = 0; it < 7; it++) {
        const mid = (lo + hi) / 2;
        this.lidHitsHead(mid) ? (hi = mid) : (lo = mid);
      }
      hinge = lo;
      if (!this.lidTouching && this.s.lid.v > 2) this.emit('sfx', { type: 'clack', v: this.s.lid.v * 0.5 });
      this.lidTouching = true;
    } else this.lidTouching = false;
    this.nodes.lidPivot.rotation.x = -hinge;
    this.hinge = hinge;
    const inf = this.nodes.lid.morphTargetInfluences;
    if (inf) { inf[0] = this.s.smile.x; inf[1] = this.s.pucker.x; inf[2] = this.s.arch.x; }
  }

  lidHitsHead(hinge) {
    const piv = this.nodes.lidPivot;
    piv.rotation.x = -hinge;
    piv.updateMatrixWorld(true);
    const T = DIM.tank, m = 0.035, front = T.z + T.d / 2 + 0.07; // eyes/handle stick out in front
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
        if (p.y > T.y - T.h / 2 - m && p.y < T.y + T.h / 2 + 0.1 &&
            p.z > T.z - T.d / 2 - m && p.z < front && Math.abs(p.x) < T.w / 2 + m) return true;
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
    const M = R.view(BUF.MORPHS);
    const inf = this.nodes.lid.morphTargetInfluences;
    if (inf) { inf[0] = M[0]; inf[1] = M[1]; inf[2] = M[2]; }
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

    // water FX
    const J = this.jet;
    J.drops.mesh.instanceMatrix.array.set(R.view(BUF.DROPS)); J.drops.mesh.instanceMatrix.needsUpdate = true;
    J.foam.mesh.instanceMatrix.array.set(R.view(BUF.FOAM)); J.foam.mesh.instanceMatrix.needsUpdate = true;
    const streamOn = S[SC.STREAM_VISIBLE] > 0.5;
    J.stream.visible = streamOn;
    if (streamOn) {
      const g = J.stream.geometry;
      g.attributes.position.array.set(R.view(BUF.STREAM_POS)); g.attributes.position.needsUpdate = true;
      g.attributes.uv.array.set(R.view(BUF.STREAM_UV)); g.attributes.uv.needsUpdate = true;
      g.computeVertexNormals();
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
    const strip = (ps, pos, uv, perf, count, np, op) => {
      const n = S[count] | 0, nperf = S[np] | 0;
      ps.geo.attributes.position.array.set(R.view(pos)); ps.geo.attributes.position.needsUpdate = true;
      ps.geo.attributes.uv.array.set(R.view(uv)); ps.geo.attributes.uv.needsUpdate = true;
      ps.geo.setDrawRange(0, Math.max(0, n - 1) * 6);
      if (n > 1) ps.geo.computeVertexNormals();
      ps.perfGeo.attributes.position.array.set(R.view(perf)); ps.perfGeo.attributes.position.needsUpdate = true;
      ps.perfGeo.setDrawRange(0, nperf * 2);
      if (nperf) ps.perf.computeLineDistances();
      ps.mat.opacity = S[op];
      ps.perfMat.opacity = S[op] * 0.9;
    };
    strip(this.paper, BUF.PAPER_POS, BUF.PAPER_UV, BUF.PAPER_PERF, SC.PAPER_COUNT, SC.PAPER_PERF, SC.PAPER_OPACITY);
    strip(this.torn, BUF.TORN_POS, BUF.TORN_UV, BUF.TORN_PERF, SC.TORN_COUNT, SC.TORN_PERF, SC.TORN_OPACITY);

    // sound events
    const ev = r.drain_events();
    if (ev) for (const e of ev.split(String.fromCharCode(10))) {
      if (e.startsWith('clack:')) this.emit('sfx', { type: 'clack', v: parseFloat(e.slice(6)) });
      else this.emit('sfx', e);
    }
  }

  /* ----------------------------------------------------------- update */
  update(dtRaw, input) {
    if (this.rust) return this.updateRust(dtRaw, input);
    const dt = Math.min(dtRaw, 1 / 20);
    this.time += dt;
    const o = { mouth: null, headPitch: 0, headYaw: 0, lift: 0, shake: 0, squash: 0, eyeScale: 1, swirl: 0, handle: 0, blink: null, look: null, flip: 0, spin: 0 };
    for (const a of this.active) { a.t += dt; a.update(Math.min(a.t, a.def.duration), dt, this, o); }
    for (const a of this.active) if (a.t >= a.def.duration) a.end?.(this);
    this.active = this.active.filter((a) => a.t < a.def.duration);

    const S = this.s;
    const look = o.look ?? input.look ?? { x: 0, y: 0 };
    const lx = clamp(look.x, -1, 1), ly = clamp(look.y, -1, 1);
    // mouth: number (0..1 open) or viseme vector {open, round, wide, closed, sib}
    const mi = typeof input.mouth === 'number' ? { open: input.mouth } : (input.mouth || {});
    const m = o.mouth != null
      ? { open: o.mouth, round: 0, wide: 0, closed: 0, sib: 0 }
      : { open: clamp(mi.open || 0, 0, 1), round: clamp(mi.round || 0, 0, 1), wide: clamp(mi.wide || 0, 0, 1), closed: clamp(mi.closed || 0, 0, 1), sib: clamp(mi.sib || 0, 0, 1) };
    this.mouthVec = m;
    const mouthIn = m.open;
    this.talkAmt = Math.max(m.open, m.round, m.wide, m.sib);
    const rest = o.mouth != null ? 0 : this.restOpen * (1 - m.closed);

    S.yaw.target = lx * 0.5;
    S.pitch.target = -ly * 0.1;
    S.hYaw.target = lx * 0.28 + o.headYaw;
    S.hPitch.target = -ly * 0.22 + o.headPitch;
    S.hRoll.target = -lx * 0.06;
    S.lid.target = o.mouth != null && o.mouth > 0.9 ? 1.45
      : Math.max(0, rest + m.open * 0.9 + m.round * 0.12 + m.sib * 0.04);
    S.smile.target = m.wide * 0.9 - m.round * 0.3;
    S.pucker.target = m.round;
    // the arch (visible upper-lip curve) grows with the opening; smiling flattens it
    S.arch.target = clamp(m.open * 1.1 + m.round * 0.5 + m.sib * 0.3 + (o.mouth != null && o.mouth > 0.9 ? 0.6 : 0) - m.wide * 0.35, 0, 1.3);
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
      // lower lip (seat) rises to meet the upper lip on M/B/P, F/V and rounded O/U
      S.seat.target = m.closed * 0.045 + m.round * 0.035 + m.sib * 0.012 + Math.min(S.lid.x, 0.3) * 0.03;
      S.hRoll.target += -S.hYaw.v * 0.002;
    }

    // body
    const breath = Math.sin(this.time * 2.2) * 0.012;
    const talk = clamp(S.lid.x, 0, 1.6);
    const sq = S.squash.x + breath + talk * 0.015;
    this.body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
    this.body.rotation.set(S.pitch.x + o.flip, S.yaw.x + o.spin, 0);
    // flips rotate around the center of mass (~0.75 up), not around the floor
    const cm = 0.75, fy = cm - cm * Math.cos(o.flip), fz = -cm * Math.sin(o.flip);
    this.body.position.set(Math.sin(this.time * 63) * 0.008 * o.shake, S.lift.x + (o.flip ? fy + o.flipLift : 0),
      Math.cos(this.time * 51) * 0.005 * o.shake + (o.flip ? fz : 0));

    // head
    this.head.rotation.set(S.hPitch.x - talk * 0.1 + Math.sin(this.time * 70) * 0.02 * o.shake,
      S.hYaw.x, S.hRoll.x + Math.sin(this.time * 1.3) * 0.015);
    this.head.position.y = DIM.headY + talk * 0.025;

    // mouth
    this.applyLid(dt, talk);
    this.nodes.seatPivot.rotation.x = -Math.max(0, S.seat.x);

    // eyes (googly: springy pupils that sag a bit with gravity)
    S.px.target = lx * 0.9 - S.hYaw.v * 0.05;
    S.py.target = ly * 0.9 - 0.15 + S.hPitch.v * 0.05 - S.lift.v * 0.3;
    let blink = o.blink;
    if (blink == null) {
      this.blinkTimer -= dt;
      if (this.blinkTimer < 0) { this.blinkT = 0; this.blinkTimer = 1.8 + Math.random() * 4.5; }
      if (this.blinkT >= 0) { this.blinkT += dt; blink = Math.sin(Math.min(1, this.blinkT / 0.15) * Math.PI); if (this.blinkT > 0.15) this.blinkT = -1; }
      else blink = 0;
    }
    const maxOff = DIM.eye.r * 0.5;
    let px = S.px.x, py = S.py.x;
    const len = Math.hypot(px, py);
    if (len > 1) { px /= len; py /= len; }
    for (const e of this.eyes) {
      e.pupil.position.x = px * maxOff;
      e.pupil.position.y = py * maxOff;
      const es = S.eyeScale.x;
      e.eye.scale.set(es, es * (1 - 0.92 * blink), es);
    }

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
    this.nodes.handle.rotation.z = S.handle.x * 0.6;

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
    if (feeding) this.nodes.roll.rotation.z += (this.paper.feedSpeed / (DIM.roll.r * (this.paper.rollRadiusScale ?? 1))) * dt;
    this.paper.update(dt);
    if (this.torn.fade > 0) {
      this.torn.update(dt);
      this.torn.fade -= dt * 0.5;
      if (this.torn.fade <= 0) { this.torn.pts = []; this.torn.update(0); }
    }
    this.jet.origin.copy(this.body.localToWorld(tmpV.set(0, DIM.waterY, 0)));   // bowl center
    this.jet.mouth.copy(this.body.localToWorld(tmpV.fromArray(DIM.mouth.spout)));  // between the lips
    const q = new THREE.Quaternion();
    this.body.getWorldQuaternion(q);
    this.jet.dir.fromArray(DIM.mouth.spoutDir).normalize().applyQuaternion(q);
    this.jet.side.set(1, 0, 0).applyQuaternion(q);
    this.jet.update(dt);
  }
}
