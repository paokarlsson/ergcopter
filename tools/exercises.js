#!/usr/bin/env node
// Övningssimulator (plan.md §3): kör aspirantens övningar headless med
// autopiloten i en helikopter och skriver ut resultatet. Används för trimning.
//
//   node tools/exercises.js [--heli school] [--mass 80] [--spm 40]

import { DEFAULT_CONFIG } from '../public/game/core/config.js';
import { EXERCISES } from '../public/game/core/exercise.js';
import { getHelicopter, helicopterConfig } from '../public/game/core/helicopters.js';
import { runExercise } from '../public/game/core/sim.js';
import { autopilot } from './autopilot.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), [])
);
const heli = getHelicopter(args.heli ?? 'school');
const mass = Number(args.mass ?? 80);
const spm = Number(args.spm ?? 40);
const cfg = helicopterConfig(DEFAULT_CONFIG, heli);

const time = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const detail = (r) =>
  r.type === 'land' ? `landning ${r.speed.toFixed(1)} m/s`
  : r.type === 'freefall' ? `fångad på ${Math.round(r.caughtAt)} m (${r.attempts} försök)`
  : r.type === 'hover' ? `hovrade ${Math.round(r.held)} s`
  : null;

console.log(`${heli.name}: tak ${heli.ceiling} m. ${mass} kg, ${spm} drag/min, autopilot\n`);
for (const ex of EXERCISES) {
  const run = runExercise(cfg, mass, ex, autopilot(), { spm });
  const result = run.status === 'passed' ? 'Godkänd' : `Underkänd: ${run.failReason}`;
  const details = run.results.map(detail).filter(Boolean).join(', ');
  console.log(`${ex.name.padEnd(14)} ${result.padEnd(12)} ${time(run.durationS).padStart(5)} (max ${time(ex.maxS)})  ${details}`);
}
