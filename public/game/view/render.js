// Storskärmens scen på Canvas 2D: himmel som mörknar med höjden, fjällkedjor och
// molntäcke som visar hur högt man är (scenery.js), fjälltoppar med etiketter som kommer
// in från höger och passerar under helikoptern, moln i världen, sjön och helikopterplattan
// när man är låg, fartstreck och konfetti (effects.js), höjdlinjer och höjdskalan till vänster.
// I skolan också övningarnas hjälplinjer och ringar, instruktörens helikopter, moln och vinschen.
// Siffror och mätare ligger i DOM (hud.js); höjdrutan placeras efter skalan här (gaugeY).
// Med 3D-landskapet (terrain.js) ritas himlen, fjällen, molnen och dalen i WebGL på en
// egen canvas bakom, och den här canvasen ritar bara helikoptern, etiketterna och linjerna.

import { drawHelicopter, drawCloud, drawTree } from './heli-draw.js';
import { drawMountain, drawLabel, labelLayout, mountainReach, rand } from './mountains.js';
import { drawSky, drawSun, drawCirrus, drawRidges, hazeColor, drawCloudDeck, drawFog, fogAmount, drawAurora } from './scenery.js';
import { Effects } from './effects.js';
import { mix, alpha } from './color.js';
import { PLANE_M } from './terrain.js';
import { PeakField } from './peaks3d.js';

const VIEW_SPAN_M = 300; // höjd som syns i huvudvyn
const GROUND_MARGIN_PX = 56; // marken så här högt upp när man står på den
const CLOUD_LAYER_M = 170;
const SKY_TOP_M = 9000; // här är himlen som mörkast
const GAUGE_STEPS_M = [2000, 3000, 5000, 7000, 9500];
const SCHOOL_GAUGE_STEPS_M = [250, 500, 1000, 1500]; // skolhelikopterns tak är 1 500 m
const GAUGE_X = 46; // höjdskalan till vänster
const GAUGE_TOP_PX = 100; // plats för övningens rubrik ovanför
const GAUGE_BOTTOM_PX = 156; // och för tiden nedanför, så att höjdrutan på 0 m inte täcker den
const LABEL_LEFT_PX = 260; // övningarnas etiketter till höger om höjdrutan
const GUIDE_LABEL_TOP_PX = 110; // och under övningens rubrik
const HELI_X = 0.4; // helikopterns plats i sidled under flygningen, andel av bredden
const EASE_S = 0.7; // helikopterns plats och kvällsljuset glider mot sina mål
const FLY_SPEED_PX = 20; // px/s per rad/s rotorvarv
const MIN_FLY_SPEED_PX = 260; // i luften rullar landskapet minst så här fort
const MOUNTAIN_ENTRY_PX = 200; // bergen startar minst så här långt utanför högerkanten (och alltid helt utanför bild)
const MOUNTAIN_BOTTOM_PX = 60; // silhuetten går så här långt under nederkanten
const MOUNTAIN_GAP_PX = 260; // minsta avstånd mellan två berg som kommer tätt
const MOUNTAIN_SKIP_BELOW_M = 60; // topp som redan ligger så här långt under oss skickas inte
const MOUNTAIN_WITHDRAW_M = 20; // ett väntande berg dras tillbaka först när vi hamnar så här långt under toppen
const SIGN_FADE_S = 0.25; // etiketter tonar in och ut i stället för att blinka
const SIGN_EDGE_FADE_PX = 90; // och tonar mot kanterna av området där de får synas
const ZOOM_OUT_MAX = 0.35; // kameran visar så här mycket mer när det går som fortast
const ZOOM_TIME_S = 1.2;
const FAST_CLIMB_MS = 50; // m/s där fartstreck och utzoomning är fullt påslagna
const DOWNWASH_M = 30; // rotorvinden blåser upp damm under den här höjden
export const RING_SPEED_PX = 320; // ringbanan: landskapet och ringarna rullar i jämn fart
const BUDDY_DX = 200; // instruktörens helikopter flyger så här långt framför (px vid skala 1)
const LAKE_M = 44; // sjön i dalen bakom plattan, px över marken
const TERRAIN_SCALE = { start: 0.5, min: 0.3, max: 0.75 }; // 3D-landskapets upplösning per CSS-pixel
const TERRAIN_REFRESH_S = 0.5; // står kameran still ritas landskapet om så här ofta (molnen driver)
const DUSK_SUN = { x: 0.87, y: 0.15 }; // kvällssolen i 3D, andel av bredd och höjd: till höger, över fjällen

