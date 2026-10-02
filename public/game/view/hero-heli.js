// Räddningshelikoptern i Fjällräddaren-menyns rubrik (plan.md §2), renderad som en
// belyst 3D-bild: en strålmarschad avståndsfunktion (SDF) i en fragment-shader med
// sol, himmelsljus, mjuka skuggor, ambient ocklusion, blank lack och speglande rutor.
// Bilden tas en gång per storlek och lackering i en tillfällig WebGL-kontext, en remsa
// per bildruta så att menyn inte hackar, och kopieras sedan till rubrikens 2D-canvas.
// Därefter kostar den ingenting per bildruta. Saknas WebGL ritas en reservbild.

const VS = 'attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }';

// Helikopterns koordinater: x framåt (nosen), y uppåt, z mot betraktaren. Nosen
// ligger vid x ≈ 2.6, stjärtfenan vid x ≈ −7.3 och medarna vid y ≈ −1.44.
const FS = `
precision highp float;
uniform vec2 uOrigin;
uniform float uScale;
uniform vec3 uCam, uF, uR, uU, uSun;
uniform vec3 uBody, uAccent;
uniform float uBlade, uBlur;

const int SAMPLES = 4;
const vec3 HUB = vec3(-0.35, 1.78, 0.0);
const float ROTOR = 5.1;

float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float smax(float a, float b, float k) { return -smin(-a, -b, k); }
float sdEllipsoid(vec3 p, vec3 r) { float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / k1; }
float sdRoundBox(vec3 p, vec3 b, float r) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float sdCone(vec3 p, vec3 a, vec3 b, float ra, float rb) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}

// Kroppen: kabin, nos, motorkåpa, stjärtbom, fenor och stabilisator
float body(vec3 p) {
  float cab = sdEllipsoid(p - vec3(-0.4, 0.04, 0.0), vec3(2.4, 1.02, 0.93));
  float nose = sdEllipsoid(p - vec3(1.45, -0.3, 0.0), vec3(1.35, 0.62, 0.76));
  float d = smin(cab, nose, 0.6);
  // Vindrutans lutning: ett snett plan skär av kabinens främre överkant
  d = smax(d, dot(p - vec3(1.45, 0.5, 0.0), vec3(0.6, 0.8, 0.0)), 0.5);
  d = smax(d, abs(p.z) - 0.86, 0.5);
  d = smax(d, -p.y - 0.78, 0.26);
  float cowl = sdRoundBox(p - vec3(-1.0, 0.86, 0.0), vec3(1.25, 0.2, 0.38), 0.2);
  d = smin(d, cowl, 0.36);
  // Avgasrör bak på kåpan
  d = min(d, sdCapsule(vec3(p.x, p.y, abs(p.z)), vec3(-2.05, 0.98, 0.22), vec3(-2.45, 0.92, 0.3), 0.1));
  float boom = sdCone(p, vec3(-1.8, 0.28, 0.0), vec3(-6.7, 0.6, 0.0), 0.5, 0.14);
  d = smin(d, boom, 0.5);
  vec3 f = p - vec3(-6.8, 1.3, 0.0);
  f.x += f.y * 0.5;
  float fin = sdRoundBox(f, vec3(0.34, 0.85, 0.025), 0.05);
  vec3 v = p - vec3(-6.7, -0.1, 0.0);
  v.x -= v.y * 0.6;
  fin = min(fin, sdRoundBox(v, vec3(0.24, 0.5, 0.025), 0.04));
  d = smin(d, fin, 0.14);
  vec3 s = p - vec3(-5.4, 0.52, 0.0);
  s.x += abs(s.z) * 0.12;
  d = min(d, sdRoundBox(s, vec3(0.3, 0.02, 1.0), 0.025));
  d = min(d, sdRoundBox(vec3(s.x, s.y, abs(s.z) - 1.02), vec3(0.22, 0.18, 0.015), 0.02));
  return d;
}

// Medar, mast, nav, vinsch och strålkastare i mörk metall
float metal(vec3 p) {
  vec3 q = vec3(p.x, p.y, abs(p.z));
  float d = sdCapsule(q, vec3(-1.6, -1.38, 0.98), vec3(1.25, -1.38, 0.98), 0.06);
  d = min(d, sdCapsule(q, vec3(1.25, -1.38, 0.98), vec3(1.6, -1.2, 0.98), 0.06));
  d = min(d, sdCapsule(q, vec3(0.78, -0.62, 0.5), vec3(0.86, -1.38, 0.98), 0.052));
  d = min(d, sdCapsule(q, vec3(-1.0, -0.62, 0.5), vec3(-1.06, -1.38, 0.98), 0.052));
  d = min(d, sdCapsule(p, vec3(-0.15, 0.72, 0.62), vec3(-0.15, 0.74, 1.2), 0.06));
  d = min(d, sdRoundBox(p - vec3(-0.15, 0.68, 1.25), vec3(0.16, 0.1, 0.1), 0.04));
  d = min(d, sdEllipsoid(p - vec3(1.4, -0.86, 0.32), vec3(0.16, 0.1, 0.14)));
  d = min(d, sdCapsule(p, vec3(HUB.x, 1.1, 0.0), HUB - vec3(0.0, 0.05, 0.0), 0.12));
  d = min(d, sdEllipsoid(p - HUB, vec3(0.5, 0.16, 0.5)));
  d = min(d, sdCapsule(p, HUB + vec3(0.0, 0.1, 0.0), HUB + vec3(0.0, 0.28, 0.0), 0.08));
  d = min(d, sdCapsule(p, vec3(-6.85, 0.72, 0.08), vec3(-6.85, 0.72, 0.2), 0.09));
  return d;
}

vec2 map(vec3 p) {
  float b = body(p), m = metal(p);
  return b < m ? vec2(b, 1.0) : vec2(m, 3.0);
}

// Rotorbladen räknas analytiskt i stället för i avståndsfunktionen: hur stor del av
// slutartiden (vinkeln uBlur) ett blad täcker punkten ger rörelseoskärpan direkt.
float overlap(float a0, float a1, float b0, float b1) { return max(0.0, min(a1, b1) - max(a0, b0)); }
float bladeCover(vec3 r) {
  float l = length(r.xz);
  if (l < 0.3 || l > ROTOR) return 0.0;
  const float P = 6.2831853 / 5.0; // fem blad
  float hw = mix(0.2, 0.15, l / ROTOR) / l;
  float s0 = mod(atan(r.z, r.x) + uBlade, P);
  float s1 = s0 + uBlur;
  float c = overlap(s0, s1, -hw, hw) + overlap(s0, s1, P - hw, P + hw) + overlap(s0, s1, 2.0 * P - hw, 2.0 * P + hw);
  return c / (uBlur + 2.0 * hw) * smoothstep(ROTOR, ROTOR - 0.05, l) * smoothstep(0.3, 0.5, l);
}

vec3 normalAt(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.0015;
  return normalize(k.xyy * map(p + k.xyy * e).x + k.yyx * map(p + k.yyx * e).x +
                   k.yxy * map(p + k.yxy * e).x + k.xxx * map(p + k.xxx * e).x);
}

float shadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.03;
  for (int i = 0; i < 32; i++) {
    float h = map(ro + rd * t).x;
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.03, 0.6);
    if (res < 0.002 || t > 10.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float occlusion(vec3 p, vec3 n) {
  float o = 0.0, w = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = 0.06 * float(i);
    o += (h - map(p + n * h).x) * w;
    w *= 0.7;
  }
  return clamp(1.0 - 2.2 * o, 0.0, 1.0);
}

vec3 sunCol() { return vec3(1.0, 0.86, 0.7) * 2.5; }

vec3 sky(vec3 d) {
  vec3 zen = vec3(0.16, 0.34, 0.72), hor = vec3(0.92, 0.88, 0.84), gnd = vec3(0.07, 0.065, 0.06);
  vec3 c = d.y > 0.0 ? mix(hor, zen, pow(d.y, 0.5)) : mix(hor * 0.55, gnd, pow(-d.y, 0.35));
  // Fjällkedja och moln som rutorna och lacken kan spegla
  float az = atan(d.z, d.x);
  float ridge = 0.06 + 0.05 * sin(az * 5.0 + 1.0) + 0.03 * sin(az * 13.0 + 2.0);
  c = mix(c, vec3(0.2, 0.25, 0.33), smoothstep(ridge + 0.01, ridge - 0.01, d.y) * step(-0.02, d.y));
  c = mix(c, vec3(1.0), 0.35 * smoothstep(0.2, 0.7, sin(az * 3.0) * sin(az * 7.0 + d.y * 9.0)) * smoothstep(0.1, 0.25, d.y) * smoothstep(0.6, 0.3, d.y));
  return c + sunCol() * pow(max(dot(d, uSun), 0.0), 300.0) * 6.0;
}

float box2(vec2 p, vec2 c, vec2 b, float r) { vec2 q = abs(p - c) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float line(float d, float w) { return 1.0 - smoothstep(0.0, w, abs(d)); }

// Lackeringen: x = röd dekor (0–1), y = glas, z = panelfog
vec3 livery(vec3 p) {
  float side = smoothstep(0.35, 0.6, abs(p.z));
  // Rutor: vindrutan runt nosen, två sidofönster och fönster i nosens underdel
  float ws = step(1.02, p.x) * step(p.x, 2.45) * step(-0.12 + 0.08 * (p.x - 1.0), p.y) * step(p.y, 0.68);
  ws *= 1.0 - step(abs(p.z), 0.03) * step(1.5, p.x);
  float w1 = box2(p.xy, vec2(0.36, 0.24), vec2(0.52, 0.42), 0.14);
  float w2 = box2(p.xy, vec2(-0.82, 0.24), vec2(0.5, 0.4), 0.14);
  float chin = step(1.8, p.x) * step(p.x, 2.55) * step(-0.66, p.y) * step(p.y, -0.3) * step(0.22, abs(p.z));
  float glass = max(max(ws, side * step(min(w1, w2), 0.0)), chin);
  // Röda partier: tak och motorkåpa, band under rutorna, stjärtbommens översida och fenorna
  float red = step(0.72, p.y) * step(p.x, 0.95);
  red = max(red, step(-0.6, p.y) * step(p.y, -0.16 - 0.1 * max(p.x - 1.0, 0.0)) * step(-2.2, p.x) * (1.0 - chin));
  red = max(red, step(p.x, -1.9) * step(0.3 + (-p.x - 1.9) * 0.065, p.y));
  red = max(red, step(p.x, -6.2));
  red *= 1.0 - step(abs(p.y - 1.15), 0.08) * step(p.x, -6.2); // vit rand i fenan
  // Panelfogar: dörrkanter, rutornas lister, kåpans kant och bommens skarv
  float seam = side * line(p.x + 1.3, 0.018) * step(-0.75, p.y) * step(p.y, 0.72);
  seam = max(seam, side * line(p.x - 0.95, 0.018) * step(-0.75, p.y) * step(p.y, 0.7));
  seam = max(seam, side * line(min(w1, w2) - 0.05, 0.018));
  seam = max(seam, line(p.x + 2.2, 0.016) * step(p.x, -1.5));
  seam = max(seam, side * line(p.y - 0.6, 0.016) * step(-2.0, p.x) * step(p.x, 0.2));
  return vec3(red * (1.0 - glass), glass, seam);
}

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

vec3 shade(vec3 p, vec3 rd, float mat) {
  vec3 n = normalAt(p);
  float ao = occlusion(p, n);
  float sh = shadow(p + n * 0.01, uSun);
  float dif = max(dot(n, uSun), 0.0) * sh;
  vec3 amb = mix(vec3(0.1, 0.09, 0.09), vec3(0.3, 0.4, 0.6), n.y * 0.5 + 0.5) * ao;
  amb += vec3(0.26, 0.22, 0.18) * clamp(-n.y, 0.0, 1.0) * ao * 0.6; // varm reflex från marken
  vec3 rf = reflect(rd, n);
  float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 5.0);
  float spec = pow(max(dot(rf, uSun), 0.0), 160.0) * sh;
  vec3 env = sky(rf) * mix(0.35, 1.0, ao) * mix(0.5, 1.0, smoothstep(-0.3, 0.3, rf.y));
  if (mat > 2.0) {
    vec3 alb = vec3(0.05, 0.055, 0.06);
    return alb * (sunCol() * dif + amb) + env * (0.05 + 0.95 * fres) * 0.5 + sunCol() * spec * 0.6;
  }
  vec3 l = livery(p);
  if (l.y > 0.5) {
    vec3 inside = vec3(0.012, 0.014, 0.018);
    return inside * (amb + dif) + env * mix(0.045, 1.0, 0.06 + 0.94 * fres) * vec3(0.8, 0.9, 1.0) + sunCol() * spec * 2.5;
  }
  vec3 alb = mix(toLinear(uBody) * 0.66, toLinear(uAccent) * vec3(0.7, 0.5, 0.52), l.x);
  alb *= 1.0 - 0.55 * l.z;
  float f = 0.06 + 0.94 * fres;
  vec3 col = alb * (sunCol() * dif * 0.85 + amb) * (1.0 - f * 0.5) + env * f * 0.9 + sunCol() * spec * 1.4;
  return col + sunCol() * pow(max(dot(rf, uSun), 0.0), 18.0) * sh * 0.05; // bred lackglans
}

vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

void main() {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    float fi = float(i);
    // Roterat 2×2-rutnät för kantutjämningen
    vec2 jit = vec2(fract(fi * 0.5) - 0.25, floor(fi * 0.5) * 0.5 - 0.25);
    jit = vec2(jit.x * 0.9 - jit.y * 0.44, jit.x * 0.44 + jit.y * 0.9);
    vec2 uv = uOrigin + (gl_FragCoord.xy + jit) * uScale;
    vec3 rd = normalize(uF + uR * uv.x + uU * uv.y);
    vec3 ro = uCam;
    // Begränsande klot runt helikoptern, rotorn inräknad
    vec3 oc = ro - vec3(-1.9, 0.3, 0.0);
    float bq = dot(oc, rd), disc = bq * bq - dot(oc, oc) + 56.0;
    vec4 c = vec4(0.0);
    float tHit = 1e9;
    if (disc > 0.0) {
      float t = max(-bq - sqrt(disc), 0.0), tEnd = -bq + sqrt(disc);
      for (int s = 0; s < 120; s++) {
        vec2 h = map(ro + rd * t);
        if (h.x < 0.0006 * t) {
          c = vec4(shade(ro + rd * t, rd, h.y), 1.0);
          tHit = t;
          break;
        }
        t += h.x * 0.9;
        if (t > tEnd) break;
      }
      // Rotorbladen: skär strålen med rotorkonen (bladen böjs uppåt) och lägg på täckningen
      float tp = (HUB.y - ro.y) / rd.y;
      vec3 r = ro + rd * tp - HUB;
      tp = (HUB.y + length(r.xz) * 0.035 - ro.y) / rd.y;
      r = ro + rd * tp - HUB;
      if (tp > 0.0 && tp < tHit) {
        float l = length(r.xz);
        vec3 rf = reflect(rd, vec3(0.0, rd.y > 0.0 ? -1.0 : 1.0, 0.0));
        vec3 bc = vec3(0.03, 0.033, 0.036) + sky(rf) * 0.06;
        float veil = 0.035 * smoothstep(ROTOR, ROTOR - 0.3, l) * smoothstep(0.3, 1.0, l); // skivans slöja
        float a = clamp(bladeCover(r) * 0.92 + veil, 0.0, 1.0);
        c = vec4(mix(c.rgb, bc, a), mix(c.a, 1.0, a));
      }
    }
    vec3 g = pow(aces(c.rgb * 1.05), vec3(1.0 / 2.2));
    g = mix(vec3(dot(g, vec3(0.3, 0.55, 0.15))), g, 0.88); // lite dämpad mättnad, som ett foto
    acc += vec4(g * c.a, c.a);
  }
  gl_FragColor = acc / float(SAMPLES);
}
`;

