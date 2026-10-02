// Räddningshelikoptern i 3D med WebGL2: en H135-liknande modell som byggs i koden
// (kabin, motorkåpa, stjärtbom, fenestron, stabilisator, medar och fyrbladig rotor).
// Lacken, rutorna och skarvarna ritas i fragment-shadern efter läget på kroppen, så att
// kanterna blir skarpa oavsett hur fint nätet är. Ljuset kommer från samma sol som i
// 3D-landskapet (terrain.js), med himmel ovanifrån och mark underifrån, blank lack och
// speglande glas. Rotorn är en skiva där bladen och rörelseoskärpan räknas ut per pixel.
//
// Ritas på en egen liten canvas utanför sidan, som render.js lägger in i 2D-scenen med
// drawImage. Då hamnar helikoptern i rätt lager mellan etiketter och ringar. Saknas
// WebGL2 ritar render.js den platta helikoptern från sidan (heli-draw.js) i stället.
//
// Modellens koordinater i meter: nosen mot +z, upp +y, medarnas undersida på y = 0.

const ROTOR_R = 5.1; // huvudrotorns radie (m)
const HUB = [0, 2.86, 0.15]; // rotornavet
const CENTER = [0, 1.55, -1.6]; // punkten som kameran tittar på och som render.js placerar
const SIZE_STEP = 64; // canvasens storlek avrundas uppåt, så att den inte byts varje bild
const MAX_DIM = 2400; // canvasens största sida i bildpunkter

