// Flygloggarna med uppspelning (spec §9.1): listan över de senaste flygningarna och en
// uppspelning av den valda – höjden över tiden som en färgad linje över fjällen man
// passerade, med helikoptern där den var. Effekten finns bara i procent i loggen.
// Med 3D-landskapet (terrain.js) är bakgrunden en bild av det, där topparna står i 3D
// precis där linjen nådde dem; annars ritas himmel och fjäll här.

import { parseLog, logTimeline, traceAt } from '../core/flightlog.js';
import { drawHelicopter } from './heli-draw.js';
import { drawMountain, drawLabel, labelLayout } from './mountains.js';
import { mix, alpha } from './color.js';
import { fmtM } from './render.js';
import { clock } from './hud.js';

const $ = (id) => document.getElementById(id);

const SPEEDS = [1, 2, 4, 8, 16];
const PAD = { left: 74, right: 36, top: 100, bottom: 34 };
const ICON_PLAY = 'M7 4 L20 12 L7 20 Z';
const ICON_PAUSE = 'M6 4 H10 V20 H6 Z M14 4 H18 V20 H14 Z';
const CLIMB_MS = 2; // över det är linjen grön, under minus det röd, däremellan gul
const ROTOR = { blur: 1, angle: 0, tailAngle: 0 };
const MAX_PHOTO_PEAKS = 12; // som terrain.js MAX_PEAKS

