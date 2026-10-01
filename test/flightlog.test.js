import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../public/game/core/config.js';
import { Game } from '../public/game/core/game.js';
import { findProgram } from '../public/game/core/lessons.js';
import { autopilot } from '../public/game/core/autopilot.js';
import { flyGame, replayLog } from '../public/game/core/sim.js';
import { FlightLogStore, MAX_LOGS, parseLog, reversals, logTimeline, traceAt } from '../public/game/core/flightlog.js';

/** Ett spel i READY för en spelare på 80 kg (P0 = 60 W), med programmet `id` eller fri flygning. */
function ready(id = null, cfg = {}, rand = () => 0.5) {
  const game = new Game({ ...DEFAULT_CONFIG, ...cfg }, { rand });
  game.tick(0);
  game.openSetup();
  assert.equal(game.submitSetup({ name: 'Kim', mass: 80, klass: 'Vuxen' }), null);
  game.choose(id ? findProgram(id) : null);
  return game;
}

/** Autopiloten i övningar; i fri flygning 150 W i 60 drag och sedan 50 W tills den landat. */
function pilot() {
  const auto = autopilot();
  let n = 0;
  return (s) => (s.step ? auto(s) : n++ < 60 ? 150 : 50);
}

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}

/** Största skillnaden i höjd mellan två spår vid samma tidpunkter. */
function maxDeviation(a, b) {
  const byT = new Map(a.map((row) => [row[0].toFixed(2), row[1]]));
  let dev = 0;
  for (const row of b) {
    const h = byT.get(row[0].toFixed(2));
    if (h !== undefined) dev = Math.max(dev, Math.abs(h - row[1]));
  }
  return dev;
}

test('flygloggen spelar in dragen, spåret, stegen och sättningen i en övning', () => {
  const game = flyGame(ready('first-lift'), pilot());
  const log = game.log;
  assert.equal(game.result.exercise.status, 'passed');
  assert.ok(log.strokes.length > 10);
  assert.ok(log.strokes.every((s) => s.note === 'ok'));
  assert.equal(log.touchdowns.length, 1);
  assert.equal(log.touchdowns[0].speed, game.flight.touchdown.speed);
  const text = log.toText({ date: '2026-09-30 18:00', source: 'test' });
  assert.match(text, /^Fjällräddaren flyglogg v1\n/);
  assert.match(text, /flygning: exercise first-lift \(Första lyftet\)/);
  assert.match(text, /steg 1\/2: Stig till 50 m/);
  assert.match(text, /steg 2\/2: Landa mjukt, högst 3,0 m\/s/);
  assert.match(text, /sättning 0,\d\d m\/s/);
  assert.match(text, /2\. Landa mjukt.*klart på/);
  assert.match(text, /under 25 m: \d+ av \d+ drag mot mjuk sjunk/);
});

test('spåret är tätt nära marken och glest högre upp', () => {
  const game = flyGame(ready('altitude'), pilot());
  const trace = game.log.trace;
  const gaps = (pred) => trace.slice(1).flatMap((row, i) => (pred(row, trace[i]) ? [row[0] - trace[i][0]] : []));
  // Glest i stadig stigning högt upp, tätt i sista biten före sättningen.
  assert.ok(gaps((row, prev) => row[1] > 300 && prev[1] > 300).some((dt) => dt > 0.45));
  const low = gaps((row, prev) => row[1] > 0 && row[1] < 20 && prev[1] > 0 && prev[1] < 20);
  assert.ok(low.length > 50 && low.every((dt) => dt < 0.11));
});

test('effekten loggas i % av P0, och P0 i watt bara med råa watt påslaget', () => {
  const game = ready();
  flyGame(game, (s) => (s.flight.t < 10 ? 120 : 30)); // 120 W = 200 % för 80 kg
  const text = game.log.toText();
  assert.match(text, /\n1 0\.00 200\.00 /);
  assert.doesNotMatch(text, /P0: /);
  assert.doesNotMatch(text, /\bkg\b|vikt/i);

  const raw = ready(null, { showRawWatts: true });
  flyGame(raw, (s) => (s.flight.t < 10 ? 120 : 30));
  assert.match(raw.log.toText(), /\nP0: 60\.00 W\n/);
});

