// Valfritt rotorljud (spec §8): helikopterljudet följer P_smooth/P0.
// Hovring (100 %) är fullt rotorvarv; över 100 % låter det mer – 200 % är vanligt,
// 300 % taket. WebAudio kräver en användargest innan ljud får spelas – unlock()
// anropas vid klick/tangent.

import { HelicopterSound } from './helicopter-sound.js';
import { now } from '../../shared/sources/source.js';

const VOLUME = 0.7;
const MAX_RATIO = 3;
const ENGINE_OFF_OMEGA = 0.5; // rad/s: under detta, utan effekt, stängs motorn av

export class RotorSound {
  constructor() {
    this.heli = null;
    this.enabled = false;
    this.last = null;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.heli) return;
    this.heli.setVolume(on ? VOLUME : 0);
    if (!on) this.heli.setEngine(false);
  }

  /** Skapar/återupptar ljudet. Måste anropas i en klick- eller tangenthändelse. */
  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.heli) this.heli = new HelicopterSound({ volume: VOLUME, maxThrottle: MAX_RATIO, autoUpdate: false });
      this.heli.start().catch(() => {});
    } catch {
      this.heli = null;
      this.enabled = false; // ingen WebAudio – spelet fungerar ändå
    }
  }

  /**
   * @param {number} ratio   P_smooth/P0, 1 = hovring
   * @param {number} omega   rotorns vinkelhastighet (rad/s); motorn går så länge rotorn snurrar
   */
  update(ratio, omega) {
    const t = now();
    const dt = this.last === null ? 0 : t - this.last;
    this.last = t;
    if (!this.heli?.context) return;
    const r = Math.max(0, Math.min(MAX_RATIO, ratio || 0));
    this.heli.setEngine(this.enabled && (r > 0.02 || omega > ENGINE_OFF_OMEGA));
    this.heli.setThrottle(r);
    this.heli.update(dt);
  }
}
