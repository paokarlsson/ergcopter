import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../public/game/config.js';
import { Flight, analyticHeight } from '../public/game/physics.js';
import { runPhysicsOnly } from '../public/game/sim.js';

// Huvudspecens parametrar (§5). Tillägget för blandad publik har andra
// standardvärden – de testas i addendum.test.js.
const cfg = { ...DEFAULT_CONFIG, P_ref: 100, H_air: 2700, G: 22.5 };

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
