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

/** Den gula streckade cirkelns radie på plattan (m). */
const PAINT_R = 5.7;

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

// Utsikten från hyllan, bara i helbilden (FULL): dalen långt därunder med en sjö som slingrar
// sig bort mellan skogsklädda kullar, och snöklädda fjäll bakom. Höjdfältet strålföljs per
// bildpunkt med skuggor, spegling i sjön och dis. Det är dyrt men ritas bara en gång per
// hovring, i remsor över flera bilder (HoverPad.view), så det kostar inget när man väl hovrar.
const OVERLOOK = `
#ifdef FULL
const float LAKE = -450.0; // sjöns yta, m under plattan
// Trädkronornas knottror i höjdfältet: bara på nära håll. Längre bort blir de bara solbelysta
// prickar i normalerna, så de tonas ut med avståndet (sätts i overlook före normalen).
float oCrown = 1.0;

float ohash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Värdebrus med derivator, för de eroderade sluttningarna
vec3 onoised(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = ohash(i);
  float b = ohash(i + vec2(1.0, 0.0));
  float c = ohash(i + vec2(0.0, 1.0));
  float d = ohash(i + vec2(1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}
float onoise(vec2 x) {
  return onoised(x).x;
}
const mat2 OM = mat2(0.8, -0.6, 0.6, 0.8);
float ofbm(vec2 p, int oct) {
  float a = 0.0;
  float b = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    a += b * onoise(p);
    b *= 0.5;
    p = OM * p * 2.03;
  }
  return a;
}
// Eroderat brus: lutningen dämpar de finare oktaverna, så att det blir åsar och raviner
float eroded(vec2 p, int oct) {
  float a = 0.0;
  float b = 0.5;
  vec2 d = vec2(0.0);
  for (int i = 0; i < 11; i++) {
    if (i >= oct) break;
    vec3 n = onoised(p);
    d += n.yz;
    a += b * n.x / (1.0 + dot(d, d));
    b *= 0.5;
    p = OM * p * 2.0;
  }
  return a;
}

// Dalens mitt i sidled (m) på avståndet z: sjön slingrar sig bort mot fjällen
float valleyX(float z) {
  return 0.13 * z - 200.0 + 2200.0 * (onoise(vec2(z / 8000.0, 3.7)) - 0.5);
}
// Hur långt ut från dalens mitt punkten är: 0 mitt i sjön, 1 vid stranden, mer upp mot fjällen
float valleyD(vec2 q) {
  float w = 0.17 * q.y + 700.0;
  return abs(q.x - valleyX(q.y)) / w + 0.4 * (onoise(q / 2200.0 + 1.3) - 0.5);
}
// Markens höjd (m, i plattans koordinater) i punkten q = (x, z)
float oHeight(vec2 q, int oct) {
  float e = eroded(q / 2600.0 + vec2(4.3, 1.9), oct);
  float d = valleyD(q);
  float m = max(smoothstep(0.9, 2.6, d), smoothstep(13000.0, 21000.0, q.y));
  float massif = 0.55 + 0.45 * onoise(q / 9000.0 + 7.1);
  // Högre längre bort, så att de bortre kedjorna reser sig över de närmare
  float mtn = (250.0 + 3100.0 * massif * pow(e, 1.6)) * (1.0 + 0.85 * smoothstep(12000.0, 30000.0, q.y));
  // Kullarna i dalen: skog, uddar och öar, under vattnet mitt i sjön
  float hills = (e * 560.0 - 150.0) * smoothstep(0.3, 1.2, d) - 70.0 * (1.0 - smoothstep(0.25, 0.8, d));
  float h = mix(hills, mtn, m);
  // En skogsklädd rygg nedanför hyllan, till vänster om sjön: skogen mellan plattan och vattnet
  float s = (q.x - valleyX(q.y)) / (0.17 * q.y + 700.0);
  float ridge = smoothstep(1100.0, 2100.0, q.y) * (1.0 - smoothstep(3800.0, 5600.0, q.y)) * (1.0 - smoothstep(-0.55, 0.15, s));
  // Ryggen får raviner och små kullar, så att skogen på den får relief i stället för en slät yta
  float gully = ridge > 0.0 ? 60.0 * (onoise(q / 320.0 + 2.1) + 0.5 * onoise(q / 150.0 + 4.7) - 0.75) - 60.0 * pow(1.0 - abs(2.0 * onoise(q / 520.0 + 6.3) - 1.0), 6.0) : 0.0;
  h = max(h, ridge * (120.0 + 240.0 * e + gully) - 40.0 * (1.0 - ridge));
  // Trädkronorna: skogen nedanför trädgränsen får en knottrig yta på nära håll
  if (oct > 7 && oCrown > 0.0 && h > 4.0 && h < 650.0) h += oCrown * 14.0 * onoise(q / 16.0) * smoothstep(4.0, 30.0, h) * (1.0 - smoothstep(450.0, 650.0, h));
  return LAKE + h;
}

// Strålen mot marken eller sjön: avståndet, eller -1 om den går ut i himlen. Speglingen i sjön
// (floorY = höjd långt under sjön) räknar inte med vattenytan, som strålen annars kröp längs.
float oMarch(vec3 ro, vec3 rd, float tmax, int steps, float floorY) {
  float t = 40.0;
  float last = t;
  for (int i = 0; i < 480; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float dh = p.y - max(oHeight(p.xz, 7), floorY);
    if (dh < 0.0) {
      float a = last;
      float b = t;
      for (int k = 0; k < 7; k++) {
        float mid = 0.5 * (a + b);
        vec3 pm = ro + rd * mid;
        if (pm.y - max(oHeight(pm.xz, 7), floorY) < 0.0) b = mid;
        else a = mid;
      }
      return b;
    }
    if (rd.y > 0.0 && p.y > LAKE + 2900.0) break;
    last = t;
    t += max(0.42 * dh, 0.0015 * t + 2.0);
    if (t > tmax) break;
  }
  return -1.0;
}

float oShadow(vec3 p, vec3 L) {
  float res = 1.0;
  float t = 15.0;
  for (int i = 0; i < 72; i++) {
    vec3 q = p + L * t;
    float dh = q.y - oHeight(q.xz, 6);
    res = min(res, 10.0 * dh / t);
    if (res < 0.0 || q.y > LAKE + 2900.0) break;
    t += clamp(0.5 * dh, 20.0, 900.0);
  }
  return smoothstep(0.0, 1.0, clamp(res, 0.0, 1.0));
}

vec3 oSunCol() {
  return mix(vec3(1.0, 0.84, 0.62) * 2.7, vec3(1.0, 0.62, 0.36) * 3.0, uDusk);
}

// Himlen: djupblå uppåt, ljus och disig mot horisonten, och några tunna moln
vec3 oSky(vec3 rd, vec3 L) {
  float y = max(rd.y, 0.0);
  vec3 hor = mix(vec3(0.5, 0.6, 0.74), vec3(0.78, 0.62, 0.5), uDusk);
  vec3 zen = mix(vec3(0.02, 0.1, 0.3), vec3(0.08, 0.1, 0.28), uDusk);
  vec3 c = mix(hor, zen, pow(min(y * 6.0, 1.0), 0.55));
  // Ett varmt, ljust disband precis ovanför fjällen
  c = mix(c, mix(vec3(0.72, 0.74, 0.74), vec3(0.95, 0.6, 0.4), uDusk), 0.4 * exp(-y * 40.0));
  c += oSunCol() * 0.05 * pow(max(dot(rd, L), 0.0), 6.0);
  if (rd.y > 0.003) {
    // Molnen på ett plan högt över fjällen: stråk av slöjmoln och några tussar nära horisonten
    vec2 uv = rd.xz * (3200.0 / rd.y) / 5200.0 + vec2(3.1, 1.7);
    float n = ofbm(uv * vec2(1.0, 2.6), 6);
    float cl = smoothstep(0.6, 0.82, n) * (1.0 - smoothstep(0.02, 0.1, rd.y));
    vec3 cc = mix(vec3(0.95, 0.95, 0.97), vec3(1.0, 0.8, 0.62), uDusk) * (0.8 + 0.25 * smoothstep(0.5, 0.8, n));
    c = mix(c, cc, cl * 0.75 * smoothstep(0.003, 0.03, rd.y));
  }
  return c;
}

// Disets färg: himlen vid horisonten, varmare mot solen
vec3 oHaze(vec3 rd, vec3 L) {
  vec3 h = mix(vec3(0.17, 0.32, 0.64), vec3(0.72, 0.58, 0.5), uDusk);
  return h + oSunCol() * 0.06 * pow(max(dot(rd, L), 0.0), 3.0);
}

// Markens färg och ljus i punkten p (normal N), utan dis
vec3 oShade(vec3 p, vec3 N, vec3 rd, float t, vec3 L, bool shadows) {
  float alt = p.y - LAKE;
  vec2 q = p.xz;
  float n1 = ofbm(q / 400.0, 4);
  float n2 = onoise(q / 37.0);
  // Berg i dagen där det är brant, hed och gräs, skog nedanför trädgränsen, snö högt upp
  vec3 rock = mix(vec3(0.24, 0.24, 0.25), vec3(0.42, 0.39, 0.36), n1) * (0.85 + 0.3 * n2);
  rock *= 0.9 + 0.12 * sin(alt * 0.03 + n1 * 9.0 + 4.0 * n2); // skikt i berget
  vec3 heath = mix(vec3(0.26, 0.29, 0.15), vec3(0.4, 0.36, 0.22), n1);
  // Finare detaljer bara på nära håll: längre bort blir de prickar (en bildpunkt är t/1600 m)
  float near = 1.0 - smoothstep(900.0, 2600.0, t);
  float n3 = ofbm(q / 140.0, 3);
  // Barrskog i mörkgrönt, med stråk av ljusare björk och lövskog i solen
  vec3 forest = mix(vec3(0.06, 0.1, 0.045), vec3(0.13, 0.17, 0.07), smoothstep(0.35, 0.7, n3));
  forest = mix(forest, vec3(0.22, 0.22, 0.08), 0.45 * smoothstep(0.55, 0.75, n1 + 0.2 * (n3 - 0.5)));
  // Dungar och gläntor med gyllene gräs och myr, så stora att de syns som mönster på håll
  float clump = ofbm(q / 260.0 + 3.3, 4);
  forest = mix(forest, mix(vec3(0.22, 0.24, 0.1), vec3(0.3, 0.29, 0.13), n2), smoothstep(0.56, 0.76, clump) * 0.6);
  forest *= 1.0 + near * 0.35 * (onoise(q / 9.0) - 0.5) + 0.25 * (n2 - 0.5) * (0.4 + 0.6 * near);
  // Kronorna som mörka och ljusa fläckar i grönt på medellångt håll, i stället för gula prickar
  forest *= 1.0 + 0.4 * (onoise(q / 30.0) - 0.5) * (1.0 - smoothstep(3500.0, 7000.0, t)) * (1.0 - near);
  float flat0 = smoothstep(0.55, 0.8, N.y);
  float tree = (1.0 - smoothstep(520.0, 720.0, alt + 220.0 * (n1 - 0.5))) * smoothstep(0.6, 0.78, N.y);
  tree *= smoothstep(0.22, 0.38, n1 + 0.25 * (n2 - 0.5) * near);
  vec3 col = mix(rock, heath, flat0);
  col = mix(col, forest, tree);
  float shore = 1.0 - smoothstep(1.0, 6.0, alt);
  col = mix(col, vec3(0.42, 0.4, 0.34), shore * 0.7);
  float snowLine = 1300.0 + 300.0 * (n1 - 0.5);
  float snow = smoothstep(snowLine - 120.0, snowLine + 120.0, alt + 500.0 * (N.y - 0.7)) * smoothstep(0.5, 0.72, N.y + 0.2 * n2);
  col = mix(col, vec3(0.93, 0.95, 1.0), snow);
  col = pow(col, vec3(2.2));

  float ndl = max(dot(N, L), 0.0);
  float sh = shadows && ndl > 0.0 ? oShadow(p + N * 2.0, L) : 1.0;
  vec3 skyAmb = mix(vec3(0.17, 0.26, 0.5), vec3(0.4, 0.32, 0.38), uDusk);
  vec3 bounce = vec3(0.12, 0.11, 0.08);
  vec3 c = col * (oSunCol() * ndl * sh + skyAmb * (0.6 + 0.4 * N.y) + bounce * (0.5 - 0.5 * N.y));
  // Snön glänser lite i solen
  c += snow * oSunCol() * 0.06 * pow(max(dot(N, normalize(L - rd)), 0.0), 24.0) * sh;
  return c;
}

// Dis längs strålen till punkten på höjden y (m, plattans koordinater): tunt överallt, och ett
// blått dis som ligger kvar nere i dalen och gör skuggsidorna där ljusa och blå
vec3 oFog(vec3 c, vec3 rd, float t, vec3 L, float y) {
  float alt = rd.y * t; // höjd över ögat där strålen slutar
  float f = 1.0 - exp(-t / 52000.0 * mix(1.0, 0.6, smoothstep(-200.0, 2400.0, alt)));
  float valley = (1.0 - exp(-t / 7000.0)) * (1.0 - smoothstep(LAKE, LAKE + 1100.0, y));
  return mix(c, oHaze(rd, L), max(f, 0.42 * valley));
}

vec3 tonemapO(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// Utsikten längs strålen dir från ögat eye, i sRGB. Strålföljningen och ljuset anropas från
// ett enda ställe var (sjöns spegling är ett andra varv i slingan), så att shadern blir liten
// och går fort att bygga.
vec3 overlook(vec3 eye, vec3 dir) {
  // Över dalen står solen lågt till vänster, nästan i sidled: fjällen får ljusa vänstersidor och
  // skuggsidor åt höger, och sluttningarna mot kameran får varmt sidoljus
  vec3 L = normalize(vec3(-0.6, mix(0.6, 0.15, uDusk), -0.55));
  vec3 ro = eye;
  vec3 rd = dir;
  float t0 = -1.0;     // avståndet till sjön, om strålen träffade den
  float fres = 0.0;
  vec3 c = vec3(0.0);
  float t = -1.0;
  for (int pass = 0; pass < 2; pass++) {
    t = oMarch(ro, rd, pass == 0 ? 90000.0 : 60000.0, pass == 0 ? 460 : 360, pass == 0 ? LAKE : LAKE - 1e4);
    if (t < 0.0) {
      c = oSky(rd, L);
      break;
    }
    vec3 p = ro + rd * t;
    if (pass == 0 && oHeight(p.xz, 8) <= LAKE + 0.01) {
      // Sjön: speglar fjällen och himlen, mörk och klar rakt nedåt
      // Långa, mjuka dyningar i stället för krusningar, som på långt håll bara blev brus i speglingen
      vec2 rip = vec2(onoise(p.xz / vec2(900.0, 160.0)), onoise(p.xz / vec2(900.0, 160.0) + 5.2)) - 0.5;
      rip *= 0.006;
      vec3 Nw = normalize(vec3(rip.x, 1.0, rip.y));
      fres = 0.04 + 0.96 * pow(1.0 - max(dot(-dir, Nw), 0.0), 5.0);
      t0 = t;
      ro = vec3(p.x, LAKE + 0.5, p.z);
      rd = reflect(dir, Nw);
      rd.y = max(rd.y, 0.002);
      continue;
    }
    // Normalen ur tre höjder, i en slinga så att höjdfunktionen bara byggs in en gång
    float e = 2.0 + (t + max(t0, 0.0)) * 0.0012;
    int oct = t < 5000.0 ? 10 : t < 14000.0 ? 9 : 8;
    oCrown = 1.0 - smoothstep(700.0, 2600.0, t + max(t0, 0.0));
    float hh[3];
    for (int k = 0; k < 3; k++) hh[k] = oHeight(p.xz + (k == 1 ? vec2(e, 0.0) : k == 2 ? vec2(0.0, e) : vec2(0.0)), oct);
    vec3 N = normalize(vec3(hh[0] - hh[1], e, hh[0] - hh[2]));
    c = oShade(p, N, rd, t, L, pass == 0);
    c = oFog(c, rd, t, L, p.y);
    // I speglingen suddas fjällen ut av krusningar och dis, så att de inte blir vita fläckar
    if (pass == 1) c = min(mix(c, oHaze(rd, L), 0.6), oHaze(rd, L) * 1.25);
    break;
  }
  if (t0 > 0.0) {
    // Klart, djupt blått vatten som speglar himlen och fjällen
    vec3 deep = vec3(0.025, 0.1, 0.24);
    c = mix(deep, c * vec3(0.78, 0.88, 1.0), 0.1 + fres * 0.65);
    c = oFog(c, dir, t0, L, LAKE);
  }
  // Lite mättnad, som i en solig eftermiddag med klar luft
  c = max(mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 1.22), 0.0);
  return pow(tonemapO(c), vec3(1.0 / 2.2));
}
#endif
`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uRes;      // canvasens storlek i bildpunkter
uniform float uRowTop;  // canvasens överkant i hela bilden (bildpunkter), när den ritas i remsor
uniform float uScale;   // bildpunkter per CSS-pixel
uniform float uCx;      // optiska mitten i sidled (CSS-px)
uniform float uFocal;   // brännvidd (CSS-px)
uniform float uCamH;    // kamerans höjd över plattan
uniform float uCamD;    // kamerans avstånd framför plattans mitt
uniform vec3 uSun;      // riktning mot solen
uniform float uDusk;
uniform float uHorizon; // horisontens läge i canvasen (CSS-px från överkanten), 0 för bara hyllan
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
const float PAINT_R = ${PAINT_R.toFixed(2)}; // den gula streckade cirkelns radie (m)
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
  vec3 col = mix(vec3(0.3, 0.29, 0.28), vec3(0.52, 0.49, 0.45), smoothstep(0.25, 0.75, fbm(g * 0.16)));
  col *= 0.78 + 0.4 * fbm(g * 0.8 + 11.0);
  // Fläckar i halvmetersskala: mörkare mineral och ljusare kvarts, så att hällen inte blir slät på håll
  col *= 0.82 + 0.36 * smoothstep(0.3, 0.7, fbm(g * 2.6 + 23.0));
  col = mix(col, col * vec3(1.12, 1.0, 0.84), smoothstep(0.55, 0.75, fbm(g * 0.5 + 31.0)) * 0.5); // brunare partier
  // Kornen: fältspat och glimmer, tonas bort på avstånd innan de flimrar
  float grain = noise(g * 26.0) - 0.5 + 0.5 * (noise(g * 61.0) - 0.5);
  col *= 1.0 + 0.32 * grain * (1.0 - smoothstep(0.03, 0.12, fw));
  // Vittrade, mörkare partier och varma rostflammor
  col = mix(col, col * vec3(0.86, 0.84, 0.82), smoothstep(0.55, 0.8, fbm(g * 0.09 + 4.0)));
  col = mix(col, col * vec3(1.1, 1.0, 0.86), smoothstep(0.5, 0.75, fbm(g * 0.33 + 17.0)) * 0.6);
  // Långa, raka fogar mellan hällens flak
  col *= 1.0 - 0.13 * cracks(g * 0.32 + 30.0) * smoothstep(0.45, 0.6, noise(g * 0.25 + 8.0));
  col *= 1.0 - 0.09 * cracks(g * 0.9 + 3.0) * smoothstep(0.55, 0.7, noise(g * 0.7 + 3.0));
  // Lav: bleka gröngrå och ockra fläckar
  float lich = smoothstep(0.66, 0.74, fbm(g * 0.55 + 3.0));
  col = mix(col, vec3(0.56, 0.58, 0.46), lich * 0.5);
  col = mix(col, vec3(0.62, 0.5, 0.28), smoothstep(0.72, 0.8, fbm(g * 1.3 + 9.0)) * 0.4);
  // Lite gråare och ljusare: i det varma solljuset blir hällen annars brun som torkad lera
  return mix(col, vec3(dot(col, vec3(0.3, 0.4, 0.3))), 0.3) * 1.06;
}

