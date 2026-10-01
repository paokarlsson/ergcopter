// Bakgrunden som visar höjden utan siffror: himlen med solen, fjällkedjor i tre lager
// som sjunker undan när man stiger (kalfjäll med snö längst bort, fjäll i mitten,
// skogsklädda åsar närmast), ett molntäcke att flyga igenom med ett molnhav ovanför,
// och norrsken högt upp. På start- och resultatskärmen lyser kvällssolen (dusk).
// Allt är dekor; milstolparnas berg ritas av mountains.js.

import { mix, alpha } from './color.js';
import { rand } from './mountains.js';

// Lagren längst bort först. `sink` är hur fort lagret sjunker när man stiger
// (andel av världens skala), `drift` hur fort det glider förbi i sidled, `every`
// avståndet mellan topparna i px och `snow` hur långt ned snön når (andel av höjden).
const RIDGES = [
  { key: 'ridgeFar', sink: 0.035, drift: 0.04, lift: 190, amp: 190, every: 210, haze: 0.5, snow: 0.5, seed: 1.7 },
  { key: 'ridgeMid', sink: 0.08, drift: 0.1, lift: 120, amp: 120, every: 170, haze: 0.28, snow: 0.3, seed: 4.2 },
  { key: 'ridgeNear', sink: 0.18, drift: 0.2, lift: 66, amp: 42, every: 170, haze: 0.1, trees: true, seed: 8.9 },
];

/** Molntäcket man flyger igenom (m). Mellan Helags och Kebnekaise, där vuxna brukar vara. */
export const CLOUD_DECK = { lo: 1900, hi: 2040 };
const FOG_EDGE_M = 45; // dimman tätnar så här långt före och efter täcket
const AURORA_FROM_M = 4200;

/**
 * Himlen: blå på dagen, mörkare med höjden, och kvällsfärger när dusk = 1.
 * @param {number} thin  0–1, hur tunn luften är (mörkare himmel)
 */