export class GameRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [opts]
   * @param {import('./terrain.js').TerrainRenderer|null} [opts.terrain]  3D-landskapet bakom, om det finns
   */
  constructor(canvas, { terrain = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.terrain = terrain;
    this.terrainOff = false; // för långsam dator: tillbaka till 2D för resten av besöket
    this.terrainScale = TERRAIN_SCALE.start;
    this.frameAvg = 1 / 60; // s per bild, glidande medel
    this.slowS = 0;
    this.fastS = 0;
    this.terrainKey = '';
    this.terrainAt = -Infinity;
    this.terrainShown = null;
    this.peaks = new PeakField(); // milstolparnas toppar i 3D
    this.distance = 0; // px landskapet rullat
    this.mountains = []; // { m, startAt, entry } – sx = W + entry - (distance - startAt)
    this.sent = new Set(); // milstolpar som redan skickats in under passet
    this.speed = 0; // px/s just nu
    this.cruise = 0; // px/s i luften, utan upprampningen vid lyftet
    this.signAlpha = new Map(); // namn → 0–1, etiketternas intoning
    this.lastDraw = null;
    this.zoom = 1; // > 1 när kameran zoomat ut i hög fart
    this.effects = new Effects();
    this.celebrated = new Set(); // toppar som fått konfetti under passet
    this.buddyRotor = { angle: 0, tailAngle: 0, blur: 1 }; // instruktörens helikopter
    this.lastH = 0;
    this.heliX = null; // andel av bredden, glider mot v.heliX
    this.heliY = null;
    this.dusk = null; // 0 = dag, 1 = kvällsljus
    this.gaugeY = 0; // höjdrutans läge på skalan (px), läses av main.js
    this.colors = null;
    const refresh = () => (this.colors = readColors(canvas));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refresh);
    refresh();
  }

  /**
   * Rullar landskapet framåt efter rotorvarv, bara i luften. Övningarna flygs
   * rakt upp och ned vid verkstan, utan framåtfart (forward = false). Ringbanan
   * rullar i jämn fart (fixedSpeed), så att ringarna kommer när övningen säger.
   */
  advance(dt, rotor, h, forward = true, fixedSpeed = null) {
    const airborne = Math.min(1, h / 3);
    this.cruise = forward ? fixedSpeed ?? Math.max(MIN_FLY_SPEED_PX, rotor.omega * FLY_SPEED_PX) : 0;
    this.speed = this.cruise * airborne;
    this.distance += this.speed * dt;
  }

  /** Nytt pass: tillbaka till startplatsen, utan berg eller konfetti från förra passet eller demoturen. */
  clearMountains() {
    this.distance = 0;
    this.mountains = [];
    this.sent.clear();
    this.peaks.clear();
    this.signAlpha.clear();
    this.celebrated.clear();
    this.effects.clear();
  }

  /** Konfetti kring helikoptern, t.ex. när uppflygningen är godkänd. */
  celebrate() {
    const c = this.colors;
    const x = (this.canvas.clientWidth || 0) * (this.heliX ?? HELI_X);
    for (const dx of [-120, 0, 120]) this.effects.burst(x + dx, this.lastH + 25, [c.accent, c.record, c.guide, c.cyan, '#ffffff']);
  }

  /**
   * Skickar in berg från höger så att de når helikoptern ungefär när den når
   * toppens höjd (förutsagt från stighastigheten). Då flyger man över toppen
   * precis när milstolpen passeras. Berg som kommer tätt köar med mellanrum.
   * Förutsägelsen räknar med farten i luften: vid lyftet är farten nästan noll,
   * och då skulle alla berg skickas in direkt och passera långt under toppen.
   */
  #sendMountains(v, W, H, y, hx) {
    if (!v.flying || this.speed <= 0) return;
    const speed = this.cruise;
    const climb = Math.max(0, v.vy);
    const reach = (m) => mountainReach(H + MOUNTAIN_BOTTOM_PX - y(m.h));

    // Berg som ännu inte syns alls dras tillbaka om vi inte längre hinner upp till
    // toppen (t.ex. slutat stiga) – de skickas in igen när vi närmar oss höjden.
    // Ett berg vars sluttning redan syns får alltid vara kvar, annars blinkar det.
    this.mountains = this.mountains.filter((item) => {
      const sx = W + item.entry - (this.distance - item.startAt);
      if (sx - reach(item.m) <= W) return true;
      const reachable = v.h + climb * ((sx - hx) / speed) >= item.m.h - MOUNTAIN_WITHDRAW_M;
      if (reachable) return true;
      this.sent.delete(item.m.name);
      return false;
    });

    for (const m of v.milestones) {
      if (this.sent.has(m.name)) continue;
      // Startar helt utanför bild, så att sluttningen glider in i stället för att dyka upp,
      // och minst MOUNTAIN_GAP_PX bakom föregående berg i kön.
      const last = this.mountains.at(-1);
      const queued = last ? W + last.entry - (this.distance - last.startAt) + MOUNTAIN_GAP_PX : -Infinity;
      const startSx = Math.max(W + Math.max(MOUNTAIN_ENTRY_PX, reach(m)), queued);
      if (m.h > v.h + climb * ((startSx - hx) / speed)) continue;
      this.sent.add(m.name);
      if (m.h < v.h - MOUNTAIN_SKIP_BELOW_M) continue; // redan långt under – skulle passera utanför bild
      // Är berget redan sent ute (t.ex. vid en snabb stigning) startar det närmare, som förr.
      const due = climb > 0 ? hx + ((m.h - v.h) / climb) * speed : Infinity;
      const sx = Math.max(W + MOUNTAIN_ENTRY_PX, queued, Math.min(startSx, due));
      this.mountains.push({ m, startAt: this.distance, entry: sx - W });
    }
  }

  /**
   * @param {object} v
   * @param {number} v.h            höjd att rita (interpolerad eller uppspelning)
   * @param {object} v.rotor
   * @param {number} v.vy           m/s, för lutningen
   * @param {number|null} v.hMax    maxhöjd i passet
   * @param {number|null} v.todayBest
   * @param {{name:string,h:number}[]} v.milestones
   * @param {DOMRect[]} [v.avoid]      instrument i DOM som etiketter inte får hamna under
   * @param {boolean} [v.flying]        skicka in nya berg (bara under passet)
   * @param {boolean} [v.gauge]         rita höjdskalan till vänster
   * @param {number} [v.heliX, v.heliY] helikopterns plats, andel av bredd och höjd (glider dit)
   * @param {number} [v.dusk]           0–1, kvällsljus på start- och resultatskärmen (glider dit)
   * @param {object[]} [v.guides]        övningens hjälplinjer (exercise.js stepGuides)
   * @param {boolean} [v.landingPad]     markera landningsplatsen under helikoptern
   * @param {boolean} [v.workshop]       verkstaden vid startplatsen (övningar)
   * @param {boolean} [v.blind]          i moln: bara helikoptern syns, inga linjer eller skalor
   * @param {object} [v.parked]          helikopter som står parkerad vid verkstan (livery)
   * @param {object} [v.buddyLivery]     instruktörens helikopter i "Följ instruktören"
   * @param {{progress:number, loaded:boolean}} [v.winch]  vinschens lina och sandsäcken
   * @param {object} [v.livery]          helikopterns utseende
   */
  draw(v) {
    const { canvas, ctx } = this;
    const c = this.colors;
    const dpr = devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const t = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
    const frameS = this.lastDraw === null ? 0 : Math.max(0, t - this.lastDraw); // verklig tid, för 3D-landskapets fart
    const dt = Math.min(0.1, frameS);
    this.lastDraw = t;
    const ease = (now, target) => (now === null ? target : now + (target - now) * Math.min(1, dt / EASE_S));
    this.heliX = ease(this.heliX, v.heliX ?? HELI_X);
    this.heliY = ease(this.heliY, v.heliY ?? 0.5);
    this.dusk = ease(this.dusk, v.dusk ?? 0);
    const dusk = this.dusk;

    // Kameran zoomar ut lite när det går fort, så att farten känns och man ser mer av det som kommer.
    const fast = clamp01((Math.abs(v.vy) - 8) / (FAST_CLIMB_MS - 8));
    this.zoom += (1 + ZOOM_OUT_MAX * fast - this.zoom) * Math.min(1, dt / ZOOM_TIME_S);
    const pxPerM = (H * 0.8) / (VIEW_SPAN_M * this.zoom);
    const heliY0 = H * this.heliY;
    const camGround = (H - heliY0 - GROUND_MARGIN_PX) / pxPerM;
    const cam = Math.max(v.h, camGround); // höjden som hamnar på heliY0
    const y = (alt) => heliY0 - (alt - cam) * pxPerM;
    const scale = Math.max(0.6, Math.min(1.9, W / 1000)); // helikopterns storlek
    const hx = W * this.heliX;
    const airborne = Math.min(1, v.h / 3);
    const thin = Math.min(1, Math.max(0, cam / SKY_TOP_M));
    this.lastH = v.h;

    this.effects.update(dt, this.speed);
    if (v.h < DOWNWASH_M && v.rotor.blur > 0.25 && y(0) < H) {
      this.effects.downwash(dt, hx, v.rotor.blur * (1 - v.h / DOWNWASH_M), c.dust);
    }

    const td = this.#use3d(frameS);
    if (td) {
      ctx.clearRect(0, 0, W, H);
      this.#landscape3d(ctx, W, H, v, { pxPerM, heliY0, cam, hx, t, dt, dusk, thin, scale, y });
    } else {
      this.#sendMountains(v, W, H, y, hx);
      drawSky(ctx, W, H, thin, dusk, c);
      drawSun(ctx, W, H, thin, dusk, c);
      drawCirrus(ctx, W, H, t, thin, dusk, c);
      drawAurora(ctx, W, H, cam, t, c);
      this.#stars(ctx, W, H, thin);
      const haze = hazeColor(thin, dusk, c);
      drawRidges(ctx, W, H, H - GROUND_MARGIN_PX, (cam - camGround) * pxPerM, this.distance, haze, dusk, c);
      drawCloudDeck(ctx, W, H, cam, y, heliY0, pxPerM, this.distance, c);
      this.#mountains(ctx, W, H, v, y, dt, cam, thin, dusk, hx, scale);
      this.#clouds(ctx, W, H, cam, y, dusk);
    }
    if (y(0) < H + 80) this.#ground(ctx, W, H, y(0), v, hx, t, dusk, td);
    if (!td) drawFog(ctx, W, H, fogAmount(cam), c);
    if (v.blind) drawCloudBank(ctx, W, H, t, this.distance, c);
    this.#lines(ctx, W, H, v, y, c);
    const front = this.#guides(ctx, W, H, v, y, c, dt, scale, hx);
    this.effects.drawStreaks(ctx, W, H, dt, this.speed, v.vy * pxPerM, fast ** 1.5, c.streak);
    this.effects.drawParticles(ctx, y);

    // Helikoptern: medarna mot marken vid h = 0. I luften gungar den lite, och
    // i full stigning skakar den av kraften.
    const shake = 2.5 * clamp01((v.vy - 25) / 40);
    const hy =
      y(v.h) - 32 * scale + airborne * 2.5 * Math.sin(t * 2.1) + shake * (Math.sin(t * 43) + Math.sin(t * 71)) * 0.5;
    if (v.winch) drawWinch(ctx, hx, hy + 20 * scale, Math.min(H + 20, y(0)), v.winch, scale, c);
    ctx.fillStyle = c.shadow;
    if (y(0) < H) {
      const sw = 60 * scale * Math.max(0.2, 1 - v.h / 120);
      ctx.beginPath();
      ctx.ellipse(hx, y(0) + 2, sw, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(hx + shake * Math.sin(t * 57) * 0.5, hy);
    // Nosen ned i framåtflykt (positiv vinkel = medurs), lite upp när den stiger fort.
    const pitch = this.speed > 0 ? 0.08 * v.rotor.blur * airborne : 0;
    ctx.rotate(pitch - Math.max(-0.05, Math.min(0.05, v.vy * 0.002)));
    ctx.scale(scale, scale);
    drawHelicopter(ctx, v.rotor, c, v.livery, { dusk });
    ctx.restore();
    front?.(); // främre halvan av hovringsringen, framför helikoptern

    if (v.gauge && !v.blind) this.#gauge(ctx, W, H, v, c);
    else this.gaugeY = H / 2;
  }

  /** Stjärnor när luften blir tunn. */
  #stars(ctx, W, H, thin) {
    const stars = Math.max(0, (thin - 0.45) / 0.55);
    if (stars <= 0) return;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 80; i++) {
      ctx.globalAlpha = stars * (0.3 + 0.7 * rand(i * 7.1));
      const sx = mod(rand(i) * W * 1.5 - this.distance * 0.02, W);
      ctx.fillRect(sx, rand(i + 99) * H, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Passerade toppar på väg från höger till vänster. Högre toppar ritas först,
   * så att en lägre topps sluttning aldrig täcker en högre topp med etikett.
   * Etiketten får en bock när helikoptern flugit över toppen.
   */
  #mountains(ctx, W, H, v, y, dt, cam, thin, dusk, hx, scale) {
    const c = this.colors;
    const bottom = H + MOUNTAIN_BOTTOM_PX;
    const hazeTarget = mix(mix(c.skyTopLow, c.skyTopHigh, thin), c.duskMid, dusk * 0.6);
    const sxOf = (item) => W + item.entry - (this.distance - item.startAt);
    this.mountains = this.mountains.filter((item) => sxOf(item) > -W); // långt ut till vänster
    const visible = this.mountains
      .map((item) => ({
        m: item.m,
        sx: sxOf(item),
        sy: y(item.m.h),
        // Nära: lite dis. En topp över helikoptern (man slutade stiga) disas mer, så
        // att den läses som ett berg längre bort som man flyger förbi framför.
        haze: 0.05 + 0.2 * rand(item.m.h * 1.3 + 7) + 0.4 * Math.min(1, Math.max(0, (item.m.h - v.h) / 120)),
      }))
      .filter(({ sx, sy }) => sy < H + 20 && sx - mountainReach(bottom - sy) < W)
      .sort((a, b) => b.m.h - a.m.h);
    // Konfetti när helikoptern flyger över en topp (inte när man passerar under den).
    for (const { m, sx } of visible) {
      if (sx > hx || this.celebrated.has(m.name)) continue;
      this.celebrated.add(m.name);
      if (v.flying && v.h >= m.h - 30) this.effects.burst(sx, m.h, [c.accent, c.record, c.guide, c.cyan, '#ffffff']);
    }
    for (const { m, sx, sy, haze } of visible) {
      // En topp högt över oss är långt bort: genomskinlig, så att landskapet bakom syns
      // i stället för en grå vägg över hela bilden.
      ctx.globalAlpha = 1 - 0.9 * clamp01((m.h - v.h) / 150);
      const colors = {
        ...c,
        rock: mix(mix(c.mountainRock, c.duskTop, dusk * 0.4), hazeTarget, haze),
        snow: mix(mix(c.mountainSnow, '#ffc58f', dusk * 0.35), hazeTarget, haze * 0.5),
        valleyHaze: hazeColor(thin, dusk, c),
      };
      drawMountain(ctx, m, sx, sy, bottom, colors);
    }
    ctx.globalAlpha = 1;
    this.#signs(ctx, W, v, visible.map((item) => ({ ...item, passed: item.sx <= hx })), dt, hx, scale, y);
  }

  /**
   * Etiketterna på topparna; de som skulle hamna under instrumenten eller en annan
   * etikett tonas ut. Etiketter som redan syns placeras först, så att två etiketter som
   * nuddar varandra inte turas om att synas bild för bild.
   * @param {{m:object, sx:number, sy:number, passed:boolean}[]} visible  topparna i bild
   */
  #signs(ctx, W, v, visible, dt, hx, scale, y) {
    const c = this.colors;
    const taken = [...(v.avoid ?? [])];
    // Etiketterna skalar med skärmbredden: ~1,6 på 1 600 px, större på en storskärm.
    const s = Math.max(0.9, Math.min(2.4, W / 1000));
    const shown = (m) => (this.signAlpha.get(m.name) ?? 0) > 0;
    const order = [...visible].sort((a, b) => shown(b.m) - shown(a.m));
    // Helikoptern flyger över toppen: etiketten lyfts mjukt över den i stället för att hamna bakom.
    const heli = { x0: hx - 130 * scale, x1: hx + 100 * scale, top: y(v.h) - 86 * scale, bottom: y(v.h) };
    const signs = [];
    for (const { m, sx, sy, passed } of order) {
      const L = labelLayout(ctx, m, sx, sy, passed, s, fmtM);
      const near = clamp01((Math.min(L.x + L.w, heli.x1) - Math.max(L.x, heli.x0) + 60) / 60);
      const lift = near * Math.max(0, L.y + L.bh - heli.top);
      if (lift > 0 && L.y < heli.bottom) {
        L.y -= lift;
        L.h += lift;
      }
      const edge =
        clamp01((W - 60 - sx) / SIGN_EDGE_FADE_PX) * clamp01((sx - 70) / SIGN_EDGE_FADE_PX) * clamp01((L.y - 4) / 30);
      const fits = edge > 0 && !taken.some((r) => overlaps(L, r));
      if (fits) taken.push({ x: L.x - 6, y: L.y - 6, w: L.w + 12, h: L.h + 12 });
      const step = dt / SIGN_FADE_S;
      const a = clamp01((this.signAlpha.get(m.name) ?? 0) + (fits ? step : -step));
      this.signAlpha.set(m.name, a);
      if (a * edge > 0) signs.push({ m, sx, sy, passed, L, a: a * edge });
    }
    for (const name of this.signAlpha.keys()) {
      if (!visible.some((item) => item.m.name === name)) this.signAlpha.delete(name);
    }
    // Rita i höjdordning som bergen, så att överlappande etiketter under intoning ligger stilla.
    for (const { m, sx, sy, passed, L, a } of signs.sort((p, q) => q.m.h - p.m.h)) {
      ctx.globalAlpha = a;
      drawLabel(ctx, m, sx, sy, passed, s, c, L);
    }
    ctx.globalAlpha = 1;
  }

  /** 3D-landskapet är igång (WebGL2 finns, shadern är byggd och datorn hinner med). */
  get landscape3d() {
    return Boolean(this.terrain?.ready) && !this.terrainOff;
  }

  /**
   * Ska 3D-landskapet ritas? Sänker upplösningen om bilderna tar för lång tid.
   * @param {number} dt  verklig tid sedan förra bilden (s)
   */
  #use3d(dt) {
    const ok = Boolean(this.terrain?.ready) && !this.terrainOff;
    if (ok && dt > 0 && dt < 5) {
      this.frameAvg += (Math.min(dt, 0.5) - this.frameAvg) * 0.1;
      this.slowS = this.frameAvg > 1 / 42 ? this.slowS + dt : 0;
      this.fastS = this.frameAvg < 1 / 56 ? this.fastS + dt : 0;
      if (this.slowS > 0.4) {
        this.slowS = 0;
        if (this.terrainScale > TERRAIN_SCALE.min) {
          this.terrainScale = Math.max(TERRAIN_SCALE.min, this.terrainScale * 0.85);
        } else if (this.frameAvg > 1 / 20) {
          // Även på lägsta upplösning går det för trögt: 2D resten av besöket.
          this.terrainOff = true;
          console.info('[Ergcopter] 3D-landskapet är för tungt för den här datorn – ritar i 2D.');
        }
      }
      if (this.fastS > 2.5) {
        this.fastS = 0;
        this.terrainScale = Math.min(TERRAIN_SCALE.max, this.terrainScale * 1.08);
      }
    }
    const use = ok && !this.terrainOff;
    if (this.terrain && this.terrainShown !== use) {
      this.terrainShown = use;
      this.terrain.canvas.style.visibility = use ? 'visible' : 'hidden';
    }
    return use;
  }

  /**
   * 3D-landskapet: kameran på helikopterns höjd, optiska mitten på helikoptern och
   * samma skala som 2D-scenen i helikopterns plan. Milstolparnas toppar står långt bort
   * (peaks3d.js) och får etiketter här.
   */
  #landscape3d(ctx, W, H, v, o) {
    const basePxPerM = (H * 0.8) / VIEW_SPAN_M; // utan utzoomning, så att sidledes läget inte hoppar
    const camX = this.distance / basePxPerM;
    const focal = o.pxPerM * PLANE_M;
    const items = this.peaks.update({
      milestones: v.milestones,
      h: v.h,
      vy: v.vy,
      flying: v.flying,
      camX,
      speed: this.speed / basePxPerM,
      cx: o.hx,
      W,
      focal,
    });
    const view = {
      width: W,
      height: H,
      cx: o.hx,
      cy: o.heliY0,
      focal,
      camX,
      camY: o.cam,
      dusk: o.dusk,
      thin: o.thin,
      sun: DUSK_SUN,
      peaks: items.map((p) => ({ x: p.x, z: p.z, h: p.m.h, r: p.r })),
      // Plattan vid startplatsen, ungefär lika stor som helikoptern
      pad: { x: 0, z: PLANE_M, r: (110 * o.scale) / basePxPerM },
    };
    // Rita bara om när något ändrats, eller då och då för molnens skull.
    const key = JSON.stringify(view, (k, val) => (typeof val === 'number' ? Math.round(val * 100) / 100 : val));
    if (key !== this.terrainKey || o.t - this.terrainAt > TERRAIN_REFRESH_S) {
      this.terrainKey = key;
      this.terrainAt = o.t;
      this.terrain.render({ ...view, scale: this.terrainScale, time: o.t });
    }

    const visible = items
      .map((p) => ({
        m: p.m,
        sx: o.hx + ((p.x - camX) * focal) / p.z,
        sy: o.heliY0 - ((p.m.h - o.cam) * focal) / p.z,
        passed: this.peaks.passed.has(p.m.name),
      }))
      .filter(({ sx, sy }) => sx > -200 && sx < W + 200 && sy > -40 && sy < H + 20);
    // Konfetti när helikoptern når upp till en topp i bild.
    const c = this.colors;
    for (const { m, sx, passed } of visible) {
      if (!passed || this.celebrated.has(m.name)) continue;
      this.celebrated.add(m.name);
      if (v.flying && sx > 0 && sx < W) this.effects.burst(sx, m.h, [c.accent, c.record, c.guide, c.cyan, '#ffffff']);
    }
    this.#signs(ctx, W, v, visible, o.dt, o.hx, o.scale, o.y);
  }

  #clouds(ctx, W, H, cam, y, dusk) {
    const c = this.colors;
    const light = mix(c.cloud, '#ffd2a8', dusk * 0.6);
    const lo = Math.floor((cam - VIEW_SPAN_M) / CLOUD_LAYER_M);
    const hi = Math.ceil((cam + VIEW_SPAN_M) / CLOUD_LAYER_M);
    for (let j = Math.max(1, lo); j <= hi; j++) {
      const alt = j * CLOUD_LAYER_M;
      const few = Math.max(0, 1 - alt / 7000); // färre moln högt upp
      if (rand(j * 3.3) > 0.35 + 0.6 * few) continue;
      const span = W + 360;
      const x = mod(rand(j) * span - this.distance * (0.25 + 0.3 * rand(j + 5)), span) - 180;
      ctx.globalAlpha = 0.55 + 0.35 * few;
      drawCloud(ctx, x, y(alt), 0.6 + rand(j + 11) * 1.1, c, j, light);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Dalen vid startplatsen: sjön, stranden med granar och stenar, plattan och verkstan.
   * Med 3D-landskapet finns sjön, marken och plattan redan där; bara verkstan, den
   * parkerade helikoptern och landningsringen ritas här.
   */
  #ground(ctx, W, H, groundY, v, hx, t, dusk, td) {
    const c = this.colors;
    const d = this.distance;
    const padX = hx - d;
    if (td) {
      if (v.workshop && padX > -460) drawWorkshop(ctx, padX - 330, groundY, c);
      if (v.parked && padX > -700) drawParked(ctx, padX + 320, groundY, v.parked, c);
      if (v.landingPad) drawLandingRing(ctx, hx, groundY, t, c);
      return;
    }
    // Sjön speglar himlen, med ljusa strimmor som glittrar
    const lakeTop = groundY - LAKE_M;
    const water = ctx.createLinearGradient(0, lakeTop, 0, groundY);
    water.addColorStop(0, mix(mix(c.lake, '#ffffff', 0.4), c.duskBottom, dusk * 0.5));
    water.addColorStop(1, mix(c.lake, '#0b1a2e', 0.45));
    ctx.fillStyle = water;
    ctx.fillRect(0, lakeTop, W, LAKE_M + 2);
    ctx.fillStyle = alpha(mix('#ffffff', '#ffd2a8', dusk), 0.3);
    for (let i = 0; i < 16; i++) {
      const x = mod(rand(i) * W * 1.3 - d * 0.3, W + 120) - 60;
      const yy = lakeTop + 5 + rand(i + 3) * (LAKE_M - 18);
      ctx.fillRect(x, yy, (20 + 50 * rand(i + 5)) * (0.7 + 0.3 * Math.sin(t * 0.8 + i)), 1.5);
    }

    // Stranden och marken i förgrunden: mjuka kullar
    const shore = (x) => {
      const u = x + d * 0.6;
      return groundY - 16 - 7 * Math.sin(u / 170) - 5 * Math.sin(u / 61 + 1);
    };
    const land = ctx.createLinearGradient(0, groundY - 30, 0, H);
    land.addColorStop(0, mix(c.hill, c.duskTop, dusk * 0.3));
    land.addColorStop(1, mix(c.ground, '#0b1220', 0.35 + dusk * 0.2));
    ctx.fillStyle = land;
    ctx.beginPath();
    ctx.moveTo(0, H + 1);
    for (let x = 0; x <= W + 8; x += 8) ctx.lineTo(x, shore(x));
    ctx.lineTo(W + 8, H + 1);
    ctx.closePath();
    ctx.fill();
    // Stenar och tuvor, fasta i världen
    for (let k = Math.floor(d * 0.9 / 47) - 1; k * 47 - d * 0.9 < W + 47; k++) {
      const x = k * 47 - d * 0.9 + 30 * rand(k * 2.3);
      const yy = groundY + 6 + (H - groundY) * 0.6 * rand(k * 4.7);
      if (yy > H + 10) continue;
      const r = 3 + 7 * rand(k * 1.9);
      ctx.fillStyle = rand(k * 6.1) < 0.5 ? mix(c.rock, '#000000', 0.2) : alpha(mix(c.hill, '#000000', 0.25), 0.8);
      ctx.beginPath();
      ctx.ellipse(x, yy, r * 1.4, r * 0.7, 0, Math.PI, 0);
      ctx.fill();
    }
    // Granar längs stranden, oregelbundet
    for (let k = Math.floor(d * 0.6 / 64) - 1; k * 64 - d * 0.6 < W + 64; k++) {
      if (rand(k * 3.1) > 0.6) continue;
      const x = k * 64 - d * 0.6 + 36 * rand(k * 1.7);
      drawTree(ctx, x, shore(x) + 4, c, 0.9 + 0.7 * rand(k * 5.3));
    }

    if (v.workshop && padX > -460) drawWorkshop(ctx, padX - 330, groundY, c);
    if (v.parked && padX > -700) drawParked(ctx, padX + 320, groundY, v.parked, c);
    if (padX > -160) drawPad(ctx, padX, groundY, c);
    if (v.landingPad) drawLandingRing(ctx, hx, groundY, t, c);
  }

  /**
   * Övningens hjälplinjer: målhöjder som streckade linjer och zoner som band, med
   * etikett. Hovringsbandet fylls på medan man håller sig i det och har en ring runt
   * helikoptern. Returnerar ringens främre halva, som ritas efter helikoptern.
   */
  #guides(ctx, W, H, v, y, c, dt, scale, hx) {
    let front = null;
    for (const g of v.guides ?? []) {
      if (g.kind === 'ring') {
        const x = hx + g.inS * RING_SPEED_PX;
        if (x < -80 || x > W + 80) continue;
        drawRing(ctx, x, y(g.h + g.tol), y(g.h - g.tol), g.hit, c);
      } else if (g.kind === 'buddy') {
        // Bandet runt instruktören och hens helikopter lite framför vår.
        const top = y(g.hi);
        const bottom = y(g.lo);
        ctx.fillStyle = c.guideBand;
        ctx.fillRect(0, top, W, bottom - top);
        dashed(ctx, 0, W, top, c.guide);
        dashed(ctx, 0, W, bottom, c.guide);
        const r = this.buddyRotor;
        r.angle = (r.angle + 16 * dt) % (Math.PI * 2);
        r.tailAngle = (r.tailAngle + 48 * dt) % (Math.PI * 2);
        ctx.save();
        ctx.translate(hx + BUDDY_DX * scale, y(g.h) - 32 * scale);
        ctx.scale(scale * 0.85, scale * 0.85);
        drawHelicopter(ctx, r, c, v.buddyLivery, { dusk: this.dusk });
        ctx.restore();
        guideLabel(ctx, 'Instruktören', LABEL_LEFT_PX, inBand(top, bottom), c);
      } else if (g.kind === 'band') {
        const top = y(g.hi);
        const bottom = y(g.lo);
        if (bottom < -20 || top > H + 20) continue;
        ctx.fillStyle = c.guideBand;
        ctx.fillRect(0, top, W, bottom - top);
        if (g.progress > 0) {
          ctx.fillStyle = c.guideFill;
          ctx.fillRect(0, top, W * g.progress, bottom - top);
        }
        dashed(ctx, 0, W, top, c.guide);
        dashed(ctx, 0, W, bottom, c.guide);
        guideLabel(ctx, g.label, LABEL_LEFT_PX, inBand(top, bottom), c);
        if (g.ring) {
          // "Håll dig inom ringen": en lysande ring på målhöjden runt helikoptern
          const inside = v.h >= g.lo && v.h <= g.hi;
          const ring = { x: hx, y: y((g.lo + g.hi) / 2) - 8 * scale, rx: 150 * scale, ry: 20 * scale, inside };
          drawHoverRing(ctx, ring, Math.PI, Math.PI * 2, c);
          front = () => drawHoverRing(ctx, ring, 0, Math.PI, c);
        }
      } else {
        const yy = y(g.h);
        if (yy < -20 || yy > H + 20) continue;
        dashed(ctx, 0, W, yy, c.guide);
        guideLabel(ctx, g.label, LABEL_LEFT_PX, Math.max(GUIDE_LABEL_TOP_PX, yy - 6), c);
      }
    }
    return front;
  }

  /**
   * Horisontella linjer för dagens rekord och maxhöjden i passet (milstolparna
   * syns som fjälltoppar i stället). Etiketter som skulle krocka hoppas över, och
   * de flyttas in till vänster om instrumenten.
   */
  #lines(ctx, W, H, v, y, c) {
    const lines = [
      v.todayBest ? { h: v.todayBest, label: `Dagens rekord ${fmtM(v.todayBest)} m`, color: c.record, prio: 1 } : null,
      v.hMax > 0 ? { h: v.hMax, label: `Max i passet ${fmtM(v.hMax)} m`, color: c.sessionMax, prio: 2 } : null,
    ]
      .filter(Boolean)
      .map((line) => ({ ...line, yy: Math.round(y(line.h)) + 0.5 }))
      .filter((line) => line.yy > -20 && line.yy < H + 20);

    for (const line of lines) {
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(GAUGE_X, line.yy);
      ctx.lineTo(W, line.yy);
      ctx.stroke();
    }
    ctx.font = '600 16px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = c.lineText;
    for (const line of placeLabels(lines, 18)) {
      let x = W - 20;
      for (const r of v.avoid ?? []) {
        if (r.top - 4 < line.yy && r.bottom + 22 > line.yy && r.right > x - 220) x = Math.min(x, r.left - 12);
      }
      ctx.fillText(line.label, x, line.yy - 4);
    }
  }

  /** Höjdskalan till vänster: från marken till en bit över det man siktar på. */
  #gauge(ctx, W, H, v, c) {
    const x = GAUGE_X;
    const top = GAUGE_TOP_PX;
    const bottom = H - GAUGE_BOTTOM_PX;
    // Fasta steg så att skalan inte zoomar om vid varje passerad topp.
    const guideTop = Math.max(0, ...(v.guides ?? []).map((g) => g.hi ?? g.h));
    const reach = Math.max(v.h, v.hMax ?? 0, v.todayBest ?? 0, guideTop) * 1.15;
    const steps = v.workshop ? SCHOOL_GAUGE_STEPS_M : GAUGE_STEPS_M;
    const range = steps.find((r) => r >= reach) ?? Math.ceil(reach / 1000) * 1000;
    const gy = (alt) => bottom - (Math.min(alt, range) / range) * (bottom - top);
    const major = [50, 100, 250, 500, 1000, 2000, 2500].find((s) => range / s <= 6);

    ctx.save();
    ctx.shadowColor = 'rgb(0 0 0 / 0.5)';
    ctx.shadowBlur = 4;
    ctx.strokeStyle = c.tick;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.font = '600 17px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = c.tickText;
    for (let alt = 0; alt <= range + 1e-9; alt += major / 5) {
      const yy = Math.round(gy(alt)) + 0.5;
      const big = Math.abs(alt / major - Math.round(alt / major)) < 1e-6;
      ctx.lineWidth = big ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x - (big ? 10 : 5), yy);
      ctx.lineTo(x + (big ? 10 : 5), yy);
      ctx.stroke();
      if (big) ctx.fillText(`${fmtM(alt)} m`, x + 18, yy);
    }
    ctx.restore();

    // Höjden hittills: blå linje från marken
    ctx.strokeStyle = c.sessionMax;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, gy(v.h));
    ctx.stroke();
    // Milstolparna som korta streck till vänster
    ctx.fillStyle = c.milestone;
    for (const m of v.milestones) if (m.h <= range) ctx.fillRect(x - 16, Math.round(gy(m.h)), 8, 2);
    // Dagens rekord och maxhöjden: trianglar
    for (const [alt, color] of [[v.todayBest, c.record], [v.hMax, c.sessionMax]]) {
      if (!alt) continue;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - 8, gy(alt));
      ctx.lineTo(x - 20, gy(alt) - 7);
      ctx.lineTo(x - 20, gy(alt) + 7);
      ctx.fill();
    }
    // Övningens mål
    ctx.fillStyle = c.guide;
    for (const g of v.guides ?? []) {
      if (g.kind === 'band') roundRect(ctx, x - 7, gy(g.hi), 14, Math.max(4, gy(g.lo) - gy(g.hi)), 3);
      else if (g.kind === 'line') roundRect(ctx, x - 10, gy(g.h) - 2, 20, 4, 2);
      else continue;
      ctx.fill();
    }
    this.gaugeY = gy(v.h);
  }
}

