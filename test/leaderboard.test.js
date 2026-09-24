import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Leaderboard } from '../public/game/leaderboard.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}

test('sorteras på höjd, placering returneras och listan sparas', () => {
  const storage = memoryStorage();
  const lb = new Leaderboard(storage);
  lb.add({ name: 'A', hMax: 1000, tHMax: 100 });
  assert.equal(lb.add({ name: 'B', hMax: 3000, tHMax: 200 }).rank, 1);
  const c = lb.add({ name: 'C', hMax: 2000, tHMax: 150 });
  assert.deepEqual([c.rank, c.total], [2, 3]);
  assert.deepEqual(new Leaderboard(storage).top().map((e) => e.name), ['B', 'C', 'A']);
});

test('lika höjd: snabbast till h_max först', () => {
  const lb = new Leaderboard(memoryStorage());
  lb.add({ name: 'Långsam', hMax: 500, tHMax: 300 });
  lb.add({ name: 'Snabb', hMax: 500, tHMax: 120 });
  assert.equal(lb.top()[0].name, 'Snabb');
});

test('sparar aldrig vikt eller watt', () => {
  const storage = memoryStorage();
  const lb = new Leaderboard(storage);
  lb.add({ name: 'A', hMax: 10, tHMax: 1, klass: '', ts: 1, mass: 80, power: 250, P0: 100 });
  const [saved] = JSON.parse(storage.getItem('skierg.leaderboard.v1'));
  assert.deepEqual(Object.keys(saved).sort(), ['hMax', 'klass', 'name', 'tHMax', 'ts']);
});

test('dagens rekord', () => {
  const lb = new Leaderboard(memoryStorage());
  const now = new Date(2026, 8, 24, 12).getTime();
  lb.add({ name: 'Igår', hMax: 9000, tHMax: 1, ts: now - 86400000 });
  lb.add({ name: 'Idag', hMax: 1200, tHMax: 1, ts: now - 3600000 });
  assert.equal(lb.todayBest(now), 1200);
});

test('CSV citerar och skyddar mot formler', () => {
  const lb = new Leaderboard(memoryStorage());
  lb.add({ name: '=HYPERLINK("x")', hMax: 10, tHMax: 1, klass: 'Dam, 40+', ts: 0 });
  const [, row] = lb.toCSV().trim().split('\r\n');
  assert.equal(row, `1,"'=HYPERLINK(""x"")","Dam, 40+",10,1,1970-01-01T00:00:00.000Z`);
});

test('rensa', () => {
  const storage = memoryStorage();
  const lb = new Leaderboard(storage);
  lb.add({ name: 'A', hMax: 10, tHMax: 1 });
  lb.clear();
  assert.equal(new Leaderboard(storage).top().length, 0);
});

test('trasig lagring ger tom lista i stället för krasch', () => {
  const storage = memoryStorage();
  storage.setItem('skierg.leaderboard.v1', '{inte json');
  assert.equal(new Leaderboard(storage).top().length, 0);
});
