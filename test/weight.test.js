import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, liftPower } from '../public/game/config.js';

const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) <= 0.1, `${actual.toFixed(3)} W, väntat ${expected} W ±0,1`);

// Grundspelets P_ref = 100 W (spec §6). P0-tabellen för blandad publik (spec §12.1) testas i defaults.test.js.
test('k = 1 (linjär): 60 → 75, 80 → 100, 100 → 125 W', () => {
  const cfg = { ...DEFAULT_CONFIG, P_ref: 100, weightMode: 'linear' };
  near(liftPower(cfg, 60), 75.0);
  near(liftPower(cfg, 80), 100.0);
  near(liftPower(cfg, 100), 125.0);
});

test('k = 2/3 (rättvis): 60 → 82,5, 100 → 116,0 W', () => {
  const cfg = { ...DEFAULT_CONFIG, P_ref: 100, weightMode: 'fair' };
  near(liftPower(cfg, 60), 82.5);
  near(liftPower(cfg, 100), 116.0);
});
