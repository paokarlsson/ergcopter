// Övningsmotorn (plan.md §3). Ren logik utan DOM: en övning är en lista med
// steg som bedöms mot flygningen efter varje fysiksteg.
//
// Steg:
//   { type: 'climb', to }                      stig till höjden `to`
//   { type: 'hover', at, tol, holdS }          håll dig inom at ± tol i holdS sekunder i sträck
//   { type: 'land', maxSpeed }                 sätt ner med högst maxSpeed m/s
//   { type: 'freefall', from, to, tol }        sluta veva på minst from − tol, fånga upp inom to ± tol
//
// Ett misslyckat uppfångande i fritt fall går att göra om: stig igen och släpp på nytt.
// Hård landning, mark under fritt fall och tidsgränsen underkänner övningen.

const EPS = 1e-9;
const CAUGHT_SINK = 1; // m/s: sjunker inte fortare än så räknas som uppfångad

export const EXERCISES = [
  {
    id: 'first-lift',
    name: 'Första lyftet',
    goal: 'Lyft till 50 m och landa igen',
    maxS: 180,
    steps: [
      { type: 'climb', to: 50 },
      { type: 'land', maxSpeed: 3 },
    ],
  },
  {
    id: 'hover',
    name: 'Hovring',
    goal: 'Håll dig på 300 m ±25 m i 30 s',
    maxS: 240,
    steps: [{ type: 'hover', at: 300, tol: 25, holdS: 30 }],
  },
  {
    id: 'altitude',
    name: 'Höjdflygning',
    goal: 'Stig till 1 000 m och landa mjukt vid verkstan',
    maxS: 480,
    steps: [
      { type: 'climb', to: 1000 },
      { type: 'land', maxSpeed: 2 },
    ],
  },
  {
    id: 'freefall',
    name: 'Fritt fall',
    goal: 'Stig till 1 000 m, sluta veva, fall till 500 m och fånga upp helikoptern där',
    maxS: 480,
    steps: [
      { type: 'climb', to: 1000 },
      { type: 'freefall', from: 1000, to: 500, tol: 50 },
    ],
  },
];

export function getExercise(id) {
  const ex = EXERCISES.find((e) => e.id === id);
  if (!ex) throw new Error(`Okänd övning: ${id}`);
  return ex;
}

const m = (h) => `${Math.round(h).toLocaleString('sv-SE')} m`;
const ms = (v) => `${v.toFixed(1).replace('.', ',')} m/s`;

/** Varje stegtyp: init, update (→ 'done' | { fail } | undefined) och text. */
const STEPS = {
  climb: {
    init: () => ({}),
    update(s, f) {
      if (f.h >= s.to - EPS) return 'done';
    },
    text: (s) => `Stig till ${m(s.to)}`,
  },

  hover: {
    init: () => ({ held: 0, best: 0 }),
    update(s, f, _power, dt) {
      const inBand = Math.abs(f.h - s.at) <= s.tol;
      s.held = inBand ? s.held + dt : 0;
      s.best = Math.max(s.best, s.held);
      s.result = { held: s.held };
      if (s.held >= s.holdS - EPS) return 'done';
    },
    text: (s) => `Håll ${m(s.at)} ±${s.tol} m i ${s.holdS} s`,
  },

  land: {
    init: (f) => ({ since: f.t }),
    update(s, f) {
      const td = f.touchdown;
      if (!td || td.t <= s.since) return;
      s.result = { speed: td.speed };
      if (td.speed > s.maxSpeed + EPS) return { fail: `Hård landning: ${ms(td.speed)} (högst ${ms(s.maxSpeed)})` };
      return 'done';
    },
    text: (s) => `Landa mjukt, högst ${ms(s.maxSpeed)}`,
  },

  freefall: {
    init: () => ({ phase: 'armed', low: Infinity, attempts: 0, feedback: null }),
    update(s, f, power) {
      if (s.phase === 'armed') {
        if (power > 0) return;
        if (f.h < s.from - s.tol - EPS) {
          s.feedback = `För lågt för att släppa. Stig till ${m(s.from)}.`;
          return;
        }
        s.phase = 'falling';
        s.low = f.h;
        s.attempts++;
        s.feedback = null;
        return;
      }
      // falling
      s.low = Math.min(s.low, f.h);
      if (f.onGround) return { fail: 'Helikoptern slog i marken' };
      if (power <= 0 || f.v < -CAUGHT_SINK) return;
      // Uppfångad: sjunker knappt längre.
      s.result = { caughtAt: s.low, attempts: s.attempts };
      if (Math.abs(s.low - s.to) <= s.tol + EPS) return 'done';
      s.feedback = `${s.low > s.to ? 'För tidigt' : 'För sent'}: fångad på ${m(s.low)}. Stig till ${m(s.from)} och försök igen.`;
      s.phase = 'armed';
    },
    text: (s) =>
      s.feedback ??
      (s.phase === 'armed'
        ? `Sluta veva och fall mot ${m(s.to)}`
        : `Fånga upp helikoptern på ${m(s.to)} ±${s.tol} m`),
  },
};

