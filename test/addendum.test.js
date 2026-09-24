// Tillägget "standardvärden för blandad publik" §6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, liftPower, sanitize, CLASSES } from '../public/game/config.js';
import { analyticHeight } from '../public/game/physics.js';
import { runPhysicsOnly } from '../public/game/sim.js';
import { preview, heightAfter } from '../public/game/calibration.js';
import { Game } from '../public/game/game.js';
import { Leaderboard } from '../public/game/leaderboard.js';

const cfg = sanitize({ ...DEFAULT_CONFIG });
const nearW = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) <= 0.1, `${actual.toFixed(3)} W, väntat ${expected} W ±0,1`);
const nearH = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) / expected < 0.005, `${actual.toFixed(1)} m, väntat ${expected} m ±0,5 %`);

test('nya standardvärden: P_ref 60, H_air 1800, G 20, τ 90 s, 480 s, k = 1', () => {
  assert.deepEqual([cfg.P_ref, cfg.m_ref, cfg.H_air, cfg.G, cfg.maxSessionS, cfg.weightMode], [60, 80, 1800, 20, 480, 'linear']);
  assert.equal(cfg.H_air / cfg.G, 90);
});

test('P0-tabellen (§1)', () => {
  const table = [[15, 11.25], [20, 15], [30, 22.5], [50, 37.5], [60, 45], [80, 60], [100, 75], [120, 90]];
  for (const [kg, w] of table) nearW(liftPower(cfg, kg), w);
});

test('k = 2/3 och 30 kg: P0 = 31,2 W', () => {
  nearW(liftPower({ ...cfg, weightMode: 'fair' }, 30), 31.2);
});

// §4 förväntat utfall: maxhöjd efter 240 s jämn effekt
const OUTCOME = [
  ['Barn', 30, 40, 1303],
  ['Otränad vuxen', 70, 110, 1834],
  ['Motionär', 80, 180, 3350],
  ['Stark SkiErg-användare', 80, 300, 6700],
  ['Elit', 90, 420, 8747],
];
for (const [who, kg, w, expected] of OUTCOME) {
  test(`förväntat utfall: ${who} (${kg} kg, ${w} W, 240 s) ≈ ${expected} m`, () => {
    nearH(heightAfter(cfg, kg, w, 240), expected);
    nearH(runPhysicsOnly(cfg, kg, [{ s: 240, w }]).hMax, expected); // samma fysik som spelet
  });
}

// §4 balanskontroll: stark person, 80 kg
const BALANCE = [
  [30, 450, 3317],
  [180, 320, 6744],
  [300, 295, 6799],
  [600, 260, 5992],
  [3600, 200, 4200],
];
for (const [s, w, expected] of BALANCE) {
  test(`balanskontroll: ${s} s @ ${w} W ≈ ${expected} m`, () => {
    nearH(analyticHeight(cfg, 60, w, s), expected);
    nearH(runPhysicsOnly(cfg, 80, [{ s, w }]).hMax, expected);
  });
}

test('bästa insatsen i balanskontrollen ligger på 3–5 minuter', () => {
  const best = preview(cfg).balance.reduce((a, b) => (b.h > a.h ? b : a));
  assert.ok(best.s >= 180 && best.s <= 300, `bäst: ${best.label}`);
});

test('viktinmatning under 15 kg eller över 200 kg avvisas', () => {
  const tryMass = (mass) => {
    const game = new Game(cfg);
    game.openSetup();
    return game.submitSetup({ name: 'A', mass, klass: 'Barn' });
  };
  assert.match(tryMass(14), /15–200/);
  assert.match(tryMass(201), /15–200/);
  assert.equal(tryMass(15), null);
  assert.equal(tryMass(200), null);
});

test('förhandsvisningen räknas om när en parameter ändras', () => {
  const before = preview(cfg);
  const after = preview(sanitize({ ...cfg, G: 30 }));
  assert.equal(before.tau, 90);
  assert.equal(after.tau, 60);
  assert.notEqual(after.persons[0].h, before.persons[0].h);
  assert.notEqual(after.balance[1].h, before.balance[1].h);
  // P_ref påverkar P0 men inte τ
  const lower = preview(sanitize({ ...cfg, P_ref: 50 }));
  assert.equal(lower.tau, 90);
  assert.ok(lower.persons[0].P0 < before.persons[0].P0);
});

test('klasserna Barn, Ungdom, Vuxen', () => {
  assert.deepEqual(CLASSES.map((c) => c.name), ['Barn', 'Ungdom', 'Vuxen']);
});

test('topplista per klass: placering och dagens rekord inom klassen', () => {
  const data = new Map();
  const lb = new Leaderboard({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) });
  const ts = Date.now();
  lb.add({ name: 'Vuxen 1', hMax: 5000, tHMax: 1, klass: 'Vuxen', ts });
  lb.add({ name: 'Barn 1', hMax: 1200, tHMax: 1, klass: 'Barn', ts });
  const { entry } = lb.add({ name: 'Barn 2', hMax: 1100, tHMax: 1, klass: 'Barn', ts });
  assert.deepEqual(lb.classRank(entry), { rank: 2, total: 2 });
  assert.deepEqual(lb.top(10, 'Barn').map((e) => e.name), ['Barn 1', 'Barn 2']);
  assert.equal(lb.todayBest(ts, 'Barn'), 1200);
  assert.equal(lb.todayBest(ts), 5000);
});
