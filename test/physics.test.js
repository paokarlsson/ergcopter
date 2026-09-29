import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../public/game/core/config.js';
import { Flight, analyticHeight } from '../public/game/core/physics.js';
import { runPhysicsOnly } from '../public/game/core/sim.js';

// Grundspelets parametrar (spec §5) utan tröghet, så att den analytiska lösningen gäller exakt.
// Trögheten testas längst ned. Standardvärdena för blandad publik (spec §12) testas i defaults.test.js.
const cfg = { ...DEFAULT_CONFIG, P_ref: 100, H_air: 2700, G: 22.5, inertiaS: 0 };

// Spec §5, referenstabellen (80 kg, k = 1)
const REFERENCE = [
  [3, 500, 267],
  [30, 350, 1493],
  [180, 260, 3356],
  [300, 245, 3594],
  [600, 225, 3352],
  [3600, 200, 2700],
];

for (const [s, w, expected] of REFERENCE) {
  test(`konstant ${w} W i ${s} s från marken ≈ ${expected} m (±0,5 %)`, () => {
    const { hMax } = runPhysicsOnly(cfg, 80, [{ s, w }]);
    const analytic = analyticHeight(cfg, 100, w, s);
    assert.ok(Math.abs(hMax - analytic) / analytic < 0.005, `sim ${hMax.toFixed(1)} vs analytisk ${analytic.toFixed(1)}`);
    assert.ok(Math.abs(analytic - expected) / expected < 0.005, `analytisk ${analytic.toFixed(1)} vs tabell ${expected}`);
  });
}

test('80 kg och 90 W: lättar aldrig', () => {
  const f = new Flight(cfg, 80);
  for (let i = 0; i < 20 * 600; i++) f.step(90);
  assert.equal(f.hMax, 0);
  assert.equal(f.hasFlown, false);
});

test('höjden blir aldrig negativ', () => {
  const f = new Flight(cfg, 80);
  for (let i = 0; i < 400; i++) f.step(300);
  for (let i = 0; i < 20 * 600; i++) {
    f.step(i % 7 === 0 ? 0 : 50);
    assert.ok(f.h >= 0);
  }
});

test('effekt och sedan 0 W: sjunker, landar på 0 och blir stående', () => {
  const f = new Flight(cfg, 80);
  for (let i = 0; i < 20 * 60; i++) f.step(250);
  const top = f.h;
  assert.ok(top > 0);
  f.step(0);
  assert.ok(f.v < 0 && f.h < top);
  for (let i = 0; i < 20 * 600 && f.h > 0; i++) f.step(0);
  assert.equal(f.h, 0);
  for (let i = 0; i < 100; i++) f.step(0);
  assert.equal(f.h, 0);
  assert.equal(f.v, 0);
});

test('står kvar på marken tills P > P0', () => {
  const f = new Flight(cfg, 80);
  f.step(100);
  assert.equal(f.h, 0);
  f.step(101);
  assert.ok(f.h > 0);
});

test('maxSinkRate begränsar sjunkhastigheten', () => {
  const f = new Flight({ ...cfg, maxSinkRate: 5 }, 80);
  for (let i = 0; i < 20 * 60; i++) f.step(300);
  f.step(0);
  assert.equal(f.v, -5);
});

test('lyftmätaren: P/P0 på marken, P/P_req(h) i luften', () => {
  const f = new Flight(cfg, 80);
  assert.equal(f.liftRatio(50), 0.5);
  for (let i = 0; i < 20 * 60; i++) f.step(250);
  assert.ok(Math.abs(f.liftRatio(f.requiredPower()) - 1) < 1e-12);
});

// Tröghet (spec §5): farten närmar sig målfarten med tidskonstanten inertiaS.
const inert = { ...DEFAULT_CONFIG, inertiaS: 2 };

/** Flygning som hovrar på höjden h. */
function hovering(c, h) {
  const f = new Flight(c, 80);
  f.h = h;
  f.hasFlown = true;
  for (let i = 0; i < 400; i++) f.step(f.requiredPower());
  return f;
}

test('tröghet: fritt fall börjar med ungefär tyngdacceleration och når sluthastigheten', () => {
  const f = hovering(inert, 1000);
  assert.ok(Math.abs(f.v) < 1e-9);
  const terminal = f.targetSpeed(0);
  f.step(0);
  const a = -f.v / inert.dt;
  assert.ok(a > 9 && a < 16, `acceleration ${a.toFixed(1)} m/s²`);
  for (let i = 0; i < 20 * 2; i++) f.step(0); // 2 s = en tidskonstant
  assert.ok(f.v < 0.55 * terminal && f.v > 0.7 * terminal, `efter 2 s: ${f.v.toFixed(1)} m/s av ${terminal.toFixed(1)}`);
  for (let i = 0; i < 20 * 8; i++) f.step(0);
  assert.ok(Math.abs(f.v - f.targetSpeed(0)) < 1, 'nära sluthastigheten efter 10 s');
});

test('tröghet: i hög fart nedåt fortsätter helikoptern sjunka en stund trots överskott', () => {
  const f = hovering(inert, 1500);
  for (let i = 0; i < 20 * 10; i++) f.step(0);
  const h0 = f.h;
  const pull = f.requiredPower() + 0.5 * f.P0; // tydligt grönt
  for (let i = 0; i < 20; i++) f.step(pull);
  assert.ok(f.v < -10, `sjunker fortfarande efter 1 s: ${f.v.toFixed(1)} m/s`);
  let low = f.h;
  for (let i = 0; i < 20 * 10; i++) {
    f.step(pull);
    low = Math.min(low, f.h);
  }
  assert.ok(f.v > 0, 'stiger till slut');
  assert.ok(h0 - low > 25, `bromssträcka ${(h0 - low).toFixed(0)} m`);
});

test('tröghet: samma jämvikt som utan tröghet', () => {
  const run = (c) => {
    const f = new Flight(c, 80);
    for (let i = 0; i < 20 * 3600; i++) f.step(90);
    return f.h;
  };
  assert.ok(Math.abs(run(inert) - run({ ...inert, inertiaS: 0 })) < 0.5);
});

test('tröghet: sättningen mäts med farten i nedslaget', () => {
  const f = hovering(inert, 50);
  for (let i = 0; i < 20 * 20 && !f.touchdown; i++) f.step(0);
  assert.ok(f.touchdown && f.touchdown.speed > 3);
  assert.equal(f.v, 0);
});

test('tröghet: maxSinkRate begränsar fortfarande', () => {
  const f = hovering({ ...inert, maxSinkRate: 5 }, 1000);
  for (let i = 0; i < 20 * 10; i++) f.step(0);
  assert.equal(f.v, -5);
});
