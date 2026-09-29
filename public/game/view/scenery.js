// Bakgrunden som visar höjden utan siffror: solen, fjällkedjor i tre lager som
// sjunker undan när man stiger (skog, fjällbjörk och hed, kalfjäll med snö),
// ett molntäcke att flyga igenom med ett molnhav ovanför, och norrsken högt upp.
// Allt är dekor; milstolparnas berg ritas av mountains.js.

import { mix, alpha } from './color.js';
import { rand } from './mountains.js';

// Lagren längst bort först. `sink` är hur fort lagret sjunker när man stiger
// (andel av världens skala), `drift` hur fort det glider förbi i sidled.
const RIDGES = [
  { key: 'ridgeFar', sink: 0.035, drift: 0.04, lift: 170, amp: 110, haze: 0.45, snow: true, seed: 1.7 },
  { key: 'ridgeMid', sink: 0.08, drift: 0.1, lift: 115, amp: 70, haze: 0.25, seed: 4.2 },
  { key: 'ridgeNear', sink: 0.18, drift: 0.2, lift: 70, amp: 40, haze: 0.1, trees: true, seed: 8.9 },
];

/** Molntäcket man flyger igenom (m). Mellan Helags och Kebnekaise, där vuxna brukar vara. */
export const CLOUD_DECK = { lo: 1900, hi: 2040 };
const FOG_EDGE_M = 45; // dimman tätnar så här långt före och efter täcket
const AURORA_FROM_M = 4200;

/** Sol med sken. Skenet krymper och blir vitare i tunn luft. */
export function drawSun(ctx, W, H, thin, c) {
  // Fritt från instrumenten uppe till höger och helikoptern i mitten
  const x = W * 0.62;
  const y = H * 0.4;
  const r = Math.min(W, H) * (0.45 - 0.2 * thin);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, alpha(c.sunGlow, 0.55));
  g.addColorStop(0.25, alpha(c.sunGlow, 0.18));
  g.addColorStop(1, alpha(c.sunGlow, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = c.sun;
  ctx.beginPath();
  ctx.arc(x, y, Math.min(W, H) * 0.035, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Fjällkedjorna. Nära marken syns alla tre; på några hundra meter har skogen
 * sjunkit undan, och runt 2 000 m ligger bara kalfjällens toppar kvar vid horisonten.
 * @param {number} rise  px som kameran stigit över sitt läge på marken
 */
export function drawRidges(ctx, W, H, groundY, rise, distance, hazeColor, c) {
  for (const r of RIDGES) {
    const base = groundY - r.lift + rise * r.sink;
    if (base - r.amp * 1.3 > H) continue;
    const shift = distance * r.drift;
    const top = (x) => {
      const u = (x + shift) / 100;
      let h = 0.55 + 0.28 * Math.sin(u * 0.9 + r.seed) + 0.17 * Math.sin(u * 2.3 + r.seed * 3);
      if (r.snow) h += 0.35 * Math.pow(Math.abs(Math.sin(u * 0.55 + r.seed * 7)), 6); // spetsigare toppar
      return base - r.amp * h;
    };
    const color = mix(c[r.key], hazeColor, r.haze);
    ctx.beginPath();
    ctx.moveTo(-10, H + 10);
    if (r.trees) {
      // Granskog: taggig kant som ligger fast i världen (samma pinnar varje bild)
      const step = 7;
      for (let k = Math.floor(shift / step) - 1; k * step - shift < W + step; k++) {
        const x = k * step - shift;
        ctx.lineTo(x, top(x) - (k % 2 ? 0 : 7 + 5 * rand(k)));
      }
    } else {
      for (let x = -10; x <= W + 10; x += 10) ctx.lineTo(x, top(x));
    }
    ctx.lineTo(W + 10, H + 10);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    if (r.snow) {
      // Snö ovanför en taggig linje, bara på de högsta partierna
      ctx.save();
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(-10, -10);
      for (let x = -10; x <= W + 10; x += 10) {
        const u = (x + shift) / 100;
        ctx.lineTo(x, base - r.amp * (0.78 + 0.06 * Math.sin(u * 5.1)));
      }
      ctx.lineTo(W + 10, -10);
      ctx.fillStyle = mix(c.mountainSnow, hazeColor, r.haze * 0.8);
      ctx.fill();
      ctx.restore();
    }
    // Dis i foten av varje lager ger djup
    const g = ctx.createLinearGradient(0, base - r.amp * 0.4, 0, base + 60);
    g.addColorStop(0, alpha(hazeColor, 0));
    g.addColorStop(1, alpha(hazeColor, 0.35));
    ctx.fillStyle = g;
    ctx.fillRect(0, base - r.amp * 0.4, W, H - base + r.amp * 0.4 + 10);
  }
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
