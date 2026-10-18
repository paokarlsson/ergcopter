// Tolkning av data från smarta cykeltrainers (spec §3): FTMS Indoor Bike Data (0x2AD2) och
// Cycling Power Measurement (0x2A63). Ren logik utan Bluetooth, så att testerna kan köra den.

/** Indoor Bike Data, flaggbitar. Bit 0 är omvänd: 0 betyder att hastigheten finns med. */
export const FLAG = {
  moreData: 1 << 0,
  avgSpeed: 1 << 1,
  cadence: 1 << 2,
  avgCadence: 1 << 3,
  distance: 1 << 4,
  resistance: 1 << 5,
  power: 1 << 6,
  avgPower: 1 << 7,
  energy: 1 << 8,
  heartRate: 1 << 9,
  met: 1 << 10,
  elapsed: 1 << 11,
  remaining: 1 << 12,
};

/**
 * FTMS Indoor Bike Data (little-endian): flaggor (uint16), sedan varje fält vars bit är satt, i bitordning.
 * Kastar RangeError när värdet är kortare än flaggorna säger.
 * @param {DataView} v
 * @returns {{ moreData: boolean, speed?: number, cadence?: number, power?: number, heartRate?: number,
 *             [k: string]: number|boolean|undefined }}  speed i km/h, cadence i rpm, power i W
 */
export function parseIndoorBikeData(v) {
  const flags = v.getUint16(0, true);
  let o = 2;
  const u8 = () => v.getUint8(o++);
  const u16 = () => ((o += 2), v.getUint16(o - 2, true));
  const s16 = () => ((o += 2), v.getInt16(o - 2, true));
  const u24 = () => ((o += 3), v.getUint16(o - 3, true) | (v.getUint8(o - 1) << 16));
  const has = (bit) => (flags & bit) !== 0;

  const d = { moreData: has(FLAG.moreData) };
  if (!has(FLAG.moreData)) d.speed = u16() * 0.01;
  if (has(FLAG.avgSpeed)) d.avgSpeed = u16() * 0.01;
  if (has(FLAG.cadence)) d.cadence = u16() * 0.5;
  if (has(FLAG.avgCadence)) d.avgCadence = u16() * 0.5;
  if (has(FLAG.distance)) d.distance = u24();
  if (has(FLAG.resistance)) d.resistance = s16();
  if (has(FLAG.power)) d.power = s16();
  if (has(FLAG.avgPower)) d.avgPower = s16();
  if (has(FLAG.energy)) {
    d.energyTotal = u16();
    d.energyPerHour = u16();
    d.energyPerMinute = u8();
  }
  if (has(FLAG.heartRate)) d.heartRate = u8();
  if (has(FLAG.met)) d.met = u8() * 0.1;
  if (has(FLAG.elapsed)) d.elapsed = u16();
  if (has(FLAG.remaining)) d.remaining = u16();
  return d;
}

/**
 * Sätter ihop en post som är delad på flera notiser ("More Data"). En trainer som sätter More Data
 * på varje notis ger ändå poster: ett fält som redan finns i den väntande posten börjar en ny.
 */
export class IndoorBikeDataJoiner {
  #pending = null;

  /** @returns {object|null} hela posten, eller null medan mer väntas */
  push(d) {
    const { moreData, ...fields } = d;
    if (moreData) {
      const prev = this.#pending;
      if (prev && Object.keys(fields).some((k) => k in prev)) {
        this.#pending = fields;
        return prev;
      }
      this.#pending = { ...prev, ...fields };
      return null;
    }
    const done = { ...this.#pending, ...fields };
    this.#pending = null;
    return done;
  }
}

export const CPS_FLAG = {
  pedalBalance: 1 << 0,
  accumulatedTorque: 1 << 2,
  wheelRevs: 1 << 4,
  crankRevs: 1 << 5,
};

/**
 * Cycling Power Measurement (little-endian): flaggor (uint16), effekt (sint16, W), sedan de valfria
 * fälten i flaggordning. Fälten efter vevvarven används inte.
 * @param {DataView} v
 * @returns {{ power: number, crankRevs?: number, crankEventTime?: number, [k: string]: number|undefined }}
 */
export function parseCyclingPower(v) {
  const flags = v.getUint16(0, true);
  const d = { power: v.getInt16(2, true) };
  let o = 4;
  if (flags & CPS_FLAG.pedalBalance) d.pedalBalance = v.getUint8(o++) * 0.5;
  if (flags & CPS_FLAG.accumulatedTorque) {
    d.accumulatedTorque = v.getUint16(o, true) / 32;
    o += 2;
  }
  if (flags & CPS_FLAG.wheelRevs) {
    d.wheelRevs = v.getUint32(o, true);
    d.wheelEventTime = v.getUint16(o + 4, true) / 2048;
    o += 6;
  }
  if (flags & CPS_FLAG.crankRevs) {
    d.crankRevs = v.getUint16(o, true);
    d.crankEventTime = v.getUint16(o + 2, true); // 1/1024 s
    o += 4;
  }
  return d;
}

/** Står vevarna still så här länge är kadensen 0. */
export const CADENCE_ZERO_AFTER_S = 3;
const WRAP = 65536;

/**
 * Kadens ur ackumulerade vevvarv och händelsetider (1/1024 s), med överslag vid 65 536 för båda.
 * Null tills två mätningar har kommit, 0 när varven inte har ändrats på CADENCE_ZERO_AFTER_S.
 */
export class CadenceTracker {
  #last = null;
  #lastChange = null;
  #cadence = null;

  /** @param {number} now mottagningstiden i sekunder */
  update(revs, eventTime, now) {
    const prev = this.#last;
    this.#last = { revs, time: eventTime };
    if (!prev) {
      this.#lastChange = now;
      return null;
    }
    const dRevs = (revs - prev.revs + WRAP) % WRAP;
    const dTime = (eventTime - prev.time + WRAP) % WRAP;
    if (dRevs > 0 && dTime > 0) {
      this.#cadence = (dRevs / (dTime / 1024)) * 60;
      this.#lastChange = now;
    } else if (this.#lastChange !== null && now - this.#lastChange >= CADENCE_ZERO_AFTER_S) {
      this.#cadence = 0;
    }
    return this.#cadence;
  }

  reset() {
    this.#last = null;
    this.#lastChange = null;
    this.#cadence = null;
  }
}

/**
 * Trainern skickar notiser hela tiden, även när ingen trampar. Bara en avläsning med effekt och
 * kadens (när den finns) blir ett "drag", annars skulle en stillastående cykel starta nedräkningen.
 * @param {{ power?: number, cadence?: number }} r
 */
export function isPedalling(r) {
  return r.power !== undefined && r.power > 0 && r.cadence !== 0;
}