/**
 * Väljer etiketter som får plats med minst `gap` px mellan sig. Högre prio
 * placeras först; bland lika prio vinner den högsta (lägsta y).
 */
function placeLabels(items, gap) {
  const placed = [];
  const order = [...items].sort((a, b) => b.prio - a.prio || a.yy - b.yy);
  for (const item of order) {
    if (placed.every((p) => Math.abs(p.yy - item.yy) >= gap)) placed.push(item);
  }
  return placed;
}

function readColors(el) {
  const css = getComputedStyle(el);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    skyTopLow: v('--sky-top-low'),
    skyTopHigh: v('--sky-top-high'),
    skyBottomLow: v('--sky-bottom-low'),
    skyBottomHigh: v('--sky-bottom-high'),
    duskTop: v('--dusk-top'),
    duskMid: v('--dusk-mid'),
    duskBottom: v('--dusk-bottom'),
    cloud: v('--cloud'),
    hill: v('--hill'),
    ground: v('--ground'),
    tree: v('--tree'),
    trunk: v('--trunk'),
    pad: v('--pad'),
    padMark: v('--pad-mark'),
    rock: v('--rock'),
    lake: v('--lake'),
    shadow: v('--heli-shadow'),
    body: v('--heli-body'),
    accent: v('--heli-accent'),
    glass: v('--heli-glass'),
    metal: v('--heli-metal'),
    rotor: v('--heli-rotor'),
    tick: v('--scene-tick'),
    tickText: v('--scene-text-muted'),
    lineText: v('--scene-text'),
    milestone: v('--line-milestone'),
    record: v('--line-record'),
    sessionMax: v('--line-session'),
    gaugeTrack: v('--gauge-track'),
    surface: v('--scene-surface'),
    mountainRock: v('--mountain-rock'),
    mountainSnow: v('--mountain-snow'),
    mountainShade: v('--mountain-shade'),
    labelBg: v('--label-bg'),
    labelEdge: v('--label-edge'),
    labelText: v('--label-text'),
    labelCheck: v('--label-check'),
    guide: v('--guide'),
    guideBand: v('--guide-band'),
    guideFill: v('--guide-fill'),
    guideLabelBg: v('--guide-label-bg'),
    guideLabelText: v('--guide-label-text'),
    workshopWall: v('--workshop-wall'),
    workshopRoof: v('--workshop-roof'),
    workshopDoor: v('--workshop-door'),
    ridgeFar: v('--ridge-far'),
    ridgeMid: v('--ridge-mid'),
    ridgeNear: v('--ridge-near'),
    ridgeSnow: v('--ridge-snow'),
    sun: v('--sun'),
    sunGlow: v('--sun-glow'),
    cloudShade: v('--cloud-shade'),
    aurora1: v('--aurora-1'),
    aurora2: v('--aurora-2'),
    streak: v('--streak'),
    dust: v('--dust'),
    cyan: v('--cyan'),
  };
}

