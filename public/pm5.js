// WebHID-anslutning till Concept2 PM (USB). Skickar CSAFE-ramar och väntar på svar.
import { FRAME_START, FRAME_STOP, CMD, buildFrame } from './csafe.js';

export const CONCEPT2_VENDOR_ID = 0x17a4;

// PM:s HID-rapporter [rapport-ID, bytes utan ID-byten], största först. PM:en
// svarar i samma rapport som den fick frågan i och klipper svar som inte får
// plats, så #2 används i första hand. Deskriptorn går inte att lita på: Windows
// anger 500 bytes för alla tre.
const PM_REPORTS = [
  [2, 120],
  [4, 62],
  [1, 20],
];

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

export class PM5 {
  constructor(device) {
    this.device = device;
    this.pending = null; // { resolve, reject, timer }
    this.log = () => {}; // (text, level) => void, för felsökning
    this.trace = false; // logga rå trafik (→/←)
    this.descriptorSizes = outputReportSizes(device); // Map rapport-ID → bytes enligt deskriptorn
    this.report = null; // [rapport-ID, storlek] som PM:en svarar på, sätts av probe()
    device.addEventListener('inputreport', (e) => this.#onInput(e));
  }

  /** Visar Chromes enhetsväljare. Måste anropas från en klickhändelse. */
  static async request() {
    const [device] = await navigator.hid.requestDevice({
      filters: [{ vendorId: CONCEPT2_VENDOR_ID }],
    });
    return device ? PM5.open(device) : null;
  }

  /** Enheter som användaren redan gett tillåtelse till tidigare. */
  static async previouslyAllowed() {
    const devices = await navigator.hid.getDevices();
    const device = devices.find((d) => d.vendorId === CONCEPT2_VENDOR_ID);
    return device ? PM5.open(device) : null;
  }

  static async open(device) {
    if (!device.opened) await device.open();
    return new PM5(device);
  }

  get name() {
    return this.device.productName || 'Concept2 PM';
  }

  /** Beskriver HID-deskriptorn: samlingar och in-/utrapporter med storlek. */
  describe() {
    const d = this.device;
    const lines = [`Enhet ${hex16(d.vendorId)}:${hex16(d.productId)} "${d.productName}"`];
    for (const c of d.collections) {
      const fmt = (reports) =>
        (reports ?? []).map((r) => `#${r.reportId}=${reportBytes(r)}B`).join(' ') || '–';
      lines.push(
        `  samling usagePage=${hex16(c.usagePage)} usage=${hex16(c.usage)}` +
          ` in: ${fmt(c.inputReports)} ut: ${fmt(c.outputReports)} feature: ${fmt(c.featureReports)}`
      );
    }
    return lines.join('\n');
  }

  /**
   * Provar PM:ens rapporter (största först) med ett GETSTATUS och behåller den
   * första som PM:en svarar på.
   */
  async probe() {
    const frame = buildFrame([CMD.GETSTATUS]);
    for (const report of PM_REPORTS) {
      this.report = report;
      try {
        await this.send(frame, 700);
        this.log(`Svar via rapport #${report[0]} (${report[1]} bytes)`);
        return report;
      } catch (err) {
        this.log(`Rapport #${report[0]}: ${err.message}`, 'warn');
      }
    }
    this.report = null;
    throw new Error('PM:en svarar inte på någon rapport');
  }

  async close() {
    this.pending?.reject(new Error('Stängd'));
    this.pending = null;
    if (this.device.opened) await this.device.close();
  }

  /** Skickar en CSAFE-ram och returnerar svarsramens bytes. */
  async send(frame, timeoutMs = 1000) {
    if (this.pending) throw new Error('Förfrågan pågår redan');
    if (!this.report) throw new Error('Ingen fungerande rapport – kör probe() först');

    const [reportId, size] = this.report;
    if (frame.length > size) throw new Error(`Ramen (${frame.length} B) får inte plats i rapport #${reportId}`);
    // Fyll ut till deskriptorns storlek om den är större; Windows kräver det.
    const data = new Uint8Array(Math.max(size, this.descriptorSizes.get(reportId) ?? 0));
    data.set(frame);

    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('Timeout – inget svar från PM'));
      }, timeoutMs);
      this.pending = { resolve, reject, timer };
    });

    if (this.trace) this.log(`→ #${reportId} ${hex(frame)}`);
    try {
      await this.device.sendReport(reportId, data);
    } catch (err) {
      clearTimeout(this.pending.timer);
      this.pending = null;
      throw new Error(`sendReport #${reportId} misslyckades: ${err.message}`);
    }
    return response;
  }

  #onInput(event) {
    const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) end--;
    if (this.trace) this.log(`← #${event.reportId} ${hex(bytes.subarray(0, end))}`);
    if (!this.pending) return;

    // Hela svaret kommer i en rapport. Efter F2 kan det ligga gammalt skräp
    // från PM:ens buffert, så klipp vid första F2.
    const start = bytes.indexOf(FRAME_START);
    if (start < 0) return;
    const stop = bytes.indexOf(FRAME_STOP, start + 1);

    const { resolve, reject, timer } = this.pending;
    clearTimeout(timer);
    this.pending = null;
    if (stop < 0) {
      reject(new Error(`Svaret fick inte plats i rapport #${event.reportId} (${bytes.length} bytes) och klipptes`));
    } else {
      resolve(Array.from(bytes.subarray(start, stop + 1)));
    }
  }
}

const hex16 = (n) => '0x' + n.toString(16).padStart(4, '0');

function reportBytes(report) {
  return (report.items ?? []).reduce((sum, it) => sum + it.reportSize * it.reportCount, 0) / 8;
}

/** Map rapport-ID → storlek i bytes enligt HID-deskriptorn. */
function outputReportSizes(device) {
  const sizes = new Map();
  for (const collection of device.collections) {
    for (const report of collection.outputReports ?? []) {
      sizes.set(report.reportId, reportBytes(report));
    }
  }
  return sizes;
}