const VERTEX = `#version 300 es
in vec3 aPos;
in vec3 aNor;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
out vec3 vW;
out vec3 vN;
out vec3 vObj;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = mat3(uModel) * aNor;
  vObj = aPos;
  gl_Position = uProj * uView * w;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vN;
in vec3 vObj;
uniform int uMat;       // 0 lack, 1 mörk metall, 2 rotorskivan, 3 ljus metall, 4 lampa
uniform vec3 uEye;
uniform vec3 uSun;      // riktning mot solen
uniform vec3 uSunCol;
uniform vec3 uSky;      // himlen ovanför (linjärt)
uniform vec3 uGround;   // marken under
uniform vec3 uBody;     // lackens grundfärg (linjärt)
uniform vec3 uAccent;   // dekorfärgen
uniform vec3 uTrim;
uniform float uAngle;   // rotorns vinkel
uniform float uBlur;    // 0–1, rörelseoskärpa
uniform vec3 uGlow;     // lampornas färg (uMat 4)
out vec4 outColor;

const float PI = 3.14159265;

// 1 innanför (d < 0), mjuk kant en bildpunkt bred
float inside(float d) {
  float w = max(fwidth(d), 1e-4);
  return clamp(0.5 - d / w, 0.0, 1.0);
}
float line(float d, float halfWidth) {
  float w = max(fwidth(d), 1e-4);
  return 1.0 - smoothstep(halfWidth, halfWidth + w, abs(d));
}
float roundRect(vec2 p, vec2 c, vec2 h, float r) {
  vec2 q = abs(p - c) - h + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

vec3 envColor(vec3 r) {
  vec3 horizon = mix(uSky, vec3(1.0), 0.35);
  vec3 c = mix(uGround, horizon, smoothstep(-0.25, 0.02, r.y));
  c = mix(c, uSky, smoothstep(0.05, 0.7, r.y));
  return c;
}

// Lackering, rutor och skarvar på kroppen. Returnerar färg och glans (a = 1 är glas).
vec4 livery(vec3 p, out float lines) {
  float z = p.z;
  float y = p.y;
  float ax = abs(p.x);
  lines = 0.0;
  vec3 col = uBody;
  // Kabinens sidor och stjärten i dekorfärgen, taket och motorkåpan i grundfärgen,
  // med en rand i grundfärgen längs kabinens nederkant
  float belt = 1.98 - 0.05 * smoothstep(0.5, 2.2, z);
  float lower = inside(y - belt);
  float tail = inside(z + 2.12);
  col = mix(col, uAccent, max(lower, tail));
  float band = inside(abs(y - 0.86 - 0.04 * sin(z * 0.8)) - 0.07) * step(-2.15, z);
  col = mix(col, uTrim, band);
  lines += line(abs(y - 0.86 - 0.04 * sin(z * 0.8)) - 0.07, 0.006) * step(-2.15, z);
  // Vit rand längs bommen, som på räddningshelikoptrarna
  float boomStripe = inside(abs(y - (1.66 + (z + 2.0) * -0.03)) - 0.05) * inside(z + 2.6) * inside(-6.3 - z);
  col = mix(col, uTrim, boomStripe * step(0.1, ax));
  // Nosen i dekorfärgen
  col = mix(col, uAccent, inside(2.38 - z) * inside(y - 1.02));
  lines += line(y - belt, 0.01) * step(-2.15, z);

  // Inga if-satser här: fwidth behöver samma väg för alla bildpunkter.
  float cabin = step(-1.75, z) * step(y, 2.12) * step(0.5, y);
  // Sidorutor: framdörr, skjutdörr och ett litet fönster bakom
  float side = step(0.35, ax) * cabin;
  float front = roundRect(vec2(z, y), vec2(1.05, 1.56), vec2(0.42, 0.34), 0.12);
  float slide = roundRect(vec2(z, y), vec2(0.05, 1.58), vec2(0.5, 0.32), 0.12);
  float rear = roundRect(vec2(z, y), vec2(-1.12, 1.62), vec2(0.28, 0.22), 0.1);
  float glass = side * inside(min(min(front, slide), rear));
  // Vindrutan, delad i mitten, och de små rutorna i nosen
  float ws = inside(1.62 - z) * inside(0.98 - y) * inside(y - 2.06 + (z - 1.62) * 0.55);
  ws *= 1.0 - line(p.x, 0.025);
  glass = max(glass, ws * cabin);
  float chin = inside(roundRect(vec2(z, y), vec2(2.35, 0.78), vec2(0.28, 0.15), 0.08)) * step(0.12, ax);
  glass = max(glass, chin * cabin);
  // Dörrarnas skarvar
  float door = roundRect(vec2(z, y), vec2(0.05, 1.22), vec2(0.62, 0.78), 0.08);
  float fdoor = roundRect(vec2(z, y), vec2(1.12, 1.25), vec2(0.5, 0.75), 0.1);
  lines += (line(door, 0.008) + line(fdoor, 0.008)) * side;
  // Motorkåpan: luckor, galler och avgasrör bak
  float cowl = step(2.05, y) * step(z, 1.0) * step(-2.7, z);
  lines += (line(z + 0.95, 0.008) + line(z - 0.15, 0.008)) * cowl;
  float grille = inside(roundRect(vec2(z, y), vec2(-0.45, 2.3), vec2(0.32, 0.08), 0.03)) * step(0.3, ax) * cowl;
  col = mix(col, vec3(0.02), grille * (0.6 + 0.4 * step(0.5, fract(z * 30.0))));
  // Bakdörrarna (musselskal) i kabinens bakre ände
  float back = step(z, -1.7) * step(-2.15, z) * step(y, 1.62);
  lines += (line(p.x, 0.008) + line(roundRect(vec2(p.x, y), vec2(0.0, 1.02), vec2(0.5, 0.52), 0.12), 0.008)) * back;
  // Skarvar på bommen
  lines += (line(z + 2.62, 0.01) + line(z + 4.6, 0.008)) * inside(-2.3 - z) * inside(z + 6.4);
  // Fenestron: det runda hålet i fenan med fläkten innanför
  float fin = step(z, -6.3) * step(0.06, ax);
  float fd = length(vec2(z + 7.0, y - 2.02));
  col = mix(col, vec3(0.03), inside(fd - 0.44) * fin);
  lines += line(fd - 0.47, 0.015) * fin;
  // Lite smuts: sot från avgaserna längs bommens ovansida och ojämn lack nertill
  float soot = smoothstep(1.9, 2.1, y) * inside(-2.4 - z) * inside(z + 4.5) * smoothstep(0.25, 0.7, noise(p * vec3(4.0, 4.0, 1.5)));
  col *= 1.0 - 0.35 * soot;
  col *= 0.94 + 0.06 * noise(p * 9.0);
  col *= 1.0 - 0.18 * smoothstep(0.75, 0.45, y) * noise(p * 3.0 + 7.0);
  col = mix(col, vec3(0.02, 0.025, 0.035), glass);
  return vec4(col, glass);
}

vec3 tonemap(vec3 x) {
  // ACES (Narkowicz)
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uEye - vW);
  // Insidan av öppna rör (avgasrören) syns från baksidan: vänd normalen och gör den mörk
  float inner = step(dot(N, V), -0.2);
  if (inner > 0.5) N = -N;
  vec3 L = normalize(uSun);
  vec3 Hh = normalize(L + V);
  float ndl = max(dot(N, L), 0.0);
  float nv = clamp(dot(N, V), 0.0, 1.0);
  vec3 amb = mix(uGround, uSky, N.y * 0.5 + 0.5);
  vec3 R = reflect(-V, N);

  if (uMat == 4) {
    outColor = vec4(uGlow, 1.0);
    return;
  }
  if (uMat == 2) {
    // Rotorskivan: fyra blad, med en släpande oskärpa bakom varje blad
    vec2 q = vObj.xz;
    float r = length(q);
    if (r > ${ROTOR_R.toFixed(2)} || r < 0.22) discard;
    float phi = atan(q.y, q.x);
    float quarter = PI * 0.5;
    float halfW = 0.14 / r; // halva bladbredden i radianer
    float d = mod(uAngle - phi + halfW, quarter) - halfW; // 0 vid bladets mitt, positivt bakom
    float arc = mix(0.02, 0.45, uBlur);
    float px = length(fwidth(q)) / r; // en bildpunkt i radianer
    float core = 1.0 - smoothstep(halfW - px, halfW + px, abs(d));
    float trail = exp(-max(0.0, d - halfW) / arc) * step(0.0, d);
    float a = max(core * mix(1.0, 0.92, uBlur), trail * 0.3 * uBlur);
    a = max(a, 0.035 * uBlur); // skivan syns svagt
    float tip = smoothstep(${(ROTOR_R - 0.35).toFixed(2)}, ${(ROTOR_R - 0.1).toFixed(2)}, r);
    a = max(a, tip * 0.1 * uBlur);
    a *= smoothstep(${ROTOR_R.toFixed(2)}, ${(ROTOR_R - 0.04).toFixed(2)}, r);
    vec3 blade = vec3(0.05, 0.055, 0.06);
    vec3 lit = blade * (amb * 0.4 + uSunCol * max(L.y, 0.0) * 0.3);
    float spec = pow(max(dot(vec3(0.0, 1.0, 0.0), Hh), 0.0), 40.0) * 0.6;
    vec3 c = lit + uSunCol * spec * 0.08 + envColor(R) * 0.02;
    c = mix(c, c + vec3(0.25, 0.22, 0.18) * 0.4, tip * 0.5);
    c = pow(tonemap(c), vec3(1.0 / 2.2));
    // Oskärpan bakom bladen är en mörk, genomskinlig slöja, inte ljus
    c = mix(vec3(0.06, 0.065, 0.075), c, core);
    outColor = vec4(c * a, a);
    return;
  }

  vec3 base;
  float gloss;
  float shin;
  float specK;
  float lines = 0.0;
  if (uMat == 0) {
    vec4 lv = livery(vObj, lines);
    base = lv.rgb;
    gloss = mix(0.35, 1.0, lv.a);
    shin = mix(70.0, 180.0, lv.a);
    specK = mix(0.6, 1.4, lv.a);
  } else if (uMat == 1) {
    base = vec3(0.035, 0.038, 0.045);
    gloss = 0.35;
    shin = 40.0;
    specK = 0.5;
  } else {
    base = vec3(0.32, 0.33, 0.35);
    gloss = 0.5;
    shin = 60.0;
    specK = 0.8;
  }
  // Mörkare där kroppen möter medarna och under motorkåpan (enkel skuggning i vinklar)
  float ao = uMat == 0 ? mix(0.55, 1.0, smoothstep(0.35, 0.9, vObj.y)) : 1.0;
  ao *= uMat == 0 ? mix(1.0, 0.75, inside(abs(vObj.y - 2.12) - 0.05) * step(-0.5, -N.y)) : 1.0;
  float F = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
  vec3 diffuse = base * (amb * 0.38 * ao + uSunCol * ndl);
  vec3 spec = uSunCol * pow(max(dot(N, Hh), 0.0), shin) * specK * (0.3 + 0.7 * ndl);
  // Klarlacken: en liten, skarp glansdager ovanpå
  spec += uSunCol * pow(max(dot(N, Hh), 0.0), 600.0) * (uMat == 0 ? 1.6 : 0.4) * step(0.0, ndl);
  vec3 refl = envColor(R) * F * gloss;
  vec3 c = (diffuse + spec + refl) * (1.0 - 0.85 * inner);
  c *= 1.0 - 0.75 * clamp(lines, 0.0, 1.0);
  c = pow(tonemap(c * 1.05), vec3(1.0 / 2.2));
  outColor = vec4(c, 1.0);
}`;