const PITCH = -0.07; // nosen lite nedåt, i fart framåt
const YAW = 0.62; // kameran vriden mot nosen
const ELEV = -0.04; // kameran strax under rotorplanet
const DIST = 17;
const TARGET = [-2.1, 0.2, 0];
const SUN = [0.75, 0.6, 0.35];
// Punkter som ska rymmas: fenan, nosen, medarna, navet och vinschen (rotorbladen får gå utanför)
const FIT_POINTS = [
  [-7.5, 2.18, 0], [-7.1, -0.62, 0], [2.6, -0.2, 0], [1.62, -1.2, 0.98], [1.62, -1.2, -0.98],
  [-1.65, -1.44, 0.98], [-1.65, -1.44, -0.98], [-0.35, 1.95, 0], [2.0, 0.6, 0.6], [-0.15, 0.7, 1.3],
];
const ROWS_PER_FRAME = 24; // remsans höjd i pixlar: en remsa per bildruta

const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => a.map((x) => x / Math.hypot(...a));
const rotZ = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]];

/** Kameran i helikopterns koordinater (helikoptern lutar PITCH i världen). */
function camera() {
  const dir = [Math.sin(YAW) * Math.cos(ELEV), Math.sin(ELEV), Math.cos(YAW) * Math.cos(ELEV)];
  const camW = TARGET.map((x, i) => x + dir[i] * DIST);
  const f = norm(sub(TARGET, camW));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const toHeli = (v) => rotZ(v, -PITCH);
  return { pos: toHeli(camW), f: toHeli(f), r: toHeli(r), u: toHeli(u) };
}

