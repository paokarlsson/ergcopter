// Helikoptertyper (plan.md §4). En helikopter är en uppsättning fysikparametrar
// ovanpå konfigurationen, plus utseende. Fysiken i övrigt är densamma.

export const HELICOPTERS = [
  {
    id: 'school',
    name: 'Skolhelikopter',
    // Klarar övningshöjderna men inte de höga topparna.
    ceiling: 1500, // m
    winch: false, // ingen vinsch och ingen plats för patient
    seats: 0,
    livery: { body: '#f4f5f7', accent: '#f0b414', trim: '#ffffff', label: 'SKOLA', scheme: 'lower' },
  },
  {
    id: 'rescue',
    name: 'Lätt räddningshelikopter',
    // Belöningen för godkänd uppflygning. Fysiken som i fri flygning, med vinsch och plats för en patient.
    ceiling: 0,
    winch: true,
    seats: 1,
    livery: { body: '#f4f5f7', accent: '#d3302a', trim: '#ffffff', label: '112' },
  },
];

/** Instruktörens helikopter i "Följ instruktören". */
export const INSTRUCTOR_LIVERY = { body: '#2f6fd0', accent: '#f4f5f7', trim: '#1b2b44', label: 'INSTR' };

export function getHelicopter(id) {
  const heli = HELICOPTERS.find((h) => h.id === id);
  if (!heli) throw new Error(`Okänd helikopter: ${id}`);
  return heli;
}

/** Konfigurationen med helikopterns fysikparametrar ovanpå. */
export function helicopterConfig(cfg, heli) {
  return { ...cfg, ceiling: heli.ceiling };
}