test('drag som inte driver motorn märks: dubblett, paus och motorstopp', () => {
  const game = ready();
  game.startCountdown();
  for (let t = 0.05; game.state !== 'FLYING'; t += 0.05) game.tick(t);
  game.stroke({ t: 0, power: 120, strokeCount: 1 });
  game.stroke({ t: 0, power: 120, strokeCount: 1 });
  game.setPaused(true);
  game.stroke({ t: 0, power: 120, strokeCount: 2 });
  game.setPaused(false);
  assert.deepEqual(game.log.strokes.map((s) => s.note), ['ok', 'dubblett', 'paus']);
  assert.ok(game.log.events.some((e) => e.text.startsWith('paus')));
  assert.ok(game.log.events.some((e) => e.text === 'fortsätter'));

  const engine = flyGame(ready('engine'), pilot());
  assert.ok(engine.log.strokes.some((s) => s.note === 'motorstopp'));
  assert.ok(engine.log.events.some((e) => e.text === 'motorstopp'));
  assert.deepEqual(engine.log.rands, [0.5]); // när motorn stannade, för uppspelningen
});

test('kraftkurvan hör till nästa drag, med tiden från första sampel', () => {
  const game = ready();
  game.startCountdown();
  let t = 0;
  while (game.state !== 'FLYING') game.tick((t += 0.05));
  game.forceSamples([10.4, 50.6]);
  while (game.flight.t < 0.6 - 1e-9) game.tick((t += 0.025));
  game.forceSamples([]);
  game.forceSamples([30.2]);
  game.stroke({ t, power: 90, strokeCount: 1 });
  game.stroke({ t, power: 90, strokeCount: 2 });
  const [first, second] = game.log.strokes;
  assert.deepEqual(first.force, [10, 51, 30]);
  assert.ok(Math.abs(first.k0 + 0.6) < 0.03);
  assert.deepEqual(second.force, []);
  assert.equal(second.k0, null);
  assert.match(game.log.toText(), /\n1 0\.60 150\.00 .* ok -0\.60 10 51 30\n/);
});

test('texten går att läsa tillbaka, även med annan text runt omkring', () => {
  const game = ready('first-lift');
  game.forceSamples([1]); // före flygningen: loggas inte
  flyGame(game, pilot());
  const text = game.log.toText({ date: '2026-09-30 18:00', source: 'USB' });
  const log = parseLog(`Här är min flygning:\n\n${text}\nTack!`);
  assert.equal(log.version, 1);
  assert.deepEqual(log.program, { kind: 'exercise', id: 'first-lift' });
  assert.equal(log.helicopter, 'school');
  assert.deepEqual(log.player, { name: 'Kim', klass: 'Vuxen' });
  assert.equal(log.cfg.H_air, DEFAULT_CONFIG.H_air);
  assert.equal(log.cfg.weightMode, 'linear');
  assert.equal(log.game.groundEndS, DEFAULT_CONFIG.groundEndS);
  assert.equal(log.header['källa'], 'USB');
  assert.equal(log.end.reason, 'passed');
  assert.equal(log.strokes.length, game.log.strokes.length);
  log.strokes.forEach((s, i) => assert.ok(Math.abs(s.p - game.log.strokes[i].p) < 0.006));
  assert.equal(log.trace.length, game.log.trace.length);
  assert.equal(log.events.length, game.log.events.length);
  assert.ok(log.summary.some((line) => line.includes('Landa mjukt')));
  assert.throws(() => parseLog('ingen logg här'), /Hittar ingen flyglogg/);
});

test('uppspelningen flyger samma pass som loggen', () => {
  for (const id of ['first-lift', 'engine', null]) {
    const game = flyGame(ready(id, {}, () => 0.37), pilot());
    const log = parseLog(game.log.toText());
    const again = replayLog(log);
    assert.equal(again.log.outcome, game.log.outcome, `samma utfall: ${id}`);
    assert.ok(Math.abs(again.result.duration - game.result.duration) < 0.11, `samma längd: ${id}`);
    assert.equal(again.log.touchdowns.length, game.log.touchdowns.length);
    again.log.touchdowns.forEach((td, i) => assert.ok(Math.abs(td.speed - game.log.touchdowns[i].speed) < 0.01));
    assert.ok(maxDeviation(game.log.trace, again.log.trace) < 0.1, `samma höjder: ${id}`);
  }
});

