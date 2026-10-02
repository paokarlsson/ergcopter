// Fjällräddaren som 3D-figur: räddaren byggs av mjuka former (avståndsfält) och strålföljs en gång per storlek,
// så att ljuset blir som i scenen. Solen står lågt till höger, nästan från sidan: sidorna mot solen lyser varmt,
// ryggen mot betraktaren ligger i dov, kall skugga och kanterna mot solen får ett tunt, hett motljus.
// Ren beräkning utan DOM, så att den kan köras i rescuer-worker.js. Ritas in på klippan av view/rescuer.js.

// Figurens egna enheter: fötterna i y = 0, hjälmens topp i y ≈ 1, x åt höger, z mot betraktaren.
// Figuren tittar bort från kameran (mot −z), lite vriden åt höger mot solen.
const BODY_YAW = -0.5; // kroppen vriden lite åt vänster, så att säcken hamnar till höger och jackans vänstra sida syns
const HEAD_YAW = 1.15; // utöver kroppen: huvudet vridet mot solen så att glasögonen syns i profil

const SUN = norm(0.94, 0.28, -0.12); // mot solen: lågt till höger, nästan rakt från sidan och en aning bakom
const SUN_FLAT = norm(0.7, 0.42, 0); // solens riktning i bildplanet, för motljuset längs konturen
const SUN_COL = [4.2, 1.95, 0.75];
const SKY_COL = [0.13, 0.075, 0.07]; // kvällshimlen ovanifrån
const FILL_COL = [0.042, 0.036, 0.072]; // den kalla östhimlen bakom betraktaren
const BOUNCE_COL = [0.1, 0.055, 0.035]; // klippan under

// Material
const SUIT = 1;
const DARK = 2;
const PACK = 3;
const HELMET = 4;
const LENS = 5;
const SKIN = 6;
const STRAP = 7;
const SOLE = 9;

const ALBEDO = {
  [SUIT]: [0.38, 0.014, 0.03],
  [DARK]: [0.028, 0.028, 0.032],
  [PACK]: [0.014, 0.022, 0.05],
  [HELMET]: [0.035, 0.034, 0.04], // mörk lackad klätterhjälm
  [LENS]: [0.03, 0.02, 0.012],
  [SKIN]: [0.32, 0.16, 0.11],
  [STRAP]: [0.012, 0.014, 0.022],
  [SOLE]: [0.09, 0.075, 0.06],
};
// Tygets glans i motljuset: varmt och nästan oberoende av färgen, så att kanten blir orange och inte bara ljusröd
const SHEEN = [1, 0.72, 0.42];
const GLOSS = { [HELMET]: 1.6, [LENS]: 2.6, [PACK]: 0.25, [DARK]: 0.2 };
// Hur mycket ytan speglar himlen (skaljackans nylon, hjälmens lack), och himlens färg i speglingen
const SHINE = { [SUIT]: 0.45, [HELMET]: 0.6, [LENS]: 1.2, [PACK]: 0.1, [DARK]: 0.12, [STRAP]: 0.06 };
const ENV_COL = [0.4, 0.24, 0.24];
const COOL_COL = [0.16, 0.17, 0.3];

// --- Formerna ---------------------------------------------------------------------------------------------

/** Avsmalnande kapsel mellan två punkter (Inigo Quilez' round cone), med förberäknade konstanter. */
function cone(a, b, r1, r2) {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  return { ax: a[0], ay: a[1], az: a[2], bax, bay, baz, l2, rr, a2: l2 - rr * rr, il2: 1 / l2, r1, r2 };
}

function sdCone(c, px, py, pz) {
  const pax = px - c.ax;
  const pay = py - c.ay;
  const paz = pz - c.az;
  const y = pax * c.bax + pay * c.bay + paz * c.baz;
  const z = y - c.l2;
  const qx = pax * c.l2 - c.bax * y;
  const qy = pay * c.l2 - c.bay * y;
  const qz = paz * c.l2 - c.baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * c.l2;
  const z2 = z * z * c.l2;
  const k = Math.sign(c.rr) * c.rr * c.rr * x2;
  if (Math.sign(z) * c.a2 * z2 > k) return Math.sqrt(x2 + z2) * c.il2 - c.r2;
  if (Math.sign(y) * c.a2 * y2 < k) return Math.sqrt(x2 + y2) * c.il2 - c.r1;
  return (Math.sqrt(x2 * c.a2 * c.il2) + y * c.rr) * c.il2 - c.r1;
}