/** Rektanglar {x, y, w, h} (DOMRect har också width/height) – överlappar de? */
function overlaps(a, b) {
  const bw = b.w ?? b.width;
  const bh = b.h ?? b.height;
  return a.x < b.x + bw && b.x < a.x + a.w && a.y < b.y + bh && b.y < a.y + a.h;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, Math.max(0, h), Math.min(r, Math.max(0, h) / 2));
}

function dashed(ctx, x0, x1, yy, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 10]);
  ctx.beginPath();
  ctx.moveTo(x0, Math.round(yy) + 0.5);
  ctx.lineTo(x1, Math.round(yy) + 0.5);
  ctx.stroke();
  ctx.restore();
}

/** Etikettens underkant inne i ett band (eller ovanför om bandet är smalt), fritt från rubriken. */
function inBand(top, bottom) {
  const y = bottom - top > 44 ? top + 38 : top - 6;
  return Math.max(GUIDE_LABEL_TOP_PX, y);
}

/** Etikett med mörk platta, läsbar mot både ljus och mörk himmel. */
function guideLabel(ctx, text, x, bottomY, c) {
  ctx.font = '600 19px "Barlow Condensed", system-ui, sans-serif';
  const w = ctx.measureText(text).width + 22;
  ctx.fillStyle = c.guideLabelBg;
  ctx.beginPath();
  ctx.roundRect(x, bottomY - 30, w, 30, 6);
  ctx.fill();
  ctx.fillStyle = c.guideLabelText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 11, bottomY - 15);
}

