// Bergen ska komma in från höger och passera under helikoptern ungefär när den
// når toppens höjd. Renderingen körs mot en tom canvas i 60 bilder/s.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const noop = () => {};
const ctx = new Proxy(
  {},
  {
    get: (_, k) =>
      k === 'measureText' ? () => ({ width: 100 }) : k.startsWith?.('create') ? () => ({ addColorStop: noop }) : noop,
    set: () => true,
  }
);
Object.assign(globalThis, {
  matchMedia: () => ({ addEventListener: noop }),
  getComputedStyle: () => ({ getPropertyValue: () => '#808080' }),
  devicePixelRatio: 1,
  // Konturer som både fylls och klipps (fjällkedjorna, helikopterns kabin)
  Path2D: function Path2D() {
    return new Proxy({}, { get: () => noop });
  },
});
const { GameRenderer } = await import('../public/game/view/render.js');
const { DEFAULT_MILESTONES } = await import('../public/game/core/milestones.js');

const W = 1600;
const H = 900;
const HELI_X = W * 0.4;

/** Flyger enligt climb(t) och returnerar helikopterns höjd minus toppens när varje topp passerar. */
function fly(climb, seconds, h0 = 700) {
  const r = new GameRenderer({ clientWidth: W, clientHeight: H, width: 0, height: 0, getContext: () => ctx });
  const rotor = { omega: 12, blur: 0.5, angle: 0, tailAngle: 0 };
  const dt = 1 / 60;
  let h = h0;
  const passed = new Map();
  for (let i = 0; i < seconds / dt; i++) {
    const vy = climb(i * dt);
    h += vy * dt;
    r.advance(dt, rotor, h);
    r.draw({ h, vy, rotor, hMax: h, todayBest: null, milestones: DEFAULT_MILESTONES, avoid: [], flying: true });
    for (const item of r.mountains) {
      const sx = W + item.entry - (r.distance - item.startAt);
      if (!passed.has(item.m.name) && sx <= HELI_X) passed.set(item.m.name, h - item.m.h);
    }
  }
  return [...passed.values()];
}

for (const rate of [8, 34]) {
  test(`jämn stigning ${rate} m/s: topparna passerar strax under helikoptern`, () => {
    const diffs = fly(() => rate, rate < 20 ? 90 : 40);
    assert.ok(diffs.length >= 5, `bara ${diffs.length} toppar passerade`);
    for (const d of diffs) assert.ok(d >= -5 && d <= 80, `topp passerade ${Math.round(d)} m från helikoptern`);
  });
}

test('från marken: bergen skickas inte in medan farten framåt ökar vid lyftet', () => {
  const diffs = fly(() => 15, 70, 0);
  assert.ok(diffs.length >= 1, 'ingen topp passerade');
  for (const d of diffs) assert.ok(d >= -5 && d <= 80, `topp passerade ${Math.round(d)} m från helikoptern`);
});

test('svävar man skickas inga nya berg in över helikoptern', () => {
  const diffs = fly((t) => (t < 12 ? 34 : 0), 60);
  const late = fly((t) => (t < 12 ? 34 : 0), 12).length;
  assert.equal(diffs.length - late <= 6, true); // bara de som redan var på väg in
});

test('övningar flygs utan framåtfart: landskapet och verkstan står still, inga berg', () => {
  const r = new GameRenderer({ clientWidth: W, clientHeight: H, width: 0, height: 0, getContext: () => ctx });
  const rotor = { omega: 12, blur: 0.5, angle: 0, tailAngle: 0 };
  for (let h = 0; h < 300; h += 1) {
    r.advance(1 / 60, rotor, h, false);
    r.draw({ h, vy: 60, rotor, hMax: h, todayBest: null, milestones: DEFAULT_MILESTONES, avoid: [], flying: true });
  }
  assert.equal(r.distance, 0);
  assert.equal(r.mountains.length, 0);
});

test('nytt pass börjar vid startplatsen', () => {
  const r = new GameRenderer({ clientWidth: W, clientHeight: H, width: 0, height: 0, getContext: () => ctx });
  r.advance(1, { omega: 12 }, 100);
  assert.ok(r.distance > 0);
  r.clearMountains();
  assert.equal(r.distance, 0);
});

test('skolans scen ritas: instruktören, ringar, moln, vinsch och helikoptern vid verkstan', async () => {
  const { stepGuides, getExercise } = await import('../public/game/core/exercise.js');
  const r = new GameRenderer({ clientWidth: W, clientHeight: H, width: 0, height: 0, getContext: () => ctx });
  const rotor = { omega: 12, blur: 0.5, angle: 0, tailAngle: 0 };
  const follow = { ...getExercise('follow').steps[1], t0: 0 };
  const rings = { ...getExercise('rings').steps[1], t0: 0, outcomes: [true, false] };
  const clouds = getExercise('clouds').steps[1];
  const views = [
    { guides: stepGuides(follow, 10).lines, buddyLivery: { body: '#00f', trim: '#fff', label: 'INSTR' } },
    { guides: stepGuides(rings, 12).lines },
    { blind: stepGuides(clouds).blind },
    { winch: { progress: 0.5, loaded: false } },
    { winch: { progress: 1, loaded: true } },
  ];
  for (const extra of views) {
    r.advance(1 / 60, rotor, 150, true, 320);
    r.draw({ h: 150, vy: 0, rotor, hMax: 0, todayBest: null, milestones: [], avoid: [], flying: true, workshop: true, parked: { body: '#f00', trim: '#fff', label: '112' }, ...extra });
  }
  r.celebrate();
  assert.ok(r.effects.particles.length > 0, 'konfetti');
});
