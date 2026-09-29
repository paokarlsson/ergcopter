// Spelflödet (spec §7, plan.md §8):
//   IDLE → SETUP → MENU → READY → COUNTDOWN → FLYING → FINISHED → IDLE
// I MENU väljer deltagaren en övning eller fri flygning (så högt som möjligt).
// Efter en övning går FINISHED tillbaka till MENU, så att man kan fortsätta öva.
// Den som står på ergen behöver inte röra skärmen: ett drag i MENU startar det
// föreslagna valet, och ett drag efter en övnings resultat går tillbaka till MENU.
// Ren logik utan DOM. Tiden kommer utifrån via tick(t) i sekunder.

import { Flight } from './physics.js';
import { StrokeSmoother } from './signal.js';
import { MIN_MASS, MAX_MASS, CLASSES } from './config.js';
import { ExerciseRun } from './exercise.js';
import { getHelicopter, helicopterConfig } from './helicopters.js';

export const STATES = ['IDLE', 'SETUP', 'MENU', 'READY', 'COUNTDOWN', 'FLYING', 'FINISHED'];

/** Så länge efter att menyn eller ett övningsresultat visats räknas inga drag, så att man hinner läsa. */
export const STROKE_GRACE_S = 3;

/** Helikoptern som övningarna flygs med. */
export const EXERCISE_HELICOPTER = 'school';
/** Namnet när deltagaren inte anger något. */
export const ANONYMOUS_NAME = 'Anonym';
const MAX_TICK_S = 2; // längre glapp (t.ex. datorn sov) räknas inte som speltid

export class Game {
  constructor(cfg) {
    this.cfg = cfg;
    this.state = 'IDLE';
    this.player = null; // { name, anonymous, mass, klass }
    this.exercise = null; // vald övning, null = fri flygning
    this.helicopter = null; // helikoptertyp, null = standard
    this.run = null; // ExerciseRun under en övning
    this.suggested = null; // förslaget i menyn som ett drag startar, null = fri flygning
    this.menuFor = 0; // s i MENU
    this.flight = null;
    this.smoother = new StrokeSmoother(cfg);
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
    this.smoother.cfg = cfg;
  }

  // --- Operatörens åtgärder -------------------------------------------------

  openSetup() {
    if (this.state === 'IDLE' || this.state === 'FINISHED') this.#set('SETUP');
  }

  /**
   * @param {{ name: string, mass: number, klass: string }} setup  namnet är valfritt; klass: 'Barn' | 'Ungdom' | 'Vuxen'
   * @returns {string|null} felmeddelande, eller null om det gick bra
   */
  submitSetup({ name, mass, klass = '' }) {
    if (this.state !== 'SETUP') return 'Fel läge';
    const trimmed = String(name ?? '').trim();
    const kg = Number(mass);
    if (!Number.isInteger(kg) || kg < MIN_MASS || kg > MAX_MASS) return `Vikten ska vara ett heltal ${MIN_MASS}–${MAX_MASS} kg`;
    if (!CLASSES.some((c) => c.name === klass)) return 'Välj klass';
    this.player = { name: trimmed.slice(0, 40) || ANONYMOUS_NAME, anonymous: !trimmed, mass: kg, klass };
    this.#set('MENU');
    return null;
  }

  /** Förslaget i menyn (t.ex. nästa ej godkända övning), null = fri flygning. */
  suggest(exercise) {
    this.suggested = exercise ?? null;
  }

  /**
   * Val i menyn: en övning (från EXERCISES) eller null för fri flygning.
   */
  choose(exercise) {
    if (this.state !== 'MENU') return;
    this.exercise = exercise ?? null;
    this.helicopter = exercise ? getHelicopter(EXERCISE_HELICOPTER) : null;
    this.#set('READY');
  }

  /** Enter i READY, eller första draget. */
  startCountdown() {
    if (this.state !== 'READY') return;
    this.countdownLeft = this.cfg.countdownS;
    this.#set('COUNTDOWN');
    if (this.countdownLeft <= 0) this.#takeOff();
  }

  /** Esc: avbryter passet (sparas), backar från READY till menyn eller till IDLE. */
  escape() {
    if (this.state === 'FLYING') this.#finish('operator');
    else if (this.state === 'READY' || this.state === 'COUNTDOWN') this.#toMenu();
    else if (this.state !== 'IDLE') this.#toIdle();
  }

  /** Tangent eller klick i resultatvisningen. */
  dismissResult() {
    if (this.state === 'FINISHED') this.#afterResult();
  }

  setPaused(paused) {
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
    if (this.state !== 'FLYING' || this.paused) return; // drag under nedräkningen ignoreras
    // Speltiden (flight.t) används så att paus och bakgrundsflik inte påverkar.
    if (this.smoother.push({ ...stroke, t: this.flight.t })) this.lastStrokeT = this.flight.t;
  }

  /** P_smooth just nu (0 utanför FLYING). */
  get power() {
    return this.state === 'FLYING' ? this.smoother.value(this.flight.t) : 0;
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
      if (this.finishedFor >= this.cfg.resultDisplayS) this.#afterResult();
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
    this.run = this.exercise ? new ExerciseRun(this.exercise) : null;
    this.smoother = new StrokeSmoother(this.cfg);
    this.acc = 0;
    this.lastStrokeT = 0;
    this.groundFor = 0;
    this.passed = new Set();
    this.prevH = 0;
    this.#set('FLYING');
  }

  #physicsStep() {
    const f = this.flight;
    const power = this.smoother.value(f.t);
    this.prevH = f.h;
    f.step(power);

    if (this.run) {
      this.run.update(f, power);
      if (this.run.status !== 'running') this.#finish(this.run.status);
      return; // övningen avgör när passet är slut
    }

    for (const m of this.cfg.milestones) {
      if (!this.passed.has(m.name) && f.h >= m.h) {
        this.passed.add(m.name);
        this.#emit('milestone', m);
      }
    }

    // 1. Har flugit och sedan stått på marken med P_smooth < P0
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
      exercise: this.run
        ? {
            id: this.exercise.id,
            name: this.exercise.name,
            status: this.run.status, // 'running' om passet avbröts
            failReason: this.run.failReason,
            results: this.run.results,
          }
        : null,
    };
    this.finishedFor = 0;
    this.#set('FINISHED');
    this.#emit('finish', this.result);
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
