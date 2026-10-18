import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CADENCE_ZERO_AFTER_S,
  CadenceTracker,
  IndoorBikeDataJoiner,
  isPedalling,
  parseCyclingPower,
  parseIndoorBikeData,
} from '../public/shared/sources/bike-data.js';

const fromHex = (s) => new DataView(new Uint8Array(s.split(' ').map((b) => parseInt(b, 16))).buffer);
const close = (a, b, eps = 0.1) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('FTMS: hastighet (bit 0 noll), kadens och effekt', () => {
  assert.deepEqual(parseIndoorBikeData(fromHex('44 00 54 0b b4 00 fa 00')), { moreData: false, speed: 29, cadence: 90, power: 250 });
});

test('FTMS: alla fält i bitordning', () => {
  const d = parseIndoorBikeData(fromHex('fe 1f e8 03 84 03 a0 00 96 00 45 23 01 fb ff 2c 01 18 01 7b 00 58 02 0a 91 34 10 0e 3c 00'));
  assert.equal(d.moreData, false);
  close(d.speed, 10, 1e-9);
  close(d.avgSpeed, 9, 1e-9);
  close(d.met, 5.2, 1e-9);
  for (const [k, v] of Object.entries({
    cadence: 80, avgCadence: 75, distance: 0x012345, resistance: -5, power: 300, avgPower: 280,
    energyTotal: 123, energyPerHour: 600, energyPerMinute: 10, heartRate: 145, elapsed: 3600, remaining: 60,
  })) assert.equal(d[k], v, k);
});

test('FTMS: negativ effekt läses som sint16', () => {
  assert.equal(parseIndoorBikeData(fromHex('40 00 00 00 ec ff')).power, -20);
});

test('FTMS: ingen hastighet när More Data är satt', () => {
  assert.deepEqual(parseIndoorBikeData(fromHex('41 00 2c 01')), { moreData: true, power: 300 });
});

test('FTMS: för kort värde kastar RangeError', () => {
  assert.throws(() => parseIndoorBikeData(fromHex('44 00 54 0b b4')), RangeError);
});

test('FTMS: en post delad på två notiser sätts ihop', () => {
  const j = new IndoorBikeDataJoiner();
  assert.equal(j.push(parseIndoorBikeData(fromHex('41 00 2c 01'))), null);
  assert.deepEqual(j.push(parseIndoorBikeData(fromHex('04 00 54 0b b4 00'))), { power: 300, speed: 29, cadence: 90 });
});

test('FTMS: trainer som sätter More Data på varje notis ger ändå poster', () => {
  const j = new IndoorBikeDataJoiner();
  assert.equal(j.push(parseIndoorBikeData(fromHex('41 00 2c 01'))), null);
  assert.deepEqual(j.push(parseIndoorBikeData(fromHex('41 00 2d 01'))), { power: 300 });
  assert.deepEqual(j.push(parseIndoorBikeData(fromHex('41 00 2e 01'))), { power: 301 });
});

test('Cycling Power: bara effekt, och fälten i flaggordning', () => {
  assert.deepEqual(parseCyclingPower(fromHex('00 00 c8 00')), { power: 200 });
  assert.deepEqual(parseCyclingPower(fromHex('35 00 2c 01 64 40 06 e8 03 00 00 00 08 0a 00 00 04')), {
    power: 300, pedalBalance: 50, accumulatedTorque: 50, wheelRevs: 1000, wheelEventTime: 1, crankRevs: 10, crankEventTime: 1024,
  });
  assert.deepEqual(parseCyclingPower(fromHex('20 00 96 00 ff ff 34 12')), { power: 150, crankRevs: 65535, crankEventTime: 0x1234 });
});

test('kadens: två mätningar, överslag och 0 när vevarna står still', () => {
  const c = new CadenceTracker();
  assert.equal(c.update(65535, 65000, 0), null);
  close(c.update(1, (65000 + 1365) % 65536, 1.3), 90); // 2 varv på 1365/1024 s
  assert.ok(c.update(1, (65000 + 1365) % 65536, 1.3 + CADENCE_ZERO_AFTER_S - 0.1) > 0);
  assert.equal(c.update(1, (65000 + 1365) % 65536, 1.3 + CADENCE_ZERO_AFTER_S), 0);
});

test('bara trampande avläsningar blir drag', () => {
  assert.equal(isPedalling({ power: 200, cadence: 90 }), true);
  assert.equal(isPedalling({ power: 200 }), true); // trainern skickar ingen kadens
  assert.equal(isPedalling({ power: 0, cadence: 0 }), false);
  assert.equal(isPedalling({ power: 15, cadence: 0 }), false); // svänghjulet snurrar ut
  assert.equal(isPedalling({ cadence: 80 }), false);
});
