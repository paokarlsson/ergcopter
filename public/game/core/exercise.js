// Övningsmotorn (plan.md §3). Ren logik utan DOM: en övning är en lista med
// steg som bedöms mot flygningen efter varje fysiksteg. En lektion eller
// uppflygningen (lessons.js) är flera övningar, "moment", i samma flygning.
//
// Steg:
//   { type: 'climb', to, blind? }                     stig till höjden `to`
//   { type: 'hover', at, tol, holdS, total?, blind? } håll dig inom at ± tol i holdS sekunder,
//                                                     i sträck eller sammanlagt (total)
//   { type: 'land', maxSpeed }                        sätt ner med högst maxSpeed m/s
//   { type: 'freefall', from, gate, floor, reps? }    sluta dra ovanför `from`, hämta upp först
//                                                     under `gate` men före `floor`, reps gånger
//   { type: 'winch', at, tol, holdS, load }           hovra medan vinschen går; sedan väger
//                                                     helikoptern `load` (andel av kroppsvikten) mer
//   { type: 'engineout', at, tol, cutAfter, drop, floor }  hovra tills motorn stannar (efter
//                                                     cutAfter [min, max] s i bandet), fall `drop` m,
//                                                     hämta upp före `floor` när motorn går igen
//   { type: 'follow', path, tol, pass }               håll dig i nivå med instruktören: path är
//                                                     [[s, h], …], pass andelen av tiden som krävs
//   { type: 'rings', rings, tol, pass }               flyg genom ringarna: [{ t, h }], minst pass träffar
//
// Hämtning: under `floor` tar instruktören över och bromsar helikoptern, så att
// den aldrig slår i marken. Utan uppflygningens stränga bedömning (strict) blir
// det ett nytt försök i stället för underkänt.

