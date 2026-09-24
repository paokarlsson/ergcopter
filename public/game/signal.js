// Signalbehandling (spec §4): effekt per drag → kontinuerlig P_smooth.

export class StrokeSmoother {
  /** @param {{smoothingStrokes:number, strokeTimeoutS:number, fadeOutS:number}} cfg */
  constructor(cfg) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.powers = []; // senaste dragens effekt, äldst först
    this.lastCount = null;
    this.lastStrokeAt = -Infinity; // s
  }

  /**
   * Nytt drag. Dubbla notiser med samma strokeCount ignoreras.
   * @param {{t:number, power:number, strokeCount:number}} stroke
   * @returns {boolean} om draget räknades
   */
  push({ t, power, strokeCount }) {
    if (strokeCount === this.lastCount) return false;
    this.lastCount = strokeCount;
    this.lastStrokeAt = t;
    this.powers.push(power);
    if (this.powers.length > this.cfg.smoothingStrokes) this.powers.shift();
    return true;
  }

  /** P_smooth vid tiden t (s). */
  value(t) {
    if (!this.powers.length) return 0;
    const mean = this.powers.reduce((a, b) => a + b, 0) / this.powers.length;
    const since = t - this.lastStrokeAt;
    const { strokeTimeoutS, fadeOutS } = this.cfg;
    if (since <= strokeTimeoutS) return mean;
    if (since < strokeTimeoutS + fadeOutS) return mean * (1 - (since - strokeTimeoutS) / fadeOutS);
    this.powers = [];
    return 0;
  }
}
