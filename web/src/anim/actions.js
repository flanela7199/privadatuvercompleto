// One-shot animations ("actions"). Each frame the rig resets an override
// table `o`, then every running action writes into it:
//   o.mouth (0..1 or null), o.headPitch, o.headYaw, o.lift, o.shake, o.squash,
//   o.eyeScale, o.swirl, o.handle, o.blink (0..1 or null), o.look ({x,y} or null)
// Actions also drive the FX objects directly: tb.jet (gurgle, emitting, rate, speed,
// drips) and tb.paper / tb.torn (targetLen, feedSpeed, wind, tearInto).
// Add your own with registerAction('name', { duration, start?, update, end? }).
// `this` inside start/update/end is a per-play instance (safe for local state).
import { smooth } from '../rig/geo.js';

export const ACTIONS = {};
export const registerAction = (name, def) => { ACTIONS[name] = def; };

/* Descarga: handle -> water rises & gurgles (lid quivers) -> heave -> spews in surges
   -> column breaks off and falls -> lid slams -> rim drips -> bowl drains & refills. */
registerAction('flush', {
  duration: 5.2,
  start(tb) { tb.emit('sfx', 'flush'); },
  update(t, dt, tb, o) {
    const j = tb.jet;
    o.handle = t < 0.6 ? smooth(0, 0.18, t) : 1 - smooth(0.6, 0.9, t);
    const gurgle = smooth(0.3, 1.2, t) * (1 - smooth(1.45, 1.65, t));
    j.gurgle = gurgle;
    o.swirl = 14 * smooth(0.3, 1.2, t) * (1 - smooth(3.6, 4.6, t));
    o.shake = t < 1.65 ? smooth(0.35, 1.5, t) : 0.25 * (1 - smooth(1.65, 3.3, t));
    o.eyeScale = 1 + 0.2 * smooth(0.5, 1.3, t) * (1 - smooth(3.5, 4.3, t));
    if (t < 1.5) {
      // bubbling pushes the lid open in little jolts; cheeks puff before the heave
      o.mouth = gurgle * (0.05 + 0.12 * Math.abs(Math.sin(t * 19)));
      o.squash = -0.06 * smooth(0.9, 1.5, t);
    }
    const spew = t > 1.6 && t < 3.4;
    if (t >= 1.5 && t < 3.5) {
      o.mouth = 1;
      const surge = 0.5 + 0.5 * Math.cos(((t - 1.6) * Math.PI * 2) / 0.9);   // heaves
      o.headPitch = -0.26 - 0.08 * surge;
      o.lift = 0.03 + 0.02 * surge;
      o.squash = 0.04 * surge - 0.02;
      j.speed = 2.9 + 0.7 * surge;
      j.rate = 520 * (0.6 + 0.4 * surge) * (1 - smooth(2.95, 3.4, t));
    } else if (t >= 3.5 && t < 4.6) o.mouth = 0;  // slam shut (the lip bounces)
    if (spew && !this.spewing) tb.emit('sfx', 'splash');
    this.spewing = spew;
    j.emitting = spew;
    if (t > 3.45 && !this.dripped) { this.dripped = true; j.drips = 1.6; }
    o.look = t > 1.6 && t < 3.4 ? { x: 0, y: 0.6 } : null;
  },
  end(tb) { const j = tb.jet; j.emitting = false; j.gurgle = 0; j.speed = 3.2; j.rate = 400; },
});

/* Papel higiênico: roll spins, sheets stream out fluttering, drop and pile up,
   then the strip tears at a perforation and the torn part tumbles away. */
registerAction('paper', {
  duration: 4.4,
  start(tb) { tb.emit('sfx', 'paper'); },
  update(t, dt, tb, o) {
    const p = tb.paper;
    // flush + paper together: keep streaming (windy phase) while a flush gurgles / spews, max 3 s (mirror of Rust)
    if ((tb.jet?.emitting || tb.jet?.gurgle > 0.05) && t >= 1.6 && t < 2.0 && (this.hold ?? 0) < 3) { this.hold = (this.hold ?? 0) + dt; this.t -= dt; }
    if (t < 2.5) {
      p.targetLen = 3.4;
      p.feedSpeed = 1.7 * smooth(0, 0.35, t) * (1 - 0.3 * smooth(1.8, 2.5, t));
      const w = 12 * smooth(0, 0.45, t) * (1 - smooth(1.8, 2.5, t));
      p.wind.copy(tb.paperOutDir).multiplyScalar(w);
      p.wind.y = w * 0.2;
    } else {
      p.wind.set(0, 0, 0);
      p.targetLen = p.length();                     // stop feeding, let it settle
      if (!this.torn && t > 3.0) {
        this.torn = true;
        const ok = p.tearInto ? p.tearInto(tb.torn) : false;
        if (!ok) tb.tearPaper();
        tb.emit('sfx', 'rip');
      }
    }
    o.headYaw = -0.05 * smooth(0, 0.3, t) * (1 - smooth(2.6, 3.2, t));
    if (!tb.jet?.emitting) o.look = t < 2.6 ? { x: -0.12, y: -0.55 } : t < 3.4 ? { x: -0.12, y: -0.85 } : o.look;   // spewing: the flush aims
    o.mouth = t < 2.4 ? 0.3 + 0.15 * Math.sin(t * 20) : null;
  },
  end(tb) { const p = tb.paper; p.wind.set(0, 0, 0); p.feedSpeed = 0.6; p.targetLen = 0.24; },
});