const EPS = 1e-9;
const CAUGHT_SINK = 1; // m/s: sjunker inte fortare än så räknas som uppfången
const SAFETY_SINK = 8; // m/s: faller man så fort under golvet tar instruktören över, även före släppet
const HANDBACK_SHARE = 0.8; // instruktören lämnar tillbaka när man drar minst så här stor del av behovet

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
    id: 'bounce',
    name: 'Studsa',
    goal: 'Lyft till 30 m och sätt ner mjukt – tre gånger',
    maxS: 300,
    steps: [1, 2, 3].flatMap(() => [
      { type: 'climb', to: 30 },
      { type: 'land', maxSpeed: 2 },
    ]),
  },
  {
    id: 'hover',
    name: 'Hovring',
    goal: 'Håll dig på 300 m ±25 m i 30 s',
    maxS: 240,
    steps: [{ type: 'hover', at: 300, tol: 25, holdS: 30 }],
  },
  {
    id: 'stairs',
    name: 'Trappan',
    goal: 'Hovra 12 s på varje trappsteg: 100, 200, 300 och 400 m',
    maxS: 420,
    steps: [100, 200, 300, 400].map((at) => ({ type: 'hover', at, tol: 20, holdS: 12 })),
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
    goal: 'Stig till 1 000 m och sluta dra. Hämta upp först under 650 m – men före 450 m',
    maxS: 480,
    steps: [
      { type: 'climb', to: 1000 },
      { type: 'freefall', from: 1000, gate: 650, floor: 450 },
    ],
  },
  {
    id: 'elevator',
    name: 'Hissen',
    goal: 'Tre fall i rad: släpp på 700 m och hämta upp mellan 500 och 330 m',
    maxS: 600,
    steps: [
      { type: 'climb', to: 700 },
      { type: 'freefall', from: 700, gate: 500, floor: 330, reps: 3 },
    ],
  },
  {
    id: 'late-catch',
    name: 'Sen hämtning',
    goal: 'Släpp på 800 m och vänta ända ned till 400 m. Hämta upp före 280 m – ta i!',
    maxS: 480,
    steps: [
      { type: 'climb', to: 800 },
      { type: 'freefall', from: 800, gate: 400, floor: 280 },
    ],
  },
  {
    id: 'sandbag',
    name: 'Sandsäcken',
    goal: 'Hovra på 150 m medan vinschen hämtar sandsäcken, landa sedan mjukt med lasten',
    maxS: 360,
    steps: [
      { type: 'winch', at: 150, tol: 20, holdS: 15, load: 0.2 },
      { type: 'land', maxSpeed: 2 },
    ],
  },
  {
    id: 'engine',
    name: 'Motorstopp',
    goal: 'Hovra på 400 m. När motorn stannar faller du – hämta upp när den startar igen',
    maxS: 360,
    steps: [{ type: 'engineout', at: 400, tol: 30, cutAfter: [4, 12], drop: 100, floor: 180 }],
  },
  {
    id: 'follow',
    name: 'Följ instruktören',
    goal: 'Instruktören flyger bredvid dig. Håll dig i nivå med hen i 80 s',
    maxS: 300,
    steps: [
      { type: 'hover', at: 150, tol: 25, holdS: 3, unscored: true },
      {
        type: 'follow',
        tol: 25,
        pass: 0.6,
        path: [[0, 150], [8, 150], [20, 250], [30, 250], [40, 180], [50, 180], [62, 320], [72, 320], [80, 220]],
      },
    ],
  },
  {
    id: 'clouds',
    name: 'Molnflygning',
    goal: 'I molnet syns ingenting. Stig till 350 m och håll höjden i 30 s med bara höjdmätaren',
    maxS: 360,
    steps: [
      { type: 'climb', to: 350, blind: true },
      { type: 'hover', at: 350, tol: 30, holdS: 30, blind: true },
    ],
  },
  {
    id: 'patrol',
    name: 'Patrull',
    goal: 'Håll dig mellan 400 och 500 m i sammanlagt 2 minuter',
    maxS: 480,
    steps: [
      { type: 'climb', to: 400 },
      { type: 'hover', at: 450, tol: 50, holdS: 120, total: true },
    ],
  },
  {
    id: 'rings',
    name: 'Ringbanan',
    goal: 'Flyg genom ringarna – minst 7 av 10',
    maxS: 300,
    steps: [
      { type: 'hover', at: 130, tol: 30, holdS: 3, unscored: true },
      {
        type: 'rings',
        tol: 30,
        pass: 7,
        rings: [
          [8, 130], [16, 170], [24, 140], [32, 200], [40, 250], [48, 210], [56, 160], [64, 220], [72, 180], [80, 130],
        ].map(([t, h]) => ({ t, h })),
      },
    ],
  },
];

export function getExercise(id) {
  const ex = EXERCISES.find((e) => e.id === id);
  if (!ex) throw new Error(`Okänd övning: ${id}`);
  return ex;
}

const m = (h) => `${Math.round(h).toLocaleString('sv-SE')} m`;
const dec = (x) => x.toFixed(1).replace('.', ',');
const ms = (v) => `${dec(v)} m/s`;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Stjärnor 1–3 från en kvalitet där lägre är bättre (t.ex. landningsfart / gräns). */
const starsLow = (x, three, two) => (x <= three + EPS ? 3 : x <= two + EPS ? 2 : 1);

// Gränserna för tre och två stjärnor; en stjärna är godkänt. Samma värden i bedömningen och i starGuide.
const STARS = {
  hover: [0.3, 0.55], // medelavvikelse som andel av bandet (även vinschen)
  land: [0.3, 0.6], // sättningsfart som andel av gränsen
  catch: [0.35, 0.65], // djup under hämtgränsen som andel av utrymmet ned till golvet
  follow: [0.9, 0.75], // andel av tiden i nivå med instruktören (högre är bättre)
};

/** Ett försök att hämta upp: från hämtgränsen tills helikoptern inte längre sjunker. */
function catchResult(s, f) {
  return { low: s.low, depth: s.gate - s.low, catchS: f.t - s.gateT, window: s.gate - s.floor };
}

