import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../public/game/core/config.js';
import { Flight } from '../public/game/core/physics.js';
import { EXERCISES, ExerciseRun, getExercise, starGuide } from '../public/game/core/exercise.js';
import { getHelicopter, helicopterConfig } from '../public/game/core/helicopters.js';
import { LESSONS, EXAM } from '../public/game/core/lessons.js';
import { runExercise } from '../public/game/core/sim.js';
import { autopilot } from '../public/game/core/autopilot.js';

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

test('skolhelikoptern: ingen fallbroms, faller som i fri flygning', () => {
  const f = new Flight(school, 80);
  for (let i = 0; i < 20 * 120; i++) f.step(f.P0 * 2);
  for (let i = 0; i < 20 * 5; i++) f.step(0);
  assert.ok(f.v < -20);
});

test('skolhelikoptern: stiger inte över taket', () => {
  const f = new Flight(school, 80);
  for (let i = 0; i < 20 * 600; i++) f.step(f.P0 * 3);
  assert.equal(f.hMax, 1500);
  assert.equal(f.h, 1500);
  for (let i = 0; i < 20 * 2; i++) f.step(0);
  assert.ok(f.h < 1500, 'kan sjunka från taket');
});

test('utan tak är fysiken som förut', () => {
  const f = new Flight(DEFAULT_CONFIG, 80);
  for (let i = 0; i < 20 * 600; i++) f.step(f.P0 * 3);
  assert.ok(f.hMax > 1500);
});