export class FlightLogView {
  /** @param {() => object} colors  scenens färger (render.js) */
  constructor(colors) {
    this.colors = colors;
    this.el = {
      screen: $('screen-logs'),
      list: $('log-list'),
      canvas: $('log-canvas'),
      card: $('player-card'),
      head: $('player-head'),
      date: $('player-date'),
      empty: $('player-empty'),
      play: $('log-play'),
      playIcon: $('log-play-icon'),
      time: $('log-time'),
      seek: $('log-seek'),
      speed: $('log-speed'),
      text: $('log-text'),
      textHint: $('log-text-hint'),
    };
    this.line = null; // logTimeline för vald logg
    /** Bild av 3D-landskapet: (view) → canvas eller null. Sätts av main.js. */
    this.photo = null;
    this.photoKey = null;
    this.photoImage = null;
    this.currentId = null;
    this.t = 0;
    this.playing = false;
    this.speed = 4;
    this.last = null;
    this.el.play.addEventListener('click', () => this.toggle());
    this.el.seek.addEventListener('input', () => this.seek(Number(this.el.seek.value)));
    this.el.speed.addEventListener('click', () => this.cycleSpeed());
    new ResizeObserver(() => this.#draw()).observe(this.el.canvas);
  }

  get isOpen() {
    return !this.el.screen.hidden;
  }

  /**
   * @param {{ id, ts, title, text }[]} logs  nyast först
   * @param {{ copy: (entry, button) => void, download: (entry) => void }} actions
   */
  open(logs, actions) {
    this.el.screen.hidden = false;
    this.render(logs, actions);
    const current = logs.find((x) => x.id === this.currentId) ?? logs[0];
    if (current) this.select(current);
    else this.#clear();
  }

  close() {
    this.el.screen.hidden = true;
    this.playing = false;
  }

  /** Listan, med Spela upp, Kopiera och Ladda ned per logg. */
  render(logs, actions) {
    this.logs = logs;
    this.actions = actions;
    this.el.text.hidden = true;
    this.el.textHint.hidden = true;
    if (!logs.length) {
      this.el.list.replaceChildren(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'Inga flygningar inspelade än.' }));
      return;
    }
    const button = (label, onClick) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: label });
      b.addEventListener('click', () => onClick(b));
      return b;
    };
    this.el.list.replaceChildren(
      ...logs.map((entry) => {
        const li = Object.assign(document.createElement('li'), { className: 'log-item' });
        li.setAttribute('aria-current', String(entry.id === this.currentId));
        const date = new Date(entry.ts).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
        const actionsRow = Object.assign(document.createElement('div'), { className: 'log-actions' });
        actionsRow.append(
          button('Spela upp', () => this.select(entry, true)),
          button('Kopiera', (b) => actions.copy(entry, b)),
          button('Ladda ned', () => actions.download(entry))
        );
        li.append(
          Object.assign(document.createElement('span'), { className: 'log-title', textContent: entry.title }),
          Object.assign(document.createElement('span'), { className: 'log-meta', textContent: `${date} · ${Math.ceil(entry.text.length / 1000)} kB` }),
          actionsRow
        );
        return li;
      })
    );
  }

  /** Visar loggen markerad när urklippet inte går att använda, så att man kan kopiera själv. */
  showText(text) {
    this.el.text.value = text;
    this.el.text.hidden = false;
    this.el.textHint.hidden = false;
    this.el.text.focus();
    this.el.text.select();
  }

  /** Laddar en logg i uppspelningen. play = börja spela direkt. */
  select(entry, play = false) {
    let log;
    try {
      log = parseLog(entry.text);
    } catch {
      this.#clear();
      return;
    }
    this.currentId = entry.id;
    this.line = logTimeline(log);
    this.t = play ? 0 : this.line.duration;
    this.playing = play;
    const name = log.player.name || 'Okänd';
    const program = /\((.+)\)$/.exec(log.header.flygning ?? '')?.[1];
    this.el.head.textContent = [name, log.program ? program : `${fmtM(this.line.hMax)} m`, clock(this.line.duration)].join(' – ');
    this.el.date.textContent = (log.header.datum ?? new Date(entry.ts).toLocaleString('sv-SE')).slice(0, 16);
    this.el.card.hidden = false;
    this.el.empty.hidden = true;
    this.el.seek.max = String(this.line.duration);
    for (const el of [this.el.play, this.el.seek, this.el.speed]) el.disabled = false;
    if (this.logs) this.render(this.logs, this.actions);
    this.#sync();
    this.#loop();
  }

  toggle() {
    if (!this.line) return;
    if (!this.playing && this.t >= this.line.duration) this.t = 0; // spela från början igen
    this.playing = !this.playing;
    this.#sync();
    this.#loop();
  }

  seek(t) {
    if (!this.line) return;
    this.t = Math.min(this.line.duration, Math.max(0, t));
    this.#sync();
    this.#draw();
  }

  cycleSpeed() {
    this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length];
    this.#sync();
  }

  #clear() {
    this.line = null;
    this.currentId = null;
    this.playing = false;
    this.el.card.hidden = true;
    this.el.empty.hidden = false;
    for (const el of [this.el.play, this.el.seek, this.el.speed]) el.disabled = true;
    this.#sync();
    this.#draw();
  }

  #sync() {
    const d = this.line?.duration ?? 0;
    this.el.time.textContent = `${clock(this.t)} / ${clock(d)}`;
    this.el.seek.value = String(this.t);
    this.el.speed.textContent = `${this.speed}×`;
    this.el.playIcon.setAttribute('d', this.playing ? ICON_PAUSE : ICON_PLAY);
    this.el.play.setAttribute('aria-label', this.playing ? 'Pausa' : 'Spela upp');
  }

  #loop() {
    if (this.raf) return;
    this.last = null;
    const frame = (now) => {
      this.raf = null;
      if (!this.isOpen) return;
      const dt = this.last === null ? 0 : Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (this.playing && this.line) {
        this.t = Math.min(this.line.duration, this.t + dt * this.speed);
        if (this.t >= this.line.duration) this.playing = false;
        this.#sync();
      }
      ROTOR.angle = (ROTOR.angle + dt * 20) % (Math.PI * 2);
      ROTOR.tailAngle = (ROTOR.tailAngle + dt * 50) % (Math.PI * 2);
      this.#draw();
      if (this.playing) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** Bakgrundsbilden från 3D-landskapet för vald logg och storlek, tas en gång. */
  #photo(W, H, yMax, x, peaks) {
    if (!this.photo) return null;
    const key = `${this.currentId}|${W}x${H}|${yMax}`;
    if (key !== this.photoKey) {
      const k = (H - PAD.top - PAD.bottom) / yMax;
      const seed = [...String(this.currentId)].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
      const view = logPhotoView(W, H, k, H - PAD.bottom, peaks.map((p) => ({ x: x(p.t), h: p.h })), seed);
      const image = this.photo(view);
      if (!image) return null; // inte klart än: försök igen nästa gång
      this.photoKey = key;
      this.photoImage = image;
    }
    return this.photoImage;
  }

  #draw() {
    const canvas = this.el.canvas;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (!W || !H) return;
    const dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = this.colors();
    const line = this.line;
    if (!line) {
      backdrop(ctx, W, H, c);
      return;
    }

    // Plats ovanför den högsta toppen för etiketten
    const yMax = niceMax(Math.max(line.hMax, ...line.peaks.map((p) => p.h)) * 1.3 + 20);
    const x = (t) => PAD.left + (t / Math.max(1, line.duration)) * (W - PAD.left - PAD.right);
    const y = (h) => H - PAD.bottom - (h / yMax) * (H - PAD.top - PAD.bottom);

    // Topparna man passerade, med toppen där linjen nådde höjden. Högst först.
    const peaks = [...line.peaks].sort((a, b) => b.h - a.h);
    const photo = this.#photo(W, H, yMax, x, peaks);
    if (photo) {
      ctx.drawImage(photo, 0, 0, W, H);
      // Mörkare upptill och nedtill, så att linjen och etiketterna syns
      const shade = ctx.createLinearGradient(0, 0, 0, H);
      shade.addColorStop(0, alpha('#081224', 0.45));
      shade.addColorStop(0.45, alpha('#081224', 0.12));
      shade.addColorStop(1, alpha('#081224', 0.4));
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, W, H);
    } else {
      backdrop(ctx, W, H, c);
      const rock = { ...c, rock: mix(c.mountainRock, '#3c4c66', 0.2), snow: c.mountainSnow, valleyHaze: '#4d6b8a' };
      for (const p of peaks) drawMountain(ctx, p, x(p.t), y(p.h), H + 40, rock);
    }
    ctx.fillStyle = alpha('#0b1a2e', 0.25);
    ctx.fillRect(0, y(0), W, H - y(0));

    axis(ctx, W, H, yMax, y);

    // Linjen: svag hela vägen, stark fram till nu. Grön när den stiger, röd när den sjunker.
    const pts = line.trace;
    for (const [upTo, a] of [[Infinity, 0.3], [this.t, 1]]) {
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgb(0 0 0 / 0.4)';
      ctx.shadowBlur = a === 1 ? 6 : 0;
      for (let i = 1; i < pts.length && pts[i - 1].t <= upTo; i++) {
        const p = pts[i - 1];
        const q = pts[i].t <= upTo ? pts[i] : { ...pts[i], t: upTo, h: traceAt(pts, upTo).h };
        const v = (p.v + q.v) / 2;
        ctx.strokeStyle = alpha(v > CLIMB_MS ? '#49e35f' : v < -CLIMB_MS ? '#ff5d55' : '#f6c744', a);
        ctx.beginPath();
        ctx.moveTo(x(p.t), y(p.h));
        ctx.lineTo(x(q.t), y(q.h));
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;

    // Sättningar som vita prickar vid marken
    ctx.fillStyle = '#ffffff';
    for (const td of line.touchdowns) {
      ctx.beginPath();
      ctx.arc(x(td.t), y(0), 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Etiketter på topparna, de högsta först; de som krockar hoppas över
    const s = Math.max(0.7, Math.min(1.2, W / 1100));
    // Rutan med namn och datum uppe till höger räknas som upptagen
    const card = this.el.card.hidden ? null : this.el.card;
    const taken = card ? [{ x: card.offsetLeft - 8, y: card.offsetTop - 8, w: card.offsetWidth + 16, h: card.offsetHeight + 16 }] : [];
    for (const p of peaks) {
      const L = labelLayout(ctx, p, x(p.t), y(p.h), this.t >= p.t, s, fmtM);
      if (taken.some((r) => r.x < L.x + L.w && L.x < r.x + r.w && r.y < L.y + L.h && L.y < r.y + r.h)) continue;
      if (L.x < PAD.left || L.x + L.w > W - 4 || L.y < PAD.top - 20) continue;
      taken.push(L);
      drawLabel(ctx, p, x(p.t), y(p.h), this.t >= p.t, s, c, L);
    }

    // Helikoptern där den var vid tiden t
    const now = traceAt(pts, this.t);
    ctx.save();
    ctx.translate(x(this.t), y(now.h) - 14);
    ctx.rotate(-Math.max(-0.25, Math.min(0.25, now.v * 0.01)));
    ctx.scale(0.34, 0.34);
    drawHelicopter(ctx, ROTOR, c, null);
    ctx.restore();
  }
}

/**
 * Kameran i 3D-landskapet för uppspelningen: alla toppar på samma avstånd, så att
 * höjden i bilden blir linjär precis som diagrammets höjdaxel, och varje topp i sidled
 * där linjen nådde den. Marken (0 m) på toppens avstånd hamnar på diagrammets nollinje.
 * @param {number} k  px per meter i diagrammet
 * @param {number} y0  diagrammets nollinje (px)
 */
export function logPhotoView(W, H, k, y0, peaks, seed) {
  const focal = Math.max(W, H) * 0.75;
  const z = focal / k;
  const cx = W / 2;
  // Kameran lågt, så att topparna står mot himlen
  const camY = Math.min(600, (0.3 * (y0 - H * 0.2)) / k);
  const cy = y0 - camY * k;
  const camX = 4000 + (seed % 9973) * 3;
  return {
    width: W,
    height: H,
    scale: 1,
    cx,
    cy,
    focal,
    camX,
    camY,
    dusk: 0,
    thin: 0,
    time: 20,
    clouds: 0,
    pad: null,
    peaks: peaks.slice(0, MAX_PHOTO_PEAKS).map((p) => ({ x: camX + ((p.x - cx) * z) / focal, z, h: p.h, r: 0.85 * p.h + 300 })),
  };
}

/** Himmel och två avlägsna fjällkedjor bakom diagrammet. */
function backdrop(ctx, W, H, c) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#173a6b');
  sky.addColorStop(0.65, '#4f7fb3');
  sky.addColorStop(1, '#a9c6e2');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  for (const [base, amp, color, seed] of [[H * 0.62, H * 0.22, '#6f84a6', 2], [H * 0.82, H * 0.16, '#3d5a74', 5]]) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W + 30; x += 30) {
      const u = x / 140 + seed;
      ctx.lineTo(x, base - amp * (0.5 + 0.3 * Math.sin(u * 1.3) + 0.2 * Math.abs(Math.sin(u * 3.1))));
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
}

/** Höjdaxeln till vänster med streck och siffror. */
function axis(ctx, W, H, yMax, y) {
  const step = [50, 100, 250, 500, 1000, 2000, 2500].find((s) => yMax / s <= 5);
  ctx.strokeStyle = 'rgb(255 255 255 / 0.7)';
  ctx.fillStyle = 'rgb(255 255 255 / 0.85)';
  ctx.lineWidth = 2;
  ctx.font = '600 15px "Barlow Condensed", system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.beginPath();
  ctx.moveTo(PAD.left - 22, y(yMax));
  ctx.lineTo(PAD.left - 22, y(0));
  ctx.stroke();
  for (let h = 0; h <= yMax + 1e-9; h += step) {
    ctx.beginPath();
    ctx.moveTo(PAD.left - 28, y(h));
    ctx.lineTo(PAD.left - 16, y(h));
    ctx.stroke();
    ctx.fillText(fmtM(h), PAD.left - 32, y(h));
  }
}

/** Ett jämnt tak för axeln: 1, 2 eller 5 gånger en tiopotens. */
function niceMax(x) {
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((v) => v >= x);
}