// Cellbrus: avståndet till närmaste kant mellan två celler (x) och cellens slumptal (y). Ger
// hällens flak, där berget flagnat av i skivor med smala fogar emellan.
vec2 cells(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  vec2 mr = vec2(0.0);
  vec2 mg = vec2(0.0);
  float md = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + vec2(hash(n + g), hash(n + g + 17.3)) - f;
      float d = dot(r, r);
      if (d < md) {
        md = d;
        mr = r;
        mg = g;
        id = hash(n + g + 3.1);
      }
    }
  }
  md = 8.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + vec2(hash(n + g), hash(n + g + 17.3)) - f;
      if (dot(mr - r, mr - r) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
    }
  }
  return vec2(md, id);
}

// Hällens relief (m) i punkten g: flak som ligger på olika höjd, fogar mellan dem, skiktens
// vågiga strimmor och knottrig yta. Finare detaljer tonas bort på avstånd (fw: m per bildpunkt).
// flake = cellbrusets värden, för färgen.
float rockRelief(vec2 g, float fw, out vec2 flake) {
  vec2 w = vec2(fbm(g * 0.3), fbm(g * 0.3 + 5.2)) - 0.5;
  // Flaken är avlånga, som skivor som släppt längs berggrundens skikt
  flake = cells(g * vec2(0.42, 0.75) + w * 2.4);
  // Fogarna syns bara där bruset vill: berget har spruckit här och var, inte överallt
  float open = smoothstep(0.5, 0.72, noise(g * 0.35 + 9.0));
  float groove = (1.0 - smoothstep(0.0, 0.05, flake.x)) * open;
  float h = 0.05 * flake.y * open - 0.035 * groove;
  // Skikten: långa vågiga strimmor tvärs över hällen
  float strata = abs(fract(g.y * 0.8 + 1.6 * fbm(g * 0.22 + 2.0) + 0.3 * g.x * 0.2) - 0.5);
  h += 0.012 * smoothstep(0.1, 0.0, strata);
  h += 0.03 * fbm(g * 0.9 + 3.0) + 0.012 * noise(g * 3.3);
  h += 0.004 * (noise(g * 11.0) + noise(g * 23.0)) * (1.0 - smoothstep(0.015, 0.05, fw));
  return h;
}

