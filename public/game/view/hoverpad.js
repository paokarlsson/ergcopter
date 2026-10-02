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

// Stenblocken på hyllan (m): mitt c och radier r. Mitten ligger under hällen, så att blocken sitter
// fast i berget. Längs kanten åt båda håll, utspridda mindre block och två i förgrunden.
const BOULDERS = [
  { c: [-9.6, -0.2, 9.4], r: [2.2, 1.9, 1.8] },
  { c: [-7.0, -0.1, 11.4], r: [1.4, 1.3, 1.2] },
  { c: [-5.3, -0.1, 12.4], r: [0.8, 0.7, 0.7] },
  { c: [5.4, -0.1, 11.8], r: [1.1, 1.0, 0.9] },
  { c: [7.5, -0.3, 10.4], r: [2.0, 1.9, 1.7] },
  { c: [10.6, -0.2, 8.6], r: [1.5, 1.4, 1.4] },
  { c: [13.4, -0.5, 7.0], r: [2.6, 2.4, 2.2] },
  { c: [-8.6, 0.0, 2.2], r: [0.5, 0.4, 0.45] },
  { c: [9.6, 0.0, 3.6], r: [0.65, 0.5, 0.55] },
  { c: [11.0, -0.1, -1.5], r: [0.9, 0.75, 0.8] },
  { c: [-3.7, -0.3, -10.4], r: [1.7, 1.4, 1.3] },
  { c: [3.9, -0.3, -9.8], r: [1.2, 1.0, 1.0] },
  { c: [5.2, -0.1, -8.6], r: [0.5, 0.4, 0.45] },
];

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

// Stenblock på hyllan: ellipsoider (mitt och radier i m) som skärs analytiskt. Stora block längs
// kanten bryter den raka kantlinjen mot dalen, några mindre ligger utspridda och två i förgrunden.
const int NB = ${BOULDERS.length};
const vec3 B_C[NB] = vec3[](${BOULDERS.map((b) => `vec3(${b.c.map((v) => v.toFixed(2)).join(', ')})`).join(', ')});
const vec3 B_R[NB] = vec3[](${BOULDERS.map((b) => `vec3(${b.r.map((v) => v.toFixed(2)).join(', ')})`).join(', ')});

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

// Ett stenblock som avståndsfält: en ellipsoid som kapas av några snedställda plan (kantiga
// brottytor), med lite brus i ytan. Ungefärligt avstånd, därför försiktiga steg.
float boulderSDF(vec3 p, int i) {
  vec3 c = B_C[i];
  vec3 r = B_R[i];
  vec3 q = p - c;
  float k0 = length(q / r);
  float k1 = length(q / (r * r));
  float d = k0 * (k0 - 1.0) / max(k1, 1e-4);
  float fi = float(i);
  for (int k = 0; k < 8; k++) {
    float fk = float(k);
    vec3 n = normalize(vec3(hash3(vec3(fi, fk, 1.3)), hash3(vec3(fk, fi, 7.1)), hash3(vec3(fi + fk, 3.7, fk))) - vec3(0.5, 0.3, 0.5));
    float h = (0.42 + 0.3 * hash3(vec3(fk, 9.2, fi))) * dot(abs(n), r);
    d = max(d, dot(q, n) - h);
  }
  d += 0.05 * min(r.x, r.y) * (noise3(p * 2.2) - 0.5) + 0.025 * (noise3(p * 8.0) - 0.5);
  return d;
}

// Strålen genom blockets omslutande klot: avståndet till ytan, eller -1
float marchBoulder(vec3 ro, vec3 rd, int i) {
  vec3 oc = ro - B_C[i];
  float R = max(B_R[i].x, max(B_R[i].y, B_R[i].z)) * 1.08;
  float b = dot(oc, rd);
  float h = b * b - (dot(oc, oc) - R * R);
  if (h < 0.0) return -1.0;
  h = sqrt(h);
  float t = max(-b - h, 0.0);
  float tEnd = -b + h;
  for (int s = 0; s < 56; s++) {
    float d = boulderSDF(ro + rd * t, i);
    if (d < 0.0015 * t) return t;
    t += d * 0.8;
    if (t > tEnd) break;
  }
  return -1.0;
}

