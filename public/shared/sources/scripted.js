// ScriptedSource: spelar upp en effektprofil, t.ex. [{ s: 300, w: 245 }] = 245 W i 300 s.

import { SourceBase, now } from './source.js';

export class ScriptedSource extends SourceBase {
  /**
   * @param {{ s: number, w: number }[]} profile
   * @param {{ spm?: number }} [opts] drag per minut (standard 40)
   */
  constructor(profile, { spm = 40 } = {}) {
    super('Skript');
    this.profile = profile;
    this.interval = 60 / spm;
    this.duration = profile.reduce((sum, seg) => sum + seg.s, 0);
    this.timer = null;
  }

  /** Effekten i profilen vid tiden t (s från start). */
  powerAt(t) {
    let end = 0;
    for (const seg of this.profile) {
      end += seg.s;
      if (t <= end) return seg.w;
    }
    return 0;
  }

  /**
   * Deterministiska drag för headless-körning. Varje drag rapporteras när det
   * är klart (som PM5), med effekten under draget.
   * @param {number} [t0] starttid
   */
  *strokes(t0 = 0) {
    for (let k = 1; k * this.interval <= this.duration + 1e-9; k++) {
      const t = k * this.interval;
      yield { t: t0 + t, power: this.powerAt(t - this.interval / 2), strokeCount: k };
    }
  }

  /** Webbläsarläge: skickar dragen i realtid. */
  async start() {
    this.stop();
    const t0 = now();
    const it = this.strokes(t0);
    const next = () => {
      const { value, done } = it.next();
      if (done) return;
      this.timer = setTimeout(() => {
        this.emit('stroke', value);
        next();
      }, Math.max(0, (value.t - now()) * 1000));
    };
    this.setStatus('connected');
    next();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }
}
