// Fjällräddaren på klippan: räddaren i röd overall med hjälm och ryggsäck, sedd bakifrån, som står på en
// granitklippa framför en snöig fjällkedja i kvällsljus. Ritas en gång per storlek (ingen kostnad per bildruta),
// med solen lågt bakom till höger: kanterna får varmt motljus och klippans framsidor ligger i kall skugga.
// Själva räddaren strålföljs i 3D i view/rescuer-figure.js. Används på resultatskärmen.

import { renderRescuerFigure } from './rescuer-figure.js';

const SUN = norm3(0.66, -0.6, -0.22); // x höger, y nedåt, z mot betraktaren: solen står lågt bakom till höger
const FEET_U = -0.148; // mitten mellan räddarens fötter, i H från högerkanten

/**
 * Ritar figuren på en canvas och ritar om när storleken ändras (även när skärmen visas efter att ha varit dold).
 * Klippan och fjällen tar närmare en sekund att räkna fram, så det görs i en egen tråd (rescuer-worker.js)
 * redan när sidan laddas, i den storlek canvasen får när skärmen visas (92vh bred, hela höjden; se .result-figure
 * i game.css). Då hackar varken flygningen eller övergången till resultatet. Utan workers målas bilden direkt.
 * @param {HTMLCanvasElement|null} canvas
 */
export function mountRescuerScene(canvas) {
  if (!canvas) return;
  let shown = ''; // storleken som ligger på canvasen
  let wanted = ''; // storleken som målas just nu
  let worker = null;
  const put = (w, h, image) => {
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(image, 0, 0);
    shown = `${w}x${h}`;
  };
  const paintHere = (w, h, detail) => {
    const c = offscreen(w, h);
    paintRescuerScene(c.getContext('2d'), w, h, detail);
    put(w, h, c);
  };
  const request = (cssW, cssH, visible) => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    const key = `${w}x${h}`;
    if (w < 2 || h < 2 || (worker && key === wanted)) return;
    if (key === shown) {
      wanted = key; // en äldre beställning som fortfarande målas ska inte skriva över bilden
      return;
    }
    wanted = key;
    if (worker) worker.postMessage({ w, h, detail: 1 / dpr });
    else if (visible) paintHere(w, h, 1 / dpr);
  };
  const visibleSize = () => {
    const rect = canvas.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2 ? rect : null;
  };
  try {
    worker = new Worker(new URL('./rescuer-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { w, h, bitmap } = e.data;
      if (`${w}x${h}` === wanted) put(w, h, bitmap);
      bitmap.close();
    };
    // Tråden gick inte att starta (t.ex. utan OffscreenCanvas): måla här i stället, när skärmen syns
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      wanted = '';
      const rect = visibleSize();
      if (rect) request(rect.width, rect.height, true);
    };
  } catch {
    worker = null;
  }
  new ResizeObserver(() => {
    const rect = visibleSize();
    if (rect) request(rect.width, rect.height, true);
  }).observe(canvas);
  let timer = 0;
  const ahead = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!visibleSize()) request(Math.min(innerHeight * 0.92, innerWidth), innerHeight, false);
    }, 300);
  };
  addEventListener('resize', ahead);
  ahead();
}

/**
 * Hela motivet: fjällen, klippan i förgrunden och räddaren på dess topp. Allt mäts i canvasens höjd (H) från
 * högerkanten, så att figuren hamnar på samma plats på skärmen oavsett bildformat.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w, h  canvasens storlek i pixlar
 * @param {number} [detail]  upplösning för klippan relativt canvasen (t.ex. 1/dpr); fjällen räknas i halva den
 */
export function paintRescuerScene(ctx, w, h, detail = 1) {
  const steps = paintSteps(ctx, w, h, detail);
  while (!steps.next().done);
}