// --- Geometri ------------------------------------------------------------------------

/** Nät med hörn, normaler och index. Normalerna pekar bort från varje rings mitt. */
class Mesh {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.idx = [];
  }

  /**
   * Ringar som binds ihop till en sluten mantel, med lock i ändarna.
   * @param {number[][][]} rings  varje ring är en lista med [x, y, z]
   * @param {number[][]} centers  ringarnas mittpunkter
   */
  rings(rings, centers, caps = true) {
    const n = rings[0].length;
    const start = this.pos.length / 3;
    for (const ring of rings) for (const p of ring) this.pos.push(...p);
    const normals = new Array(rings.length * n).fill(0).map(() => [0, 0, 0]);
    const tris = [];
    for (let r = 0; r < rings.length - 1; r++) {
      for (let i = 0; i < n; i++) {
        const a = r * n + i;
        const b = r * n + ((i + 1) % n);
        const c = a + n;
        const d = b + n;
        tris.push([a, b, d], [a, d, c]);
      }
    }
    const P = (k) => rings[Math.floor(k / n)][k % n];
    for (const [a, b, c] of tris) {
      const fn = cross(sub(P(b), P(a)), sub(P(c), P(a)));
      for (const k of [a, b, c]) addTo(normals[k], fn);
      this.idx.push(start + a, start + b, start + c);
    }
    normals.forEach((nm, k) => {
      const out = sub(P(k), centers[Math.floor(k / n)]);
      let v = normalize(nm);
      if (dot(v, out) < 0) v = scale(v, -1);
      this.nor.push(...v);
    });
    // caps: true = båda ändarna, 'start' = bara den första (öppet rör i andra änden)
    if (caps) this.#cap(rings[0], centers[0], sub(centers[0], centers[1]));
    if (caps === true) {
      this.#cap(rings[rings.length - 1], centers[centers.length - 1], sub(centers[centers.length - 1], centers[centers.length - 2]));
    }
  }

  #cap(ring, center, dir) {
    const nrm = normalize(dir);
    if (!isFinite(nrm[0])) return;
    const start = this.pos.length / 3;
    this.pos.push(...center);
    this.nor.push(...nrm);
    for (const p of ring) {
      this.pos.push(...p);
      this.nor.push(...nrm);
    }
    for (let i = 0; i < ring.length; i++) this.idx.push(start, start + 1 + i, start + 1 + ((i + 1) % ring.length));
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));
function addTo(t, v) {
  t[0] += v[0];
  t[1] += v[1];
  t[2] += v[2];
}

