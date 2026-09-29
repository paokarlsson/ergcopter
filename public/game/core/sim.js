// Headless-körning av en profil genom samma signalbehandling och fysik som spelet.

import { Flight } from './physics.js';
import { StrokeSmoother } from './signal.js';
import { ScriptedSource } from '../../shared/sources/scripted.js';
import { ExerciseRun } from './exercise.js';

/**
 * Kör profilen genom ScriptedSource → StrokeSmoother → Flight tills
 * helikoptern landat efter passet (eller maxTail sekunder efter).
 * @returns {{ hMax: number, tHMax: number, flight: Flight }}
 */
export function runProfile(cfg, bodyMass, profile, { spm = 40, maxTailS = 3600 } = {}) {
  const source = new ScriptedSource(profile, { spm });
  const smoother = new StrokeSmoother(cfg);
  const flight = new Flight(cfg, bodyMass);
  const strokes = [...source.strokes()];
  let next = 0;
  const end = source.duration + maxTailS;
  while (flight.t < end) {
    while (next < strokes.length && strokes[next].t <= flight.t + 1e-9) smoother.push(strokes[next++]);
    flight.step(smoother.value(flight.t));
    if (flight.t > source.duration && flight.onGround && next >= strokes.length) break;
  }
  return { hMax: flight.hMax, tHMax: flight.tHMax, flight };
}

/** Ren fysik med exakt effekt enligt profilen (ingen signalbehandling). */
export function runPhysicsOnly(cfg, bodyMass, profile) {
  const source = new ScriptedSource(profile);
  const flight = new Flight(cfg, bodyMass);
  while (flight.t < source.duration - 1e-9) flight.step(source.powerAt(flight.t + cfg.dt / 2));
  return { hMax: flight.hMax, tHMax: flight.tHMax, flight };
}

/**
 * Kör en övning headless med en pilot som bestämmer varje drag.
 * `pilot(state)` anropas var 60/spm sekund och returnerar effekten för draget,
 * eller null för att inte dra alls. Fungerar också för lektioner och uppflygningen.
 * @param {object} cfg  konfiguration, t.ex. från helicopterConfig
 * @returns {ExerciseRun}
 */
export function runExercise(cfg, bodyMass, exercise, pilot, { spm = 40, rand = () => 0.5 } = {}) {
  const run = new ExerciseRun(exercise, { rand });
  const smoother = new StrokeSmoother(cfg);
  const flight = new Flight(cfg, bodyMass);
  const interval = 60 / spm;
  let nextStroke = interval;
  let count = 0;
  let engineOff = false;
  while (run.status === 'running') {
    if (flight.t >= nextStroke - 1e-9) {
      nextStroke += interval;
      const power = pilot({ flight, run, step: run.step });
      // Vid motorstopp räknas inga drag (som i game.js).
      if (power !== null && !run.engineOff) smoother.push({ t: flight.t, power, strokeCount: ++count });
    }
    const power = smoother.value(flight.t);
    flight.step(run.effectivePower(power, flight));
    run.update(flight, power);
    if (run.engineOff !== engineOff) smoother.reset();
    engineOff = run.engineOff;
    run.takeEvents();
  }
  return run;
}