/** Samma målning i små steg (yield mellan bitarna), så att den kan göras när webbläsaren har tid över. */
function* paintSteps(ctx, w, h, detail) {
  const H = h;
  const feetX = w + FEET_U * H;
  const rs = Math.min(1, detail);
  const rock = yield* rockLayer(Math.round(w * rs), Math.round(h * rs), h * rs);
  // Fötterna sätts på klippans lägsta punkt under kängorna, så att ingen av dem svävar; den andra sjunker en
  // aning in bakom kanten, som om han står en bit in på hällen
  const feetY = rock.topAt(Math.round(feetX * rs), Math.round(0.035 * H * rs)) / rs + 0.006 * H;
  const far = rs * 0.7; // himlen och fjällen ligger långt bort i diset och tål lägre upplösning
  const back = yield* backdropLayer(Math.round(w * far), Math.round(h * far), h * far);
  // Räddarens skugga faller mot betraktaren och åt vänster, bort från solen. Den målas på klippan (bara där
  // klippan finns), så att den följer med när klippans kant ritas över kängorna.
  const figH = 0.245 * H;
  const rc = rock.canvas.getContext('2d');
  rc.save();
  rc.globalCompositeOperation = 'source-atop';
  rc.scale(rs, rs);
  rc.filter = `blur(${Math.max(1, figH * 0.02 * rs)}px)`;
  rc.fillStyle = 'rgba(8,6,10,0.6)';
  rc.beginPath();
  rc.ellipse(feetX - figH * 0.1, feetY + figH * 0.03, figH * 0.2, figH * 0.035, 0.18, 0, Math.PI * 2);
  rc.fill();
  rc.filter = `blur(${Math.max(1, figH * 0.008 * rs)}px)`;
  rc.fillStyle = 'rgba(4,3,6,0.8)';
  rc.beginPath();
  rc.ellipse(feetX - figH * 0.05, feetY + figH * 0.004, figH * 0.12, figH * 0.018, 0, 0, Math.PI * 2);
  rc.fill();
  rc.restore();

  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(back, 0, 0, w, h);
  ctx.drawImage(rock.canvas, 0, 0, w, h);

  // Solens strålstreck längs horisonten ligger bakom räddaren, så att det inte skär tvärs över honom
  const sx = w + SUN_AT[0] * H;
  const sy = SUN_AT[1] * H;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(sx, sy);
  ctx.scale(1, 0.035);
  const streak = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.16 * H);
  streak.addColorStop(0, 'rgba(255,220,170,0.5)');
  streak.addColorStop(1, 'rgba(255,170,110,0)');
  ctx.fillStyle = streak;
  ctx.fillRect(-0.16 * H, -0.16 * H, 0.32 * H, 0.32 * H);
  ctx.restore();

  drawRescuer(ctx, feetX, feetY, figH);
  // Klippans främre kant ritas igen över kängsulorna, så att han står på hällen och inte framför den
  ctx.save();
  ctx.beginPath();
  ctx.rect(feetX - 0.08 * H, feetY - 0.006 * H, 0.16 * H, 0.03 * H);
  ctx.clip();
  ctx.drawImage(rock.canvas, 0, 0, w, h);
  ctx.restore();

  // Solens bländning ovanpå allt: ett mjukt sken som äter sig in i räddarens kant, som när kameran tittar
  // nästan rakt mot solen
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const bloom = ctx.createRadialGradient(sx, sy, 0, sx, sy, 0.09 * H);
  bloom.addColorStop(0, 'rgba(255,224,170,0.4)');
  bloom.addColorStop(0.25, 'rgba(255,170,100,0.09)');
  bloom.addColorStop(1, 'rgba(255,140,80,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(sx - 0.1 * H, sy - 0.1 * H, 0.2 * H, 0.2 * H);
  ctx.restore();
}

/**
 * Räddaren bakifrån, strålföljd i 3D (view/rescuer-figure.js) och ritad med fötterna på marken.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x, y   mitt mellan fötterna, på marken
 * @param {number} size   figurens höjd i pixlar
 */
export function drawRescuer(ctx, x, y, size) {
  const fig = renderRescuerFigure(Math.round(size), size > 420 ? 1 : 2);
  const layer = offscreen(fig.width, fig.height);
  const c = layer.getContext('2d');
  const img = c.createImageData(fig.width, fig.height);
  img.data.set(fig.data);
  c.putImageData(img, 0, 0);
  ctx.drawImage(layer, Math.round(x - fig.footX), Math.round(y - fig.footY));
}

// --- Kvällshimlen och fjällkedjorna bakom klippan ---------------------------------------------------------
// Ett enda täckande lager: himmel med molnband och låg sol, tre kedjor som bleknar i diset ju längre bort de
// ligger, och allt belyst från samma sol. Lagret tonar ut åt vänster in i landskapet bakom resultatet.

const SUN_AT = [-0.075, 0.405]; // solskivan i H från högerkanten: strax till höger om räddaren, nära horisonten

/**
 * Kedjorna i H-enheter: top(u) är kammens höjd, haze hur mycket kvällsdiset tar över färgen,
 * och färgerna gäller sten och snö i skugga respektive i sol.
 */
const RANGES = [
  {
    top: (u) => 0.5 - massif(u, [[-0.08, 0.05, 0.6], [-0.2, 0.062, 0.5], [-0.34, 0.04, 0.7], [-0.5, 0.055, 0.5],
      [-0.7, 0.045, 0.6], [-0.9, 0.05, 0.6]], 13, 0.6),
    haze: 0.32, mist: 0.4, sunny: 0.6, gully: 40, seed: 13,
    rock: [[72, 82, 116], [144, 118, 128]], snow: [[178, 186, 214], [242, 216, 208]],
  },
  {
    top: (u) => 0.535 - massif(u, [[-0.03, 0.1, 0.75], [-0.13, 0.062, 0.9], [-0.25, 0.048, 1.0], [-0.38, 0.07, 0.85],
      [-0.52, 0.052, 0.9], [-0.68, 0.085, 0.7], [-0.86, 0.062, 0.8]], 0, 1),
    haze: 0.04, mist: 0.22, sunny: 0.5, gully: 70, seed: 0,
    rock: [[42, 52, 80], [104, 90, 104]], snow: [[176, 188, 216], [240, 218, 210]],
  },
  {
    top: (u) => 0.6 - massif(u, [[-0.1, 0.05, 1.0], [-0.4, 0.06, 1.1], [-0.55, 0.085, 0.9], [-0.75, 0.05, 1.0]], 7, 1),
    haze: 0.04, mist: 0.3, sunny: 0.5, gully: 84, seed: 7,
    rock: [[34, 40, 60], [92, 78, 86]], snow: [[150, 162, 194], [226, 204, 200]],
  },
];

