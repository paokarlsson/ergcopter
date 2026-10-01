// Spelflödet (spec §7, plan.md §8):
//   IDLE → SETUP → MENU → READY → COUNTDOWN → FLYING → FINISHED → IDLE
// På startskärmen väljer man läge: "så högt som möjligt" (free) går från SETUP direkt
// till READY, Fjällräddaren (career) till MENU. Där väljer deltagaren en övning, lektion,
// uppflygningen (lessons.js) eller fri flygning. Efter en övning går FINISHED tillbaka
// till MENU, så att man kan fortsätta öva. "Flyg igen" går från FINISHED till READY.
// Den som står på ergen behöver inte röra skärmen: ett drag i MENU startar det
// föreslagna valet, och ett drag efter en övnings resultat går tillbaka till MENU.
// Ren logik utan DOM. Tiden kommer utifrån via tick(t) i sekunder.

import { Flight } from './physics.js';
import { Engine } from './engine.js';
import { MIN_MASS, MAX_MASS, MIN_AGE, MAX_AGE, CLASSES, classForAge } from './config.js';
import { ExerciseRun } from './exercise.js';
import { getHelicopter, helicopterConfig } from './helicopters.js';
import { FlightLog } from './flightlog.js';

export const STATES = ['IDLE', 'SETUP', 'MENU', 'READY', 'COUNTDOWN', 'FLYING', 'FINISHED'];

/** Så länge efter att menyn eller ett övningsresultat visats räknas inga drag, så att man hinner läsa. */
export const STROKE_GRACE_S = 3;

/** Helikoptern som övningarna flygs med. */
export const EXERCISE_HELICOPTER = 'school';
/** Namnet när deltagaren inte anger något. */
export const ANONYMOUS_NAME = 'Anonym';
const MAX_TICK_S = 2; // längre glapp (t.ex. datorn sov) räknas inte som speltid

export class Game {
  /** @param {{ rand?: () => number }} [opts]  slump till övningarna (t.ex. motorstopp), fast i tester */
  constructor(cfg, { rand = Math.random } = {}) {
    this.cfg = cfg;
    this.rand = rand;
    this.state = 'IDLE';
    this.mode = 'career'; // 'free' = så högt som möjligt, 'career' = Fjällräddaren med menyn
    this.player = null; // { name, anonymous, mass, klass }
    this.exercise = null; // vald övning, lektion eller uppflygning, null = fri flygning
    this.helicopter = null; // helikoptertyp, null = standard
    this.ownHelicopter = null; // deltagarens egen helikopter i fri flygning (efter uppflygningen)
    this.run = null; // ExerciseRun under en övning
    this.suggested = null; // förslaget i menyn som ett drag startar, null = fri flygning
    this.menuFor = 0; // s i MENU
    this.flight = null;
    this.log = null; // flygloggen för senaste flygningen (flightlog.js)
    this.engine = new Engine(cfg);
    this.paused = false;
    this.lastT = null;
    this.acc = 0;
    this.countdownLeft = 0;
    this.result = null;
    this.finishedFor = 0;
    this.listeners = {};
  }

  on(type, cb) {
    (this.listeners[type] ??= []).push(cb);
  }

