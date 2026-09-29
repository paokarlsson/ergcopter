// Helikoptertyper (plan.md §4). En helikopter är en uppsättning fysikparametrar
// ovanpå konfigurationen, plus utseende. Fysiken i övrigt är densamma.

export const HELICOPTERS = [
  {
    id: 'school',
    name: 'Skolhelikopter',
    // Fallbroms: en miss straffas mildare och mjuk landning blir lättare.
    maxSinkRate: 15, // m/s
    // Klarar övningshöjderna men inte de höga topparna.
    ceiling: 1500, // m
    winch: false, // ingen vinsch och ingen plats för patient
    seats: 0,
    livery: { body: '#f2c230', trim: '#1f2328', label: 'SKOLA' },
  },
];

export function getHelicopter(id) {
  const heli = HELICOPTERS.find((h) => h.id === id);
  if (!heli) throw new Error(`Okänd helikopter: ${id}`);
  return heli;
}

/** Konfigurationen med helikopterns fysikparametrar ovanpå. */
export function helicopterConfig(cfg, heli) {
  return { ...cfg, maxSinkRate: heli.maxSinkRate, ceiling: heli.ceiling };
}