/**
 * Var bilden placeras: helikoptern ryms i rutan [x0, y0, x1, y1] (andelar av canvasen,
 * y uppifrån) och förankras nere till vänster. Returnerar origin och skala för shadern.
 */
function framing(cam, w, h, rect) {
  const pts = FIT_POINTS.map((p) => {
    const d = sub(p, cam.pos);
    const z = dot(d, cam.f);
    return [dot(d, cam.r) / z, dot(d, cam.u) / z];
  });
  const umin = Math.min(...pts.map((p) => p[0]));
  const umax = Math.max(...pts.map((p) => p[0]));
  const vmin = Math.min(...pts.map((p) => p[1]));
  const vmax = Math.max(...pts.map((p) => p[1]));
  const [x0, y0, x1, y1] = rect;
  const scale = Math.max((umax - umin) / ((x1 - x0) * w), (vmax - vmin) / ((y1 - y0) * h));
  return { origin: [umin - x0 * w * scale, vmin - (1 - y1) * h * scale], scale };
}

function rgb(hex) {
  const s = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
}

function shader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}

/**
 * Rubrikens helikopterbild. Ritar om sig själv när canvasen byter storlek, och bara då
 * eller när lackeringen ändras.
 */
export class HeroHeli {
  #canvas;
  #fallback;
  #livery = null;
  #rect;
  #drawn = ''; // storlek och lackering för bilden som visas
  #job = null; // pågående rendering

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {(canvas: HTMLCanvasElement, livery: object) => void} fallback  ritar utan WebGL
   * @param {number[]} [rect]  rutan helikoptern ska rymmas i: [x0, y0, x1, y1] som andelar
   */
  constructor(canvas, fallback, rect = [0.06, 0.2, 0.96, 0.985]) {
    this.#canvas = canvas;
    this.#fallback = fallback;
    this.#rect = rect;
    new ResizeObserver(() => this.#update()).observe(canvas);
  }

  /** Visa helikoptern med den här lackeringen ({ body, accent } som #rrggbb). */
  show(livery) {
    this.#livery = livery;
    this.#update();
  }

  #update() {
    if (!this.#livery) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.#canvas.clientWidth * dpr);
    const h = Math.round(this.#canvas.clientHeight * dpr);
    if (w < 8 || h < 8) return; // dold
    const key = `${w}x${h} ${this.#livery.body} ${this.#livery.accent}`;
    if (key === this.#drawn || key === this.#job?.key) return;
    this.#job?.stop();
    this.#job = this.#render(w, h, key);
  }

  #useFallback(w, h, key) {
    this.#canvas.width = w;
    this.#canvas.height = h;
    this.#fallback(this.#canvas, this.#livery);
    this.#drawn = key;
  }

  /** Startar en rendering i remsor; returnerar jobbet ({ key, stop }) eller null. */
  #render(w, h, key) {
    const gc = document.createElement('canvas');
    gc.width = w;
    gc.height = h;
    const gl = gc.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, preserveDrawingBuffer: true });
    if (!gl) {
      this.#useFallback(w, h, key);
      return null;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    // Kompileringen får gå i bakgrunden när webbläsaren kan det
    const parallel = gl.getExtension('KHR_parallel_shader_compile');
    const livery = this.#livery;
    let row = -1; // -1 = väntar på shadern
    let frame = 0;
    const done = () => {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      if (this.#job === job) this.#job = null;
    };
    const job = {
      key,
      stop: () => {
        cancelAnimationFrame(frame);
        done();
      },
    };
    const step = () => {
      if (gl.isContextLost()) return done();
      if (row < 0) {
        if (parallel && !gl.getProgramParameter(prog, parallel.COMPLETION_STATUS_KHR)) {
          frame = requestAnimationFrame(step);
          return;
        }
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          console.warn('Rubrikens helikopter kunde inte renderas i 3D:', gl.getProgramInfoLog(prog));
          done();
          this.#useFallback(w, h, key);
          return;
        }
        this.#setup(gl, prog, w, h, livery);
        row = 0;
      }
      gl.scissor(0, row, w, ROWS_PER_FRAME);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      row += ROWS_PER_FRAME;
      if (row < h) {
        frame = requestAnimationFrame(step);
        return;
      }
      this.#canvas.width = w;
      this.#canvas.height = h;
      this.#canvas.getContext('2d').drawImage(gc, 0, 0);
      this.#drawn = key;
      done();
    };
    frame = requestAnimationFrame(step);
    return job;
  }

  #setup(gl, prog, w, h, livery) {
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const cam = camera();
    const fr = framing(cam, w, h, this.#rect);
    const set = (name, v) => {
      const l = gl.getUniformLocation(prog, name);
      if (typeof v === 'number') gl.uniform1f(l, v);
      else if (v.length === 2) gl.uniform2fv(l, v);
      else gl.uniform3fv(l, v);
    };
    set('uOrigin', fr.origin);
    set('uScale', fr.scale);
    set('uCam', cam.pos);
    set('uF', cam.f);
    set('uR', cam.r);
    set('uU', cam.u);
    set('uSun', norm(rotZ(SUN, -PITCH)));
    set('uBody', rgb(livery.body));
    set('uAccent', rgb(livery.accent));
    set('uBlade', 0.55);
    set('uBlur', 0.07);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
  }
}
