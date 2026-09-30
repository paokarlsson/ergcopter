// Motorn (spec §4): senaste dragets effekt driver rotorn tills nästa drag kommer.
// Varje drag redovisar rätt effekt, så inget medelvärde räknas. Utjämningen kommer
// i stället från rotorbladens massa (physics.js).

/** Ett drag driver motorn så här mycket längre än förra dragperioden innan motorn stannar. */
export const HOLD_FACTOR = 1.25;

export class Engine {
  /** @param {{maxStrokeS:number}} cfg */
  constructor(cfg) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.lastPower = 0; // W, senaste dragets effekt
    this.lastCount = null;
    this.lastStrokeAt = null; // s
    this.until = -Infinity; // s, då motorn stannar om inget nytt drag kommer
  }

  /**
   * Nytt drag. Dubbla notiser med samma strokeCount ignoreras. Första draget, och
   * första draget efter en paus, driver motorn i maxStrokeS.
   * @param {{t:number, power:number, strokeCount:number}} stroke
   * @returns {boolean} om draget räknades
   */
  stroke({ t, power, strokeCount }) {
    if (strokeCount === this.lastCount) return false;
    this.lastCount = strokeCount;
    const period = this.lastStrokeAt === null ? Infinity : t - this.lastStrokeAt;
    this.lastStrokeAt = t;
    this.lastPower = power;
    this.until = t + Math.min(this.cfg.maxStrokeS, HOLD_FACTOR * period);
    return true;
  }

  /** Motoreffekten vid tiden t (s): senaste dragets effekt, eller 0 när motorn har stannat. */
  power(t) {
    return t < this.until ? this.lastPower : 0;
  }
}