/** Stjärnor för hämtningar: hur djupt under gränsen, som andel av utrymmet ned till golvet. */
function catchStars(catches) {
  const share = catches.reduce((a, c) => a + c.depth / c.window, 0) / catches.length;
  return { stars: starsLow(share, ...STARS.catch), score: -share };
}

/**
 * Varje stegtyp: init, update (→ 'done' | { fail } | undefined) och text.
 * update(s, f, power, dt, ctx): power är spelarens motoreffekt (senaste dragets), ctx ger
 * slump, takeover() och om instruktören har kontrollen (inTakeover).
 */
const STEPS = {
  climb: {
    init: () => ({}),
    update(s, f) {
      if (f.h >= s.to - EPS) return 'done';
    },
    text: (s) => `Stig till ${m(s.to)}`,
  },

  hover: {
    init: () => ({ held: 0, dev: 0 }),
    update(s, f, _power, dt) {
      const inBand = Math.abs(f.h - s.at) <= s.tol;
      if (inBand) {
        s.held += dt;
        s.dev += Math.abs(f.h - s.at) * dt;
      } else if (!s.total) {
        s.held = 0;
        s.dev = 0;
      }
      if (s.held >= s.holdS - EPS) {
        const share = s.dev / Math.max(EPS, s.held) / s.tol; // medelavvikelse som andel av bandet
        s.result = { held: s.held, avgDev: s.dev / Math.max(EPS, s.held), stars: starsLow(share, ...STARS.hover), score: -share };
        return 'done';
      }
    },
    text: (s) =>
      s.total
        ? `Håll dig mellan ${m(s.at - s.tol)} och ${m(s.at + s.tol)}: ${Math.floor(s.held)} av ${s.holdS} s`
        : `Håll ${m(s.at)} ±${s.tol} m i ${s.holdS} s`,
  },

  land: {
    init: (f) => ({ since: f.t }),
    update(s, f) {
      const td = f.touchdown;
      if (!td || td.t <= s.since) return;
      if (td.speed > s.maxSpeed + EPS) return { fail: `Hård landning: ${ms(td.speed)} (högst ${ms(s.maxSpeed)})` };
      s.result = { speed: td.speed, stars: starsLow(td.speed / s.maxSpeed, ...STARS.land), score: -td.speed / s.maxSpeed };
      return 'done';
    },
    text: (s) => `Landa mjukt, högst ${ms(s.maxSpeed)}`,
  },

  freefall: {
    init: () => ({ phase: 'armed', low: Infinity, gateT: null, attempts: 0, catches: [], feedback: null }),
    update(s, f, power, _dt, ctx) {
      const reps = s.reps ?? 1;
      if (s.phase === 'takeover') {
        if (ctx.inTakeover) return;
        if (ctx.strict) return { fail: 'För sent – instruktören fick ta över' };
        s.phase = 'armed';
        s.feedback = `För sent – instruktören tog över. Stig till ${m(s.from)} och släpp igen.`;
        return;
      }
      if (s.phase === 'armed') {
        // Säkerhet: faller man ändå under golvet (t.ex. släppte för lågt) tar instruktören över.
        if (f.h < s.floor && f.v < -SAFETY_SINK) {
          ctx.takeover();
          s.phase = 'takeover';
          return;
        }
        if (power > 0) return;
        if (f.h < s.from - EPS) {
          s.feedback = `För lågt för att släppa. Stig till ${m(s.from)}.`;
          return;
        }
        s.phase = 'falling';
        s.low = f.h;
        s.gateT = null;
        s.attempts++;
        s.feedback = null;
        return;
      }
      // falling
      s.low = Math.min(s.low, f.h);
      if (s.gateT === null && f.h <= s.gate + EPS) s.gateT = f.t;
      if (power > 0 && s.gateT === null) {
        if (ctx.strict) return { fail: `För tidigt: du drog innan ${m(s.gate)}` };
        s.phase = 'armed';
        s.feedback = `För tidigt! Hämta upp först under ${m(s.gate)}. Stig till ${m(s.from)} och släpp igen.`;
        return;
      }
      if (f.h < s.floor) {
        ctx.takeover();
        s.phase = 'takeover';
        return;
      }
      if (s.gateT === null || power <= 0 || f.v < -CAUGHT_SINK) return;
      // Uppfången: sjunker knappt längre.
      const c = catchResult(s, f);
      s.catches.push(c);
      if (s.catches.length >= reps) {
        const avg = (k) => s.catches.reduce((a, x) => a + x[k], 0) / s.catches.length;
        s.result = { caughtAt: c.low, depth: avg('depth'), catchS: avg('catchS'), reps, attempts: s.attempts, ...catchStars(s.catches) };
        return 'done';
      }
      s.phase = 'armed';
      s.feedback = `Hämtad på ${dec(c.catchS)} s, ${m(c.depth)} under gränsen. Stig till ${m(s.from)} igen – ${reps - s.catches.length} kvar.`;
    },
    text(s) {
      const prefix = (s.reps ?? 1) > 1 ? `Fall ${Math.min(s.catches.length + 1, s.reps)} av ${s.reps}: ` : '';
      if (s.phase === 'takeover') return 'Instruktören tar över – dra för att ta tillbaka';
      if (s.feedback) return s.feedback;
      if (s.phase === 'armed') return `${prefix}Stig till ${m(s.from)} och sluta dra`;
      if (s.gateT === null) return `${prefix}Vänta – hämta upp först under ${m(s.gate)}`;
      return `${prefix}Hämta upp nu – före ${m(s.floor)}!`;
    },
  },

  winch: {
    init: () => ({ held: 0, dev: 0 }),
    update(s, f, _power, dt, ctx) {
      // Vinschen står still när man lämnar bandet, men börjar inte om.
      if (Math.abs(f.h - s.at) <= s.tol) {
        s.held += dt;
        s.dev += Math.abs(f.h - s.at) * dt;
      }
      if (s.held < s.holdS - EPS) return;
      f.setLoad?.(s.load);
      ctx.event({ type: 'loaded' });
      const share = s.dev / Math.max(EPS, s.held) / s.tol;
      s.result = { held: s.held, stars: starsLow(share, ...STARS.hover), score: -share };
      return 'done';
    },
    text: (s) =>
      Math.abs(s.held) < EPS ? `Hovra på ${m(s.at)} ±${s.tol} m – då går vinschen` : `Vinschen går: ${Math.floor(s.held)} av ${s.holdS} s`,
  },

  engineout: {
    init: (_f, ctx, def) => ({ phase: 'hover', held: 0, cutAt: cutTime(ctx.rand, def), attempts: 0, feedback: null }),
    update(s, f, power, dt, ctx) {
      const restartH = s.at - s.drop;
      if (s.phase === 'takeover') {
        if (ctx.inTakeover) return;
        if (ctx.strict) return { fail: 'För sent – instruktören fick ta över' };
        Object.assign(s, { phase: 'hover', held: 0, cutAt: cutTime(ctx.rand, s) });
        s.feedback = `För sent – instruktören tog över. Flyg tillbaka till ${m(s.at)}, så kommer ett nytt motorstopp.`;
        return;
      }
      if (s.phase === 'hover') {
        if (Math.abs(f.h - s.at) <= s.tol) s.held += dt;
        if (s.held < s.cutAt) return;
        s.phase = 'cut';
        s.attempts++;
        s.feedback = null;
        ctx.event({ type: 'engineCut' });
        return;
      }
      if (s.phase === 'cut') {
        if (f.h > restartH) return;
        s.phase = 'restart';
        s.gate = restartH;
        s.gateT = f.t;
        s.low = f.h;
        ctx.event({ type: 'engineRestart' });
        return;
      }
      // restart
      s.low = Math.min(s.low, f.h);
      if (f.h < s.floor) {
        ctx.takeover();
        s.phase = 'takeover';
        return;
      }
      if (power <= 0 || f.v < -CAUGHT_SINK) return;
      const c = catchResult(s, f);
      s.result = { caughtAt: c.low, depth: c.depth, catchS: c.catchS, attempts: s.attempts, ...catchStars([c]) };
      return 'done';
    },
    text(s) {
      if (s.phase === 'takeover') return 'Instruktören tar över – dra för att ta tillbaka';
      if (s.phase === 'cut') return 'MOTORSTOPP! Motorn startar om strax…';
      if (s.phase === 'restart') return `Motorn går igen – hämta upp före ${m(s.floor)}!`;
      return s.feedback ?? `Håll ${m(s.at)} ±${s.tol} m och var beredd`;
    },
  },

  follow: {
    init: (f) => ({ t0: f.t, inBand: 0, elapsed: 0 }),
    update(s, f, _power, dt) {
      s.elapsed = f.t - s.t0;
      // Det första tidssteget hör till steget före, så att andelen aldrig blir över 100 %.
      if (s.elapsed > EPS && Math.abs(f.h - pathHeight(s.path, s.elapsed)) <= s.tol) s.inBand += dt;
      const duration = s.path.at(-1)[0];
      if (s.elapsed < duration - EPS) return;
      const share = s.inBand / duration;
      if (share < s.pass - EPS) return { fail: `I nivå med instruktören ${pct(share)} av tiden (minst ${pct(s.pass)})` };
      const [three, two] = STARS.follow;
      s.result = { share, stars: share >= three - EPS ? 3 : share >= two - EPS ? 2 : 1, score: share };
      return 'done';
    },
    text: (s) => `Håll dig i nivå med instruktören: ${pct(s.inBand / Math.max(EPS, s.elapsed))} hittills`,
  },

  rings: {
    init: (f) => ({ t0: f.t, outcomes: [] }), // träff eller miss per passerad ring
    update(s, f) {
      const i = s.outcomes.length;
      if (i < s.rings.length && f.t - s.t0 >= s.rings[i].t - EPS) s.outcomes.push(Math.abs(f.h - s.rings[i].h) <= s.tol);
      if (s.outcomes.length < s.rings.length) return;
      const hits = s.outcomes.filter(Boolean).length;
      if (hits < s.pass) return { fail: `${hits} av ${s.rings.length} ringar (minst ${s.pass})` };
      s.result = { hits, total: s.rings.length, stars: hits === s.rings.length ? 3 : hits >= s.rings.length - 2 ? 2 : 1, score: hits };
      return 'done';
    },
    text: (s) => `Ringar: ${s.outcomes.filter(Boolean).length} träffar av ${s.outcomes.length} – ${s.rings.length - s.outcomes.length} kvar`,
  },
};

