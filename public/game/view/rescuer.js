// Fjällräddaren som figur: räddaren i röd overall med hjälm och ryggsäck, sedd bakifrån, som står på en
// granitklippa i kvällsljus. Ritas en gång per storlek (ingen kostnad per bildruta), med solen lågt
// bakom till höger: kanterna får varmt motljus och klippans framsidor ligger i kall skugga.
// Används på resultatskärmen och i Fjällräddaren-menyn.

const SUN = norm3(0.66, -0.6, -0.22); // x höger, y nedåt, z mot betraktaren: solen står lågt bakom till höger

/**
 * Ritar figuren på en canvas och ritar om när storleken ändras (även när skärmen visas efter att ha varit dold).
 * @param {HTMLCanvasElement|null} canvas
 */
export function mountRescuerScene(canvas) {
  if (!canvas) return;
  let key = '';
  const paint = () => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (`${w}x${h}` === key) return;
    key = `${w}x${h}`;
    canvas.width = w;
    canvas.height = h;
    paintRescuerScene(canvas.getContext('2d'), w, h);
  };
  new ResizeObserver(paint).observe(canvas);
}

/**
 * Hela motivet: klippan i förgrunden och räddaren på dess topp. Allt mäts i canvasens höjd (H) från högerkanten,
 * så att figuren hamnar på samma plats på skärmen oavsett bildformat.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w, h  canvasens storlek i pixlar
 */
export function paintRescuerScene(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  const H = h;
  const feetU = -0.148; // fötternas mitt, i H från högerkanten
  const feetX = w + feetU * H;
  const rock = rockLayer(w, h, H);
  const feetY = rock.topAt(Math.round(feetX)) + 0.004 * H;

  // Varmt kvällsdis runt klippans topp, där solen står lågt bakom räddaren
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const glow = ctx.createRadialGradient(w - 0.06 * H, 0.47 * H, 0, w - 0.06 * H, 0.47 * H, 0.55 * H);
  glow.addColorStop(0, 'rgba(255,170,96,0.34)');
  glow.addColorStop(0.35, 'rgba(240,120,70,0.14)');
  glow.addColorStop(1, 'rgba(200,90,70,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  ctx.drawImage(rock.canvas, 0, 0);

  // Räddarens skugga faller mot betraktaren och åt vänster, bort från solen
  const figH = 0.245 * H;
  ctx.save();
  ctx.filter = `blur(${Math.max(1, figH * 0.02)}px)`;
  ctx.fillStyle = 'rgba(8,6,10,0.55)';
  ctx.beginPath();
  ctx.ellipse(feetX - figH * 0.08, feetY + figH * 0.012, figH * 0.2, figH * 0.028, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(4,3,6,0.7)';
  ctx.beginPath();
  ctx.ellipse(feetX, feetY, figH * 0.13, figH * 0.016, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawRescuer(ctx, feetX, feetY, figH);
}

/**
 * Räddaren bakifrån: röd overall med mörka knä- och axelpartier, svart ryggsäck, hjälm och handskar.
 * Motljus från höger. Ritas i ett lager för sig så att kantljuset kan läggas på hela siluetten.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x, y   mitt mellan fötterna, på marken
 * @param {number} size   figurens höjd i pixlar
 */
export function drawRescuer(ctx, x, y, size) {
  const pad = Math.ceil(size * 0.35);
  const lw = Math.ceil(size * 0.5 + pad * 2);
  const lh = Math.ceil(size + pad * 2);
  const layer = offscreen(lw, lh);
  const c = layer.getContext('2d');
  c.translate(lw / 2, lh - pad);
  c.scale(size, size);
  figure(c);

  // Motljus: siluetten minus en förskjuten kopia ger en skära längs högra och övre kanten
  const rim = offscreen(lw, lh);
  const r = rim.getContext('2d');
  const d = Math.max(1.2, size * 0.011);
  r.drawImage(layer, 0, 0);
  r.globalCompositeOperation = 'source-in';
  r.fillStyle = '#ffb36b';
  r.fillRect(0, 0, lw, lh);
  r.globalCompositeOperation = 'destination-out';
  r.drawImage(layer, -d, d * 0.8);
  r.globalCompositeOperation = 'source-over';

  const glow = offscreen(lw, lh);
  const g = glow.getContext('2d');
  g.filter = `blur(${d * 1.6}px)`;
  g.drawImage(rim, 0, 0);

  const ox = x - lw / 2;
  const oy = y - (lh - pad);
  ctx.drawImage(layer, ox, oy);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.28;
  ctx.drawImage(glow, ox, oy);
  ctx.globalAlpha = 0.85;
  ctx.drawImage(rim, ox, oy);
  ctx.restore();
}

// --- Figuren, i enheter av figurens höjd: fötterna i y = 0, hjälmens topp i y = -1 ---------------------

const RED = { dark: '#30080c', mid: '#6a1117', lit: '#8f191c', hot: '#cc4a30' };
const BLACK = { dark: '#07080b', mid: '#15161b', lit: '#2a2a30', hot: '#7a5644' };
const PANTS = { dark: '#20060a', mid: '#4a0c12', lit: '#681317', hot: '#b03c2a' };
const GREY = { dark: '#101115', mid: '#202127', lit: '#38383e', hot: '#8a6650' };

/** Fyllning som går från skugga till vänster till solsidan till höger. */
function side(c, pal, x0, x1, y0 = 0, y1 = 0) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, pal.dark);
  g.addColorStop(0.35, pal.mid);
  g.addColorStop(0.82, pal.lit);
  g.addColorStop(1, pal.hot);
  return g;
}

function shape(c, pts, fill) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.length === 2) c.lineTo(p[0], p[1]);
    else if (p.length === 4) c.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else c.bezierCurveTo(p[0], p[1], p[2], p[3], p[4], p[5]);
  }
  c.closePath();
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
}

