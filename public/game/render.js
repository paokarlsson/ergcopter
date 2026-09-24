// Storskärmens scen på Canvas 2D: himmel som mörknar med höjden, fjälltoppar
// som kommer in från höger och passerar under helikoptern, moln i världen,
// marken när man är låg, höjdlinjer och en sidoskala över hela höjden.
// Siffror och mätare ligger i DOM (ui.js).

import { drawHelicopter, drawCloud, drawTree } from './heli-draw.js';
import { drawMountain, drawSign, signLayout, rand } from './mountains.js';

const VIEW_SPAN_M = 300; // höjd som syns i huvudvyn
const GROUND_MARGIN_PX = 56; // marken så här högt upp när man står på den
const CLOUD_LAYER_M = 170;
const SKY_TOP_M = 9000; // här är himlen som mörkast
const GAUGE_STEPS_M = [2000, 3000, 5000, 7000, 9500];
const GAUGE_COLUMN_PX = 230; // sidoskalan med namn tar så här mycket av högerkanten
const HELI_X = 0.4; // helikopterns plats i sidled, andel av bredden
const FLY_SPEED_PX = 20; // px/s per rad/s rotorvarv
const MIN_FLY_SPEED_PX = 260; // i luften rullar landskapet minst så här fort
const MOUNTAIN_ENTRY_PX = 200; // bergen startar så här långt utanför högerkanten
const MOUNTAIN_GAP_PX = 260; // minsta avstånd mellan två berg som kommer tätt
const MOUNTAIN_SKIP_BELOW_M = 60; // topp som redan ligger så här långt under oss skickas inte