/** Catmull–Rom genom kontrollpunkterna (tal eller vektorer), steps punkter per sträcka. */
function spline(points, steps) {
  const out = [];
  const lerp = (a, b, f) => (Array.isArray(a) ? a.map((x, i) => x + (b[i] - x) * f) : a + (b - a) * f);
  const cr = (p0, p1, p2, p3, t) => {
    const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    return Array.isArray(p1) ? p1.map((_, i) => f(p0[i], p1[i], p2[i], p3[i])) : f(p0, p1, p2, p3);
  };
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) out.push(cr(p0, points[i], points[i + 1], p3, s / steps));
  }
  out.push(points[points.length - 1]);
  void lerp;
  return out;
}

/**
 * Kropp som byggs av tvärsnitt längs z: superellipser med egen höjd uppåt och nedåt.
 * Varje snitt är [z, cy, halvbredd, höjd upp, höjd ned, exponent, cx].
 * map byter axlar för delar som ligger längs x (stabilisatorn).
 */
function loft(mesh, sections, { segs = 28, steps = 4, map = (p) => p } = {}) {
  const smooth = spline(sections.map((s) => [s[0], s[1], s[2], s[3], s[4], s[5] ?? 2, s[6] ?? 0]), steps);
  const rings = [];
  const centers = [];
  for (const [z, cy, w, ht, hb, pw, cx] of smooth) {
    const ring = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const e = 2 / pw;
      const x = cx + w * Math.sign(c) * Math.abs(c) ** e;
      const y = cy + (s > 0 ? ht : hb) * Math.sign(s) * Math.abs(s) ** e;
      ring.push(map([x, y, z]));
    }
    rings.push(ring);
    centers.push(map([cx, cy, z]));
  }
  mesh.rings(rings, centers);
}

/** Rör längs en bana av punkter. */
function tube(mesh, points, r, { segs = 10, steps = 4, caps = true } = {}) {
  const path = spline(points, steps);
  const rings = [];
  let u = null;
  for (let i = 0; i < path.length; i++) {
    const t = normalize(sub(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)]));
    // Ramen följer med längs banan (parallellförflyttning), så att röret inte vrids i kurvorna
    if (!u) u = normalize(cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    else u = normalize(sub(u, scale(t, dot(u, t))));
    const v = cross(t, u);
    const ring = [];
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      ring.push(add(path[i], add(scale(u, Math.cos(a) * r), scale(v, Math.sin(a) * r))));
    }
    rings.push(ring);
  }
  mesh.rings(rings, path, caps);
}