/** Mjuk skugga eller ljus inuti senast ritade form (clip), t.ex. veck och skuggan under ryggsäcken. */
function inside(c, pts, paint) {
  c.save();
  shape(c, pts);
  c.clip();
  paint();
  c.restore();
}

function blob(c, x, y, rx, ry, color, rot = 0) {
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  c.fill();
}

function stroke(c, color, width, pts) {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.length === 2) c.lineTo(p[0], p[1]);
    else c.quadraticCurveTo(p[0], p[1], p[2], p[3]);
  }
  c.stroke();
}

/** En lem som tjock linje genom leder, med fyllning från skuggsidan till solsidan. */
function limb(c, pts, width, pal, x0, x1, cap = 'round') {
  c.strokeStyle = side(c, pal, x0, x1);
  c.lineWidth = width;
  c.lineCap = cap;
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.stroke();
}

function figure(c) {
  // Benen i lätt bredbent ställning, vikten på höger ben. Lår och vader som tjocka linjer.
  const legs = [
    { hip: [-0.05, -0.5], knee: [-0.066, -0.285], ankle: [-0.092, -0.08], x0: -0.13, x1: -0.02 },
    { hip: [0.05, -0.5], knee: [0.06, -0.285], ankle: [0.078, -0.08], x0: 0.01, x1: 0.12 },
  ];
  for (const l of legs) {
    limb(c, [l.hip, l.knee], 0.094, PANTS, l.x0, l.x1);
    limb(c, [l.knee, l.ankle], 0.076, PANTS, l.x0, l.x1);
    // Mörkt knäparti och veck bakom knät
    limb(c, [[l.knee[0], l.knee[1] - 0.03], [l.knee[0] + 0.002, l.knee[1] + 0.03]], 0.08, BLACK, l.x0, l.x1, 'butt');
    stroke(c, 'rgba(25,0,0,0.5)', 0.006, [[l.knee[0] - 0.03, l.knee[1] + 0.07], [l.knee[0], l.knee[1] + 0.08,
      l.knee[0] + 0.032, l.knee[1] + 0.068]]);
    // Kängan
    const [ax, ay] = l.ankle;
    shape(c, [[ax - 0.04, ay - 0.025], [ax - 0.046, ay + 0.04, ax - 0.048, ay + 0.07], [ax + 0.046, ay + 0.078],
      [ax + 0.046, ay + 0.03, ax + 0.038, ay - 0.025]], side(c, BLACK, l.x0, l.x1));
    c.fillStyle = '#060608';
    c.fillRect(ax - 0.05, ay + 0.064, 0.098, 0.016);
    stroke(c, 'rgba(120,90,70,0.5)', 0.006, [[ax - 0.04, ay - 0.018], [ax + 0.038, ay - 0.018]]);
  }

  // Jackan
  const torso = [[-0.11, -0.8], [-0.126, -0.73, -0.112, -0.66], [-0.098, -0.58, -0.102, -0.48], [0, -0.465, 0.104, -0.48],
    [0.1, -0.58, 0.116, -0.66], [0.13, -0.73, 0.112, -0.8], [0.07, -0.85, 0, -0.858], [-0.07, -0.85, -0.11, -0.8]];
  shape(c, torso, side(c, RED, -0.13, 0.13));
  inside(c, torso, () => {
    // Mörkt axelparti och midjebälte
    shape(c, [[-0.2, -0.88], [0.2, -0.88], [0.2, -0.775], [0.08, -0.76, 0, -0.758], [-0.08, -0.76, -0.2, -0.775]],
      side(c, GREY, -0.13, 0.13));
    c.fillStyle = side(c, GREY, -0.13, 0.13);
    c.fillRect(-0.2, -0.552, 0.4, 0.026);
    // Skuggan under ryggsäcken
    const g = c.createLinearGradient(0, -0.6, 0, -0.5);
    g.addColorStop(0, 'rgba(15,0,0,0.6)');
    g.addColorStop(1, 'rgba(15,0,0,0)');
    c.fillStyle = g;
    c.fillRect(-0.2, -0.6, 0.4, 0.1);
  });

  // Armarna, lätt ut från kroppen, den högra något böjd
  const arms = [
    { pts: [[-0.104, -0.785], [-0.136, -0.66], [-0.148, -0.55]], x0: -0.17, x1: -0.11 },
    { pts: [[0.106, -0.785], [0.14, -0.665], [0.156, -0.56]], x0: 0.1, x1: 0.18 },
  ];
  for (const a of arms) {
    limb(c, [a.pts[0], a.pts[1]], 0.066, RED, a.x0, a.x1);
    limb(c, [a.pts[1], a.pts[2]], 0.056, RED, a.x0, a.x1);
    limb(c, [a.pts[0], [a.pts[0][0] + (a.pts[1][0] - a.pts[0][0]) * 0.2, -0.765]], 0.062, BLACK, a.x0, a.x1);
    // Reflexband och veck i armbågen
    const [ex, ey] = a.pts[1];
    stroke(c, 'rgba(190,186,186,0.4)', 0.009, [[ex - 0.026, ey - 0.03], [ex + 0.024, ey - 0.035]]);
    stroke(c, 'rgba(25,0,0,0.5)', 0.005, [[ex - 0.022, ey + 0.01], [ex, ey + 0.018, ex + 0.022, ey + 0.006]]);
    // Handsken
    const [wx, wy] = a.pts[2];
    blob(c, wx, wy + 0.03, 0.026, 0.038, side(c, BLACK, a.x0, a.x1));
    stroke(c, '#2d2e35', 0.012, [[wx - 0.024, wy], [wx + 0.024, wy]]);
  }

  // Axelremmarna, och ryggsäcken: stor, något till höger och med toppen över axellinjen
  stroke(c, '#141519', 0.024, [[-0.03, -0.85], [-0.07, -0.85, -0.09, -0.8]]);
  stroke(c, '#141519', 0.024, [[0.08, -0.85], [0.108, -0.85, 0.116, -0.8]]);
  c.save();
  c.translate(0.05, -0.73);
  c.scale(0.82, 1);
  c.translate(-0.03, 0.73);
  const pack = [[-0.07, -0.84], [-0.074, -0.885, -0.03, -0.9], [0.08, -0.9], [0.122, -0.89, 0.126, -0.845],
    [0.134, -0.64], [0.132, -0.585, 0.1, -0.575], [-0.05, -0.572], [-0.084, -0.58, -0.086, -0.63]];
  shape(c, pack, side(c, BLACK, -0.09, 0.14));
  inside(c, pack, () => {
    // Locket
    shape(c, [[-0.2, -0.95], [0.2, -0.95], [0.2, -0.83], [0.05, -0.82, -0.2, -0.827]], side(c, BLACK, -0.09, 0.14));
    stroke(c, 'rgba(0,0,0,0.6)', 0.006, [[-0.1, -0.826], [0.05, -0.818, 0.14, -0.828]]);
    // Framficka med dragkedja
    shape(c, [[-0.05, -0.76], [0.096, -0.762], [0.104, -0.62], [0.07, -0.6, 0.02, -0.598], [-0.03, -0.6, -0.056, -0.62]],
      side(c, BLACK, -0.06, 0.11));
    stroke(c, 'rgba(0,0,0,0.7)', 0.005, [[-0.05, -0.76], [0.096, -0.762]]);
    stroke(c, 'rgba(160,160,170,0.35)', 0.0035, [[-0.04, -0.75], [0.088, -0.752]]);
    // Kompressionsremmar med spännen
    for (const yy of [-0.725, -0.66]) {
      stroke(c, '#0a0a0d', 0.011, [[-0.1, yy], [0.14, yy + 0.004]]);
      c.fillStyle = '#5a5a62';
      c.fillRect(0.074, yy - 0.008, 0.016, 0.016);
    }
    // Röd märkflik och reflexlogga
    c.fillStyle = '#a8231c';
    c.fillRect(0.0, -0.835, 0.03, 0.02);
    c.fillStyle = 'rgba(220,220,225,0.5)';
    c.fillRect(-0.036, -0.69, 0.05, 0.008);
    // Sidoficka på solsidan
    shape(c, [[0.108, -0.75], [0.136, -0.75], [0.14, -0.62], [0.112, -0.616]], side(c, GREY, 0.1, 0.14));
    // Ambient skugga nertill, solljus på lockets ovansida
    const g = c.createLinearGradient(0, -0.64, 0, -0.57);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.fillStyle = g;
    c.fillRect(-0.2, -0.64, 0.4, 0.08);
    blob(c, 0.07, -0.895, 0.06, 0.012, 'rgba(255,170,110,0.22)');
  });
  c.restore();
  // Höftbälte från säcken runt midjan
  stroke(c, '#121317', 0.018, [[-0.07, -0.585], [-0.1, -0.58, -0.112, -0.56]]);
  stroke(c, '#121317', 0.018, [[0.11, -0.585], [0.13, -0.58, 0.116, -0.56]]);

  // Kragen och hjälmen; huvudet är lite vridet åt vänster mot dalen
  shape(c, [[-0.044, -0.85], [-0.048, -0.87, -0.036, -0.882], [0.034, -0.884], [0.048, -0.87, 0.046, -0.85],
    [0, -0.842]], side(c, RED, -0.05, 0.05));
  c.save();
  c.translate(-0.008, 0);
  const helmet = [[-0.056, -0.9], [-0.066, -0.952, -0.044, -0.99], [0.0, -1.004, 0.04, -0.99], [0.064, -0.956, 0.054, -0.9],
    [0.03, -0.872, -0.01, -0.87], [-0.04, -0.872, -0.056, -0.9]];
  shape(c, helmet, side(c, { dark: '#120a0c', mid: '#3a0d12', lit: '#7a1a1c', hot: '#d0603e' }, -0.07, 0.07, -0.9, -0.99));
  inside(c, helmet, () => {
    stroke(c, 'rgba(0,0,0,0.45)', 0.006, [[-0.018, -0.998], [-0.028, -0.95, -0.023, -0.91]]);
    stroke(c, 'rgba(0,0,0,0.45)', 0.006, [[0.02, -0.998], [0.03, -0.95, 0.028, -0.91]]);
    stroke(c, 'rgba(0,0,0,0.55)', 0.008, [[-0.06, -0.905], [0, -0.89, 0.06, -0.905]]); // hjälmkanten
    stroke(c, '#1c1d22', 0.012, [[-0.07, -0.944], [0, -0.932, 0.07, -0.944]]); // glasögonbandet
    stroke(c, 'rgba(255,190,120,0.25)', 0.003, [[-0.07, -0.951], [0, -0.939, 0.07, -0.951]]);
    blob(c, 0.028, -0.982, 0.024, 0.011, 'rgba(255,200,150,0.4)', -0.5);
  });
  // Skymten av glasögonen på vänster sida, där huvudet är vridet
  shape(c, [[-0.064, -0.95], [-0.078, -0.94, -0.074, -0.918], [-0.058, -0.916]], '#33414e');
  c.restore();

  // Ljuset i stort: mörkare nedåt mot kängorna, varmt ljus på axlarna från den låga solen
  c.save();
  c.globalCompositeOperation = 'source-atop';
  const fall = c.createLinearGradient(0, -0.55, 0, 0);
  fall.addColorStop(0, 'rgba(10,0,4,0)');
  fall.addColorStop(1, 'rgba(10,0,4,0.42)');
  c.fillStyle = fall;
  c.fillRect(-0.3, -0.55, 0.6, 0.6);
  const warm = c.createRadialGradient(0.1, -0.86, 0, 0.1, -0.86, 0.2);
  warm.addColorStop(0, 'rgba(255,150,90,0.22)');
  warm.addColorStop(1, 'rgba(255,150,90,0)');
  c.fillStyle = warm;
  c.fillRect(-0.3, -1.1, 0.6, 0.6);
  c.restore();
}

