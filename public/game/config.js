// Samlat konfigurationsobjekt (spec §5, §7, §9). Allt som går att trimma finns här.
// Standardvärdena följer tillägget "standardvärden för blandad publik".

import { DEFAULT_MILESTONES, LEGACY_MILESTONES } from './milestones.js';

export const DEFAULT_CONFIG = Object.freeze({
  // Fysik (spec §5, tillägg §1)
  P_ref: 60, // W, lyfteffekt vid referensvikten (0,75 W/kg vid 80 kg)
  m_ref: 80, // kg
  weightMode: 'linear', // 'linear' (k = 1, standard) | 'fair' (k = 2/3)
  H_air: 1800, // m, vid h = H_air krävs dubbla lyfteffekten
  G: 20, // m/s, stighastighet vid en hel P0 överskott
  maxSinkRate: 0, // m/s, 0 = av
  dt: 0.05, // s, fysikens tidssteg

  // Signalbehandling (spec §4)
  smoothingStrokes: 3,
  strokeTimeoutS: 3,
  fadeOutS: 1,

  // Spelflöde (spec §7, tillägg §1)
  countdownS: 3,
  groundEndS: 5,
  idleEndS: 10,
  maxSessionS: 480, // 0 = av
  resultDisplayS: 15,
  replayMaxS: 3,

  // Visning (spec §6, §8, tillägg §2)
  showRawWatts: false,
  showCombinedBoard: false, // sammanlagd topplista som extra flik
  sound: false,
  milestones: DEFAULT_MILESTONES, // se milestones.js
});

/** Standardvärden före tillägget – sparade värden som är exakt dessa byts mot de nya. */
const PREVIOUS_DEFAULTS = { P_ref: 100, H_air: 2700, G: 22.5, maxSessionS: 600 };

/** Klasser (tillägg §2). Bara klassen sparas, aldrig åldern. */
export const CLASSES = [
  { name: 'Barn', ages: 'till och med 12 år' },
  { name: 'Ungdom', ages: '13–17 år' },
  { name: 'Vuxen', ages: '18 år och äldre' },
];
export const CHILD_CLASS = 'Barn';
export const CHILD_REMINDER = 'Spjäll 3–5. Pall vid behov om barnet inte når handtagen.';

/** Viktexponenten k för ett viktläge. */
export function weightExponent(cfg) {
  return cfg.weightMode === 'fair' ? 2 / 3 : 1;
}

/** P0: effekt som krävs för att sväva vid marken för en viss kroppsvikt. */
export function liftPower(cfg, bodyMass) {
  return cfg.P_ref * (bodyMass / cfg.m_ref) ** weightExponent(cfg);
}

export const MIN_MASS = 15;
export const MAX_MASS = 200;

/**
 * Beskriver inställningarna för operatörspanelen. `type`: number | select | bool | milestones.
 */
export const CONFIG_SCHEMA = [
  { group: 'Fysik', key: 'weightMode', label: 'Viktläge', type: 'select',
    options: [['linear', 'Linjär (k = 1, W/kg) – standard'], ['fair', 'Rättvis (k = 2/3) – slår hårt mot barn']] },
  { group: 'Fysik', key: 'P_ref', label: 'P_ref – lyfteffekt vid referensvikt (W)', type: 'number', min: 5, max: 1000, step: 1 },
  { group: 'Fysik', key: 'm_ref', label: 'm_ref – referensvikt (kg)', type: 'number', min: 15, max: 200, step: 1 },
  { group: 'Fysik', key: 'H_air', label: 'H_air – luftens uttunning (m)', type: 'number', min: 100, max: 100000, step: 10 },
  { group: 'Fysik', key: 'G', label: 'G – stigförmåga (m/s vid en P0 överskott, inte tyngdacceleration)', type: 'number', min: 0.1, max: 1000, step: 0.1 },
  { group: 'Fysik', key: 'maxSinkRate', label: 'Max sjunkhastighet (m/s, 0 = av)', type: 'number', min: 0, max: 1000, step: 0.5 },
  { group: 'Fysik', key: 'dt', label: 'Tidssteg dt (s)', type: 'number', min: 0.01, max: 0.2, step: 0.01 },
  { group: 'Signal', key: 'smoothingStrokes', label: 'Drag i medelvärdet', type: 'number', min: 1, max: 20, step: 1 },
  { group: 'Signal', key: 'strokeTimeoutS', label: 'Tid utan drag före nedtoning (s)', type: 'number', min: 0.5, max: 30, step: 0.5 },
  { group: 'Signal', key: 'fadeOutS', label: 'Nedtoningstid (s)', type: 'number', min: 0, max: 30, step: 0.5 },
  { group: 'Spel', key: 'countdownS', label: 'Nedräkning (s)', type: 'number', min: 0, max: 10, step: 1 },
  { group: 'Spel', key: 'groundEndS', label: 'Slut efter tid på marken (s)', type: 'number', min: 1, max: 60, step: 1 },
  { group: 'Spel', key: 'idleEndS', label: 'Slut efter tid utan drag (s)', type: 'number', min: 1, max: 120, step: 1 },
  { group: 'Spel', key: 'maxSessionS', label: 'Max passlängd (s, 0 = av)', type: 'number', min: 0, max: 7200, step: 10 },
  { group: 'Spel', key: 'resultDisplayS', label: 'Resultatvisning (s)', type: 'number', min: 3, max: 120, step: 1 },
  { group: 'Visning', key: 'showCombinedBoard', label: 'Visa även sammanlagd topplista', type: 'bool' },
  { group: 'Visning', key: 'showRawWatts', label: 'Visa råa watt och P0 på skärmen', type: 'bool' },
  { group: 'Visning', key: 'sound', label: 'Rotorljud', type: 'bool' },
  { group: 'Visning', key: 'milestones', label: 'Milstolpar (namn;höjd;område per rad, området är valfritt)', type: 'milestones' },
];

