// Hovringsplattan i 3D med WebGL2: en klipphylla högt uppe på ett fjäll med en målad
// helikopterplatta, sedd framifrån och lite ovanifrån när man hovrar i en övning
// (render.js). Bortom hyllans kant syns 3D-landskapet (terrain.js) långt därunder.
//
// Allt räknas per bildpunkt i en enda shader: strålen från kameran träffar hyllans plan
// och bortom kanten syns landskapet. Berget får sin struktur av brus (sprickor, lav,
// grus), plattan målas efter läget på planet så att kanterna blir skarpa. Bilden ändras
// bara när kameran, storleken eller ljuset ändras, så den ritas sällan om; helikopterns
// skugga, dammet och ringen ritas ovanpå i 2D.
//
// Koordinater i meter: plattans mitt i origo, upp +y, bort från kameran +z, höger i bild +x.

/** Kameran: så långt framför plattans mitt (m) och så högt över plattan. */
export const PAD_CAM = { dist: 21, height: 4.35 };

const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uRes;      // canvasens storlek i bildpunkter
uniform float uScale;   // bildpunkter per CSS-pixel
uniform float uCx;      // optiska mitten i sidled (CSS-px)
uniform float uFocal;   // brännvidd (CSS-px)
uniform float uCamH;    // kamerans höjd över plattan
uniform float uCamD;    // kamerans avstånd framför plattans mitt
uniform vec3 uSun;      // riktning mot solen
uniform float uDusk;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1;
    a *= 0.5;
  }
  return s;
}
// Sprickor: tunna mörka linjer där bruset passerar mitten
float cracks(vec2 p) {
  float n = fbm(p * 0.35);
  float w = fwidth(n) * 1.2 + 0.004;
  return 1.0 - smoothstep(0.0, w + 0.012, abs(n - 0.5));
}
// 1 innanför (d < 0), mjuk kant en bildpunkt bred
float inside(float d) {
  float w = max(fwidth(d), 1e-4);
  return clamp(0.5 - d / w, 0.0, 1.0);
}

// Hyllans bortre kant (z i m) som funktion av x: ojämn, och den viker av mot kameran åt höger
float rimZ(float x) {
  return 10.8 + 3.0 * (fbm(vec2(x * 0.11, 1.7)) - 0.5) * 2.0 + 0.8 * sin(x * 0.37) - 0.03 * max(0.0, x - 8.0) * max(0.0, x - 8.0)
    - 0.03 * max(0.0, -x - 8.0) * max(0.0, -x - 8.0);
}

