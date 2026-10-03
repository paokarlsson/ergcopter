// Små bilder till korten i Fjällräddaren-menyn: en scen med fjäll och helikopter och
// det som övningen handlar om. Ritas en gång. Med 3D-landskapet (terrain.js) och
// 3D-helikoptern (heli3d.js) får varje kort en egen scen med egen kamera (thumb-shots.js).
// Utan dem ritas himmel och fjäll här, med den platta helikoptern och band, pilar och
// linjer som förklaring.

import { drawHelicopter, drawCloud } from './heli-draw.js';
import { mix, alpha } from './color.js';
import { rand } from './mountains.js';
import { drawShot, shotView } from './thumb-shots.js';

const W = 320;
const H = 200;
const GROUND = 172;
const STILL = { blur: 0.8, angle: 0.4, tailAngle: 0.3 };
const DUSK_IDS = ['exam', 'mission', 'altitude', 'late-catch'];

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} id      övningens id, 'lesson-1'…, 'exam', 'mission' eller 'free'
 * @param {object} c       scenens färger (render.js)
 * @param {object} livery  helikopterns utseende
 * @param {HTMLCanvasElement|null} [photo]  bilden av 3D-landskapet från thumbView(id)
 * @param {object|null} [heli]      Heli3D
 * @param {object|null} [hoverPad]  HoverPad, hyllan med plattan i plattscenerna
 */
export function drawThumb(canvas, id, c, livery, photo = null, heli = null, hoverPad = null) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const seed = seedOf(id);
  if (photo && heli && !heli.lost) {
    // Lite mer kontrast än landskapet i spelet: korten ska lysa mot den mörka panelen
    ctx.filter = 'saturate(1.15) contrast(1.18)';
    ctx.drawImage(photo, 0, 0, W, H);
    ctx.filter = 'none';
    drawShot(ctx, id, heli, hoverPad, livery, grade);
    vignette(ctx);
    return;
  }
  if (photo) ctx.drawImage(photo, 0, 0, W, H);
  else backdrop(ctx, c, seed, DUSK_IDS.includes(id) ? 1 : 0);
  const motif = MOTIFS[motifOf(id)] ?? MOTIFS.free;
  motif(ctx, c, livery, Boolean(photo));
}

/**
 * Djupt blått i himlen och skuggorna, som i spelets övriga bilder: landskapet blir kvällsklart
 * och mörkare än helikoptern, som ritas efteråt och lyser mot det. Hyllan med plattan
 * (nedanför ledge) tonas svagare, så att plattans målning syns.
 */
function grade(ctx, ledge = null) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgb(96 128 190)'); // himlen överst ljusare än skuggorna, så att kortet lyser uppifrån
  if (ledge === null) {
    g.addColorStop(0.45, 'rgb(132 154 202)');
    g.addColorStop(1, 'rgb(80 100 146)');
  } else {
    const at = ledge / H;
    g.addColorStop(at * 0.9, 'rgb(132 154 202)');
    g.addColorStop(Math.min(1, at + 0.02), 'rgb(176 190 220)');
    g.addColorStop(1, 'rgb(120 136 176)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** Mörkare hörn och ett svagt ljus uppifrån, som ett foto. */
function vignette(ctx) {
  const g = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.35, W / 2, H * 0.45, W * 0.72);
  g.addColorStop(0, 'rgb(0 0 0 / 0)');
  g.addColorStop(1, 'rgb(2 8 20 / 0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Kameran för kortets bild i 3D-landskapet (TerrainRenderer.snapshots): scenens egen. */
export function thumbView(id) {
  return shotView(id);
}

const seedOf = (id) => [...id].reduce((a, ch) => a + ch.charCodeAt(0), 0);

function motifOf(id) {
  const lesson = /^lesson-(\d)/.exec(id);
  return lesson ? LESSON_MOTIF[lesson[1]] : id;
}

/** Himmel, två fjällkedjor och mark. */
function backdrop(ctx, c, seed, dusk) {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, mix('#2a5d9a', c.duskTop, dusk));
  sky.addColorStop(1, mix('#b9d6ee', c.duskBottom, dusk));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  for (const [base, amp, color, snow] of [
    [GROUND - 40, 60, mix('#8090ae', c.duskMid, dusk * 0.6), true],
    [GROUND - 8, 34, mix('#4c6680', c.duskTop, dusk * 0.5), false],
  ]) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    const pts = [];
    for (let x = -20, k = 0; x <= W + 40; x += 34 + 30 * rand(seed + k), k++) {
      pts.push([x, base - amp * (0.35 + 0.65 * rand(seed * 1.7 + k * 3.1))]);
    }
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (!snow) continue;
    ctx.save();
    ctx.clip();
    ctx.fillStyle = mix('#f2f6fb', '#ffc58f', dusk * 0.4);
    ctx.fillRect(0, 0, W, base - amp * 0.62);
    ctx.restore();
  }
  ctx.fillStyle = mix('#3e5a3a', '#1a2430', dusk * 0.4);
  ctx.fillRect(0, GROUND, W, H - GROUND);
}

function heli(ctx, c, livery, x, y, s = 0.42) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  drawHelicopter(ctx, STILL, c, livery);
  ctx.restore();
}

