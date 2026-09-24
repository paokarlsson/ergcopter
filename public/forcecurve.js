// Kraftkurva: delar upp PM:ens kraftsampel i drag och ritar dem på en canvas.

export const LBF_TO_N = 4.44822;
const DRIVE = 2; // PM stroke state "driving"

/**
 * Samlar kraftsampel till drag. Ett drag börjar när PM:en går in i drivfasen
 * (eller när sampel dyker upp) och avslutas när PM:en lämnat drivfasen och
 * bufferten är tömd.
 */
export class StrokeTracker {
  constructor({ keep = 8 } = {}) {
    this.keep = keep;
    this.live = null; // { samples: number[] (N), start: ms, end: ms|null }
    this.history = []; // avslutade drag, äldst först
    this.prevState = null;
  }

  /**
   * @param {number} state    PM stroke state
   * @param {number[]} samples nya sampel i N (tom om bufferten var tom)
   * @returns {boolean} om något ändrats
   */
  update(state, samples, now = performance.now()) {
    let changed = false;
    const enteringDrive = state === DRIVE && this.prevState !== DRIVE;

    if (enteringDrive && this.live) changed = this.#finish() || changed;
    if (samples.length) {
      this.live ??= { samples: [], start: now, end: null };
      this.live.samples.push(...samples);
      changed = true;
    }
    if (this.live && state !== DRIVE && this.live.end === null) this.live.end = now;
    if (this.live && state !== DRIVE && samples.length === 0) changed = this.#finish() || changed;

    this.prevState = state;
    return changed;
  }

  /** Draget som visas som huvudkurva: pågående, annars senast avslutade. */
  get current() {
    return this.live ?? this.history.at(-1) ?? null;
  }

  /** Tidigare drag att visa som bakgrund, äldst först. */
  get previous() {
    return this.live ? this.history : this.history.slice(0, -1);
  }

  get isLive() {
    return this.live !== null;
  }

  #finish() {
    const stroke = this.live;
    this.live = null;
    if (stroke.samples.length < 4) return false; // brus, inget riktigt drag
    stroke.end ??= performance.now();
    this.history.push(stroke);
    if (this.history.length > this.keep + 1) this.history.shift();
    return true;
  }
}

/** Nyckeltal för ett drag. */
export function strokeStats(stroke) {
  const s = stroke.samples;
  let peak = 0;
  let peakAt = 0;
  let sum = 0;
  s.forEach((v, i) => {
    sum += v;
    if (v > peak) [peak, peakAt] = [v, i];
  });
  return {
    peak,
    mean: s.length ? sum / s.length : 0,
    peakPos: s.length > 1 ? peakAt / (s.length - 1) : 0,
    peakAt,
    length: s.length,
    driveMs: stroke.end !== null ? stroke.end - stroke.start : null,
  };
}

// --- Diagram -----------------------------------------------------------------

const PAD = { top: 16, right: 16, bottom: 32, left: 48 };

