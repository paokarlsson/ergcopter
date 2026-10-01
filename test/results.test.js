import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peaksAround, heightVerdict, recordKind } from '../public/game/core/results.js';
import { DEFAULT_MILESTONES } from '../public/game/core/milestones.js';

const PEAKS = [
  { name: 'Åreskutan', h: 1420 },
  { name: 'Helags', h: 1797 },
  { name: 'Kebnekaise', h: 2097 },
];

test('topparna kring maxhöjden: de två högsta passerade och nästa', () => {
  assert.deepEqual(
    peaksAround(1900, PEAKS).map((p) => [p.name, p.passed]),
    [
      ['Åreskutan', true],
      ['Helags', true],
      ['Kebnekaise', false],
    ]
  );
  assert.deepEqual(peaksAround(500, PEAKS).map((p) => [p.name, p.passed]), [['Åreskutan', false]]);
  assert.deepEqual(peaksAround(9000, PEAKS).map((p) => p.passed), [true, true]);
});

test('meningen om höjden nämner senaste toppen och nästa', () => {
  assert.equal(heightVerdict(1900, PEAKS), 'Du flög högre än Helags men nådde inte helt till Kebnekaise. Imponerande!');
  assert.equal(heightVerdict(2050, PEAKS), 'Du flög högre än Helags men nådde inte helt till Kebnekaise. Så nära!');
  assert.equal(heightVerdict(300, PEAKS), `Nästa gång väntar Åreskutan, ${(1420).toLocaleString('sv-SE')} m.`);
  assert.match(heightVerdict(3000, PEAKS), /högre än Kebnekaise/);
  assert.match(heightVerdict(1000, DEFAULT_MILESTONES), /Du flög högre än Suljätten men nådde inte helt till Mullfjället/);
});

test('rekordet: bäst i klassen, i dag, eller personbästa', () => {
  const r = (over) => recordKind({ hMax: 1500, classRank: { rank: 3, total: 9 }, todayRank: { rank: 2, total: 4 }, previousBest: 1400, anonymous: false, ...over });
  assert.equal(r({ classRank: { rank: 1, total: 9 } }), 'class');
  assert.equal(r({ classRank: { rank: 1, total: 1 }, todayRank: { rank: 1, total: 1 } }), 'personal'); // ensam är inget rekord
  assert.equal(r({ todayRank: { rank: 1, total: 4 } }), 'today');
  assert.equal(r({}), 'personal');
  assert.equal(r({ previousBest: 1600 }), null);
  assert.equal(r({ previousBest: null }), null); // första flygningen
  assert.equal(r({ anonymous: true }), null);
});