/** När motorn stannar: sekunder i bandet, slumpat inom cutAfter. */
function cutTime(rand, def) {
  const [lo, hi] = def.cutAfter;
  return lo + (hi - lo) * rand();
}

/** Instruktörens höjd efter `t` sekunder: mjuka övergångar mellan punkterna i path. */
export function pathHeight(path, t) {
  if (t <= path[0][0]) return path[0][1];
  for (let i = 1; i < path.length; i++) {
    const [t1, h1] = path[i];
    const [t0, h0] = path[i - 1];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return h0 + (h1 - h0) * u * u * (3 - 2 * u);
    }
  }
  return path.at(-1)[1];
}

const pct = (x) => `${Math.round(x * 100)} %`;

/**
 * Gör en övning, lektion eller uppflygning till ett program med moment.
 * En övning är ett moment; en lektion listar övningarnas id; uppflygningen har egna moment.
 */
export function programOf(item) {
  if (item.steps) return { ...item, kind: 'exercise', moments: [item] };
  const moments = item.moments.map((x) => (typeof x === 'string' ? getExercise(x) : x));
  return { ...item, kind: item.kind ?? 'lesson', moments };
}

export class ExerciseRun {
  /**
   * @param {object} item  en övning (EXERCISES), lektion eller uppflygningen (lessons.js)
   * @param {{ rand?: () => number }} [opts]  slump, t.ex. när motorn stannar (fast i tester)
   */
  constructor(item, { rand = Math.random } = {}) {
    this.program = programOf(item);
    this.exercise = item; // det valda, för namn och mål
    this.strict = this.program.kind === 'exam';
    this.rand = rand;
    this.momentIndex = 0;
    this.momentStartT = 0;
    this.index = -1; // steg i momentet
    this.step = null; // aktuellt steg med sitt tillstånd
    this.results = []; // per avklarat steg i momentet
    this.moments = []; // per avslutat moment: { id, name, status, failReason, results, stars, score, durationS }
    this.status = 'running'; // 'running' | 'passed' | 'failed'
    this.failReason = null;
    this.takeover = false; // instruktören har kontrollen
    this.events = []; // för spelet: engineCut, engineRestart, loaded, takeover, handback, moment
    this.lastT = null;
    const run = this;
    this.ctx = {
      rand: () => run.rand(),
      strict: this.strict,
      takeover() {
        if (!run.takeover) run.event({ type: 'takeover' });
        run.takeover = true;
      },
      event: (e) => run.event(e),
      get inTakeover() {
        return run.takeover;
      },
    };
  }