vec3 tonemap(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  // CSS-pixel i canvasen; canvasens överkant ligger på horisonten
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec3 eye = vec3(0.0, uCamH, -uCamD);
  vec3 dir = normalize(vec3((px.x - uCx) / uFocal, -px.y / uFocal, 1.0));

  float t = dir.y < -1e-4 ? uCamH / -dir.y : 1e9;
  vec3 p = eye + dir * t;
  float rim = rimZ(p.x);
  // Bortom kanten: ingenting, där syns landskapet bakom
  float alpha = inside(p.z - rim);
  if (alpha <= 0.0 || t > 900.0) discard;

  vec3 L = normalize(uSun);
  vec3 sunCol = mix(vec3(1.0, 0.86, 0.66) * 3.4, vec3(1.0, 0.62, 0.36) * 3.4, uDusk);
  vec3 sky = mix(vec3(0.32, 0.45, 0.72), vec3(0.45, 0.36, 0.48), uDusk);
  vec3 col;
  vec3 N;
  vec2 g = p.xz;
  // Berget: ljus granit med flammor, sprickor, grus och lav
  float big = fbm(g * 0.18);
  float mid = fbm(g * 0.9 + 11.0);
  float fine = noise(g * 7.0);
  col = mix(vec3(0.22, 0.21, 0.19), vec3(0.44, 0.41, 0.36), big);
  col *= 0.72 + 0.45 * mid;
  col *= 0.85 + 0.3 * fine;
  // Hällens skikt: stora flak med mörka fogar
  col *= 1.0 - 0.3 * cracks(g * 0.45 + 30.0) * smoothstep(0.45, 0.65, noise(g * 0.6 + 8.0));
  col = mix(col, col * vec3(1.12, 1.0, 0.86), smoothstep(0.4, 0.7, fbm(g * 0.3 + 17.0))); // varmare flammor
  col = mix(col, vec3(0.40, 0.42, 0.24), smoothstep(0.62, 0.8, fbm(g * 0.5 + 3.0)) * 0.55); // lav och mossa
  col = mix(col, vec3(0.62, 0.48, 0.30), smoothstep(0.7, 0.85, fbm(g * 1.4 + 9.0)) * 0.35); // rostfläckar
  col *= 1.0 - 0.45 * cracks(g * 1.1) * smoothstep(0.4, 0.6, noise(g * 0.9 + 3.0));
  col *= 1.0 - 0.3 * cracks(g * 3.3 + 50.0) * smoothstep(0.5, 0.7, noise(g * 1.3));
  // Ojämn häll: stora buckler och små knölar (svagare på plattan, som är slipad)
  float e = 0.06;
  float bump = 1.0 - 0.7 * inside(length(g) - 8.2);
  vec2 q0 = g * 0.7;
  vec2 q1 = g * 3.0 + 7.0;
  float h0 = fbm(q0) + 0.35 * noise(q1);
  float hx = fbm(q0 + vec2(e * 0.7, 0.0)) + 0.35 * noise(q1 + vec2(e * 3.0, 0.0));
  float hz = fbm(q0 + vec2(0.0, e * 0.7)) + 0.35 * noise(q1 + vec2(0.0, e * 3.0));
  N = normalize(vec3(-(hx - h0) / e * 0.35 * bump, 1.0, -(hz - h0) / e * 0.35 * bump));
  // Nära kanten: mörkare sten, lingonris och gräs i skrevorna
  float edge = smoothstep(3.5, 0.0, rim - p.z);
  vec3 scrub = mix(vec3(0.10, 0.14, 0.06), vec3(0.36, 0.30, 0.12), fbm(g * 2.3));
  col = mix(col, scrub, edge * 0.85 * smoothstep(0.3, 0.55, fbm(g * 1.1 + 5.0)));
  col *= 1.0 - 0.45 * smoothstep(0.9, 0.0, rim - p.z);

  // Plattan: slätare sten med färgen målad direkt på hällen: gul streckad cirkel, ett H och en mittlinje mot kameran
  float r = length(g);
  float slab = inside(r - 8.2);
  vec3 concrete = mix(vec3(0.30, 0.30, 0.29), vec3(0.40, 0.39, 0.37), fbm(g * 0.6 + 2.0));
  concrete *= 0.92 + 0.12 * noise(g * 5.0);
  concrete *= 1.0 - 0.4 * cracks(g * 0.8 + 20.0) * 0.6;
  // Avgassot och slitage mitt på plattan
  concrete *= 1.0 - 0.18 * smoothstep(5.0, 0.0, r) * fbm(g * 0.9);
  col = mix(col, concrete, slab * 0.35);
  float wear = 0.55 + 0.45 * smoothstep(0.2, 0.5, fbm(g * 2.5 + 40.0)); // nött färg
  vec3 yellow = vec3(0.98, 0.72, 0.06);
  float ang = atan(g.y, g.x);
  float dash = step(0.42, fract(ang * 34.0 / 6.2831853));
  float ring = inside(abs(r - 6.3) - 0.15) * dash;
  float cl = inside(abs(g.x) - 0.13) * step(g.y, -6.75) * step(-11.5, g.y) * step(fract(g.y * 0.5), 0.55);
  float hl = inside(abs(abs(g.x) - 1.0) - 0.22) * inside(abs(g.y) - 1.55);
  float hm = inside(abs(g.x) - 1.0) * inside(abs(g.y) - 0.2);
  float circ = inside(abs(r - 2.75) - 0.12);
  float paint = max(max(ring, cl), max(max(hl, hm), circ)) * wear;
  col = mix(col, yellow, paint * 0.92);

  col = pow(col, vec3(2.2)); // färgerna ovan är valda i sRGB, ljuset räknas linjärt
  float ndl = max(dot(N, L), 0.0);
  vec3 amb = mix(vec3(0.20, 0.19, 0.16), sky, N.y * 0.5 + 0.5);
  vec3 c = col * (amb * 1.1 + sunCol * ndl);
  // Lite blank glans i flack vinkel, som på slipad sten
  vec3 V = -dir;
  vec3 H = normalize(L + V);
  c += sunCol * pow(max(dot(N, H), 0.0), 40.0) * 0.06;
  // Dis med avståndet, mot horisontens ljusa blå
  float fog = 1.0 - exp(-t / 260.0);
  c = mix(c, mix(vec3(0.45, 0.55, 0.72), vec3(0.6, 0.42, 0.38), uDusk), fog);
  c = pow(tonemap(c), vec3(1.0 / 2.2));
  outColor = vec4(c * alpha, alpha);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

export class HoverPad {
  /**
   * Skapar plattan på en egen canvas utanför sidan.
   * @returns {HoverPad|null} null utan WebGL2 (då hovrar man i sidovyn som förut)
   */
  static create() {
    if (typeof document === 'undefined') return null;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true });
      return gl ? new HoverPad(canvas, gl) : null;
    } catch (err) {
      console.warn('[Ergcopter] Hovringsplattan går inte att starta:', err.message);
      return null;
    }
  }

  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.lost = false;
    this.key = '';
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.program = p;
    this.u = {};
    for (const name of ['uRes', 'uScale', 'uCx', 'uFocal', 'uCamH', 'uCamD', 'uSun', 'uDusk']) this.u[name] = gl.getUniformLocation(p, name);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  /**
   * Ritar hyllan och plattan från horisonten och nedåt. Ritar bara om när något ändrats.
   * @param {object} o
   * @param {number} o.width, o.height  canvasens storlek i CSS-pixlar (överkanten på horisonten)
   * @param {number} o.cx               optiska mitten i sidled (CSS-px)
   * @param {number} o.focal            brännvidden (CSS-px)
   * @param {number} [o.scale]          bildpunkter per CSS-pixel
   * @param {number[]} o.sun            riktning mot solen (x höger, y upp, z bort)
   * @param {number} [o.dusk]
   * @returns {HTMLCanvasElement|null}
   */
  render(o) {
    if (this.lost) return null;
    const { gl, canvas, u } = this;
    const scale = o.scale ?? 1;
    const w = Math.max(1, Math.round(o.width * scale));
    const h = Math.max(1, Math.round(o.height * scale));
    const key = [w, h, o.cx, o.focal, ...o.sun, o.dusk ?? 0].map((v) => Math.round(v * 100)).join(',');
    if (key === this.key) return canvas;
    this.key = key;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform2f(u.uRes, w, h);
    gl.uniform1f(u.uScale, scale);
    gl.uniform1f(u.uCx, o.cx);
    gl.uniform1f(u.uFocal, o.focal);
    gl.uniform1f(u.uCamH, PAD_CAM.height);
    gl.uniform1f(u.uCamD, PAD_CAM.dist);
    gl.uniform3fv(u.uSun, o.sun);
    gl.uniform1f(u.uDusk, o.dusk ?? 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    return canvas;
  }
}

