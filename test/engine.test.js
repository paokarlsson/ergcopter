import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../public/game/core/config.js';
import { Engine, HOLD_FACTOR } from '../public/game/core/engine.js';

const cfg = { ...DEFAULT_CONFIG, maxStrokeS: 3 };

test('varje drag gäller för sig: inget medelvärde', () => {
  const e = new Engine(cfg);
  assert.equal(e.power(0), 0);
  e.stroke({ t: 1, power: 100, strokeCount: 1 });
  assert.equal(e.power(1), 100);
  e.stroke({ t: 2, power: 200, strokeCount: 2 });
  assert.equal(e.power(2), 200);
  e.stroke({ t: 3, power: 300, strokeCount: 3 });
  assert.equal(e.power(3), 300);
  e.stroke({ t: 4, power: 150, strokeCount: 4 });
  assert.equal(e.power(4), 150);
});

test('effekten hålls tills nästa drag', () => {
  const e = new Engine(cfg);
  e.stroke({ t: 10, power: 240, strokeCount: 1 });
  e.stroke({ t: 12, power: 260, strokeCount: 2 });
  assert.equal(e.power(12.5), 260);
  assert.equal(e.power(14.4), 260);
});

test('motorn stannar när nästa drag dröjer 1,25 × förra perioden', () => {
  const e = new Engine(cfg);
  e.stroke({ t: 0, power: 200, strokeCount: 1 });
  e.stroke({ t: 1.5, power: 200, strokeCount: 2 });
  const stop = 1.5 + HOLD_FACTOR * 1.5;
  assert.equal(e.power(stop - 0.01), 200);
  assert.equal(e.power(stop), 0);
  // nästa drag startar motorn igen
  e.stroke({ t: 10, power: 120, strokeCount: 3 });
  assert.equal(e.power(10), 120);
});

test('första draget, och första efter en paus, driver motorn i maxStrokeS', () => {
  const e = new Engine(cfg);
  e.stroke({ t: 0, power: 200, strokeCount: 1 });
  assert.equal(e.power(2.99), 200);
  assert.equal(e.power(3), 0);
  e.stroke({ t: 20, power: 150, strokeCount: 2 });
  assert.equal(e.power(22.99), 150);
  assert.equal(e.power(23), 0);
});

test('dubbletter av samma strokeCount ignoreras', () => {
  const e = new Engine(cfg);
  assert.equal(e.stroke({ t: 1, power: 100, strokeCount: 7 }), true);
  assert.equal(e.stroke({ t: 1.01, power: 999, strokeCount: 7 }), false);
  assert.equal(e.power(1.02), 100);
  assert.equal(e.stroke({ t: 2, power: 200, strokeCount: 8 }), true);
  assert.equal(e.power(2), 200);
});

test('reset stänger av motorn', () => {
  const e = new Engine(cfg);
  e.stroke({ t: 0, power: 200, strokeCount: 1 });
  e.reset();
  assert.equal(e.power(0.1), 0);
});