  get moment() {
    return this.program.moments[this.momentIndex];
  }

  event(e) {
    this.events.push(e);
  }

  /** Händelser sedan förra anropet. */
  takeEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Motorn står still (motorstopp): ingen effekt, och drag räknas inte. */
  get engineOff() {
    return this.status === 'running' && this.step?.type === 'engineout' && this.step.phase === 'cut';
  }

  /**
   * Effekten som fysiken får: noll vid motorstopp, och minst instruktörens när hen
   * har tagit över (bromsar kraftigt, håller sedan höjden tills spelaren drar själv).
   */
  effectivePower(power, f) {
    if (this.engineOff) return 0;
    if (!this.takeover) return power;
    const req = f.requiredPower();
    return Math.max(power, f.v < 0 ? req + f.P0 : req);
  }

  /** Anropas efter varje fysiksteg med flygningen och spelarens motoreffekt. */
  update(flight, power) {
    if (this.status !== 'running') return;
    const dt = this.lastT === null ? 0 : flight.t - this.lastT;
    this.lastT = flight.t;
    if (this.takeover && flight.v >= -0.5 && power >= HANDBACK_SHARE * flight.requiredPower()) {
      this.takeover = false;
      this.event({ type: 'handback' });
    }
    if (!this.step) this.#next(flight);

    // Flera steg kan klaras i samma tidssteg (t.ex. redan på rätt höjd).
    while (this.status === 'running') {
      const out = STEPS[this.step.type].update(this.step, flight, power, dt, this.ctx);
      if (out === 'done') {
        this.results.push({ type: this.step.type, unscored: this.step.unscored, ...this.step.result });
        if (this.index === this.moment.steps.length - 1) this.#endMoment('passed', null, flight);
        else this.#next(flight);
        continue;
      } else if (out?.fail) {
        this.#endMoment('failed', out.fail, flight);
        continue;
      }
      break;
    }
    if (this.status === 'running' && flight.t - this.momentStartT >= this.moment.maxS - EPS) {
      this.#endMoment('failed', 'Tiden är ute', flight);
    }
  }

