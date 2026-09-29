import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HelicopterSound, driveGain } from '../public/game/view/helicopter-sound.js';

/** Kör fysiken (utan WebAudio) tills den står still vid given gas. */
function settle(throttle) {
  const heli = new HelicopterSound({ autoUpdate: false });
  heli.setEngine(true);
  heli.setThrottle(throttle);
  for (let i = 0; i < 3000; i++) heli.update(0.02);
  return heli.state;
}

test('hovring (100 %) ger fullt rotorvarv', () => {
  const s = settle(1);
  assert.ok(Math.abs(s.rpm - 1) < 0.01, `rpm ${s.rpm}`);
  assert.ok(Math.abs(s.load - 1) < 0.01);
});

test('över 100 % ökar lasten och varvet något, taket är 300 %', () => {
  const [hover, double, triple, beyond] = [1, 2, 3, 5].map(settle);
  assert.ok(double.load > hover.load && triple.load > double.load);
  assert.ok(double.rpm > hover.rpm && triple.rpm > double.rpm);
  assert.ok(triple.rpm < 1.15, 'rotorn övervarvar inte nämnvärt');
  assert.equal(beyond.throttle.toFixed(3), triple.throttle.toFixed(3));
});

test('överlastvolymen är 1 vid hovring och växer med avtagande takt', () => {
  assert.equal(driveGain(0), 1);
  const [g1, g2] = [driveGain(1), driveGain(2)];
  assert.ok(g1 > 1.4 && g2 > g1);
  assert.ok(g2 - g1 < g1 - 1, '200 → 300 % ökar mindre än 100 → 200 %');
});
