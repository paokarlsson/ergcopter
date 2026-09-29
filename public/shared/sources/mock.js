// MockSource: effekten styrs med reglage och piltangenter. Genererar drag i en
// inställbar takt med aktuell effekt, plus en påhittad kraftkurva till rotorn.

import { SourceBase, now } from './source.js';

const DRIVE_SAMPLES = 36;
const DRIVE_S = 0.6;

export class MockSource extends SourceBase {
  constructor({ spm = 40, power = 0 } = {}) {
    super('Mock');
    this.hasForce = true;
    this.spm = spm;
    this.power = power;
    this.count = 0;
    this.next = null; // timer för nästa drag
    this.timers = []; // kraftsampel och dragrapport för pågående drag
  }

  setPower(watts) {
    this.power = Math.max(0, Math.min(1000, Math.round(watts)));
  }

  async start() {
    this.stop();
    this.setStatus('connected', { message: 'Mock' });
    this.#schedule();
  }

  stop() {
    clearTimeout(this.next);
    this.timers.forEach(clearTimeout);
    this.next = null;
    this.timers = [];
  }

  #schedule() {
    this.next = setTimeout(() => this.#stroke(), (60 / this.spm) * 1000);
  }

  #stroke() {
    const power = this.power;
    this.timers = []; // föregående drags timrar har redan körts
    if (power > 0) {
      // Kraftkurvan först (draget), effekten rapporteras när draget är klart – som PM5.
      const peak = 150 + power * 4;
      const perBlock = 6;
      for (let i = 0; i < DRIVE_SAMPLES; i += perBlock) {
        const block = [];
        for (let k = i; k < Math.min(i + perBlock, DRIVE_SAMPLES); k++) {
          block.push(peak * Math.sin(Math.PI * (k / (DRIVE_SAMPLES - 1)) ** 0.85) * (0.95 + 0.1 * Math.random()));
        }
        this.timers.push(setTimeout(() => this.emit('force', block, 2), (i / DRIVE_SAMPLES) * DRIVE_S * 1000));
      }
      this.timers.push(
        setTimeout(() => {
          const stroke = { t: now(), power, strokeCount: ++this.count };
          this.raw(`mock drag #${stroke.strokeCount}: ${power} W`);
          this.emit('stroke', stroke);
        }, DRIVE_S * 1000)
      );
    }
    this.#schedule();
  }
}