/* Gargarejo: bowl bubbles, lid chatters. */
registerAction('gargle', {
  duration: 2.2,
  start(tb) { tb.emit('sfx', 'gargle'); },
  update(t, dt, tb, o) {
    const g = smooth(0, 0.3, t) * (1 - smooth(1.8, 2.2, t));
    tb.jet.gurgle = g;
    o.mouth = g * (0.1 + 0.2 * Math.abs(Math.sin(t * 23)));
    o.headPitch = -0.15 * g;
    o.look = { x: 0, y: 0.5 * g };
    o.shake = 0.15 * g;
  },
  end(tb) { tb.jet.gurgle = 0; },
});

/* Backflip: crouch -> launch -> full backward rotation in the air -> land with a squash. */
registerAction('backflip', {
  duration: 1.55,
  start(tb) { tb.emit('sfx', 'boing'); },
  update(t, dt, tb, o) {
    const T0 = 0.28, T1 = 1.12;                  // takeoff / landing
    if (t < T0) { o.squash = -0.16 * smooth(0, T0, t); o.look = { x: 0, y: -0.4 }; return; }
    if (t < T1) {
      const u = (t - T0) / (T1 - T0);
      o.flip = -Math.PI * 2 * smooth(0.05, 0.95, u);   // full backward turn
      o.flipLift = 0.95 * 4 * u * (1 - u);              // ballistic hop
      o.squash = 0.06 * Math.sin(u * Math.PI);           // stretch in the air
      o.mouth = 0.75;                                    // "uaaau"
      o.eyeScale = 1.2;
      o.look = { x: 0, y: 0.9 };
      if (!this.whoosh && u > 0.2) { this.whoosh = true; tb.emit('sfx', 'whoosh'); }
      return;
    }
    if (!this.landed) { this.landed = true; tb.emit('sfx', { type: 'clack', v: 9 }); }
    o.squash = -0.14 * (1 - smooth(T1, 1.55, t));
    o.headPitch = 0.15 * (1 - smooth(T1, 1.5, t));
  },
});

registerAction('blink', {
  duration: 0.16,
  update(t, dt, tb, o) { o.blink = Math.sin((t / 0.16) * Math.PI); },
});

registerAction('jump', {
  duration: 1.0,
  start(tb) { tb.emit('sfx', 'boing'); },
  update(t, dt, tb, o) {
    if (t < 0.22) o.squash = -0.12 * smooth(0, 0.22, t);
    else if (t < 0.78) {
      const u = (t - 0.22) / 0.56;
      o.lift = 0.35 * 4 * u * (1 - u);
      o.squash = 0.08 * (1 - u);
      o.mouth = 0.5;
    } else o.squash = -0.1 * (1 - smooth(0.78, 1.0, t));
  },
});

registerAction('no', {
  duration: 1.1,
  update(t, dt, tb, o) { o.headYaw = Math.sin(t * 16) * 0.35 * (1 - smooth(0.6, 1.1, t)); },
});

/* Hop up onto the chair on floor_under (sit height -> tb.seatHeight()) / back down to the floor.
   o.sitTo = 1 (up) / 0 (down) during the hop; the rig's sit spring carries the base. Mirror of Rust Kind::Sit. */
for (const [name, up] of [['sit', 1], ['stand', 0]]) {
  registerAction(name, {
    duration: 0.9,
    start(tb) { tb.emit('sfx', 'boing'); },
    update(t, dt, tb, o) {
      if (t < 0.2) { o.squash = -0.1 * smooth(0, 0.2, t); o.look = { x: 0, y: -0.3 }; }
      else if (t < 0.62) {
        const u = (t - 0.2) / 0.42;
        o.lift = 0.18 * 4 * u * (1 - u);
        o.squash = 0.06 * (1 - u);
        o.sitTo = up;
      } else {
        if (!this.landed) { this.landed = true; tb.emit('sfx', { type: 'clack', v: 4 }); o.impact = 0.35; }
        o.squash = -0.1 * (1 - smooth(0.62, 0.9, t));
      }
    },
  });
}
