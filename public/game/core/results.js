// Resultatet efter en fri flygning (spec §7): vilka toppar man passerade, en mening
// om höjden och vilken sorts rekord det blev. Ren logik utan DOM.

const fmt = (h) => Math.round(h).toLocaleString('sv-SE');
const byHeight = (milestones) => [...milestones].sort((a, b) => a.h - b.h);

/**
 * Topparna kring maxhöjden: de högsta som passerats (högst `passed` stycken) och nästa som återstår.
 * @returns {{ name: string, h: number, area?: string, passed: boolean }[]}  lägst först
 */
export function peaksAround(hMax, milestones, passed = 2) {
  const sorted = byHeight(milestones);
  const done = sorted.filter((m) => hMax >= m.h).slice(-passed).map((m) => ({ ...m, passed: true }));
  const next = sorted.find((m) => hMax < m.h);
  return next ? [...done, { ...next, passed: false }] : done;
}

/** En mening om höjden, t.ex. "Du flög högre än Helags men nådde inte helt till Kebnekaise. Imponerande!" */
export function heightVerdict(hMax, milestones) {
  const sorted = byHeight(milestones);
  const top = sorted.filter((m) => hMax >= m.h).at(-1);
  const next = sorted.find((m) => hMax < m.h);
  if (!top && !next) return 'Bra flugit!';
  if (!top) return `Nästa gång väntar ${next.name}, ${fmt(next.h)} m.`;
  if (!next) return `Du flög högre än ${top.name}. Det finns inga högre toppar – otroligt!`;
  // Nästan framme: minst tre fjärdedelar av vägen till nästa topp.
  const close = (hMax - top.h) / (next.h - top.h) >= 0.75;
  return `Du flög högre än ${top.name} men nådde inte helt till ${next.name}. ${close ? 'Så nära!' : 'Imponerande!'}`;
}

/**
 * Vilket rekord flygningen blev, för rubriken på resultatskärmen.
 *   'class'    bäst i klassen genom tiderna (och minst två i klassen)
 *   'today'    bäst i klassen i dag (och minst två i dag)
 *   'personal' bättre än deltagarens tidigare bästa (inte för anonyma)
 *   null       inget rekord
 * @param {object} r
 * @param {{rank:number,total:number}} r.classRank, r.todayRank  från Leaderboard
 * @param {number|null} r.previousBest  deltagarens bästa före flygningen
 */
export function recordKind({ hMax, classRank, todayRank, previousBest, anonymous }) {
  if (classRank.rank === 1 && classRank.total > 1) return 'class';
  if (todayRank.rank === 1 && todayRank.total > 1) return 'today';
  if (!anonymous && previousBest !== null && hMax > previousBest) return 'personal';
  return null;
}
