// Fysikmodellen (spec §5): en människodriven helikopter med fast bladvinkel.
// Motorn (engine.js) driver rotorn, rotorns varv ger lyftkraften och lyftkraften
// mot tyngden ger accelerationen. Ren logik: ingen tid, DOM eller datakälla.
//
//   σ(h)   = 1 / (1 + h / H_air)²        luftens täthet relativt marken
//   n      = √(E / E0)                   rotorvarv relativt hovringsvarvet vid marken
//   T / Mg = σ · n² / w                  lyftkraft relativt tyngden, w = massa relativt utan last
//   dE/dt  = P − P0·σ·n³ − T·v           motor − luftförlust − arbete på helikoptern
//   dv/dt  = g · (T / Mg − 1)
//   dh/dt  = v
//
// E är rotorbladens rörelseenergi. Bladen har massa, så varvet följer motorn med
// tidskonstanten rotorTauS vid marken (E0 = 1,5 · rotorTauS · P0). Tyngden är Mg = P0 / G.
// Då kräver hovring på höjden h exakt P0 · (1 + h / H_air), och stadig stigning ger
// v = G · (P − P_req(h)) / P0. När helikoptern sjunker driver fallet rotorn: autorotation.
// Allt räknas relativt spelarens P0, så alla flyger samma helikopter skalad efter sin
// egen lyfteffekt (spec §6).

import { liftPower } from './config.js';

const SUBSTEP_S = 0.01; // s: inre tidssteg, rotorn blir snabb vid stor effekt
const MIN_HOP_M = 0.1; // m: ett lägre skutt efter en sättning räknas inte som en ny sättning

export class Flight {
  /**
   * @param {object} cfg       konfiguration (P_ref, m_ref, weightMode, H_air, G, g, rotorTauS, maxSinkRate, dt)
   * @param {number} bodyMass  kg
   */
  constructor(cfg, bodyMass) {
    this.cfg = cfg;
    this.bodyMass = bodyMass;
    this.rotorP0 = liftPower(cfg, bodyMass); // helikopterns storlek: hovringseffekten utan last
    this.P0 = this.rotorP0;
    this.load = 0; // last som andel av kroppsvikten, t.ex. sandsäcken (plan.md §3)
    this.reset();
  }

  /**
   * Last ombord som andel av kroppsvikten. Lyfteffekten räknas om från den nya
   * vikten, så att lasten blir lika tung för alla (plan.md §1: patienten blir last).
   * Rotorn är densamma, så helikoptern sjunker tills varvet hunnit upp.
   */
  setLoad(share) {
    this.load = share;
    this.P0 = liftPower(this.cfg, this.bodyMass * (1 + share));
  }

  reset() {
    this.t = 0; // s sedan start
    this.h = 0; // m
    this.v = 0; // m/s, stig- (+) eller sjunkhastighet (−)
    this.E = 0; // J, rotorbladens rörelseenergi: rotorn står still vid start
    this.hMax = 0;
    this.tHMax = 0;
    this.hasFlown = false; // har varit i luften under passet
    this.power = 0; // senaste motoreffekten
    this.touchdown = null; // senaste sättningen: { t, speed } (m/s, positiv nedåt)
    this.hopH = 0; // m, högsta höjden sedan senaste sättningen
  }

  /** Massan relativt helikoptern utan last. Hovringseffekten växer som massan^1,5, så w = (P0 / P0 utan last)^(2/3). */
  get massRatio() {
    return (this.P0 / this.rotorP0) ** (2 / 3);
  }

  /** Rotorbladens rörelseenergi vid hovringsvarv vid marken (J). */
  get rotorEnergyAtHover() {
    return 1.5 * this.cfg.rotorTauS * this.rotorP0;
  }

  /** Luftens täthet relativt marken, vald så att hovringseffekten växer linjärt med höjden. */
  airDensity(h = this.h) {
    return 1 / (1 + h / this.cfg.H_air) ** 2;
  }

