// Med 3D-landskapet står milstolparnas toppar långt bort och glider in från höger.
// De ska synas i bild, strax höger om helikoptern, när helikoptern når toppens höjd.
// Renderingen körs i 60 bilder/s mot en tom canvas och ett låtsat 3D-landskap.
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
let clock = 0; // s, renderingens klocka följer simuleringen
Object.assign(globalThis, {
  matchMedia: () => ({ addEventListener: noop }),
  getComputedStyle: () => ({ getPropertyValue: () => '#808080' }),
  devicePixelRatio: 1,
  Path2D: function Path2D() {
    return new Proxy({}, { get: () => noop });
  },
});
const realNow = performance.now.bind(performance);
const { GameRenderer } = await import('../public/game/view/render.js');
const { PLANE_M } = await import('../public/game/view/terrain.js');
const { DEFAULT_MILESTONES } = await import('../public/game/core/milestones.js');

const W = 1600;
const H = 900;
const HELI_X = W * 0.4;
const FOCAL = ((H * 0.8) / 300) * PLANE_M;

/** Flyger enligt climb(t, h) och returnerar var varje topp var i bild (x) när den passerades. */
function fly(climb, seconds) {
  const views = [];
  const terrain = { ready: true, canvas: { style: {} }, render: (v) => views.push(v) };
  const r = new GameRenderer({ clientWidth: W, clientHeight: H, width: 0, height: 0, getContext: () => ctx }, { terrain });
  const rotor = { omega: 12, blur: 0.5, angle: 0, tailAngle: 0 };
  const dt = 1 / 60;
  let h = 0;
  const passed = new Map();
  performance.now = () => clock * 1000;
  try {
    for (let i = 0; i < seconds / dt; i++) {
      clock = i * dt;
      const vy = climb(clock, h);
      const before = h;
      h = Math.max(0, h + vy * dt);
      r.advance(dt, rotor, h);
      r.draw({ h, vy, rotor, hMax: h, todayBest: null, milestones: DEFAULT_MILESTONES, avoid: [], flying: true });
      const camX = views.at(-1).camX;
      for (const p of r.peaks.items) {
        if (before < p.m.h && h >= p.m.h) passed.set(p.m.name, HELI_X + ((p.x - camX) * FOCAL) / p.z);
      }
    }
  } finally {
    performance.now = realNow;
  }
  return { passed, h, views };
}

test('jämn stigning: varje topp passeras i bild strax höger om helikoptern', () => {
  const { passed, h } = fly(() => 8, 300);
  const reached = DEFAULT_MILESTONES.filter((m) => m.h <= h);
  assert.equal(passed.size, reached.length, 'alla toppar vi nådde ska ha visats');
  for (const [name, sx] of passed) assert.ok(sx > HELI_X && sx < HELI_X + 300, `${name} passerades vid x = ${Math.round(sx)}`);
});

test('som i tunnare luft: allt långsammare stigning, topparna hinner ändå fram', () => {
  const { passed, h } = fly((t, h) => Math.max(1, 30 * 2 ** (-h / 900) - 3), 400);
  assert.ok(h > 2000);
  assert.equal(passed.size, DEFAULT_MILESTONES.filter((m) => m.h <= h).length);
  for (const [name, sx] of passed) assert.ok(sx > HELI_X && sx < HELI_X + 300, `${name} passerades vid x = ${Math.round(sx)}`);
});

test('stiga, sväva, stiga: topparna syns när de passeras', () => {
  const { passed } = fly((t) => (t % 60 < 40 ? 12 : 0), 300);
  assert.ok(passed.size >= 10);
  for (const [name, sx] of passed) assert.ok(sx > 0 && sx < W - 100, `${name} passerades vid x = ${Math.round(sx)}`);
});

test('landskapet får topparna, plattan och kameran på helikopterns höjd', () => {
  const { views } = fly((t) => (t < 50 ? 12 : 0), 55);
  const v = views.at(-1);
  assert.ok(Math.abs(v.camY - 600) < 1e-6, `kameran på ${v.camY} m`);
  assert.equal(v.cx, HELI_X);
  assert.ok(Math.abs(v.focal / FOCAL - 1) < 0.01, `brännvidden ${v.focal}`); // nästan ingen utzoomning
  assert.deepEqual([v.pad.x, v.pad.z], [0, PLANE_M]);
  assert.ok(v.peaks.length > 0 && v.peaks.every((p) => p.h > 0 && p.z > PLANE_M && p.r > 0));
});

test('svävar man skickas inga nya toppar in', () => {
  const r = fly((t) => (t < 20 ? 12 : 0), 120);
  const count = r.views.at(-1).peaks.length;
  const sent = fly((t) => (t < 20 ? 12 : 0), 20).views.at(-1).peaks.length;
  assert.ok(count <= sent, `${count} toppar efter svävandet, ${sent} när det började`);
});
