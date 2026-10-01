// Ritfunktioner för helikoptern och landskapet. Koordinater kring helikopterns
// mitt, nosen åt höger, skala 1 ≈ 250 px rotordiameter. Medarna står på y = 32.

import { mix, alpha } from './color.js';
import { rand } from './mountains.js';

const HUB_Y = -39; // huvudrotorns nav
const BLADE = 100; // bladlängd

/**
 * Räddningshelikopter från sidan, som en H135: stor välvd vindruta, skjutdörr,
 * motorkåpa med luftintag, avsmalnande stjärtbom med stabilisator och inbyggd
 * stjärtrotor (fenestron) i fenan, medar på tvärbommar och fyrbladig huvudrotor.
 * Lacken skuggas som en rundad kropp med blank högdager, rutorna speglar himlen.
 * @param {object} rotor      { angle, tailAngle, blur } från rotor.js
 * @param {object} c          temats färger (body, accent, glass, metal, rotor)
 * @param {object} [livery]   helikopterns utseende (helicopters.js): { body, accent, trim, label }
 * @param {object} [env]      { dusk: 0–1 } varmare ljus i kvällssol
 */
export function drawHelicopter(ctx, rotor, c, livery = null, env = null) {
  const dusk = env?.dusk ?? 0;
  const body = livery?.body ?? c.body;
  const accent = livery?.accent ?? c.accent;
  const light = mix('#ffffff', '#ffd9a8', dusk * 0.7); // solsidans ljus
  const sky = mix('#b9d3ee', '#f4b98a', dusk); // det rutorna och lacken speglar

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  drawTail(ctx, rotor, body, accent, light, c);
  drawSkids(ctx, c, light, true);
  drawPod(ctx, body, accent, light, sky, livery, c);
  drawSkids(ctx, c, light, false);
  drawMainRotor(ctx, rotor, c, light);
  ctx.restore();
}