export class ExerciseRun {
  /** @param {object} exercise  från EXERCISES */
  constructor(exercise) {
    this.exercise = exercise;
    this.index = -1;
    this.step = null; // aktuellt steg med sitt tillstånd
    this.results = []; // per avklarat steg
    this.status = 'running'; // 'running' | 'passed' | 'failed'
    this.failReason = null;
    this.lastT = null;
  }

  /** Anropas efter varje fysiksteg med flygningen och P_smooth. */
  update(flight, power) {
    if (this.status !== 'running') return;
    const dt = this.lastT === null ? 0 : flight.t - this.lastT;
    this.lastT = flight.t;
    if (!this.step) this.#next(flight);

    // Flera steg kan klaras i samma tidssteg (t.ex. redan på rätt höjd).
    while (this.status === 'running') {
      const out = STEPS[this.step.type].update(this.step, flight, power, dt);
      if (out === 'done') {
        this.results.push({ type: this.step.type, ...this.step.result });
        if (this.index === this.exercise.steps.length - 1) {
          this.#end('passed', null, flight);
        } else {
          this.#next(flight);
          continue;
        }
      } else if (out?.fail) {
        this.#end('failed', out.fail, flight);
      }
      break;
    }
    if (this.status === 'running' && flight.t >= this.exercise.maxS - EPS) this.#end('failed', 'Tiden är ute', flight);
  }

  /** Instruktion eller återkoppling för det aktuella steget. */
  get instruction() {
    if (this.status === 'passed') return 'Godkänd!';
    if (this.status === 'failed') return this.failReason;
    return this.step ? STEPS[this.step.type].text(this.step) : this.exercise.goal;
  }

  #next(flight) {
    this.index++;
    const def = this.exercise.steps[this.index];
    this.step = { ...def, ...STEPS[def.type].init(flight) };
  }

  #end(status, reason, flight) {
    this.status = status;
    this.failReason = reason;
    this.durationS = flight.t;
  }
}

/**
 * Hjälplinjer för det aktuella steget, i världskoordinater (meter):
 *   { kind: 'line', h, label }            målhöjd
 *   { kind: 'band', lo, hi, label, progress? }  zon att hålla sig i eller fånga upp i
 * plus `landingPad` när man ska landa.
 */
export function stepGuides(step) {
  if (!step) return { lines: [], landingPad: false };
  const fmt = (h) => Math.round(h).toLocaleString('sv-SE');
  switch (step.type) {
    case 'climb':
      return { lines: [{ kind: 'line', h: step.to, label: `Mål ${fmt(step.to)} m` }], landingPad: false };
    case 'hover':
      return {
        lines: [
          {
            kind: 'band',
            lo: step.at - step.tol,
            hi: step.at + step.tol,
            label: `Hovra här ${Math.floor(step.held ?? 0)} / ${step.holdS} s`,
            progress: Math.min(1, (step.held ?? 0) / step.holdS),
          },
        ],
        landingPad: false,
      };
    case 'land':
      return { lines: [], landingPad: true };
    case 'freefall': {
      const zone = { kind: 'band', lo: step.to - step.tol, hi: step.to + step.tol, label: 'Fånga upp här' };
      const release = { kind: 'line', h: step.from - step.tol, label: `Släpp över ${fmt(step.from - step.tol)} m` };
      return { lines: step.phase === 'armed' ? [release, zone] : [zone], landingPad: false };
    }
  }
  return { lines: [], landingPad: false };
}

/** Kort sammanfattning av de avklarade stegen, t.ex. "landade i 0,8 m/s". */
export function describeResults(results) {
  const dec = (x) => x.toFixed(1).replace('.', ',');
  return results
    .map((r) =>
      r.type === 'land'
        ? `landade i ${dec(r.speed)} m/s`
        : r.type === 'freefall'
          ? `fångad på ${m(r.caughtAt)}${r.attempts > 1 ? ` (${r.attempts} försök)` : ''}`
          : r.type === 'hover'
            ? `hovrade ${Math.round(r.held)} s`
            : null
    )
    .filter(Boolean)
    .join(' · ');
}