export function drawSky(ctx, W, H, thin, dusk, c) {
  const top = mix(mix(c.skyTopLow, c.skyTopHigh, thin), c.duskTop, dusk);
  const bottom = mix(mix(c.skyBottomLow, c.skyBottomHigh, thin), c.duskBottom, dusk * (1 - thin));
  const mid = mix(mix(top, bottom, 0.55), c.duskMid, dusk * (1 - thin) * 0.8);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Dis vid horisonten, samma färg som bergen tonar mot. */
export function hazeColor(thin, dusk, c) {
  return mix(mix(c.skyBottomLow, c.skyBottomHigh, thin), mix(c.duskMid, c.duskBottom, 0.45), dusk * (1 - thin));
}

/** Sol med sken. På dagen högt och vitt, på kvällen lågt och varmt; skenet krymper i tunn luft. */
export function drawSun(ctx, W, H, thin, dusk, c) {
  // Fritt från instrumenten uppe till höger och helikoptern i mitten
  const x = W * (0.62 + 0.27 * dusk);
  const y = H * (0.34 + 0.27 * dusk);
  const r = Math.min(W, H) * (0.45 - 0.2 * thin + 0.25 * dusk);
  const glow = mix(c.sunGlow, '#ff9a4a', dusk * 0.6);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, alpha(glow, 0.6 + 0.2 * dusk));
  g.addColorStop(0.25, alpha(glow, 0.2 + 0.15 * dusk));
  g.addColorStop(1, alpha(glow, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = mix(c.sun, '#ffd9a0', dusk);
  ctx.beginPath();
  ctx.arc(x, y, Math.min(W, H) * (0.03 + 0.012 * dusk), 0, Math.PI * 2);
  ctx.fill();
}

/** Tunna slöjmoln högt upp som driver sakta. I kvällsljus lyser de rosa och orange. */
export function drawCirrus(ctx, W, H, time, thin, dusk, c) {
  const a = 0.5 * (1 - thin);
  if (a <= 0.02) return;
  const color = mix('#ffffff', '#ffb27a', dusk * 0.8);
  for (let i = 0; i < 7; i++) {
    const len = W * (0.18 + 0.2 * rand(i * 4.1));
    const x = mod(rand(i) * W * 1.4 - time * (3 + 4 * rand(i + 2)), W + len) - len / 2;
    const y = H * (0.08 + 0.32 * rand(i + 7));
    const g = ctx.createLinearGradient(x - len / 2, 0, x + len / 2, 0);
    g.addColorStop(0, alpha(color, 0));
    g.addColorStop(0.5, alpha(color, a * (0.4 + 0.5 * rand(i + 3))));
    g.addColorStop(1, alpha(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, len / 2, 3 + 5 * rand(i + 5), -0.03, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Fjällkedjorna. Nära marken syns alla tre; på några hundra meter har skogen
 * sjunkit undan, och runt 2 000 m ligger bara kalfjällens toppar kvar vid horisonten.
 * Solen står till höger, så topparnas vänstra sidor ligger i skugga.
 * @param {number} rise  px som kameran stigit över sitt läge på marken
 */
export function drawRidges(ctx, W, H, groundY, rise, distance, haze, dusk, c) {
  for (const r of RIDGES) {
    const base = groundY - r.lift + rise * r.sink;
    if (base - r.amp * 1.1 > H) continue;
    const shift = distance * r.drift;
    const tone = mix(c[r.key], c.duskTop, dusk * 0.45);
    const color = mix(tone, haze, r.haze);
    const pts = r.trees ? treeLine(r, base, shift, W) : ridgeLine(r, base, shift, W);

    const outline = new Path2D();
    outline.moveTo(-10, H + 10);
    for (const p of pts) outline.lineTo(p.x, p.y);
    outline.lineTo(W + 10, H + 10);
    outline.closePath();
    const g = ctx.createLinearGradient(0, base - r.amp, 0, base + 80);
    g.addColorStop(0, mix(color, '#ffffff', 0.06));
    g.addColorStop(1, mix(color, haze, 0.35));
    ctx.fillStyle = g;
    ctx.fill(outline);

    if (!r.trees) {
      ctx.save();
      ctx.clip(outline);
      // Snö ovanför en taggig linje på de högsta partierna; solsidan får kvällsljus
      if (r.snow) {
        ctx.beginPath();
        ctx.moveTo(-10, -10);
        for (let x = -10; x <= W + 10; x += 14) {
          const u = (x + shift) / 60;
          ctx.lineTo(x, base - r.amp * r.snow - r.amp * 0.12 * Math.sin(u * 1.7 + r.seed) - 10 * rand(Math.floor(u) + r.seed));
        }
        ctx.lineTo(W + 10, -10);
        ctx.fillStyle = mix(mix(c.ridgeSnow, '#ffc58f', dusk * 0.45), haze, r.haze * 0.8);
        ctx.fill();
      }
      // Skuggsidan: från sadeln upp till toppen och ned längs en taggig rygg som går snett
      const shade = mix(c.mountainShade, c.duskTop, dusk * 0.5);
      for (let i = 0; i < pts.length; i++) {
        if (!pts[i].peak) continue;
        let j = i - 1;
        while (j > 0 && !pts[j].saddle) j--;
        if (!pts[j]?.saddle) continue;
        const p = pts[i];
        const depth = base + 40 - p.y;
        const foot = p.x + (rand(r.seed + p.x * 0.013) - 0.4) * 0.8 * depth;
        const g = ctx.createLinearGradient(0, p.y, 0, base + 40);
        g.addColorStop(0, alpha(shade, 0.5 + 0.15 * dusk));
        g.addColorStop(1, alpha(shade, 0.12));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(pts[j].x, pts[j].y);
        for (let k = j + 1; k <= i; k++) ctx.lineTo(pts[k].x, pts[k].y);
        for (const t of [0.3, 0.6]) {
          ctx.lineTo(p.x + (foot - p.x) * t + (rand(p.x + t * 9.1) - 0.5) * 18, p.y + depth * t);
        }
        ctx.lineTo(foot, base + 40);
        ctx.lineTo(pts[j].x - depth, base + 40);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    // Dis i foten av varje lager ger djup
    const fog = ctx.createLinearGradient(0, base - r.amp * 0.3, 0, base + 60);
    fog.addColorStop(0, alpha(haze, 0));
    fog.addColorStop(1, alpha(haze, 0.4));
    ctx.fillStyle = fog;
    ctx.fillRect(0, base - r.amp * 0.3, W, H - base + r.amp * 0.3 + 10);
  }
}

/** Toppar och sadlar fasta i världen, med små taggar emellan. */
function ridgeLine(r, base, shift, W) {
  // Grupper av höga och låga toppar: en långsam våg gånger slumpen
  const top = (k) => ({
    x: k * r.every - shift + (rand(r.seed + k * 3.7) - 0.5) * r.every * 0.6,
    y: base - r.amp * (0.3 + 0.7 * (0.55 + 0.45 * Math.sin(k * 0.55 + r.seed)) * (0.45 + 0.55 * rand(r.seed + k * 1.3))),
  });
  const pts = [];
  for (let k = Math.floor(shift / r.every) - 2; ; k++) {
    const a = top(k);
    const b = top(k + 1);
    pts.push({ ...a, peak: true });
    const saddle = {
      x: a.x + (b.x - a.x) * (0.35 + 0.3 * rand(r.seed + k * 7.9)),
      y: Math.max(a.y, b.y) + r.amp * (0.1 + 0.25 * rand(r.seed + k * 5.1)),
    };
    jag(pts, a, saddle, r, k);
    pts.push({ ...saddle, saddle: true });
    jag(pts, saddle, b, r, k + 0.5);
    if (a.x > W + r.every) break;
  }
  return pts;
}

/** Två taggar mellan två punkter på konturen. */
function jag(pts, a, b, r, k) {
  for (const t of [0.33, 0.67]) {
    pts.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t + (rand(r.seed + k * 11.3 + t * 7) - 0.5) * r.amp * 0.12,
    });
  }
}

/** Skogskant: mjuka åsar med granar som taggar, fasta i världen. */
function treeLine(r, base, shift, W) {
  const pts = [];
  const step = 7;
  for (let k = Math.floor(shift / step) - 1; k * step - shift < W + step; k++) {
    const x = k * step - shift;
    const u = (x + shift) / 100;
    const ridge = base - r.amp * (0.55 + 0.28 * Math.sin(u * 0.9 + r.seed) + 0.17 * Math.sin(u * 2.3 + r.seed * 3));
    pts.push({ x, y: ridge - (k % 2 ? 0 : 6 + 6 * rand(k)) });
  }
  return pts;
}

/**
 * Molntäcket: under det syns en grå undersida som närmar sig, ovanför ett
 * solbelyst molnhav som sjunker mot horisonten och sedan ligger kvar.
 * @param {(alt:number)=>number} y  höjd → skärm-y
 */
export function drawCloudDeck(ctx, W, H, cam, y, heliY0, pxPerM, distance, c) {
  const shift = distance * 0.15;
  if (cam < CLOUD_DECK.lo) {
    const underside = y(CLOUD_DECK.lo);
    if (underside < 0) return;
    const g = ctx.createLinearGradient(0, underside - 160, 0, underside + 20);
    g.addColorStop(0, c.cloud);
    g.addColorStop(1, c.cloudShade);
    ctx.fillStyle = g;
    ctx.beginPath();
    billows(ctx, W, underside, shift, 1);
    ctx.fill('nonzero');
    return;
  }
  if (cam < CLOUD_DECK.hi) return; // inne i molnet – dimman sköter resten
  // Molnhavet följer världen en bit och ligger sedan nästan still vid horisonten.
  const raw = (cam - CLOUD_DECK.hi) * pxPerM;
  const knee = H * 0.28;
  const top = heliY0 + (raw < knee ? raw : knee + (raw - knee) * 0.04);
  if (top > H + 30) return;
  // Två rader: en skuggad längre bort och en solbelyst framför
  for (const [dy, s, color] of [[-26, 0.6, c.cloudShade], [0, 1, c.cloud]]) {
    const g = ctx.createLinearGradient(0, top + dy - 40, 0, H);
    g.addColorStop(0, color);
    g.addColorStop(1, mix(c.cloudShade, '#7f8fa8', 0.3));
    ctx.fillStyle = g;
    ctx.beginPath();
    billows(ctx, W, top + dy, shift * s + dy * 7, -1);
    ctx.fill('nonzero');
  }
}

/**
 * Molnkant av runda bulor längs y0, fast i världen. dir = -1: bulorna pekar uppåt och
 * molnet fyller nedåt (molnhavet); dir = 1: tvärtom (undersidan av täcket).
 */
function billows(ctx, W, y0, shift, dir) {
  const step = 55;
  ctx.rect(-10, dir < 0 ? y0 : -10, W + 20, dir < 0 ? 10000 : y0 + 10);
  for (let k = Math.floor(shift / step) - 2; k * step - shift < W + 2 * step; k++) {
    const r = 28 + 50 * rand(k * 1.7) ** 2;
    const x = k * step - shift + 20 * rand(k * 5.3);
    const cy = y0 - dir * (r * 0.35 - 14 * rand(k * 3.9));
    ctx.moveTo(x + r, cy);
    ctx.arc(x, cy, r, 0, Math.PI * 2);
  }
}

/** 0–1: hur tät dimman är när kameran är i eller nära molntäcket. */
export function fogAmount(cam) {
  const into = Math.min(cam - (CLOUD_DECK.lo - FOG_EDGE_M), CLOUD_DECK.hi + FOG_EDGE_M - cam);
  return Math.min(1, Math.max(0, into / FOG_EDGE_M));
}

export function drawFog(ctx, W, H, amount, c) {
  if (amount <= 0) return;
  ctx.fillStyle = alpha(c.cloud, 0.78 * amount);
  ctx.fillRect(0, 0, W, H);
}

/** Norrsken: gröna och violetta draperier som böljar långsamt. */
export function drawAurora(ctx, W, H, cam, time, c) {
  const a = Math.min(1, Math.max(0, (cam - AURORA_FROM_M) / 2500));
  if (a <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const curtains = [
    { color: c.aurora1, y: 0.12, len: 0.3, speed: 0.25, seed: 0 },
    { color: c.aurora2, y: 0.08, len: 0.22, speed: 0.18, seed: 2.1 },
    { color: c.aurora1, y: 0.22, len: 0.18, speed: 0.32, seed: 4.4 },
  ];
  for (const k of curtains) {
    const edge = (x) => H * k.y + 40 * Math.sin(x / 190 + time * k.speed + k.seed) + 18 * Math.sin(x / 67 - time * 0.4);
    const len = (x) => H * k.len * (0.6 + 0.4 * Math.sin(x / 130 + time * 0.2 + k.seed));
    const g = ctx.createLinearGradient(0, H * (k.y - 0.05), 0, H * (k.y + k.len + 0.1));
    g.addColorStop(0, alpha(k.color, 0));
    g.addColorStop(0.25, alpha(k.color, 0.35 * a));
    g.addColorStop(1, alpha(k.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let x = -10; x <= W + 10; x += 12) ctx.lineTo(x, edge(x));
    for (let x = W + 10; x >= -10; x -= 12) ctx.lineTo(x, edge(x) + len(x));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

const mod = (a, n) => ((a % n) + n) % n;
