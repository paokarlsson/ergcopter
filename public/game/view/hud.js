// Instrumenten under flygningen (spec §8): höjden i en ruta på höjdskalan, effekten
// relativt det som krävs för att hålla höjden, variometern, tiden och övningens panel
// (plan.md §3) med stjärnkrav och effekten de senaste 30 sekunderna.
// Höjdskalan ritas i canvasen (render.js); rutan med höjden placeras efter den.

import { fmtM } from './render.js';

const $ = (id) => document.getElementById(id);

const ODO_ROLL_MAX_MS = 15; // över den här farten hinner siffrorna inte rulla klart, så de byts direkt
// Effektstapeln: håll-strecket en tredjedel in, som på en skala 0–300 % av det som krävs.
const EFFECT_HOLD = 1 / 3;
const EFFECT_UP = 2; // högerkanten: +200 %, alltså tre gånger det som krävs
const EFFECT_DOWN = 1; // vänsterkanten: −100 %, ingen effekt
const EFFECT_CURVE = 0.6; // under 1: små skillnader nära håll-strecket syns tydligare
const EFFECT_STRONG = 1; // från +100 % lyser stapeln
// Variometern: noll klockan nio, stigning medurs uppåt. Skalan är tätare nära noll.
const VARIO_MAX = 100; // m/s i ändläget
const VARIO_SWEEP = 150; // grader från noll till ändläget
const VARIO_TICKS = [0, 2, 5, 10, 20, 50, 100];
const VARIO_LABELS = [0, 10, 20, 50];
const GRAPH_S = 30; // effektgrafen i övningarna
const GRAPH_EVERY_S = 0.2;

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'),
      altBox: $('alt-box'),
      alt: $('alt'),
      title: $('hud-title'),
      titleMain: $('hud-title-main'),
      titleSub: $('hud-title-sub'),
      effect: $('effect'),
      effectMeter: $('effect-meter'),
      effectFill: $('effect-fill'),
      effectPct: $('effect-pct'),
      effectHoldLabel: $('effect-hold-label'),
      effectSide: $('effect-side'),
      sideA: $('side-a'),
      sideALabel: $('side-a-label'),
      sideB: $('side-b'),
      sideBLabel: $('side-b-label'),
      timer: $('timer'),
      vario: $('vario-dial'),
      varioNeedle: $('vario-needle'),
      varioText: $('vario'),
      raw: $('raw'),
      drill: $('drill'),
      drillStep: $('drill-step'),
      drillText: $('drill-text'),
      drillLead: $('drill-lead'),
      drillNote: $('drill-note'),
      drillBar: $('drill-bar'),
      drillBarFill: $('drill-bar-fill'),
      drillStars: $('drill-stars'),
      dsH: $('ds-h'),
      dsGoal: $('ds-goal'),
      dsGoalRow: $('ds-goal-row'),
      dsVy: $('ds-vy'),
      dsVyRow: $('ds-vy-row'),
      dsFx: $('ds-fx'),
      dsVyLabel: $('ds-vy-label'),
      graph: $('effect-graph'),
    };
    this.altShape = null; // höjdmätarens teckenmönster, byggs om när antalet siffror ändras
    this.altY = null;
    this.starsKey = null;
    this.history = []; // [t, effekt − 1] för grafen
    this.#buildVario();
  }

  /** Nytt pass: töm effektgrafen. */
  reset() {
    this.history = [];
    this.graphKey = null;
  }

  /**
   * @param {object} v
   * @param {number} v.h, v.vy, v.time
   * @param {number} v.lift      motoreffekten mot det som krävs (andel; på marken mot P0)
   * @param {boolean} v.onGround
   * @param {[string, string][]|null} v.side  två rader till höger om stapeln (etikett, värde), null döljer dem
   * @param {string|null} [v.rawLine]  P0 och rotorn, bara med råa watt påslaget
   */
  update(v) {
    const e = this.el;
    this.#setAltitude(fmtM(v.h));
    e.alt.classList.toggle('fast', Math.abs(v.vy) > ODO_ROLL_MAX_MS);

    const d = v.lift - 1;
    const pct = Math.round(d * 100);
    setText(e.effectPct, `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct)} %`);
    const span = d >= 0 ? (1 - EFFECT_HOLD) * curve(d / EFFECT_UP) : EFFECT_HOLD * curve(-d / EFFECT_DOWN);
    e.effectFill.style.left = `${(d >= 0 ? EFFECT_HOLD : EFFECT_HOLD - span) * 100}%`;
    e.effectFill.style.width = `${span * 100}%`;
    e.effect.classList.toggle('up', d >= 0);
    e.effect.classList.toggle('strong', d >= EFFECT_STRONG);
    e.effectMeter.setAttribute('aria-valuenow', String(pct));
    setText(e.effectHoldLabel, v.onGround ? 'Lyfter' : 'Håller höjden');

    e.effectSide.hidden = !v.side;
    if (v.side) {
      setText(e.sideALabel, v.side[0][0]);
      setText(e.sideA, v.side[0][1]);
      setText(e.sideBLabel, v.side[1][0]);
      setText(e.sideB, v.side[1][1]);
    }

    const vy = Math.abs(v.vy) < 0.05 ? 0 : v.vy;
    const deg = Math.sign(vy) * VARIO_SWEEP * Math.sqrt(Math.min(1, Math.abs(vy) / VARIO_MAX));
    e.varioNeedle.style.transform = `rotate(${deg}deg)`;
    setText(e.varioText, `${vy > 0 ? '↑' : vy < 0 ? '↓' : ''}${dec(Math.abs(vy))}`);
    setText(e.timer, clock(v.time));

    e.raw.hidden = !v.rawLine;
    if (v.rawLine) setText(e.raw, v.rawLine);

    // Effekten över tid till övningens graf
    const last = this.history.at(-1);
    if (!last || v.time < last[0] || v.time - last[0] >= GRAPH_EVERY_S) {
      if (last && v.time < last[0]) this.history = [];
      this.history.push([v.time, d]);
      while (this.history.length && this.history[0][0] < v.time - GRAPH_S) this.history.shift();
    }
  }

  /** Höjdrutans läge på höjdskalan (px från överkanten), från render.js. */
  setAltY(y) {
    const value = `${Math.round(y)}px`;
    if (this.altY !== value) this.el.altBox.style.setProperty('--alt-y', (this.altY = value));
  }

  /** Rubriken uppe till vänster, t.ex. "Övning 3 – Hovring". null döljer den. */
  setTitle(main, sub = '') {
    this.el.title.hidden = !main;
    setText(this.el.titleMain, main ?? '');
    setText(this.el.titleSub, sub);
  }

  /** Variometern döljs i övningarna, där panelen visar stigningen i stället. */
  showVario(show) {
    this.el.vario.hidden = !show;
  }

  /**
   * Övningens panel. null döljer den.
   * @param {object|null} d
   * @param {string} d.step         t.ex. "Moment 2 av 3"
   * @param {string} d.text         instruktionen
   * @param {string|null} d.lead    kort råd under instruktionen
   * @param {string|null} d.note    instruktörens kommentar
   * @param {number|null} d.progress  0–1 för stapeln
   * @param {{stars:number,text:string}[]|null} d.stars  stjärnkraven (exercise.js starGuide)
   * @param {number} d.h, d.vy
   * @param {number} d.lift         motoreffekten mot det som krävs (andel), visas i stället för effektstapeln
   * @param {string|null} d.goal
   * @param {{speed:number,max:number}|null} d.sink  under landningen
   */
  updateDrill(d) {
    const e = this.el;
    e.drill.hidden = !d;
    // Under övningen tar uppgiftspanelen effektstapelns plats överst (game.css .hud-right.drilling)
    e.drill.parentElement.classList.toggle('drilling', !!d);
    if (!d) return;
    setText(e.drillStep, d.step);
    setText(e.drillText, d.text);
    // Instruktörens kommentar tar rådets plats en stund
    e.drillNote.hidden = !d.note;
    if (d.note) setText(e.drillNote, d.note);
    e.drillLead.hidden = !d.lead || !!d.note;
    if (d.lead) setText(e.drillLead, d.lead);
    e.drillBar.hidden = d.progress == null;
    if (d.progress != null) e.drillBarFill.style.width = `${Math.round(d.progress * 100)}%`;
    const key = d.stars ? d.stars.map((s) => s.text).join('|') : '';
    if (key !== this.starsKey) {
      this.starsKey = key;
      e.drillStars.hidden = !d.stars;
      e.drillStars.replaceChildren(
        ...(d.stars ?? []).map(({ stars, text }) => {
          const li = document.createElement('li');
          li.append(starIcons(stars), reqText(text));
          return li;
        })
      );
    }
    setText(e.dsH, `${fmtM(d.h)} m`);
    // Tre rader som mest: Höjd, Mål (eller sjunkfarten under landningen) och Effekt
    e.dsGoalRow.hidden = !d.goal || !!d.sink;
    if (d.goal) setText(e.dsGoal, d.goal);
    e.dsVyRow.hidden = !d.sink;
    const pct = Math.round((d.lift - 1) * 100);
    setText(e.dsFx, `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct)} %`);
    e.dsFx.dataset.ok = String(pct >= 0);
    if (d.sink) {
      setText(e.dsVyLabel, `Sjunker (högst ${dec(d.sink.max)})`);
      setText(e.dsVy, `${dec(Math.max(0, d.sink.speed))} m/s`);
      e.dsVy.dataset.ok = String(d.sink.speed <= d.sink.max);
    } else {
      const vy = Math.abs(d.vy) < 0.05 ? 0 : d.vy;
      setText(e.dsVyLabel, 'Stigning');
      setText(e.dsVy, `${vy > 0 ? '↑ ' : vy < 0 ? '↓ ' : ''}${dec(Math.abs(vy))} m/s`);
      delete e.dsVy.dataset.ok;
    }
    this.#drawGraph();
  }

  /** Synliga paneler i skärmkoordinater, så att scenen kan lägga topparnas etiketter utanför dem. */
  rects() {
    if (this.el.hud.hidden) return [];
    const els = [this.el.altBox, this.el.title, this.el.effect, this.el.drill, this.el.timer, this.el.vario];
    // getClientRects() är tom för dolda element (offsetParent duger inte: fixed ger alltid null)
    return els.filter((el) => el.getClientRects().length > 0).map((el) => el.getBoundingClientRect());
  }

  #drawGraph() {
    // Rita bara om när ett nytt värde har kommit (var GRAPH_EVERY_S), inte varje bildruta
    const last = this.history.at(-1);
    const key = last ? `${this.history.length}:${last[0]}` : '';
    if (key === this.graphKey) return;
    this.graphKey = key;
    const canvas = this.el.graph;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    // Rutnät och håll-linjen
    ctx.strokeStyle = 'rgb(255 255 255 / 0.1)';
    ctx.lineWidth = 1;
    for (const y of [4, h - 4]) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgb(255 255 255 / 0.55)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(w, mid + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    if (this.history.length < 2) return;
    const t1 = this.history.at(-1)[0];
    const x = (t) => w - ((t1 - t) / GRAPH_S) * w;
    const y = (d) => mid - Math.sign(d) * curve(Math.abs(d)) * (mid - 4);
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#49e35f';
    ctx.shadowColor = 'rgb(73 227 95 / 0.6)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    this.history.forEach(([t, d], i) => (i ? ctx.lineTo(x(t), y(d)) : ctx.moveTo(x(t), y(d))));
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /**
   * Höjdmätaren: varje siffra är en remsa 0–9 som rullar till rätt läge, som
   * en mekanisk räknare. Remsorna byggs om bara när antalet tecken ändras.
   */
  #setAltitude(text) {
    const el = this.el.alt;
    const shape = text.replace(/\d/g, '0');
    if (shape !== this.altShape) {
      this.altShape = shape;
      const parts = [...text].map((ch) => {
        if (!/\d/.test(ch)) return Object.assign(document.createElement('span'), { className: 'odo-sep', textContent: ch });
        const digit = document.createElement('span');
        digit.className = 'odo-digit';
        const strip = document.createElement('span');
        strip.className = 'odo-strip';
        for (let n = 0; n <= 9; n++) strip.append(Object.assign(document.createElement('span'), { textContent: String(n) }));
        digit.append(strip);
        return digit;
      });
      const unit = Object.assign(document.createElement('span'), { className: 'odo-unit', textContent: ' m' });
      el.replaceChildren(...parts, unit);
    }
    el.setAttribute('aria-label', `${text} meter`);
    const digits = [...text].filter((ch) => /\d/.test(ch));
    el.querySelectorAll('.odo-strip').forEach((strip, i) => {
      const y = `translateY(${-Number(digits[i])}em)`;
      if (strip.style.transform !== y) strip.style.transform = y;
    });
  }

  /** Skalstreck och siffror på variometern, åt båda hållen från noll. */
  #buildVario() {
    const ns = 'http://www.w3.org/2000/svg';
    const g = $('vario-ticks');
    const at = (deg, r) => {
      const a = (deg * Math.PI) / 180;
      return [100 - Math.cos(a) * r, 100 - Math.sin(a) * r];
    };
    const angle = (v) => VARIO_SWEEP * Math.sqrt(v / VARIO_MAX);
    // Svaga bågar: grön för stigning, röd för sjunk
    for (const [sign, color] of [[1, 'rgb(73 227 95 / 0.35)'], [-1, 'rgb(255 93 85 / 0.35)']]) {
      const [x0, y0] = at(0, 84);
      const [x1, y1] = at(sign * VARIO_SWEEP, 84);
      const arc = document.createElementNS(ns, 'path');
      arc.setAttribute('d', `M ${x0} ${y0} A 84 84 0 0 ${sign > 0 ? 1 : 0} ${x1} ${y1}`);
      arc.setAttribute('fill', 'none');
      arc.setAttribute('stroke', color);
      arc.setAttribute('stroke-width', '6');
      g.append(arc);
    }
    for (const v of VARIO_TICKS) {
      for (const sign of v ? [1, -1] : [1]) {
        const deg = sign * angle(v);
        const major = VARIO_LABELS.includes(v);
        const [x1, y1] = at(deg, 90);
        const [x2, y2] = at(deg, major ? 72 : 78);
        const line = document.createElementNS(ns, 'line');
        Object.entries({ x1, y1, x2, y2 }).forEach(([k, val]) => line.setAttribute(k, val.toFixed(1)));
        line.setAttribute('class', `vario-tick${major ? ' major' : ''}`);
        g.append(line);
        if (!major) continue;
        const [tx, ty] = at(deg, 58);
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', tx.toFixed(1));
        text.setAttribute('y', ty.toFixed(1));
        text.setAttribute('class', 'vario-num');
        text.textContent = String(v);
        g.append(text);
      }
    }
  }
}

