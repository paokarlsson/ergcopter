import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../public/game/config.js';
import { Flight } from '../public/game/physics.js';
import { EXERCISES, ExerciseRun, getExercise } from '../public/game/exercise.js';
import { getHelicopter, helicopterConfig } from '../public/game/helicopters.js';
import { runExercise } from '../public/game/sim.js';
import { autopilot } from '../tools/autopilot.js';

const school = helicopterConfig(DEFAULT_CONFIG, getHelicopter('school'));

for (const mass of [30, 80, 120]) {
  for (const ex of EXERCISES) {
    test(`${ex.name}: autopiloten klarar övningen i skolhelikoptern (${mass} kg)`, () => {
      const run = runExercise(school, mass, ex, autopilot());
      assert.equal(run.status, 'passed', run.failReason);
      assert.equal(run.results.length, ex.steps.length);
    });
  }
}

test('skolhelikoptern: fallbromsen håller sjunkhastigheten på 15 m/s', () => {
  const f = new Flight(school, 80);
  for (let i = 0; i < 20 * 120; i++) f.step(f.P0 * 2);
  for (let i = 0; i < 20 * 5; i++) f.step(0);
  assert.equal(f.v, -15);
});

test('skolhelikoptern: stiger inte över taket', () => {
  const f = new Flight(school, 80);
  for (let i = 0; i < 20 * 600; i++) f.step(f.P0 * 3);
  assert.equal(f.hMax, 1500);
  assert.equal(f.h, 1500);
  f.step(0);
  assert.ok(f.h < 1500, 'kan sjunka från taket');
});

test('utan tak eller fallbroms är fysiken som förut', () => {
  const f = new Flight(DEFAULT_CONFIG, 80);
  for (let i = 0; i < 20 * 600; i++) f.step(f.P0 * 3);
  assert.ok(f.hMax > 1500);
});

test('sättningen registreras med farten', () => {
  const f = new Flight(school, 80);
  for (let i = 0; i < 20 * 10; i++) f.step(f.P0 * 1.2);
  assert.equal(f.touchdown, null);
  while (f.h > 0) f.step(0);
  assert.ok(f.touchdown.speed > 0 && f.touchdown.speed <= 15);
  assert.ok(Math.abs(f.touchdown.t - f.t) < 1e-9);
});

test('hård landning underkänner övningen', () => {
  const pilot = autopilot();
  const run = runExercise(school, 80, getExercise('first-lift'), (s) =>
    s.step.type === 'land' ? s.flight.P0 * 0.2 : pilot(s)
  );
  assert.equal(run.status, 'failed');
  assert.match(run.failReason, /Hård landning/);
  assert.ok(run.results.length === 1);
});

test('hovringen räknas i sträck: att lämna bandet nollställer tiden', () => {
  const run = new ExerciseRun({ name: 'x', maxS: 999, steps: [{ type: 'hover', at: 100, tol: 10, holdS: 5 }] });
  const f = { t: 0, h: 100, v: 0 };
  const tick = (h, s) => {
    for (let i = 0; i < s * 20; i++) {
      f.t += 0.05;
      f.h = h;
      run.update(f, 1);
    }
  };
  tick(100, 4);
  tick(150, 0.1);
  assert.equal(run.step.held, 0);
  tick(95, 4.9);
  assert.equal(run.status, 'running');
  tick(105, 0.2);
  assert.equal(run.status, 'passed');
});

/** Piloten fångar upp helikoptern direkt när den passerat 700 m, alltså för tidigt, och stiger sedan snabbt igen. */
function earlyCatcher() {
  const pilot = autopilot();
  return (s) => {
    const { step, flight: f } = s;
    if (step.type !== 'freefall') return pilot(s);
    if (step.phase === 'falling') return f.h <= 700 ? f.requiredPower() * 1.1 : null;
    return f.h < step.from - step.tol ? f.P0 * 2 : null;
  };
}

test('fritt fall: för tidigt uppfångad ger nytt försök, inte underkänt', () => {
  const run = runExercise(school, 80, getExercise('freefall'), earlyCatcher());
  // Piloten fångar alltid för tidigt, så övningen tar slut på tid – efter flera försök.
  assert.equal(run.status, 'failed');
  assert.equal(run.failReason, 'Tiden är ute');
  assert.ok(run.step.attempts >= 2, `försök: ${run.step.attempts}`);
});

test('fritt fall: återkopplingen säger för tidigt', () => {
  const ex = getExercise('freefall');
  let feedback = null;
  const pilot = earlyCatcher();
  runExercise(school, 80, ex, (s) => {
    feedback ??= s.step.feedback;
    return pilot(s);
  });
  assert.match(feedback, /För tidigt: fångad på/);
});

test('fritt fall: att slå i marken underkänner', () => {
  const pilot = autopilot();
  const run = runExercise(school, 80, getExercise('freefall'), (s) =>
    s.step.type === 'freefall' && s.step.phase === 'falling' ? null : pilot(s)
  );
  assert.equal(run.status, 'failed');
  assert.match(run.failReason, /marken/);
});

test('fritt fall: att släppa för lågt räknas inte', () => {
  const run = new ExerciseRun({ name: 'x', maxS: 999, steps: [{ type: 'freefall', from: 1000, to: 500, tol: 50 }] });
  run.update({ t: 0.05, h: 800, v: -5, onGround: false }, 0);
  assert.equal(run.step.phase, 'armed');
  assert.match(run.instruction, /För lågt/);
  run.update({ t: 0.1, h: 960, v: -5, onGround: false }, 0);
  assert.equal(run.step.phase, 'falling');
});

test('tidsgränsen underkänner', () => {
  const run = runExercise(school, 80, getExercise('hover'), () => null);
  assert.equal(run.status, 'failed');
  assert.equal(run.failReason, 'Tiden är ute');
  assert.ok(Math.abs(run.durationS - 240) < 0.1);
});

test('flera steg kan klaras i samma tidssteg', () => {
  const run = new ExerciseRun({
    name: 'x',
    maxS: 999,
    steps: [
      { type: 'climb', to: 50 },
      { type: 'climb', to: 60 },
    ],
  });
  run.update({ t: 0.05, h: 70, v: 1 }, 1);
  assert.equal(run.status, 'passed');
  assert.equal(run.instruction, 'Godkänd!');
});

test('hjälplinjer per steg', async () => {
  const { stepGuides } = await import('../public/game/exercise.js');
  assert.deepEqual(stepGuides(null), { lines: [], landingPad: false });
  assert.equal(stepGuides({ type: 'climb', to: 50 }).lines[0].h, 50);
  const hover = stepGuides({ type: 'hover', at: 300, tol: 25, holdS: 30, held: 15 }).lines[0];
  assert.deepEqual([hover.lo, hover.hi, hover.progress], [275, 325, 0.5]);
  assert.equal(stepGuides({ type: 'land', maxSpeed: 2 }).landingPad, true);
  const armed = stepGuides({ type: 'freefall', from: 1000, to: 500, tol: 50, phase: 'armed' }).lines;
  assert.deepEqual(armed.map((l) => l.kind), ['line', 'band']);
  assert.equal(stepGuides({ type: 'freefall', from: 1000, to: 500, tol: 50, phase: 'falling' }).lines.length, 1);
});