const STORAGE_KEY = 'skierg.config.v1';

/** Läser sparad konfiguration ovanpå standardvärdena. Tål saknad eller trasig lagring. */
export function loadConfig(storage = safeStorage()) {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') ?? {};
    if (isLegacyMilestones(saved.milestones)) delete saved.milestones; // gamla standardlistan → nya
    for (const [key, old] of Object.entries(PREVIOUS_DEFAULTS)) {
      if (saved[key] === old) delete saved[key]; // gamla standardvärden → nya
    }
    return sanitize({ ...DEFAULT_CONFIG, ...saved });
  } catch {
    return sanitize({ ...DEFAULT_CONFIG });
  }
}

/**
 * Sparar bara det som skiljer sig från standard, så att ändrade standardvärden
 * slår igenom för allt som operatören inte själv har ändrat.
 */
export function saveConfig(cfg, storage = safeStorage()) {
  try {
    const diff = {};
    for (const [key, value] of Object.entries(cfg)) {
      const same = key === 'milestones' ? sameMilestones(value, DEFAULT_CONFIG.milestones) : value === DEFAULT_CONFIG[key];
      if (!same) diff[key] = value;
    }
    storage?.setItem(STORAGE_KEY, JSON.stringify(diff));
  } catch {
    // privat läge eller full lagring – inställningarna gäller ändå för sessionen
  }
}

export function resetConfig(storage = safeStorage()) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {}
  return sanitize({ ...DEFAULT_CONFIG });
}

/**
 * Håller värden inom schemats gränser och milstolparna sorterade. Nycklar som
 * inte längre finns (t.ex. borttagna inställningar) rensas bort.
 */
export function sanitize(cfg) {
  const out = Object.fromEntries(Object.keys(DEFAULT_CONFIG).map((k) => [k, cfg[k] ?? DEFAULT_CONFIG[k]]));
  for (const f of CONFIG_SCHEMA) {
    if (f.type === 'number') {
      const v = Number(out[f.key]);
      out[f.key] = Number.isFinite(v) ? Math.min(f.max, Math.max(f.min, v)) : DEFAULT_CONFIG[f.key];
    } else if (f.type === 'bool') {
      out[f.key] = Boolean(out[f.key]);
    } else if (f.type === 'select') {
      if (!f.options.some(([v]) => v === out[f.key])) out[f.key] = DEFAULT_CONFIG[f.key];
    }
  }
  out.milestones = (Array.isArray(out.milestones) ? out.milestones : DEFAULT_CONFIG.milestones)
    .filter((m) => m && typeof m.name === 'string' && Number.isFinite(m.h) && m.h > 0)
    .map((m) => (typeof m.area === 'string' && m.area ? { name: m.name, h: m.h, area: m.area } : { name: m.name, h: m.h }))
    .sort((a, b) => a.h - b.h);
  return out;
}

/** "Namn;höjd;område" per rad ↔ milstolpar. Området är valfritt. */
export function parseMilestones(text) {
  return text
    .split('\n')
    .map((line) => line.split(';'))
    .filter((parts) => parts.length >= 2)
    .map(([name, h, area = '']) => ({
      name: name.trim(),
      h: Number(h.trim().replace(/\s/g, '').replace(',', '.')),
      ...(area.trim() ? { area: area.trim() } : {}),
    }))
    .filter((m) => m.name && Number.isFinite(m.h) && m.h > 0);
}

export function formatMilestones(milestones) {
  return milestones.map((m) => [m.name, m.h, m.area].filter((x) => x !== undefined && x !== '').join(';')).join('\n');
}

function sameMilestones(a, b) {
  return (
    Array.isArray(a) &&
    a.length === b.length &&
    a.every((m, i) => m.name === b[i].name && m.h === b[i].h && (m.area ?? '') === (b[i].area ?? ''))
  );
}

function isLegacyMilestones(list) {
  return (
    Array.isArray(list) &&
    list.length === LEGACY_MILESTONES.length &&
    list.every((m, i) => m?.name === LEGACY_MILESTONES[i][0] && m?.h === LEGACY_MILESTONES[i][1])
  );
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