// Växtligheten längs hyllans kant: en profil (höjd i m som funktion av x) med låga buskar av
// fjällbjörk och en, och några granar som sticker upp. Den står precis bortom kanten, så att
// kanten mot dalen blir en ojämn rad av ris och träd i stället för en rak linje.
const int NT = 10;
// Granarna: x (m), höjd (m), halva bredden nedtill (m)
const vec3 TREES[NT] = vec3[](vec3(-13.0, 2.2, 0.55), vec3(-11.9, 1.6, 0.42), vec3(-9.0, 1.9, 0.5), vec3(-7.9, 1.3, 0.36),
  vec3(-3.6, 1.1, 0.32), vec3(4.4, 1.2, 0.34), vec3(8.6, 1.8, 0.48), vec3(10.4, 2.3, 0.58), vec3(12.1, 1.5, 0.4), vec3(16.0, 2.4, 0.6));
float bushH(float x) {
  float bush = 0.12 + 0.6 * smoothstep(0.38, 0.72, fbm(vec2(x * 0.3, 5.0)));
  bush *= 0.5 + 0.5 * smoothstep(1.0, 4.0, abs(x)); // lägre rakt bakom helikoptern
  return bush + 0.2 * (noise(vec2(x * 3.1, 1.0)) - 0.5) + 0.12 * (noise(vec2(x * 11.0, 2.0)) - 0.5);
}
// Hur mycket gran som täcker punkten (x, y) i kantens plan, och var i granen den är (för ljuset)
float spruce(vec2 q, out float side) {
  float c = 0.0;
  side = 0.0;
  for (int i = 0; i < NT; i++) {
    vec3 tr = TREES[i];
    float rel = q.y / tr.y;
    if (rel < -0.1 || rel > 1.0) continue;
    // Kvistvarven: bredden sågtandar uppåt, så att kanten blir taggig
    float tiers = 5.0 + tr.y * 2.0;
    float saw = fract(rel * tiers + tr.x);
    float w = tr.z * (1.0 - rel) * (0.62 + 0.38 * saw) + 0.06 * (noise(q * vec2(14.0, 18.0) + tr.x) - 0.5);
    float d = abs(q.x - tr.x) - max(w, 0.0);
    float k = inside(d);
    if (k > c) {
      c = k;
      side = clamp((q.x - tr.x) / max(w, 0.05), -1.0, 1.0) * 0.5 + 0.5 - 0.35 * saw;
    }
  }
  return c;
}

// Granit: ljusgrå häll med flammor, korn, några långa fogar och lavfläckar
vec3 granite(vec2 g, float fw) {
  vec3 col = mix(vec3(0.25, 0.245, 0.235), vec3(0.47, 0.46, 0.43), smoothstep(0.25, 0.75, fbm(g * 0.16)));
  col *= 0.86 + 0.24 * fbm(g * 0.8 + 11.0);
  // Kornen: fältspat och glimmer, tonas bort på avstånd innan de flimrar
  float grain = noise(g * 26.0) - 0.5 + 0.5 * (noise(g * 61.0) - 0.5);
  col *= 1.0 + 0.32 * grain * (1.0 - smoothstep(0.03, 0.12, fw));
  // Vittrade, mörkare partier och varma rostflammor
  col = mix(col, col * vec3(0.78, 0.76, 0.74), smoothstep(0.55, 0.8, fbm(g * 0.09 + 4.0)));
  col = mix(col, col * vec3(1.1, 1.0, 0.86), smoothstep(0.5, 0.75, fbm(g * 0.33 + 17.0)) * 0.6);
  // Långa, raka fogar mellan hällens flak
  col *= 1.0 - 0.38 * cracks(g * 0.32 + 30.0) * smoothstep(0.45, 0.6, noise(g * 0.25 + 8.0));
  col *= 1.0 - 0.14 * cracks(g * 0.9 + 3.0) * smoothstep(0.55, 0.7, noise(g * 0.7 + 3.0));
  // Lav: bleka gröngrå och ockra fläckar
  float lich = smoothstep(0.66, 0.74, fbm(g * 0.55 + 3.0));
  col = mix(col, vec3(0.56, 0.58, 0.46), lich * 0.5);
  col = mix(col, vec3(0.62, 0.5, 0.28), smoothstep(0.72, 0.8, fbm(g * 1.3 + 9.0)) * 0.4);
  return col;
}

