// Räddningshelikoptern i Fjällräddaren-menyns rubrik (plan.md §2), renderad som en
// belyst 3D-bild: en strålmarschad avståndsfunktion (SDF) i en fragment-shader med
// sol, himmelsljus, mjuka skuggor, ambient ocklusion, klarlack och tonade rutor, och om
// man vill en molnbank bakom. Lackeringen (färgfält, dekaler, registrering, fogar, nitar
// och smuts) målas i en 2D-canvas och läggs på som textur; rotorn får rörelseoskärpa.
// Bilden tas en gång per storlek och lackering i en tillfällig WebGL-kontext, en remsa
// per bildruta så att menyn inte hackar, och kopieras sedan till rubrikens 2D-canvas.
// Därefter kostar den ingenting per bildruta. Saknas WebGL ritas en reservbild.

const VS = 'attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }';

// Modellen ritas i "modellens x" men visas i "bildens x": kabinen trycks ihop (CK) så att den blir
// kort och hög som på en H135, och stjärtbommen sträcks ut (BK) så att den blir lång och smal.
// Samma funktioner finns i shadern (warpX); här behövs de för inramningen och rotorns nav.
const BK = 1.4;
const CK = 1.4;
const WK = 0.6; // hur mjukt kabinens hoptryckning tonar in, så att ingen veck syns i lacken
const boomX = (x) => (x > -2 ? x : x > -2 - 4.2 * BK ? -2 + (x + 2) / BK : x + 4.2 * (BK - 1));
const ramp = (u) => 0.5 * (u + Math.sqrt(u * u + WK * WK));
const warpX = (x) => boomX(x) + (CK - 1) * (ramp(x + 2) - ramp(0));
/** Bildens x för modellens x (förvrängningen är växande, så halvering räcker). */
function imageX(xm) {
  let lo = -30;
  let hi = 10;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (warpX(mid) < xm) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
const HUB_X = imageX(-0.35); // rotornavet i bildens x
const TAIL_X = imageX(-6.85); // stjärtrotorns nav
const f4 = (x) => x.toFixed(4);

// Helikopterns koordinater: x framåt (nosen), y uppåt, z mot betraktaren. Nosen
// ligger vid x ≈ 2.6, stjärtfenan vid x ≈ −7.5 och medarna vid y ≈ −1.32, i modellens x (se warpX).
const FS = `
precision highp float;
uniform vec2 uOrigin;
uniform float uScale;
uniform vec3 uCam, uF, uR, uU, uSun;
uniform float uBlade, uBlur, uClouds;
uniform vec2 uRes;
uniform sampler2D uPaint, uMask;

const int SAMPLES = 4;
const vec3 HUB = vec3(${f4(HUB_X)}, 1.78, 0.0); // i bildens koordinater
const float TAIL_X = ${f4(TAIL_X)};
const float ROTOR = 6.0;
const vec4 TEX = vec4(-7.7, -1.1, 10.7, 3.5); // lackeringens ruta: x0, y0, bredd, höjd (se TEX i JS)

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
  // Kabinen: mellanting av ellipsoid och rundad låda, så att sidor och tak blir raka som på en riktig kabin
  float cab = mix(sdEllipsoid(p - vec3(-0.45, 0.06, 0.0), vec3(2.45, 1.06, 0.95)),
                  sdRoundBox(p - vec3(-0.6, 0.02, 0.0), vec3(1.95, 0.62, 0.55), 0.42), 0.55);
  // Nosen är hög och rund, som på en H145: rutan sveper ända ner mot nostippen
  float nose = sdEllipsoid(p - vec3(1.15, -0.12, 0.0), vec3(1.35, 0.86, 0.85));
  float d = smin(cab, nose, 0.7);
  // Vindrutans lutning: ett snett plan skär av kabinens främre överkant
  d = smax(d, dot(p - vec3(1.86, 0.5, 0.0), vec3(0.83, 0.56, 0.0)), 0.8);
  d = smax(d, abs(p.z) - 0.9 + 0.09 * p.y * p.y, 0.45); // sidorna buktar, inte platta
  d = smax(d, -p.y - 0.8, 0.26);
  // Bakre kabinens undersida stiger mot stjärtbommen (bakdörrarna)
  d = smax(d, dot(p - vec3(-2.0, -0.62, 0.0), vec3(-0.6, -0.8, 0.0)), 0.35);
  float cowl = sdRoundBox(p - vec3(-1.05, 0.9, 0.0), vec3(1.3, 0.24, 0.44), 0.24);
  cowl = smax(cowl, dot(p - vec3(0.55, 1.0, 0.0), vec3(0.55, 0.83, 0.0)), 0.2);
  d = smin(d, cowl, 0.36);
  // Avgasrör bak på kåpan
  d = min(d, sdCapsule(vec3(p.x, p.y, abs(p.z)), vec3(-2.05, 1.0, 0.26), vec3(-2.45, 0.94, 0.34), 0.1));
  float boom = sdCone(p, vec3(-1.8, 0.3, 0.0), vec3(-6.7, 0.6, 0.0), 0.52, 0.14);
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
  float d = sdCapsule(q, vec3(-1.6, -1.26, 0.98), vec3(1.25, -1.26, 0.98), 0.05);
  d = min(d, sdCapsule(q, vec3(1.25, -1.26, 0.98), vec3(1.6, -1.08, 0.98), 0.05));
  d = min(d, sdCapsule(q, vec3(0.78, -0.62, 0.5), vec3(0.86, -1.26, 0.98), 0.045));
  d = min(d, sdCapsule(q, vec3(-1.0, -0.62, 0.5), vec3(-1.06, -1.26, 0.98), 0.045));
  // Räddningsvinschen ovanför dörren: arm ut från taket och en trumma längs kabinen
  d = min(d, sdCapsule(p, vec3(-0.6, 0.8, 0.5), vec3(-0.6, 0.82, 1.02), 0.05));
  d = min(d, sdCapsule(p, vec3(-0.85, 0.82, 1.06), vec3(-0.4, 0.82, 1.06), 0.085));
  d = min(d, sdEllipsoid(p - vec3(1.55, -0.9, 0.3), vec3(0.16, 0.1, 0.14)));
  d = min(d, sdCapsule(p, vec3(-6.85, 0.72, 0.08), vec3(-6.85, 0.72, 0.26), 0.1));
  // Antenner på taket och under bommen
  d = min(d, sdCapsule(p, vec3(0.5, 0.95, 0.0), vec3(0.3, 1.25, 0.0), 0.022));
  d = min(d, sdCapsule(p, vec3(-3.4, 0.0, 0.0), vec3(-3.7, -0.35, 0.0), 0.02));
  return d;
}

// Från bildens x till modellens x (se warpX i JS): stjärtbommen mellan x = −2 och −6.2 sträcks
// BK gånger och allt bakom flyttas med; kabinen framför x = −2 trycks ihop CK gånger med en mjuk
// övergång. Hoptryckningen gör avstånden upp till CK gånger för stora, så map delar med CK.
const float BK = 1.4;
const float CK = ${CK.toFixed(3)};
const float WK = ${WK.toFixed(3)};
float boomX(float x) { return x > -2.0 ? x : (x > -2.0 - 4.2 * BK ? -2.0 + (x + 2.0) / BK : x + 4.2 * (BK - 1.0)); }
float ramp(float u) { return 0.5 * (u + sqrt(u * u + WK * WK)); }
float warpX(float x) { return boomX(x) + (CK - 1.0) * (ramp(x + 2.0) - ramp(0.0)); }

// Mast, nav och bladfästen i bildens koordinater, så att de passar ihop med bladen (se bladeCover)
float rotorHead(vec3 p) {
  float d = sdCapsule(p, vec3(HUB.x, 1.0, 0.0), HUB - vec3(0.0, 0.05, 0.0), 0.12);
  d = min(d, sdEllipsoid(p - HUB, vec3(0.22, 0.13, 0.22)));
  d = min(d, sdCapsule(p, HUB + vec3(0.0, 0.1, 0.0), HUB + vec3(0.0, 0.28, 0.0), 0.07));
  for (int k = 0; k < 5; k++) {
    float th = -uBlade - 0.5 * uBlur + float(k) * 1.2566371;
    vec3 dir = vec3(cos(th), 0.0, sin(th));
    d = min(d, sdCapsule(p, HUB, HUB + dir * 0.56 + vec3(0.0, 0.02, 0.0), 0.045));
  }
  return d;
}

vec2 map(vec3 p) {
  float r = rotorHead(p);
  p.x = warpX(p.x);
  float b = body(p) / CK, m = min(metal(p) / CK, r);
  return b < m ? vec2(b, 1.0) : vec2(m, 3.0);
}

// Rotorbladen räknas analytiskt i stället för i avståndsfunktionen: hur stor del av
// slutartiden (vinkeln uBlur) ett blad täcker punkten ger rörelseoskärpan direkt.
float overlap(float a0, float a1, float b0, float b1) { return max(0.0, min(a1, b1) - max(a0, b0)); }
float bladeCover(vec3 r) {
  float l = length(r.xz);
  if (l < 0.3 || l > ROTOR) return 0.0;
  const float P = 6.2831853 / 5.0; // fem blad
  float hw = mix(0.17, 0.12, l / ROTOR) / l; // halva kordan som vinkel, smalare mot spetsen
  float s0 = mod(atan(r.z, r.x) + uBlade, P);
  float s1 = s0 + uBlur;
  float c = overlap(s0, s1, -hw, hw) + overlap(s0, s1, P - hw, P + hw) + overlap(s0, s1, 2.0 * P - hw, 2.0 * P + hw);
  // Andelen av slutartiden som ett blad täcker punkten: ytterdelen far fortare och suddas mer
  return min(c / uBlur, 1.0) * smoothstep(ROTOR, ROTOR - 0.08, l) * smoothstep(0.3, 0.5, l);
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

// Värdebrus i flera oktaver: moln i himlen som speglas och i molnbanken bakom
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    a *= 0.5;
  }
  return s;
}
vec3 sunCol() { return vec3(1.0, 0.83, 0.64) * 2.5; }

vec3 sky(vec3 d) {
  vec3 zen = vec3(0.16, 0.34, 0.72), hor = vec3(0.92, 0.88, 0.84), gnd = vec3(0.07, 0.065, 0.06);
  vec3 c = d.y > 0.0 ? mix(hor, zen, pow(d.y, 0.5)) : mix(hor * 0.55, gnd, pow(-d.y, 0.35));
  // Fjällkedja och moln som rutorna och lacken kan spegla
  float az = atan(d.z, d.x);
  float ridge = 0.06 + 0.05 * sin(az * 5.0 + 1.0) + 0.03 * sin(az * 13.0 + 2.0);
  c = mix(c, vec3(0.2, 0.25, 0.33), smoothstep(ridge + 0.01, ridge - 0.01, d.y) * step(-0.02, d.y));
  c = mix(c, vec3(1.0), 0.35 * smoothstep(0.2, 0.7, sin(az * 3.0) * sin(az * 7.0 + d.y * 9.0)) * smoothstep(0.1, 0.25, d.y) * smoothstep(0.6, 0.3, d.y));
  // Stackmoln på ett plan högt upp: det som gör att rutor och lack ser ut att spegla en riktig himmel
  if (d.y > 0.02) {
    float cl = fbm(d.xz / (d.y + 0.15) * 1.3 + vec2(3.1, 7.4));
    c = mix(c, vec3(1.0, 0.97, 0.93) * 1.1, smoothstep(0.5, 0.75, cl) * 0.8 * smoothstep(0.02, 0.2, d.y));
  }
  return c + sunCol() * pow(max(dot(d, uSun), 0.0), 300.0) * 6.0;
}

// Lackeringen målas i en 2D-canvas (paintLivery) och projiceras från sidan: x och y i
// helikopterns koordinater blir texturkoordinater. uMask: r = sidoruta, g = råhet.
vec2 texUv(vec3 p) { return (vec2(warpX(p.x), p.y) - TEX.xy) / TEX.zw; }

// Mörk kupé bakom rutorna: instrumentbräda och stolar nertill, och genom rutorna på
// andra sidan syns himlen, så att rutan inte blir en svart bubbla.
vec3 cabinInside(vec3 p, vec3 rd) {
  // Strålen går genom kabinen till bortre sidan (z ≈ −0.7): där rutorna sitter syns
  // himlen igenom, annars kabinens ljusgrå vägg och stolar i halvdager
  float t = rd.z < -0.05 ? (-0.7 - p.z) / rd.z : 0.0;
  vec3 q = p + rd * t;
  float far = step(0.5, texture2D(uMask, texUv(q)).r);
  float qx = warpX(q.x);
  far = max(far, step(1.0, qx) * step(-0.02 - 0.17 * (qx - 1.0), q.y) * step(q.y, 0.75));
  vec3 wall = mix(vec3(0.012, 0.013, 0.015), vec3(0.035, 0.036, 0.04), smoothstep(-0.7, 0.6, q.y));
  vec3 c = mix(wall, sky(rd) * 0.055, far);
  // Stolarnas ryggar mitt i kabinen och instrumentbrädan längst fram
  vec3 m = p + rd * (rd.z < -0.05 ? (0.0 - p.z) / rd.z : 0.0);
  m.x = warpX(m.x);
  float seat = 0.0;
  for (int k = 0; k < 3; k++) {
    vec2 s = vec2(m.x - (0.55 - float(k) * 1.15), m.y + 0.05);
    seat = max(seat, smoothstep(0.03, 0.0, sdRoundBox(vec3(s, 0.0), vec3(0.16, 0.42, 0.0), 0.1)));
  }
  float dash = step(0.8, m.x) * smoothstep(0.04, -0.02, m.y - 0.25 * (m.x - 0.8));
  c = mix(c, vec3(0.03, 0.032, 0.036), max(seat * 0.85, dash * 0.95));
  // Piloterna: mörka siluetter med hjälm i den främre rutan
  vec2 h = vec2(m.x - 0.75, m.y - 0.3);
  float pilot = smoothstep(0.16, 0.13, length(h * vec2(1.0, 0.85)));
  c = mix(c, vec3(0.02, 0.022, 0.026), pilot);
  return c * vec3(0.62, 0.7, 0.72); // genom två lager tonat glas
}

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

// Blinn-Phong normerad så att glansen behåller sin energi när rådheten ändras
float specular(vec3 n, vec3 v, float rough) {
  float e = 2.0 / max(pow(rough, 4.0), 1e-4) - 2.0;
  float nh = max(dot(n, normalize(uSun + v)), 0.0);
  return (e + 8.0) / 25.13 * pow(nh, e);
}

vec3 shade(vec3 p, vec3 rd, float mat) {
  vec3 n = normalAt(p);
  vec3 v = -rd;
  float ao = occlusion(p, n);
  float sh = shadow(p + n * 0.01, uSun);
  // Rotorbladens suddiga skuggor över taket och kåpan
  float tb = (HUB.y - p.y) / uSun.y;
  if (tb > 0.0) sh *= 1.0 - 0.7 * bladeCover(p + uSun * tb - HUB);
  float ndl = max(dot(n, uSun), 0.0) * sh;
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  // Himlen lyser upp ovansidan blått, marken ger en varm, svag reflex underifrån
  vec3 amb = mix(vec3(0.04, 0.042, 0.05), vec3(0.17, 0.23, 0.36), n.y * 0.5 + 0.5) * ao;
  amb += vec3(0.24, 0.21, 0.17) * clamp(-n.y, 0.0, 1.0) * ao * 0.1;
  vec3 rf = reflect(rd, n);
  vec3 env = sky(rf) * mix(0.25, 1.0, ao) * mix(0.55, 1.0, smoothstep(-0.3, 0.2, rf.y));
  float fres = pow(1.0 - ndv, 5.0);
  if (mat > 2.0) {
    // Mörk, lite sliten metall
    float f = 0.06 + 0.94 * fres;
    return vec3(0.07, 0.074, 0.08) * (sunCol() * ndl + amb) + env * f * 0.3 + sunCol() * specular(n, v, 0.42) * ndl * 0.05;
  }
  vec2 uv = texUv(p);
  vec4 mk = texture2D(uMask, uv);
  float side = smoothstep(0.35, 0.6, abs(p.z));
  vec3 pm = vec3(warpX(p.x), p.y, p.z); // modellens koordinater
  // Vindrutan sveper runt nosen, med en mittstolpe; sidorutorna kommer från masken
  float ws = step(1.0, pm.x) * step(-0.06 - 0.17 * (pm.x - 1.0), p.y) * step(p.y, 0.8);
  ws *= 1.0 - step(abs(p.z), 0.03) * step(1.4, pm.x);
  // Ramen som delar vindrutan i en övre ruta och nosens nedre rutor: svart gummilist
  float frame = ws * step(abs(p.y - 0.04 + 0.26 * (pm.x - 1.0)), 0.03) * step(1.15, pm.x);
  if (frame > 0.5) return vec3(0.02, 0.021, 0.024) * (sunCol() * ndl + amb) + env * (0.04 + 0.5 * fres);
  float glass = max(ws, side * step(0.5, mk.r));
  if (glass > 0.5) {
    // Rutan speglar himlen och molnen; ljuset utifrån är så starkt att speglingen syns även rakt framifrån
    // Rutans beläggning speglar lite mer än vanligt glas; kupén bakom är nästan svart
    float f = 0.1 + 0.9 * fres;
    vec3 tint = vec3(0.62, 0.72, 0.8); // tonat glas
    // Sidorutorna buktar ut och lutar inåt upptill: de speglar mer av himlen och molnen än den platta modellen
    vec3 rg = reflect(rd, normalize(n + vec3(0.0, 0.28 * side, 0.0)));
    // Speglingen: ljus himmel uppåt, mörk mark och fjäll nedåt, så att rutan får en tydlig gradient.
    // Rutorna lutar inåt upptill, så deras överkant fångar mer himmel än den platta modellen visar.
    float up = rg.y + 0.45 * clamp(p.y, -0.4, 0.8) - 0.1;
    vec3 refl = sky(rg) * mix(0.6, 1.0, ao) * mix(0.08, 1.0, smoothstep(0.0, 0.5, up));
    // Solens bländning i den buktade rutan: en bred, mjuk glans runt den skarpa
    vec3 glint = sunCol() * (pow(max(dot(rg, uSun), 0.0), 60.0) * 0.25 + specular(n, v, 0.06) * 0.1) * sh;
    return cabinInside(p, rd) * 0.35 * (1.0 - f) + refl * f * tint + glint;
  }
  vec3 alb = toLinear(texture2D(uPaint, uv).rgb) * 0.82;
  float rough = mk.g;
  // Lacken: diffus bas under en klarlack med Fresnel-speglingar av himlen och fjällen
  float f = (0.035 + 0.6 * fres) * (1.0 - 0.6 * rough);
  vec3 col = alb * (sunCol() * ndl + amb) * (1.0 - f) + env * f * 0.8;
  col += sunCol() * specular(n, v, max(rough, 0.14)) * ndl * 0.07 * (1.0 - 0.5 * rough);
  return col;
}

// Molnbank bakom helikoptern (bara i rubriken): värdebrus i flera oktaver, solbelysta
// toppar och blågrå undersidor. Tonas ut mot canvasens högra och nedre kant.
// Tjocklek i punkten f (andelar, y uppåt); toppen bölar sig, basen är flatare
float cloudDensity(vec2 f) {
  vec2 p = vec2(f.x * uRes.x / uRes.y, f.y) * 2.4;
  float top = 0.34 + 0.2 * fbm(vec2(p.x * 0.7, 3.0)) - 0.16 * f.x;
  return fbm(p * 1.7 + vec2(5.2, 1.3)) * 0.9 + 0.05 - (f.y - top) * 2.6 - smoothstep(0.15, 0.0, f.y) * 0.3;
}
vec4 clouds(vec2 f) {
  float d = cloudDensity(f);
  float a = smoothstep(0.38, 0.8, d);
  if (a <= 0.0) return vec4(0.0);
  // Ljuset: tunnare mot solen (upp till höger) ger ljusa kanter, tät kärna blir skuggad
  float lit = clamp(0.5 + (d - cloudDensity(f + vec2(0.012, 0.03))) * 6.0, 0.0, 1.0);
  vec3 col = mix(vec3(0.56, 0.63, 0.74), vec3(1.0, 0.96, 0.9), lit);
  col = mix(col, vec3(0.74, 0.8, 0.9), smoothstep(0.35, 0.05, f.y) * 0.5); // dis mot basen
  a *= smoothstep(0.85, 0.35, f.x) * smoothstep(0.0, 0.25, f.y) * 0.45; // tunna och diffusa, långt bort
  return vec4(col * a, a);
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
    float bq = dot(oc, rd), disc = bq * bq - dot(oc, oc) + 66.0;
    vec4 c = vec4(0.0);
    float tHit = 1e9;
    if (disc > 0.0) {
      float t = max(-bq - sqrt(disc), 0.0), tEnd = -bq + sqrt(disc);
      for (int s = 0; s < 120; s++) {
        vec2 h = map(ro + rd * t);
        if (h.x < 0.0006 * t) {
          // Lite luftperspektiv: helikoptern ligger i samma dis som himlen bakom
          c = vec4(mix(shade(ro + rd * t, rd, h.y), vec3(0.42, 0.54, 0.76), 0.012), 1.0);
          tHit = t;
          break;
        }
        t += h.x * 0.9;
        if (t > tEnd) break;
      }
      // Stjärtrotorn: en suddig skiva på fenans sida, framför fenan men bakom kroppen
      float tz = (0.3 - ro.z) / rd.z;
      vec2 q = (ro + rd * tz).xy - vec2(TAIL_X, 0.72);
      if (tz > 0.0 && tz < tHit && length(q) < 0.82) {
        float lq = length(q);
        float ta = 0.07 + 0.3 * pow(0.5 + 0.5 * sin(atan(q.y, q.x) * 2.0 + 0.7), 6.0);
        ta *= smoothstep(0.82, 0.76, lq) * smoothstep(0.08, 0.2, lq);
        c = vec4(mix(c.rgb, vec3(0.04, 0.045, 0.05), ta), mix(c.a, 1.0, ta));
      }
      // Rotorbladen: skär strålen med rotorkonen (bladen böjs uppåt) och lägg på täckningen
      // Bladen har tjocklek: två skikt ovanför varandra, så att de syns även nästan från kanten
      float cover = 0.0, l = 0.0;
      for (int k = 0; k < 3; k++) {
        float off = float(k) * 0.03 - 0.03;
        float tp = (HUB.y + off - ro.y) / rd.y;
        vec3 r = ro + rd * tp - HUB;
        tp = (HUB.y + off + length(r.xz) * 0.035 - ro.y) / rd.y;
        r = ro + rd * tp - HUB;
        if (tp > 0.0 && tp < tHit) {
          cover = max(cover, bladeCover(r));
          l = length(r.xz);
        }
      }
      if (l > 0.0) {
        vec3 rf = reflect(rd, vec3(0.0, rd.y > 0.0 ? -1.0 : 1.0, 0.0));
        vec3 bc = vec3(0.045, 0.048, 0.052) + sky(rf) * 0.07;
        float veil = 0.012 * smoothstep(ROTOR, ROTOR - 0.3, l) * smoothstep(0.3, 1.0, l); // skivans slöja
        float a = clamp(cover + veil, 0.0, 1.0);
        a *= smoothstep(uRes.x, uRes.x * 0.93, gl_FragCoord.x); // spetsen suddas ut mot canvasens kant
        c = vec4(mix(c.rgb, bc, a), mix(c.a, 1.0, a));
      }
    }
    vec3 g = pow(aces(c.rgb * 1.05), vec3(1.0 / 2.2));
    g = mix(vec3(dot(g, vec3(0.3, 0.55, 0.15))), g, 0.93); // lite dämpad mättnad, som ett foto
    acc += vec4(g * c.a, c.a);
  }
  vec4 heli = acc / float(SAMPLES);
  vec4 bg = uClouds > 0.5 ? clouds(gl_FragCoord.xy / uRes) : vec4(0.0);
  gl_FragColor = heli + bg * (1.0 - heli.a);
}
`;

const PITCH = -0.1; // nosen lite nedåt, i fart framåt
const YAW = 0.85; // snett framifrån: nosen och den stora vindrutan mot betraktaren, kabinen förkortad
const ELEV = -0.17; // kameran något under rotorplanet
const DIST = 30; // långt bort, som med teleobjektiv: ingen leksaksperspektiv där nosen blir stor och stjärten liten
const TARGET = [-2.9, 0.2, 0];
const SUN = [0.58, 0.72, 0.38]; // låg sol snett framifrån: nosen glänser, sidan får en gradient och buken ligger i skugga
// Punkter som ska rymmas: fenan, nosen, medarna, navet och vinschen (rotorbladen får gå utanför).
// Givna i modellens koordinater och flyttade till bildens.
const FIT_POINTS = [
  [-7.5, 2.18, 0], [-7.1, -0.62, 0], [2.6, -0.2, 0], [1.62, -1.08, 0.98], [1.62, -1.08, -0.98],
  [-1.65, -1.32, 0.98], [-1.65, -1.32, -0.98], [-0.35, 1.95, 0], [2.0, 0.6, 0.6], [-0.15, 0.7, 1.3],
].map(([x, y, z]) => [imageX(x), y, z]);
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

// Lackeringens ruta i helikopterns koordinater (samma som TEX i shadern) och texturens storlek
const TEX = { x0: -7.7, y0: -1.1, w: 10.7, h: 3.5 };
const TEX_W = 1024;
const TEX_H = 512;

/** Blandar två #rrggbb-färger: t = 0 ger a, 1 ger b. */
function mixHex(a, b, t) {
  const c = (h, i) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `rgb(${[0, 1, 2].map((i) => Math.round(c(a, i) + (c(b, i) - c(a, i)) * t)).join(' ')})`;
}

// Bommens mittlinje: y vid x (från sdCone i body)
const boomY = (x) => 0.3 + ((-1.8 - x) / 4.9) * 0.3;

/**
 * Målar lackeringen sett från sidan: färgfält, rand, dekaler, registrering, panelfogar,
 * nitar och lite smuts. Returnerar { paint, mask } (mask: r = sidoruta, g = råhet).
 */
function paintLivery(livery) {
  const make = () => Object.assign(document.createElement('canvas'), { width: TEX_W, height: TEX_H });
  const paint = make();
  const mask = make();
  const a = paint.getContext('2d');
  const m = mask.getContext('2d');
  const kx = TEX_W / TEX.w;
  const ky = TEX_H / TEX.h;
  // Rita i helikopterns koordinater med y uppåt
  for (const c of [a, m]) c.setTransform(kx, 0, 0, -ky, -TEX.x0 * kx, (TEX.y0 + TEX.h) * ky);
  const poly = (c, color, pts) => {
    c.fillStyle = color;
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fill();
  };
  const roundRect = (c, x0, y0, x1, y1, r) => {
    c.beginPath();
    c.roundRect(x0, y0, x1 - x0, y1 - y0, r);
  };
  const line = (c, color, width, pts) => {
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
  };
  // Text i pixlar, rättvänd, med mitten i (x, y) och höjden h
  const text = (str, x, y, h, color, weight = 800) => {
    a.save();
    a.translate(x, y);
    a.scale(1 / ky, -1 / ky); // texturen är tätare i y än i x; texten ska inte bli bred
    a.font = `${weight} ${Math.round(h * ky)}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
    a.textAlign = 'center';
    a.textBaseline = 'middle';
    a.fillStyle = color;
    a.fillText(str, 0, 0);
    a.restore();
  };
  // Rött som djup lack i solljus, inte leksaksrött
  const red = mixHex(livery.accent, '#520c06', 0.25);
  const white = livery.body;

  // Grunden: vit lack, halvblank
  a.fillStyle = white;
  a.fillRect(TEX.x0, TEX.y0, TEX.w, TEX.h);
  m.fillStyle = 'rgb(0 70 0)';
  m.fillRect(TEX.x0, TEX.y0, TEX.w, TEX.h);

  // Röd motorkåpa runt masten, röd bakre kabin, bom och fena; kabintaket framför masten är vitt
  poly(a, red, [[-3.2, 0.72], [-0.1, 0.74], [0.25, 0.86], [0.55, 1.2], [0.6, 2.5], [-3.2, 2.5]]);
  poly(a, red, [[-2.0, 0.8], [-2.2, -0.05], [-2.55, -0.7], [-2.9, -1.2], [-7.8, -1.2], [-7.8, 2.5], [-2.0, 2.5]]);
  // Röd rand längs kabinens underkant, stigande mot nosen, med en mörk pinstripe ovanför
  poly(a, red, [[-1.5, -0.66], [1.0, -0.56], [2.9, -0.2], [2.9, -0.02], [1.0, -0.38], [-1.5, -0.48]]);
  line(a, '#2b2f36', 0.03, [[-1.42, -0.44], [1.0, -0.34], [2.9, 0.02]]);
  // Vit rand längs bommen och i fenan
  poly(a, white, [[-2.2, boomY(-2.2) + 0.02], [-6.45, boomY(-6.45) + 0.02], [-6.45, boomY(-6.45) - 0.07], [-2.2, boomY(-2.2) - 0.1]]);
  poly(a, white, [[-6.1, 1.02], [-6.0, 1.22], [-7.9, 1.22], [-7.9, 1.02]]);
  // Nosens kåpa i ljusgrått, mattare
  a.fillStyle = '#c7cbd0';
  a.beginPath();
  a.ellipse(2.82, -0.2, 0.22, 0.42, 0, 0, Math.PI * 2);
  a.fill();
  m.fillStyle = 'rgb(0 140 0)';
  m.beginPath();
  m.ellipse(2.82, -0.2, 0.22, 0.42, 0, 0, Math.PI * 2);
  m.fill();
  // Halkskydd på kåpan framför motorn: mörkgrått och matt
  poly(a, '#3a3e45', [[-0.2, 1.33], [0.45, 1.3], [0.4, 1.38], [-0.2, 1.4]]);
  poly(m, 'rgb(0 210 0)', [[-0.2, 1.33], [0.45, 1.3], [0.4, 1.38], [-0.2, 1.4]]);

  // Sidorutor i masken, med mörka gummilister runt om i lacken
  const windows = [[-0.1, -0.15, 0.9, 0.69], [-1.28, -0.13, -0.28, 0.63], [-2.55, 0.05, -1.75, 0.55]];
  for (const [x0, y0, x1, y1] of windows) {
    roundRect(a, x0 - 0.025, y0 - 0.025, x1 + 0.025, y1 + 0.025, 0.18);
    a.fillStyle = '#1d2026';
    a.fill();
    roundRect(m, x0 - 0.045, y0 - 0.045, x1 + 0.045, y1 + 0.045, 0.2);
    m.fillStyle = 'rgb(0 200 0)';
    m.fill();
    roundRect(m, x0, y0, x1, y1, 0.16);
    m.fillStyle = 'rgb(255 30 0)';
    m.fill();
  }
  // Vindrutans ram mot sidan
  line(a, '#1d2026', 0.06, [[1.0, -0.08], [1.0, 0.8]]);

  // Panelfogar: dörrarna, skjutdörrens skena, kåpans luckor och bommens skarvar
  const seam = 'rgb(20 22 26 / 0.55)';
  roundRect(a, -1.4, -0.74, -0.18, 0.74, 0.08);
  a.strokeStyle = seam;
  a.lineWidth = 0.018;
  a.stroke();
  roundRect(a, -0.16, -0.74, 0.98, 0.74, 0.08);
  a.stroke();
  line(a, '#2a2d33', 0.04, [[-2.4, 0.66], [-0.2, 0.68]]);
  line(a, seam, 0.018, [[-0.55, 0.92], [-0.55, 1.38]]);
  line(a, seam, 0.018, [[-1.55, 0.92], [-1.55, 1.36]]);
  line(a, seam, 0.016, [[-2.3, 1.14], [0.2, 1.17]]);
  line(a, seam, 0.016, [[-2.6, -0.6], [-2.6, 0.7]]);
  for (const x of [-2.25, -4.1, -5.85]) line(a, seam, 0.02, [[x, boomY(x) - 0.5], [x, boomY(x) + 0.5]]);
  line(a, seam, 0.014, [[-6.3, 0.48], [-6.95, 2.05]]);
  // Nitrader längs bommen
  a.fillStyle = 'rgb(30 20 20 / 0.45)';
  for (let x = -2.4; x > -6.4; x -= 0.13) {
    for (const dy of [0.2, -0.2]) {
      a.beginPath();
      a.arc(x, boomY(x) + dy * (1 - (-2.4 - x) / 6), 0.012, 0, Math.PI * 2);
      a.fill();
    }
  }
  // Ventilationsgaller på kåpan
  a.fillStyle = 'rgb(20 22 26 / 0.7)';
  for (let i = 0; i < 6; i++) a.fillRect(-2.1 + i * 0.075, 0.98, 0.035, 0.12);

  // Dekaler: registreringen på bakre kabinen, larmnumret och texten på dörren, och ett märke
  text('SE-JRF', -3.5, boomY(-3.5) + 0.2, 0.22, '#ffffff');
  text(livery.label || '112', 0.42, -0.31, 0.24, red);
  text('FJÄLLRÄDDNING', -0.78, -0.31, 0.13, '#23272e', 600);
  a.fillStyle = '#ffffff';
  a.beginPath();
  a.arc(-5.4, boomY(-5.4) + 0.22, 0.13, 0, Math.PI * 2);
  a.fill();
  poly(a, red, [[-5.5, boomY(-5.4) + 0.16], [-5.42, boomY(-5.4) + 0.29], [-5.38, boomY(-5.4) + 0.24], [-5.33, boomY(-5.4) + 0.3], [-5.27, boomY(-5.4) + 0.16]]);
  text('NO STEP', 0.15, 1.24, 0.06, '#5a5f66', 600);
  a.fillStyle = '#1f4f9a';
  a.beginPath();
  a.arc(-1.72, -0.3, 0.15, 0, Math.PI * 2);
  a.fill();
  poly(a, '#ffffff', [[-1.84, -0.38], [-1.75, -0.2], [-1.71, -0.26], [-1.66, -0.18], [-1.6, -0.38]]);

  // Avgassot bakom avgasrören och smuts mot buken
  const soot = a.createLinearGradient(-2.4, 0, -4.2, 0);
  soot.addColorStop(0, 'rgb(25 22 20 / 0.45)');
  soot.addColorStop(1, 'rgb(25 22 20 / 0)');
  a.fillStyle = soot;
  a.beginPath();
  a.ellipse(-3.2, 0.88, 0.95, 0.16, -0.05, 0, Math.PI * 2);
  a.fill();
  const grime = a.createLinearGradient(0, -0.8, 0, -0.2);
  grime.addColorStop(0, 'rgb(60 54 48 / 0.28)');
  grime.addColorStop(1, 'rgb(60 54 48 / 0)');
  a.fillStyle = grime;
  a.fillRect(-7.8, -1.2, 10.8, 1.0);

  // Lite brus i lacken, så att ytorna inte blir platta som plast
  a.setTransform(1, 0, 0, 1, 0, 0);
  const img = a.getImageData(0, 0, TEX_W, TEX_H);
  const d = img.data;
  let seed = 7;
  for (let i = 0; i < d.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const k = 0.975 + (seed / 4294967296) * 0.05;
    d[i] *= k;
    d[i + 1] *= k;
    d[i + 2] *= k;
  }
  a.putImageData(img, 0, 0);
  return { paint, mask };
}

function texture(gl, unit, canvas) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
  #clouds;
  #drawn = ''; // storlek och lackering för bilden som visas
  #job = null; // pågående rendering

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {(canvas: HTMLCanvasElement, livery: object) => void} fallback  ritar utan WebGL
   * @param {number[]} [rect]  rutan helikoptern ska rymmas i: [x0, y0, x1, y1] som andelar
   * @param {boolean} [clouds]  måla en molnbank bakom helikoptern
   */
  constructor(canvas, fallback, rect = [0.06, 0.2, 0.96, 0.985], clouds = false) {
    this.#clouds = clouds;
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
      this.#present(gc);
      this.#drawn = key;
      done();
    };
    frame = requestAnimationFrame(step);
    return job;
  }

  /** Kopierar bilden till rubriken med en svag mjukhet och ett ljusdis, som i ett foto. */
  #present(image) {
    const ctx = this.#canvas.getContext('2d');
    ctx.filter = 'blur(0.45px)';
    ctx.drawImage(image, 0, 0);
    ctx.filter = 'blur(10px)';
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.1;
    ctx.drawImage(image, 0, 0);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // Lite korn över helikoptern, som i ett foto: ytorna blir inte släta som plast
    const { width: w, height: h } = this.#canvas;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    let seed = 11;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = ((seed / 4294967296) - 0.5) * 9 * (d[i + 3] / 255);
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
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
    const { paint, mask } = paintLivery(livery);
    texture(gl, 0, paint);
    texture(gl, 1, mask);
    gl.uniform1i(gl.getUniformLocation(prog, 'uPaint'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'uMask'), 1);
    set('uBlade', 0.0); // två blad i V mot höger, så att inget sticker ut i rubriken
    set('uBlur', 0.34);
    set('uClouds', this.#clouds ? 1 : 0);
    set('uRes', [w, h]);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
  }
}