function sdEllipsoid(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const x = px - cx;
  const y = py - cy;
  const z = pz - cz;
  const k0 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
  const k1 = Math.sqrt((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2 + (z / (rz * rz)) ** 2);
  return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}

function sdBox(px, py, pz, cx, cy, cz, hx, hy, hz, r) {
  const qx = Math.abs(px - cx) - hx + r;
  const qy = Math.abs(py - cy) - hy + r;
  const qz = Math.abs(pz - cz) - hz + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// Leder, i kroppens koordinater (före vridningen). Kontrapost: höger ben bär vikten rakt under kroppen och
// höften på den sidan står högt. Vänster ben är avlastat, steget ut åt sidan med knät böjt och framåt, så att
// vänster höft sjunker. Axlarna lutar åt andra hållet. Armarna hänger avslappnat en bit ut från kroppen, den högra
// lite framåt och böjd i armbågen, som när man vilar efter klättringen.
const HIP_L = [-0.052, 0.498, 0.0];
const KNEE_L = [-0.096, 0.282, -0.05];
const ANKLE_L = [-0.136, 0.07, -0.004];
const HIP_R = [0.052, 0.522, 0.0];
const KNEE_R = [0.046, 0.292, 0.006];
const ANKLE_R = [0.04, 0.07, 0.016];
const SH_L = [-0.106, 0.818, 0.006];
const ELB_L = [-0.142, 0.652, -0.004];
const WRI_L = [-0.15, 0.508, -0.03];
const SH_R = [0.104, 0.8, 0.006];
const ELB_R = [0.142, 0.662, 0.012];
const WRI_R = [0.152, 0.522, -0.034];

// Vadernas mitt, lite bakom skenbenet
const CALF_L = [KNEE_L[0] * 0.6 + ANKLE_L[0] * 0.4, KNEE_L[1] * 0.6 + ANKLE_L[1] * 0.4, KNEE_L[2] * 0.6 + ANKLE_L[2] * 0.4 + 0.014];
const CALF_R = [KNEE_R[0] * 0.6 + ANKLE_R[0] * 0.4, KNEE_R[1] * 0.6 + ANKLE_R[1] * 0.4, KNEE_R[2] * 0.6 + ANKLE_R[2] * 0.4 + 0.014];

const LEGS = [
  cone(HIP_L, KNEE_L, 0.052, 0.04), cone(KNEE_L, ANKLE_L, 0.04, 0.03),
  cone(HIP_R, KNEE_R, 0.052, 0.04), cone(KNEE_R, ANKLE_R, 0.04, 0.03),
];
const ARMS = [
  cone(SH_L, ELB_L, 0.038, 0.032), cone(ELB_L, WRI_L, 0.032, 0.026),
  cone(SH_R, ELB_R, 0.038, 0.032), cone(ELB_R, WRI_R, 0.032, 0.026),
];
const NECK = cone([0, 0.84, 0.004], [0, 0.905, -0.006], 0.04, 0.034);
const STRAPS = [
  cone([-0.066, 0.86, 0.085], [-0.074, 0.88, 0.012], 0.012, 0.012),
  cone([-0.074, 0.88, 0.012], [-0.082, 0.812, -0.078], 0.012, 0.012),
  cone([0.074, 0.86, 0.085], [0.082, 0.88, 0.012], 0.012, 0.012),
  cone([0.082, 0.88, 0.012], [0.088, 0.812, -0.078], 0.012, 0.012),
  // Höftbältet runt midjan
  cone([-0.06, 0.585, 0.096], [-0.12, 0.58, 0.02], 0.014, 0.014),
  cone([-0.12, 0.58, 0.02], [-0.088, 0.575, -0.08], 0.014, 0.014),
  cone([0.06, 0.585, 0.096], [0.122, 0.58, 0.02], 0.014, 0.014),
  cone([0.122, 0.58, 0.02], [0.088, 0.575, -0.08], 0.014, 0.014),
];

// Senaste träffens material och punkt i kroppens koordinater (för paneler och reflexband)
let mat = 0;
let part = 0; // 1 ben, 2 arm, 3 bål
let lx = 0;
let ly = 0;
let lz = 0;

const CB = Math.cos(BODY_YAW);
const SB = Math.sin(BODY_YAW);
const CH = Math.cos(HEAD_YAW);
const SH = Math.sin(HEAD_YAW);

/** Avståndet till räddaren från en punkt i världen; sätter mat/part/lx/ly/lz för den närmaste formen. */
function map(wx, wy, wz) {
  // Till kroppens koordinater
  const x = wx * CB + wz * SB;
  const y = wy;
  const z = -wx * SB + wz * CB;
  lx = x;
  ly = y;
  lz = z;
  let d = 1e9;
  let m = 0;
  let pt = 0;

  // Benen och kängorna
  if (y < 0.6) {
    const bound = sdBox(x, y, z, -0.01, 0.29, -0.01, 0.22, 0.32, 0.14, 0);
    if (bound < 0.03) {
      for (let i = 0; i < 4; i++) {
        const di = sdCone(LEGS[i], x, y, z);
        if (di < d) pt = 1;
        d = i === 0 || i === 2 ? Math.min(d, di) : smin(d, di, 0.025);
      }
      // Veck i knävecken och över vristerna, så att byxorna ser ut som tyg och inte som rör
      if (d < 0.02) {
        const kneeY = x < 0 ? KNEE_L[1] : KNEE_R[1];
        const bend = x < 0 ? 1.4 : 0.8; // det böjda benet veckar sig mer
        d += 0.0058 * bend * Math.sin(y * 120 + x * 45 + 2.5 * Math.sin(z * 60)) * Math.exp(-(((y - kneeY) / 0.08) ** 2))
          + 0.0045 * Math.sin(y * 150 - x * 30) * Math.exp(-(((y - 0.115) / 0.04) ** 2))
          // Långa veck som hänger nedför låren
          + 0.0032 * Math.sin(x * 105 + z * 70 + 2.2 * Math.sin(y * 24)) * Math.exp(-(((y - 0.4) / 0.09) ** 2))
          + 0.0016 * Math.sin(x * 90 + y * 25 + z * 40);
      }
      // Vaderna buktar ut bakåt
      const cl = sdEllipsoid(x, y, z, CALF_L[0], CALF_L[1], CALF_L[2], 0.038, 0.072, 0.042);
      const cr = sdEllipsoid(x, y, z, CALF_R[0], CALF_R[1], CALF_R[2], 0.039, 0.072, 0.042);
      d = smin(d, Math.min(cl, cr), 0.03);
      m = SUIT;
      // Kängorna: skaft och fot med tån framåt
      for (const a of [ANKLE_L, ANKLE_R]) {
        const out = Math.sign(a[0]);
        const shaft = sdEllipsoid(x, y, z, a[0], a[1] - 0.005, a[2], 0.04, 0.05, 0.043);
        const foot = sdBox(x, y, z, a[0] + out * 0.006, 0.026, a[2] - 0.03, 0.036, 0.026, 0.066, 0.016);
        const boot = smin(shaft, foot, 0.03);
        if (boot < d) {
          d = boot;
          m = y < 0.014 ? SOLE : DARK;
          pt = 0;
        }
      }
      // Byxornas säte
      const seat = sdEllipsoid(x, y, z, 0.006, 0.51 + 0.1 * x, 0.004, 0.094, 0.078, 0.078);
      if (seat < d) pt = 3;
      d = smin(d, seat, 0.035);
    } else d = bound;
  }

  // Bålen: jackan med breda axlar och en kant som faller ut över höfterna
  {
    const bound = sdBox(x, y, z, 0.01, 0.72, 0, 0.26, 0.2, 0.13, 0);
    if (bound < d + 0.03) {
      let t = sdEllipsoid(x, y, z, 0, 0.68, 0, 0.096, 0.17, 0.074);
      t = smin(t, sdEllipsoid(x, y, z, 0, 0.775, -0.004, 0.112, 0.084, 0.078), 0.05);
      t = smin(t, sdEllipsoid(x, y, z, 0.004, 0.575, 0.002, 0.1, 0.058, 0.08), 0.04);
      t = smin(t, sdEllipsoid(x, y, z, SH_L[0] + 0.006, SH_L[1] - 0.008, 0.004, 0.044, 0.042, 0.046), 0.04);
      t = smin(t, sdEllipsoid(x, y, z, SH_R[0] - 0.004, SH_R[1] - 0.008, 0.004, 0.044, 0.042, 0.046), 0.04);
      t = smin(t, sdCone(NECK, x, y, z), 0.03);
      t = smin(t, torus(x, y - 0.866, z - 0.012, 0.046, 0.02, 0), 0.02); // den hoprullade huvan
      // Vågiga veck i midjan ovanför höftbältet
      // och dragveck snett upp mot axelremmarna
      if (t < 0.02) {
        t += 0.0058 * Math.sin(y * 115 + x * 30 + 2 * Math.sin(x * 35)) * Math.exp(-(((y - 0.625) / 0.05) ** 2))
          + 0.0038 * Math.sin((y + Math.abs(x) * 0.9) * 95) * Math.exp(-(((y - 0.72) / 0.08) ** 2))
          + 0.0026 * Math.sin(x * 80 + z * 60 + 3 * Math.sin(y * 30));
      }
      if (t < d) {
        m = SUIT;
        pt = 3;
      }
      d = smin(d, t, 0.03);
      // Armarna
      let a = 1e9;
      for (let i = 0; i < 4; i++) a = i === 0 || i === 2 ? Math.min(a, sdCone(ARMS[i], x, y, z)) : smin(a, sdCone(ARMS[i], x, y, z), 0.02);
      if (a < d) {
        m = SUIT;
        pt = 2;
      }
      // Veck i armvecken: ringar kring armbågen som klingar av utåt
      if (a < 0.02) {
        for (const e of [ELB_L, ELB_R]) {
          const r = Math.hypot(x - e[0], y - e[1], z - e[2]);
          a += 0.0028 * Math.sin(r * 140) * Math.exp(-((r / 0.085) ** 2));
        }
      }
      d = smin(d, a, 0.022);
      // Handskarna
      // Händerna hänger med fingrarna lite krökta
      const gl = sdEllipsoid(x, y, z, WRI_L[0] - 0.004, WRI_L[1] - 0.036, WRI_L[2] - 0.006, 0.027, 0.044, 0.033);
      const gr = sdEllipsoid(x, y, z, WRI_R[0] + 0.002, WRI_R[1] - 0.036, WRI_R[2] - 0.004, 0.027, 0.044, 0.033);
      const g = Math.min(gl, gr);
      if (g < d) {
        d = smin(d, g, 0.012);
        m = DARK;
        pt = 0;
      }
    } else d = Math.min(d, bound);
  }

  // Ryggsäcken med lock, framficka, sidoficka och rep, och remmarna
  {
    const bound = sdBox(x, y, z, 0.0, 0.76, 0.11, 0.18, 0.22, 0.12, 0);
    if (bound < d + 0.01) {
      // Säcken smalnar av uppåt och buktar bakåt nedtill, som en packad säck och inte som en låda
      const taper = 0.072 + 0.02 * Math.min(1, Math.max(0, (0.86 - y) / 0.3));
      const bulge = 0.012 * Math.max(0, Math.sin((y - 0.56) * 10));
      let p = sdBox(x, y, z, 0.012, 0.712, 0.114 + bulge * 0.5, taper, 0.14, 0.05 + bulge * 0.5, 0.04);
      p = smin(p, sdEllipsoid(x, y, z, 0.012, 0.852, 0.11, 0.078, 0.04, 0.058), 0.035); // det pösiga locket
      p = smin(p, sdEllipsoid(x, y, z, 0.014, 0.66, 0.16, 0.06, 0.066, 0.026), 0.016); // framfickan
      // sidofickor med flaska och kompressionsremmar, som bryter konturen
      p = Math.min(p, sdEllipsoid(x, y, z, 0.104, 0.67, 0.11, 0.024, 0.06, 0.03));
      p = Math.min(p, sdEllipsoid(x, y, z, -0.086, 0.66, 0.108, 0.02, 0.05, 0.028));
      if (p < d) {
        d = p;
        m = PACK;
        pt = 0;
      }
      for (const s of STRAPS) {
        const ds = sdCone(s, x, y, z);
        if (ds < d) {
          d = ds;
          m = STRAP;
        }
      }
    } else d = Math.min(d, bound);
  }

  // Huvudet: hjälm, glasögon och en skymt av ansiktet, vridet mot solen kring halsen
  {
    const hx0 = x;
    const hz0 = z;
    const hx = hx0 * CH + hz0 * SH;
    const hz = -hx0 * SH + hz0 * CH;
    const bound = sdBox(hx, y, hz, 0, 0.94, 0, 0.09, 0.09, 0.1, 0);
    if (bound < d + 0.01) {
      const shell = sdEllipsoid(hx, y, hz, 0, 0.952, 0.006, 0.053, 0.056, 0.062);
      // Hjälmens kant: skalet skärs av nedtill och får en tunn läpp
      const cut = Math.max(shell, 0.918 - y);
      const lip = torus(hx, y - 0.922, hz - 0.006, 0.047, 0.005, 0);
      let hm = Math.min(cut, lip);
      if (hm < d) {
        d = hm;
        m = HELMET;
      }
      const face = sdEllipsoid(hx, y, hz, 0, 0.912, -0.014, 0.044, 0.05, 0.05);
      if (face < d) {
        d = smin(d, face, 0.01);
        m = SKIN;
      }
      // Glasögonbandet runt hjälmen och glaset fram
      const band = torus(hx, y - 0.936, hz - 0.006, 0.054, 0.008, 0);
      const lens = sdEllipsoid(hx, y, hz, 0, 0.935, -0.054, 0.045, 0.02, 0.016);
      // En kort skärm fram på hjälmen, som syns i profil när han vrider huvudet
      const visor = sdEllipsoid(hx, y, hz, 0, 0.954, -0.06, 0.045, 0.006, 0.022);
      if (visor < d) {
        d = visor;
        m = HELMET;
      }
      const gog = Math.min(band, lens);
      if (gog < d) {
        d = gog;
        m = lens < band ? LENS : STRAP;
      }
    } else d = Math.min(d, bound);
  }

  mat = m;
  part = pt;
  return d;
}

/** Torus runt y-axeln (eller lutad kring x med tilt), för hjälmkanten, glasögonbandet och repet. */
function torus(x, y, z, R, r, tilt) {
  if (tilt) {
    const c = Math.cos(tilt);
    const s = Math.sin(tilt);
    const yy = y * c - z * s;
    z = y * s + z * c;
    y = yy;
    // repet ligger i ett lodrätt plan längs säckens sida
    const t = x;
    x = y;
    y = t;
  }
  const q = Math.hypot(x, z) - R;
  return Math.hypot(q, y) - r;
}

// --- Strålföljningen --------------------------------------------------------------------------------------

const RIM_WIDTH = 0.03; // den heta kantens bredd i figurens höjd
const GLOW_WIDTH = 0.06; // det svaga skenet innanför kanten
const X0 = -0.34;
const X1 = 0.34;
const Y0 = -0.015;
const Y1 = 1.035;

/**
 * Strålföljer räddaren i en given storlek med kantutjämning.
 * @param {number} size  figurens höjd i pixlar (fötter till hjälmens topp)
 * @param {number} [ss]  delsampel per pixel och led
 * @returns {{ width: number, height: number, data: Uint8ClampedArray, footX: number, footY: number }}
 *   footX/footY är mitten mellan fötterna, på marken, i bildens pixlar
 */
export function renderRescuerFigure(size, ss = 2) {
  const width = Math.ceil((X1 - X0) * size);
  const height = Math.ceil((Y1 - Y0) * size);
  const n = width * height;
  const light = new Float32Array(n * 3); // ljuset före tonmappningen
  const surf = new Float32Array(n * 5); // albedo (rgb), djup och hur mycket ytan vetter mot solen, för motljuset
  const cover = new Float32Array(n);
  const col = new Float32Array(8);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = py * width + px;
      let cov = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const wx = X0 + (px + (sx + 0.5) / ss) / size;
          const wy = Y1 - (py + (sy + 0.5) / ss) / size;
          if (!shade(wx, wy, col)) continue;
          for (let c = 0; c < 3; c++) light[i * 3 + c] += col[c];
          for (let c = 0; c < 5; c++) surf[i * 5 + c] += col[3 + c];
          cov++;
        }
      }
      if (!cov) continue;
      for (let c = 0; c < 3; c++) light[i * 3 + c] /= cov;
      for (let c = 0; c < 5; c++) surf[i * 5 + c] /= cov;
      cover[i] = cov / (ss * ss);
    }
  }

  // Motljuset i bildplanet: en smal skära innanför varje kontur som vetter mot solen, både mot himlen och där en
  // del ligger framför en annan (armen mot jackan, säcken mot axeln): en tunn het linje och ett svagt sken innanför.
  // Bredden följer figurens storlek, och kanten lyser mest där ytan själv vänder sig mot solen.
  const thin = Math.max(1.2, size * RIM_WIDTH);
  const reach = Math.max(3, Math.round(size * GLOW_WIDTH));
  const dx = SUN_FLAT[0];
  const dy = -SUN_FLAT[1];
  const data = new Uint8ClampedArray(n * 4);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = py * width + px;
      if (!cover[i]) continue;
      const depth = surf[i * 5 + 3];
      let edge = 0;
      let core = 0;
      for (let k = 1; k <= reach; k++) {
        const qx = Math.round(px + dx * k);
        const qy = Math.round(py + dy * k);
        const j = qy * width + qx;
        const out = qx < 0 || qy < 0 || qx >= width || qy >= height || cover[j] < 0.5;
        if (out || surf[j * 5 + 3] < depth - 0.025) {
          const line = Math.max(0, 1 - (k - 1) / thin);
          const face = 0.35 + 0.65 * surf[i * 5 + 4];
          edge = (line * Math.sqrt(line) + 0.025 * (1 - (k - 1) / reach) ** 2) * face;
          // Längst ut en hårfin, nästan vit linje där tyget fångar solen rakt från sidan
          core = Math.max(0, 1 - (k - 1) / Math.max(1, thin * 0.3)) * face * face;
          break;
        }
      }
      const o = i * 4;
      for (let c = 0; c < 3; c++) {
        const a = surf[i * 5 + c];
        // Kanten tar materialets färg mättad (rött tyg glöder orangerött), så att den syns mot den ljusa
        // persikofärgade himlen i stället för att smälta in i den
        const rim = edge * SUN_COL[c] * (a * 1.3 + SHEEN[c] * 0.22) + core * SUN_COL[c] * 0.3;
        data[o + c] = tone(light[i * 3 + c] + rim * lowAt(py / size));
      }
      data[o + 3] = Math.round(cover[i] * 255);
    }
  }
  return { width, height, data, footX: -X0 * size, footY: Y1 * size };
}

