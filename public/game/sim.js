// Headless-körning av en profil genom samma signalbehandling och fysik som spelet.

import { Flight } from './physics.js';
import { StrokeSmoother } from './signal.js';
import { ScriptedSource } from './sources/scripted.js';

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