  /** Instruktion eller återkoppling för det aktuella steget. */
  get instruction() {
    if (this.status === 'passed') return this.program.kind === 'exercise' ? 'Godkänd!' : 'Klart!';
    if (this.status === 'failed') return this.failReason;
    return this.step ? STEPS[this.step.type].text(this.step) : this.moment.goal;
  }

  /** Senast avslutade moment, t.ex. för instruktörens kommentar. */
  get lastMoment() {
    return this.moments.at(-1) ?? null;
  }

  #next(flight) {
    this.index++;
    const def = this.moment.steps[this.index];
    this.step = { ...def, ...STEPS[def.type].init(flight, this.ctx, def) };
  }

  #endMoment(status, reason, flight) {
    if (flight.load) flight.setLoad(0); // lasten lämnas av mellan momenten
    const scored = this.results.filter((r) => r.stars && !r.unscored);
    const done = {
      id: this.moment.id,
      name: this.moment.name,
      status,
      failReason: reason,
      results: this.results,
      stars: status === 'passed' ? Math.min(3, ...scored.map((r) => r.stars)) : 0,
      score: scored.reduce((a, r) => a + r.score, 0),
      durationS: flight.t - this.momentStartT,
      endT: flight.t,
    };
    this.moments.push(done);
    this.event({ type: 'moment', moment: done });

    const last = this.momentIndex === this.program.moments.length - 1;
    // En enskild övning slutar vid första felet; lektioner och uppflygningen fortsätter.
    if (this.program.kind === 'exercise' || last) {
      const failed = this.moments.filter((x) => x.status === 'failed');
      const passed = this.program.kind === 'lesson' || failed.length === 0;
      this.status = passed ? 'passed' : 'failed';
      this.failReason = passed ? null : failed[0].failReason;
      this.durationS = flight.t;
      return;
    }
    this.momentIndex++;
    this.momentStartT = flight.t;
    this.index = -1;
    this.results = [];
    this.#next(flight);
  }
}