// --- Klippan: höjdfält med brus, belyst per pixel ---------------------------------------------------------

/**
 * Granithällar i H-enheter (u från högerkanten, v nedåt). pts är hällens överkant från vänster till höger,
 * cap hur djup den solbelysta ovansidan är och z hur nära betraktaren hällen ligger. Kanter som lutar nedåt
 * höger vetter mot solen och lyser; kanter som stiger åt höger hamnar i skugga.
 */
const BLOCKS = [
  // Hällen räddaren står på: bred och nästan plan överst
  { z: 0.0, cap: 0.028, pts: [[-0.36, 0.66], [-0.3, 0.6], [-0.26, 0.568], [-0.21, 0.546], [-0.16, 0.538], [-0.1, 0.536],
    [-0.05, 0.54], [0.0, 0.544], [0.03, 0.55]] },
  // Lägre häll till vänster, bakom förgrundsblocket
  { z: 0.03, cap: 0.03, pts: [[-0.62, 0.71], [-0.55, 0.675], [-0.48, 0.655], [-0.42, 0.648], [-0.37, 0.66], [-0.33, 0.69]] },
  // Förgrundsblocket med sin solbelysta, sluttande rygg
  { z: 0.08, cap: 0.055, pts: [[-0.46, 0.68], [-0.4, 0.628], [-0.34, 0.604], [-0.28, 0.598], [-0.23, 0.608],
    [-0.18, 0.628], [-0.11, 0.66], [-0.05, 0.69], [0.0, 0.715], [0.03, 0.73]] },
  // Avsatser i förgrundsblockets framsida
  { z: 0.14, cap: 0.03, pts: [[-0.36, 0.7], [-0.3, 0.672], [-0.24, 0.676], [-0.2, 0.69], [-0.16, 0.72]] },
  { z: 0.14, cap: 0.035, pts: [[-0.12, 0.74], [-0.07, 0.732], [-0.02, 0.75], [0.03, 0.77]] },
  // Avsats på hällen räddaren står på, till höger under toppen
  { z: 0.035, cap: 0.025, pts: [[-0.12, 0.62], [-0.08, 0.6], [-0.03, 0.598], [0.01, 0.61], [0.03, 0.62]] },
  { z: 0.12, cap: 0.05, pts: [[-0.82, 0.8], [-0.74, 0.75], [-0.66, 0.725], [-0.58, 0.72], [-0.51, 0.735], [-0.45, 0.77]] },
  // Närmast, längst ned
  { z: 0.17, cap: 0.06, pts: [[-0.56, 0.9], [-0.46, 0.84], [-0.36, 0.82], [-0.24, 0.83], [-0.12, 0.865], [0.0, 0.9],
    [0.03, 0.91]] },
];
const SLOPE = 1.5; // hur brant ovansidan stiger mot betraktaren

