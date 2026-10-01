// Ritfunktioner för helikoptern och landskapet. Koordinater kring helikopterns
// mitt, nosen åt höger, skala 1 ≈ 250 px rotordiameter. Medarna står på y = 32.

import { mix, alpha } from './color.js';
import { rand } from './mountains.js';

/**
 * Räddningshelikopter från sidan: kabin med stora rutor, motorkåpa, stjärtbom och
 * inbyggd stjärtrotor (fenestron) i fenan.
 * @param {object} [livery]  helikopterns utseende (helicopters.js): { body, accent, trim, label }.
 *                           Utan livery används temats färger.
 */
export function drawHelicopter(ctx, rotor, c, livery = null) {
  const blur = rotor.blur;
  const body = livery?.body ?? c.body;
  const accent = livery?.accent ?? c.accent;
  const shade = mix(body, '#0b1220', 0.28);

  // Stjärtbom, avsmalnande
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-30, -14);
  ctx.lineTo(-108, -6);
  ctx.lineTo(-108, 2);
  ctx.lineTo(-34, 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = alpha(shade, 0.55);
  ctx.beginPath();
  ctx.moveTo(-34, 2);
  ctx.lineTo(-108, -1);
  ctx.lineTo(-108, 2);
  ctx.lineTo(-34, 8);
  ctx.closePath();
  ctx.fill();
  // Rand längs bommen
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(-36, -6);
  ctx.lineTo(-104, -3);
  ctx.lineTo(-104, 0);
  ctx.lineTo(-36, -1);
  ctx.closePath();
  ctx.fill();

  // Höjdroder med ändplattor
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(-96, -3, 22, 4, 2);
  ctx.fill();
  ctx.fillRect(-77, -8, 3, 12);

  // Fena med fenestron
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(-104, -6);
  ctx.lineTo(-114, -36);
  ctx.quadraticCurveTo(-118, -42, -124, -38);
  ctx.lineTo(-128, -8);
  ctx.quadraticCurveTo(-128, 6, -116, 8);
  ctx.lineTo(-104, 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = mix(accent, '#000000', 0.45);
  ctx.beginPath();
  ctx.arc(-117, -6, 8, 0, Math.PI * 2);
  ctx.fill();
  // Fenestronens blad i ringen
  ctx.save();
  ctx.translate(-117, -6);
  ctx.globalAlpha = 0.25 + 0.4 * blur;
  ctx.fillStyle = c.rotor;
  ctx.beginPath();
  ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1 - 0.7 * blur;
  ctx.strokeStyle = mix(c.rotor, '#ffffff', 0.4);
  ctx.lineWidth = 1.6;
  for (let k = 0; k < 4; k++) {
    const a = rotor.tailAngle + (k * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 6.5, Math.sin(a) * 6.5);
    ctx.stroke();
  }
  ctx.restore();

  // Medar och stag
  ctx.strokeStyle = c.metal;
  ctx.lineCap = 'round';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-18, 16);
  ctx.lineTo(-24, 32);
  ctx.moveTo(18, 16);
  ctx.lineTo(24, 32);
  ctx.stroke();
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-44, 32);
  ctx.lineTo(42, 32);
  ctx.quadraticCurveTo(52, 32, 55, 25);
  ctx.stroke();

  // Kabinen
  const cabin = new Path2D();
  cabin.moveTo(-40, -12);
  cabin.lineTo(-30, -24);
  cabin.lineTo(8, -26);
  cabin.bezierCurveTo(32, -26, 48, -16, 54, -2);
  cabin.bezierCurveTo(57, 6, 52, 14, 42, 17);
  cabin.lineTo(-30, 19);
  cabin.quadraticCurveTo(-42, 18, -42, 6);
  cabin.closePath();
  const g = ctx.createLinearGradient(0, -26, 0, 20);
  g.addColorStop(0, mix(body, '#ffffff', 0.35));
  g.addColorStop(0.55, body);
  g.addColorStop(1, shade);
  ctx.fillStyle = g;
  ctx.fill(cabin);

  // Färgfälten: nos och buk i accentfärgen, klippta till kabinen
  ctx.save();
  ctx.clip(cabin);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(-44, 8);
  ctx.lineTo(30, 6);
  ctx.quadraticCurveTo(44, 4, 50, -8);
  ctx.lineTo(60, -8);
  ctx.lineTo(60, 24);
  ctx.lineTo(-44, 24);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = alpha('#000000', 0.18);
  ctx.fillRect(-44, 12, 110, 12);
  ctx.restore();

  // Motorkåpa och mast
  ctx.fillStyle = mix(body, '#0b1220', 0.12);
  ctx.beginPath();
  ctx.moveTo(-28, -24);
  ctx.quadraticCurveTo(-24, -33, -12, -33);
  ctx.lineTo(10, -33);
  ctx.quadraticCurveTo(18, -33, 20, -26);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(-22, -31, 30, 3);
  ctx.fillStyle = c.metal;
  ctx.fillRect(-3, -38, 6, 6);

  // Rutor: vindruta, sidoruta och skjutdörr
  ctx.fillStyle = c.glass;
  ctx.beginPath();
  ctx.moveTo(16, -22);
  ctx.bezierCurveTo(32, -22, 45, -14, 50, -3);
  ctx.lineTo(28, -3);
  ctx.quadraticCurveTo(20, -3, 18, -10);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-8, -20, 20, 15, 4);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-32, -18, 18, 12, 4);
  ctx.fill();
  // Reflex i rutorna
  ctx.fillStyle = alpha('#ffffff', 0.35);
  ctx.beginPath();
  ctx.moveTo(22, -20);
  ctx.lineTo(30, -20);
  ctx.lineTo(24, -6);
  ctx.lineTo(19, -6);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-6, -19, 4, 13);
  // Dörrens fog
  ctx.strokeStyle = alpha('#0b1220', 0.35);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-12, -22);
  ctx.lineTo(-12, 17);
  ctx.moveTo(14, -24);
  ctx.lineTo(14, 16);
  ctx.stroke();

  if (livery?.label) {
    ctx.fillStyle = livery.trim ?? '#ffffff';
    ctx.font = '800 10px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(livery.label, -2, 12);
  }

  // Huvudrotor från sidan: 4 blad på en svagt lutad skiva
  const L = 100;
  ctx.save();
  ctx.translate(0, -39);
  if (blur > 0.05) {
    const disc = ctx.createLinearGradient(-L, 0, L, 0);
    disc.addColorStop(0, alpha(c.rotor, 0));
    disc.addColorStop(0.2, alpha(c.rotor, 0.35 * blur));
    disc.addColorStop(0.8, alpha(c.rotor, 0.35 * blur));
    disc.addColorStop(1, alpha(c.rotor, 0));
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.ellipse(0, 0, L, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1 - 0.7 * blur;
  ctx.strokeStyle = c.rotor;
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const phi = rotor.angle + (k * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(phi) * L, Math.sin(phi) * 7);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = c.metal;
  ctx.beginPath();
  ctx.ellipse(0, 0, 7, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Stackmoln av runda bulor med platt undersida: ljust upptill och skuggat nedtill.
 * @param {number} seed  formen är densamma varje bild
 * @param {string} [light]  färgen på solsidan (varmare i kvällsljus)
 */
export function drawCloud(ctx, x, y, s, c, seed = 0, light = c.cloud) {
  const n = 5 + Math.floor(rand(seed * 3.1) * 4);
  const w = 80 * s;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0.5 : i / (n - 1);
    const r = (14 + 18 * Math.sin(Math.PI * u) + 8 * rand(seed + i * 1.7)) * s;
    const cx = x - w / 2 + u * w;
    const cy = y - r * 0.55;
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.rect(x - w / 2 - 6 * s, y - 10 * s, w + 12 * s, 10 * s);
  const g = ctx.createLinearGradient(0, y - 40 * s, 0, y);
  g.addColorStop(0, light);
  g.addColorStop(0.6, mix(light, c.cloudShade, 0.35));
  g.addColorStop(1, c.cloudShade);
  ctx.fillStyle = g;
  ctx.fill('nonzero');
}

/** Gran: tre lager med en ljusare sida mot solen. */
export function drawTree(ctx, x, groundY, c, size = 1) {
  ctx.fillStyle = c.trunk;
  ctx.fillRect(x - 1.5 * size, groundY - 8 * size, 3 * size, 8 * size);
  for (let k = 0; k < 3; k++) {
    const w = (12 - k * 3) * size;
    const base = groundY - (6 + k * 9) * size;
    ctx.fillStyle = k % 2 ? c.tree : mix(c.tree, '#000000', 0.15);
    ctx.beginPath();
    ctx.moveTo(x, base - 16 * size);
    ctx.lineTo(x + w, base);
    ctx.lineTo(x - w, base);
    ctx.closePath();
    ctx.fill();
  }
}