// Mörkare ned mot kängorna, där klippan skuggar (y i bildens enheter uppifrån)
function lowAt(v) {
  return 0.42 + 0.58 * Math.min(1, Math.max(0, (Y1 - v) / 0.5));
}

/** En stråle rakt in i bilden (ortografisk kamera); fyller col med ljuset och returnerar om den träffade. */
function shade(wx, wy, col) {
  let z = 0.3;
  let hit = false;
  for (let i = 0; i < 90 && z > -0.3; i++) {
    const d = map(wx, wy, z);
    if (d < 0.0004) {
      hit = true;
      break;
    }
    z -= d;
  }
  if (!hit) return false;
  // Normalen ur fältets lutning (fyrpunktsmetoden)
  const e = 0.0012;
  const k1 = map(wx + e, wy - e, z - e);
  const k2 = map(wx - e, wy - e, z + e);
  const k3 = map(wx - e, wy + e, z - e);
  const k4 = map(wx + e, wy + e, z + e);
  let nx = k1 - k2 - k3 + k4;
  let ny = -k1 - k2 + k3 + k4;
  let nz = -k1 + k2 - k3 + k4;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  map(wx, wy, z);
  const m = mat;
  const p = part;
  const bx = lx;
  const by = ly;
  const bz = lz;
  const alb = albedo(m, p, bx, by, bz);

  const ao = occlusion(wx, wy, z, nx, ny, nz);
  const ndl = nx * SUN[0] + ny * SUN[1] + nz * SUN[2];
  // Tyget sprider ljuset en bit runt skuggkanten (wrap), så att motljuset får bredd i stället för en hårfin linje
  const soft = m === SUIT ? 0.55 : 0.2; // tyget sprider ljuset runt kanten, säcken och hjälmen mycket mindre
  const wrap = (ndl + soft) / (1 + soft);
  const sun = wrap > 0 ? wrap * wrap * softShadow(wx + nx * 0.003, wy + ny * 0.003, z + nz * 0.003) : 0;
  // Motljuset: tyget fångar solen i strykande vinkel längs konturen mot solen
  const ndv = Math.max(0, nz);
  const facing = Math.max(0, nx * SUN_FLAT[0] + ny * SUN_FLAT[1]) ** 2;
  const rim = Math.pow(1 - ndv, 2.6) * facing * (sun > 0 ? 1 : 0.3);
  const sky = (0.55 + 0.45 * ny) * ao;
  const fill = (0.35 + 0.65 * ndv) * ao;
  const bounce = Math.max(0, -ny) * ao;
  // Glans på hjälmen och glaset: solen reflekterad i strykande vinkel
  const gloss = GLOSS[m] || 0;
  let spec = 0;
  if (gloss) {
    let hx = SUN[0];
    let hy = SUN[1];
    let hz = SUN[2] + 1;
    const hl = Math.hypot(hx, hy, hz);
    hx /= hl;
    hy /= hl;
    hz /= hl;
    const ndh = Math.max(0, nx * hx + ny * hy + nz * hz);
    spec = gloss * 1.6 * Math.pow(ndh, 70) * (sun > 0 ? 1 : 0.2) + gloss * 0.025 * Math.pow(1 - ndv, 3) * ao;
  }
  // Skaljackans blanka nylon speglar himlen: veck och kanter som vänder sig åt sidan eller uppåt fångar den
  // ljusa kvällshimlen och solens sken, medan ytor rakt mot betraktaren speglar den mörka östhimlen
  const shine = SHINE[m] || 0;
  let env = 0;
  let envSun = 0;
  let envCool = 0;
  if (shine) {
    // Kamerans stråle (0, 0, −1) speglad i normalen
    const rx = 2 * nz * nx;
    const ry = 2 * nz * ny;
    const rz = 2 * nz * nz - 1;
    const fres = 0.06 + 0.94 * Math.pow(1 - ndv, 4);
    const toSun = Math.max(0, rx * SUN[0] + ry * SUN[1] + rz * SUN[2]);
    // Himlen är ljusast mot solen (höger och bakåt) och mörk åt vänster, så speglingarna sitter mest på solsidan
    const bright = Math.max(0, Math.min(1, 0.35 + rx * 0.55 - rz * 0.35 + ry * 0.25));
    env = shine * fres * (0.08 + 0.92 * bright * bright) * ao;
    // Högt upp, bort från solen, är kvällshimlen kall och lila: ytor som speglar den får en blåaktig glans
    envCool = shine * fres * Math.max(0, ry) * (1 - bright) * ao;
    envSun = shine * fres * Math.pow(toSun, 6) * 2.2 * (sun > 0 ? 1 : 0.35);
  }
  for (let c = 0; c < 3; c++) {
    col[c] = alb[c] * (SUN_COL[c] * (sun + rim * 0.7) + SKY_COL[c] * sky + FILL_COL[c] * fill + BOUNCE_COL[c] * bounce)
      + spec * SUN_COL[c] * 0.35 + rim * SHEEN[c] * 0.3 + env * ENV_COL[c] + envCool * COOL_COL[c] + envSun * SUN_COL[c] * 0.3;
  }
  // I skuggan lyser bara den kalla himlen: färgen blir dovare och drar mot lila, så att den solbelysta sidan
  // och motljuset står ut mot en mörk, nästan grå skuggsida i stället för ett jämnt mättat rött
  const lit = Math.min(1, sun * 2.2 + rim * 1.5);
  const grey = (col[0] * 0.3 + col[1] * 0.59 + col[2] * 0.11) * 1.15;
  const dull = 0.28 * (1 - lit);
  col[0] += (grey * 0.95 - col[0]) * dull;
  col[1] += (grey * 0.92 - col[1]) * dull;
  col[2] += (grey * 1.25 - col[2]) * dull;
  const low = lowAt(Y1 - wy);
  col[0] *= low;
  col[1] *= low;
  col[2] *= low;
  col[3] = alb[0];
  col[4] = alb[1];
  col[5] = alb[2];
  col[6] = z;
  col[7] = Math.min(1, Math.max(0, nx * SUN_FLAT[0] + ny * SUN_FLAT[1]) * 1.4);
  return true;
}