test('uppspelningen kan prova andra parametrar och följer ett avbrott', () => {
  const game = ready('hover');
  flyGame(game, pilot(), { maxS: 20 }); // Esc efter 20 s
  const log = parseLog(game.log.toText());
  assert.equal(log.end.reason, 'operator');
  const again = replayLog(log);
  assert.equal(again.result.reason, 'operator');
  assert.ok(Math.abs(again.result.duration - 20) < 0.11);
  // Tyngre rotorblad: samma drag, men helikoptern svarar senare.
  const heavy = replayLog(log, { rotorTauS: 3 });
  assert.ok(heavy.log.trace.find((row) => row[1] > 1)[0] > again.log.trace.find((row) => row[1] > 1)[0]);
});

test('vändningar räknas med hysteres', () => {
  assert.equal(reversals([0, 1, 2, 0.3, -0.3, 0.2, 1]), 0);
  assert.equal(reversals([1, -1, 1, -1]), 3);
  assert.equal(reversals([-2, -0.4, 0.4, 2, 0, -2]), 2);
});

test('de senaste loggarna sparas, nyast först, och överlever en omladdning', () => {
  const storage = memoryStorage();
  const store = new FlightLogStore(storage);
  for (let i = 1; i <= MAX_LOGS + 2; i++) store.add({ ts: i, title: `Flygning ${i}`, text: `logg ${i}` });
  const again = new FlightLogStore(storage);
  assert.equal(again.logs.length, MAX_LOGS);
  assert.deepEqual(again.logs.slice(0, 2).map((x) => x.title), [`Flygning ${MAX_LOGS + 2}`, `Flygning ${MAX_LOGS + 1}`]);
  assert.equal(again.get(again.logs[0].id).text, `logg ${MAX_LOGS + 2}`);
  again.clear();
  assert.equal(new FlightLogStore(storage).logs.length, 0);

  storage.setItem('skierg.flightlog.v1', '{trasig');
  assert.deepEqual(new FlightLogStore(storage).logs, []);
  assert.equal(new FlightLogStore(null).add({ ts: 1, title: 'A', text: 'x' }).title, 'A');
});

test('full lagring: de äldsta loggarna släpps tills det får plats', () => {
  const data = new Map();
  const storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem(k, v) {
      if (v.length > 200) throw new Error('QuotaExceededError');
      data.set(k, v);
    },
  };
  const store = new FlightLogStore(storage);
  for (let i = 1; i <= 4; i++) store.add({ ts: i, title: `F${i}`, text: 'x'.repeat(60) });
  assert.equal(store.logs.length, 4); // alla finns kvar under sessionen
  const saved = JSON.parse(data.get('skierg.flightlog.v1'));
  assert.ok(saved.length >= 1 && saved.length < 4);
  assert.equal(saved[0].title, 'F4');
});

test('uppspelningen läser toppar, sättningar och höjden mellan spårets punkter', () => {
  const game = flyGame(ready(), pilot());
  const log = parseLog(game.log.toText());
  const line = logTimeline(log);
  assert.ok(line.peaks.length >= 2);
  assert.equal(line.peaks[0].name, 'Suljätten');
  assert.equal(line.peaks[0].h, 845);
  assert.ok(line.peaks.every((p, i) => i === 0 || p.t >= line.peaks[i - 1].t));
  assert.ok(line.touchdowns.length >= 1);
  assert.ok(line.touchdowns[0].speed > 0);
  assert.ok(Math.abs(line.duration - game.result.duration) < 0.01);
  assert.ok(Math.abs(line.hMax - game.result.hMax) < 5);
  // Mitt emellan två punkter i spåret
  const [a, b] = line.trace.slice(10, 12);
  assert.ok(Math.abs(traceAt(line.trace, (a.t + b.t) / 2).h - (a.h + b.h) / 2) < 1e-9);
  assert.equal(traceAt(line.trace, -1).h, line.trace[0].h);
  assert.equal(traceAt(line.trace, 1e9).h, line.trace.at(-1).h);
});
