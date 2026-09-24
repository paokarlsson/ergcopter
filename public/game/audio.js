// Valfritt rotorljud (spec §8): tonhöjd och "chop" följer P_smooth/P0.
// WebAudio kräver en användargest innan ljud får spelas – unlock() anropas vid klick/tangent.

export class RotorSound {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.nodes = null;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.nodes) this.nodes.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.2);
  }

  /** Skapar/återupptar ljudet. Måste anropas i en klick- eller tangenthändelse. */
  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) this.#build();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      this.enabled = false; // ingen WebAudio – spelet fungerar ändå
    }
  }

  /**
   * @param {number} ratio   P_smooth/P0
   * @param {number} omega   rotorns vinkelhastighet (rad/s) för "chop"-takten
   */
  update(ratio, omega) {
    if (!this.nodes) return;
    const t = this.ctx.currentTime;
    const r = Math.max(0, Math.min(2.5, ratio));
    const { osc, lfo, filter, amp } = this.nodes;
    osc.frequency.setTargetAtTime(30 + 40 * r, t, 0.3);
    filter.frequency.setTargetAtTime(200 + 500 * r, t, 0.3);
    lfo.frequency.setTargetAtTime(Math.min(28, (omega * 4) / (2 * Math.PI)), t, 0.3);
    amp.gain.setTargetAtTime(Math.min(0.12, 0.05 * r + (omega > 0.5 ? 0.02 : 0)), t, 0.3);
  }

  #build() {
    const ctx = (this.ctx = new AudioContext());
    const master = ctx.createGain();
    master.gain.value = this.enabled ? 1 : 0;
    master.connect(ctx.destination);

    // Ton: sågtand genom lågpass. Chop: LFO som modulerar volymen (bladpassager).
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const amp = ctx.createGain();
    amp.gain.value = 0;
    const chop = ctx.createGain();
    chop.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.4;
    lfo.connect(lfoDepth).connect(chop.gain);

    osc.connect(filter).connect(chop).connect(amp).connect(master);
    osc.start();
    lfo.start();
    this.nodes = { master, osc, filter, amp, lfo };
  }
}