// Paneler och reflexband på overallen, valda efter var på kroppen punkten ligger
const tmp = [0, 0, 0];
function albedo(m, p, x, y, z) {
  let a = ALBEDO[m];
  if (m === SUIT) {
    if (p === 1 && Math.abs(y - (x < 0 ? KNEE_L[1] : KNEE_R[1]) + 0.005) < 0.042) a = ALBEDO[DARK]; // knäskydd
    else if (p === 2 && y > 0.6 && y < 0.62 && x > 0) return reflex(); // reflexband över armbågen
    else if (p === 2 && x < 0 && y > 0.6 && y < 0.62 && z > 0) return reflex();
    else if (y > 0.805 && p !== 1) a = [0.06, 0.05, 0.055]; // mörkt axelok
    else if (p === 1 || (p === 3 && y < 0.55)) a = [0.26, 0.01, 0.024]; // byxorna mörkare
    // Sömmar: längs ryggen bredvid säcken, runt axeloket och längs benens utsidor
    const seam = (p === 3 && y > 0.6 && Math.abs(Math.abs(x) - 0.088) < 0.003)
      || (p !== 1 && Math.abs(y - 0.805) < 0.0025)
      || (p === 1 && Math.abs(Math.abs(x - (x < 0 ? -0.07 : 0.07)) - 0.04) < 0.0025 && y > 0.17);
    if (seam) a = [a[0] * 0.68, a[1] * 0.68, a[2] * 0.68];
  }
  if (m === PACK) {
    // Ett grått kantband där locket möter säcken
    if (z > 0.13 && Math.abs(y - 0.835) < 0.005 && Math.abs(x - 0.012) < 0.07) a = [0.11, 0.11, 0.12];
  }
  if (m === PACK && z > 0.13) {
    // Kompressionsremmar med spännen och dragkedjan runt framfickan
    for (const sy of [0.75, 0.686]) {
      if (Math.abs(y - sy) < 0.006) a = Math.abs(x - 0.05) < 0.01 ? [0.2, 0.2, 0.21] : [0.07, 0.07, 0.075];
    }
    if (z > 0.17 && Math.abs(y - 0.726) < 0.003 && Math.abs(x - 0.014) < 0.05) a = [0.1, 0.1, 0.11];
  }
  // Tygets struktur, så att ytan inte blir plastslät
  const n = 0.88 + 0.24 * hash3(Math.floor(x * 260), Math.floor(y * 260), Math.floor(z * 260));
  tmp[0] = a[0] * n;
  tmp[1] = a[1] * n;
  tmp[2] = a[2] * n;
  return tmp;
}

function reflex() {
  tmp[0] = 0.3;
  tmp[1] = 0.29;
  tmp[2] = 0.28;
  return tmp;
}

function occlusion(x, y, z, nx, ny, nz) {
  let o = 0;
  let w = 1;
  for (let i = 1; i <= 4; i++) {
    const h = 0.008 * i;
    o += (h - map(x + nx * h, y + ny * h, z + nz * h)) * w;
    w *= 0.75;
  }
  return Math.max(0.1, Math.min(1, 1 - o * 26));
}

function softShadow(x, y, z) {
  let res = 1;
  let t = 0.006;
  for (let i = 0; i < 28 && t < 0.5; i++) {
    const h = map(x + SUN[0] * t, y + SUN[1] * t, z + SUN[2] * t);
    if (h < 0.0005) return 0;
    res = Math.min(res, (10 * h) / t);
    t += Math.max(0.004, h);
  }
  return Math.max(0, Math.min(1, res));
}

function tone(x) {
  const y = 1 - Math.exp(-x * 1.25);
  return Math.pow(y, 1 / 2.2) * 255;
}

function hash3(x, y, z) {
  let n = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function norm(x, y, z) {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}