function pad(ctx, x, photo = false) {
  if (photo) return;
  ctx.fillStyle = '#2f343c';
  ctx.beginPath();
  ctx.ellipse(x, GROUND + 4, 46, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f2c230';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.ellipse(x, GROUND + 4, 36, 4.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function band(ctx, c, top, bottom) {
  ctx.fillStyle = alpha(c.guide, 0.18);
  ctx.fillRect(0, top, W, bottom - top);
  dashedLine(ctx, top, c.guide);
  dashedLine(ctx, bottom, c.guide);
}

function dashedLine(ctx, y, color, x0 = 0, x1 = W) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function arrow(ctx, x, y0, y1, color) {
  const dir = Math.sign(y1 - y0);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1 - dir * 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 11, y1 - dir * 12);
  ctx.lineTo(x + 11, y1 - dir * 12);
  ctx.lineTo(x, y1 + dir * 4);
  ctx.closePath();
  ctx.fill();
}

function glowRing(ctx, c, x, y, rx, ry) {
  ctx.save();
  ctx.strokeStyle = c.guide;
  ctx.shadowColor = c.guide;
  ctx.shadowBlur = 10;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function text(ctx, str, x, y, size = 20, color = '#ffffff') {
  ctx.font = `800 ${size}px "Barlow Condensed", system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgb(0 0 0 / 0.6)';
  ctx.shadowBlur = 4;
  ctx.fillText(str, x, y);
  ctx.shadowBlur = 0;
}

const LESSON_MOTIF = { 1: 'bounce', 2: 'stairs', 3: 'freefall', 4: 'sandbag' };

// Motiven håller sig mellan rubriken upptill (y < 50) och stjärnorna nedtill (y > 150).
const MOTIFS = {
  'first-lift'(ctx, c, l, photo) {
    pad(ctx, 160, photo);
    dashedLine(ctx, 66, c.guide);
    text(ctx, '50 m', 262, 80, 18);
    arrow(ctx, 236, 150, 92, c.guide);
    heli(ctx, c, l, 140, 128, 0.5);
  },
  bounce(ctx, c, l, photo) {
    pad(ctx, 236, photo);
    ctx.strokeStyle = alpha('#ffffff', 0.85);
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 5]);
    for (const x0 of [20, 85, 150]) {
      ctx.beginPath();
      ctx.moveTo(x0, GROUND);
      ctx.quadraticCurveTo(x0 + 30, 70, x0 + 60, GROUND);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    heli(ctx, c, l, 236, 136, 0.48);
  },
  hover(ctx, c, l) {
    band(ctx, c, 66, 126);
    glowRing(ctx, c, 160, 126, 78, 11);
    heli(ctx, c, l, 160, 98, 0.5);
  },
  stairs(ctx, c, l) {
    ctx.strokeStyle = c.guide;
    ctx.lineWidth = 4;
    ctx.beginPath();
    let y = 160;
    ctx.moveTo(10, y);
    for (let x = 10; x < 220; x += 55) {
      ctx.lineTo(x + 55, y);
      y -= 22;
      ctx.lineTo(x + 55, y);
    }
    ctx.lineTo(310, y);
    ctx.stroke();
    heli(ctx, c, l, 262, y - 18, 0.44);
  },
  altitude(ctx, c, l) {
    drawCloud(ctx, 70, 150, 0.8, c, 3);
    drawCloud(ctx, 262, 140, 0.6, c, 5);
    dashedLine(ctx, 62, c.guide);
    text(ctx, '1 000 m', 230, 76, 18);
    arrow(ctx, 50, 140, 74, c.guide);
    heli(ctx, c, l, 160, 96, 0.48);
  },
  freefall(ctx, c, l) {
    band(ctx, c, 134, 158);
    arrow(ctx, 200, 104, 132, '#ff6b5e');
    heli(ctx, c, l, 200, 82, 0.44);
  },
  elevator(ctx, c, l) {
    band(ctx, c, 134, 158);
    for (const [x, y] of [[50, 72], [120, 84], [190, 96]]) arrow(ctx, x, y, y + 36, '#ff6b5e');
    heli(ctx, c, l, 268, 86, 0.4);
  },
  'late-catch'(ctx, c, l) {
    dashedLine(ctx, 160, '#ff6b5e');
    band(ctx, c, 128, 156);
    arrow(ctx, 110, 62, 126, '#ff6b5e');
    heli(ctx, c, l, 220, 118, 0.44);
  },
  sandbag(ctx, c, l) {
    band(ctx, c, 66, 108);
    ctx.strokeStyle = '#2f343c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(160, 104);
    ctx.lineTo(160, 128);
    ctx.stroke();
    ctx.fillStyle = '#c8a26a';
    ctx.strokeStyle = '#7a5a2e';
    ctx.beginPath();
    ctx.roundRect(149, 128, 22, 20, 5);
    ctx.fill();
    ctx.stroke();
    heli(ctx, c, l, 160, 82, 0.46);
  },
  engine(ctx, c, l) {
    for (const [x, y, r] of [[146, 58, 10], [134, 50, 8], [122, 44, 6]]) {
      ctx.fillStyle = alpha('#3a3f47', 0.7);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    arrow(ctx, 236, 96, 150, '#ff6b5e');
    heli(ctx, c, l, 150, 98, 0.46);
    ctx.fillStyle = '#ff6b5e';
    ctx.beginPath();
    ctx.arc(282, 74, 17, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, '!', 282, 75, 26);
  },
  follow(ctx, c, l) {
    band(ctx, c, 66, 124);
    heli(ctx, c, { body: '#f4f5f7', accent: '#d3302a', trim: '#ffffff' }, 236, 96, 0.4);
    heli(ctx, c, l, 92, 104, 0.4);
  },
  clouds(ctx, c, l) {
    heli(ctx, c, l, 160, 104, 0.48);
    ctx.fillStyle = alpha('#ffffff', 0.55);
    ctx.fillRect(0, 0, W, H);
    for (const [x, y, s, k] of [[60, 90, 1.6, 1], [250, 120, 1.8, 2], [150, 170, 2, 4], [210, 60, 1.4, 6]]) {
      ctx.globalAlpha = 0.85;
      drawCloud(ctx, x, y, s, c, k);
    }
    ctx.globalAlpha = 1;
  },
  patrol(ctx, c, l) {
    band(ctx, c, 66, 128);
    text(ctx, '400–500 m', 228, 82, 17);
    ctx.strokeStyle = alpha('#ffffff', 0.8);
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(14, 104);
    for (let x = 14; x <= 140; x += 10) ctx.lineTo(x, 100 + 12 * Math.sin(x / 18));
    ctx.stroke();
    ctx.setLineDash([]);
    heli(ctx, c, l, 190, 108, 0.44);
  },
  rings(ctx, c, l) {
    for (const [x, y] of [[156, 108], [216, 98], [276, 110]]) glowRing(ctx, c, x, y, 12, 30);
    heli(ctx, c, l, 70, 110, 0.4);
  },
  exam(ctx, c, l, photo) {
    pad(ctx, 112, photo);
    heli(ctx, c, l, 112, 150, 0.46);
    // Guldmedalj med stjärna
    ctx.fillStyle = '#f6c744';
    ctx.strokeStyle = '#a37a14';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(250, 98, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = '800 38px system-ui, sans-serif';
    ctx.fillStyle = '#a37a14';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', 250, 100);
  },
  mission(ctx, c, l, photo) {
    // En topp med en skadad skidåkare, räddningshelikoptern med vinschen nere.
    // I 3D-bilden står toppen redan i landskapet.
    if (!photo) {
      ctx.fillStyle = mix('#6e7d93', c.duskTop, 0.4);
      ctx.beginPath();
      ctx.moveTo(140, GROUND);
      ctx.lineTo(236, 122);
      ctx.lineTo(330, GROUND);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f4f7fb';
      ctx.beginPath();
      ctx.moveTo(236, 122);
      ctx.lineTo(216, 136);
      ctx.lineTo(256, 136);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = '#2f343c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(236, 92);
    ctx.lineTo(236, 116);
    ctx.stroke();
    ctx.fillStyle = '#d7263d';
    ctx.fillRect(229, 114, 14, 8);
    heli(ctx, c, l, 236, 76, 0.4);
  },
  landing(ctx, c, l, photo) {
    pad(ctx, 160, photo);
    glowRing(ctx, c, 160, GROUND + 4, 52, 7);
    arrow(ctx, 250, 70, 140, c.guide);
    heli(ctx, c, l, 160, 112, 0.5);
  },
  free(ctx, c, l) {
    heli(ctx, c, l, 160, 100, 0.5);
  },
};
