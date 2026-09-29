// Fysikmodellen (spec §5). Ren logik: ingen tid, DOM eller datakälla.
//
//   P0       = P_ref · (m / m_ref)^k
//   P_req(h) = P0 · (1 + h / H_air)
//   v_mål    = G · (P − P_req(h)) / P0
//   dv/dt    = (v_mål − v) / T            T = inertiaS, tröghet (0 = farten följer effekten direkt)
//   dh/dt    = v

import { liftPower } from './config.js';

export class Flight {
  /**
   * @param {object} cfg       konfiguration (P_ref, m_ref, weightMode, H_air, G, inertiaS, maxSinkRate, dt)
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
    this.v = 0; // m/s, stig- (+) eller sjunkhastighet (−)
    this.hMax = 0;
    this.tHMax = 0;
    this.hasFlown = false; // har varit i luften under passet
    this.power = 0; // senaste P_smooth
    this.touchdown = null; // senaste sättningen: { t, speed } (m/s, positiv nedåt)
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

  /** Farten som effekten drar mot: dit luftmotståndet och lyftet balanserar. */
  targetSpeed(power = this.power) {
    return (this.cfg.G * (power - this.requiredPower())) / this.P0;
  }

  /**
   * Ett tidssteg (dt) med effekten P_smooth.
   * Farten närmar sig målfarten exponentiellt med tidskonstanten `inertiaS` (spec §5).
   * Den exakta lösningen över steget är stabil för alla dt, och inertiaS = 0 ger farten direkt.
   * Valfritt `cfg.ceiling` (m, 0 = av): helikopterns tak, där den inte stiger mer.
   */
  step(power) {
    const { dt, maxSinkRate, inertiaS = 0, ceiling = 0 } = this.cfg;
    this.power = power;
    const vTarget = this.targetSpeed(power);
    let v = inertiaS > 0 ? vTarget + (this.v - vTarget) * Math.exp(-dt / inertiaS) : vTarget;
    if (maxSinkRate > 0) v = Math.max(v, -maxSinkRate);
    if (this.h <= 0 && v < 0) v = 0; // markvillkor
    if (ceiling > 0 && this.h >= ceiling && v > 0) v = 0; // taket

    const wasAirborne = this.h > 0;
    this.v = v;
    this.h = Math.max(0, this.h + v * dt);
    if (ceiling > 0 && v > 0) this.h = Math.min(this.h, ceiling);
    this.t += dt;
    if (wasAirborne && this.h <= 0) {
      this.touchdown = { t: this.t, speed: -v };
      this.v = 0; // marken tar upp farten, så att trögheten inte bär den vidare
    }
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