// ---------------------------------------------------------------------------
// Bilden runt plattan i 2D: var allt hamnar, helikopterns skugga, rotorvinden,
// den lysande målringen och etiketten. Allt i samma kamera som shadern ovan.

/** Inramningen som andelar av skärmen: helikoptern till vänster om panelerna. */
const FRAME = { x: 0.31, horizon: 0.31, mPerW: 0.05 };
const RING = { r: 4.0, y: 0.15 }; // målringen: radie och höjd över plattan (m)
const HOVER_LIFT = 1.6; // m som helikoptern flyttar sig i bild när man är vid bandets kant
const LOW = 2.4; // helikopterns mitt aldrig lägre än så här över plattan (medarna knappt en meter ovanför)
const HIGH = 2.6; // och högst så här mycket över målhöjden i bild

/**
 * Kamerans mått i CSS-pixlar för en skärm W × H.
 * @returns {{cx:number, horizon:number, focal:number, pxPerM:number}}
 */
export function hoverFrame(W, H) {
  const pxPerM = FRAME.mPerW * Math.min(W, H * 1.43);
  return { cx: W * FRAME.x, horizon: H * FRAME.horizon, focal: pxPerM * PAD_CAM.dist, pxPerM };
}

/**
 * Helikopterns mitt över plattan (m) för avvikelsen d = höjd − mål. Inom bandet följer den
 * avvikelsen rakt av; utanför planar den ut, så att den aldrig sjunker ned i plattan.
 * @param {number} d    m över målhöjden
 * @param {number} tol  bandets halva bredd (m)
 */
