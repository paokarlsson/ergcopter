// Topplista (spec §7, §9). Sparar namn, h_max, tid till h_max, klass och tidsstämpel –
// aldrig vikt eller watt.

const STORAGE_KEY = 'skierg.leaderboard.v1';

export class Leaderboard {
  /** @param {Storage|null} storage  localStorage i webbläsaren, en fejk i tester */
  constructor(storage = safeStorage()) {
    this.storage = storage;
    this.entries = this.#load();
  }

  /**
   * @param {{ name: string, hMax: number, tHMax: number, klass?: string, ts?: number }} result
   * @returns {{ entry: object, rank: number, total: number }}
   */
  add({ name, hMax, tHMax, klass = '', ts = Date.now() }) {
    const entry = { name, hMax: Math.round(hMax * 10) / 10, tHMax: Math.round(tHMax * 10) / 10, klass, ts };
    this.entries.push(entry);
    this.entries.sort(compare);
    this.#save();
    return { entry, rank: this.entries.indexOf(entry) + 1, total: this.entries.length };
  }

  /** Bästa resultaten, valfritt filtrerade på klass. */
  top(n = 10, klass = null) {
    return (klass ? this.entries.filter((e) => e.klass === klass) : this.entries).slice(0, n);
  }

  /** Dagens bästa höjd (lokal tid), valfritt inom en klass, eller null. */
  todayBest(now = Date.now(), klass = null) {
    const day = new Date(now).toDateString();
    return (
      this.entries.find((e) => new Date(e.ts).toDateString() === day && (!klass || e.klass === klass))?.hMax ?? null
    );
  }

  /** Placering (1-baserad) för en post inom sin klass, och antalet i klassen. */
  classRank(entry) {
    const same = this.entries.filter((e) => e.klass === entry.klass);
    return { rank: same.indexOf(entry) + 1, total: same.length };
  }

  clear() {
    this.entries = [];
    this.#save();
  }

  toJSON() {
    return JSON.stringify(this.entries, null, 2);
  }

  toCSV() {
    const rows = [['placering', 'namn', 'klass', 'h_max_m', 'tid_till_h_max_s', 'tidsstampel']];
    this.entries.forEach((e, i) =>
      rows.push([i + 1, e.name, e.klass, e.hMax, e.tHMax, new Date(e.ts).toISOString()])
    );
    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  #load() {
    try {
      const data = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? '[]');
      return Array.isArray(data) ? data.filter((e) => e && Number.isFinite(e.hMax)).sort(compare) : [];
    } catch {
      return [];
    }
  }

  #save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // lagringen kan vara full eller blockerad – listan gäller ändå under sessionen
    }
  }
}

// Högst först; vid lika höjd vinner den som kom dit snabbast, sedan den som var först.
const compare = (a, b) => b.hMax - a.hMax || a.tHMax - b.tHMax || a.ts - b.ts;

/** CSV-cell med citattecken vid behov och skydd mot formler i kalkylprogram. */
function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