/** Kabinen, motorkåpan, stjärtbommen, fenan och stabilisatorn (lackerade delar). */
function buildBody() {
  const m = new Mesh();
  // [z, cy, halvbredd, upp, ned, exponent]
  loft(
    m,
    [
      [2.86, 0.98, 0.03, 0.03, 0.03, 2],
      [2.78, 0.99, 0.34, 0.36, 0.33, 2.2],
      [2.5, 1.06, 0.6, 0.6, 0.56, 2.3],
      [2.05, 1.17, 0.77, 0.82, 0.72, 2.5],
      [1.45, 1.25, 0.88, 0.9, 0.82, 2.7],
      [0.6, 1.28, 0.92, 0.88, 0.86, 2.9],
      [-0.6, 1.3, 0.92, 0.86, 0.86, 3.0],
      [-1.3, 1.36, 0.88, 0.8, 0.8, 3.0],
      [-1.72, 1.44, 0.8, 0.7, 0.68, 2.8],
      [-1.98, 1.52, 0.6, 0.56, 0.48, 2.5],
      [-2.1, 1.56, 0.3, 0.3, 0.22, 2.2],
      [-2.13, 1.58, 0.03, 0.03, 0.03, 2],
    ],
    { segs: 40, steps: 5 }
  );
  // Stjärtbommen ut från kabinens övre bakkant (bakom den finns kabinens bakdörrar)
  loft(
    m,
    [
      [-1.5, 1.82, 0.3, 0.28, 0.28, 2.2],
      [-2.6, 1.84, 0.25, 0.24, 0.22, 2],
      [-5.0, 1.87, 0.18, 0.18, 0.16, 2],
      [-6.45, 1.9, 0.14, 0.14, 0.13, 2],
      [-6.6, 1.89, 0.03, 0.03, 0.03, 2],
    ],
    { segs: 32, steps: 4 }
  );
  // Motorkåpan ovanpå kabinen
  loft(
    m,
    [
      [1.1, 2.1, 0.06, 0.04, 0.04, 2],
      [0.92, 2.12, 0.46, 0.18, 0.08, 2.6],
      [0.3, 2.14, 0.6, 0.34, 0.1, 3],
      [-1.0, 2.12, 0.62, 0.36, 0.1, 3],
      [-1.9, 2.04, 0.56, 0.3, 0.12, 2.8],
      [-2.5, 2.0, 0.42, 0.2, 0.12, 2.4],
      [-2.95, 1.96, 0.26, 0.13, 0.1, 2.2],
      [-3.1, 1.95, 0.04, 0.03, 0.03, 2],
    ],
    { segs: 32, steps: 4 }
  );
  // Fenan med fenestron
  loft(
    m,
    [
      [-6.25, 1.9, 0.05, 0.2, 0.18, 2],
      [-6.5, 1.95, 0.09, 0.6, 0.52, 2.6],
      [-7.0, 2.02, 0.1, 0.72, 0.62, 2.8],
      [-7.45, 2.18, 0.08, 0.66, 0.46, 2.6],
      [-7.78, 2.55, 0.07, 0.38, 0.16, 2.2],
      [-7.9, 2.66, 0.02, 0.1, 0.05, 2],
    ],
    { segs: 24, steps: 4 }
  );
  // Stabilisatorn tvärs över bommen, med ändplattor
  loft(
    m,
    [
      [-0.72, 1.86, 0.02, 0.01, 0.01, 2],
      [-0.68, 1.86, 0.22, 0.03, 0.025, 2],
      [0.68, 1.86, 0.22, 0.03, 0.025, 2],
      [0.72, 1.86, 0.02, 0.01, 0.01, 2],
    ].map(([a, cy, w, ht, hb, p]) => [a, cy, w, ht, hb, p, 0]),
    { segs: 16, steps: 1, map: ([x, y, z]) => [z, y, x - 5.95] }
  );
  for (const sx of [-0.7, 0.7]) {
    loft(
      m,
      [
        [-5.62, 1.86, 0.02, 0.1, 0.08, 2, sx],
        [-5.75, 1.88, 0.04, 0.26, 0.2, 2.4, sx],
        [-6.15, 1.92, 0.04, 0.26, 0.2, 2.4, sx],
        [-6.25, 1.95, 0.02, 0.12, 0.08, 2, sx],
      ],
      { segs: 12, steps: 2 }
    );
  }
  return m;
}

/** Medar, tvärbommar, masten och avgasrören (mörk metall). */
function buildFrame() {
  const m = new Mesh();
  for (const sx of [-1, 1]) {
    const x = sx * 1.18;
    tube(
      m,
      [
        [x, 0.08, -1.45],
        [x, 0.06, -1.2],
        [x, 0.06, 0.8],
        [x, 0.06, 1.75],
        [x, 0.12, 2.1],
        [x, 0.32, 2.3],
        [x, 0.42, 2.34],
      ],
      0.055,
      { segs: 10, steps: 5 }
    );
    // Avgasrören bak på motorkåpan
    tube(m, [[sx * 0.3, 2.24, -2.05], [sx * 0.37, 2.26, -2.35], [sx * 0.5, 2.34, -2.62]], 0.14, { segs: 14, steps: 3, caps: 'start' });
    tube(m, [[sx * 0.36, 2.255, -2.3], [sx * 0.45, 2.3, -2.52]], 0.125, { segs: 14, steps: 1 }); // sotigt innanför
  }
  for (const z of [1.05, -0.75]) {
    tube(
      m,
      [
        [-1.18, 0.06, z],
        [-1.1, 0.3, z],
        [-0.85, 0.42, z],
        [0.85, 0.42, z],
        [1.1, 0.3, z],
        [1.18, 0.06, z],
      ],
      0.05,
      { segs: 10, steps: 5 }
    );
  }
  tube(m, [[HUB[0], 2.3, HUB[2]], [HUB[0], HUB[1] - 0.05, HUB[2]]], 0.11, { segs: 14, steps: 1 });
  return m;
}