export class ForceChart {
  constructor(canvas, tooltip) {
    this.canvas = canvas;
    this.tooltip = tooltip;
    this.ctx = canvas.getContext('2d');
    this.current = null;
    this.previous = [];
    this.live = false;
    this.hoverX = null; // pekarens x i CSS-pixlar
    this.scale = null;

    new ResizeObserver(() => this.draw()).observe(canvas);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.draw());
    canvas.addEventListener('pointermove', (e) => {
      this.hoverX = e.offsetX;
      this.draw();
    });
    canvas.addEventListener('pointerleave', () => {
      this.hoverX = null;
      this.draw();
    });
  }

  setData({ current, previous, live }) {
    this.current = current;
    this.previous = previous;
    this.live = live;
    this.draw();
  }

  draw() {
    const { canvas, ctx } = this;
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const css = getComputedStyle(canvas);
    const color = (name) => css.getPropertyValue(name).trim();
    const c = {
      series: color('--series-1'),
      history: color('--series-history'),
      grid: color('--grid'),
      text: color('--muted'),
      surface: color('--panel'),
    };
    ctx.font = '12px system-ui, sans-serif';

    const strokes = [...this.previous, this.current].filter(Boolean);
    const maxLen = Math.max(20, ...strokes.map((s) => s.samples.length));
    const maxForce = Math.max(100, ...strokes.flatMap((s) => s.samples));
    const yTicks = niceTicks(maxForce);
    const yMax = yTicks.at(-1);

    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top - PAD.bottom;
    const x = (i) => PAD.left + (i / (maxLen - 1)) * plotW;
    const y = (v) => PAD.top + plotH - (v / yMax) * plotH;
    this.scale = { x, maxLen, plotW };

    // Rutnät och axlar
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = c.text;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of yTicks) {
      const yy = Math.round(y(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.left, yy);
      ctx.lineTo(w - PAD.right, yy);
      ctx.stroke();
      ctx.fillText(t.toLocaleString('sv-SE'), PAD.left - 8, yy);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of niceTicks(maxLen - 1, 6)) {
      if (t > maxLen - 1) break;
      ctx.fillText(String(t), x(t), h - PAD.bottom + 8);
    }
    ctx.textAlign = 'left';
    ctx.fillText('sampel', PAD.left, h - 14);
    ctx.textBaseline = 'bottom';
    ctx.fillText('N', 4, PAD.top - 2);

    if (!this.current) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Ta ett drag så visas kraftkurvan här', PAD.left + plotW / 2, PAD.top + plotH / 2);
      this.#hideTooltip();
      return;
    }

    // Tidigare drag: tunna, äldre blekare
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.history;
    this.previous.forEach((s, i) => {
      ctx.globalAlpha = 0.25 + (0.5 * (i + 1)) / this.previous.length;
      tracePath(ctx, s.samples, x, y);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // Aktuellt drag: 10 % yta + 2 px linje
    const cur = this.current.samples;
    tracePath(ctx, cur, x, y);
    ctx.lineTo(x(cur.length - 1), y(0));
    ctx.lineTo(x(0), y(0));
    ctx.closePath();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = c.series;
    ctx.fill();
    ctx.globalAlpha = 1;
    tracePath(ctx, cur, x, y);
    ctx.strokeStyle = c.series;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Toppen: prick med ring + etikett (bara när draget är klart)
    const stats = strokeStats(this.current);
    if (!this.live && stats.peak > 0) {
      const px = x(stats.peakAt);
      const py = y(stats.peak);
      dot(ctx, px, py, c.series, c.surface);
      ctx.fillStyle = color('--text');
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = px > w - 90 ? 'right' : 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${Math.round(stats.peak)} N`, px + (ctx.textAlign === 'left' ? 8 : -8), py - 6);
    }

    this.#drawHover(ctx, c, x, y, plotH);
  }

  #drawHover(ctx, c, x, y, plotH) {
    if (this.hoverX === null) return this.#hideTooltip();
    const { maxLen, plotW } = this.scale;
    const i = Math.round(((this.hoverX - PAD.left) / plotW) * (maxLen - 1));
    if (i < 0 || i >= maxLen) return this.#hideTooltip();

    const xx = Math.round(x(i)) + 0.5;
    ctx.strokeStyle = c.text;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xx, PAD.top);
    ctx.lineTo(xx, PAD.top + plotH);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const cur = this.current.samples[i];
    const prev = this.previous.at(-1)?.samples[i];
    if (cur !== undefined) dot(ctx, x(i), y(cur), c.series, c.surface);

    const rows = [
      [cur, 'Aktuellt drag', 'series'],
      [prev, 'Föregående drag', 'history'],
    ].filter(([v]) => v !== undefined);
    if (!rows.length) return this.#hideTooltip();

    const tip = this.tooltip;
    tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 'tip-head';
    head.textContent = `Sampel ${i}`;
    tip.append(head);
    for (const [v, label, key] of rows) {
      const row = document.createElement('div');
      row.className = 'tip-row';
      const swatch = document.createElement('span');
      swatch.className = `tip-key ${key}`;
      const value = document.createElement('strong');
      value.textContent = `${Math.round(v)} N`;
      const name = document.createElement('span');
      name.textContent = label;
      row.append(swatch, value, name);
      tip.append(row);
    }
    tip.hidden = false;
    const left = xx + 12 + tip.offsetWidth > this.canvas.clientWidth ? xx - 12 - tip.offsetWidth : xx + 12;
    tip.style.left = `${left}px`;
    tip.style.top = `${PAD.top}px`;
  }

  #hideTooltip() {
    this.tooltip.hidden = true;
  }
}

function tracePath(ctx, samples, x, y) {
  ctx.beginPath();
  samples.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
}

function dot(ctx, cx, cy, fill, ring) {
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Jämna axelsteg (1/2/5 × 10^n) från 0 upp till minst max. */
function niceTicks(max, target = 5) {
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let t = 0; t < max + step; t += step) ticks.push(t);
  return ticks;
}