/**
 * En fjällkam som profil: varje topp [u, höjd, branthet] är en spets med raka sidor, och kammen följer den högsta.
 * Mellan topparna blir det sadlar. Lite brus i två skalor bryter upp sidorna i axlar och små tinnar.
 */
function massif(u, list, seed, rough) {
  let best = 0;
  for (const [pu, ph, ps] of list) {
    // Sidan mot solen (höger) är lite längre och flackare, som på riktiga fjäll med en brant nordvägg
    // Toppen är lite avrundad, och sidorna planar ut nedåt
    const d = u - pu;
    const ad = Math.sqrt(d * d + 0.0003) - 0.017;
    best = Math.max(best, ph - Math.pow(Math.max(0, ad), 0.85) * ps * 0.62 * (d > 0 ? 0.85 : 1.15));
  }
  return best + rough * ((ridged(u * 9 + seed, seed, 3) - 0.4) * 0.024 + (ridged(u * 30 + seed, seed + 5, 3) - 0.4) * 0.01
    + (fbm(u * 90 + seed, seed + 2, 2) - 0.5) * 0.004);
}

// Himlens grundton uppifrån: dämpat lila, rosa persika, orange och blekt guld vid horisonten
const SKY = [
  [0.0, [112, 92, 128]],
  [0.12, [160, 112, 128]],
  [0.26, [214, 138, 116]],
  [0.38, [240, 164, 108]],
  [0.43, [246, 184, 132]],
  [0.5, [222, 168, 158]],
  [0.6, [206, 160, 166]],
];

function skyBase(v, out) {
  let k = 1;
  while (k < SKY.length - 1 && v > SKY[k][0]) k++;
  const [v0, c0] = SKY[k - 1];
  const [v1, c1] = SKY[k];
  const t = Math.max(0, Math.min(1, (v - v0) / (v1 - v0)));
  for (let i = 0; i < 3; i++) out[i] = c0[i] + (c1[i] - c0[i]) * t;
  return out;
}

/** Solens sken vid (u, v): ett brett varmt dis, en tät gloria och själva skivan. */
function sunLight(u, v) {
  const dx = u - SUN_AT[0];
  const dy = (v - SUN_AT[1]) * 1.7; // skenet breder ut sig längs horisonten
  const d = Math.hypot(dx, dy);
  return { d, wide: Math.exp(-d * 6), tight: Math.exp(-d * 30), disk: smooth(0.016, 0.011, Math.hypot(dx, v - SUN_AT[1])) };
}

// Molnbanden: tunna stråk i höjd med solen och tjockare lager högre upp
const BANDS = [[0.05, 0.06, 1.0], [0.15, 0.04, 0.95], [0.235, 0.03, 0.9], [0.3, 0.022, 0.85], [0.36, 0.014, 0.7],
  [0.425, 0.008, 0.45]];

function cloudDensity(u, v) {
  let env = 0;
  for (const [c, s, a] of BANDS) env = Math.max(env, a * Math.exp(-((v - c) * (v - c)) / (2 * s * s)));
  if (env < 0.02) return 0;
  // Mindre utdragna än förr, så att banden blir lösa molnbankar och inte penseldrag
  const warp = fbm(u * 2.2 + 4, v * 8, 2) * 0.9;
  const n = fbm(u * 3.2 + warp, v * 15 + warp * 2, 5);
  return smooth(0.38, 0.68, n + (env - 0.5) * 0.5) * env;
}