/** Överkantens höjd vid u; utanför ändpunkterna faller kanten brant så att hällen får rundade gavlar. */
function edgeAt(pts, u) {
  const n = pts.length;
  if (u <= pts[0][0]) return pts[0][1] + (pts[0][0] - u) * 3;
  if (u >= pts[n - 1][0]) return pts[n - 1][1] + (u - pts[n - 1][0]) * 3;
  for (let k = 1; k < n; k++) {
    if (u <= pts[k][0]) {
      const [u0, v0] = pts[k - 1];
      const [u1, v1] = pts[k];
      const t = (u - u0) / (u1 - u0);
      const s = t * t * (3 - 2 * t);
      return v0 + (v1 - v0) * (t * 0.4 + s * 0.6);
    }
  }
  return pts[n - 1][1];
}

function rockLayer(w, h, H) {
  const canvas = offscreen(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const hf = new Float32Array(w * h);
  const hm = new Float32Array(w * h); // bara hällarnas form, för ljuset i stort
  const occl = new Float32Array(w * h);
  const albedo = new Float32Array(w * h);
  const alpha = new Float32Array(w * h);
  const top = new Int32Array(w).fill(h);
  const inv = 1 / H;
  const edge = 1.0 * inv; // kantens mjukhet, ungefär en pixel
  const edges = BLOCKS.map(() => new Float32Array(w));
  const caps = BLOCKS.map(() => new Float32Array(w));
  for (let x = 0; x < w; x++) {
    const u = (x - w) * inv;
    BLOCKS.forEach((b, k) => {
      // Taggig kontur: vassa krön längs kanten och lite finare brus
      const jag = (ridged(u * 11 + k * 3.1, k * 1.7, 3) - 0.35) * -0.022 + (fbm(u * 45 + k, k * 2.3, 3) - 0.5) * 0.004;
      edges[k][x] = edgeAt(b.pts, u) + jag;
      caps[k][x] = b.cap * (0.5 + fbm(u * 9 + k * 5.3, k, 3)); // ovansidans djup varierar längs hällen
    });
  }

  // Höjdfältet: närmaste häll som täcker pixeln vinner. Brus ger skrovlig yta.
  for (let y = 0; y < h; y++) {
    const v = y * inv;
    if (v < 0.47) continue;
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
        const hb = b.z + cap * (1 - Math.exp((-Math.max(0, d) * SLOPE) / cap));
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
      hf[i] = best + n1 * 0.03 + crag * 0.01 + grain * 0.0045 + n2 * 0.002 + noise(u * 180, v * 180) * 0.0012;
      hm[i] = best + n1 * 0.045;
      alpha[i] = cover;
      // Skrevor ovanför närmare hällar, och framsidan som viker in under sig längre ned
      occl[i] = (0.25 + 0.75 * smooth(0, 0.03, gap)) * (0.35 + 0.65 * Math.exp(-depth / 0.09));
      albedo[i] = n2 * 0.35 + grain * 0.35 + noise(u * 300, v * 300) * 0.3;
    }
  }

  for (let y = 0; y < h; y++) {
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
      let nx = -(hr - hl) * H * 0.5 * 1.3;
      let ny = -(hd - hu) * H * 0.5 * 1.3;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const v = y * inv;
      // Formen i stort avgör var solen når; detaljerna bara varierar ljuset inom det
      const ml = x > 2 && alpha[i - 3] > 0 ? hm[i - 3] : hm[i];
      const mr = x < w - 3 && alpha[i + 3] > 0 ? hm[i + 3] : hm[i];
      const mu = y > 2 && alpha[i - 3 * w] > 0 ? hm[i - 3 * w] : hm[i] - 0.004;
      const md = y < h - 3 && alpha[i + 3 * w] > 0 ? hm[i + 3 * w] : hm[i];
      let mx = -(mr - ml) * H / 6;
      let my = -(md - mu) * H / 6;
      const ll = Math.hypot(mx, my, 1);
      const macro = smooth(-0.1, 0.35, (mx * SUN[0] + my * SUN[1] + SUN[2]) / ll);
      const sun = Math.pow(Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]), 1.5) * (0.2 + 0.8 * macro);
      const glint = Math.pow(sun, 3);
      const sky = Math.max(0, 0.3 + 0.7 * -ny);
      const front = Math.max(0, nz) * 0.5 + 0.3;
      const ao = occl[i];
      // Granit: mörk gråbrun med ljusa korn och lav i ockra
      const al = albedo[i];
      let ar = 0.062 + al * 0.085;
      let ag = 0.062 + al * 0.08;
      let ab = 0.066 + al * 0.082;
      if (al > 0.68) {
        ar += 0.09;
        ag += 0.055;
        ab += 0.012;
      }
      // Djupare skugga längre ned mot förgrunden
      const fall = Math.max(0.3, 1.05 - (v - 0.55) * 1.4);
      // Ljuset bryts upp i fläckar av kornen och lavarna, som på skrovlig granit
      const speck = 0.25 + 1.35 * smooth(0.3, 0.85, al);
      const hot = (sun * 6.5 + glint * 9) * Math.min(1, ao * 1.3) * speck;
      const lr = hot * 1.0 + (sky * 0.06 + front * 0.05) * ao;
      const lg = hot * 0.42 + (sky * 0.08 + front * 0.045) * ao;
      const lb = hot * 0.13 + (sky * 0.17 + front * 0.07) * ao;
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
    topAt: (x) => {
      let best = h;
      for (let dx = -3; dx <= 3; dx++) best = Math.min(best, top[Math.max(0, Math.min(w - 1, x + dx))]);
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

function offscreen(w, h) {
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
