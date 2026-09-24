// UsbPm5Source: Concept2 PM via USB (WebHID + CSAFE).
//
// Kraftbufferten och dragfasen läses var 50:e ms. Ett drag räknas när PM:en
// lämnar drivfasen; effekten (GETPOWER) tas från nästa svar så att PM:en hunnit
// uppdatera den för draget som just avslutades.

import { buildFrame, parseFrame, le, CMD, PM } from '../../csafe.js';
import { PM5 } from '../../pm5.js';
import { SourceBase, now } from './source.js';

export const LBF_TO_N = 4.44822;
const DRIVE = 2;
const FORCE_INTERVAL_MS = 50;
const METRICS_INTERVAL_MS = 250;
const FORCE_BLOCK = 32; // max bytes per läsning av kraftbufferten

const FORCE_FRAME = buildFrame([CMD.GETPOWER], [PM.GET_STROKESTATE, PM.GET_FORCEPLOTDATA, 1, FORCE_BLOCK]);
const METRICS_FRAME = buildFrame(
  [CMD.GETPACE, CMD.GETCADENCE, CMD.GETPOWER, CMD.GETCALORIES, CMD.GETHRCUR],
  [PM.GET_WORKTIME, PM.GET_WORKDISTANCE, PM.GET_STROKESTATE, PM.GET_WORKOUTSTATE, PM.GET_DRAGFACTOR]
);

export class UsbPm5Source extends SourceBase {
  /** @param {{ metrics?: boolean }} opts  metrics: hämta även siffrorna (dashboarden) */
  constructor({ metrics = false } = {}) {
    super('USB');
    this.hasForce = true;
    this.withMetrics = metrics;
    this.pm = null;
    this.polling = false;
    this.trace = false;
    this.count = 0;
    this.prevState = null;
    this.pendingStroke = false;
    this.onHidDisconnect = (e) => {
      if (this.pm && e.device === this.pm.device) this.#lost('Kabeln urkopplad');
    };
    this.onHidConnect = () => {
      if (!this.pm && this.status.state === 'reconnecting') this.#open(() => PM5.previouslyAllowed());
    };
  }

  static get supported() {
    return 'hid' in navigator;
  }

  setTrace(on) {
    this.trace = on;
    if (this.pm) this.pm.trace = on;
  }

  /** Visar enhetsväljaren om ingen PM redan är godkänd. Anropas från ett klick. */
  async start() {
    if (!UsbPm5Source.supported) throw new Error('WebHID saknas – använd Chrome eller Edge');
    navigator.hid.addEventListener('disconnect', this.onHidDisconnect);
    navigator.hid.addEventListener('connect', this.onHidConnect);
    this.setStatus('connecting');
    const ok = (await this.#open(() => PM5.previouslyAllowed(), true)) || (await this.#open(() => PM5.request()));
    if (!ok) throw new Error(this.status.message ?? 'Ingen PM vald');
  }

  /** Försök ansluta igen till en redan godkänd PM, utan klick. */
  async resume() {
    if (!UsbPm5Source.supported) return false;
    navigator.hid.addEventListener('disconnect', this.onHidDisconnect);
    navigator.hid.addEventListener('connect', this.onHidConnect);
    return this.#open(() => PM5.previouslyAllowed(), true);
  }

  stop() {
    this.polling = false;
    navigator.hid?.removeEventListener('disconnect', this.onHidDisconnect);
    navigator.hid?.removeEventListener('connect', this.onHidConnect);
    const pm = this.pm;
    this.pm = null;
    pm?.close().catch(() => {});
    this.setStatus('idle');
  }

  async #open(getDevice, quiet = false) {
    if (this.opening) return false;
    this.opening = true;
    try {
      const pm = await getDevice();
      if (!pm) return false;
      pm.log = (text, level = 'log') => this.raw(level === 'log' ? text : `[${level}] ${text}`);
      pm.trace = this.trace;
      this.raw(pm.describe());
      await pm.probe();
      this.pm = pm;
      this.setStatus('connected', { message: pm.name });
      this.#poll();
      return true;
    } catch (err) {
      if (!quiet) this.setStatus('error', { message: err.message });
      this.raw(`[error] ${err.message}`);
      return false;
    } finally {
      this.opening = false;
    }
  }

  #lost(reason) {
    this.polling = false;
    const pm = this.pm;
    this.pm = null;
    pm?.close().catch(() => {});
    this.setStatus('reconnecting', { message: reason });
    // Kabeln kan sitta kvar (bara PM:en som tystnat) – då kommer inget connect-event.
    const retry = async () => {
      if (this.status.state !== 'reconnecting' || this.pm) return;
      if (!(await this.#open(() => PM5.previouslyAllowed(), true))) setTimeout(retry, 2000);
    };
    setTimeout(retry, 2000);
  }

  async #poll() {
    if (this.polling) return;
    this.polling = true;
    let lastMetrics = -Infinity;
    let errors = 0;
    while (this.polling && this.pm) {
      const started = performance.now();
      let more = false;
      try {
        if (this.withMetrics && started - lastMetrics >= METRICS_INTERVAL_MS) {
          lastMetrics = started;
          this.emit('metrics', parseFrame(await this.pm.send(METRICS_FRAME)));
        } else {
          more = this.#handleForce(parseFrame(await this.pm.send(FORCE_FRAME)));
        }
        errors = 0;
      } catch (err) {
        if (!this.pm) break;
        this.raw(`[error] ${err.message}`);
        if (++errors >= 10) this.#lost(`Inget svar från PM (${err.message})`);
      }
      const wait = FORCE_INTERVAL_MS - (performance.now() - started);
      if (!more && wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }

  /** @returns {boolean} om kraftbufferten var full (läs igen direkt) */
  #handleForce({ std, pm }) {
    const state = pm.get(PM.GET_STROKESTATE)?.[0];
    const block = pm.get(PM.GET_FORCEPLOTDATA);
    const power = std.get(CMD.GETPOWER);
    if (state === undefined) return false;

    if (this.pendingStroke && power) {
      this.pendingStroke = false;
      const stroke = { t: now(), power: le(power, 2), strokeCount: ++this.count };
      this.raw(`drag #${stroke.strokeCount}: ${stroke.power} W`);
      this.emit('stroke', stroke);
    }
    if (this.prevState === DRIVE && state !== DRIVE) this.pendingStroke = true;
    this.prevState = state;

    const count = block?.[0] ?? 0;
    const samples = [];
    for (let i = 1; i + 1 <= count; i += 2) samples.push(le(block.slice(i, i + 2)) * LBF_TO_N);
    this.emit('force', samples, state);
    return count >= FORCE_BLOCK;
  }
}
