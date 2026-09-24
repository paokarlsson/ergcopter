// Spelflödet (spec §7): IDLE → SETUP → READY → COUNTDOWN → FLYING → FINISHED → IDLE.
// Ren logik utan DOM. Tiden kommer utifrån via tick(t) i sekunder.

import { Flight } from './physics.js';
import { StrokeSmoother } from './signal.js';
import { MIN_MASS, MAX_MASS, CLASSES } from './config.js';

export const STATES = ['IDLE', 'SETUP', 'READY', 'COUNTDOWN', 'FLYING', 'FINISHED'];
const MAX_TICK_S = 2; // längre glapp (t.ex. datorn sov) räknas inte som speltid

export class Game {
  constructor(cfg) {
    this.cfg = cfg;
    this.state = 'IDLE';
    this.player = null; // { name, mass, klass }
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
   * @param {{ name: string, mass: number, klass: string }} setup  klass: 'Barn' | 'Ungdom' | 'Vuxen'
   * @returns {string|null} felmeddelande, eller null om det gick bra
   */
  submitSetup({ name, mass, klass = '' }) {
    if (this.state !== 'SETUP') return 'Fel läge';
    const trimmed = String(name ?? '').trim();
    const kg = Number(mass);
    if (!trimmed) return 'Ange namn eller alias';
    if (!Number.isInteger(kg) || kg < MIN_MASS || kg > MAX_MASS) return `Vikten ska vara ett heltal ${MIN_MASS}–${MAX_MASS} kg`;
    if (!CLASSES.some((c) => c.name === klass)) return 'Välj klass';
    this.player = { name: trimmed.slice(0, 40), mass: kg, klass };
    this.#set('READY');
    return null;
  }

  /** Enter i READY, eller första draget. */
  startCountdown() {
    if (this.state !== 'READY') return;
    this.countdownLeft = this.cfg.countdownS;
    this.#set('COUNTDOWN');
    if (this.countdownLeft <= 0) this.#takeOff();
  }

  /** Esc: avbryter passet (sparas) eller backar till IDLE. */
  escape() {
    if (this.state === 'FLYING') this.#finish('operator');
    else if (this.state !== 'IDLE') this.#toIdle();
  }

  /** Tangent eller klick i resultatvisningen. */
  dismissResult() {
    if (this.state === 'FINISHED') this.#toIdle();
  }

  setPaused(paused) {
    this.paused = paused;
  }

  // --- Data -------------------------------------------------------------------

  /** @param {{t:number, power:number, strokeCount:number}} stroke */
  stroke(stroke) {
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
    } else if (this.state === 'FINISHED') {
      this.finishedFor += dt;
      if (this.finishedFor >= this.cfg.resultDisplayS) this.#toIdle();
    }
  }

  /** Andel av nästa fysiksteg som hunnit gå (för interpolering i renderingen). */
  get alpha() {
    return this.state === 'FLYING' ? this.acc / this.cfg.dt : 0;
  }

  #takeOff() {
    this.flight = new Flight(this.cfg, this.player.mass);
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
    };
    this.finishedFor = 0;
    this.#set('FINISHED');
    this.#emit('finish', this.result);
  }

  #toIdle() {
    this.player = null;
    this.flight = null;
    this.result = null;
    this.#set('IDLE');
  }
}