/**
 * Hjälplinjer för det aktuella steget, i världskoordinater (meter):
 *   { kind: 'line', h, label }                         målhöjd
 *   { kind: 'band', lo, hi, label, progress?, ring? }  zon att hålla sig i eller hämta upp i; ring = hovra i ringen
 *   { kind: 'buddy', h, lo, hi }                       instruktörens helikopter med bandet runt
 *   { kind: 'ring', h, tol, inS, hit? }                ring som når helikoptern om inS sekunder
 * plus `landingPad` när man ska landa och `blind` i moln (inga linjer syns).
 * @param {object|null} step
 * @param {number} [t]  flygningens tid, för steg som rör sig
 */
export function stepGuides(step, t = 0) {
  const none = { lines: [], landingPad: false, blind: false };
  if (!step) return none;
  if (step.blind) return { ...none, blind: true };
  const fmt = (h) => Math.round(h).toLocaleString('sv-SE');
  switch (step.type) {
    case 'climb':
      return { ...none, lines: [{ kind: 'line', h: step.to, label: `Mål ${fmt(step.to)} m` }] };
    case 'hover':
    case 'winch': {
      const label = step.type === 'winch' ? 'Vinschen går' : step.total ? 'Håll dig här' : 'Hovra här';
      return {
        ...none,
        lines: [
          {
            kind: 'band',
            lo: step.at - step.tol,
            hi: step.at + step.tol,
            label: `${label} ${Math.floor(step.held ?? 0)} / ${step.holdS} s`,
            progress: Math.min(1, (step.held ?? 0) / step.holdS),
            ring: true,
          },
        ],
      };
    }
    case 'land':
      return { ...none, landingPad: true };
    case 'freefall': {
      const zone = { kind: 'band', lo: step.floor, hi: step.gate, label: `Hämta upp här – under ${fmt(step.gate)} m` };
      const release = { kind: 'line', h: step.from, label: `Sluta dra över ${fmt(step.from)} m` };
      return { ...none, lines: step.phase === 'armed' ? [release, zone] : [zone] };
    }
    case 'engineout': {
      if (step.phase === 'hover') {
        return { ...none, lines: [{ kind: 'band', lo: step.at - step.tol, hi: step.at + step.tol, label: 'Hovra här', ring: true }] };
      }
      const zone = { kind: 'band', lo: step.floor, hi: step.at - step.drop, label: `Hämta upp här – före ${fmt(step.floor)} m` };
      return { ...none, lines: [zone] };
    }
    case 'follow': {
      const h = pathHeight(step.path, t - (step.t0 ?? t));
      return { ...none, lines: [{ kind: 'buddy', h, lo: h - step.tol, hi: h + step.tol }] };
    }
    case 'rings': {
      const t0 = step.t0 ?? t;
      const lines = step.rings.map((r, i) => ({ kind: 'ring', h: r.h, tol: step.tol, inS: t0 + r.t - t, hit: step.outcomes?.[i] }));
      return { ...none, lines };
    }
  }
  return none;
}

