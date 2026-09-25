// Pm5Source: Concept2 PM5 via Web Bluetooth (spec §3).
// Referens: Concept2 PM Bluetooth Smart Communications Interface Definition rev 1.30.

import { SourceBase, now, hex, unsupportedMessage } from './source.js';

const uuid = (short) => `ce06${short}-43e5-11e4-916c-0800200c9a66`;
const SERVICE = {
  discovery: uuid('0000'),
  info: uuid('0010'),
  control: uuid('0020'),
  rowing: uuid('0030'),
};
const CHAR = {
  machineType: uuid('0016'),
  strokeData: uuid('0036'), // additional stroke data: effekt per drag
  multiplexed: uuid('0080'),
};
const MULTIPLEX_ID_STROKE = 0x36;
const MACHINE_SKIERG = 128;
const RECONNECT_DELAYS_S = [1, 2, 4, 8, 15, 30];

export class Pm5Source extends SourceBase {
  constructor() {
    super('Bluetooth');
    this.device = null;
    this.stopped = true;
    this.machineType = null;
    this.onDisconnected = () => this.#reconnect();
    this.onStrokeData = (e) => this.#parseStroke(e.target.value, 0, '0036');
    this.onMultiplexed = (e) => {
      const dv = e.target.value;
      this.raw(`0080 ${hex(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength))}`);
      if (dv.getUint8(0) === MULTIPLEX_ID_STROKE) this.#parseStroke(dv, 1, null);
    };
  }

  static get supported() {
    return 'bluetooth' in navigator;
  }

  /** Visar Chromes enhetsväljare. Måste anropas från ett klick. */
  async start() {
    if (!Pm5Source.supported) throw new Error(unsupportedMessage('Web Bluetooth'));
    this.setStatus('connecting');
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE.discovery] }],
      optionalServices: [SERVICE.info, SERVICE.control, SERVICE.rowing],
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
    this.raw(`Ansluten till ${this.device.name ?? 'PM5'}`);

    let warning;
    try {
      const info = await server.getPrimaryService(SERVICE.info);
      const type = await (await info.getCharacteristic(CHAR.machineType)).readValue();
      this.machineType = type.getUint8(0);
      this.raw(`Erg Machine Type: ${this.machineType}`);
      if (this.machineType !== MACHINE_SKIERG) {
        warning = `Det här är inte en SkiErg (maskintyp ${this.machineType}). Spelet fungerar, men parametrarna är trimmade för SkiErg.`;
      }
    } catch (err) {
      this.raw(`[warn] Kunde inte läsa maskintyp: ${err.message}`);
    }

    const rowing = await server.getPrimaryService(SERVICE.rowing);
    try {
      const ch = await rowing.getCharacteristic(CHAR.strokeData);
      ch.addEventListener('characteristicvaluechanged', this.onStrokeData);
      await ch.startNotifications();
      this.raw('Notiser på 0x0036');
    } catch (err) {
      this.raw(`[warn] 0x0036 gick inte (${err.message}) – använder multiplexad 0x0080`);
      const ch = await rowing.getCharacteristic(CHAR.multiplexed);
      ch.addEventListener('characteristicvaluechanged', this.onMultiplexed);
      await ch.startNotifications();
    }
    this.setStatus('connected', { message: this.device.name ?? 'PM5', warning });
  }

  /**
   * 0x0036 (little-endian): 0–2 elapsed time (0,01 s), 3–4 stroke power (W),
   * 5–6 stroke calories (cal/h), 7–8 stroke count, 9–14 projected work.
   */
  #parseStroke(dv, offset, label) {
    if (label) this.raw(`${label} ${hex(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength))}`);
    if (dv.byteLength < offset + 9) return;
    const elapsed = (dv.getUint8(offset) | (dv.getUint8(offset + 1) << 8) | (dv.getUint8(offset + 2) << 16)) / 100;
    const power = dv.getUint16(offset + 3, true);
    const strokeCount = dv.getUint16(offset + 7, true);
    this.raw(`  → drag #${strokeCount}: ${power} W (PM-tid ${elapsed.toFixed(2)} s)`);
    this.emit('stroke', { t: now(), power, strokeCount });
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