/** Ringen runt helikoptern i hovringen; lyser starkare när man är innanför bandet. */
function drawHoverRing(ctx, r, from, to, c) {
  ctx.save();
  ctx.strokeStyle = c.guide;
  ctx.shadowColor = c.guide;
  ctx.shadowBlur = r.inside ? 18 : 6;
  ctx.globalAlpha = r.inside ? 1 : 0.6;
  ctx.lineWidth = r.inside ? 6 : 4;
  ctx.beginPath();
  ctx.ellipse(r.x, r.y, r.rx, r.ry, 0, from, to);
  ctx.stroke();
  ctx.restore();
}

/** Helikopterplattan i perspektiv: asfalt, gul streckad cirkel och ett H. */
function drawPad(ctx, x, groundY, c) {
  ctx.fillStyle = mix(c.pad, '#000000', 0.25);
  ctx.beginPath();
  ctx.ellipse(x, groundY + 3, 120, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c.pad;
  ctx.beginPath();
  ctx.ellipse(x, groundY + 1, 116, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = c.padMark;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([12, 8]);
  ctx.beginPath();
  ctx.ellipse(x, groundY + 1, 92, 10.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // H:et ligger platt på plattan
  ctx.save();
  ctx.translate(x + 62, groundY + 1);
  ctx.scale(1, 0.24);
  ctx.fillStyle = c.padMark;
  ctx.fillRect(-12, -16, 6, 32);
  ctx.fillRect(6, -16, 6, 32);
  ctx.fillRect(-6, -3, 12, 6);
  ctx.restore();
}

/** Landningen: en pulserande grön ring på plattan under helikoptern. */
function drawLandingRing(ctx, x, groundY, t, c) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 4);
  ctx.save();
  ctx.strokeStyle = c.guide;
  ctx.shadowColor = c.guide;
  ctx.shadowBlur = 10 + 10 * pulse;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(x, groundY + 1, 70 + 6 * pulse, 8 + 0.7 * pulse, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Verkstaden där aspiranten startar: hangar med sadeltak och port. */
function drawWorkshop(ctx, x, groundY, c) {
  const w = 190;
  const h = 70;
  ctx.fillStyle = c.workshopWall;
  ctx.fillRect(x - w / 2, groundY - h, w, h);
  ctx.fillStyle = alpha('#000000', 0.15);
  for (let i = -w / 2 + 12; i < w / 2; i += 14) ctx.fillRect(x + i, groundY - h, 2, h);
  ctx.fillStyle = c.workshopRoof;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - 12, groundY - h);
  ctx.lineTo(x, groundY - h - 38);
  ctx.lineTo(x + w / 2 + 12, groundY - h);
  ctx.fill();
  ctx.fillStyle = c.workshopDoor;
  ctx.fillRect(x - 55, groundY - 52, 110, 52);
  ctx.fillStyle = c.workshopRoof;
  ctx.font = '800 15px "Barlow Condensed", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VERKSTAN', x, groundY - 61);
}

/** En ring i ringbanan: grön efter träff, röd efter miss. */
function drawRing(ctx, x, top, bottom, hit, c) {
  const ry = (bottom - top) / 2;
  ctx.save();
  ctx.lineWidth = 8;
  ctx.strokeStyle = hit === true ? '#3fb950' : hit === false ? '#ff6b6b' : c.guide;
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.ellipse(x, top + ry, Math.max(10, ry * 0.35), ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Molnet i molnflygningen: nästan vitt, med tjockare stråk som driver förbi. */
function drawCloudBank(ctx, W, H, t, distance, c) {
  drawFog(ctx, W, H, 1, c);
  for (let i = 0; i < 9; i++) {
    ctx.globalAlpha = 0.35 + 0.3 * rand(i * 3.7);
    const x = mod(rand(i) * W * 1.6 - t * (20 + 30 * rand(i + 4)) - distance * 0.3, W + 400) - 200;
    drawCloud(ctx, x, rand(i + 9) * H, 3 + 3 * rand(i + 2), c, i);
  }
  ctx.globalAlpha = 1;
}

/** Vinschen: lina från helikoptern och sandsäcken som hissas upp. */
function drawWinch(ctx, x, top, groundY, winch, scale, c) {
  const hang = 70 * scale;
  const lifted = winch.loaded ? top + hang : groundY - 10 + (top + hang - (groundY - 10)) * winch.progress;
  const bagY = Math.min(lifted, groundY - 24 * scale); // säcken står på marken när man landar
  ctx.strokeStyle = c.metal;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bagY);
  ctx.stroke();
  ctx.fillStyle = '#c8a26a';
  ctx.strokeStyle = '#7a5a2e';
  ctx.beginPath();
  ctx.roundRect(x - 14 * scale, bagY, 28 * scale, 24 * scale, 6 * scale);
  ctx.fill();
  ctx.stroke();
}

/** Räddningshelikoptern som väntar vid verkstan tills uppflygningen är klar. */
function drawParked(ctx, x, groundY, livery, c) {
  ctx.save();
  ctx.translate(x, groundY - 32 * 0.8);
  ctx.scale(0.8, 0.8);
  drawHelicopter(ctx, { blur: 0, angle: 0.3, tailAngle: 0.5 }, c, livery);
  ctx.restore();
  ctx.font = '600 15px "Barlow Condensed", system-ui, sans-serif';
  const text = 'Väntar på dig efter uppflygningen';
  const w = ctx.measureText(text).width + 16;
  ctx.fillStyle = c.guideLabelBg;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, groundY - 104, w, 24, 6);
  ctx.fill();
  ctx.fillStyle = c.guideLabelText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, groundY - 92);
}

const mod = (a, n) => ((a % n) + n) % n;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const fmtM = (m) => Math.round(m).toLocaleString('sv-SE');