void main() {
  // CSS-pixel i canvasen; canvasens överkant ligger på horisonten
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec3 eye = vec3(0.0, uCamH, -uCamD);
  vec3 dir = normalize(vec3((px.x - uCx) / uFocal, -px.y / uFocal, 1.0));

  float t = dir.y < -1e-4 ? uCamH / -dir.y : 1e9;
  vec3 p = eye + dir * t;
  float rim = rimZ(p.x);
  float alpha = t < 900.0 ? inside(p.z - rim) : 0.0;

  // Närmaste stenblock längs strålen
  float tb = 1e9;
  int bi = -1;
  for (int i = 0; i < NB; i++) {
    float ti = marchBoulder(eye, dir, i);
    if (ti > 0.0 && ti < tb) {
      tb = ti;
      bi = i;
    }
  }
  bool rock = bi >= 0 && (tb < t || alpha <= 0.0);

  // Växtligheten: där strålen går över kanten, hur högt över hällens plan den är där
  float tv = (10.8 - eye.z) / max(dir.z, 1e-4);
  for (int k = 0; k < 3; k++) tv = (rimZ(eye.x + tv * dir.x) + 0.35 - eye.z) / max(dir.z, 1e-4);
  vec3 pv = eye + dir * tv;
  float vh = bushH(pv.x);
  float side;
  float treeCov = spruce(pv.xy, side);
  float cov = max(inside(pv.y - vh), treeCov) * (1.0 - alpha);
  if (!rock && alpha <= 0.0 && cov <= 0.0) discard;

  vec3 L = normalize(uSun);
  vec3 sunCol = mix(vec3(1.0, 0.88, 0.7) * 2.9, vec3(1.0, 0.62, 0.36) * 3.4, uDusk);
  vec3 sky = mix(vec3(0.34, 0.47, 0.74), vec3(0.45, 0.36, 0.48), uDusk);
  vec3 col;
  vec3 N;
  float ao = 1.0;
  float shade = 1.0;
  vec3 hit;

  if (rock) {
    // Stenblocket: kantiga brottytor i granit, lav och mossa ovanpå, mörkare mot marken
    hit = eye + dir * tb;
    vec3 c = B_C[bi];
    vec3 r = B_R[bi];
    vec2 h2 = vec2(0.012, -0.012);
    N = normalize(h2.xyy * boulderSDF(hit + h2.xyy, bi) + h2.yyx * boulderSDF(hit + h2.yyx, bi) + h2.yxy * boulderSDF(hit + h2.yxy, bi) + h2.xxx * boulderSDF(hit + h2.xxx, bi));
    float fw = length(fwidth(hit.xz));
    vec2 uv = abs(N.y) > 0.6 ? hit.xz : (abs(N.x) > abs(N.z) ? hit.zy : hit.xy);
    col = granite(uv * 1.6 + float(bi) * 7.0, fw) * 0.85;
    col = mix(col, vec3(0.34, 0.36, 0.24), smoothstep(0.7, 0.95, N.y) * smoothstep(0.55, 0.75, fbm(hit.xz * 2.0)) * 0.4); // lav ovanpå
    // Mörka sprickor och skrevor där brottytorna möts
    col *= 1.0 - 0.35 * smoothstep(0.62, 0.8, noise3(hit * 3.0)) * smoothstep(0.3, 0.0, abs(noise3(hit * 1.7 + 4.0) - 0.5));
    ao = mix(0.3, 1.0, smoothstep(0.0, 0.6 * r.y, hit.y));
    ao *= mix(0.6, 1.0, smoothstep(-0.6, 0.4, N.y));
  } else {
    hit = p;
    vec2 g = p.xz;
    float fw = length(fwidth(g));
    col = granite(g, fw);
    // Ojämn häll: stora buckler och små knölar (svagare på plattan, som är slipad)
    float e = 0.06;
    float bump = 1.0 - 0.7 * inside(length(g) - 8.2);
    vec2 q0 = g * 0.7;
    vec2 q1 = g * 3.0 + 7.0;
    float h0 = fbm(q0) + 0.35 * noise(q1);
    float hx = fbm(q0 + vec2(e * 0.7, 0.0)) + 0.35 * noise(q1 + vec2(e * 3.0, 0.0));
    float hz = fbm(q0 + vec2(0.0, e * 0.7)) + 0.35 * noise(q1 + vec2(0.0, e * 3.0));
    N = normalize(vec3(-(hx - h0) / e * 0.3 * bump, 1.0, -(hz - h0) / e * 0.3 * bump));
    // Nära kanten: mörkare sten, lingonris och gräs i skrevorna, och kanten själv rundar av
    float edge = smoothstep(3.5, 0.0, rim - p.z);
    vec3 scrub = mix(vec3(0.10, 0.14, 0.06), vec3(0.36, 0.30, 0.12), fbm(g * 2.3));
    col = mix(col, scrub, edge * 0.85 * smoothstep(0.3, 0.55, fbm(g * 1.1 + 5.0)));
    col *= 1.0 - 0.4 * smoothstep(0.9, 0.0, rim - p.z);
    // Grus och småsten utanför plattan
    float r0 = length(g);
    float pebble = smoothstep(0.78, 0.86, noise(g * 4.0 + 2.0)) * smoothstep(8.4, 9.5, r0);
    col = mix(col, col * 1.25, pebble * 0.6);
    // Blockens kontaktskugga och slagskugga på hällen (skuggan faller bort från solen)
    vec2 sdir = -L.xz / max(L.y, 0.3);
    for (int i = 0; i < NB; i++) {
      vec3 c = B_C[i];
      vec3 r = B_R[i];
      float top = c.y + r.y;
      if (top <= 0.0) continue;
      vec2 d = (g - c.xz) / r.xz;
      float contact = length(d);
      ao *= mix(0.45, 1.0, smoothstep(0.85, 1.5, contact));
      vec2 ds = (g - c.xz - sdir * top * 0.6) / (r.xz + vec2(top * 0.3));
      shade *= mix(0.35, 1.0, smoothstep(0.7, 1.15, length(ds)));
    }

    // Plattan: slätare sten med färgen målad direkt på hällen: gul streckad cirkel, ett H och en mittlinje mot kameran
    float r = r0;
    float slab = inside(r - 8.2);
    vec3 polished = granite(g * 0.6 + 50.0, fw) * 1.05;
    // Avgassot och slitage mitt på plattan
    polished *= 1.0 - 0.16 * smoothstep(5.0, 0.0, r) * fbm(g * 0.9);
    col = mix(col, polished, slab * 0.5);
    float wear = 0.55 + 0.45 * smoothstep(0.2, 0.5, fbm(g * 2.5 + 40.0)); // nött färg
    vec3 yellow = vec3(0.98, 0.74, 0.08);
    float ang = atan(g.y, g.x);
    float dash = step(0.42, fract(ang * 34.0 / 6.2831853));
    float ring = inside(abs(r - 6.3) - 0.15) * dash;
    float cl = inside(abs(g.x) - 0.13) * step(g.y, -6.75) * step(-11.5, g.y) * step(fract(g.y * 0.5), 0.55);
    float hl = inside(abs(abs(g.x) - 1.0) - 0.22) * inside(abs(g.y) - 1.55);
    float hm = inside(abs(g.x) - 1.0) * inside(abs(g.y) - 0.2);
    float circ = inside(abs(r - 2.75) - 0.12);
    float paint = max(max(ring, cl), max(max(hl, hm), circ)) * wear;
    col = mix(col, yellow, paint * 0.92);
  }

  col = pow(col, vec3(2.2)); // färgerna ovan är valda i sRGB, ljuset räknas linjärt
  float ndl = max(dot(N, L), 0.0);
  vec3 amb = mix(vec3(0.20, 0.19, 0.16), sky, N.y * 0.5 + 0.5);
  vec3 c = col * (amb * 1.05 * ao + sunCol * ndl * shade * mix(0.7, 1.0, ao));
  // Lite blank glans i flack vinkel, som på slipad sten
  vec3 V = -dir;
  vec3 H = normalize(L + V);
  c += sunCol * pow(max(dot(N, H), 0.0), 40.0) * 0.05 * shade;
  // Dis med avståndet, mot horisontens ljusa blå
  float dist = rock ? tb : t;
  float fog = 1.0 - exp(-dist / 600.0);
  c = mix(c, mix(vec3(0.45, 0.55, 0.72), vec3(0.6, 0.42, 0.38), uDusk), fog);
  c = pow(tonemap(c), vec3(1.0 / 2.2));
  float a = rock ? 1.0 : alpha;
  vec3 outc = c * a;
  if (!rock && cov > 0.0) {
    // Riset och granarna: mörkgrönt, granarna nästan svarta med ljusare solsida (solen från höger)
    float rel = clamp(pv.y / max(vh, 0.2), 0.0, 1.0);
    float leaf = fbm(vec2(pv.x * 6.0, pv.y * 9.0));
    vec3 vc = mix(vec3(0.07, 0.1, 0.045), vec3(0.2, 0.24, 0.1), leaf);
    vc = mix(vc, vec3(0.34, 0.24, 0.1), smoothstep(0.6, 0.8, fbm(vec2(pv.x * 2.0, 3.0))) * 0.6); // höstfärgat ris
    float lit = 0.35 + 0.65 * smoothstep(0.1, 1.0, rel) * (0.5 + 0.5 * leaf);
    float isTree = step(inside(pv.y - vh), treeCov - 0.01);
    vc = mix(vc, mix(vec3(0.03, 0.055, 0.035), vec3(0.09, 0.13, 0.06), leaf), isTree);
    lit = mix(lit, 0.25 + 0.9 * smoothstep(0.3, 1.0, side), isTree);
    vc = pow(vc, vec3(2.2));
    vec3 cv = vc * (sky * 0.45 + sunCol * max(L.y, 0.2) * lit * 0.9);
    cv = mix(cv, mix(vec3(0.45, 0.55, 0.72), vec3(0.6, 0.42, 0.38), uDusk), 1.0 - exp(-tv / 600.0));
    cv = pow(tonemap(cv), vec3(1.0 / 2.2));
    outc += cv * cov;
    a += cov;
  }
  outColor = vec4(outc, a);
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
    // En liten bild direkt, så att shadern byggs klart när sidan laddas och inte hackar första hovringen
    this.render({ width: 2, height: 2, cx: 1, focal: 10, sun: [0, 1, 0] });
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

/**
 * Riktningen mot solen i plattans koordinater: snett framifrån till höger, så att helikopterns
 * nos och vindruta är solbelysta och skuggan faller bakåt på plattan. heli3d.js får samma
 * riktning sedd från kameran (heliSun).
 */
export function padSun(dusk = 0) {
  const day = [0.7, 0.55, -0.45];
  const eve = [0.75, 0.2, -0.35];
  const s = day.map((v, i) => v + (eve[i] - v) * dusk);
  const n = Math.hypot(...s);
  return s.map((v) => v / n);
}

/** Solen för heli3d.js, som räknar x åt vänster i bild. */
export function heliSun(dusk = 0) {
  const [x, y, z] = padSun(dusk);
  return [-x, y, z];
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
    // Pelaren: luften som trycks ned genom rotorn. Flera lager med mjukt avtagande bredd ger en
    // dimmig pelare med mjuka kanter i stället för en skarp ljusstråle.
    const top = padProject(f, 0, hh - 1.3, 0);
    const bottom = padProject(f, 0, 0.1, 0);
    const w0 = top.k * 0.35;
    const w1 = bottom.k * 1.1;
    const column = (scale, a0, a1, rgb) => {
      const g = ctx.createLinearGradient(0, top.y, 0, bottom.y);
      g.addColorStop(0, `rgb(${rgb} / 0)`);
      g.addColorStop(0.35, `rgb(${rgb} / ${a0})`);
      g.addColorStop(1, `rgb(${rgb} / ${a1})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(top.x - w0 * scale, top.y);
      ctx.lineTo(top.x + w0 * scale, top.y);
      ctx.lineTo(bottom.x + w1 * scale, bottom.y);
      ctx.lineTo(bottom.x - w1 * scale, bottom.y);
      ctx.closePath();
      ctx.fill();
    };
    for (const sc of [1, 0.72, 0.48, 0.3]) column(sc, 0.04 * a, 0.12 * a, '246 240 226');
    // Den ljusa kärnan rakt ned från magen
    column(0.12, 0.18 * a, 0.35 * a, '255 251 240');
    column(0.05, 0.3 * a, 0.5 * a, '255 252 244');
    // Virvlar som följer luften nedåt och vidgas
    if (sprite) {
      for (let i = 0; i < 9; i++) {
        const age = (t * 0.55 + i / 9) % 1;
        const fy = age ** 0.8;
        const y = top.y + (bottom.y - top.y) * fy;
        const k = top.k + (bottom.k - top.k) * fy;
        const size = k * (0.35 + 0.9 * age);
        const dx = Math.sin(i * 2.3 + t * 1.7) * k * 0.25 * age;
        ctx.globalAlpha = a * 0.32 * Math.sin(Math.PI * age);
        ctx.drawImage(sprite, top.x + dx - size, y - size * 0.6, size * 2, size * 1.2);
      }
      ctx.globalAlpha = 1;
    }
    // Ett dammoln där den slår i plattan
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
    const r = 1.2 + age * (4.2 + 2 * rnd); // dammet lägger sig innan det når plattans kant
    const p = padProject(f, Math.cos(ang) * r, 0.25 + age * 0.9, Math.sin(ang) * r);
    const size = p.k * (1.0 + age * 2.4);
    ctx.globalAlpha = a * Math.sin(Math.PI * age) * 0.5;
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
  x.lineCap = 'butt'; // rundade ändar sticker ut där halvorna möts
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
