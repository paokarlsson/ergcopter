#!/usr/bin/env node
// Övningssimulator (plan.md §3): kör aspirantens övningar, lektioner och uppflygningen headless med
// autopiloten i en helikopter och skriver ut resultatet. Används för trimning.
//
//   node tools/exercises.js [--heli school] [--mass 80] [--spm 40]

import { DEFAULT_CONFIG } from '../public/game/core/config.js';
import { EXERCISES, describeResults, starText } from '../public/game/core/exercise.js';
import { LESSONS, EXAM } from '../public/game/core/lessons.js';
import { getHelicopter, helicopterConfig } from '../public/game/core/helicopters.js';
import { runExercise } from '../public/game/core/sim.js';
import { autopilot } from '../public/game/core/autopilot.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), [])
);
const heli = getHelicopter(args.heli ?? 'school');
const mass = Number(args.mass ?? 80);
const spm = Number(args.spm ?? 40);
const cfg = helicopterConfig(DEFAULT_CONFIG, heli);

const time = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

console.log(`${heli.name}: tak ${heli.ceiling} m. ${mass} kg, ${spm} drag/min, autopilot\n`);
for (const ex of [...EXERCISES, ...LESSONS, EXAM]) {
  const run = runExercise(cfg, mass, ex, autopilot(), { spm });
  const result = run.status === 'passed' ? 'Godkänd' : `Underkänd: ${run.failReason}`;
  const details = run.moments.length > 1
    ? run.moments.map((x) => `${x.name} ${x.status === 'passed' ? starText(x.stars) : '✗'}`).join(', ')
    : `${starText(run.moments[0].stars)}  ${describeResults(run.moments[0].results)}`;
  const max = run.program.moments.reduce((a, x) => a + x.maxS, 0);
  console.log(`${ex.name.padEnd(28)} ${result.padEnd(12)} ${time(run.durationS).padStart(5)} (max ${time(max)})  ${details}`);
}
