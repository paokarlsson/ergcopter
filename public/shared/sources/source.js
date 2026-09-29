// Gemensamt för alla datakällor (spec §3 "Abstraktion och mock").

/**
 * @typedef {{ t: number, power: number, strokeCount: number }} Stroke
 *   t i sekunder (performance.now()/1000 i webbläsaren, simulerad tid headless)
 *
 * @typedef {{ state: 'idle'|'connecting'|'connected'|'reconnecting'|'disconnected'|'error',
 *             message?: string, warning?: string }} SourceStatus
 *
 * @typedef {object} PowerSource
 * @property {string} name
 * @property {boolean} hasForce                 om källan ger kraftsampel (onForce)
 * @property {(cb: (s: Stroke) => void) => void} onStroke
 * @property {() => Promise<void>} start
 * @property {() => void} stop
 */

export const now = () => performance.now() / 1000;

/** Bas med enkla lyssnarlistor: stroke, force, status, raw (och metrics för USB). */
export class SourceBase {
  constructor(name) {
    this.name = name;
    this.hasForce = false;
    this.status = { state: 'idle' };
    this.listeners = {};
  }

  on(type, cb) {
    (this.listeners[type] ??= []).push(cb);
    return () => (this.listeners[type] = this.listeners[type].filter((f) => f !== cb));
  }

  onStroke(cb) {
    return this.on('stroke', cb);
  }

  emit(type, ...args) {
    for (const cb of this.listeners[type] ?? []) cb(...args);
  }

  setStatus(state, extra = {}) {
    this.status = { state, ...extra };
    this.emit('status', this.status);
  }

  /** Rå data till debugpanelen. */
  raw(text) {
    this.emit('raw', text);
  }

  async start() {}
  stop() {}
}

export const hex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

/** iPhone/iPad. iPadOS utger sig för att vara en Mac, så pekskärmen avgör. */
export function isIOS(nav = globalThis.navigator) {
  if (!nav) return false;
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/** Felmeddelande när webbläsaren saknar Web Bluetooth/WebHID. */
export function unsupportedMessage(api, nav = globalThis.navigator) {
  if (isIOS(nav)) {
    return api === 'Web Bluetooth'
      ? 'iPhone/iPad stöder inte Web Bluetooth i Safari eller Chrome – öppna sidan i appen Bluefy (gratis i App Store)'
      : 'USB fungerar inte på iPhone/iPad – välj Bluetooth och öppna sidan i appen Bluefy (gratis i App Store)';
  }
  return `${api} saknas – använd Chrome eller Edge`;
}
