// Headless-körning av en profil genom samma motor och fysik som spelet.

import { Flight } from './physics.js';
import { Engine } from './engine.js';
import { ScriptedSource } from '../../shared/sources/scripted.js';
import { ExerciseRun } from './exercise.js';

const MAX_COAST_STEPS = 20 * 600; // säkerhetsgräns för uppbromsningen efter profilen

/**
 * Kör profilen genom ScriptedSource → Engine → Flight tills
 * helikoptern landat efter passet (eller maxTail sekunder efter).
 * @returns {{ hMax: number, tHMax: number, flight: Flight }}
 */
export function runProfile(cfg, bodyMass, profile, { spm = 40, maxTailS = 3600 } = {}) {
  const source = new ScriptedSource(profile, { spm });
  const engine = new Engine(cfg);
  const flight = new Flight(cfg, bodyMass);
  const strokes = [...source.strokes()];
  let next = 0;
  const end = source.duration + maxTailS;
  while (flight.t < end) {
    while (next < strokes.length && strokes[next].t <= flight.t + 1e-9) engine.stroke(strokes[next++]);
    flight.step(engine.power(flight.t));
    if (flight.t > source.duration && flight.onGround && next >= strokes.length) break;
  }
  return { hMax: flight.hMax, tHMax: flight.tHMax, flight };
}

/**
 * Ren fysik med exakt effekt enligt profilen (ingen motor, effekten går direkt till rotorn),
 * och sedan 0 W tills helikoptern slutar stiga, så att maxhöjden räknar med farten den har kvar.
 */
export function runPhysicsOnly(cfg, bodyMass, profile) {
  const source = new ScriptedSource(profile);
  const flight = new Flight(cfg, bodyMass);
  while (flight.t < source.duration - 1e-9) flight.step(source.powerAt(flight.t + cfg.dt / 2));
  for (let i = 0; i < MAX_COAST_STEPS && flight.v > 0; i++) flight.step(0);
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
  const engine = new Engine(cfg);
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
      if (power !== null && !run.engineOff) engine.stroke({ t: flight.t, power, strokeCount: ++count });
    }
    const power = engine.power(flight.t);
    flight.step(run.effectivePower(power, flight));
    run.update(flight, power);
    if (run.engineOff !== engineOff) engine.reset();
    engineOff = run.engineOff;
    run.takeEvents();
  }
  return run;
}