/** Stjärtbommen, stabilisatorn och fenan med fenestron. */
function drawTail(ctx, rotor, body, accent, light, c) {
  const boom = new Path2D();
  boom.moveTo(-34, -19);
  boom.lineTo(-108, -9.5);
  boom.quadraticCurveTo(-112, -5, -108, -0.5);
  boom.lineTo(-42, 5);
  boom.closePath();
  const g = ctx.createLinearGradient(0, -19, 0, 5);
  g.addColorStop(0, mix(body, '#ffffff', 0.45));
  g.addColorStop(0.35, body);
  g.addColorStop(1, mix(body, '#1b2433', 0.42));
  ctx.fillStyle = g;
  ctx.fill(boom);
  // Rand längs bommen och blank högdager
  ctx.save();
  ctx.clip(boom);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(-40, -8);
  ctx.lineTo(-110, -4.5);
  ctx.lineTo(-110, -1.5);
  ctx.lineTo(-40, -2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = alpha(light, 0.5);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-40, -16);
  ctx.lineTo(-106, -8.2);
  ctx.stroke();
  ctx.restore();
  // Antenner på bommen
  ctx.fillStyle = mix(c.metal, '#ffffff', 0.25);
  ctx.beginPath();
  ctx.moveTo(-62, -14.6);
  ctx.lineTo(-66, -19);
  ctx.lineTo(-64, -14.4);
  ctx.closePath();
  ctx.fill();

  // Stabilisator med ändplattor
  ctx.fillStyle = mix(body, '#1b2433', 0.12);
  ctx.beginPath();
  ctx.moveTo(-83, -3.5);
  ctx.quadraticCurveTo(-86, -6, -97, -5.6);
  ctx.lineTo(-99, -2.6);
  ctx.quadraticCurveTo(-90, -1.8, -83, -2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(-93, -12);
  ctx.lineTo(-97, -12.5);
  ctx.lineTo(-100, 4);
  ctx.lineTo(-95, 4.5);
  ctx.closePath();
  ctx.fill();

  // Fenan: svept framkant, fenestronens rundning och sporre
  const fin = new Path2D();
  fin.moveTo(-104, -9);
  fin.bezierCurveTo(-110, -18, -115, -32, -118, -41);
  fin.quadraticCurveTo(-121, -45, -126, -43);
  fin.lineTo(-129, -22);
  fin.bezierCurveTo(-135, -14, -134, 3, -124, 8);
  fin.lineTo(-117, 11);
  fin.lineTo(-114, 7);
  fin.bezierCurveTo(-111, 4, -109, 1, -108, -1);
  fin.closePath();
  const gf = ctx.createLinearGradient(-104, -44, -130, 10);
  gf.addColorStop(0, mix(accent, '#ffffff', 0.18));
  gf.addColorStop(0.6, accent);
  gf.addColorStop(1, mix(accent, '#140a10', 0.4));
  ctx.fillStyle = gf;
  ctx.fill(fin);
  ctx.strokeStyle = alpha('#000000', 0.25);
  ctx.lineWidth = 0.8;
  ctx.stroke(fin);
  // Kanten på fenestronens hölje
  ctx.strokeStyle = alpha(light, 0.35);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(-120, -5, 12.5, -2.4, 0.4);
  ctx.stroke();
  // Röret med bladen
  const duct = ctx.createRadialGradient(-120, -5, 2, -120, -5, 9.5);
  duct.addColorStop(0, '#2a2f37');
  duct.addColorStop(0.75, '#14171c');
  duct.addColorStop(1, '#3a404a');
  ctx.fillStyle = duct;
  ctx.beginPath();
  ctx.arc(-120, -5, 9.5, 0, Math.PI * 2);
  ctx.fill();
  const blur = rotor.blur;
  ctx.save();
  ctx.translate(-120, -5);
  if (blur > 0.3) {
    ctx.fillStyle = alpha('#9aa3ae', 0.22 * blur);
    ctx.beginPath();
    ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1 - 0.75 * blur;
  ctx.strokeStyle = '#8a929c';
  ctx.lineWidth = 1.3;
  for (let k = 0; k < 10; k++) {
    const a = rotor.tailAngle + (k * Math.PI) / 5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 2.5, Math.sin(a) * 2.5);
    ctx.lineTo(Math.cos(a + 0.12) * 8.5, Math.sin(a + 0.12) * 8.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#596170';
  ctx.beginPath();
  ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Lanternor: vit i fenans topp
  ctx.fillStyle = '#fffbe8';
  ctx.beginPath();
  ctx.arc(-126.5, -41, 1.2, 0, Math.PI * 2);
  ctx.fill();
}

/** Medarna: tvärbommar och medrör, rundade med blank ovansida. far = den bortre (mörkare). */
function drawSkids(ctx, c, light, far) {
  ctx.save();
  if (far) ctx.translate(-3, -1.5);
  const tube = far ? mix(c.metal, '#000000', 0.35) : c.metal;
  ctx.strokeStyle = tube;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(16, 19);
  ctx.quadraticCurveTo(21, 24, 22, 32);
  ctx.moveTo(-15, 20);
  ctx.quadraticCurveTo(-19, 25, -20, 32);
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-42, 32);
  ctx.lineTo(43, 32);
  ctx.quadraticCurveTo(53, 32, 57, 25);
  ctx.stroke();
  if (!far) {
    ctx.strokeStyle = alpha(light, 0.55);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-40, 30.8);
    ctx.lineTo(42, 30.8);
    ctx.quadraticCurveTo(51, 30.8, 55, 24.6);
    ctx.moveTo(17.5, 20);
    ctx.quadraticCurveTo(21.5, 24.5, 22.5, 30.5);
    ctx.stroke();
    // Fotsteg
    ctx.fillStyle = mix(c.metal, '#ffffff', 0.15);
    ctx.fillRect(-4, 27, 9, 2);
  }
  ctx.restore();
}

/** Kabinen med lack, rutor, dörrar, motorkåpa och detaljer. */
function drawPod(ctx, body, accent, light, sky, livery, c) {
  const pod = new Path2D();
  pod.moveTo(-36, -21);
  pod.lineTo(12, -24);
  pod.bezierCurveTo(31, -24.5, 48, -15, 56, -3);
  pod.bezierCurveTo(59.5, 3, 58, 10, 52, 15);
  pod.bezierCurveTo(46, 19.5, 38, 21, 28, 21);
  pod.lineTo(-24, 21);
  pod.bezierCurveTo(-34, 21, -42, 16, -46, 8);
  pod.bezierCurveTo(-49, 2, -48, -8, -44, -14);
  pod.bezierCurveTo(-41, -18.5, -39, -20.5, -36, -21);
  pod.closePath();

  // Grundlacken, sedan färgfältet nedtill, båda klippta till kabinen
  ctx.fillStyle = body;
  ctx.fill(pod);
  ctx.save();
  ctx.clip(pod);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(-60, 3);
  ctx.bezierCurveTo(-20, 1.5, 20, 2.5, 40, 3);
  ctx.quadraticCurveTo(50, 3, 62, -6);
  ctx.lineTo(62, 30);
  ctx.lineTo(-60, 30);
  ctx.closePath();
  ctx.fill();
  // Tunn mörk list mellan fälten
  ctx.strokeStyle = alpha('#10141c', 0.55);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-60, 2);
  ctx.bezierCurveTo(-20, 0.5, 20, 1.5, 40, 2);
  ctx.quadraticCurveTo(50, 2, 62, -7);
  ctx.stroke();

  // Rundad kropp: mörkare nedåt, ljusare upptill, studsljus längst ned
  ctx.globalCompositeOperation = 'multiply';
  const shade = ctx.createLinearGradient(0, -26, 0, 22);
  shade.addColorStop(0, '#ffffff');
  shade.addColorStop(0.45, '#f1f2f5');
  shade.addColorStop(0.8, '#a9b0bd');
  shade.addColorStop(1, '#7d8696');
  ctx.fillStyle = shade;
  ctx.fillRect(-60, -30, 125, 55);
  // Bakre delen vänder bort från ljuset
  const back = ctx.createLinearGradient(-48, 0, -10, 0);
  back.addColorStop(0, '#8d95a3');
  back.addColorStop(1, '#ffffff');
  ctx.fillStyle = back;
  ctx.fillRect(-60, -30, 50, 55);
  ctx.globalCompositeOperation = 'screen';
  // Blank högdager längs taket och en mjuk reflex av himlen på sidan
  ctx.strokeStyle = alpha(light, 0.7);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-38, -17.5);
  ctx.lineTo(10, -20.5);
  ctx.stroke();
  const glow = ctx.createLinearGradient(0, -12, 0, 0);
  glow.addColorStop(0, alpha(sky, 0));
  glow.addColorStop(0.6, alpha(sky, 0.18));
  glow.addColorStop(1, alpha(sky, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(-50, -12, 110, 12);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();

  // Dörrar och paneler
  ctx.strokeStyle = alpha('#0b1220', 0.38);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  // Pilotdörren
  ctx.moveTo(13, -22.5);
  ctx.bezierCurveTo(18, -8, 21, 6, 22, 19.5);
  ctx.moveTo(-9, -22);
  ctx.lineTo(-9, 20);
  // Skjutdörren och dess skena
  ctx.moveTo(-36, -19);
  ctx.lineTo(-36, 18);
  ctx.moveTo(-36, -21.5);
  ctx.lineTo(-6, -22.8);
  // Bakre musseldörrar
  ctx.moveTo(-40, 15);
  ctx.quadraticCurveTo(-44, 2, -42, -12);
  ctx.stroke();
  ctx.strokeStyle = alpha(light, 0.35);
  ctx.beginPath();
  ctx.moveTo(-8.2, -21);
  ctx.lineTo(-8.2, 19);
  ctx.moveTo(-35.2, -18);
  ctx.lineTo(-35.2, 17);
  ctx.stroke();
  // Handtag
  ctx.fillStyle = alpha('#0b1220', 0.5);
  ctx.fillRect(-14, -1, 4, 1.3);
  ctx.fillRect(9, 0, 4, 1.3);

  // Rutor: vindrutan, hakrutan, pilotdörren och skjutdörren
  const glass = (path) => {
    const gg = ctx.createLinearGradient(0, -24, 0, 14);
    gg.addColorStop(0, mix(sky, '#ffffff', 0.25));
    gg.addColorStop(0.35, mix(sky, c.glass, 0.55));
    gg.addColorStop(0.7, c.glass);
    gg.addColorStop(1, mix(c.glass, '#000000', 0.4));
    ctx.fillStyle = gg;
    ctx.fill(path);
    ctx.strokeStyle = alpha('#0b1220', 0.65);
    ctx.lineWidth = 1;
    ctx.stroke(path);
  };
  const windscreen = new Path2D();
  windscreen.moveTo(15, -22.3);
  windscreen.bezierCurveTo(31, -22.5, 46, -14, 53.5, -3.5);
  windscreen.quadraticCurveTo(54, -0.5, 50.5, -0.5);
  windscreen.lineTo(27, -1);
  windscreen.bezierCurveTo(23, -1, 20.5, -6, 18.5, -12);
  windscreen.closePath();
  glass(windscreen);
  const chin = new Path2D();
  chin.moveTo(36, 3);
  chin.lineTo(51, 2.5);
  chin.quadraticCurveTo(52, 8, 47, 12.5);
  chin.quadraticCurveTo(40, 12, 36, 9);
  chin.closePath();
  glass(chin);
  const pilot = new Path2D();
  pilot.moveTo(-6, -19.5);
  pilot.lineTo(10.5, -20.5);
  pilot.bezierCurveTo(13.5, -14, 15.5, -8, 16.5, -3);
  pilot.lineTo(-6, -3);
  pilot.closePath();
  glass(pilot);
  const side = new Path2D();
  side.roundRect(-32, -17.5, 20, 13, 3.5);
  glass(side);
  // Reflexer: ett ljust snedstreck i varje ruta
  ctx.save();
  ctx.clip(windscreen);
  ctx.fillStyle = alpha('#ffffff', 0.4);
  ctx.beginPath();
  ctx.moveTo(26, -23);
  ctx.lineTo(33, -23);
  ctx.lineTo(25, -1);
  ctx.lineTo(20, -1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  for (const [path, x] of [[pilot, 2], [side, -24]]) {
    ctx.save();
    ctx.clip(path);
    ctx.fillStyle = alpha('#ffffff', 0.28);
    ctx.beginPath();
    ctx.moveTo(x, -22);
    ctx.lineTo(x + 5, -22);
    ctx.lineTo(x - 1, 0);
    ctx.lineTo(x - 5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // Ramen mitt i vindrutan
  ctx.strokeStyle = alpha('#0b1220', 0.55);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(32, -21.5);
  ctx.quadraticCurveTo(35, -12, 36, -1);
  ctx.stroke();

  // Motorkåpan med luftintag och avgasrör, masten
  const cowl = new Path2D();
  cowl.moveTo(-38, -20.5);
  cowl.bezierCurveTo(-36, -28, -31, -31.5, -22, -32.5);
  cowl.lineTo(4, -33);
  cowl.bezierCurveTo(11, -33, 15, -29, 15.5, -23.6);
  cowl.closePath();
  const gc = ctx.createLinearGradient(0, -34, 0, -21);
  gc.addColorStop(0, mix(body, '#ffffff', 0.5));
  gc.addColorStop(0.5, body);
  gc.addColorStop(1, mix(body, '#1b2433', 0.25));
  ctx.fillStyle = gc;
  ctx.fill(cowl);
  ctx.strokeStyle = alpha('#0b1220', 0.3);
  ctx.lineWidth = 0.8;
  ctx.stroke(cowl);
  ctx.fillStyle = '#1d2229';
  ctx.beginPath();
  ctx.roundRect(-14, -30.5, 12, 5, 1.5);
  ctx.fill();
  ctx.strokeStyle = alpha('#9aa3ae', 0.55);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let x = -12.5; x < -2; x += 2) {
    ctx.moveTo(x, -30);
    ctx.lineTo(x, -26);
  }
  ctx.stroke();
  // Avgasröret bak på kåpan
  ctx.fillStyle = '#4a5059';
  ctx.beginPath();
  ctx.moveTo(-35, -27.5);
  ctx.lineTo(-40.5, -29);
  ctx.lineTo(-40.5, -25.5);
  ctx.lineTo(-36, -24.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#16191e';
  ctx.beginPath();
  ctx.ellipse(-40.5, -27.2, 0.9, 1.7, 0, 0, Math.PI * 2);
  ctx.fill();
  // Skugga där kåpan möter taket
  ctx.strokeStyle = alpha('#0b1220', 0.3);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-37, -20.6);
  ctx.lineTo(14.5, -23.4);
  ctx.stroke();
  // Rött antikollisionsljus på kåpan
  ctx.fillStyle = '#ff3b30';
  ctx.beginPath();
  ctx.ellipse(-26, -33, 2, 1.4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Vinschen ovanför skjutdörren
  ctx.fillStyle = mix(c.metal, '#ffffff', 0.2);
  ctx.beginPath();
  ctx.roundRect(-33, -27, 13, 4.5, 1.5);
  ctx.fill();
  ctx.fillStyle = c.metal;
  ctx.fillRect(-35, -25.5, 3, 2);
  // Sökarljus och kamerakula under nosen
  ctx.fillStyle = '#2b3038';
  ctx.beginPath();
  ctx.ellipse(31, 22.5, 4, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#dfe6ee';
  ctx.beginPath();
  ctx.ellipse(34.4, 22.4, 1, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Kontur runt kabinen och text på dörren
  ctx.strokeStyle = alpha('#0b1220', 0.28);
  ctx.lineWidth = 0.9;
  ctx.stroke(pod);
  if (livery?.label) {
    ctx.fillStyle = livery.trim ?? '#ffffff';
    ctx.font = '800 9.5px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(livery.label, -22, 11.5);
  }
}

/** Fyrbladig huvudrotor: blad som syns när den går sakta, en skiva när den går fort. */
function drawMainRotor(ctx, rotor, c, light) {
  const blur = rotor.blur;
  // Mastens kåpa och navet
  ctx.fillStyle = mix(c.metal, '#ffffff', 0.1);
  ctx.beginPath();
  ctx.moveTo(-5, -33);
  ctx.lineTo(-3, -38);
  ctx.lineTo(3, -38);
  ctx.lineTo(5, -33);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.translate(0, HUB_Y);
  if (blur > 0.05) {
    const disc = ctx.createLinearGradient(-BLADE, 0, BLADE, 0);
    disc.addColorStop(0, alpha(c.rotor, 0));
    disc.addColorStop(0.08, alpha(c.rotor, 0.45 * blur));
    disc.addColorStop(0.5, alpha(c.rotor, 0.12 * blur));
    disc.addColorStop(0.92, alpha(c.rotor, 0.45 * blur));
    disc.addColorStop(1, alpha(c.rotor, 0));
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.ellipse(0, 0.5, BLADE, 3.2 + 2.5 * blur, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ljus kant där bladspetsarna går
    ctx.strokeStyle = alpha(light, 0.18 * blur);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0.5, BLADE - 1, 3 + 2.5 * blur, 0, Math.PI * 0.05, Math.PI * 0.95);
    ctx.stroke();
  }
  ctx.globalAlpha = 1 - 0.85 * blur;
  for (let k = 0; k < 4; k++) {
    const phi = rotor.angle + (k * Math.PI) / 2;
    const tipX = Math.cos(phi) * BLADE;
    const tipY = Math.sin(phi) * 5 + (1 - blur) * Math.abs(Math.cos(phi)) * 2.5; // lite hängande i stillhet
    const nx = -tipY / BLADE;
    const w = 1.3 + 0.9 * Math.abs(Math.sin(phi)); // bladet vridet: bredare när det pekar mot oss
    ctx.fillStyle = c.rotor;
    ctx.beginPath();
    ctx.moveTo(nx * w, -w);
    ctx.lineTo(tipX + nx * w * 0.7, tipY - w * 0.7);
    ctx.lineTo(tipX - nx * w * 0.7, tipY + w * 0.7);
    ctx.lineTo(-nx * w, w);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#3b414b';
  ctx.beginPath();
  ctx.ellipse(0, 0, 7, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = alpha(light, 0.5);
  ctx.beginPath();
  ctx.ellipse(-1, -1.2, 4, 1.2, 0, 0, Math.PI * 2);
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