  /** Rotorvarvet relativt hovringsvarvet vid marken utan last. */
  get rotorSpeed() {
    return Math.sqrt(this.E / this.rotorEnergyAtHover);
  }

  /** Lyftkraften relativt tyngden: 1 håller farten, över 1 accelererar uppåt. */
  get thrustRatio() {
    return (this.airDensity() * this.rotorSpeed ** 2) / this.massRatio;
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

  /** Stadig stigfart vid effekten: dit farten går när rotorn och farten har hunnit ställa in sig. */
  targetSpeed(power = this.power) {
    return (this.cfg.G * (power - this.requiredPower())) / (this.massRatio * this.rotorP0);
  }

  /**
   * Ett tidssteg (dt) med motoreffekten `power` (W). Valfritt `cfg.ceiling` (m, 0 = av):
   * helikopterns tak, där den inte stiger mer.
   */
  step(power) {
    const { dt } = this.cfg;
    this.power = power;
    const n = Math.max(1, Math.ceil(dt / SUBSTEP_S - 1e-9));
    const t0 = this.t;
    for (let i = 1; i <= n; i++) this.#advance(power, dt / n, i === n ? t0 + dt : t0 + (dt * i) / n);
  }

  /** Explicit Euler över ett inre tidssteg, fram till tiden t. */
  #advance(power, dt, t) {
    const { g, G, maxSinkRate, ceiling = 0 } = this.cfg;
    const sigma = this.airDensity();
    const n = this.rotorSpeed;
    const lift = sigma * n * n; // lyftkraften i enheter av tyngden utan last
    // Rotorn: motorn in, luftförlusten och arbetet på helikoptern ut. Vid sjunk är arbetet negativt och driver rotorn.
    const work = (this.rotorP0 / G) * lift * this.v;
    this.E = Math.max(0, this.E + (power - this.rotorP0 * sigma * n ** 3 - work) * dt);

    let v = this.v + g * (lift / this.massRatio - 1) * dt;
    if (maxSinkRate > 0) v = Math.max(v, -maxSinkRate);
    if (this.h <= 0 && v < 0) v = 0; // markvillkor
    if (ceiling > 0 && this.h >= ceiling && v > 0) v = 0; // taket

    const wasAirborne = this.h > 0;
    this.v = v;
    this.h = Math.max(0, this.h + v * dt);
    if (ceiling > 0 && v > 0) this.h = Math.min(this.h, ceiling);
    this.t = t;
    if (wasAirborne && this.h <= 0) {
      // Vid en mjuk sättning är lyftkraften nästan lika stor som tyngden, så helikoptern kan skutta
      // en bråkdel av en millimeter. Då gäller den första sättningen.
      if (this.hopH >= MIN_HOP_M) this.touchdown = { t: this.t, speed: -v };
      this.hopH = 0;
      this.v = 0; // marken tar upp farten
    }
    this.hopH = Math.max(this.hopH, this.h);
    if (this.h > 0) this.hasFlown = true;
    if (this.h > this.hMax) {
      this.hMax = this.h;
      this.tHMax = this.t;
    }
  }

  /** Ställer helikoptern i hovring på höjden h med rotorn på hovringsvarv, t.ex. i tester och simuleringar. */
  hoverAt(h) {
    this.h = h;
    this.v = 0;
    this.E = (this.rotorEnergyAtHover * this.massRatio) / this.airDensity(h);
    this.hopH = Math.max(this.hopH, h);
    if (h > 0) this.hasFlown = true;
  }

  /** Oberoende kopia, t.ex. för att simulera landningen utan att röra passet. */
  clone() {
    return Object.assign(new Flight(this.cfg, this.bodyMass), this);
  }
}

/**
 * Analytisk höjd från marken vid konstant effekt P > P0, i gränsen där rotorn och
 * farten ställer in sig direkt (spec §5). Längre insatser hamnar nära den.
 */
export function analyticHeight(cfg, P0, power, t) {
  return cfg.H_air * (power / P0 - 1) * (1 - Math.exp((-t * cfg.G) / cfg.H_air));
}
