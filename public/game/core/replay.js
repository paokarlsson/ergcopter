// Snabbspolad landning (spec §7): simulerar resten av nedfärden med 0 W och
// spelar upp den på högst replayMaxS sekunder.

const MAX_STEPS = 20 * 3600; // säkerhetsgräns: en timme simulerad tid

/** Höjder från nuvarande läge tills helikoptern står på marken. */
export function landingTrajectory(flight) {
  const f = flight.clone();
  const heights = [f.h];
  for (let i = 0; i < MAX_STEPS && f.h > 0; i++) {
    f.step(0);
    heights.push(f.h);
  }
  return heights;
}

export class Replay {
  /**
   * @param {number[]} heights  en höjd per fysiksteg
   * @param {number} dt         fysikens tidssteg
   * @param {number} maxS       längsta uppspelning
   */
  constructor(heights, dt, maxS) {
    this.heights = heights;
    this.dt = dt;
    this.duration = Math.min(maxS, (heights.length - 1) * dt);
    this.elapsed = 0;
  }

  advance(dt) {
    this.elapsed = Math.min(this.duration, this.elapsed + dt);
  }

  get done() {
    return this.elapsed >= this.duration;
  }

  /** Höjden just nu i uppspelningen. */
  get h() {
    if (this.duration <= 0) return this.heights.at(-1) ?? 0;
    const pos = (this.elapsed / this.duration) * (this.heights.length - 1);
    const i = Math.floor(pos);
    const a = this.heights[i];
    const b = this.heights[Math.min(i + 1, this.heights.length - 1)];
    return a + (b - a) * (pos - i);
  }

  /** Snabbspolningsfaktor, för att visa "×12" i hörnet. */
  get speed() {
    return this.duration > 0 ? ((this.heights.length - 1) * this.dt) / this.duration : 1;
  }
}