/** Vinschen på höger sida ovanför skjutdörren, och antennerna (ljus metall). */
function buildHoist() {
  const m = new Mesh();
  tube(m, [[-0.5, 2.14, 0.55], [-0.9, 2.16, 0.55], [-1.22, 2.12, 0.55]], 0.06, { segs: 8, steps: 2 });
  tube(m, [[-0.5, 2.1, 0.0], [-0.95, 2.14, 0.35], [-1.2, 2.12, 0.5]], 0.045, { segs: 8, steps: 2 });
  loft(
    m,
    [
      [0.2, 2.12, 0.03, 0.03, 0.03, 2, -1.28],
      [0.26, 2.12, 0.15, 0.15, 0.15, 2.4, -1.28],
      [0.95, 2.12, 0.15, 0.15, 0.15, 2.4, -1.28],
      [1.05, 2.12, 0.06, 0.06, 0.06, 2, -1.28],
    ],
    { segs: 16, steps: 1 }
  );
  // Linan och kroken
  tube(m, [[-1.28, 1.98, 0.55], [-1.28, 1.7, 0.55]], 0.012, { segs: 6, steps: 1 });
  tube(m, [[-1.28, 1.72, 0.55], [-1.28, 1.6, 0.55]], 0.04, { segs: 8, steps: 1 });
  // Antenner på bommen och under kabinen
  tube(m, [[0, 2.05, -3.3], [0, 2.32, -3.5]], 0.02, { segs: 6, steps: 1 });
  tube(m, [[0, 2.02, -4.2], [0, 2.22, -4.35]], 0.018, { segs: 6, steps: 1 });
  tube(m, [[0.2, 0.42, -0.4], [0.2, 0.22, -0.55]], 0.02, { segs: 6, steps: 1 });
  return m;
}

/** Lamporna: blinkljuset på bommen och lanternorna (ritas självlysande). */
const LAMPS = [
  { at: [0, 2.08, -2.95], color: '#ff2a1a', r: 0.07, flash: true },
  { at: [0.71, 2.1, -6.0], color: '#ff3b2f', r: 0.045 },
  { at: [-0.71, 2.1, -6.0], color: '#3bff7a', r: 0.045 },
  { at: [0, 1.95, -7.92], color: '#ffffff', r: 0.045 },
];
function buildLamp(r) {
  const m = new Mesh();
  loft(m, [[-r, 0, 0.005, 0.005, 0.005, 2], [-r * 0.6, 0, r * 0.8, r * 0.8, r * 0.8, 2], [r * 0.6, 0, r * 0.8, r * 0.8, r * 0.8, 2], [r, 0, 0.005, 0.005, 0.005, 2]], {
    segs: 10,
    steps: 2,
  });
  return m;
}

/** Navet med bladfästen, kring origo; roteras med rotorn. */
function buildHub() {
  const m = new Mesh();
  loft(
    m,
    [
      [-0.14, 0, 0.05, 0.05, 0.05, 2],
      [-0.12, 0, 0.3, 0.3, 0.3, 3],
      [0.08, 0, 0.3, 0.3, 0.3, 3],
      [0.16, 0, 0.16, 0.16, 0.16, 2],
      [0.2, 0, 0.03, 0.03, 0.03, 2],
    ],
    { segs: 20, steps: 2, map: ([x, y, z]) => [x, z, y] }
  );
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const d = [Math.cos(a), 0, -Math.sin(a)];
    tube(m, [scale(d, 0.2), scale(d, 0.7), add(scale(d, 1.0), [0, 0.02, 0])], 0.07, { segs: 8, steps: 1 });
  }
  return m;
}

/** Rotorskivan: en kvadrat i xz-planet som shadern skär till en cirkel med blad. */
function buildDisc() {
  const m = new Mesh();
  const r = ROTOR_R + 0.05;
  m.pos.push(-r, 0, -r, r, 0, -r, r, 0, r, -r, 0, r);
  m.nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
  m.idx.push(0, 1, 2, 0, 2, 3);
  return m;
}

// --- Matriser (kolumnvis, som WebGL) --------------------------------------------------

function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}
function translate(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}
function rotX(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}
function rotY(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}
function rotZ(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
function lookAt(eye, target, up) {
  const f = normalize(sub(target, eye));
  const s = normalize(cross(f, up));
  const u = cross(s, f);
  return new Float32Array([s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -dot(s, eye), -dot(u, eye), dot(f, eye), 1]);
}
function apply(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** sRGB-färg (#rrggbb) till linjära värden. */
function linear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255) ** 2.2);
}

