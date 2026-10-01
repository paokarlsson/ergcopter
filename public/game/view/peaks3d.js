// Milstolparnas toppar i 3D-landskapet (terrain.js). Varje topp står en bit bort med sin
// riktiga höjd. Kameran står på helikopterns höjd och tittar rakt fram, så toppen ligger
// på helikopterns linje precis när helikoptern är på toppens höjd, på vilket avstånd som
// helst. Topparna kommer in utanför högerkanten och glider fram mot en plats strax höger
// om helikoptern, dit de ska nå när helikoptern når höjden (förutsagt från
// stighastigheten). Förutsägelsen ändras hela tiden, så en topp som ännu inte passerats
// styrs mjukt: den glider lite fortare eller långsammare än landskapet omkring, men
// alltid åt vänster. Ren logik utan DOM, så att den går att testa.

import { MAX_PEAKS } from './terrain.js';
import { rand } from './mountains.js';

const TARGET_RIGHT = 0.12; // toppen passeras så här långt (andel av bredden) till höger om helikoptern
const SKIP_BELOW_M = 60; // topp som redan ligger så här långt under oss skickas inte
const SEND_WINDOW_M = 500; // bara toppar högst så här långt över oss skickas in
const ENTRY_M = 40; // och startar så här långt utanför högerkanten
const STEER = 0.45; // styrningen får ändra toppens fart i bild med högst så här stor andel
const STEER_TAU_S = 2.5; // och rättar felet på ungefär så här lång tid
const LATE_PX = 140; // en topp som skulle passeras närmare högerkanten än så här hoppas över

/**
 * Var en milstolpes topp står: avstånd framåt z och radie r (m). Högre toppar är bredare
 * och står längre bort.
 */
export function peakSize(m) {
  const r = 0.85 * m.h + 300;
  return { z: Math.max(2600, r + 1500) + 1200 * rand(m.h * 0.37 + m.name.length), r };
}

export class PeakField {
  constructor() {
    this.items = []; // { m, x, z, r }
    this.sent = new Set(); // namn på milstolpar som skickats in under passet
    this.passed = new Set(); // och de som helikoptern nått upp till
    this.lastCamX = null;
  }

  /** Nytt pass: inga toppar kvar. */
  clear() {
    this.items = [];
    this.sent.clear();
    this.passed.clear();
    this.lastCamX = null;
  }

  /**
   * Flyttar fram läget: tar bort toppar som passerat ut till vänster, styr toppar som
   * ännu inte passerats mot sin plats och skickar in nya.
   * @param {object} v
   * @param {{name:string,h:number}[]} v.milestones
   * @param {number} v.h, v.vy        helikopterns höjd (m) och stighastighet (m/s)
   * @param {boolean} v.flying         skicka in nya toppar
   * @param {number} v.camX            kamerans läge i sidled (m)
   * @param {number} v.speed           kamerans fart i sidled (m/s)
   * @param {number} v.cx, v.W, v.focal  optiska mitten, bildens bredd och brännvidden (px)
   * @returns {{m:object, x:number, z:number, r:number}[]}
   */
  update(v) {
    // Tiden räknas i kamerans förflyttning, så att styrningen följer landskapet bild för bild.
    const moved = this.lastCamX === null ? 0 : Math.max(0, v.camX - this.lastCamX);
    this.lastCamX = v.camX;
    const kR = (v.W - v.cx) / v.focal; // högerkanten i världen: x = camX + kR·z
    const kL = v.cx / v.focal; // vänsterkanten: x = camX - kL·z
    this.items = this.items.filter((p) => {
      const gone = v.camX - kL * p.z - p.x > p.r * Math.hypot(1, kL);
      // En topp som försvann innan vi nådde den får komma tillbaka senare.
      if (gone && !this.passed.has(p.m.name)) this.sent.delete(p.m.name);
      return !gone;
    });
    for (const p of this.items) if (v.h >= p.m.h) this.passed.add(p.m.name);
    if (!v.flying || v.speed <= 0) return this.items;

    const climb = Math.max(0, v.vy);
    const eta = (m) => (climb > 0.2 ? (m.h - v.h) / climb : Infinity);
    const target = v.cx + TARGET_RIGHT * v.W;
    // Var toppen borde stå i världen nu för att vara framme vid målet när vi når höjden
    const wantedX = (p) => v.camX + ((target - v.cx) * p.z) / v.focal + eta(p.m) * v.speed;

    const dt = moved / v.speed;
    for (const p of this.items) {
      if (this.passed.has(p.m.name)) continue;
      const error = Math.min(wantedX(p), 1e7) - p.x;
      const limit = STEER * moved;
      p.x += Math.max(-limit, Math.min(limit, (error * dt) / STEER_TAU_S));
    }

    for (const m of v.milestones) {
      if (this.sent.has(m.name) || this.items.length >= MAX_PEAKS) continue;
      if (m.h < v.h - SKIP_BELOW_M) {
        this.sent.add(m.name); // redan långt under oss, hade passerat utanför bild
        continue;
      }
      if (m.h > v.h + SEND_WINDOW_M) continue;
      const { z, r } = peakSize(m);
      const entry = v.camX + kR * z + r * Math.hypot(1, kR) + ENTRY_M;
      // Skickas när den hinner glida in i lagom fart, eller direkt om den redan är sen
      if (wantedX({ m, z }) > entry) continue;
      this.sent.add(m.name);
      // Hinner den inte in i bild ens med full styrning när vi stiger så fort, visas den inte.
      const arrive = v.cx + ((entry - v.camX - (1 + STEER) * v.speed * Math.max(0, eta(m))) * v.focal) / z;
      if (arrive > v.W - LATE_PX) continue;
      this.items.push({ m, x: entry, z, r });
    }
    return this.items;
  }
}
