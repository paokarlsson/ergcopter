// Fysikmodellen (spec §5). Ren logik: ingen tid, DOM eller datakälla.
//
//   P0       = P_ref · (m / m_ref)^k
//   P_req(h) = P0 · (1 + h / H_air)
//   dh/dt    = G · (P − P_req(h)) / P0

import { liftPower } from './config.js';

export class Flight {
  /**
   * @param {object} cfg       konfiguration (P_ref, m_ref, weightMode, H_air, G, maxSinkRate, dt)
   * @param {number} bodyMass  kg
   */
  constructor(cfg, bodyMass) {
    this.cfg = cfg;
    this.P0 = liftPower(cfg, bodyMass);
    this.reset();
  }

  reset() {
    this.t = 0; // s sedan start
    this.h = 0; // m
    this.v = 0; // m/s, senaste dh/dt
    this.hMax = 0;
    this.tHMax = 0;
    this.hasFlown = false; // har varit i luften under passet
    this.power = 0; // senaste P_smooth
  }

  /** Effekt som krävs för att hålla höjden h. */
  requiredPower(h = this.h) {
    return this.P0 * (1 + h / this.cfg.H_air);
  }

  /** Lyftmätaren (spec §8): P/P_req(h) i luften, P/P0 på marken. */
  liftRatio(power = this.power) {
    return this.onGround ? power / this.P0 : power / this.requiredPower();
  }

  get onGround() {
    return this.h <= 0;
  }

  /** Ett tidssteg (dt) med effekten P_smooth. Explicit Euler. */
  step(power) {
    const { G, dt, maxSinkRate } = this.cfg;
    this.power = power;
    let v = (G * (power - this.requiredPower())) / this.P0;
    if (maxSinkRate > 0) v = Math.max(v, -maxSinkRate);
    if (this.h <= 0 && v < 0) v = 0; // markvillkor

    this.v = v;
    this.h = Math.max(0, this.h + v * dt);
    this.t += dt;
    if (this.h > 0) this.hasFlown = true;
    if (this.h > this.hMax) {
      this.hMax = this.h;
      this.tHMax = this.t;
    }
  }

  /** Oberoende kopia, t.ex. för att simulera landningen utan att röra passet. */
  clone() {
    const f = Object.create(Flight.prototype);
    Object.assign(f, this);
    return f;
  }
}

/** Analytisk höjd från marken vid konstant effekt P > P0 (spec §5). */
export function analyticHeight(cfg, P0, power, t) {
  return cfg.H_air * (power / P0 - 1) * (1 - Math.exp((-t * cfg.G) / cfg.H_air));
}