export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.distance = 0; // px landskapet rullat
    this.mountains = []; // { m, startAt } – startAt: distance när berget passerar högerkanten
    this.sent = new Set(); // milstolpar som redan skickats in under passet
    this.speed = 0; // px/s just nu
    this.colors = null;
    const refresh = () => (this.colors = readColors(canvas));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refresh);
    refresh();
  }

  /** Rullar landskapet framåt efter rotorvarv, bara i luften. */
  advance(dt, rotor, h) {
    const airborne = Math.min(1, h / 3);
    this.speed = Math.max(MIN_FLY_SPEED_PX, rotor.omega * FLY_SPEED_PX) * airborne;
    this.distance += this.speed * dt;
  }

  clearMountains() {
    this.mountains = [];
    this.sent.clear();
  }

  /**
   * Skickar in berg från höger så att de når helikoptern ungefär när den når
   * toppens höjd (förutsagt från stighastigheten). Då flyger man över toppen
   * precis när milstolpen passeras. Berg som kommer tätt köar med mellanrum.
   */
  #sendMountains(v, W) {
    if (!v.flying || this.speed <= 0) return;
    const hx = W * HELI_X;
    const climb = Math.max(0, v.vy);

    // Berg som ännu inte syns dras tillbaka om vi inte längre hinner upp till toppen
    // (t.ex. slutat stiga) – de skickas in igen när vi närmar oss höjden.
    this.mountains = this.mountains.filter((item) => {
      const sx = W + MOUNTAIN_ENTRY_PX - (this.distance - item.startAt);
      const reachable = v.h + climb * ((sx - hx) / this.speed) >= item.m.h - 5;
      if (sx <= W || reachable) return true;
      this.sent.delete(item.m.name);
      return false;
    });

    const travelS = (W + MOUNTAIN_ENTRY_PX - hx) / this.speed;
    const predicted = v.h + climb * travelS;
    for (const m of v.milestones) {
      if (this.sent.has(m.name) || m.h > predicted) continue;
      this.sent.add(m.name);
      if (m.h < v.h - MOUNTAIN_SKIP_BELOW_M) continue; // redan långt under – skulle passera utanför bild
      const last = this.mountains.at(-1);
      const startAt = Math.max(this.distance, last ? last.startAt + MOUNTAIN_GAP_PX : -Infinity);
      this.mountains.push({ m, startAt });
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
   * @param {DOMRect[]} [v.avoid]      instrument i DOM som skyltar inte får hamna under
   * @param {boolean} [v.flying]        skicka in nya berg (bara under passet)
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

    const pxPerM = (H * 0.8) / VIEW_SPAN_M;
    const heliY0 = H * 0.5;
    const camGround = (H - heliY0 - GROUND_MARGIN_PX) / pxPerM;
    const cam = Math.max(v.h, camGround); // höjden som hamnar på heliY0
    const y = (alt) => heliY0 - (alt - cam) * pxPerM;
    const scale = Math.max(0.6, Math.min(1.6, W / 1100));

    this.#sendMountains(v, W);
    this.#sky(ctx, W, H, cam);
    this.#mountains(ctx, W, H, v, y, scale, cam);
    this.#clouds(ctx, W, H, cam, pxPerM, y);
    if (y(0) < H + 80) this.#ground(ctx, W, H, y(0));
    this.#altitudeTicks(ctx, W, H, cam, y, c);
    this.#lines(ctx, W, H, v, y, c);

    // Helikoptern: medarna mot marken vid h = 0
    const hx = W * HELI_X;
    const hy = y(v.h) - 32 * scale;
    const airborne = Math.min(1, v.h / 3);
    ctx.fillStyle = c.shadow;
    if (y(0) < H) {
      const sw = 60 * scale * Math.max(0.2, 1 - v.h / 120);
      ctx.beginPath();
      ctx.ellipse(hx, y(0) + 2, sw, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(hx, hy);
    // Nosen ned i framåtflykt (positiv vinkel = medurs), lite upp när den stiger fort.
    ctx.rotate(0.08 * v.rotor.blur * airborne - Math.max(-0.05, Math.min(0.05, v.vy * 0.002)));
    ctx.scale(scale, scale);
    drawHelicopter(ctx, v.rotor, c);
    ctx.restore();

    this.#gauge(ctx, W, H, v, c);
  }

  #sky(ctx, W, H, cam) {
    const t = Math.min(1, Math.max(0, cam / SKY_TOP_M));
    const c = this.colors;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mix(c.skyTopLow, c.skyTopHigh, t));
    g.addColorStop(1, mix(c.skyBottomLow, c.skyBottomHigh, t));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Stjärnor när luften blir tunn
    const stars = Math.max(0, (t - 0.45) / 0.55);
    if (stars > 0) {
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 80; i++) {
        ctx.globalAlpha = stars * (0.3 + 0.7 * rand(i * 7.1));
        const sx = mod(rand(i) * W * 1.5 - this.distance * 0.02, W);
        ctx.fillRect(sx, rand(i + 99) * H, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Passerade toppar på väg från höger till vänster. Högre toppar ritas först,
   * så att en lägre topps sluttning aldrig täcker en högre topp med skylt.
   * Skylten blir grön när helikoptern flugit över toppen.
   */
  #mountains(ctx, W, H, v, y, scale, cam) {
    const c = this.colors;
    const usable = W - GAUGE_COLUMN_PX; // inga skyltar under sidoskalan
    const hazeTarget = mix(c.skyTopLow, c.skyTopHigh, Math.min(1, cam / SKY_TOP_M));
    const sxOf = (item) => W + MOUNTAIN_ENTRY_PX - (this.distance - item.startAt);
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
      .filter(({ sx, sy }) => sy < H + 20 && sx < W + MOUNTAIN_ENTRY_PX * 2)
      .sort((a, b) => b.m.h - a.m.h);
    for (const { m, sx, sy, haze } of visible) {
      const colors = { ...c, rock: mix(c.mountainRock, hazeTarget, haze), snow: mix(c.mountainSnow, hazeTarget, haze * 0.5) };
      drawMountain(ctx, m, sx, sy, H + 60, colors);
    }
    // Skyltarna sist; de som skulle hamna under instrumenten eller en annan skylt hoppas över.
    const taken = [...(v.avoid ?? [])];
    // Skyltarna skalar med skärmbredden: ~1,6 på 1 600 px, större på en storskärm.
    const s = Math.max(0.9, Math.min(2.4, W / 1000));
    for (const { m, sx, sy } of visible) {
      if (sx < 70 || sx > usable - 60) continue;
      const passed = sx <= W * HELI_X;
      const L = signLayout(ctx, m, sx, sy, passed, s, fmtM);
      if (taken.some((r) => overlaps(L, r))) continue;
      taken.push({ x: L.x - 6, y: L.y - 6, w: L.w + 12, h: L.h + 12 });
      drawSign(ctx, m, sx, sy, passed, s, c, L);
    }
  }

  #clouds(ctx, W, H, cam, pxPerM, y) {
    const c = this.colors;
    const lo = Math.floor((cam - VIEW_SPAN_M) / CLOUD_LAYER_M);
    const hi = Math.ceil((cam + VIEW_SPAN_M) / CLOUD_LAYER_M);
    for (let j = Math.max(1, lo); j <= hi; j++) {
      const alt = j * CLOUD_LAYER_M;
      const thin = Math.max(0, 1 - alt / 7000); // färre moln högt upp
      if (rand(j * 3.3) > 0.35 + 0.6 * thin) continue;
      const span = W + 300;
      const x = mod(rand(j) * span - this.distance * (0.25 + 0.3 * rand(j + 5)), span) - 150;
      ctx.globalAlpha = 0.55 + 0.4 * thin;
      ctx.fillStyle = c.cloud;
      drawCloud(ctx, x, y(alt), 1 + rand(j + 11) * 1.4);
    }
    ctx.globalAlpha = 1;
  }

  #ground(ctx, W, H, groundY) {
    const c = this.colors;
    ctx.fillStyle = c.hill;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    for (let x = 0; x <= W; x += 8) {
      const u = x + this.distance * 0.35;
      ctx.lineTo(x, groundY - 50 - 28 * Math.sin(u / 210) - 16 * Math.sin(u / 83 + 1));
    }
    ctx.lineTo(W, groundY);
    ctx.fill();
    ctx.fillStyle = c.ground;
    ctx.fillRect(0, groundY, W, H - groundY + 1);
    for (let i = -1; i < W / 110 + 1; i++) drawTree(ctx, i * 110 - mod(this.distance, 110) + 55, groundY, c);
    const padX = W * 0.4 - this.distance;
    if (padX > -120) {
      ctx.fillStyle = c.pad;
      ctx.fillRect(padX - 80, groundY - 3, 160, 5);
    }
  }

  #altitudeTicks(ctx, W, H, cam, y, c) {
    const step = 50;
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let alt = Math.max(0, Math.floor((cam - VIEW_SPAN_M) / step) * step); alt <= cam + VIEW_SPAN_M; alt += step) {
      const yy = Math.round(y(alt)) + 0.5;
      if (yy < 0 || yy > H) continue;
      ctx.strokeStyle = c.tick;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(alt % 250 === 0 ? 28 : 14, yy);
      ctx.stroke();
      if (alt % 100 === 0) {
        ctx.fillStyle = c.tickText;
        ctx.fillText(`${fmtM(alt)} m`, 34, yy);
      }
    }
  }

  /**
   * Horisontella linjer för dagens rekord och maxhöjden i passet (milstolparna
   * syns som fjälltoppar i stället). Etiketter som skulle krocka hoppas över.
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
      ctx.lineWidth = line.prio ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(0, line.yy);
      ctx.lineTo(W - GAUGE_COLUMN_PX, line.yy);
      ctx.stroke();
    }
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = c.lineText;
    for (const line of placeLabels(lines, 18)) ctx.fillText(line.label, W - GAUGE_COLUMN_PX - 8, line.yy - 4);
  }

  /** Sidoskalan: hela vägen från marken till nästa milstolpe. */
  #gauge(ctx, W, H, v, c) {
    const x = W - 64;
    const top = 60;
    const bottom = H - 60;
    // Fasta steg så att skalan inte zoomar om vid varje passerad topp.
    const reach = Math.max(v.h, v.hMax ?? 0, v.todayBest ?? 0) * 1.15;
    const range = GAUGE_STEPS_M.find((r) => r >= reach) ?? Math.ceil(reach / 1000) * 1000;
    const gy = (alt) => bottom - (Math.min(alt, range) / range) * (bottom - top);

    ctx.fillStyle = c.gaugeTrack;
    roundRect(ctx, x - 5, top, 10, bottom - top, 5);
    ctx.fill();
    ctx.fillStyle = c.sessionMax;
    roundRect(ctx, x - 5, gy(v.h), 10, bottom - gy(v.h), 5);
    ctx.fill();

    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const inRange = v.milestones.filter((m) => m.h <= range).map((m) => ({ ...m, yy: gy(m.h), prio: 0 }));
    ctx.fillStyle = c.milestone;
    for (const m of inRange) ctx.fillRect(x - 12, Math.round(m.yy), 24, 2);
    ctx.fillStyle = c.lineText;
    for (const m of placeLabels(inRange, 14)) ctx.fillText(m.name, x - 16, m.yy);
    const marks = [
      [v.todayBest, c.record],
      [v.hMax, c.sessionMax],
    ];
    for (const [alt, color] of marks) {
      if (!alt) continue;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x + 8, gy(alt));
      ctx.lineTo(x + 18, gy(alt) - 6);
      ctx.lineTo(x + 18, gy(alt) + 6);
      ctx.fill();
    }
    // Helikopterns läge
    ctx.fillStyle = c.surface;
    ctx.beginPath();
    ctx.arc(x, gy(v.h), 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.body;
    ctx.beginPath();
    ctx.arc(x, gy(v.h), 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Väljer etiketter som får plats med minst `gap` px mellan sig. Högre prio
 * placeras först; bland lika prio vinner den högsta (lägsta y) – toppen man
 * är på väg mot.
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
    cloud: v('--cloud'),
    hill: v('--hill'),
    ground: v('--ground'),
    tree: v('--tree'),
    trunk: v('--trunk'),
    pad: v('--pad'),
    shadow: v('--heli-shadow'),
    body: v('--heli-body'),
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
    signBoard: v('--sign-board'),
    signBoardPassed: v('--sign-board-passed'),
    signEdge: v('--sign-edge'),
    signText: v('--sign-text'),
    signPost: v('--sign-post'),
    signCheck: v('--sign-check'),
  };
}

/** Rektanglar {x, y, w, h} (DOMRect har också width/height) – överlappar de? */
function overlaps(a, b) {
  const bw = b.w ?? b.width;
  const bh = b.h ?? b.height;
  return a.x < b.x + bw && b.x < a.x + a.w && a.y < b.y + bh && b.y < a.y + a.h;
}

/** Blandar två färger (#rrggbb eller rgb(r g b)). */
function mix(a, b, t) {
  const pa = parseColor(a);
  const pb = parseColor(b);
  return `rgb(${pa.map((x, i) => Math.round(x + (pb[i] - x) * t)).join(' ')})`;
}
function parseColor(color) {
  if (color.startsWith('#')) {
    const s = color.slice(1);
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  }
  return color.match(/[\d.]+/g).slice(0, 3).map(Number);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, Math.max(0, h), Math.min(r, Math.max(0, h) / 2));
}


const mod = (a, n) => ((a % n) + n) % n;
export const fmtM = (m) => Math.round(m).toLocaleString('sv-SE');