export function hoverHeight(d, tol) {
  const x = d / Math.max(1, tol);
  const base = PAD_CAM.height;
  if (x >= 1) return base + HOVER_LIFT + (HIGH - HOVER_LIFT) * Math.tanh((x - 1) * 1.2);
  const room = base - LOW - HOVER_LIFT;
  if (x <= -1) return base - HOVER_LIFT - room * Math.tanh((-x - 1) * 1.2);
  return base + HOVER_LIFT * x;
}

/** En punkt på plattan (x, y, z i m) till skärmen. */
export function padProject(f, x, y, z) {
  const depth = z + PAD_CAM.dist;
  return { x: f.cx + (f.focal * x) / depth, y: f.horizon + (f.focal * (PAD_CAM.height - y)) / depth, k: f.focal / depth };
}

/** Riktningen mot solen i plattans koordinater, samma som helikopterns ljus (heli3d.js). */
export function padSun(dusk = 0) {
  const day = [0.82, 0.5, 0.3];
  const eve = [0.62, 0.16, 0.77];
  const s = day.map((v, i) => v + (eve[i] - v) * dusk);
  const n = Math.hypot(...s);
  return s.map((v) => v / n);
}

/** En vågrät cirkel (mitt x, y, z och radie r) som ellips i bild. */
function flatEllipse(f, x, y, z, r) {
  const p = padProject(f, x, y, z);
  const depth = z + PAD_CAM.dist;
  return { x: p.x, y: p.y, rx: p.k * r, ry: (p.k * r * (PAD_CAM.height - y)) / depth };
}