  #emit(type, payload) {
    for (const cb of this.listeners[type] ?? []) cb(payload);
  }

  #set(state) {
    const from = this.state;
    this.state = state;
    if (state === 'MENU') this.menuFor = 0;
    this.#emit('state', { from, to: state });
  }

  /** Nya inställningar (från panelen). Gäller från nästa pass. */
  setConfig(cfg) {
    this.cfg = cfg;
    this.engine.cfg = cfg;
  }

  // --- Operatörens åtgärder -------------------------------------------------

  /** @param {'free'|'career'} [mode]  så högt som möjligt eller Fjällräddaren */
  openSetup(mode = 'career') {
    if (this.state !== 'IDLE' && this.state !== 'FINISHED') return;
    this.mode = mode;
    this.#set('SETUP');
  }

  /**
   * Fri flygning går direkt till READY, Fjällräddaren till menyn.
   * @param {{ name: string, mass: number, age?: number|string, klass?: string }} setup
   *   namnet är valfritt; åldern ger klassen och sparas inte. Utan ålder anges klassen: 'Barn' | 'Ungdom' | 'Vuxen'.
   * @returns {string|null} felmeddelande, eller null om det gick bra
   */
  submitSetup({ name, mass, age, klass = '' }) {
    if (this.state !== 'SETUP') return 'Fel läge';
    const trimmed = String(name ?? '').trim();
    if (age !== undefined) {
      const years = String(age).trim() === '' ? NaN : Number(age);
      if (!Number.isInteger(years) || years < MIN_AGE || years > MAX_AGE) return `Åldern ska vara ett heltal ${MIN_AGE}–${MAX_AGE} år`;
      klass = classForAge(years);
    }
    const kg = Number(mass);
    if (!Number.isInteger(kg) || kg < MIN_MASS || kg > MAX_MASS) return `Vikten ska vara ett heltal ${MIN_MASS}–${MAX_MASS} kg`;
    if (!CLASSES.some((c) => c.name === klass)) return 'Välj klass';
    this.player = { name: trimmed.slice(0, 40) || ANONYMOUS_NAME, anonymous: !trimmed, mass: kg, klass };
    if (this.mode === 'free') {
      this.exercise = null;
      this.helicopter = this.ownHelicopter;
      this.#set('READY');
    } else this.#set('MENU');
    return null;
  }

  /** Förslaget i menyn (t.ex. nästa ej godkända övning), null = fri flygning. */
  suggest(exercise) {
    this.suggested = exercise ?? null;
  }

  /** Helikoptern deltagaren flyger fri flygning med, null = standard. */
  setOwnHelicopter(heli) {
    this.ownHelicopter = heli ?? null;
  }

  /**
   * Val i menyn: en övning (EXERCISES), lektion eller uppflygningen (lessons.js),
   * eller null för fri flygning. Skolan flygs med skolhelikoptern.
   */
  choose(exercise) {
    if (this.state !== 'MENU') return;
    this.exercise = exercise ?? null;
    this.helicopter = exercise ? getHelicopter(EXERCISE_HELICOPTER) : this.ownHelicopter;
    this.#set('READY');
  }

  /** Enter i READY, eller första draget. */
  startCountdown() {
    if (this.state !== 'READY') return;
    this.countdownLeft = this.cfg.countdownS;
    this.#set('COUNTDOWN');
    if (this.countdownLeft <= 0) this.#takeOff();
  }

  /** Esc: avbryter passet (sparas), backar från READY till menyn (Fjällräddaren) eller till IDLE. */
  escape() {
    if (this.state === 'FLYING') this.#finish('operator');
    else if ((this.state === 'READY' || this.state === 'COUNTDOWN') && this.mode === 'career') this.#toMenu();
    else if (this.state !== 'IDLE') this.#toIdle();
  }

  /** Tangent eller klick i resultatvisningen. */
  dismissResult() {
    if (this.state === 'FINISHED') this.#afterResult();
  }

  /** "Flyg igen": samma deltagare, val och helikopter, direkt till READY. */
  again() {
    if (this.state !== 'FINISHED') return;
    this.flight = null;
    this.run = null;
    this.result = null;
    this.#set('READY');
  }

  setPaused(paused) {
    if (paused !== this.paused && this.state === 'FLYING') this.log.pause(this.flight.t, paused);
    this.paused = paused;
  }

  // --- Data -------------------------------------------------------------------

  /** @param {{t:number, power:number, strokeCount:number}} stroke */
  stroke(stroke) {
    if (this.state === 'MENU') {
      // Dra för att starta förslaget, direkt till nedräkningen.
      if (this.menuFor < STROKE_GRACE_S) return;
      this.choose(this.suggested);
      this.startCountdown();
      return;
    }
    if (this.state === 'FINISHED') {
      // Efter en övning: dra för att gå tillbaka till menyn.
      if (this.exercise && this.finishedFor >= STROKE_GRACE_S) this.#toMenu();
      return;
    }
    if (this.state === 'READY') {
      this.startCountdown();
      return;
    }
    if (this.state !== 'FLYING') return; // drag under nedräkningen ignoreras
    // Speltiden (flight.t) används så att paus och bakgrundsflik inte påverkar.
    const s = { ...stroke, t: this.flight.t };
    let note = 'ok';
    if (this.paused) note = 'paus';
    else if (this.run?.engineOff) note = 'motorstopp'; // dragen gör ingenting
    else if (this.engine.stroke(s)) this.lastStrokeT = s.t;
    else note = 'dubblett';
    this.log.stroke(s, this.flight, note);
  }

  /** Kraftsampel (N) från ergen, till flygloggen. */
  forceSamples(samples) {
    if (this.state === 'FLYING' && !this.paused) this.log.force(this.flight.t + this.acc, samples);
  }

  /** Motoreffekten just nu (0 utanför FLYING): senaste dragets, eller 0 vid motorstopp och minst instruktörens när hen tagit över. */
  get power() {
    if (this.state !== 'FLYING') return 0;
    const power = this.engine.power(this.flight.t);
    return this.run ? this.run.effectivePower(power, this.flight) : power;
  }

  // --- Tid ----------------------------------------------------------------------

  tick(t) {
    const dt = this.lastT === null ? 0 : Math.min(MAX_TICK_S, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (this.paused) return;

    if (this.state === 'COUNTDOWN') {
      this.countdownLeft -= dt;
      if (this.countdownLeft <= 0) this.#takeOff();
    } else if (this.state === 'FLYING') {
      this.acc += dt;
      while (this.acc >= this.cfg.dt && this.state === 'FLYING') {
        this.acc -= this.cfg.dt;
        this.#physicsStep();
      }
    } else if (this.state === 'MENU') {
      this.menuFor += dt;
    } else if (this.state === 'FINISHED') {
      this.finishedFor += dt;
      // Certifikatet efter en godkänd uppflygning får synas längre.
      const ex = this.result?.exercise;
      const hold = ex?.kind === 'exam' && ex.status === 'passed' ? 3 : 1;
      if (this.finishedFor >= this.cfg.resultDisplayS * hold) this.#afterResult();
    }
  }

  /** Andel av nästa fysiksteg som hunnit gå (för interpolering i renderingen). */
  get alpha() {
    return this.state === 'FLYING' ? this.acc / this.cfg.dt : 0;
  }

  /** Konfigurationen för passet, med helikopterns parametrar ovanpå. */
  get flightConfig() {
    return this.helicopter ? helicopterConfig(this.cfg, this.helicopter) : this.cfg;
  }

  #takeOff() {
    this.flight = new Flight(this.flightConfig, this.player.mass);
    const ex = this.exercise;
    const log = new FlightLog({
      cfg: this.flightConfig,
      P0: this.flight.rotorP0,
      program: ex ? { kind: ex.steps ? 'exercise' : ex.kind ?? 'lesson', id: ex.id, name: ex.name } : null,
      helicopter: this.helicopter?.id ?? null,
      player: { name: this.player.name, klass: this.player.klass },
      showRaw: this.cfg.showRawWatts,
    });
    this.log = log;
    // Slumpen loggas, så att flygningen kan spelas upp igen.
    this.run = ex ? new ExerciseRun(ex, { rand: () => log.rand(this.rand()) }) : null;
    this.engine = new Engine(this.cfg);
    this.acc = 0;
    this.lastStrokeT = 0;
    this.groundFor = 0;
    this.passed = new Set();
    this.prevH = 0;
    this.#set('FLYING');
  }

  #physicsStep() {
    const f = this.flight;
    const power = this.engine.power(f.t);
    this.prevH = f.h;

    if (this.run) {
      const run = this.run;
      const off = run.engineOff;
      f.step(run.effectivePower(power, f));
      run.update(f, power);
      // Motorn stannar eller startar: dragen från före eller under stoppet räknas inte.
      if (run.engineOff !== off) this.engine.reset();
      const events = run.takeEvents();
      this.log.step(f, run, events);
      for (const e of events) this.#emit('drill', e);
      if (run.status !== 'running') this.#finish(run.status);
      return; // övningen avgör när passet är slut
    }

    f.step(power);
    this.log.step(f);
    for (const m of this.cfg.milestones) {
      if (!this.passed.has(m.name) && f.h >= m.h) {
        this.passed.add(m.name);
        this.log.event(f.t, `topp passerad: ${m.name} ${m.h} m`);
        this.#emit('milestone', m);
      }
    }

    // 1. Har flugit och sedan stått på marken med motoreffekt < P0
    this.groundFor = f.hasFlown && f.onGround && power < f.P0 ? this.groundFor + this.cfg.dt : 0;
    if (this.groundFor >= this.cfg.groundEndS - 1e-9) return this.#finish('landed');
    // 2. Inga drag på idleEndS
    if (f.t - this.lastStrokeT >= this.cfg.idleEndS - 1e-9) return this.#finish('idle');
    // 3. Max passlängd
    if (this.cfg.maxSessionS > 0 && f.t >= this.cfg.maxSessionS - 1e-9) return this.#finish('time');
  }

  /** Högsta passerade milstolpe för en höjd. */
  highestMilestone(h) {
    return [...this.cfg.milestones].reverse().find((m) => h >= m.h) ?? null;
  }

  #finish(reason) {
    const f = this.flight;
    this.result = {
      name: this.player.name,
      klass: this.player.klass,
      hMax: f.hMax,
      tHMax: f.tHMax,
      duration: f.t,
      reason,
      milestone: this.highestMilestone(f.hMax),
      endH: f.h,
      stats: this.#strokeStats(),
      exercise: this.run
        ? {
            id: this.exercise.id,
            name: this.exercise.name,
            kind: this.run.program.kind, // 'exercise' | 'lesson' | 'exam'
            status: this.run.status, // 'running' om passet avbröts
            failReason: this.run.failReason,
            results: this.run.moments.at(-1)?.results ?? this.run.results,
            moments: this.run.moments, // avslutade moment med stjärnor
            plan: this.run.program.moments.map((x) => ({ id: x.id, name: x.name })), // alla moment, även de som inte hanns
          }
        : null,
    };
    this.log.finish(this.result);
    this.finishedFor = 0;
    this.#set('FINISHED');
    this.#emit('finish', this.result);
  }

  /** Dragen som drev motorn: antal, snitt och bästa i % av lyfteffekten (P0 i W för råa watt). */
  #strokeStats() {
    const p = this.log.strokes.filter((s) => s.note === 'ok').map((s) => s.p);
    return {
      strokes: p.length,
      avgPct: p.length ? p.reduce((a, x) => a + x, 0) / p.length : 0,
      maxPct: p.length ? Math.max(...p) : 0,
      P0: this.log.P0,
    };
  }

  #afterResult() {
    if (this.exercise) this.#toMenu();
    else this.#toIdle();
  }

  #toMenu() {
    this.flight = null;
    this.run = null;
    this.result = null;
    this.#set('MENU');
  }

  #toIdle() {
    this.player = null;
    this.exercise = null;
    this.helicopter = null;
    this.flight = null;
    this.run = null;
    this.result = null;
    this.#set('IDLE');
  }
}
