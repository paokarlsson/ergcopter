import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../public/game/core/config.js';
import { Flight, analyticHeight } from '../public/game/core/physics.js';
import { runPhysicsOnly } from '../public/game/core/sim.js';

// Grundspelets parametrar (spec §5). Standardvärdena för blandad publik (spec §12) testas i defaults.test.js.
const cfg = { ...DEFAULT_CONFIG, P_ref: 100, H_air: 2700, G: 22.5 };

// Spec §5, referenstabellen (80 kg, k = 1): den analytiska lösningen
const REFERENCE = [
  [3, 500, 267],
  [30, 350, 1493],
  [180, 260, 3356],
  [300, 245, 3594],
  [600, 225, 3352],
  [3600, 200, 2700],
];

for (const [s, w, expected] of REFERENCE) {
  test(`analytiskt: konstant ${w} W i ${s} s från marken ≈ ${expected} m (±0,5 %)`, () => {
    const analytic = analyticHeight(cfg, 100, w, s);
    assert.ok(Math.abs(analytic - expected) / expected < 0.005, `analytisk ${analytic.toFixed(1)} vs tabell ${expected}`);
  });
}

test('fysiken följer den analytiska lösningen: inom 1 % från 3 min, inom 7 % på 30 s', () => {
  for (const [s, w] of REFERENCE.filter(([s]) => s >= 30)) {
    const { hMax } = runPhysicsOnly(cfg, 80, [{ s, w }]);
    const analytic = analyticHeight(cfg, 100, w, s);
    const diff = Math.abs(hMax - analytic) / analytic;
    assert.ok(diff < (s < 180 ? 0.07 : 0.01), `${s} s @ ${w} W: ${hMax.toFixed(0)} m, analytiskt ${analytic.toFixed(0)} m`);
  }
});

test('korta spurter tappar: rotorn och helikoptern måste först komma upp i fart', () => {
  const { hMax } = runPhysicsOnly(cfg, 80, [{ s: 3, w: 500 }]);
  const analytic = analyticHeight(cfg, 100, 500, 3);
  assert.ok(hMax > 0.4 * analytic && hMax < 0.8 * analytic, `3 s @ 500 W: ${hMax.toFixed(0)} m av ${analytic.toFixed(0)} m`);
});

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
  for (let i = 0; i < 20 * 3; i++) f.step(0);
  assert.ok(f.v < 0, 'sjunker inom 3 s');
  for (let i = 0; i < 20 * 600 && f.h > 0; i++) f.step(0);
  assert.equal(f.h, 0);
  for (let i = 0; i < 100; i++) f.step(0);
  assert.equal(f.h, 0);
  assert.equal(f.v, 0);
});

test('står kvar på marken vid P0 och lättar över P0', () => {
  const f = new Flight(cfg, 80);
  for (let i = 0; i < 20 * 30; i++) f.step(100);
  assert.equal(f.h, 0);
  for (let i = 0; i < 20 * 10; i++) f.step(102);
  assert.ok(f.h > 0);
});

test('rotorn står still vid start och varvar upp med motorn', () => {
  const f = new Flight(cfg, 80);
  assert.equal(f.rotorSpeed, 0);
  for (let i = 0; i < 20 * 5; i++) f.step(50);
  assert.ok(Math.abs(f.rotorSpeed - Math.cbrt(0.5)) < 0.01, `varv ${f.rotorSpeed.toFixed(3)}`);
});

test('maxSinkRate begränsar sjunkhastigheten', () => {
  const f = new Flight({ ...cfg, maxSinkRate: 5 }, 80);
  for (let i = 0; i < 20 * 60; i++) f.step(300);
  for (let i = 0; i < 20 * 10; i++) f.step(0);
  assert.equal(f.v, -5);
});

test('lyftmätaren: P/P0 på marken, P/P_req(h) i luften', () => {
  const f = new Flight(cfg, 80);
  assert.equal(f.liftRatio(50), 0.5);
  for (let i = 0; i < 20 * 60; i++) f.step(250);
  assert.ok(Math.abs(f.liftRatio(f.requiredPower()) - 1) < 1e-12);
});

// Rotorn och helikoptern (spec §5) med standardvärdena: g 15 m/s², rotorbladens massa 0,5 s.
const std = { ...DEFAULT_CONFIG };

/** Flygning som hovrar på höjden h. */
function hovering(c, h) {
  const f = new Flight(c, 80);
  f.hoverAt(h);
  return f;
}

test('hovring på höjden h kräver exakt P0 · (1 + h / H_air), och rotorn snurrar fortare i tunn luft', () => {
  for (const h of [50, 1000, 5000]) {
    const f = hovering(std, h);
    for (let i = 0; i < 20 * 60; i++) f.step(f.requiredPower(h));
    assert.ok(Math.abs(f.h - h) < 1e-6, `${h} m: ${f.h} m`);
    assert.ok(Math.abs(f.thrustRatio - 1) < 1e-9);
    assert.ok(Math.abs(f.rotorSpeed - (1 + h / std.H_air)) < 1e-9, `varv ${f.rotorSpeed}`);
  }
});

