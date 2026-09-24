// Rotorn – bara för bilden, påverkar inte fysiken.
//
// Med kraftdata (USB, Mock): varje kraftsampel ger vridmoment till en tung rotor
// som håller varvet mellan dragen. Utan kraftdata (BLE): varvet följer
// P_smooth/P0 (spec §8), också med tröghet.

const TORQUE_GAIN = 0.0003; // rad/s per N och sampel
const DECAY_TIME_S = 8; // luftmotstånd
const FRICTION = 0.25; // rad/s², så att den till slut stannar
const SAMPLE_RATE_HZ = 50; // takt som köade sampel matas in
const FORCE_FRESH_S = 4; // så länge efter senaste kraftsampel gäller kraftläget
const OMEGA_AT_P0 = 12; // rad/s vid P_smooth = P0 i fallback-läget
const FALLBACK_RESPONSE_S = 1.5;
export const VISUAL_OMEGA_MAX = 16; // ovanför detta ritas rotorn som en skiva

export class Rotor {
  constructor() {
    this.queue = [];
    this.omega = 0;
    this.angle = 0;
    this.tailAngle = 0;
    this.time = 0;
    this.lastForceAt = -Infinity;
  }

  /** Kraftsampel i N. */
  addForces(samples) {
    if (!samples.length) return;
    this.queue.push(...samples);
    this.lastForceAt = this.time;
  }

  get forceDriven() {
    return this.time - this.lastForceAt < FORCE_FRESH_S;
  }

  /**
   * @param {number} dt s
   * @param {number} ratio P_smooth/P0, används när det saknas kraftdata
   */
  step(dt, ratio) {
    this.time += dt;
    if (this.forceDriven) {
      const n = Math.min(this.queue.length, Math.max(Math.round(SAMPLE_RATE_HZ * dt), Math.ceil(this.queue.length / 8)));
      for (const f of this.queue.splice(0, n)) this.omega += f * TORQUE_GAIN;
      this.omega *= Math.exp(-dt / DECAY_TIME_S);
      this.omega = Math.max(0, this.omega - FRICTION * dt);
    } else {
      this.queue.length = 0;
      const target = Math.max(0, ratio) * OMEGA_AT_P0;
      this.omega += (target - this.omega) * Math.min(1, dt / FALLBACK_RESPONSE_S);
    }
    const visual = Math.min(this.omega, VISUAL_OMEGA_MAX);
    this.angle = (this.angle + visual * dt) % (Math.PI * 2);
    this.tailAngle = (this.tailAngle + visual * 3 * dt) % (Math.PI * 2);
  }

  /** 0–1: hur suddig rotorn ska ritas. */
  get blur() {
    return Math.min(1, this.omega / VISUAL_OMEGA_MAX);
  }

  get rpm() {
    return (this.omega * 60) / (2 * Math.PI);
  }
}