const DEFAULT_LIVERY = { body: '#f4f5f7', accent: '#d3302a', trim: '#ffffff' };

export class Heli3D {
  /**
   * Skapar helikoptern på en egen canvas utanför sidan.
   * @returns {Heli3D|null} null utan WebGL2 (då ritas helikoptern i 2D)
   */
  static create() {
    if (typeof document === 'undefined') return null;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
      return gl ? new Heli3D(canvas, gl) : null;
    } catch (err) {
      console.warn('[Ergcopter] 3D-helikoptern går inte att starta:', err.message);
      return null;
    }
  }

  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    const program = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    this.program = program;
    gl.useProgram(program);
    this.u = {};
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(program, i).name;
      this.u[name] = gl.getUniformLocation(program, name);
    }
    this.aPos = gl.getAttribLocation(program, 'aPos');
    this.aNor = gl.getAttribLocation(program, 'aNor');
    this.parts = {
      body: this.#upload(buildBody()),
      frame: this.#upload(buildFrame()),
      hub: this.#upload(buildHub()),
      disc: this.#upload(buildDisc()),
      hoist: this.#upload(buildHoist()),
      lamps: LAMPS.map((l) => ({ ...l, mesh: this.#upload(buildLamp(l.r)), glow: linear(l.color) })),
    };
    this.box = { x0: 0, y0: 0, w: 0, h: 0 };
  }

  #upload(mesh) {
    const { gl } = this;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = (data, loc) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    };
    buf(mesh.pos, this.aPos);
    buf(mesh.nor, this.aNor);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: mesh.idx.length };
  }

  /**
   * Ritar helikoptern och returnerar var canvasen ska ligga i förhållande till
   * modellens mittpunkt (CENTER) i CSS-pixlar.
   * @param {object} o
   * @param {number} o.pxPerM     skala vid mittpunkten (CSS-pixlar per meter)
   * @param {number} [o.dpr]
   * @param {number} [o.yaw]      kamerans vinkel runt helikoptern (rad), 0 = rakt bakifrån, π/2 = från höger sida
   * @param {number} [o.pitch]    kamerans höjdvinkel (rad), positiv = ovanifrån
   * @param {number} [o.dist]     kamerans avstånd (m)
   * @param {number} [o.roll, o.nose, o.heading]  helikopterns lutning i sidled, nosens lutning och kurs (rad)
   * @param {{angle:number, blur:number}} o.rotor
   * @param {object} [o.livery]   { body, accent, trim }
   * @param {number} [o.dusk]     0–1 kvällsljus
   * @param {number} [o.time]     s, för blinkljuset
   * @returns {{canvas:HTMLCanvasElement, x0:number, y0:number, w:number, h:number, lights:object[]}|null}
   *   lights: lampornas plats (CSS-pixlar från mittpunkten), färg och styrka, för ljusskenet i 2D
   */
  render(o) {
    if (this.lost) return null;
    const { gl, u, canvas } = this;
    const dpr = o.dpr ?? 1;
    const dist = o.dist ?? 18;
    const yaw = o.yaw ?? 0;
    const pitch = o.pitch ?? 0.3;
    const C = CENTER;
    const eye = [
      C[0] - dist * Math.sin(yaw) * Math.cos(pitch),
      C[1] + dist * Math.sin(pitch),
      C[2] - dist * Math.cos(yaw) * Math.cos(pitch),
    ];
    const view = lookAt(eye, C, [0, 1, 0]);
    // Helikopterns hållning kring mittpunkten: kurs, nos och sidlutning
    const model = mul(
      translate(C[0], C[1], C[2]),
      mul(rotY(o.heading ?? 0), mul(rotX(o.nose ?? 0), mul(rotZ(o.roll ?? 0), translate(-C[0], -C[1], -C[2]))))
    );
    const focal = o.pxPerM * dist;
    const tilt = 0.05; // rotorskivan lutar framåt i fart
    const hubModel = mul(model, translate(HUB[0], HUB[1], HUB[2]));
    const discModel = mul(hubModel, mul(rotX(tilt), translate(0, 0.08, 0)));

    // Bildens utsträckning: rotorskivan och kroppens ytterpunkter
    const pts = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      pts.push(apply(discModel, [Math.cos(a) * ROTOR_R, 0, Math.sin(a) * ROTOR_R]));
    }
    for (const x of [-1.35, 1.35]) for (const y of [0, 3.0]) for (const z of [-7.95, 2.9]) pts.push(apply(model, [x, y, z]));
    let [u0, v0, u1, v1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of pts) {
      const q = apply(view, p);
      const zz = Math.max(0.5, -q[2]);
      const sx = (focal * q[0]) / zz;
      const sy = (-focal * q[1]) / zz;
      u0 = Math.min(u0, sx);
      u1 = Math.max(u1, sx);
      v0 = Math.min(v0, sy);
      v1 = Math.max(v1, sy);
    }
    const pad = 6;
    u0 -= pad;
    v0 -= pad;
    const wCss = u1 - u0 + pad;
    const hCss = v1 - v0 + pad;
    const k = Math.min(dpr, MAX_DIM / Math.max(wCss, hCss));
    const want = (x) => Math.ceil((x * k) / SIZE_STEP) * SIZE_STEP;
    const W = want(wCss);
    const H = want(hCss);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    // Projektionen i bildpunkter, med mittpunkten på (-u0, -v0)
    const cxp = -u0 * k;
    const cyp = -v0 * k;
    const f = focal * k;
    const near = 0.5;
    const far = dist + 30;
    const proj = new Float32Array(16);
    proj[0] = (2 * f) / W;
    proj[5] = (2 * f) / H;
    proj[8] = 1 - (2 * cxp) / W;
    proj[9] = (2 * cyp) / H - 1;
    proj[10] = -(far + near) / (far - near);
    proj[11] = -1;
    proj[14] = (-2 * far * near) / (far - near);

    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform3fv(u.uEye, eye);

    // Ljuset som i landskapet: solen högt till höger på dagen, lågt och varmt på kvällen.
    // Kameran tittar längs +z, så "höger i bild" är −x.
    const dusk = o.dusk ?? 0;
    const sunDay = [-0.62, 0.66, -0.42]; // högt till höger och lite bakom kameran, så att ryggen får ljus
    const sunDusk = [-0.62, 0.16, 0.77];
    const sunW = normalize(sunDay.map((v, i) => v + (sunDusk[i] - v) * dusk));
    const sun = apply(rotY(yaw), sunW); // solen står still i bild när kameran går runt helikoptern
    gl.uniform3fv(u.uSun, sun);
    gl.uniform3fv(u.uSunCol, [0, 1, 2].map((i) => [1.0, 0.95, 0.88][i] * 1.9 * (1 - dusk) + [1.0, 0.62, 0.34][i] * 3.0 * dusk));
    gl.uniform3fv(u.uSky, [0, 1, 2].map((i) => [0.42, 0.58, 0.85][i] * (1 - dusk) + [0.55, 0.42, 0.5][i] * dusk));
    gl.uniform3fv(u.uGround, [0, 1, 2].map((i) => [0.16, 0.18, 0.14][i] * (1 - dusk) + [0.18, 0.12, 0.1][i] * dusk));
    const lv = { ...DEFAULT_LIVERY, ...(o.livery ?? {}) };
    gl.uniform3fv(u.uBody, linear(lv.body));
    gl.uniform3fv(u.uAccent, linear(lv.accent));
    gl.uniform3fv(u.uTrim, linear(lv.trim));
    gl.uniform1f(u.uAngle, o.rotor?.angle ?? 0);
    gl.uniform1f(u.uBlur, o.rotor?.blur ?? 0);

    const draw = (part, mat, m) => {
      gl.uniform1i(u.uMat, mat);
      gl.uniformMatrix4fv(u.uModel, false, m);
      gl.bindVertexArray(part.vao);
      gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_INT, 0);
    };
    gl.disable(gl.BLEND);
    draw(this.parts.body, 0, model);
    draw(this.parts.frame, 1, model);
    draw(this.parts.hoist, 3, model);
    // Lamporna: blinkljuset blinkar en gång i sekunden, lanternorna lyser hela tiden
    const time = o.time ?? 0;
    const lights = [];
    for (const lamp of this.parts.lamps) {
      const on = lamp.flash ? Math.max(0, 1 - ((time * 1.1) % 1) * 6) : 1;
      gl.uniform3fv(u.uGlow, lamp.glow.map((v) => v * (0.25 + 0.75 * on) + 0.05));
      draw(lamp.mesh, 4, mul(model, translate(...lamp.at)));
      const q = apply(view, apply(model, lamp.at));
      const zz = Math.max(0.5, -q[2]);
      lights.push({ x: (focal * q[0]) / zz, y: (-focal * q[1]) / zz, color: lamp.color, a: on * (lamp.flash ? 1 : 0.55) });
    }
    draw(this.parts.hub, 1, mul(hubModel, rotY(-(o.rotor?.angle ?? 0))));
    // Rotorskivan sist, genomskinlig och utan att skriva djup
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    draw(this.parts.disc, 2, discModel);
    gl.depthMask(true);
    gl.bindVertexArray(null);

    this.box = { x0: u0, y0: v0, w: W / k, h: H / k };
    return { canvas, ...this.box, lights };
  }
}