test('stadig stigning: v = G · (P − P_req) / P0', () => {
  const f = hovering(std, 1000);
  const power = f.requiredPower() + 30;
  for (let i = 0; i < 20 * 20; i++) f.step(power);
  assert.ok(Math.abs(f.v - f.targetSpeed(power)) < 0.3, `${f.v.toFixed(2)} m/s, stadig ${f.targetSpeed(power).toFixed(2)} m/s`);
});

test('bladen har massa: motoreffekten byter direkt men varvet gör det inte', () => {
  const rotor = (rotorTauS) => {
    const f = new Flight({ ...std, rotorTauS }, 80); // på marken under P0, så helikoptern står still
    for (let i = 0; i < 20 * 40; i++) f.step(0.3 * f.P0);
    const from = f.rotorSpeed;
    const to = Math.cbrt(0.8);
    const share = () => (f.rotorSpeed - from) / (to - from);
    f.step(0.8 * f.P0);
    const first = share();
    for (let i = 1; i < 20 * 2; i++) f.step(0.8 * f.P0);
    return { first, after2s: share() };
  };
  const light = rotor(0.5);
  assert.ok(light.first < 0.15, `efter ett tidssteg: ${(light.first * 100).toFixed(0)} %`);
  assert.ok(light.after2s > 0.9, `efter 2 s: ${(light.after2s * 100).toFixed(0)} %`);
  const heavy = rotor(2);
  assert.ok(heavy.after2s < 0.7, `tunga blad efter 2 s: ${(heavy.after2s * 100).toFixed(0)} %`);
});

test('bladen har massa åt andra hållet: varvet sjunker gradvis när effekten minskar', () => {
  const f = new Flight(std, 80);
  for (let i = 0; i < 20 * 40; i++) f.step(0.8 * f.P0);
  const from = f.rotorSpeed;
  f.step(0.3 * f.P0);
  assert.ok(from - f.rotorSpeed < 0.15 * (from - Math.cbrt(0.3)));
});

test('utan motor: rotorn bär en stund, sedan faller helikoptern och autorotationen bromsar fallet', () => {
  const f = hovering(std, 1000);
  for (let i = 0; i < 20 * 0.5; i++) f.step(0);
  assert.ok(f.v > -3, `efter 0,5 s: ${f.v.toFixed(1)} m/s`);
  for (let i = 0; i < 20 * 2.5; i++) f.step(0);
  assert.ok(f.v < -15, `efter 3 s: ${f.v.toFixed(1)} m/s`);
  for (let i = 0; i < 20 * 17; i++) f.step(0);
  assert.ok(Math.abs(f.v - f.targetSpeed(0)) < 3, `efter 20 s: ${f.v.toFixed(1)} m/s, autorotation ${f.targetSpeed(0).toFixed(1)} m/s`);
  assert.ok(f.rotorSpeed > 0.9 * (1 + f.h / std.H_air), 'rotorn snurrar vidare i fallet');
});

test('i hög fart nedåt fortsätter helikoptern sjunka en stund trots överskott', () => {
  const f = hovering(std, 1500);
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

test('jämviktshöjden är H_air · (P / P0 − 1)', () => {
  const f = new Flight(std, 80);
  for (let i = 0; i < 20 * 3600; i++) f.step(90);
  assert.ok(Math.abs(f.h - std.H_air * (90 / 60 - 1)) < 0.5, `${f.h.toFixed(1)} m`);
});

test('sättningen mäts med farten i nedslaget', () => {
  const f = hovering(std, 50);
  for (let i = 0; i < 20 * 20 && !f.touchdown; i++) f.step(0);
  assert.ok(f.touchdown && f.touchdown.speed > 3);
  assert.ok(f.touchdown.t <= f.t && f.touchdown.t > f.t - std.dt);
  assert.equal(f.v, 0);
});

test('last: helikoptern sjunker när lasten hakas på, och hovrar på det nya behovet', () => {
  const f = hovering(std, 150);
  f.setLoad(0.2);
  assert.ok(f.thrustRatio < 1);
  for (let i = 0; i < 20 * 2; i++) f.step(f.requiredPower(150));
  assert.ok(f.v < 0, 'sjunker först');
  for (let i = 0; i < 20 * 60; i++) f.step(f.requiredPower(150));
  assert.ok(Math.abs(f.v) < 0.05, `står still igen: ${f.v.toFixed(3)} m/s`);
  const g = hovering(std, 150);
  g.setLoad(0.2);
  g.hoverAt(150);
  for (let i = 0; i < 20 * 30; i++) g.step(g.requiredPower(150));
  assert.ok(Math.abs(g.h - 150) < 1e-6);
});

test('kopian är oberoende', () => {
  const f = hovering(std, 300);
  const c = f.clone();
  for (let i = 0; i < 20 * 5; i++) c.step(0);
  assert.equal(f.h, 300);
  assert.ok(c.h < 300);
  assert.equal(f.t, 0);
});

test('mjuk sättning: farten i första nedslaget gäller, inte ett skutt efteråt', () => {
  const f = hovering(std, 5);
  const power = () => f.requiredPower() - (0.8 * f.P0) / std.G; // sjunker stadigt 0,8 m/s
  for (let i = 0; i < 20 * 20 && !f.touchdown; i++) f.step(power());
  for (let i = 0; i < 20; i++) f.step(power());
  assert.ok(f.touchdown && Math.abs(f.touchdown.speed - 0.8) < 0.05, `sättning ${f.touchdown?.speed.toFixed(3)} m/s`);
});
