// Godkända övningar per namn (plan.md §7). Sparar bara namnet och vilka
// övningar som är godkända – aldrig vikt eller ålder.

const STORAGE_KEY = 'skierg.progress.v1';

const keyOf = (name) => String(name).trim().toLowerCase();

export class Progress {
  /** @param {Storage|null} storage  localStorage i webbläsaren, en fejk i tester */
  constructor(storage = safeStorage()) {
    this.storage = storage;
    this.data = this.#load();
  }

  /** Id:n för godkända övningar. */
  passed(name) {
    return new Set(this.data[keyOf(name)] ?? []);
  }

  markPassed(name, exerciseId) {
    const key = keyOf(name);
    const list = this.data[key] ?? [];
    if (list.includes(exerciseId)) return;
    this.data[key] = [...list, exerciseId];
    this.#save();
  }

  #load() {
    try {
      const data = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? 'null');
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
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

/** Förslaget i menyn: första övningen som inte är godkänd, annars null (fri flygning). */
export function nextExercise(exercises, passed) {
  return exercises.find((ex) => !passed.has(ex.id)) ?? null;
}
