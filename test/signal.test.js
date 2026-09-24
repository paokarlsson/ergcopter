import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../public/game/config.js';
import { StrokeSmoother } from '../public/game/signal.js';

const cfg = { ...DEFAULT_CONFIG }; // 3 drag, timeout 3 s, nedtoning 1 s

test('medelvärdet av de 3 senaste dragen', () => {
  const s = new StrokeSmoother(cfg);
  assert.equal(s.value(0), 0);
  s.push({ t: 1, power: 100, strokeCount: 1 });
  assert.equal(s.value(1), 100);
  s.push({ t: 2, power: 200, strokeCount: 2 });
  assert.equal(s.value(2), 150);
  s.push({ t: 3, power: 300, strokeCount: 3 });
  s.push({ t: 4, power: 400, strokeCount: 4 });
  assert.equal(s.value(4), 300); // (200+300+400)/3
});

test('värdet hålls konstant mellan dragen', () => {
  const s = new StrokeSmoother(cfg);
  s.push({ t: 10, power: 240, strokeCount: 1 });
  assert.equal(s.value(10.5), 240);
  assert.equal(s.value(12.9), 240);
});

test('dubbletter av samma strokeCount ignoreras', () => {
  const s = new StrokeSmoother(cfg);
  assert.equal(s.push({ t: 1, power: 100, strokeCount: 7 }), true);
  assert.equal(s.push({ t: 1.01, power: 999, strokeCount: 7 }), false);
  assert.equal(s.value(1.02), 100);
  assert.equal(s.push({ t: 2, power: 200, strokeCount: 8 }), true);
  assert.equal(s.value(2), 150);
});

test('nedtoning efter timeout och tömd buffert därefter', () => {
  const s = new StrokeSmoother(cfg);
  s.push({ t: 0, power: 200, strokeCount: 1 });
  assert.equal(s.value(3), 200); // precis vid timeout
  assert.ok(Math.abs(s.value(3.5) - 100) < 1e-9); // halvvägs i nedtoningen
  assert.ok(Math.abs(s.value(3.75) - 50) < 1e-9);
  assert.equal(s.value(4), 0);
  assert.equal(s.powers.length, 0);
  // nytt drag efter tömningen räknas från noll
  s.push({ t: 10, power: 120, strokeCount: 2 });
  assert.equal(s.value(10), 120);
});
