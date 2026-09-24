import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, loadConfig, saveConfig, parseMilestones, formatMilestones, sanitize } from '../public/game/config.js';
import { DEFAULT_MILESTONES, LEGACY_MILESTONES } from '../public/game/milestones.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
}

test('standardlistan är sorterad, har unika namn och täcker Jämtland till Everest', () => {
  const hs = DEFAULT_MILESTONES.map((m) => m.h);
  assert.deepEqual(hs, [...hs].sort((a, b) => a - b));
  assert.equal(new Set(DEFAULT_MILESTONES.map((m) => m.name)).size, DEFAULT_MILESTONES.length);
  assert.ok(DEFAULT_MILESTONES.some((m) => m.name === 'Åreskutan' && m.h === 1420));
  assert.ok(DEFAULT_MILESTONES.some((m) => m.name === 'Helags' && m.h === 1796));
  assert.equal(DEFAULT_MILESTONES.at(-1).name, 'Mount Everest');
});

test('sparad gammal standardlista uppgraderas till den nya', () => {
  const legacy = LEGACY_MILESTONES.map(([name, h]) => ({ name, h }));
  const storage = memoryStorage({ 'skierg.config.v1': JSON.stringify({ G: 30, milestones: legacy }) });
  const cfg = loadConfig(storage);
  assert.equal(cfg.G, 30); // övriga inställningar behålls
  assert.equal(cfg.milestones.length, DEFAULT_MILESTONES.length);
});

test('egen milstolpelista behålls', () => {
  const storage = memoryStorage({ 'skierg.config.v1': JSON.stringify({ milestones: [{ name: 'Backen', h: 50 }] }) });
  assert.deepEqual(loadConfig(storage).milestones, [{ name: 'Backen', h: 50 }]);
});

test('gamla standardvärden (P_ref 100, H_air 2700, G 22,5, 600 s) byts mot tilläggets', () => {
  const old = { P_ref: 100, H_air: 2700, G: 22.5, maxSessionS: 600, idleEndS: 12 };
  const cfg = loadConfig(memoryStorage({ 'skierg.config.v1': JSON.stringify(old) }));
  assert.deepEqual([cfg.P_ref, cfg.H_air, cfg.G, cfg.maxSessionS], [60, 1800, 20, 480]);
  assert.equal(cfg.idleEndS, 12); // egna ändringar behålls
});

test('bara ändrade värden sparas', () => {
  const storage = memoryStorage();
  saveConfig(sanitize({ ...DEFAULT_CONFIG, G: 25 }), storage);
  assert.deepEqual(JSON.parse(storage.data.get('skierg.config.v1')), { G: 25 });
});

test('standardlistan sparas inte, egna listor gör det', () => {
  const storage = memoryStorage();
  saveConfig(sanitize({ ...DEFAULT_CONFIG }), storage);
  assert.equal(JSON.parse(storage.data.get('skierg.config.v1')).milestones, undefined);
  saveConfig(sanitize({ ...DEFAULT_CONFIG, milestones: [{ name: 'X', h: 10 }] }), storage);
  assert.deepEqual(JSON.parse(storage.data.get('skierg.config.v1')).milestones, [{ name: 'X', h: 10 }]);
});

test('namn;höjd;område – område valfritt, text tur och retur', () => {
  const list = parseMilestones('Helags;1796;Härjedalen\nBacken; 1 050 \nTrasig rad\nNoll;0');
  assert.deepEqual(list, [
    { name: 'Helags', h: 1796, area: 'Härjedalen' },
    { name: 'Backen', h: 1050 },
  ]);
  assert.deepEqual(parseMilestones(formatMilestones(DEFAULT_MILESTONES)), DEFAULT_MILESTONES);
});
