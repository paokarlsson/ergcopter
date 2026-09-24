// Förhandsvisning för kalibrering (tillägg §4–5): förväntat utfall och
// balanskontroll omräknade med aktuella parametrar. Analytisk lösning:
//   h(t) = H_air · (P/P0 − 1) · (1 − exp(−t/τ)),  τ = H_air / G

import { liftPower } from './config.js';

/** Förväntat utfall efter 240 s jämn effekt (tillägg §4). */
export const PERSONS = [
  { name: 'Barn', mass: 30, power: 40 },
  { name: 'Otränad vuxen', mass: 70, power: 110 },
  { name: 'Motionär', mass: 80, power: 180 },
  { name: 'Stark SkiErg-användare', mass: 80, power: 300 },
  { name: 'Elit', mass: 90, power: 420 },
];
export const PERSON_SECONDS = 240;

/** Balanskontroll: stark person på 80 kg (tillägg §4). */
export const BALANCE_MASS = 80;
export const BALANCE = [
  { label: '30 s', s: 30, power: 450 },
  { label: '3 min', s: 180, power: 320 },
  { label: '5 min', s: 300, power: 295 },
  { label: '10 min', s: 600, power: 260 },
  { label: '60 min', s: 3600, power: 200 },
];

export const tau = (cfg) => cfg.H_air / cfg.G;

/** Maxhöjd för jämn effekt i t sekunder från marken (0 om man inte lättar). */
export function heightAfter(cfg, mass, power, t) {
  const P0 = liftPower(cfg, mass);
  return Math.max(0, cfg.H_air * (power / P0 - 1) * (1 - Math.exp(-t / tau(cfg))));
}

/** Allt förhandsvisningen visar, för en viss konfiguration. */
export function preview(cfg) {
  return {
    tau: tau(cfg),
    persons: PERSONS.map((p) => ({
      ...p,
      P0: liftPower(cfg, p.mass),
      h: heightAfter(cfg, p.mass, p.power, PERSON_SECONDS),
    })),
    balance: BALANCE.map((b) => ({ ...b, h: heightAfter(cfg, BALANCE_MASS, b.power, b.s) })),
  };
}

/** Kalibreringsprocedur för operatören (tillägg §5), visas som hjälptext. */
export const CALIBRATION_STEPS = [
  'Kör själv ett fyraminuterspass och notera maxhöjden.',
  'Testa med minst en otränad vuxen och ett barn.',
  'Justera enligt tabellen nedan.',
];
export const CALIBRATION_ACTIONS = [
  ['Någon lättar inte inom 30 s', 'Sänk P_ref i steg om 10 W'],
  ['Alla höjder känns för stora eller för små', 'Ändra H_air och G med samma faktor – höjdskalan ändras men inte balansen'],
  ['Passen blir för långa', 'Höj G utan att ändra H_air (τ sjunker)'],
  ['Korta explosiva pass vinner för ofta', 'Sänk G utan att ändra H_air (τ ökar)'],
];
