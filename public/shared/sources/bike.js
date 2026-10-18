// BikeSource: smart cykeltrainer via Web Bluetooth, t.ex. Wahoo KICKR CORE i en Zwift Ride (spec §3).
// FTMS Indoor Bike Data i första hand, Cycling Power som reserv. Bara notiser: inget skrivs till
// trainern, så Zwift (eller en annan app) kan styra motståndet samtidigt.
// Varje avläsning med effekt blir ett "drag", så motorn (spec §4) håller effekten till nästa avläsning.

import { SourceBase, now, hex, unsupportedMessage } from './source.js';
import { CadenceTracker, IndoorBikeDataJoiner, isPedalling, parseCyclingPower, parseIndoorBikeData } from './bike-data.js';

const sig = (short) => `0000${short.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
const SERVICE = { ftms: sig(0x1826), cyclingPower: sig(0x1818) };
const CHAR = { indoorBikeData: sig(0x2ad2), cyclingPowerMeasurement: sig(0x2a63) };
const RECONNECT_DELAYS_S = [1, 2, 4, 8, 15, 30];
const WARNING = 'Cykeln fungerar, men parametrarna är trimmade för SkiErg.';

export class BikeSource extends SourceBase {
  constructor() {
    super('Cykel');
    this.device = null;
    this.stopped = true;
    this.protocol = null; // 'ftms' | 'cps'
    this.count = 0;
    this.joiner = new IndoorBikeDataJoiner();
    this.cadence = new CadenceTracker();
    this.onDisconnected = () => this.#reconnect();
  }

  static get supported() {
    return 'bluetooth' in navigator;
  }

  /** Visar Chromes enhetsväljare. Måste anropas från ett klick. */
  async start() {
    if (!BikeSource.supported) throw new Error(unsupportedMessage('Web Bluetooth'));
    this.setStatus('connecting');
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE.ftms] }, { services: [SERVICE.cyclingPower] }],
      optionalServices: [SERVICE.ftms, SERVICE.cyclingPower],
    });
    this.device.addEventListener('gattserverdisconnected', this.onDisconnected);
    this.stopped = false;
    try {
      await this.#connect();
    } catch (err) {
      this.setStatus('error', { message: err.message });
      throw err;
    }
  }

  stop() {
    this.stopped = true;
    this.device?.removeEventListener('gattserverdisconnected', this.onDisconnected);
    if (this.device?.gatt.connected) this.device.gatt.disconnect();
    this.setStatus('idle');
  }

  async #connect() {
    const server = await this.device.gatt.connect();
    const name = this.device.name ?? 'trainern';
    this.raw(`Ansluten till ${name}`);
    this.cadence.reset();

    const ftms = await server.getPrimaryService(SERVICE.ftms).catch(() => null);
    this.protocol = null;
    if (ftms) {
      try {
        await this.#subscribe(await ftms.getCharacteristic(CHAR.indoorBikeData), '2ad2', (v) => this.#onIndoorBikeData(v));
        this.protocol = 'ftms';
      } catch (err) {
        this.raw(`[warn] FTMS utan Indoor Bike Data (${err.message}) – provar Cycling Power`);
      }
    }
    if (!this.protocol) {
      const cps = await server.getPrimaryService(SERVICE.cyclingPower).catch(() => null);
      if (!cps) throw new Error(`${name} har varken FTMS (0x1826) eller Cycling Power (0x1818)`);
      await this.#subscribe(await cps.getCharacteristic(CHAR.cyclingPowerMeasurement), '2a63', (v) => this.#onCyclingPower(v));
      this.protocol = 'cps';
    }
    this.raw(`Läser ${this.protocol === 'ftms' ? 'FTMS Indoor Bike Data' : 'Cycling Power'}`);
    this.setStatus('connected', { message: this.device.name ?? 'Cykel', warning: WARNING });
  }

  async #subscribe(ch, label, handle) {
    ch.addEventListener('characteristicvaluechanged', (e) => {
      const dv = e.target.value;
      this.raw(`${label} ${hex(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength))}`);
      try {
        handle(dv);
      } catch (err) {
        this.raw(`[warn] ${label}: ${err.message}`);
      }
    });
    await ch.startNotifications();
  }

  #onIndoorBikeData(dv) {
    const record = this.joiner.push(parseIndoorBikeData(dv));
    if (record) this.#reading({ power: record.power, cadence: record.cadence });
  }

  #onCyclingPower(dv) {
    const d = parseCyclingPower(dv);
    const r = { power: d.power };
    if (d.crankRevs !== undefined && d.crankEventTime !== undefined) {
      r.cadence = this.cadence.update(d.crankRevs, d.crankEventTime, now()) ?? undefined;
    }
    this.#reading(r);
  }

  #reading(r) {
    if (!isPedalling(r)) return;
    const strokeCount = ++this.count;
    const cadence = r.cadence === undefined ? '' : `, ${Math.round(r.cadence)} rpm`;
    this.raw(`  → avläsning #${strokeCount}: ${r.power} W${cadence}`);
    this.emit('stroke', { t: now(), power: r.power, strokeCount });
  }

  async #reconnect() {
    if (this.stopped) return;
    this.setStatus('reconnecting', { message: 'Bluetooth-anslutningen bröts' });
    for (const delay of RECONNECT_DELAYS_S) {
      await new Promise((r) => setTimeout(r, delay * 1000));
      if (this.stopped) return;
      try {
        await this.#connect();
        return;
      } catch (err) {
        this.raw(`[warn] Återanslutning misslyckades: ${err.message}`);
      }
    }
    this.setStatus('disconnected', { message: 'Kunde inte återansluta – anslut igen' });
  }
}