/** Effektstapelns kurva: 0–1 in, 0–1 ut, tätare nära noll. */
const curve = (x) => Math.min(1, Math.max(0, x)) ** EFFECT_CURVE;

const dec = (x) => x.toFixed(1).replace('.', ',');

/** "02:14" för sekunder. */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Kravets text med talen i fetstil, t.ex. "i snitt inom <b>7,5 m</b> från målet". */
function reqText(text) {
  const span = Object.assign(document.createElement('span'), { className: 'req' });
  text.split(/([±−-]?\d[\d\s,]*(?:\s?(?:m\/s|m|s|%|ringar))?)/).forEach((part, i) => {
    if (part) span.append(i % 2 ? Object.assign(document.createElement('b'), { textContent: part }) : part);
  });
  return span;
}

/** Kravens stjärnor som SVG: glansiga guldstjärnor och mörka fördjupningar för resten. */
function starIcons(stars) {
  const span = Object.assign(document.createElement('span'), { className: 'stars' });
  span.setAttribute('role', 'img');
  span.setAttribute('aria-label', `${stars} av 3 stjärnor`);
  span.innerHTML = [0, 1, 2]
    .map((i) =>
      i < stars
        ? '<svg class="star on" viewBox="0 0 24 24"><use class="body" href="#drill-star"/><use class="gloss" href="#drill-star"/></svg>'
        : '<svg class="star off" viewBox="0 0 24 24"><use class="body" href="#drill-star"/></svg>'
    )
    .join('');
  return span;
}

/** Stjärnor som spann: fyllda i guld, resten svaga. */
export function starSpan(stars, className = '') {
  const span = Object.assign(document.createElement('span'), { className });
  span.setAttribute('aria-label', `${stars} av 3 stjärnor`);
  span.append('★'.repeat(stars), Object.assign(document.createElement('span'), { className: 'off', textContent: '★'.repeat(3 - stars) }));
  return span;
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}
