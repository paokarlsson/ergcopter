#!/usr/bin/env node
// Strategisimulator (spec §10, tillägg §4): kör effektprofiler genom samma
// signalbehandling och fysik som spelet och skriver ut h_max. maxSessionS
// ignoreras här.
//
//   node tools/simulate.js [--mode linear|fair] [--spm 40] [--P_ref 60] [--H_air 1800] [--G 20]

import { DEFAULT_CONFIG, liftPower, sanitize } from '../public/game/config.js';
import { heightAfter, PERSONS, PERSON_SECONDS, BALANCE, BALANCE_MASS, tau } from '../public/game/calibration.js';
import { runProfile, runPhysicsOnly } from '../public/game/sim.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), [])
);
const num = (k, d) => (args[k] !== undefined ? Number(args[k]) : d);

const cfg = sanitize({
  ...DEFAULT_CONFIG,
  weightMode: args.mode ?? DEFAULT_CONFIG.weightMode,
  P_ref: num('P_ref', DEFAULT_CONFIG.P_ref),
  H_air: num('H_air', DEFAULT_CONFIG.H_air),
  G: num('G', DEFAULT_CONFIG.G),
});
const spm = num('spm', 40);

const m = (h) => Math.round(h).toLocaleString('sv-SE').padStart(7);
const time = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const header = (first) =>
  `${first.padEnd(50)} ${'Analytisk'.padStart(9)} ${'Fysik'.padStart(7)} ${'Spel'.padStart(7)}  Tid till h_max`;

console.log(
  `P_ref ${cfg.P_ref} W @ ${cfg.m_ref} kg, ${cfg.weightMode === 'fair' ? 'rättvis (k = 2/3)' : 'linjär (k = 1)'}, ` +
    `H_air ${cfg.H_air} m, G ${cfg.G} m/s, τ ${Math.round(tau(cfg))} s, ${spm} drag/min`
);

function row(label, mass, profile, analytic) {
  const physics = runPhysicsOnly(cfg, mass, profile);
  const game = runProfile(cfg, mass, profile, { spm });
  console.log(`${label.padEnd(50)} ${analytic === null ? '      –' : m(analytic)}   ${m(physics.hMax)} ${m(game.hMax)}  ${time(game.tHMax)}`);
}

console.log(`\nFörväntat utfall efter ${PERSON_SECONDS} s jämn effekt (tillägg §4)`);
console.log(header('Person'));
console.log('-'.repeat(94));
for (const p of PERSONS) {
  const label = `${p.name} (${p.mass} kg, ${p.power} W, P0 ${liftPower(cfg, p.mass).toFixed(1)} W)`;
  row(label, p.mass, [{ s: PERSON_SECONDS, w: p.power }], heightAfter(cfg, p.mass, p.power, PERSON_SECONDS));
}

console.log(`\nBalanskontroll, ${BALANCE_MASS} kg (tillägg §4) – bästa insatsen ska ligga på 3–5 min`);
console.log(header('Insats'));
console.log('-'.repeat(94));
for (const b of BALANCE) {
  row(`${b.label} @ ${b.power} W`, BALANCE_MASS, [{ s: b.s, w: b.power }], heightAfter(cfg, BALANCE_MASS, b.power, b.s));
}
row('Slutspurt: 4 min @ 250 + 30 s @ 380', BALANCE_MASS, [{ s: 240, w: 250 }, { s: 30, w: 380 }], null);
row('För hård start: 1 min @ 380 + 3 min @ 240', BALANCE_MASS, [{ s: 60, w: 380 }, { s: 180, w: 240 }], null);

console.log(
  `\nFysik = exakt effekt enligt profilen. Spel = drag var ${(60 / spm).toFixed(1)} s genom medelvärde ` +
    `(${cfg.smoothingStrokes} drag), håll ${cfg.strokeTimeoutS} s och nedtoning ${cfg.fadeOutS} s.`
);
