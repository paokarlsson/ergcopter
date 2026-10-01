// Fjälltoppar i scenen: silhuett med ljus och skugga, raviner och snötäcke, och en
// etikett i glas ovanför toppen med namn och höjd. Allt i skärmkoordinater;
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

  // Snöstråk i rännorna under snötäcket
  ctx.strokeStyle = alpha(c.snow, 0.7);
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const x0 = sx + side * snow * (0.4 + 1.6 * rand(seed + i * 6.3));
    const y0 = sy + snow * (0.5 + 0.5 * rand(seed + i * 2.9));
    ctx.lineWidth = 2 + 4 * rand(seed + i * 8.1);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + side * snow * 0.3, y0 + snow * (0.6 + 0.8 * rand(seed + i * 3.3)));
    ctx.stroke();
  }

  // Skuggsida (vänster, solen står till höger): mörkar både berg och snö
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  for (const [x, y] of left) ctx.lineTo(x, y);
  ctx.lineTo(sx - depth * 0.08, bottom);
  ctx.closePath();
  ctx.fillStyle = c.mountainShade;
  ctx.fill();
  ctx.restore();
}

/** Etikettens mått och text. Används både för att rita och för att undvika krockar. */
export function labelLayout(ctx, m, sx, sy, passed, scale, formatHeight) {
  const pole = 26 * scale;
  const nameFont = `800 ${Math.round(24 * scale)}px "Barlow Condensed", system-ui, sans-serif`;
  const heightFont = `600 ${Math.round(18 * scale)}px "Barlow Condensed", system-ui, sans-serif`;
  const heightText = `${formatHeight(m.h)} m`;
  ctx.font = nameFont;
  const w1 = ctx.measureText(m.name).width;
  ctx.font = heightFont;
  // Bredden räknas alltid med bocken, så att etiketten inte ändrar storlek när toppen passeras.
  const check = 20 * scale;
  const w2 = ctx.measureText(heightText).width + check;
  const pad = 12 * scale;
  const w = Math.max(w1, w2) + pad * 2;
  const h = 54 * scale;
  return { x: sx - w / 2, y: sy - pole - h, w, h: h + pole, pole, bh: h, pad, check, nameFont, heightFont, heightText };
}

/**
 * Etikett i glas ovanför toppen: namn och höjd, med en bock när toppen är passerad.
 * En tunn linje går ned till en lysande punkt på toppen.
 * @param {ReturnType<typeof labelLayout>} L
 */
export function drawLabel(ctx, m, sx, sy, passed, scale, c, L) {
  const { pad, check, nameFont, heightFont, heightText } = L;
  const bx = L.x;
  const by = L.y;

  ctx.strokeStyle = alpha('#ffffff', 0.75);
  ctx.lineWidth = 1.5 * scale;
  ctx.beginPath();
  ctx.moveTo(sx, by + L.bh);
  ctx.lineTo(sx, sy - 3 * scale);
  ctx.stroke();
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 9 * scale);
  glow.addColorStop(0, '#ffffff');
  glow.addColorStop(0.35, alpha('#ffffff', 0.8));
  glow.addColorStop(1, alpha('#ffffff', 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sx, sy, 9 * scale, 0, Math.PI * 2);
  ctx.fill();

  // Plattan med skugga, så att den lyfter mot berget bakom
  ctx.save();
  ctx.shadowColor = 'rgb(0 0 0 / 0.35)';
  ctx.shadowBlur = 12 * scale;
  ctx.shadowOffsetY = 3 * scale;
  ctx.beginPath();
  ctx.roundRect(bx, by, L.w, L.bh, 6 * scale);
  ctx.fillStyle = c.labelBg;
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 1;
  ctx.strokeStyle = c.labelEdge;
  ctx.stroke();

  ctx.fillStyle = c.labelText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = nameFont;
  ctx.fillText(m.name, bx + pad, by + 24 * scale);
  ctx.font = heightFont;
  ctx.fillStyle = alpha(c.labelText, 0.9);
  ctx.fillText(heightText, bx + pad + check, by + 45 * scale);
  // Bocken: grön när toppen är passerad, annars en tom ring
  const cx = bx + pad + 7 * scale;
  const cy = by + 39 * scale;
  ctx.lineWidth = 2.5 * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (passed) {
    ctx.strokeStyle = c.labelCheck;
    ctx.moveTo(cx - 6 * scale, cy);
    ctx.lineTo(cx - 2 * scale, cy + 4 * scale);
    ctx.lineTo(cx + 6 * scale, cy - 5 * scale);
  } else {
    ctx.strokeStyle = alpha(c.labelText, 0.5);
    ctx.arc(cx, cy, 5 * scale, 0, Math.PI * 2);
  }
  ctx.stroke();
}

/** Deterministiskt "slump"-tal 0–1. */
export function rand(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
