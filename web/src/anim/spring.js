// Damped spring: the source of every smooth / bouncy motion in the rig.
export class Spring {
  constructor(k = 120, d = 14, x = 0) {
    this.k = k; this.d = d;
    this.x = x; this.v = 0; this.target = x;
  }
  step(dt) {
    const a = this.k * (this.target - this.x) - this.d * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}
