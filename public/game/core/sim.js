// Headless-körning av en profil genom samma motor och fysik som spelet.

import { Flight } from './physics.js';
import { Engine } from './engine.js';
import { ScriptedSource } from '../../shared/sources/scripted.js';
import { ExerciseRun } from './exercise.js';
import { Game } from './game.js';
import { DEFAULT_CONFIG, liftPower } from './config.js';
import { getHelicopter } from './helicopters.js';
import { findProgram } from './lessons.js';

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

/**
 * Flyger ett helt pass genom spelet headless, med ett drag var 60/spm sekund.
 * `pilot(state)` ger effekten för draget (W) eller null för inget drag, som i runExercise.
 * Ger en flyglogg (game.log) utan erg, t.ex. i tester.
 * @param {Game} game  i READY
 * @returns {Game}
 */
export function flyGame(game, pilot, { spm = 40, maxS = 3600 } = {}) {
  const half = game.cfg.dt / 2; // högst ett fysiksteg per tick
  let t = game.lastT ?? 0;
  let count = 0;
  game.tick(t);
  game.startCountdown();
  while (game.state === 'COUNTDOWN') game.tick((t += half));
  let next = 0;
  while (game.state === 'FLYING') {
    const f = game.flight;
    if (f.t >= next - 1e-9) {
      next = f.t + 60 / spm;
      const power = pilot({ flight: f, run: game.run, step: game.run?.step ?? null });
      if (power !== null) game.stroke({ t, power, strokeCount: ++count });
    }
    if (f.t >= maxS) game.escape();
    else game.tick((t += half));
  }
  return game;
}

/**
 * Spelar upp en flyglogg (parseLog i flightlog.js) genom spelet igen: samma drag vid
 * samma flygtid och samma slump. `overrides` ändrar parametrar, t.ex. { g: 10 }, för att
 * se hur samma drag hade flugit. Effekten i loggen är relativ P0, så uppspelningen flygs
 * med referensvikten och blir lika som originalet så när som på avrundningen.
 * @returns {Game} spelet efter flygningen, med game.result och en ny game.log
 */
export function replayLog(log, overrides = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...log.cfg, ...log.game, ...overrides };
  const rands = [...log.rands];
  const game = new Game(cfg, { rand: () => rands.shift() ?? 0.5 });
  const mass = Math.round(cfg.m_ref);
  const P0 = liftPower(cfg, mass);
  const half = cfg.dt / 2; // högst ett fysiksteg per tick, så att varje drag hamnar på rätt steg
  let t = 0;
  game.tick(t);
  game.openSetup();
  const klass = ['Barn', 'Ungdom', 'Vuxen'].includes(log.player?.klass) ? log.player.klass : 'Vuxen';
  const error = game.submitSetup({ name: log.player?.name ?? '', mass, klass });
  if (error) throw new Error(error);
  if (!log.program && log.helicopter) game.setOwnHelicopter(getHelicopter(log.helicopter));
  const program = log.program ? findProgram(log.program.id) : null;
  if (log.program && !program) throw new Error(`Okänd övning i loggen: ${log.program.id}`);
  game.choose(program);
  game.startCountdown();
  while (game.state === 'COUNTDOWN') game.tick((t += half));

  // Drag under en paus nådde aldrig motorn. Övriga spelas upp; spelet avgör själv om de räknas.
  const strokes = log.strokes.filter((s) => s.note !== 'paus');
  const stopAt = log.end?.reason === 'operator' ? log.end.t : (log.end?.t ?? 0) + 600;
  let i = 0;
  while (game.state === 'FLYING') {
    const f = game.flight;
    while (i < strokes.length && strokes[i].t <= f.t + 1e-9) {
      const s = strokes[i++];
      game.stroke({ t, power: (s.p / 100) * P0, strokeCount: s.nr });
    }
    if (f.t >= stopAt - 1e-9) game.escape();
    else game.tick((t += half));
  }
  return game;
}