// Hyllan med plattan, blocken och växtligheten i CSS-pixeln px (y nedåt från horisonten), som
// förmultiplicerad färg: alfa 0 bortom kanten
vec4 ledge(vec2 px) {
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
  if (!rock && alpha <= 0.0 && cov <= 0.0) return vec4(0.0);

  vec3 L = normalize(uSun);
  vec3 sunCol = mix(vec3(1.0, 0.85, 0.64) * 3.1, vec3(1.0, 0.62, 0.36) * 3.4, uDusk); // samma gyllene sol som över dalen
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
    // Hällen: flak av grå granit med fogar och vågiga skikt. Reliefen ger normalen, så att den
    // låga solen tar i flakens kanter och lämnar fogarna i skugga.
    vec2 flake;
    float e = 0.025;
    vec2 tmp;
    float h0 = rockRelief(g, fw, flake);
    float hx = rockRelief(g + vec2(e, 0.0), fw, tmp);
    float hz = rockRelief(g + vec2(0.0, e), fw, tmp);
    float relief = 1.0 - smoothstep(0.04, 0.2, fw); // långt bort blir reliefen bara brus
    N = normalize(vec3(-(hx - h0) / e * relief, 1.0, -(hz - h0) / e * relief));
    col = granite(g, fw);
    // Varje flak har sin egen ton: ljusare nyss avflagnade, mörkare och rostigare gamla
    float open = smoothstep(0.5, 0.72, noise(g * 0.35 + 9.0));
    col *= mix(1.0, 0.8 + 0.36 * flake.y, open * 0.8);
    col = mix(col, col * vec3(1.08, 0.96, 0.82), smoothstep(0.75, 0.95, flake.y) * open * 0.6);
    float groove = (1.0 - smoothstep(0.0, 0.035, flake.x)) * open;
    // Fogarna mörka men smala: ett tätt nät av svarta linjer ser ut som torkad lera, inte granit
    col *= 1.0 - 0.18 * groove;
    ao *= 1.0 - 0.25 * groove;
    // Ränder av fukt och smuts i sänkorna
    col *= 1.0 - 0.22 * smoothstep(0.012, -0.01, h0 - 0.03 * fbm(g * 0.9 + 3.0) - 0.02);
    // Nära kanten: mörkare sten, lingonris och gräs i skrevorna, och kanten själv rundar av
    float edge = smoothstep(3.5, 0.0, rim - p.z);
    vec3 scrub = mix(vec3(0.10, 0.14, 0.06), vec3(0.36, 0.30, 0.12), fbm(g * 2.3));
    col = mix(col, scrub, edge * 0.85 * smoothstep(0.3, 0.55, fbm(g * 1.1 + 5.0)));
    col = mix(col, scrub, groove * 0.5 * smoothstep(0.45, 0.7, fbm(g * 1.7 + 2.0))); // gräs i fogarna
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
      ao *= mix(0.35, 1.0, smoothstep(0.85, 1.6, contact));
      vec2 ds = (g - c.xz - sdir * top * 0.6) / (r.xz + vec2(top * 0.3));
      shade *= mix(0.3, 1.0, smoothstep(0.7, 1.1, length(ds)));
    }

    // Plattan: färgen målad direkt på hällen: gul streckad cirkel, ett H och en mittlinje mot kameran
    float r = r0;
    // Avgassot och slitage mitt på plattan
    col *= 1.0 - 0.12 * smoothstep(4.5, 0.0, r) * fbm(g * 0.9);
    // Nött färg: färgen sitter kvar på flakens toppar men har slitits bort i fogar och sänkor
    float wear = (0.5 + 0.5 * smoothstep(0.2, 0.5, fbm(g * 2.5 + 40.0))) * (1.0 - groove) * smoothstep(-0.02, 0.02, h0 - 0.02);
    vec3 yellow = vec3(0.96, 0.72, 0.1);
    float ang = atan(g.y, g.x);
    float dash = step(0.24, fract(ang * 36.0 / 6.2831853));
    float ring = inside(abs(r - PAINT_R) - 0.13) * dash;
    float cl = inside(abs(g.x) - 0.13) * step(g.y, -PAINT_R - 0.45) * step(-11.5, g.y) * step(fract(g.y * 0.5), 0.55);
    float hl = inside(abs(abs(g.x) - 1.0) - 0.22) * inside(abs(g.y) - 1.55);
    float hm = inside(abs(g.x) - 1.0) * inside(abs(g.y) - 0.2);
    float circ = inside(abs(r - 2.75) - 0.12);
    // H:et och den inre cirkeln är nästan bortnötta av hjulen och dammet
    float paint = max(max(ring, cl), 0.3 * max(max(hl, hm), circ)) * wear;
    col = mix(col, yellow, paint * 0.95);
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
    // Riset och granarna: mörkgrönt, granarna nästan svarta med ljusare solsida (solen från vänster)
    float rel = clamp(pv.y / max(vh, 0.2), 0.0, 1.0);
    float leaf = fbm(vec2(pv.x * 6.0, pv.y * 9.0));
    vec3 vc = mix(vec3(0.07, 0.1, 0.045), vec3(0.2, 0.24, 0.1), leaf);
    vc = mix(vc, vec3(0.34, 0.24, 0.1), smoothstep(0.6, 0.8, fbm(vec2(pv.x * 2.0, 3.0))) * 0.6); // höstfärgat ris
    float lit = 0.35 + 0.65 * smoothstep(0.1, 1.0, rel) * (0.5 + 0.5 * leaf);
    float isTree = step(inside(pv.y - vh), treeCov - 0.01);
    vc = mix(vc, mix(vec3(0.03, 0.055, 0.035), vec3(0.09, 0.13, 0.06), leaf), isTree);
    lit = mix(lit, 0.25 + 0.9 * smoothstep(0.3, 1.0, 1.0 - side), isTree);
    vc = pow(vc, vec3(2.2));
    vec3 cv = vc * (sky * 0.45 + sunCol * max(L.y, 0.2) * lit * 0.9);
    cv = mix(cv, mix(vec3(0.45, 0.55, 0.72), vec3(0.6, 0.42, 0.38), uDusk), 1.0 - exp(-tv / 600.0));
    cv = pow(tonemap(cv), vec3(1.0 / 2.2));
    outc += cv * cov;
    a += cov;
  }
  return vec4(outc, a);
}
// OVERLOOK
void main() {
  // CSS-pixel i canvasen, y nedåt från horisonten (som ligger uHorizon CSS-px ned i canvasen)
  vec2 px = vec2(gl_FragCoord.x, uRowTop + uRes.y - gl_FragCoord.y) / uScale - vec2(0.0, uHorizon);
  vec4 c = px.y > 0.0 ? ledge(px) : vec4(0.0);
#ifdef FULL
  // Utsikten bakom hyllan: dalen med sjön, skogen och fjällen
  if (c.a < 0.999) {
    vec3 dir = normalize(vec3((px.x - uCx) / uFocal, -px.y / uFocal, 1.0));
    c = vec4(c.rgb + overlook(vec3(0.0, uCamH, -uCamD), dir) * (1.0 - c.a), 1.0);
  }
#else
  if (c.a <= 0.0) discard;
#endif
  outColor = c;
}`;

function compile(gl, type, src, check = true) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (check && !gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

const UNIFORMS = ['uRes', 'uRowTop', 'uScale', 'uCx', 'uFocal', 'uCamH', 'uCamD', 'uSun', 'uDusk', 'uHorizon'];
// Helbilden ritas i remsor, en remsa per bild, så att ingen enskild bild tar för lång tid för
// grafikkortet. Remsans höjd anpassas efter hur lång tid bilderna tar (bildpunkter per remsa).
const STRIP_PX = { start: 1920 * 6, min: 1920 * 2, max: 1920 * 32 };

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

  #shot = { key: '', doneKey: '', row: 0, next: null, done: null, px: STRIP_PX.start };

  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.lost = false;
    this.key = '';
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.pad = this.#program(FRAGMENT);
    // Helbilden med utsikten: samma shader med FULL definierad. Den är stor och tar en stund att
    // bygga, så den byggs i bakgrunden när det går (KHR_parallel_shader_compile) och används först
    // när den är klar; till dess hovrar man framför 3D-landskapet som förut.
    this.parallel = gl.getExtension('KHR_parallel_shader_compile');
    const full = FRAGMENT.replace('precision highp float;', 'precision highp float;\n#define FULL').replace('// OVERLOOK', OVERLOOK);
    this.full = this.#program(full, !this.parallel);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    // En liten bild direkt, så att shadern byggs klart när sidan laddas och inte hackar första hovringen
    this.render({ width: 2, height: 2, cx: 1, focal: 10, sun: [0, 1, 0] });
    if (!this.parallel) this.#fullReady();
  }

  /** Bygger ett program; utan wait får finish() vänta tills det är klart (se #fullReady). */
  #program(fs, wait = true) {
    const gl = this.gl;
    const p = gl.createProgram();
    const shaders = [compile(gl, gl.VERTEX_SHADER, VERTEX, wait), compile(gl, gl.FRAGMENT_SHADER, fs, wait)];
    for (const sh of shaders) gl.attachShader(p, sh);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    const prog = { p, u: null, shaders, failed: false };
    if (wait) this.#finish(prog);
    return prog;
  }

  /** Kontrollerar länkningen och hämtar programmets uniforms. */
  #finish(prog) {
    const gl = this.gl;
    if (!gl.getProgramParameter(prog.p, gl.LINK_STATUS)) {
      prog.failed = true;
      const log = gl.getProgramInfoLog(prog.p) || prog.shaders.map((sh) => gl.getShaderInfoLog(sh)).join('\n');
      throw new Error(log || 'link');
    }
    prog.u = {};
    for (const name of UNIFORMS) prog.u[name] = gl.getUniformLocation(prog.p, name);
  }

  /** Är helbildens program byggt? Första gången det är klart ritas en liten bild, så att drivrutinen gör klart sitt. */
  #fullReady() {
    const prog = this.full;
    if (prog.u) return true;
    if (prog.failed) return false;
    if (this.parallel && !this.gl.getProgramParameter(prog.p, this.parallel.COMPLETION_STATUS_KHR)) return false;
    try {
      this.#finish(prog);
    } catch (err) {
      console.warn('[Ergcopter] Utsikten från plattan går inte att bygga:', err.message);
      return false;
    }
    this.#draw(prog, { width: 2, cx: 1, focal: 10, sun: [0, 1, 0], horizon: 1 }, 2, 2, 1, 0);
    this.key = '';
    return true;
  }

  /** Ritar canvasen (w × h bildpunkter), som är remsan från rad rowTop i bilden. */
  #draw(prog, o, w, h, scale, rowTop) {
    const { gl, canvas } = this;
    const { p, u } = prog;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(p);
    gl.uniform2f(u.uRes, w, h);
    gl.uniform1f(u.uRowTop, rowTop);
    gl.uniform1f(u.uScale, scale);
    gl.uniform1f(u.uCx, o.cx);
    gl.uniform1f(u.uFocal, o.focal);
    gl.uniform1f(u.uCamH, PAD_CAM.height);
    gl.uniform1f(u.uCamD, PAD_CAM.dist);
    gl.uniform3fv(u.uSun, o.sun);
    gl.uniform1f(u.uDusk, o.dusk ?? 0);
    gl.uniform1f(u.uHorizon, o.horizon ?? 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
    const scale = o.scale ?? 1;
    const w = Math.max(1, Math.round(o.width * scale));
    const h = Math.max(1, Math.round(o.height * scale));
    const key = [w, h, o.cx, o.focal, ...o.sun, o.dusk ?? 0].map((v) => Math.round(v * 100)).join(',');
    if (key === this.key) return this.canvas;
    this.key = key;
    this.#draw(this.pad, { ...o, horizon: 0 }, w, h, scale, 0);
    return this.canvas;
  }

  /**
   * Hela bilden i hovringen: himlen, utsikten över dalen och hyllan med plattan, med
   * horisonten o.horizon CSS-px ned. Utsikten är tung att räkna, så den ritas i remsor, en
   * per anrop, till en egen 2D-canvas. Tills den är klar ges den förra färdiga bilden, eller null.
   * @param {object} o  som render(), plus o.height (hela bildens höjd), o.horizon och o.frameMs
   *   (förra bildens längd: blev den lång görs remsorna smalare)
   * @returns {{canvas: HTMLCanvasElement, ready: boolean}|null}
   */
  view(o) {
    if (this.lost || typeof document === 'undefined') return null;
    const v = this.#shot;
    if (!this.#fullReady()) return null;
    const scale = o.scale ?? 1;
    const w = Math.max(1, Math.round(o.width * scale));
    const h = Math.max(1, Math.round(o.height * scale));
    const key = [w, h, o.cx, o.focal, o.horizon, ...o.sun, o.dusk ?? 0].map((x) => Math.round(x * 100)).join(',');
    if (key !== v.doneKey) {
      if (key !== v.key) {
        v.key = key;
        v.row = 0;
        v.next ??= document.createElement('canvas');
        v.next.width = w;
        v.next.height = h;
      }
      const ms = o.frameMs ?? 0;
      if (ms > 20) v.px = Math.max(STRIP_PX.min, v.px * 0.6);
      else if (ms > 0 && ms < 18) v.px = Math.min(STRIP_PX.max, v.px * 1.15);
      const rows = Math.max(1, Math.floor(v.px / w));
      this.#draw(this.full, o, w, rows, scale, v.row);
      this.key = ''; // hyllans egen bild i canvasen är borta
      v.next.getContext('2d').drawImage(this.canvas, 0, 0, w, rows, 0, v.row, w, rows);
      v.row += rows;
      if (v.row >= h) {
        [v.done, v.next] = [v.next, v.done];
        v.doneKey = key;
      }
    }
    return v.done ? { canvas: v.done, ready: v.doneKey === key } : null;
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
 * Riktningen mot solen i plattans koordinater: snett uppifrån vänster och lite bakom kameran. Då får
 * helikopterns nos och vänstra sida varmt solljus och den högra sidan skugga (form i stället för platt
 * motljus). Skuggan på plattan kastas brantare (drawHeliShadow). heli3d.js får samma riktning sedd
 * från kameran (heliSun).
 */
export function padSun(dusk = 0) {
  const day = [-0.7, 0.68, -0.24];
  const eve = [-0.82, 0.46, -0.18];
  const s = day.map((v, i) => v + (eve[i] - v) * dusk);
  const n = Math.hypot(...s);
  return s.map((v) => v / n);
}

/**
 * Solen för heli3d.js, som räknar x åt vänster i bild. Lite lägre än över plattan, så att ljuset
 * tar i nosen och vindrutan i stället för bara i taket (skuggan på plattan följer padSun).
 */
export function heliSun(dusk = 0) {
  const [x, y, z] = padSun(dusk);
  const n = Math.hypot(x, y * 0.6, z);
  return [-x / n, (y * 0.6) / n, z / n];
}

/** En vågrät cirkel (mitt x, y, z och radie r) som ellips i bild. */
function flatEllipse(f, x, y, z, r) {
  const p = padProject(f, x, y, z);
  const depth = z + PAD_CAM.dist;
  return { x: p.x, y: p.y, rx: p.k * r, ry: (p.k * r * (PAD_CAM.height - y)) / depth };
}

// Helikopterns form för skuggan, i heli3d.js modellkoordinater (m): x åt sidan, y upp från medarna,
// z framåt mot nosen. Kroppens halva bredd längs z, bommen, fenan, stabilisatorn och medarna.
const HULL = [[2.86, 0.03], [2.78, 0.34], [2.5, 0.6], [2.05, 0.62], [1.45, 0.69], [0.6, 0.71], [-0.6, 0.71],
  [-1.3, 0.69], [-1.72, 0.66], [-1.98, 0.5], [-2.1, 0.3], [-2.13, 0.03]];
const TAILBOOM = [[-1.5, 0.3], [-2.6, 0.25], [-5.0, 0.18], [-6.45, 0.14], [-6.6, 0.03]];
const MODEL_CENTER = [0, 1.55, -1.6]; // heli3d.js CENTER: punkten som hamnar på (0, hh, 0) över plattan
const MODEL_HUB = [0, 2.98, 0.15];
let shadowCanvas = null;

/**
 * Helikopterns skugga på plattan: kroppens, bommens, fenans, medarnas och rotorskivans form
 * kastad längs solens riktning ned på hällen. Den hamnar längre bort och blir mjukare ju högre
 * helikoptern hovrar, och krymper och skärps när den sjunker mot plattan.
 * @param {number} hh  helikopterns mitt över plattan (m)
 * @param {number} [heading]  helikopterns kurs kring mittpunkten (rad), 0 = nosen mot kameran
 */
export function drawHeliShadow(ctx, f, hh, sun, alpha, heading = 0) {
  if (typeof document === 'undefined' || alpha <= 0) return;
  // Modellens punkt till skuggans punkt på plattan (bildpunkter): nosen mot kameran, så x och z vänds.
  // Skuggan kastas brantare än solen lyser på kroppen: den ska ligga under helikoptern, innanför
  // ringen, och bara glida en bit åt solens motsatta håll. Annars hamnar den metrar bort på plattan
  // och ser inte ut att höra till helikoptern.
  const ly = Math.max(sun[1], 0.15) + 3.2;
  // heading: helikoptern vriden kring mittpunkten (heli3d.js o.heading), t.ex. snett framifrån vid inmatningen
  const hc = Math.cos(heading);
  const hs = Math.sin(heading);
  const at = (mx, my, mz) => {
    const y = Math.max(0, my - MODEL_CENTER[1] + hh);
    const dz = mz - MODEL_CENTER[2];
    const rx = mx * hc + dz * hs;
    const rz = -mx * hs + dz * hc;
    return padProject(f, -rx - (sun[0] / ly) * y, 0, -rz - (sun[2] / ly) * y);
  };
  const shapes = [];
  // Kroppen i tre skivor (buken, mitten och motorkåpan): tillsammans blir det kroppens hela skugga
  for (const [y, w] of [[0.5, 0.85], [1.25, 1], [2.0, 0.72]]) {
    shapes.push({ fill: [...HULL.map(([z, hw]) => at(hw * w, y, z)), ...HULL.toReversed().map(([z, hw]) => at(-hw * w, y, z))] });
  }
  shapes.push({ fill: [...TAILBOOM.map(([z, hw]) => at(hw, 1.86, z)), ...TAILBOOM.toReversed().map(([z, hw]) => at(-hw, 1.86, z))] });
  // Fenan är hög och smal: skuggan blir ett streck längs solen
  shapes.push({ line: [at(0, 1.6, -6.3), at(0, 2.0, -7.0), at(0, 2.6, -7.8)], w: 0.32 });
  shapes.push({ line: [at(-0.6, 1.86, -5.95), at(0.6, 1.86, -5.95)], w: 0.3 });
  for (const sx of [-1.12, 1.12]) shapes.push({ line: [at(sx, 0.06, -1.45), at(sx, 0.08, 1.98), at(sx, 0.22, 2.15)], w: 0.1 });
  for (const z of [1.05, -0.75]) {
    shapes.push({ line: [at(-1.12, 0.06, z), at(-0.7, 0.48, z), at(0.7, 0.48, z), at(1.12, 0.06, z)], w: 0.09 });
  }
  shapes.push({ line: [at(0, 2.2, MODEL_HUB[2]), at(0, MODEL_HUB[1], MODEL_HUB[2])], w: 0.22 });
  const disc = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    disc.push(at(Math.cos(a) * 5.1, MODEL_HUB[1], MODEL_HUB[2] + Math.sin(a) * 5.1));
  }

  // Ritas i lägre upplösning på en egen canvas, mjukad med oskärpa, och läggs sedan på plattan
  const all = [...disc, ...shapes.flatMap((sh) => sh.fill ?? sh.line)];
  const mid = at(0, 1.25, 0);
  const blur = mid.k * (0.012 + 0.006 * hh); // halvskuggan växer med höjden
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of all) {
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x);
    y1 = Math.max(y1, q.y);
  }
  const m = blur * 2 + 4;
  x0 -= m;
  y0 -= m;
  const k = 0.5; // skuggans canvas har halva upplösningen
  const cw = Math.ceil((x1 + m - x0) * k);
  const ch = Math.ceil((y1 + m - y0) * k);
  if (cw < 2 || ch < 2 || cw > 4096 || ch > 4096) return;
  shadowCanvas ??= document.createElement('canvas');
  const c = shadowCanvas;
  if (c.width < cw || c.height < ch) {
    c.width = Math.max(c.width, cw);
    c.height = Math.max(c.height, ch);
  }
  const x = c.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, cw, ch);
  x.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  x.filter = `blur(${(blur * k).toFixed(1)}px)`;
  const path = (pts) => {
    x.beginPath();
    pts.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)));
  };
  // Rotorskivan: bladen snurrar, så skivan ger bara en svag skugga
  x.fillStyle = 'rgb(0 0 0 / 0.1)';
  path(disc);
  x.fill();
  x.fillStyle = '#000';
  x.strokeStyle = '#000';
  x.lineCap = 'round';
  x.lineJoin = 'round';
  for (const sh of shapes) {
    if (sh.fill) {
      path(sh.fill);
      x.fill();
    } else {
      x.lineWidth = Math.max(1, mid.k * sh.w);
      path(sh.line);
      x.stroke();
    }
  }
  x.filter = 'none';
  // Mörkare när den ligger nära: högre upp sprids ljuset runt den
  ctx.globalAlpha = alpha * Math.max(0.42, 0.66 - 0.03 * Math.max(0, hh - 2));
  ctx.drawImage(c, 0, 0, cw, ch, x0, y0, cw / k, ch / k);
  ctx.globalAlpha = 1;
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
    const top = padProject(f, 0, hh - 1.45, 0);
    const bottom = padProject(f, 0, 0.1, 0);
    const w0 = top.k * 0.45;
    const w1 = bottom.k * 1.5;
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
    // En bred, dimmig kon och en mjuk kärna, inte en smal ljusstråle
    for (const sc of [1, 0.7, 0.46]) column(sc, 0.045 * a, 0.15 * a, '246 240 226');
    // Kärnan: en ljus, solbelyst pelare av dimma mitt under rotorn
    column(0.24, 0.14 * a, 0.34 * a, '255 250 238');
    column(0.1, 0.2 * a, 0.42 * a, '255 253 246');
    // Där luften slår i hällen lyser dammet i solen
    const glow = ctx.createRadialGradient(bottom.x, bottom.y, 0, bottom.x, bottom.y, bottom.k * 1.6);
    glow.addColorStop(0, `rgb(255 244 214 / ${(0.5 * a).toFixed(3)})`);
    glow.addColorStop(0.35, `rgb(250 230 190 / ${(0.2 * a).toFixed(3)})`);
    glow.addColorStop(1, 'rgb(250 230 190 / 0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = glow;
    ctx.translate(bottom.x, bottom.y);
    ctx.scale(1, 0.4);
    ctx.translate(-bottom.x, -bottom.y);
    ctx.fillRect(bottom.x - bottom.k * 1.6, bottom.y - bottom.k * 1.6, bottom.k * 3.2, bottom.k * 3.2);
    ctx.restore();
    // Virvlar av fukt och damm som följer luften nedåt och vidgas, så att pelaren blir ojämn
    if (sprite) {
      for (let i = 0; i < 16; i++) {
        const age = (t * 0.55 + i / 16) % 1;
        const fy = age ** 0.8;
        const y = top.y + (bottom.y - top.y) * fy;
        const k = top.k + (bottom.k - top.k) * fy;
        const size = k * (0.3 + 0.75 * age);
        const dx = Math.sin(i * 2.3 + t * 1.7) * k * (0.15 + 0.5 * age);
        ctx.globalAlpha = a * 0.3 * Math.sin(Math.PI * age);
        ctx.drawImage(sprite, top.x + dx - size, y - size * 0.6, size * 2, size * 1.2);
      }
      ctx.globalAlpha = 1;
    }
    // Ett dammoln där den slår i plattan
    if (sprite) {
      for (let i = 0; i < 3; i++) {
        const size = bottom.k * (0.9 + i * 0.65 + 0.15 * Math.sin(t * 2 + i));
        ctx.globalAlpha = a * (0.55 - i * 0.12);
        ctx.drawImage(sprite, bottom.x - size, bottom.y - size * 0.75, size * 2, size * 1.1);
      }
      ctx.globalAlpha = 1;
    }
  }
  // Vinden sveper damm utåt längs hällen: korta strimmor som rusar ut från mitten och tunnas ut
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < 44; i++) {
    const seed = Math.sin(i * 57.3 + 1.7) * 43758.5453;
    const rnd = seed - Math.floor(seed);
    const ang = (i / 44) * Math.PI * 2 + rnd * 0.4;
    if ((part === 'back') !== Math.sin(ang) > 0) continue;
    const age = (t * (0.7 + 0.5 * rnd) + rnd * 3.1) % 1;
    const r = 0.8 + age * (4.5 + 1.5 * rnd);
    const len = 0.5 + 1.1 * age;
    const p0 = padProject(f, Math.cos(ang) * r, 0.04, Math.sin(ang) * r);
    const p1 = padProject(f, Math.cos(ang) * (r + len), 0.04, Math.sin(ang) * (r + len));
    ctx.strokeStyle = `rgb(238 228 208 / ${(a * 0.15 * Math.sin(Math.PI * age)).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, p0.k * (0.03 + 0.04 * rnd));
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  ctx.restore();
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
    const size = p.k * (0.6 + age * 1.5);
    ctx.globalAlpha = a * Math.sin(Math.PI * age) * 0.24;
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
  x.shadowBlur = 0.28 * k;
  x.strokeStyle = inside ? 'rgb(40 225 90)' : 'rgb(110 190 130)';
  arc(0.2 * k);
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
    g.addColorStop(0.72, `rgb(60 255 120 / ${(inside ? 0.05 : 0.025) * pulse * alpha})`);
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
