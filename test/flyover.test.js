// Bergen ska komma in från höger och passera under helikoptern ungefär när den
// når toppens höjd. Renderingen körs mot en tom canvas i 60 bilder/s.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const noop = () => {};
const ctx = new Proxy(
  {},
  {
    get: (_, k) =>
      k === 'measureText' ? () => ({ width: 100 }) : k === 'createLinearGradient' ? () => ({ addColorStop: noop }) : noop,
    set: () => true,
  }
);
Object.assign(globalThis, {
  matchMedia: () => ({ addEventListener: noop }),
  getComputedStyle: () => ({ getPropertyValue: () => '#808080' }),
  devicePixelRatio: 1,
});
const { GameRenderer } = await import('../public/game/render.js');
const { DEFAULT_MILESTONES } = await import('../public/game/milestones.js');

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

test('svävar man skickas inga nya berg in över helikoptern', () => {
  const diffs = fly((t) => (t < 12 ? 34 : 0), 60);
  const late = fly((t) => (t < 12 ? 34 : 0), 12).length;
  assert.equal(diffs.length - late <= 6, true); // bara de som redan var på väg in
});
