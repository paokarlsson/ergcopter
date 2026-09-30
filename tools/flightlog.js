#!/usr/bin/env node
// Flygloggar (spec §9.1): läser loggar som kopierats från spelet, spelar upp dem igen
// genom spelet och skriver ut vad som hände, med de sista dragen före varje sättning.
// Med --set provas samma drag med andra parametrar, t.ex. om en landning hade blivit
// mjukare med tyngre rotorblad. Spelaren hade förstås flugit annorlunda, så det är en fingervisning.
//
//   npm run flightlog -- logg.txt [--set rotorTauS=1] [--set g=10]
//   node tools/flightlog.js - < logg.txt        (läser från stdin)
//
// Flera loggar i samma fil går bra.

import { readFileSync } from 'node:fs';
import { parseLog, LOG_TITLE, clock } from '../public/game/core/flightlog.js';
import { replayLog } from '../public/game/core/sim.js';

const LAST_STROKES = 8; // drag före varje sättning

const args = process.argv.slice(2);
const overrides = {};
let file = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--set') {
    const [key, value] = (args[++i] ?? '').split('=');
    overrides[key] = Number.isFinite(Number(value)) ? Number(value) : value;
  } else file = args[i];
}
if (!file) {
  console.error('Användning: node tools/flightlog.js <logg.txt | -> [--set namn=värde …]');
  process.exit(1);
}

const text = readFileSync(file === '-' ? 0 : file, 'utf8');
const parts = text.split(LOG_TITLE).slice(1).map((part) => LOG_TITLE + part);
if (!parts.length) {
  console.error('Hittar ingen flyglogg i texten');
  process.exit(1);
}

const dec = (x, d = 2) => x.toFixed(d).replace('.', ',');
const speeds = (tds) => (tds.length ? tds.map((td) => `${dec(td.speed)} m/s`).join(', ') : 'inga');

for (const part of parts) {
  const log = parseLog(part);
  const h = log.header;
  console.log(`== ${[h.flygning, h.pilot, h['källa'], h.datum].filter(Boolean).join(' · ')}`);
  console.log(`Resultat: ${h.resultat ?? '?'}`);
  console.log(log.summary.join('\n'));

  // De sista dragen före varje sättning: där avgörs landningen.
  const touchdowns = log.events
    .filter((e) => e.text.startsWith('sättning'))
    .map((e) => ({ t: e.t, speed: Number(e.text.match(/[\d,]+/)[0].replace(',', '.')) }));
  touchdowns.forEach((td, i) => {
    const before = log.strokes.filter((s) => s.note === 'ok' && s.t < td.t).slice(-LAST_STROKES);
    console.log(`\nSättning ${i + 1} på ${dec(td.t, 1)} s: ${dec(td.speed)} m/s. De sista dragen:`);
    console.log('       t       h       v       p   lyft     vs');
    for (const s of before) {
      console.log([s.t, s.h, s.v, s.p].map((x) => x.toFixed(2).padStart(8)).join('') + `${Math.round(s.lift)}`.padStart(7) + s.vs.toFixed(1).padStart(7));
    }
  });

  const same = replayLog(log);
  const byT = new Map(log.trace.map((row) => [row[0].toFixed(2), row[1]]));
  let dev = 0;
  for (const row of same.log.trace) {
    const recorded = byT.get(row[0].toFixed(2));
    if (recorded !== undefined) dev = Math.max(dev, Math.abs(recorded - row[1]));
  }
  console.log(
    `\nUppspelning: ${same.log.outcome} · ${clock(same.result.duration)} · sättningar ${speeds(same.log.touchdowns)} · ` +
      `största skillnad i höjd mot loggen ${dec(dev)} m`
  );
  if (Object.keys(overrides).length) {
    const what = Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join(' ');
    const other = replayLog(log, overrides);
    console.log(`Med ${what}: ${other.log.outcome} · ${clock(other.result.duration)} · sättningar ${speeds(other.log.touchdowns)}`);
  }
  console.log('');
}
