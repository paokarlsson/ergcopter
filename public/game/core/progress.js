// Spelarprofilen per namn (plan.md §7): grad, godkända övningar, bästa resultat,
// genomförda lektioner, uppflygningen och loggboken med flygtid. Sparar bara
// namnet och det man gjort – aldrig vikt eller ålder.

const STORAGE_KEY = 'skierg.progress.v2';
const V1_KEY = 'skierg.progress.v1'; // bara godkända övningar per namn
const MAX_DAYS = 120; // så många flygdagar sparas i loggboken

const keyOf = (name) => String(name).trim().toLowerCase();

/** Dagen för en tidpunkt i lokal tid, 'YYYY-MM-DD'. */
export function dayOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Måndagen i samma vecka, 'YYYY-MM-DD'. */
function mondayOf(ms) {
  const d = new Date(ms);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayOf(d.getTime());
}

const emptyProfile = () => ({
  grade: 'aspirant',
  passed: [],
  best: {}, // övnings-id → { stars, score, summary }
  lessons: {}, // lektions-id → dagen den genomfördes första gången
  exam: { passed: null, lastTry: null, tries: 0 },
  flightS: 0, // loggbokens flygtid
  days: [], // dagar med minst en flygning
});

export class Progress {
  /** @param {Storage|null} storage  localStorage i webbläsaren, en fejk i tester, null = bara i minnet */
  constructor(storage = safeStorage()) {
    this.storage = storage;
    this.data = this.#load();
  }

  /** Profilen för ett namn: en kopia med `passed` som Set. */
  profile(name) {
    const p = { ...emptyProfile(), ...this.data[keyOf(name)] };
    return { ...p, passed: new Set(p.passed), exam: { ...emptyProfile().exam, ...p.exam } };
  }

  /** Id:n för godkända övningar. */
  passed(name) {
    return this.profile(name).passed;
  }

  markPassed(name, exerciseId) {
    this.#update(name, (p) => {
      if (!p.passed.includes(exerciseId)) p.passed.push(exerciseId);
    });
  }

  /**
   * För in en flygning i profilen och loggboken.
   * @param {object} flight
   * @param {'exercise'|'lesson'|'exam'|'free'} flight.kind
   * @param {string} [flight.id]
   * @param {string} [flight.status]      'passed' | 'failed' | 'running' (avbruten)
   * @param {object[]} [flight.moments]   { id, name, status, stars, score, summary }
   * @param {number} flight.flightS       tid i luften och på plattan, till loggboken
   * @param {number} now                  ms
   * @returns {{ bests: {id, name, stars, summary, prev}[], lessonDone: boolean, promoted: boolean }}
   *   bests: nya personbästa (prev = förra bästa, null första gången)
   */
  record(name, flight, now) {
    const today = dayOf(now);
    const out = { bests: [], lessonDone: false, promoted: false };
    this.#update(name, (p) => {
      p.flightS += Math.max(0, flight.flightS);
      if (!p.days.includes(today)) p.days = [...p.days, today].slice(-MAX_DAYS);
      for (const m of flight.moments ?? []) {
        if (m.status !== 'passed') continue;
        if (!p.passed.includes(m.id)) p.passed.push(m.id);
        const prev = p.best[m.id] ?? null;
        if (!prev || m.stars > prev.stars || (m.stars === prev.stars && m.score > prev.score + 1e-9)) {
          p.best[m.id] = { stars: m.stars, score: m.score, summary: m.summary };
          out.bests.push({ id: m.id, name: m.name, stars: m.stars, summary: m.summary, prev });
        }
      }
      if (flight.kind === 'lesson' && flight.status === 'passed' && !p.lessons[flight.id]) {
        p.lessons[flight.id] = today;
        out.lessonDone = true;
      }
      if (flight.kind === 'exam' && flight.status !== 'running') {
        p.exam = { ...p.exam, lastTry: today, tries: (p.exam?.tries ?? 0) + 1 };
        if (flight.status === 'passed' && p.grade === 'aspirant') {
          p.exam.passed = today;
          p.grade = 'junior';
          out.promoted = true;
        }
      }
    });
    return out;
  }

  /** Antal dagar med flygning den här veckan (måndag–söndag). */
  daysThisWeek(name, now) {
    const monday = mondayOf(now);
    const today = dayOf(now);
    return this.profile(name).days.filter((d) => d >= monday && d <= today).length;
  }

  #update(name, change) {
    const key = keyOf(name);
    const p = { ...emptyProfile(), ...this.data[key] };
    p.passed = [...p.passed];
    p.best = { ...p.best };
    p.lessons = { ...p.lessons };
    p.exam = { ...emptyProfile().exam, ...p.exam };
    change(p);
    this.data[key] = p;
    this.#save();
  }

  #load() {
    try {
      const data = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? 'null');
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
      // Första versionen sparade bara godkända övningar per namn.
      const v1 = JSON.parse(this.storage?.getItem(V1_KEY) ?? 'null');
      if (!v1 || typeof v1 !== 'object' || Array.isArray(v1)) return {};
      return Object.fromEntries(
        Object.entries(v1)
          .filter(([, list]) => Array.isArray(list))
          .map(([key, list]) => [key, { ...emptyProfile(), passed: list.filter((x) => typeof x === 'string') }])
      );
    } catch {
      return {};
    }
  }

  #save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // privat läge eller full lagring – gäller ändå för sessionen
    }
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Första övningen som inte är godkänd, annars null. */
export function nextExercise(exercises, passed) {
  return exercises.find((ex) => !passed.has(ex.id)) ?? null;
}

/** Flygtid som "1 h 12 min" eller "12 min". */
export function formatFlightTime(seconds) {
  const min = Math.floor(seconds / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}
