// Fjälltoppar i scenen: silhuett med ljus och skugga, raviner, snötäcke, ett
// röse och en skylt med namn och höjd på toppen. Allt i skärmkoordinater;
// formen är deterministisk per topp.

import { mix, alpha } from './color.js';

const RIDGE_STEPS = 16;
const MAX_SLOPE = 0.95; // största kMin + kSpan nedan
const MAX_JAG_PX = 20;

/** Hur långt en silhuett högst når ut åt sidorna från toppen, givet höjden i px ned till `bottom`. */
export function mountainReach(depth) {
  return Math.max(0, depth) * MAX_SLOPE + MAX_JAG_PX;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} m          { name, h, area? }
 * @param {number} sx, sy     toppens position på skärmen
 * @param {number} bottom     y där silhuetten slutar (under skärmkanten)
 * @param {object} c          färger; c.rock och c.snow är redan disade för avståndet
 */
export function drawMountain(ctx, m, sx, sy, bottom, c) {
  const seed = m.h * 0.731 + m.name.length * 13.7;
  const depth = bottom - sy;
  // Lutning (px i sidled per px nedåt): fjällen lite rundare, alptoppar brantare.
  const [kMin, kSpan] = m.h < 2000 ? [0.6, 0.35] : [0.4, 0.3];
  const ridge = (side) => {
    const k = kMin + kSpan * rand(seed + side * 3.1);
    const pts = [];
    for (let i = 1; i <= RIDGE_STEPS; i++) {
      const t = i / RIDGE_STEPS;
      const down = t * depth;
      const jag = (rand(seed + side * 17 + i * 1.3) - 0.5) * Math.min(40, down * 0.3);
      pts.push([sx + side * (down * k + jag), sy + down + jag * 0.4]);
    }
    return pts;
  };
  const left = ridge(-1);
  const right = ridge(1);

  // Silhuett
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  for (const [x, y] of right) ctx.lineTo(x, y);
  for (let i = left.length - 1; i >= 0; i--) ctx.lineTo(left[i][0], left[i][1]);
  ctx.closePath();
  // Ljusare mot toppen och disigare ned mot dalen
  const g = ctx.createLinearGradient(0, sy, 0, bottom);
  g.addColorStop(0, mix(c.rock, '#ffffff', 0.12));
  g.addColorStop(1, mix(c.rock, c.valleyHaze, 0.45));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();

  // Raviner: mörka streck som löper nedför sluttningarna från krönet
  ctx.strokeStyle = alpha('#0b1220', 0.18);
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const side = i % 2 ? 1 : -1;
    const start = 0.08 + 0.5 * rand(seed + i * 9.1);
    const k = (kMin + kSpan * rand(seed + i * 2.3)) * (0.35 + 0.5 * rand(seed + i * 4.4));
    const x0 = sx + side * start * depth * k * 1.6;
    const y0 = sy + start * depth;
    ctx.lineWidth = 2 + 3 * rand(seed + i);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + side * 25, y0 + depth * 0.2, x0 + side * depth * 0.18, y0 + depth * 0.45);
    ctx.stroke();
  }

  // Snötäcke: ett band med taggig underkant, klippt till silhuetten
  const snow = Math.max(35, Math.min(170, (m.h - 500) / 14));
  const half = snow * 3;
  ctx.beginPath();
  ctx.moveTo(sx - half, sy - 20);
  ctx.lineTo(sx + half, sy - 20);
  const teeth = 10;
  for (let i = teeth; i >= 0; i--) {
    const x = sx - half + (2 * half * i) / teeth;
    const dip = (i % 2 ? 0.55 : 1) * snow * (0.8 + 0.4 * rand(seed + i * 5.7));
    ctx.lineTo(x, sy + dip);
  }
  ctx.closePath();
  ctx.fillStyle = c.snow;
  ctx.fill();

  // Skuggsida (höger): mörkar både berg och snö
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  for (const [x, y] of right) ctx.lineTo(x, y);
  ctx.lineTo(sx + depth * 0.08, bottom);
  ctx.closePath();
  ctx.fillStyle = c.mountainShade;
  ctx.fill();
  ctx.restore();

  // Röse på toppen, som skylten står i
  ctx.fillStyle = mix(c.rock, '#1b2230', 0.35);
  for (const [dx, dy, r] of [[-7, -3, 6], [6, -3, 6], [0, -10, 5.5], [0, -17, 4]]) {
    ctx.beginPath();
    ctx.ellipse(sx + dx, sy + dy, r * 1.2, r, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Skyltens mått och text. Används både för att rita och för att undvika krockar. */
export function signLayout(ctx, m, sx, sy, passed, scale, formatHeight) {
  const pole = 34 * scale;
  const nameFont = `800 ${Math.round(22 * scale)}px system-ui, sans-serif`;
  const heightFont = `700 ${Math.round(18 * scale)}px system-ui, sans-serif`;
  const heightText = `${passed ? '✓ ' : ''}${formatHeight(m.h)} m`;
  ctx.font = nameFont;
  const w1 = ctx.measureText(m.name).width;
  ctx.font = heightFont;
  // Bredden räknas alltid med bocken, så att skylten inte ändrar storlek när toppen passeras.
  const w2 = ctx.measureText(`✓ ${formatHeight(m.h)} m`).width;
  const pad = 14 * scale;
  const w = Math.max(w1, w2) + pad * 2;
  const h = 60 * scale;
  return { x: sx - w / 2, y: sy - pole - h, w, h: h + pole, pole, bh: h, nameFont, heightFont, heightText };
}

/**
 * Skylt på toppen: stolpe och bräda med namn och höjd. Passerade toppar får en bock.
 * @param {ReturnType<typeof signLayout>} L
 */
export function drawSign(ctx, m, sx, sy, passed, scale, c, L) {
  const { pole, nameFont, heightFont, heightText } = L;
  const bw = L.w;
  const bh = L.bh;
  const bx = L.x;
  const by = L.y;

  // Stolpe
  ctx.fillStyle = c.signPost;
  ctx.fillRect(sx - 3 * scale, sy - pole, 6 * scale, pole + 2);

  // Bräda med skugga, så att den lyfter mot berget bakom
  ctx.save();
  ctx.shadowColor = 'rgb(0 0 0 / 0.35)';
  ctx.shadowBlur = 10 * scale;
  ctx.shadowOffsetY = 3 * scale;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 8 * scale);
  ctx.fillStyle = passed ? c.signBoardPassed : c.signBoard;
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 3 * scale;
  ctx.strokeStyle = passed ? c.signCheck : c.signEdge;
  ctx.stroke();

  ctx.fillStyle = c.signText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = nameFont;
  ctx.fillText(m.name, sx, by + 27 * scale);
  ctx.font = heightFont;
  ctx.fillStyle = passed ? c.signCheck : c.signText;
  ctx.fillText(heightText, sx, by + 50 * scale);
}

/** Deterministiskt "slump"-tal 0–1. */
export function rand(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