/** Kort sammanfattning av de avklarade stegen, t.ex. "landade i 0,8 m/s". */
export function describeResults(results) {
  return results
    .filter((r) => !r.unscored)
    .map((r) => {
      switch (r.type) {
        case 'land':
          return `landade i ${ms(r.speed)}`;
        case 'freefall':
        case 'engineout':
          return `hämtad på ${dec(r.catchS)} s, ${m(r.depth)} under gränsen${r.attempts > (r.reps ?? 1) ? ` (${r.attempts} försök)` : ''}`;
        case 'hover':
          return `hovrade ${Math.round(r.held)} s, i snitt ${m(r.avgDev)} från målet`;
        case 'winch':
          return 'sandsäcken ombord';
        case 'follow':
          return `i nivå ${pct(r.share)} av tiden`;
        case 'rings':
          return `${r.hits} av ${r.total} ringar`;
      }
      return null;
    })
    .filter(Boolean)
    .join(' · ');
}

/**
 * Vad som krävs för tre, två och en stjärna i ett steg, för panelen under flygningen.
 * @returns {{ stars: number, text: string }[]|null}  tre stjärnor först; null om steget inte ger stjärnor
 */
export function starGuide(step) {
  if (!step || step.unscored) return null;
  const lines = (three, two, one) => [
    { stars: 3, text: three },
    { stars: 2, text: two },
    { stars: 1, text: one },
  ];
  const near = (h) => {
    const r = Math.round(h * 10) / 10;
    return `${Number.isInteger(r) ? r : dec(r)} m`;
  };
  switch (step.type) {
    case 'hover':
    case 'winch': {
      const [three, two] = STARS.hover;
      return lines(`i snitt inom ${near(three * step.tol)} från målet`, `i snitt inom ${near(two * step.tol)}`, `inom ±${m(step.tol)}`);
    }
    case 'land': {
      const [three, two] = STARS.land;
      return lines(`sätt ner under ${ms(three * step.maxSpeed)}`, `under ${ms(two * step.maxSpeed)}`, `under ${ms(step.maxSpeed)}`);
    }
    case 'freefall':
    case 'engineout': {
      const gate = step.type === 'freefall' ? step.gate : step.at - step.drop;
      const room = gate - step.floor;
      const [three, two] = STARS.catch;
      return lines(`vänd inom ${m(three * room)} under gränsen`, `inom ${m(two * room)}`, `före ${m(step.floor)}`);
    }
    case 'follow': {
      const [three, two] = STARS.follow;
      return lines(`i nivå ${pct(three)} av tiden`, `${pct(two)} av tiden`, `${pct(step.pass)} av tiden`);
    }
    case 'rings': {
      const n = step.rings.length;
      return lines(`alla ${n} ringar`, `${n - 2} ringar`, `${step.pass} ringar`);
    }
  }
  return null;
}

/** "★★☆" för 0–3 stjärnor. */
export function starText(stars) {
  return '★'.repeat(stars) + '☆'.repeat(3 - stars);
}
