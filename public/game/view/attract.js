// Startskärmens demotur: helikoptern lyfter, stiger förbi fjälltopparna och genom
// molntäcket, sjunker tillbaka och landar – om och om igen, som en arkadmaskin som
// lockar. Bara bild; ingen fysik och ingen topplista.

const CLIMB_S = 150; // en tur upp och ned
const GROUND_S = 5; // paus på marken mellan turerna
const TOP_M = 2300; // strax över molntäcket (scenery.js CLOUD_DECK)
const START_S = 8; // börja en bit in i turen, så att helikoptern redan är i luften

/**
 * Höjd och stighastighet t sekunder in i demoturen.
 * @param {number} t  s
 * @returns {{ h: number, vy: number }}
 */
export function attractFlight(t) {
  const u = (t + START_S) % (CLIMB_S + GROUND_S);
  if (u >= CLIMB_S) return { h: 0, vy: 0 };
  // Mjuk cosinuskurva: lugn start, snabbast på mitten av stigningen, mjuk landning.
  const w = (2 * Math.PI) / CLIMB_S;
  return { h: (TOP_M / 2) * (1 - Math.cos(w * u)), vy: (TOP_M / 2) * w * Math.sin(w * u) };
}