test('sättningen registreras med farten', () => {
  const f = new Flight(school, 80);
  for (let i = 0; i < 20 * 10; i++) f.step(f.P0 * 1.2);
  assert.equal(f.touchdown, null);
  while (f.h > 0) f.step(0);
  assert.ok(f.touchdown.speed > 0 && f.touchdown.speed <= 25);
  assert.ok(f.touchdown.t <= f.t && f.touchdown.t > f.t - school.dt);
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

/** Piloten drar direkt när helikoptern passerat 700 m, alltså ovanför hämtgränsen 650 m. */
function earlyCatcher() {
  const pilot = autopilot();
  return (s) => {
    const { step, flight: f } = s;
    if (step.type !== 'freefall' || step.phase !== 'falling') return pilot(s);
    return f.h <= 700 ? f.requiredPower() * 1.1 : null;
  };
}

test('fritt fall: att hämta upp före gränsen ger nytt försök, inte underkänt', () => {
  let feedback = null;
  const pilot = earlyCatcher();
  const run = runExercise(school, 80, getExercise('freefall'), (s) => {
    feedback ??= s.step.feedback;
    return pilot(s);
  });
  // Piloten drar alltid för tidigt, så övningen tar slut på tid – efter flera försök.
  assert.equal(run.status, 'failed');
  assert.equal(run.failReason, 'Tiden är ute');
  assert.ok(run.step.attempts >= 2, `försök: ${run.step.attempts}`);
  assert.match(feedback, /För tidigt! Hämta upp först under 650 m/);
});

test('fritt fall: hämtningen mäts från gränsen tills helikoptern slutar sjunka', () => {
  const run = runExercise(school, 80, getExercise('freefall'), autopilot());
  const r = run.results.at(-1);
  assert.equal(run.status, 'passed');
  assert.ok(r.catchS > 0.5 && r.catchS < 6, `hämtad på ${r.catchS} s`);
  assert.ok(r.depth > 0 && r.depth < 200, `${r.depth} m under gränsen`);
  assert.ok(r.stars >= 1 && r.stars <= 3);
});

test('fritt fall: drar man inte alls tar instruktören över – helikoptern slår aldrig i marken', () => {
  const pilot = autopilot();
  let lowest = Infinity;
  let takeovers = 0;
  const run = runExercise(school, 80, getExercise('freefall'), (s) => {
    if (s.step.type === 'freefall' && s.step.phase === 'falling') return null;
    if (s.step.type === 'freefall' && s.step.phase === 'takeover') {
      lowest = Math.min(lowest, s.flight.h);
      takeovers += s.run.takeover ? 0 : 1;
    }
    return pilot(s);
  });
  assert.equal(run.status, 'failed');
  assert.equal(run.failReason, 'Tiden är ute');
  assert.ok(run.step.attempts >= 2, 'nytt försök efter övertagandet');
  assert.ok(lowest > 300, `lägst ${Math.round(lowest)} m`);
});

test('fritt fall: instruktören bromsar och lämnar tillbaka när man drar själv', () => {
  const f = new Flight(school, 80);
  f.h = 440;
  f.v = -25;
  const run = new ExerciseRun({ id: 'x', name: 'x', maxS: 999, steps: [{ type: 'freefall', from: 1000, gate: 650, floor: 450 }] });
  run.step = null;
  run.update(f, 0); // armed, faller under golvet → säkerhet
  assert.equal(run.takeover, true);
  for (let i = 0; i < 20 * 5; i++) {
    f.step(run.effectivePower(0, f));
    run.update(f, 0);
  }
  assert.ok(f.h > 380 && f.v >= -0.5, `h ${f.h}, v ${f.v}`);
  assert.equal(run.takeover, true, 'håller höjden tills man drar');
  f.step(run.effectivePower(f.requiredPower(), f));
  run.update(f, f.requiredPower());
  assert.equal(run.takeover, false);
  assert.deepEqual(run.takeEvents().map((e) => e.type), ['takeover', 'handback']);
});

test('fritt fall: att släppa för lågt räknas inte', () => {
  const run = new ExerciseRun({ name: 'x', maxS: 999, steps: [{ type: 'freefall', from: 1000, gate: 650, floor: 450 }] });
  run.update({ t: 0.05, h: 800, v: -5, onGround: false }, 0);
  assert.equal(run.step.phase, 'armed');
  assert.match(run.instruction, /För lågt/);
  run.update({ t: 0.1, h: 1005, v: -5, onGround: false }, 0);
  assert.equal(run.step.phase, 'falling');
});

test('hissen: tre hämtningar i rad', () => {
  const run = runExercise(school, 80, getExercise('elevator'), autopilot());
  assert.equal(run.status, 'passed', run.failReason);
  assert.equal(run.step.catches.length, 3);
});

test('sen hämtning: lägre gräns och mindre utrymme än fritt fall', () => {
  const ff = getExercise('freefall').steps[1];
  const late = getExercise('late-catch').steps[1];
  assert.ok(late.gate < ff.gate && late.gate - late.floor < ff.gate - ff.floor);
  assert.ok(late.floor >= 200, 'gott om plats under golvet');
});

test('motorstopp: dragen gör ingenting medan motorn står, och uppflygningen underkänner ett övertagande', () => {
  let offSeen = false;
  const pilot = autopilot();
  const run = runExercise(school, 80, EXAM, (s) => {
    if (s.run.engineOff) offSeen = true;
    if (s.step.type === 'engineout' && s.step.phase === 'restart') return null; // hämtar aldrig upp
    return pilot(s);
  });
  assert.ok(offSeen);
  const engine = run.moments.find((x) => x.id === 'exam-engine');
  assert.equal(engine.status, 'failed');
  assert.match(engine.failReason, /instruktören fick ta över/);
  assert.equal(run.status, 'failed');
  assert.ok(run.moments.length === EXAM.moments.length, 'uppflygningen fortsätter till sista momentet');
});

test('sandsäcken gör helikoptern tyngre tills momentet är slut', () => {
  const f = new Flight(school, 80);
  const P0 = f.P0;
  f.setLoad(0.2);
  assert.ok(Math.abs(f.P0 - P0 * 1.2) < 1e-9);
  const run = runExercise(school, 80, getExercise('sandbag'), autopilot());
  assert.equal(run.status, 'passed', run.failReason);
});

test('följ instruktören och ringbanan klaras av autopiloten', () => {
  for (const id of ['follow', 'rings']) {
    const run = runExercise(school, 80, getExercise(id), autopilot());
    assert.equal(run.status, 'passed', `${id}: ${run.failReason}`);
  }
});

test('ringbanan: missar man ringarna blir det underkänt', () => {
  const pilot = autopilot();
  const run = runExercise(school, 80, getExercise('rings'), (s) => (s.step.type === 'rings' ? s.flight.requiredPower(130) : pilot(s)));
  assert.equal(run.status, 'failed');
  assert.match(run.failReason, /ringar \(minst 7\)/);
});

test('lektion: momenten flygs i följd och ett misslyckat moment stoppar inte lektionen', () => {
  const pilot = autopilot();
  const run = runExercise(school, 80, LESSONS[0], (s) =>
    s.step.type === 'land' && s.run.moment.id === 'first-lift' ? s.flight.P0 * 0.2 : pilot(s)
  );
  assert.equal(run.status, 'passed', 'lektionen är genomförd');
  assert.deepEqual(run.moments.map((x) => [x.id, x.status]), [['first-lift', 'failed'], ['bounce', 'passed'], ['hover', 'passed']]);
  assert.equal(run.moments[0].stars, 0);
});

for (const item of [...LESSONS, EXAM]) {
  test(`${item.name}: autopiloten klarar allt (30 och 120 kg)`, () => {
    for (const mass of [30, 120]) {
      const run = runExercise(school, mass, item, autopilot());
      assert.equal(run.status, 'passed', run.failReason);
      assert.ok(run.moments.every((x) => x.status === 'passed'), run.moments.map((x) => x.failReason).join(', '));
    }
  });
}

test('uppflygningen: för tidig hämtning underkänner direkt, utan nytt försök', () => {
  const pilot = autopilot();
  const run = runExercise(school, 80, EXAM, (s) =>
    s.step.type === 'freefall' && s.step.phase === 'falling' && s.flight.h < 700 ? s.flight.P0 * 2 : pilot(s)
  );
  const ff = run.moments.find((x) => x.id === 'exam-freefall');
  assert.equal(ff.status, 'failed');
  assert.match(ff.failReason, /För tidigt/);
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
  const { stepGuides } = await import('../public/game/core/exercise.js');
  assert.deepEqual(stepGuides(null), { lines: [], landingPad: false, blind: false });
  assert.equal(stepGuides({ type: 'climb', to: 50 }).lines[0].h, 50);
  const hover = stepGuides({ type: 'hover', at: 300, tol: 25, holdS: 30, held: 15 }).lines[0];
  assert.deepEqual([hover.lo, hover.hi, hover.progress, hover.ring], [275, 325, 0.5, true]);
  assert.equal(stepGuides({ type: 'land', maxSpeed: 2 }).landingPad, true);
  const armed = stepGuides({ type: 'freefall', from: 1000, gate: 650, floor: 450, phase: 'armed' }).lines;
  assert.deepEqual(armed.map((l) => l.kind), ['line', 'band']);
  const falling = stepGuides({ type: 'freefall', from: 1000, gate: 650, floor: 450, phase: 'falling' }).lines;
  assert.deepEqual([falling.length, falling[0].lo, falling[0].hi, falling[0].ring], [1, 450, 650, undefined]);
  assert.equal(stepGuides({ type: 'hover', at: 350, tol: 30, holdS: 30, blind: true }).blind, true);
  assert.equal(stepGuides({ type: 'hover', at: 350, tol: 30, holdS: 30, blind: true }).lines.length, 0);
  const buddy = stepGuides({ type: 'follow', tol: 25, t0: 10, path: [[0, 150], [10, 250]] }, 20).lines[0];
  assert.deepEqual([buddy.kind, buddy.h], ['buddy', 250]);
  const rings = stepGuides({ type: 'rings', tol: 30, t0: 0, outcomes: [true], rings: [{ t: 8, h: 130 }, { t: 16, h: 170 }] }, 10).lines;
  assert.deepEqual(rings.map((r) => [r.inS, r.hit]), [[-2, true], [6, undefined]]);
});

test('stjärnkraven per steg: samma gränser som bedömningen', () => {
  const hover = starGuide({ type: 'hover', at: 300, tol: 25, holdS: 30 });
  assert.deepEqual(hover.map((l) => l.stars), [3, 2, 1]);
  assert.deepEqual(hover.map((l) => l.text), ['i snitt inom 7,5 m från målet', 'i snitt inom 13,8 m', 'inom ±25 m']);
  assert.equal(starGuide({ type: 'land', maxSpeed: 2 })[0].text, 'sätt ner under 0,6 m/s');
  assert.equal(starGuide({ type: 'freefall', from: 1000, gate: 650, floor: 450 })[0].text, 'vänd inom 70 m under gränsen');
  assert.equal(starGuide({ type: 'climb', to: 50 }), null);
  assert.equal(starGuide({ type: 'hover', at: 150, tol: 25, holdS: 3, unscored: true }), null);
  assert.equal(starGuide(null), null);
});