function* backdropLayer(w, h, H) {
  const canvas = offscreen(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const inv = 1 / H;
  const sky = new Float32Array(w * h * 3);
  const base = [0, 0, 0];
  const yMax = Math.min(h, Math.ceil(0.62 * H)); // himlen syns aldrig nedanför den närmaste kedjan

  // Himlen med moln. Tätheten räknas först så att molnens undersidor kan få solljuset i nästa varv.
  const dens = new Float32Array(w * yMax);
  for (let y = 0; y < yMax; y++) {
    if (y % 16 === 0) yield;
    for (let x = 0; x < w; x++) dens[y * w + x] = cloudDensity((x - w) * inv, y * inv);
  }
  const e = Math.max(1, Math.round(0.006 * H));
  for (let y = 0; y < h; y++) {
    if (y % 24 === 0) yield;
    const v = Math.min(y, yMax - 1) * inv;
    for (let x = 0; x < w; x++) {
      const u = (x - w) * inv;
      skyBase(v, base);
      const s = sunLight(u, v);
      let r = base[0] + 255 * (s.wide * 0.32 + s.tight * 0.55);
      let g = base[1] + 205 * (s.wide * 0.3 + s.tight * 0.55);
      let b = base[2] + 130 * (s.wide * 0.22 + s.tight * 0.45);
      const yy = Math.min(y, yMax - 1);
      const dn = dens[yy * w + x];
      if (dn > 0) {
        // Undersidan, som vetter mot den låga solen, lyser; ovansidan ligger i lila skugga
        const below = dens[Math.min(yMax - 1, yy + e) * w + x];
        const above = dens[Math.max(0, yy - e) * w + x];
        const under = Math.max(0, Math.min(1, (dn - below) * 3 + 0.3));
        const top = Math.max(0, Math.min(1, (dn - above) * 3));
        const near = Math.exp(-s.d * 3.2);
        const lit = Math.min(1, 0.12 + under * (0.35 + 0.6 * near) + near * 0.35 - top * 0.15);
        const cr = 138 + (255 - 138) * lit;
        const cg = 92 + (176 - 92) * lit + s.tight * 60;
        const cb = 108 + (124 - 108) * lit + s.tight * 40;
        const a = Math.min(1, dn * 1.5) * (1 - s.tight * 0.6);
        r += (cr - r) * a;
        g += (cg - g) * a;
        b += (cb - b) * a;
        // Silverkant: tunna molnkanter nära solen genomlyses
        const edge = dn * (1 - dn) * 4 * Math.exp(-s.d * 9);
        r += 60 * edge;
        g += 48 * edge;
        b += 30 * edge;
      }
      r += (255 - r) * s.disk;
      g += (246 - g) * s.disk;
      b += (222 - b) * s.disk;
      const o = (y * w + x) * 3;
      sky[o] = r;
      sky[o + 1] = g;
      sky[o + 2] = b;
    }
  }

  const tops = RANGES.map((rg) => {
    const t = new Float32Array(w + 2);
    for (let x = -1; x <= w; x++) t[x + 1] = rg.top((x - w) * inv);
    return t;
  });
  // Kammens lutning, utjämnad, ger sidornas ljus i stort
  const slopes = tops.map((t) => {
    const s = new Float32Array(w);
    const k = Math.max(1, Math.round(0.02 * H));
    for (let x = 0; x < w; x++) s[x] = (t[Math.min(w + 1, x + 1 + k)] - t[Math.max(0, x + 1 - k)]) * H / (2 * k);
    return s;
  });
  const snowline = RANGES.map((rg) => {
    const s = new Float32Array(w);
    for (let x = 0; x < w; x++) s[x] = 0.014 + 0.045 * fbm((x - w) * inv * 7 + rg.seed, rg.seed, 3);
    return s;
  });
  for (let x = 0; x < w; x++) {
    const u = (x - w) * inv;
    // Borta åt vänster, så att bakgrunden smälter in i det tredimensionella landskapet bakom resultatet
    const side = smooth(-0.86, -0.52, u);
    if (x % 24 === 0) yield;
    // Diset har himlens färg vid horisonten, så att kedjorna nära solen bleks i guld
    const hz = Math.round(Math.min(yMax - 1, 0.45 * H)) * w + x;
    // Lite kallare och dovare än själva horisonten: diset ligger mellan betraktaren och de skuggade sidorna
    const hr = sky[hz * 3] * 0.55 + 124 * 0.45;
    const hg = sky[hz * 3 + 1] * 0.55 + 124 * 0.45;
    const hb = sky[hz * 3 + 2] * 0.55 + 162 * 0.45;
    const glowCol = Math.exp(-Math.abs(u - SUN_AT[0]) * 5);
    for (let y = 0; y < h; y++) {
      const v = y * inv;
      const o3 = (y * w + x) * 3;
      let cr = sky[o3];
      let cg = sky[o3 + 1];
      let cb = sky[o3 + 2];
      for (let k = 0; k < RANGES.length; k++) {
        const rg = RANGES[k];
        const d = v - tops[k][x + 1];
        const a = Math.min(1, Math.max(0, d * H + 0.5));
        if (a <= 0) continue;
        const slope = slopes[k][x] * Math.exp(-d * 18);
        // Rännor och utsprång nedför fjällsidan, med lite krokiga linjer; deras högra sidor fångar ljuset
        // De följer kammens fallinje, så att ribborna löper snett ned från topparna som på riktiga fjäll
        const tilt = Math.max(-1.4, Math.min(1.4, -slopes[k][x] * 1.3));
        const warp = fbm(u * 6 + rg.seed, d * 10, 3) * 1.6;
        const gu = (u + Math.min(d, 0.05) * tilt) * rg.gully + warp + rg.seed;
        const gv = d * rg.gully * 0.7 + rg.seed;
        const gl = fbm(gu - 0.25, gv, 4);
        const gr = fbm(gu + 0.25, gv, 4);
        // Närmare kedjor ser vi mer i motljus: bara kanterna som vetter mot solen lyser
        const lit = smooth(-0.2, 0.25, slope * 2 + (gr - gl) * 5 + 0.02) * rg.sunny;
        // Snö högt upp och i rännorna, bruten av mörka klippribbor och glesare nedåt
        const sl = snowline[k][x] * (0.4 + 1.4 * fbm(gu * 0.9, gv * 0.6 + 3, 3));
        const ribs = smooth(0.4, 0.52, fbm(gu * 1.7 + 5, gv * 0.9, 4));
        // Snön ligger i stråk längs rännorna, inte i hela fält
        const streak = smooth(0.32, 0.62, fbm(gu * 2.6 + 11, gv * 0.35, 4));
        const snow = smooth(sl, sl * 0.3, d) * (1 - ribs * 0.95) * (0.35 + 0.65 * streak);
        // Diset tätnar nedåt mot dalen, och kammen närmast solen får en varm kant av motljus
        const mist = smooth(0.0, 0.1, d) * rg.mist;
        const haze = Math.min(0.88, rg.haze + mist);
        const rim = Math.exp(-d / 0.004) * (0.25 + 0.75 * glowCol) * (1 - rg.haze * 0.5);
        // Långt ned i dalen är diset kallare och mörkare, i skugga under kammarna
        const cool = smooth(0.02, 0.12, d) * 0.55;
        const mix = (i, hzc, valley, rimc) => {
          const s0 = rg.snow[0][i] + (rg.snow[1][i] - rg.snow[0][i]) * lit;
          const r0 = rg.rock[0][i] + (rg.rock[1][i] - rg.rock[0][i]) * lit * 0.85;
          const m = r0 + (s0 - r0) * snow;
          const air = hzc + (valley - hzc) * cool;
          return m + (air - m) * haze + rimc * rim;
        };
        cr += (mix(0, hr, 64, 120) - cr) * a;
        cg += (mix(1, hg, 66, 80) - cg) * a;
        cb += (mix(2, hb, 96, 40) - cb) * a;
      }
      const o = (y * w + x) * 4;
      data[o] = cr;
      data[o + 1] = cg;
      data[o + 2] = cb;
      data[o + 3] = 255 * side;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// --- Klippan: höjdfält med brus, belyst per pixel ---------------------------------------------------------

/**
 * Granithällar i H-enheter (u från högerkanten, v nedåt). pts är hällens överkant från vänster till höger,
 * cap hur djup den solbelysta ovansidan är och z hur nära betraktaren hällen ligger. Kanter som lutar nedåt
 * höger vetter mot solen och lyser; kanter som stiger åt höger hamnar i skugga.
 */
const BLOCKS = [
  // Hällen räddaren står på: en bred, nästan plan topp med en skarp axel åt vänster
  { z: 0.0, cap: 0.04, pts: [[-0.36, 0.67], [-0.315, 0.596], [-0.27, 0.566], [-0.225, 0.545], [-0.04, 0.537], [0.03, 0.548]] },
  // Lägre häll till vänster, bakom förgrundsblocket
  { z: 0.03, cap: 0.035, pts: [[-0.62, 0.71], [-0.56, 0.67], [-0.44, 0.645], [-0.37, 0.665], [-0.33, 0.69]] },
  // Förgrundsblocket: ett lutande flak som stupar ned åt höger
  { z: 0.08, cap: 0.07, pts: [[-0.47, 0.69], [-0.43, 0.63], [-0.36, 0.6], [-0.3, 0.596], [-0.2, 0.632], [0.03, 0.735]] },
  // Avsatser i förgrundsblockets framsida
  { z: 0.14, cap: 0.035, pts: [[-0.37, 0.705], [-0.33, 0.676], [-0.25, 0.672], [-0.17, 0.725]] },
  { z: 0.14, cap: 0.04, pts: [[-0.13, 0.745], [-0.08, 0.73], [0.03, 0.772]] },
  // Avsats på hällen räddaren står på, till höger under toppen
  { z: 0.035, cap: 0.03, pts: [[-0.12, 0.625], [-0.09, 0.602], [-0.02, 0.598], [0.03, 0.616]] },
  { z: 0.12, cap: 0.05, pts: [[-0.82, 0.8], [-0.75, 0.748], [-0.6, 0.718], [-0.45, 0.77]] },
  // Närmast, längst ned
  { z: 0.17, cap: 0.08, pts: [[-0.56, 0.9], [-0.47, 0.84], [-0.3, 0.82], [-0.13, 0.86], [0.03, 0.91]] },
];
const SLOPE = 1.2; // hur brant ovansidan stiger mot betraktaren

/** Överkantens höjd vid u; utanför ändpunkterna faller kanten brant så att hällen får rundade gavlar. */
function edgeAt(pts, u) {
  const n = pts.length;
  if (u <= pts[0][0]) return pts[0][1] + (pts[0][0] - u) * 3;
  if (u >= pts[n - 1][0]) return pts[n - 1][1] + (u - pts[n - 1][0]) * 3;
  for (let k = 1; k < n; k++) {
    if (u <= pts[k][0]) {
      // Raka kanter mellan punkterna, så att hällarna får brutna, kantiga konturer och inte mjuka kullar
      const [u0, v0] = pts[k - 1];
      const [u1, v1] = pts[k];
      const t = (u - u0) / (u1 - u0);
      const s = t * t * (3 - 2 * t);
      return v0 + (v1 - v0) * (t * 0.92 + s * 0.08);
    }
  }
  return pts[n - 1][1];
}

/** Brusvärde som går rakt mellan heltalspunkterna (inte mjukt), för kantiga konturer. 0–1. */
function chips(x, seed) {
  const xi = Math.floor(x);
  const t = x - xi;
  return hash(xi, seed) * (1 - t) + hash(xi + 1, seed) * t;
}

/**
 * Brottytor i graniten: ett voronoimönster där varje cell är en plan yta med egen lutning. Ger cellens lutning
 * (gx, gy), hur nära en gräns punkten ligger (border, 0 vid gränsen) och om gränsen är en öppen spricka.
 */
const facetOut = { gx: 0, gy: 0, border: 1, crack: 0, id: 0 };
function facet(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let d1 = 9;
  let d2 = 9;
  let c1 = 0;
  let c2 = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const px = cx + 0.15 + 0.7 * hash(cx * 7 + seed, cy * 13);
      const py = cy + 0.15 + 0.7 * hash(cx * 11, cy * 5 + seed);
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      const id = (cx * 92821 + cy * 68917 + seed) | 0;
      if (d < d1) {
        d2 = d1;
        c2 = c1;
        d1 = d;
        c1 = id;
      } else if (d < d2) {
        d2 = d;
        c2 = id;
      }
    }
  }
  const a = hash(c1, 3) * Math.PI * 2;
  const m = 0.35 + 0.75 * hash(c1, 17);
  facetOut.gx = Math.cos(a) * m;
  facetOut.gy = Math.sin(a) * m * 0.8 - 0.25; // fler ytor lutar uppåt, som avsatser
  facetOut.border = Math.sqrt(d2) - Math.sqrt(d1);
  // Ungefär var femte gräns är en öppen spricka, resten bara ett veck mellan två ytor
  facetOut.crack = hash(Math.min(c1, c2), Math.max(c1, c2)) < 0.22 ? 1 : 0;
  facetOut.id = c1;
  return facetOut;
}

function* rockLayer(w, h, H) {
  const canvas = offscreen(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const hf = new Float32Array(w * h);
  const hm = new Float32Array(w * h); // bara hällarnas form, för ljuset i stort
  const occl = new Float32Array(w * h);
  const albedo = new Float32Array(w * h);
  const alpha = new Float32Array(w * h);
  const fgx = new Float32Array(w * h); // brottytans lutning
  const fgy = new Float32Array(w * h);
  const crack = new Float32Array(w * h); // 1 mitt i en spricka
  const lichen = new Float32Array(w * h);
  const below = new Float32Array(w * h); // hur långt under hällens överkant punkten ligger, för den solbelysta kanten
  const top = new Int32Array(w).fill(h);
  const inv = 1 / H;
  const edge = 1.0 * inv; // kantens mjukhet, ungefär en pixel
  const edges = BLOCKS.map(() => new Float32Array(w));
  const caps = BLOCKS.map(() => new Float32Array(w));
  for (let x = 0; x < w; x++) {
    const u = (x - w) * inv;
    BLOCKS.forEach((b, k) => {
      // Taggig kontur: vassa krön längs kanten och lite finare brus
      // Kantig kontur: raka brottkanter mellan slumpade knäckpunkter i två storlekar, och lite finare brus
      // Under räddarens kängor är hällen jämnare, så att han får stå stadigt
      const calm = k === 0 ? 0.2 + 0.8 * smooth(0.035, 0.08, Math.abs(u - FEET_U)) : 1;
      const jag = ((chips(u * 28 + k * 7.3, k) - 0.5) * 0.016 + (chips(u * 90 + k * 3.1, k + 9) - 0.5) * 0.005) * calm
        + (fbm(u * 45 + k, k * 2.3, 3) - 0.5) * 0.003;
      edges[k][x] = edgeAt(b.pts, u) + jag;
      caps[k][x] = b.cap * (0.5 + fbm(u * 9 + k * 5.3, k, 3)); // ovansidans djup varierar längs hällen
    });
  }

  // Höjdfältet: närmaste häll som täcker pixeln vinner. Brus ger skrovlig yta.
  for (let y = 0; y < h; y++) {
    const v = y * inv;
    if (v < 0.47) continue;
    if (y % 8 === 0) yield;
    for (let x = 0; x < w; x++) {
      const u = (x - w) * inv;
      let best = -1;
      let cover = 0;
      let gap = 1;
      let depth = 0;
      for (let k = 0; k < BLOCKS.length; k++) {
        const b = BLOCKS[k];
        const d = v - edges[k][x];
        if (d < -edge) {
          if (b.z > best) gap = Math.min(gap, -d); // strax ovanför en närmare häll: skreva
          continue;
        }
        const cap = caps[k][x];
        // Ovansidan är ett plant, sluttande flak som bryts skarpt mot framsidan, inte en rundad kupol
        const r = Math.max(0, d) * SLOPE / cap;
        const hb = b.z + cap * (r < 0.85 ? r : 0.85 + 0.15 * (1 - Math.exp(-(r - 0.85) / 0.15)));
        if (hb > best) {
          best = hb;
          depth = Math.max(0, d);
        }
        cover = Math.max(cover, Math.min(1, (d + edge) / (2 * edge)));
      }
      if (cover <= 0) continue;
      const n1 = fbm(u * 8, v * 11, 4);
      const n2 = fbm(u * 40 + 7.1, v * 62 - 3.3, 3);
      // Skrovliga krön i graniten: vassa åsar fångar solen på ena sidan och skuggar den andra
      const crag = ridged(u * 13 + 1.3, v * 17 - 4.1, 3);
      const grain = ridged(u * 46 - 5.2, v * 58 + 2.9, 3); // grovkornig granit som gnistrar i motljuset
      const i = y * w + x;
      hf[i] = best + n1 * 0.014 + crag * 0.011 + grain * 0.0065 + n2 * 0.002 + noise(u * 180, v * 180) * 0.0012;
      hm[i] = best + n1 * 0.02;
      below[i] = depth;
      alpha[i] = cover;
      // Brottytor i två storlekar: stora plana flak och mindre avslag i dem. Cellerna är utdragna på bredden,
      // som skivorna i en granithäll.
      const big = facet(u * 15 + 40, v * 24, 3);
      let gx = big.gx;
      let gy = big.gy;
      // Sprickorna är olika breda längs sin längd
      const wid = 0.03 + 0.09 * fbm(u * 30 + 1.1, v * 30, 2);
      let cr = big.crack * (1 - smooth(0, wid, big.border));
      let fold = 1 - smooth(0, 0.035, big.border);
      const small = facet(u * 42 + 9, v * 60, 11);
      gx = gx * 0.75 + small.gx * 0.4;
      gy = gy * 0.75 + small.gy * 0.4;
      fold = Math.max(fold, 1 - smooth(0, 0.06, small.border));
      fgx[i] = gx;
      fgy[i] = gy;
      crack[i] = cr;
      lichen[i] = smooth(0.56, 0.7, fbm(u * 20 + 3.3, v * 26, 4)) * (1 - cr)
        * (0.5 + 0.5 * smooth(0.3, 0.6, noise(u * 160, v * 160)));
      // Skrevor ovanför närmare hällar, och framsidan som viker in under sig längre ned
      occl[i] = (0.25 + 0.75 * smooth(0, 0.03, gap)) * (0.35 + 0.65 * Math.exp(-depth / 0.09)) * (1 - cr * 0.85)
        * (1 - fold * 0.25);
      albedo[i] = n2 * 0.35 + grain * 0.35 + noise(u * 300, v * 300) * 0.3;
    }
  }

  for (let y = 0; y < h; y++) {
    if (y % 16 === 0) yield;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = alpha[i];
      if (a <= 0) continue;
      if (y < top[x] && a > 0.5) top[x] = y;
      // Normal ur höjdfältets lutning; grannar utanför klippan räknas som pixeln själv
      const hc = hf[i];
      const hl = x > 0 && alpha[i - 1] > 0 ? hf[i - 1] : hc;
      const hr = x < w - 1 && alpha[i + 1] > 0 ? hf[i + 1] : hc;
      const hu = y > 0 && alpha[i - w] > 0 ? hf[i - w] : hc - 0.002;
      const hd = y < h - 1 && alpha[i + w] > 0 ? hf[i + w] : hc;
      // Brottytans lutning läggs på höjdfältets, så att varje flak blir en plan yta som antingen fångar solen
      // eller ligger i skugga
      let nx = -(hr - hl) * H * 0.5 * 0.9 - fgx[i] * 0.9;
      let ny = -(hd - hu) * H * 0.5 * 0.9 - fgy[i] * 0.9;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const v = y * inv;
      const u = (x - w) * inv;
      // Formen i stort avgör var solen når; detaljerna bara varierar ljuset inom det
      const ml = x > 2 && alpha[i - 3] > 0 ? hm[i - 3] : hm[i];
      const mr = x < w - 3 && alpha[i + 3] > 0 ? hm[i + 3] : hm[i];
      const mu = y > 2 && alpha[i - 3 * w] > 0 ? hm[i - 3 * w] : hm[i] - 0.004;
      const md = y < h - 3 && alpha[i + 3 * w] > 0 ? hm[i + 3 * w] : hm[i];
      const mx = -(mr - ml) * H / 6 - fgx[i] * 0.9;
      const my = -(md - mu) * H / 6 - fgy[i] * 0.9;
      const ll = Math.hypot(mx, my, 1);
      const macro = smooth(0.05, 0.35, (mx * SUN[0] + my * SUN[1] + SUN[2]) / ll);
      const sun = Math.pow(Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]), 1.2) * macro;
      const glint = Math.pow(sun, 4);
      const sky = Math.max(0, 0.25 + 0.75 * -ny);
      const front = Math.max(0, nz) * 0.4 + 0.2;
      const ao = occl[i];
      // Granit: mörk gråbrun med ljusa korn, och lavfläckar i blekt grågrönt och ockra
      const al = albedo[i];
      let ar = 0.05 + al * 0.07;
      let ag = 0.054 + al * 0.068;
      let ab = 0.064 + al * 0.074;
      if (al > 0.7) {
        ar += 0.08;
        ag += 0.05;
        ab += 0.01;
      }
      // Granitens korn: ljusa kvarts- och fältspatkorn och mörka glimmerfläckar, salt och peppar över hela ytan
      const spk = noise(u * 520 + 3.7, v * 520 - 1.9);
      if (spk > 0.7) {
        ar += 0.05 * (spk - 0.7) / 0.3;
        ag += 0.045 * (spk - 0.7) / 0.3;
        ab += 0.04 * (spk - 0.7) / 0.3;
      } else if (spk < 0.28) {
        ar *= 0.55;
        ag *= 0.55;
        ab *= 0.6;
      }
      const lc = lichen[i];
      ar += lc * 0.16;
      ag += lc * 0.15;
      ab += lc * 0.09;
      // Djupare skugga längre ned mot förgrunden
      const fall = Math.max(0.26, 1.0 - (v - 0.55) * 1.6);
      // Solbelysta flak lyser jämnt, med kornen som lätt gnistrar; sprickorna förblir svarta
      // Kornen i två storlekar gör den belysta ytan gnistrig i stället för jämnt slät
      const fine = noise(u * 170 - 4.4, v * 170 + 8.2) * 0.5 + spk * 0.5;
      const speck = (0.3 + 1.2 * smooth(0.3, 0.85, al)) * (0.35 + 1.3 * smooth(0.35, 0.75, fine));
      // Hällarnas överkanter är avrundade och fångar den låga solen i strykande vinkel: en varm, kornig list
      // längs varje krön, bruten där kanten vänder sig bort
      const lip = Math.exp(-below[i] / 0.0028) * smooth(0.3, 0.62, noise(u * 90 + 2.1, v * 30))
        * (0.4 + 0.6 * smooth(0.25, 0.75, spk));
      const hot = (sun * 3.8 + glint * 8 + lip * 2.2) * Math.min(1, ao * 1.3) * speck;
      const lr = hot * 1.0 + (sky * 0.06 + front * 0.055) * ao;
      const lg = hot * 0.36 + (sky * 0.08 + front * 0.06) * ao;
      const lb = hot * 0.1 + (sky * 0.22 + front * 0.1) * ao;
      const o = i * 4;
      data[o] = tone(ar * lr * fall);
      data[o + 1] = tone(ag * lg * fall);
      data[o + 2] = tone(ab * lb * fall);
      data[o + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Mörkare nedtill så att knapparna och förgrunden smälter ihop
  ctx.globalCompositeOperation = 'source-atop';
  const fade = ctx.createLinearGradient(0, 0.62 * H, 0, h);
  fade.addColorStop(0, 'rgba(6,6,12,0)');
  fade.addColorStop(1, 'rgba(6,6,12,0.55)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  return {
    canvas,
    /** Klippans överkant vid x: den lägsta punkten (största y) inom ±r pixlar. */
    topAt: (x, r = 3) => {
      let best = 0;
      for (let dx = -r; dx <= r; dx++) best = Math.max(best, top[Math.max(0, Math.min(w - 1, x + dx))]);
      return best;
    },
  };
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function tone(x) {
  const y = x / (1 + x * 0.35);
  return Math.max(0, Math.min(255, Math.pow(y, 1 / 2.2) * 255));
}

// --- Hjälpfunktioner --------------------------------------------------------------------------------------

// OffscreenCanvas när den finns, så att samma kod kan måla i rescuer-worker.js där det inte finns något document
function offscreen(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

function hash(x, y) {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function noise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function ridged(x, y, oct) {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    const n = 1 - Math.abs(noise(x, y) * 2 - 1);
    s += n * n * amp;
    norm += amp;
    x = x * 2.1 - 0.7;
    y = y * 2.1 + 2.3;
    amp *= 0.5;
  }
  return s / norm;
}

function fbm(x, y, oct) {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    s += noise(x, y) * amp;
    norm += amp;
    x = x * 2.03 + 1.7;
    y = y * 2.03 - 3.1;
    amp *= 0.5;
  }
  return s / norm;
}