/** Mjuk mörk fläck i form av en ellips, för skuggor. */
function softBlob(ctx, e, a) {
  if (e.rx < 1 || e.ry < 0.5) return;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.scale(1, e.ry / e.rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, e.rx);
  g.addColorStop(0, `rgb(18 22 30 / ${a})`);
  g.addColorStop(0.55, `rgb(18 22 30 / ${a * 0.75})`);
  g.addColorStop(1, 'rgb(18 22 30 / 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, e.rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Helikopterns skugga på plattan: kroppen, bommen och rotorskivan, förskjutna bort från solen.
 * @param {number} hh  helikopterns mitt över plattan (m)
 */
export function drawHeliShadow(ctx, f, hh, sun, alpha) {
  const s = sun;
  const dx = (-s[0] / s[1]) * hh;
  const dz = (-s[2] / s[1]) * hh;
  const a = alpha * Math.max(0.25, 1 - (hh - 2) / 9);
  softBlob(ctx, flatEllipse(f, dx, 0, dz, 5.0), 0.12 * a); // rotorskivan
  softBlob(ctx, { ...flatEllipse(f, dx, 0, dz - 1.6, 1.2), ry: flatEllipse(f, dx, 0, dz - 1.6, 2.8).ry }, 0.55 * a); // kabinen
  // Bommen bakåt (bort från kameran), smal
  const p0 = padProject(f, dx, 0, dz + 0.6);
  const p1 = padProject(f, dx, 0, dz + 6.2);
  ctx.save();
  ctx.strokeStyle = `rgb(18 22 30 / ${0.35 * a})`;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, p0.k * 0.45);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
  ctx.restore();
}

let dustSprite = null;
/** Ett mjukt dammoln, ritat en gång och sedan skalat. */
function dust() {
  if (dustSprite || typeof document === 'undefined') return dustSprite;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(48, 48, 0, 48, 48, 48);
  g.addColorStop(0, 'rgb(236 222 196 / 0.55)');
  g.addColorStop(0.45, 'rgb(220 204 176 / 0.28)');
  g.addColorStop(1, 'rgb(210 196 170 / 0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 96, 96);
  dustSprite = c;
  return c;
}

/**
 * Rotorvinden: en ljus pelare under helikoptern och damm som virvlar utåt över plattan.
 * @param {'back'|'front'} part  dammet bakom plattans mitt ritas före helikoptern
 */
export function drawDownwash(ctx, f, hh, t, alpha, part) {
  const sprite = dust();
  const near = Math.max(0, Math.min(1, 1.25 - (hh - 2) / 6)); // mer damm nära plattan
  const a = alpha * (0.35 + 0.65 * near);
  if (part === 'front') {
    // Pelaren: luften som trycks ned genom rotorn
    const top = padProject(f, 0, hh - 1.3, 0);
    const bottom = padProject(f, 0, 0.1, 0);
    const w0 = top.k * 0.35;
    const w1 = bottom.k * 1.1;
    const g = ctx.createLinearGradient(0, top.y, 0, bottom.y);
    g.addColorStop(0, 'rgb(255 248 232 / 0)');
    g.addColorStop(0.3, `rgb(255 246 226 / ${0.08 * a})`);
    g.addColorStop(1, `rgb(240 226 200 / ${0.3 * a})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(top.x - w0, top.y);
    ctx.lineTo(top.x + w0, top.y);
    ctx.lineTo(bottom.x + w1, bottom.y);
    ctx.lineTo(bottom.x - w1, bottom.y);
    ctx.closePath();
    ctx.fill();
    // Den ljusa kärnan rakt ned från magen, och ett dammoln där den slår i plattan
    const core = ctx.createLinearGradient(0, top.y, 0, bottom.y);
    core.addColorStop(0, 'rgb(255 252 240 / 0)');
    core.addColorStop(0.3, `rgb(255 252 240 / ${0.5 * a})`);
    core.addColorStop(1, `rgb(255 244 222 / ${0.75 * a})`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.moveTo(top.x - w0 * 0.2, top.y);
    ctx.lineTo(top.x + w0 * 0.2, top.y);
    ctx.lineTo(bottom.x + w1 * 0.16, bottom.y);
    ctx.lineTo(bottom.x - w1 * 0.16, bottom.y);
    ctx.closePath();
    ctx.fill();
    if (sprite) {
      for (let i = 0; i < 3; i++) {
        const size = bottom.k * (1.6 + i * 0.9 + 0.2 * Math.sin(t * 2 + i));
        ctx.globalAlpha = a * (0.7 - i * 0.15);
        ctx.drawImage(sprite, bottom.x - size, bottom.y - size * 0.75, size * 2, size * 1.1);
      }
      ctx.globalAlpha = 1;
    }
  }
  if (!sprite) return;
  // Dammet: puffar som föds vid mitten och driver utåt längs plattan
  const N = 26;
  for (let i = 0; i < N; i++) {
    const seed = Math.sin(i * 91.7) * 43758.5453;
    const rnd = seed - Math.floor(seed);
    const ang = (i / N) * Math.PI * 2 + rnd * 0.5;
    const back = Math.sin(ang) > 0;
    if ((part === 'back') !== back) continue;
    const age = (t * (0.32 + 0.18 * rnd) + rnd) % 1;
    const r = 1.2 + age * (6.5 + 3 * rnd);
    const p = padProject(f, Math.cos(ang) * r, 0.25 + age * 0.9, Math.sin(ang) * r);
    const size = p.k * (1.0 + age * 2.4);
    ctx.globalAlpha = a * Math.sin(Math.PI * age) * 0.8;
    ctx.drawImage(sprite, p.x - size, p.y - size * 0.6, size * 2, size * 1.2);
  }
  ctx.globalAlpha = 1;
}

const ringCache = new Map(); // ringens halvor, ritade en gång per storlek och läge

/** En halva av ringen med sitt sken, på en egen canvas (skenet med shadowBlur är dyrt att rita varje bild). */
function ringHalf(e, part, inside) {
  const key = [Math.round(e.rx), Math.round(e.ry), part, inside].join(',');
  let c = ringCache.get(key);
  if (c || typeof document === 'undefined') return c ?? null;
  if (ringCache.size > 8) ringCache.clear();
  const k = e.rx / RING.r; // px per m vid ringen
  const pad = Math.ceil(0.9 * k);
  c = document.createElement('canvas');
  c.width = Math.ceil(2 * (e.rx + pad));
  c.height = Math.ceil(2 * (e.ry + pad));
  c.pad = pad;
  const x = c.getContext('2d');
  const [from, to] = part === 'back' ? [Math.PI, Math.PI * 2] : [0, Math.PI];
  const cx = e.rx + pad;
  const cy = e.ry + pad;
  const arc = (w) => {
    x.lineWidth = w;
    x.beginPath();
    x.ellipse(cx, cy, e.rx, e.ry, 0, from, to);
    x.stroke();
  };
  x.lineCap = 'round';
  // Skenet runt röret, sedan röret och den ljusa kärnan
  x.shadowColor = inside ? 'rgb(40 255 100 / 0.95)' : 'rgb(120 230 150 / 0.6)';
  x.shadowBlur = 0.7 * k;
  x.strokeStyle = inside ? 'rgb(40 225 90)' : 'rgb(110 190 130)';
  arc(0.22 * k);
  arc(0.22 * k);
  x.shadowBlur = 0.12 * k;
  x.shadowColor = 'rgb(160 255 180 / 0.9)';
  x.strokeStyle = inside ? 'rgb(150 255 170)' : 'rgb(190 235 200)';
  arc(0.12 * k);
  x.shadowBlur = 0;
  x.strokeStyle = 'rgb(235 255 238 / 0.9)';
  arc(0.045 * k);
  ringCache.set(key, c);
  return c;
}

/**
 * Målringen: ett lysande grönt rör som ligger på plattan. Halvan bakom ritas före
 * helikoptern och den främre efter. Mattare när man är utanför bandet.
 * @param {'back'|'front'} part
 */
export function drawTargetRing(ctx, f, inside, t, alpha, part) {
  const e = flatEllipse(f, 0, RING.y, 0, RING.r);
  const pulse = inside ? 0.88 + 0.12 * Math.sin(t * 4) : 0.7;
  if (part === 'back') {
    // Ringens sken på plattan runt den
    const spill = flatEllipse(f, 0, 0, 0, RING.r + 1.4);
    ctx.save();
    ctx.translate(spill.x, spill.y);
    ctx.scale(1, spill.ry / spill.rx);
    const g = ctx.createRadialGradient(0, 0, spill.rx * 0.55, 0, 0, spill.rx);
    g.addColorStop(0, 'rgb(60 255 120 / 0)');
    g.addColorStop(0.72, `rgb(60 255 120 / ${(inside ? 0.2 : 0.08) * pulse * alpha})`);
    g.addColorStop(1, 'rgb(60 255 120 / 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, spill.rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const img = ringHalf(e, part, inside);
  if (!img) return;
  ctx.globalAlpha = alpha * pulse;
  ctx.drawImage(img, e.x - e.rx - img.pad, e.y - e.ry - img.pad);
  ctx.globalAlpha = 1;
}

/**
 * Etiketten under plattan, t.ex. "Hovra här 11 / 30 s", med en tunn förloppsstapel.
 * @param {number} progress  0–1
 */
export function drawPadLabel(ctx, f, text, progress, alpha, scale = 1) {
  const p = padProject(f, 0, 0, -7.4);
  const fs = Math.round(20 * scale);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `600 ${fs}px "Barlow Condensed", system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 30 * scale;
  const h = fs * 1.7;
  const x = p.x - w / 2;
  const y = p.y - h / 2;
  ctx.fillStyle = 'rgb(10 22 40 / 0.72)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = 'rgb(120 255 160 / 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (progress > 0) {
    ctx.fillStyle = 'rgb(60 230 110 / 0.9)';
    ctx.beginPath();
    ctx.roundRect(x + h / 2, y + h - 4 * scale, (w - h) * Math.min(1, progress), 2.5 * scale, 1.5 * scale);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, p.x, y + h * 0.47);
  ctx.restore();
}
