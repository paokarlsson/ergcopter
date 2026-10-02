// Landskapet i 3D med WebGL2, i stil med Inigo Quilez "Elevated": alpina fjäll med snö,
// sten, hed och skog, en sjö i dalen som speglar fjällen, stackmoln i 3D, slöjmoln, dis
// och himmel i dags- och kvällsljus. Ritas på en egen canvas bakom spelets 2D-canvas
// (render.js), som ritar helikoptern, etiketterna och instrumenten.
//
// Kameran står på helikopterns höjd och tittar rakt in i bilden (+z, ingen lutning).
// Helikoptern flyger i ett plan PLANE_M framför kameran, där skalan är densamma som i
// 2D-scenen: en meter i höjd är lika många pixlar i båda. Spelets mark (0 m) är
// dalbottnen där. Allt på en viss höjd ligger på helikopterns linje när helikoptern är
// på den höjden, hur långt bort det än är – därför passerar fjälltopparna helikoptern
// precis när milstolpen nås. Saknas WebGL2 ritar render.js det enklare landskapet själv.
//
// Så ritas en bild, för att hinna med 60 bilder/s i full upplösning:
// 1. Höjdrutnätet: terrängens höjd, lutning och skugga i ett rutnät som sitter fast i
//    världen – rader på fasta avstånd framåt (tätare nära) och kolumner med en bredd som
//    växer med avståndet, så att varje kolumn är ungefär två pixlar bred i bild. Bara
//    rutor som är nya sedan förra bilden räknas (kameran har flyttat sig i sidled, en
//    topp har flyttat sig eller solen har gått ned); resten finns kvar i texturen.
// 2. Rutnätet ritas som trianglar med djupbuffert till en G-buffert: avstånd, lutning,
//    skugga och om det är vatten. Sjön speglar en andra, upp-och-nedvänd ritning.
// 3. Stackmolnen strålföljs i halv upplösning fram till terrängen.
// 4. En sista bildpunktsshader färgar terrängen, vattnet och himlen, lägger på dis och
//    moln och tonar bilden. Den räknar bara en gång per bildpunkt.

/** Helikopterns plan: så här långt framför kameran (m). */
export const PLANE_M = 400;
/** Högst så här många milstolpstoppar i landskapet samtidigt. */
export const MAX_PEAKS = 12;
const NOISE_SIZE = 64; // 3D-brustexturen för molnen
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const WATER_M = -1; // sjöns yta, som i shadern
// Höjdrutnätet: rader från z0 till zFar (m), varje rad rowStep gånger längre bort än
// den förra; kolumnerna är px CSS-pixlar breda i bild (utan utzoomning).
// Små bilder (snapshots) med kortare brännvidd får glesare rader: lika tätt i bild som
// huvudbilden vid brännvidden rowFocal (CSS-px), men aldrig glesare än maxRowScale gånger.
const GRID = { z0: 250, zFar: 82000, rowStep: 1.004, margin: 64, zoomRoom: 1.4, rowFocal: 1150, maxRowScale: 2.5 };
const MAX_DIRTY = MAX_PEAKS * 2; // rutor som räknas om när topparna flyttar sig
const PEAK_SNAP_PX = 0.5; // så här långt (CSS-px i bild) får en topp glida innan rutnätet räknas om
/** Kvalitet: kolumnbredd i rutnätet (CSS-px) och antal steg genom molnen. */
export const QUALITY = {
  high: { px: 2, cloudSteps: 110 },
  low: { px: 3, cloudSteps: 64 },
};

const VERTEX = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Rutnätet: delas av alla shaders, så att de räknar fram samma kolumner.
const GRID_GLSL = `
uniform vec3 uCam;      // kamerans läge (m)
uniform float uRowZ0;   // första radens avstånd (m)
uniform float uRowLog;  // ln(kvoten mellan två raders avstånd)
uniform float uColK;    // kolumnens bredd i världen per meter avstånd
uniform float uA;       // fönstrets vänsterkant, i kolumner till vänster om kameran
uniform float uPrevCamX;
uniform float uPrevA;
uniform int uNC;        // kolumner i texturen
uniform int uNR;        // rader
const float WATER = ${WATER_M.toFixed(1)};

float rowZ(float j) { return uRowZ0 * exp(j * uRowLog); }
// Första kolumnen (världsindex) i fönstret för raden på avståndet z
float rowStart(float z, float camX, float a) { return floor(camX / (uColK * z) - a); }
// Texturkolumnen för världskolumnen n (ringbuffert)
int texCol(float n) { return int(n + float(uNC) * 8192.0) % uNC; }
// Världskolumnen som texturkolumnen c håller när fönstret börjar vid n0
float colAt(int c, float n0) { return n0 + float((c - texCol(n0) + uNC) % uNC); }
`;

// Brus, terräng, ljus, himmel, dis och moln: delas av bildpunktsshaderna.
const COMMON = `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
uniform vec2 uRes;      // målets storlek i pixlar
uniform float uScale;   // målets pixlar per CSS-pixel
uniform vec2 uCenter;   // optiska mitten i CSS-pixlar (y uppifrån)
uniform float uFocal;   // brännvidd i CSS-pixlar
uniform float uTime;    // s, för molnens drift och vågorna
uniform float uDusk;    // 0 dag, 1 kvällssol
uniform float uThin;    // 0–1, tunn luft högt upp: mörkare himmel och stjärnor
uniform float uTop;     // högsta terrängen (m), strålar över den träffar inget
uniform vec4 uPeaks[${MAX_PEAKS}];  // milstolparnas toppar: x, z, höjd, radie (höjd 0 = tom)
uniform vec4 uPeakBox;  // rutan (x0, z0, x1, z1) som alla toppar ryms i
uniform vec3 uPad;      // helikopterplattan: x, z, radie (0 = ingen)
uniform vec3 uLight;    // solljusets riktning över terrängen
uniform vec3 uSunDir;   // solen på himlen, se sunDir()
uniform float uClouds;  // 0 = klart, 1 = vanligt med stackmoln
uniform int uPeakCount; // antal toppar i uPeaks
uniform int uCloudSteps;
uniform sampler3D uNoise;
${GRID_GLSL}
#define PLANE ${PLANE_M.toFixed(1)}
#define NOISE_SIZE ${NOISE_SIZE.toFixed(1)}
const float CLOUD_BASE = 850.0;    // stackmolnens bas
const float CLOUD_TOP = 1550.0;    // och de högsta topparna
const float CLOUD_NEAR = 1300.0;   // inga moln närmare kameran än så här (z), så att man ser
const mat2 M2 = mat2(0.8, -0.6, 0.6, 0.8);

// --- Brus -----------------------------------------------------------------------------

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Värdebrus 0..1
float vnoise(vec2 x) {
  vec2 p = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(p);
  float b = hash12(p + vec2(1.0, 0.0));
  float c = hash12(p + vec2(0.0, 1.0));
  float d = hash12(p + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p, int oct) {
  float f = 0.0, a = 0.5;
  for (int i = 0; i < oct; i++) {
    f += a * vnoise(p);
    p = M2 * p * 2.03;
    a *= 0.5;
  }
  return f;
}

// Gradientbrus med derivator (Quilez): värdet ungefär -0,7..0,7 och lutningen
vec3 gnoised(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = hash22(i) * 2.0 - 1.0;
  vec2 gb = hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0;
  vec2 gc = hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0;
  vec2 gd = hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0;
  float va = dot(ga, f);
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));
  float k = va - vb - vc + vd;
  return vec3(
    va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k,
    ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * k + vec2(vb, vc) - va)
  );
}

// 3D-brus 0..1 ur texturen, mjukt interpolerat
float noise3(vec3 x) {
  vec3 p = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return textureLod(uNoise, (p + f + 0.5) / NOISE_SIZE, 0.0).r;
}

float smax(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return max(a, b) + h * h * k * 0.25;
}

// --- Terrängen ---------------------------------------------------------------------

// Eroderat brus (Quilez): där det redan lutar brant dämpas de finare oktaverna, så att
// det blir raviner, skarpa åsar och jämnare dalbottnar.
float eroded(vec2 p, int oct) {
  float a = 0.0, b = 0.5;
  vec2 d = vec2(0.0);
  for (int i = 0; i < oct; i++) {
    vec3 n = gnoised(p);
    d += n.yz;
    a += b * n.x / (1.0 + dot(d, d));
    b *= 0.5;
    p = M2 * p * 2.0;
  }
  return a;
}

// Sjöns strand (z) och om dalen har sjö här (0–1). Alltid sjö vid startplatsen.
float shoreZ(float x) {
  return PLANE + 980.0 + 420.0 * (vnoise(vec2(x * 0.0005, 1.7)) - 0.5) + 150.0 * (vnoise(vec2(x * 0.0031, 4.1)) - 0.5);
}

float lakeHere(float x) {
  return max(smoothstep(0.3, 0.42, vnoise(vec2(x * 0.00022, 7.3))), 1.0 - smoothstep(1800.0, 3200.0, abs(x)));
}

// Skogens täthet 0–1: sammanhängande med gläntor, under trädgränsen och inte nära plattan
float forestAt(vec2 p, float h) {
  float n = vnoise(p * 0.0017) * 0.55 + vnoise(p * 0.0071) * 0.3 + vnoise(p * 0.031) * 0.15;
  return smoothstep(0.3, 0.42, n) * (1.0 - smoothstep(420.0, 640.0, h + 90.0 * (n - 0.5))) * smoothstep(PLANE + 160.0, PLANE + 320.0, p.y);
}

// Milstolparnas toppar: en spetsig topp med eroderade sluttningar, åsar, raviner och
// förberg nedtill, som fjällen omkring. Detaljerna krymper mot toppen, så att den
// ligger exakt på rätt höjd i mitten och etiketten hamnar rätt.
float peakAt(vec2 p, vec4 k, int oct) {
  vec2 d = p - k.xy;
  float r = length(d) / k.w;
  if (r >= 1.0) return -1e4;
  float seed = fract(k.z * 0.01373) * 40.0;
  vec2 u = d / k.w;
  // Åsar åt några håll: radien varierar mjukt runt toppen
  vec2 dir = u / max(r, 1e-4);
  float lobes = vnoise(dir * 1.3 + seed) * 0.65 + vnoise(dir * 3.1 - seed) * 0.35;
  float s = r * (0.72 + 0.62 * lobes);
  float cone = pow(max(1.0 - s, 0.0), 1.45);
  // Bitoppar på åsarna, lägre än huvudtoppen: ett massiv med flera spetsar i stället för en ensam kon
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ang = seed * 1.7 + fi * 2.25 + 0.7 * sin(seed * 3.1 + fi);
    vec2 c = vec2(cos(ang), sin(ang)) * (0.34 + 0.16 * fract(seed * 0.37 + fi * 0.61));
    float hs = 0.58 + 0.2 * fract(seed * 0.71 + fi * 0.37);
    cone = smax(cone, hs * pow(max(1.0 - length(u - c) / 0.42, 0.0), 1.35), 0.06);
  }
  float e = clamp(eroded(u * 3.2 + seed, oct) * 2.4, -1.0, 1.0);
  float w = 1.0 - smoothstep(0.7, 1.0, r);
  // Upphöjningar växer nedåt, raviner skärs ut ända upp mot toppen
  float lift = (1.0 - cone) * max(e, 0.0) * 0.75;
  float carve = pow(1.0 - cone, 0.6) * max(-e, 0.0) * 0.55;
  return k.z * (cone + (lift - carve) * w);
}

// Höjden (m) i punkten p = (x, z): platt dalbotten i helikopterns plan, sjön bakom,
// skogsklädda kullar och sedan fjällen. oct = detaljnivå.
float heightAt(vec2 p, int oct) {
  float z = p.y;
  float shore = shoreZ(p.x);
  float e = eroded(p * (1.0 / 3000.0) + vec2(13.1, 7.7), oct);
  // Fjällen samlas i massiv med breda, skogiga dalar emellan. Massivens höjd varierar, så att
  // topparna inte blir lika höga kloner: kärnan når 1 700–2 300 m, kanterna är låga kullar.
  float mass = vnoise(p * (1.0 / 15000.0) + vec2(3.1, 8.2)) * 0.68 + vnoise(p * (1.0 / 5200.0) + vec2(1.7, 4.4)) * 0.32;
  mass = 0.45 + 0.55 * smoothstep(0.2, 0.7, mass);
  float a = clamp(0.48 + 1.15 * e, 0.0, 1.35);
  // Längre bort lite högre, så att de bortre kedjorna når upp mot horisonten bakom de närmare
  float ramp = smoothstep(PLANE + 2800.0, PLANE + 7000.0, z) * (1.0 + 0.2 * smoothstep(12000.0, 35000.0, z));
  float mtn = ramp * (220.0 + mass * (560.0 + 1150.0 * a * a));
  // Skogsklädda kullar bakom sjön
  float hills = smoothstep(shore - 160.0, shore + 2200.0, z) * (60.0 + 560.0 * clamp(0.5 + 1.1 * e, 0.0, 1.15));
  // Åsar och raviner i kullarna längre bort, så att de har relief när man ser dem från höjden
  float rid = eroded(p * (1.0 / 1100.0) + vec2(5.3, 2.9), min(oct, 7));
  hills += smoothstep(shore + 300.0, shore + 2400.0, z) * 300.0 * clamp(rid + 0.35, 0.0, 1.0);
  float h = max(hills, mtn);
  // Dalbotten: helt platt närmast planet, små ojämnheter längre bort, sjön bakom plattan
  float rough = (2.0 + 6.0 * vnoise(p * 0.005)) * smoothstep(40.0, 260.0, abs(z - PLANE));
  float lake = lakeHere(p.x) * smoothstep(PLANE + 70.0, PLANE + 140.0, z) * (1.0 - smoothstep(shore - 110.0, shore - 10.0, z));
  h = mix(max(h, rough), -7.0, lake);
  // Tjärnar på flacka partier i dalen
  float tarn = smoothstep(0.64, 0.72, vnoise(p * 0.0011 + 3.7)) * (1.0 - smoothstep(12.0, 40.0, h)) * smoothstep(PLANE + 300.0, PLANE + 800.0, z);
  h = mix(h, -6.0, tarn);
  float wet = max(lake, tarn);
  // Trädkronorna ger skogen struktur på nära håll
  if (oct > 9) h += forestAt(p, h) * (11.0 + 9.0 * vnoise(p * 0.15)) * (1.0 - wet) * smoothstep(9.5, 11.5, float(oct));
  if (p.x > uPeakBox.x && p.x < uPeakBox.z && p.y > uPeakBox.y && p.y < uPeakBox.w) {
    for (int i = 0; i < uPeakCount; i++) {
      h = smax(h, peakAt(p, uPeaks[i], oct - 1), 60.0);
    }
  }
  return h;
}

// Detaljnivån efter avståndet
int octFor(float t) {
  return t < 1500.0 ? 10 : t < 5000.0 ? 8 : t < 14000.0 ? 7 : 6;
}

// --- Ljus och himmel -------------------------------------------------------------------

// Strålen genom bildpunkten frag (CSS-pixlar, y uppifrån)
vec3 rayDir(vec2 frag) {
  return normalize(vec3((frag.x - uCenter.x) / uFocal, (uCenter.y - frag.y) / uFocal, 1.0));
}

vec2 cssFrag() {
  return vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
}

// Solen på himlen: dagsolen står till höger bakom kameran. Kvällssolen står lågt och syns på
// samma ställe i bild på varje skärm, oavsett var helikoptern är. Terrängen belyses
// från uLight, en fast riktning nära solens, så att skuggorna kan sparas.
// Räknas ut en gång per bild i JavaScript (sunDir i terrain.js).
vec3 sunDir() {
  return uSunDir;
}

vec3 sunColor() {
  return mix(vec3(1.0, 0.94, 0.85) * 3.6, vec3(1.0, 0.64, 0.34) * 5.2, uDusk);
}

// Himlen utan moln: djupblå zenit och ljus horisont på dagen, på kvällen glöd mot solen
// och rosa-lila åt andra hållet. Högt upp mörknar den.
vec3 skyBase(vec3 rd) {
  vec3 sun = sunDir();
  float y = max(rd.y, 0.0);
  float s = max(dot(rd, sun), 0.0);
  vec3 zen = mix(vec3(0.07, 0.22, 0.6), vec3(0.004, 0.012, 0.05), uThin);
  vec3 hor = mix(vec3(0.5, 0.67, 0.9), vec3(0.32, 0.44, 0.7), uThin);
  vec3 day = mix(hor, zen, pow(y, mix(0.27, 0.24, uThin)));
  day += vec3(1.0, 0.85, 0.6) * (0.18 * pow(s, 6.0) + 0.35 * pow(s, 64.0));
  float toward = 0.5 + 0.5 * dot(normalize(rd.xz + 1e-5), normalize(sun.xz));
  vec3 horK = mix(vec3(0.66, 0.46, 0.46), vec3(1.3, 0.62, 0.26), pow(toward, 2.0));
  vec3 midK = mix(vec3(0.28, 0.3, 0.48), vec3(0.85, 0.5, 0.36), pow(toward, 3.0));
  vec3 dusk = mix(horK, midK, smoothstep(0.0, 0.1, y));
  dusk = mix(dusk, vec3(0.08, 0.15, 0.34), smoothstep(0.06, 0.42, y));
  dusk += vec3(1.0, 0.5, 0.18) * (0.35 * pow(s, 8.0) + 0.9 * pow(s, 120.0));
  return mix(day, dusk, uDusk);
}

// Solskivan: rund i bild även långt från bildens mitt, där perspektivet annars drar ut den
float sunDisc(vec3 rd) {
  vec3 sun = sunDir();
  if (sun.z <= 0.05 || rd.z <= 0.0) return 0.0;
  vec2 sp = sun.xy / sun.z;
  vec2 rp = rd.xy / rd.z;
  float d = length(rp - sp) * uFocal; // CSS-pixlar
  float r = 0.017 * uFocal; // större än i verkligheten, som i ett foto med tele
  return smoothstep(r + 1.5, r - 1.5, d) + 0.3 * exp(-max(d - r, 0.0) / (r * 0.8));
}

// En bank stackmoln som en skiva på avståndet dist (m) med basen på höjden base (m)
vec3 cloudBank(vec3 col, vec3 rd, float dist, float base, float seed, float w) {
  float X = uCam.x + rd.x / rd.z * dist;
  // Höjd över molnbasen, som varierar lite längs banken så att undersidan inte blir en linjal
  float H = uCam.y + rd.y / rd.z * dist - base - 450.0 * vnoise(vec2(X / 2600.0, seed + 2.0));
  float hn = H / 1500.0;
  if (hn < 0.0 || hn > 1.0) return col;
  float cov = smoothstep(0.3, 0.7, vnoise(vec2(X / 7000.0, seed)));
  vec2 q = vec2(X, H * 1.5) / 1100.0 + seed * 3.7 + vec2(uTime * 0.01, 0.0);
  float f = fbm(q, 5);
  float d = f + 0.5 * cov - 0.62 - 0.55 * hn;
  float a = smoothstep(0.0, 0.07, d) * smoothstep(0.0, 0.2, hn);
  if (a <= 0.0) return col;
  // Belyst ovanpå och mot solen, grå undersida; långt bort tonar molnen mot horisontens dis
  float lit = clamp(0.35 + 1.1 * hn + 1.6 * (f - 0.5), 0.0, 1.0);
  vec3 cc = mix(vec3(0.6, 0.66, 0.77), vec3(1.1, 1.08, 1.04), lit);
  cc = mix(cc, skyBase(vec3(rd.x, 0.01, rd.z)), 0.15 + 0.3 * smoothstep(15000.0, 35000.0, dist));
  return mix(col, cc, a * w);
}

// Himlen med solskivan, slöjmoln högt upp och stjärnor i tunn luft
vec3 skyColor(vec3 rd) {
  vec3 sun = sunDir();
  vec3 col = skyBase(rd);
  float s = max(dot(rd, sun), 0.0);
  col += sunColor() * 0.4 * sunDisc(rd);
  if (rd.y > 0.0) {
    // Slöjmoln på 9 km: strimmiga, belysta underifrån på kvällen
    float t = (9500.0 - uCam.y) / rd.y;
    vec2 q = (uCam.xz + rd.xz * t) * 0.00011 + vec2(uTime * 0.0006, 0.0);
    float c = fbm(q * vec2(1.0, 3.2), 5);
    c = smoothstep(0.5 - 0.1 * uDusk, 0.8, c) * smoothstep(0.0, 0.15, rd.y);
    vec3 lit = mix(vec3(1.0, 0.99, 0.97) * 1.1, mix(vec3(0.7, 0.45, 0.6), vec3(1.6, 0.75, 0.38), pow(s, 2.0)), uDusk);
    col = mix(col, lit * (1.0 - 0.6 * uThin), c * mix(0.4, 0.65, uDusk));
    // Vädermoln långt bort: två bankar stackmoln som skivor 16 och 30 km bort, så att de får
    // bulliga toppar och platta, grå undersidor över horisonten. Bara på dagen.
    float cw = 1.0 - uDusk;
    if (cw > 0.0) {
      col = cloudBank(col, rd, 30000.0, 2900.0, 7.3, cw);
      col = cloudBank(col, rd, 16000.0, 2500.0, 1.1, cw);
    }
    // Stjärnor
    if (uThin > 0.45) {
      vec2 sp = rd.xy / (rd.z + 1.2) * 700.0;
      float st = step(0.996, hash12(floor(sp))) * hash12(floor(sp) + 3.1);
      col += vec3(st) * smoothstep(0.6, 1.0, uThin) * smoothstep(0.1, 0.4, rd.y) * 0.8;
    }
  }
  return col;
}

// Dis: tätare nära marken (Quilez exponentiella dimma). Nära blåaktig, långt bort
// samma färg som horisonten, ljusare mot solen.
vec3 applyFog(vec3 col, vec3 ro, vec3 rd, float t) {
  const float a = 1.0 / 21000.0;
  const float b = 1.0 / 1900.0;
  float k = abs(rd.y) > 1e-4 ? (1.0 - exp(-t * rd.y * b)) / (rd.y * b) : t;
  float tau = a * exp(-ro.y * b) * k;
  // Luftperspektiv på dagen även högt upp: kedja efter kedja tonar mot blått dis med avståndet
  // Nära klart, sedan allt tätare: de närmaste åsarna har full kontrast, de bortre bleknar bort
  float ft = t * (1.0 / 24000.0);
  tau += (t * (1.0 / 50000.0) + ft * ft) * (1.0 - 0.7 * uDusk);
  // Ett tätare dislager nere i dalen, som syns först när man ser ned på det från höjden:
  // dalen långt under helikoptern blir blåaktig och platt i färgen, som i ett flygfoto.
  const float a2 = 1.0 / 5000.0;
  const float b2 = 1.0 / 700.0;
  float k2 = abs(rd.y) > 1e-4 ? (1.0 - exp(-t * rd.y * b2)) / (rd.y * b2) : t;
  float low = 1.0 - exp(-a2 * exp(-ro.y * b2) * k2 * smoothstep(400.0, 1600.0, ro.y));
  // Dalens dis är djupare blått än luften högre upp, och ligger närmast marken: läggs på först
  col = mix(col, mix(vec3(0.075, 0.13, 0.22), vec3(0.16, 0.14, 0.2), uDusk), low);
  float amount = 1.0 - exp(-tau);
  vec3 sun = sunDir();
  vec3 hor = skyBase(vec3(rd.x, 0.015, rd.z));
  vec3 near = mix(vec3(0.2, 0.3, 0.45), vec3(0.3, 0.32, 0.44), uDusk);
  // Långt bort ljust gråblått som fjärran fjäll, inte vitt: kedjorna bakom varandra tonar bort i diset
  hor = mix(hor, mix(vec3(0.4, 0.5, 0.64), hor, uDusk), 0.55);
  vec3 fogCol = mix(near, hor, smoothstep(0.0, 0.7, amount));
  fogCol += mix(vec3(0.3, 0.25, 0.15), vec3(0.7, 0.3, 0.08), uDusk) * pow(max(dot(rd, sun), 0.0), 8.0) * amount;
  return mix(col, fogCol, amount);
}

// --- Moln ------------------------------------------------------------------------------

// Hur mycket stackmoln det finns här ovanifrån sett (0–1): enskilda moln med luckor emellan
float cloudCover(vec2 xz) {
  vec2 c = (xz + vec2(uTime * 5.0, uTime * 1.5)) * 0.00045;
  float m = noise3(vec3(c.x, 0.37, c.y)) * 0.6 + noise3(vec3(c.x * 2.6, 1.63, c.y * 2.6)) * 0.4;
  // Glesare på kvällen, så att solnedgången syns
  return smoothstep(0.5 + 0.22 * uDusk, 0.86 + 0.04 * uDusk, m) * uClouds;
}

// Stackmolnens täthet: platt bas och bulliga toppar, högre där molnet är kraftigt
float cloudMap(vec3 p, int oct, float sharp) {
  float y = p.y - CLOUD_BASE;
  if (y <= 0.0 || y >= CLOUD_TOP - CLOUD_BASE) return 0.0;
  float m = cloudCover(p.xz) * smoothstep(CLOUD_NEAR, CLOUD_NEAR + 2500.0, p.z);
  float hn = y / (CLOUD_TOP - CLOUD_BASE);
  // Bruset nedan ger högst +0,5: där räcker det inte till något moln
  float base = m * 1.35 - 0.2 - 1.15 * hn - 0.95 * 0.47;
  if (base + 0.95 * 0.93 * 1.08 <= 0.0) return 0.0;
  vec3 q = (p + vec3(uTime * 5.0, 0.0, uTime * 1.5)) * 0.0026;
  float f = 0.5 * noise3(q);
  q = q * 2.03 + 0.31;
  f += 0.28 * noise3(q);
  q = q * 2.01 + 0.17;
  f += 0.16 * noise3(q);
  if (oct > 3) {
    q = q * 2.02 + 0.41;
    f += 0.09 * noise3(q);
  }
  if (oct > 4) {
    q = q * 2.03 + 0.23;
    f += 0.05 * noise3(q);
  }
  f *= 0.93;
  // Molnets topp där bruset tar slut: bulligt uppåt och åt sidorna, plant nedtill
  float d = base + 0.95 * f;
  d *= smoothstep(0.0, 0.12, hn - 0.06 * (1.0 - m));
  return clamp(d * sharp, 0.0, 1.0);
}

// Molnens skugga på marken: tätheten där solens stråle går genom molnlagret
float cloudShadow(vec3 pos) {
  vec3 c = pos + uLight * ((CLOUD_BASE + 450.0 - pos.y) / max(uLight.y, 0.05));
  return 1.0 - 0.7 * smoothstep(0.0, 0.25, cloudMap(c, 3, 4.0));
}

// Stackmolnen längs strålen fram till tmax, förmultiplicerad färg
vec4 clouds(vec3 ro, vec3 rd, float tmax, int steps, float dither) {
  float t0, t1;
  if (abs(rd.y) < 1e-4) {
    if (ro.y < CLOUD_BASE || ro.y > CLOUD_TOP) return vec4(0.0);
    t0 = 0.0;
    t1 = 45000.0;
  } else {
    float tb = (CLOUD_BASE - ro.y) / rd.y;
    float tt = (CLOUD_TOP - ro.y) / rd.y;
    t0 = max(min(tb, tt), 0.0);
    t1 = max(tb, tt);
  }
  if (rd.z > 0.0) t0 = max(t0, (CLOUD_NEAR - ro.z) / rd.z);
  t1 = min(min(t1, tmax), 45000.0);
  if (t1 <= t0) return vec4(0.0);
  vec3 sun = sunDir();
  vec3 sunCol = sunColor();
  vec3 amb = mix(vec3(0.5, 0.6, 0.78), vec3(0.34, 0.34, 0.48), uDusk) * (1.0 - 0.3 * uThin);
  vec4 sum = vec4(0.0);
  float tFog = 0.0; // avståndet till molnen, vägt efter hur mycket de syns
  float t = t0;
  float dt = max(30.0, 0.013 * t0);
  t += dt * dither;
  bool fine = false;
  for (int i = 0; i < steps; i++) {
    if (t > t1 || sum.a > 0.97) break;
    vec3 p = ro + rd * t;
    dt = max(30.0, 0.013 * t) * (fine ? 0.3 : 1.0);
    float sharp = mix(9.0, 3.5, smoothstep(2000.0, 20000.0, t));
    float den = cloudMap(p, t < 12000.0 ? 5 : 4, sharp);
    if (den > 0.005) {
      // Första träffen: ett steg tillbaka och sedan kortare steg, så att kanten blir skarp
      if (!fine) {
        fine = true;
        t = max(t0, t - dt * 0.9);
        continue;
      }
      // Ljuset: hur mycket tunnare molnet är en bit mot solen (Quilez)
      float dif = clamp((den - cloudMap(p + sun * 160.0, 3, sharp)) * 1.3 + 0.08, 0.0, 1.0);
      float y = clamp((p.y - CLOUD_BASE) / 900.0, 0.0, 1.0);
      vec3 lin = amb * (0.3 + 0.8 * y) + sunCol * dif * 0.8;
      vec3 c = mix(vec3(1.0), vec3(0.82, 0.84, 0.88), den) * lin;
      float alpha = 1.0 - exp(-den * dt * 0.045);
      float w = alpha * (1.0 - sum.a);
      sum += vec4(c, 1.0) * w;
      tFog += t * w;
    }
    t += dt;
  }
  // Molnen långt bort försvinner i diset: en gång, på molnens vägda avstånd
  if (sum.a > 0.0) sum.rgb = applyFog(sum.rgb / sum.a, ro, rd, tFog / sum.a) * sum.a;
  return sum;
}
`;

// 1a. Höjdrutnätet: höjd och lutning för rutor som är nya sedan förra bilden.
const CACHE_FS = `#version 300 es
${COMMON}
uniform int uValid;     // 0 = räkna om allt
uniform vec4 uDirty[${MAX_DIRTY}];  // rutor (x0, z0, x1, z1) där en topp har flyttat sig
uniform int uDirtyCount;
out vec4 outColor;

bool dirty(vec2 p) {
  for (int i = 0; i < uDirtyCount; i++) {
    vec4 b = uDirty[i];
    if (p.x > b.x && p.x < b.z && p.y > b.y && p.y < b.w) return true;
  }
  return false;
}

void main() {
  int c = int(gl_FragCoord.x);
  int j = int(gl_FragCoord.y);
  float z = rowZ(float(j));
  float n = colAt(c, rowStart(z, uCam.x, uA));
  vec2 p = vec2(n * uColK * z, z);
  if (uValid == 1 && n == colAt(c, rowStart(z, uPrevCamX, uPrevA)) && !dirty(p)) discard;
  int oct = octFor(z);
  float h = heightAt(p, oct);
  // Lutningen med finare detaljer än höjden, som ljuset sedan visar
  float e = max(0.6, 0.0015 * z);
  float h0 = heightAt(p, oct + 2);
  float hx = heightAt(p + vec2(e, 0.0), oct + 2);
  float hz = heightAt(p + vec2(0.0, e), oct + 2);
  outColor = vec4(h, (hx - h0) / e, (hz - h0) / e, 0.0);
}`;

// 1b. Skuggorna i rutnätet: strålen mot solen följs genom höjderna i rutnätet.
const SHADOW_FS = `#version 300 es
${COMMON}
uniform int uValid;
uniform vec4 uDirty[${MAX_DIRTY}];
uniform int uDirtyCount;
uniform sampler2D uCache;
out vec4 outColor;

bool dirty(vec2 p) {
  for (int i = 0; i < uDirtyCount; i++) {
    vec4 b = uDirty[i];
    if (p.x > b.x && p.x < b.z && p.y > b.y && p.y < b.w) return true;
  }
  return false;
}

// Höjden ur rutnätet, eller uträknad där rutnätet inte når
float gridHeight(vec2 q) {
  float jf = floor(log(max(q.y, 1.0) / uRowZ0) / uRowLog + 0.5);
  if (q.y < uRowZ0 || jf >= float(uNR)) return heightAt(q, 4);
  float z = rowZ(jf);
  float n = floor(q.x / (uColK * z) + 0.5);
  float n0 = rowStart(z, uCam.x, uA);
  if (n < n0 || n >= n0 + float(uNC)) return heightAt(q, 4);
  return texelFetch(uCache, ivec2(texCol(n), int(jf)), 0).x;
}

void main() {
  int c = int(gl_FragCoord.x);
  int j = int(gl_FragCoord.y);
  float z = rowZ(float(j));
  float n = colAt(c, rowStart(z, uCam.x, uA));
  vec2 p = vec2(n * uColK * z, z);
  if (uValid == 1 && n == colAt(c, rowStart(z, uPrevCamX, uPrevA)) && !dirty(p)) discard;
  vec4 g = texelFetch(uCache, ivec2(c, j), 0);
  vec3 nor = normalize(vec3(-g.y, 1.0, -g.z));
  float res = 1.0;
  if (dot(nor, uLight) > 0.001) {
    vec3 ro = vec3(p.x, max(g.x, WATER), z) + nor * 2.0;
    float t = 6.0;
    for (int i = 0; i < 40; i++) {
      vec3 q = ro + uLight * t;
      if (q.y > uTop) break;
      float h = q.y - gridHeight(q.xz);
      res = min(res, 10.0 * h / t);
      if (res < 0.004) break;
      t += clamp(h, 8.0 + 0.03 * t, 800.0);
    }
  }
  outColor = vec4(smoothstep(0.0, 1.0, clamp(res, 0.0, 1.0)), 0.0, 0.0, 1.0);
}`;

// 2. Rutnätet som trianglar: en remsa per rad, kolumnerna i fönstret.
const MESH_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${GRID_GLSL}
uniform sampler2D uCache;
uniform sampler2D uShadow;
uniform vec2 uSize;     // målets storlek i CSS-pixlar
uniform vec2 uCenter;
uniform float uFocal;
uniform int uRow0;      // första raden som ritas
uniform int uStride;    // varannan rad och kolumn för spegelbilden
uniform float uMirror;  // 1 = upp och ned i vattenytan
out float vZ;
out vec2 vGrad;
out float vShadow;
out float vWater;

void main() {
  int i = (gl_VertexID >> 1) * uStride;
  int j = min(uRow0 + (gl_InstanceID + (gl_VertexID & 1)) * uStride, uNR - 1);
  float z = rowZ(float(j));
  float n = rowStart(z, uCam.x, uA) + float(i);
  ivec2 tc = ivec2(texCol(n), j);
  vec4 g = texelFetch(uCache, tc, 0);
  float h = max(g.x, WATER);
  float y = mix(h, 2.0 * WATER - h, uMirror);
  float x = n * uColK * z;
  vec2 s = vec2(uCenter.x + (x - uCam.x) * uFocal / z, uCenter.y - (y - uCam.y) * uFocal / z);
  vec2 ndc = vec2(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0);
  const float NEAR = 100.0;
  const float FAR = 100000.0;
  gl_Position = vec4(ndc * z, (z * (FAR + NEAR) - 2.0 * FAR * NEAR) / (FAR - NEAR), z);
  vZ = z;
  vGrad = g.yz;
  vShadow = texelFetch(uShadow, tc, 0).x;
  vWater = g.x < WATER ? 1.0 : 0.0;
}`;

// mirror: spegelbilden. Bara den har discard, som annars stänger av det tidiga djuptestet
// (då färgas även allt som skyms av närmare rader).
const meshFS = (mirror) => `#version 300 es
precision highp float;
in float vZ;
in vec2 vGrad;
in float vShadow;
in float vWater;
out vec4 outColor;
void main() {
  ${mirror ? '// I spegelbilden ligger vattenytan kvar där den är och skulle dölja det som speglas\n  if (vWater > 0.5) discard;' : ''}
  outColor = vec4(vZ, vGrad, vShadow + 2.0 * step(0.5, vWater));
}`;

// 3. Stackmolnen i halv upplösning, fram till terrängen i G-bufferten.
const CLOUDS_FS = `#version 300 es
${COMMON}
uniform sampler2D uG;
uniform float uGRatio;  // G-buffertens pixlar per pixel här
out vec4 outColor;
void main() {
  vec3 rd = rayDir(cssFrag());
  float gz = texelFetch(uG, ivec2(gl_FragCoord.xy * uGRatio), 0).x;
  float tmax = gz > 0.0 ? gz / rd.z : 1e5;
  // Gitter mot bandning i molnen (interleaved gradient noise, jämnare än vitt brus)
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  outColor = clouds(uCam, rd, tmax, uCloudSteps, ign);
}`;

// 4. Färgerna: terrängen, vattnet och himlen, dis, moln och toning.
const FINAL_FS = `#version 300 es
${COMMON}
uniform sampler2D uG;
uniform sampler2D uReflG;   // spegelbilden, eller ingen (uReflScale 0)
uniform float uReflScale;   // spegelbildens pixlar per CSS-pixel
uniform sampler2D uCloudTex;
uniform float uHasClouds;
out vec4 outColor;

// Helikopterplattan: asfalt, gul streckad ring och ett H
vec3 padColor(vec2 p, vec3 base) {
  if (uPad.z <= 0.0) return base;
  vec2 d = p - uPad.xy;
  float r = length(d);
  if (r > uPad.z + 4.0) return base;
  vec3 col = vec3(0.075, 0.08, 0.085);
  vec3 paint = vec3(0.9, 0.66, 0.06);
  float ring = smoothstep(1.4, 0.4, abs(r - uPad.z * 0.8));
  float dash = step(0.0, sin(atan(d.y, d.x) * 20.0));
  col = mix(col, paint, ring * dash);
  vec2 q = d / (uPad.z * 0.32);
  float bars = step(abs(abs(q.x) - 0.9), 0.14) * step(abs(q.y), 1.0);
  float mid = step(abs(q.x), 0.9) * step(abs(q.y), 0.13);
  col = mix(col, vec3(0.95), max(bars, mid));
  // Grus runt kanten
  return mix(col, base, smoothstep(uPad.z, uPad.z + 4.0, r));
}

vec3 terrainShade(vec3 pos, vec3 nor, vec3 rd, float sha) {
  vec3 sun = uLight;
  vec2 p = pos.xz;
  float h = pos.y;
  // Brusets koordinater följer också höjden, så att mönstret inte dras ut på branta väggar mot kameran
  vec2 pn = vec2(p.x, p.y + 1.3 * h);
  float n1 = fbm(pn * 0.0016, 3);
  float n2 = vnoise(pn * 0.021);
  float n3 = vnoise(pn * 0.19);
  // Fina sprickor och revben i berget, bara på nära håll (längre bort skulle de flimra)
  float near = 1.0 - smoothstep(2500.0, 9000.0, length(pos - uCam));
  if (near > 0.0) {
    vec3 b = gnoised(pn * 0.03) + 0.5 * gnoised(pn * 0.09 + 3.1);
    nor = normalize(nor + vec3(b.y, 0.0, b.z) * 0.45 * near * smoothstep(0.95, 0.6, nor.y));
  }
  float slope = nor.y;
  float flat_ = smoothstep(0.62, 0.86, slope + 0.08 * (n2 - 0.5));

  // Sten: grå med bruna stråk och mörkare ränder
  vec3 rock = mix(vec3(0.075, 0.078, 0.085), vec3(0.17, 0.165, 0.16), n2);
  rock = mix(rock, vec3(0.26, 0.21, 0.16), smoothstep(0.55, 0.8, n1) * 0.6);
  rock *= 0.85 + 0.3 * vnoise(vec2(p.x * 0.01, h * 0.035) + n2);
  // Ängar i dalen, fjällhed ovanför trädgränsen, myr på flacka partier
  // Dämpade, gråaktiga gröna: från ovan ska dalen se ut som i ett flygfoto, inte som en gräsmatta
  vec3 meadow = mix(vec3(0.058, 0.07, 0.046), vec3(0.092, 0.098, 0.066), n2);
  meadow = mix(meadow, vec3(0.05, 0.065, 0.045), smoothstep(0.5, 0.8, vnoise(p * 0.11)) * 0.3);
  // Myrar: gulbruna på flacka partier i dalen
  meadow = mix(meadow, vec3(0.12, 0.105, 0.068), smoothstep(0.55, 0.7, vnoise(p * 0.004 + 9.1)) * 0.6);
  vec3 heath = mix(vec3(0.19, 0.17, 0.1), vec3(0.27, 0.24, 0.14), n2);
  float alpine = smoothstep(420.0, 850.0, h + 180.0 * (n1 - 0.5));
  vec3 veg = mix(meadow, heath, alpine);
  veg = mix(veg, vec3(0.25, 0.22, 0.12), (1.0 - alpine) * smoothstep(0.6, 0.72, n1) * 0.7);
  vec3 col = mix(rock, veg, flat_);
  // Skog: mörk gran med ljusare björkfläckar
  float forest = forestAt(p, h) * smoothstep(0.55, 0.75, slope);
  // Blågrön granskog; björkpartierna bara lite ljusare, så att de inte blir lysande fläckar på avstånd
  vec3 trees = mix(vec3(0.012, 0.026, 0.024), vec3(0.03, 0.05, 0.038), n3);
  trees = mix(trees, vec3(0.05, 0.068, 0.04), smoothstep(0.62, 0.9, vnoise(p * 0.012)) * 0.45);
  col = mix(col, trees, forest);
  // Strand närmast sjön, grus kring plattan
  float beach = smoothstep(0.9, 0.2, h - WATER) * (1.0 - forest);
  col = mix(col, vec3(0.24, 0.22, 0.17), beach * 0.8);
  if (uPad.z > 0.0) {
    float apron = 1.0 - smoothstep(uPad.z + 10.0, uPad.z + 35.0 + 15.0 * n2, length(p - uPad.xy));
    col = mix(col, mix(vec3(0.2, 0.19, 0.17), vec3(0.27, 0.25, 0.22), n3), apron);
  }
  // Snö: över snögränsen på allt som inte är för brant, högre upp även brantare
  float line = 1150.0 + 320.0 * (n1 - 0.5);
  float above = smoothstep(line - 120.0, line + 120.0, h);
  // Högt upp fastnar snön även i branta sluttningar: stora snöfält med mörka klippribbor emellan
  float hold = slope + 0.18 * (n2 - 0.5) + 0.2 * smoothstep(1300.0, 2100.0, h) + 0.08 * smoothstep(2500.0, 4500.0, h);
  // Snön ligger i stråk och fåror nedför sluttningen, med mörk sten emellan
  float streak = vnoise(vec2(pn.x * 0.014, pn.y * 0.005));
  float snow = above * smoothstep(0.62, 0.8, hold + 0.2 * (streak - 0.5));
  col = mix(col, vec3(0.9, 0.93, 0.97), snow);
  col = padColor(p, col);

  // Ljus: sol med mjuka skuggor och molnskuggor, himmel, studs från marken
  float dif = clamp(dot(nor, sun), 0.0, 1.0);
  sha *= cloudShadow(pos);
  float sky = clamp(0.5 + 0.5 * nor.y, 0.0, 1.0);
  float bou = clamp(0.3 - 0.7 * nor.y, 0.0, 1.0);
  // Skrymslen får mindre himmelsljus
  float occ = mix(0.55, 1.0, smoothstep(-0.2, 0.6, n3 * 0.4 + slope * 0.6)) * (1.0 - 0.35 * forest);
  // Skuggsidorna får bara himlens blå ljus: djupt blå snö och mörk skiffer i skuggan
  vec3 skyAmb = mix(vec3(0.26, 0.44, 0.92), vec3(0.28, 0.33, 0.52), uDusk) * (1.0 - 0.3 * uThin);
  vec3 lin = dif * sha * sunColor() + sky * occ * skyAmb * 0.6 + bou * mix(vec3(0.25, 0.22, 0.16), vec3(0.3, 0.18, 0.1), uDusk) * 0.4;
  col *= lin;
  // Snön blänker i solen
  float spe = pow(clamp(dot(reflect(rd, nor), sun), 0.0, 1.0), 20.0);
  col += snow * spe * sha * sunColor() * 0.25;
  return col;
}

vec3 gridNormal(vec4 g) {
  return normalize(vec3(-g.y, 1.0, -g.z));
}

// Sjön: speglar fjällen, himlen och molnen, mörkt vatten rakt ned, små vågor
vec3 waterShade(vec3 pos, vec3 rd, float t, vec2 frag) {
  vec3 sun = sunDir();
  vec2 w = pos.xz * vec2(0.012, 0.035) + vec2(uTime * 0.04, uTime * 0.015);
  float amp = 0.004 * (1.0 - smoothstep(300.0, 2000.0, t));
  vec3 nor = normalize(vec3((vnoise(w) - 0.5) * amp, 1.0, (vnoise(w * 1.9 + 4.3) - 0.5) * amp * 2.0));
  vec3 ref = reflect(rd, nor);
  ref.y = max(ref.y, 0.002);
  float fre = 0.02 + 0.98 * pow(1.0 - clamp(dot(-rd, nor), 0.0, 1.0), 5.0);
  vec3 refl = skyColor(ref);
  // Vågorna flyttar spegelbilden lite i bild
  vec2 q = frag + vec2(nor.x, -nor.z) * uFocal;
  vec2 size = uRes / uScale;
  if (uReflScale > 0.0) {
    vec4 g = texelFetch(uReflG, ivec2(clamp(vec2(q.x, size.y - q.y) * uReflScale, vec2(0.0), size * uReflScale - 1.0)), 0);
    if (g.x > 0.0) {
      // Punkten i den speglade bilden, och den riktiga punkten ovanför vattnet
      vec3 rdm = rayDir(q);
      float tm = g.x / rdm.z;
      vec3 pm = uCam + rdm * tm;
      vec3 pr = vec3(pm.x, 2.0 * WATER - pm.y, pm.z);
      vec3 dir = vec3(rdm.x, -rdm.y, rdm.z);
      vec3 c = terrainShade(pr, gridNormal(g), dir, min(g.w, 1.0));
      refl = applyFog(c, pos, dir, max(tm - t, 0.0));
    }
  }
  // Molnen i spegeln: samma moln som ovanför horisonten, längre från den
  if (uHasClouds > 0.0 && uCam.y < CLOUD_BASE) {
    const float HC = 1700.0;
    float d = (q.y - uCenter.y) * (HC - uCam.y) / (HC + uCam.y - 2.0 * WATER);
    vec2 uv = vec2(q.x, size.y - (uCenter.y - d)) / size;
    if (uv.y > 0.0 && uv.y < 1.0) {
      vec4 cl = texture(uCloudTex, uv);
      refl = refl * (1.0 - cl.a) + cl.rgb;
    }
  }
  vec3 deep = mix(vec3(0.012, 0.03, 0.035), vec3(0.03, 0.025, 0.04), uDusk);
  vec3 col = mix(deep, refl, fre);
  col += sunColor() * pow(max(dot(ref, sun), 0.0), 300.0) * 3.0 * fre;
  return col;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 frag = cssFrag();
  vec3 rd = rayDir(frag);
  vec3 ro = uCam;
  vec4 g = texelFetch(uG, ivec2(gl_FragCoord.xy), 0);
  vec3 col;
  bool hit = g.x > 0.0;
  if (hit) {
    float t = g.x / rd.z;
    vec3 pos = ro + rd * t;
    if (g.w > 1.5) col = waterShade(pos, rd, t, frag);
    else col = terrainShade(pos, gridNormal(g), rd, min(g.w, 1.0));
    col = applyFog(col, ro, rd, t);
  } else if (rd.y < 0.0 && -ro.y / rd.y * rd.z < uRowZ0) {
    // Närmare än rutnätets första rad: platt dalbotten
    float t = -ro.y / rd.y;
    col = applyFog(terrainShade(ro + rd * t, vec3(0.0, 1.0, 0.0), rd, 1.0), ro, rd, t);
    hit = true;
  } else {
    col = skyColor(rd);
  }
  vec4 cl = uHasClouds > 0.0 ? texture(uCloudTex, gl_FragCoord.xy / uRes) : vec4(0.0);
  col = col * (1.0 - cl.a) + cl.rgb;
  float disc = hit ? 0.0 : clamp(sunDisc(rd), 0.0, 1.0) * (1.0 - cl.a);

  col = aces(col * mix(0.9, 1.05, uDusk));
  col = pow(col, vec3(1.0 / 2.2));
  col = mix(col, mix(vec3(1.0, 0.99, 0.95), vec3(1.0, 0.97, 0.86), uDusk), disc);
  // Lite mer mättnad, som ett foto
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = clamp(mix(vec3(luma), col, 1.12), 0.0, 1.0);
  // Lite mer kontrast på dagen: mörkare skuggsidor och klarare snö
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.3 * (1.0 - uDusk));
  vec2 uv = gl_FragCoord.xy / uRes;
  col *= 0.9 + 0.1 * pow(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.2);
  outColor = vec4(col, 1.0);
}`;

/** Slumptal med frö, så att molnen ser likadana ut varje gång. */
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Dagsolen står till höger, lite bakom kameran: släpljus från sidan, så att fjällen får en ljus och en mörk sida
// (från samma sida som 3D-helikopterns sol i heli3d.js)
const DAY_LIGHT = norm([0.78, 0.48, -0.14]);
const DUSK_LIGHT = norm([0.75, 0.15, 1]); // ungefär där kvällssolen står i bild

function norm(v) {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
}

/** Solen på himlen: dagsolen till höger bakom kameran, kvällssolen på samma ställe i bild (v.sun) på varje skärm. */
function sunDir(v) {
  const sun = v.sun ?? { x: 0.86, y: 0.2 };
  const dusk = norm([(sun.x * v.width - v.cx) / v.focal, (v.cy - sun.y * v.height) / v.focal, 1]);
  const k = Math.min(1, Math.max(0, v.dusk));
  return norm(DAY_LIGHT.map((d, i) => d + (dusk[i] - d) * k));
}

/** Solljusets riktning över terrängen, i steg så att skuggorna inte räknas om varje bild. */
function lightDir(dusk) {
  const k = Math.round(Math.min(1, Math.max(0, dusk)) * 20) / 20;
  return { key: k, dir: norm(DAY_LIGHT.map((d, i) => d + (DUSK_LIGHT[i] - d) * k)) };
}

export class TerrainRenderer {
  /**
   * Skapar landskapet på en egen canvas. Shaderna byggs i bakgrunden där webbläsaren
   * kan (KHR_parallel_shader_compile); tills de är klara är `ready` false och spelet
   * ritar det enklare landskapet i 2D.
   * @returns {TerrainRenderer|null} null om WebGL2 saknas
   */
  static create(canvas) {
    try {
      const gl = canvas.getContext('webgl2', { antialias: false, depth: false, alpha: false });
      return gl ? new TerrainRenderer(canvas, gl) : null;
    } catch (err) {
      console.warn('[Ergcopter] 3D-landskapet går inte att starta:', err.message);
      return null;
    }
  }

  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.lost = false;
    this.failed = false;
    this.pending = true;
    // Utan grafikkort (programvarurendering) tar varje bild flera sekunder: rita i 2D.
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    if (SOFTWARE.test(String(name))) {
      console.info('[Ergcopter] Ingen grafikprocessor (' + name + ') – landskapet ritas i 2D.');
      this.failed = true;
      return;
    }
    // Höjdrutnätet och G-bufferten är flyttal som shaderna ritar till.
    if (!gl.getExtension('EXT_color_buffer_float')) {
      console.info('[Ergcopter] Grafikkortet kan inte rita till flyttalstexturer – landskapet ritas i 2D.');
      this.failed = true;
      return;
    }
    this.parallel = gl.getExtension('KHR_parallel_shader_compile');
    this.programs = {
      cache: this.#program(VERTEX, CACHE_FS),
      shadow: this.#program(VERTEX, SHADOW_FS),
      mesh: this.#program(MESH_VS, meshFS(false)),
      mirror: this.#program(MESH_VS, meshFS(true)),
      clouds: this.#program(VERTEX, CLOUDS_FS),
      final: this.#program(VERTEX, FINAL_FS),
    };
    // Varje bildstorlek får sina egna buffertar: huvudbilden och de små bilderna (snapshots).
    this.main = {};
    this.snap = {};
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
  }

  #program(vs, fs) {
    const { gl } = this;
    const prog = gl.createProgram();
    const shaders = [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].map(([type, src]) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      gl.attachShader(prog, shader);
      return shader;
    });
    gl.linkProgram(prog);
    return { prog, shaders, loc: new Map() };
  }

  /** Shaderna är byggda och landskapet kan ritas. */
  get ready() {
    if (this.failed || this.lost) return false;
    if (!this.pending) return true;
    const { gl } = this;
    const all = Object.values(this.programs);
    if (this.parallel && all.some((p) => !gl.getProgramParameter(p.prog, this.parallel.COMPLETION_STATUS_KHR))) return false;
    this.pending = false;
    for (const p of all) {
      if (gl.getProgramParameter(p.prog, gl.LINK_STATUS)) continue;
      const log = p.shaders.map((s) => gl.getShaderInfoLog(s)).join(' ') || gl.getProgramInfoLog(p.prog);
      console.warn('[Ergcopter] 3D-landskapet går inte att bygga:', log);
      this.failed = true;
      return false;
    }
    // En triangel som täcker bilden, för passen som räknar per bildpunkt
    this.quad = gl.createVertexArray();
    gl.bindVertexArray(this.quad);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // Rutnätet behöver inga hörndata: allt räknas fram ur gl_VertexID och gl_InstanceID.
    this.empty = gl.createVertexArray();
    this.#noiseTexture();
    return true;
  }

  /** 3D-brus för molnen: slumpvärden som texturen interpolerar mellan. */
  #noiseTexture() {
    const { gl } = this;
    const n = NOISE_SIZE;
    const random = mulberry32(20261001);
    const data = new Uint8Array(n * n * n);
    for (let i = 0; i < data.length; i++) data[i] = Math.floor(random() * 256);
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, n, n, n, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, wrap, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  /** En textur att rita till (med djupbuffert om depth), återanvänd så länge storleken är densamma. */
  #target(old, w, h, format, { depth = false, linear = false } = {}) {
    if (old && old.w === w && old.h === h) return old;
    const { gl } = this;
    if (old) {
      gl.deleteTexture(old.tex);
      gl.deleteFramebuffer(old.fbo);
      if (old.depth) gl.deleteRenderbuffer(old.depth);
    }
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
    const filter = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let rb = null;
    if (depth) {
      rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    return { tex, fbo, depth: rb, w, h };
  }

  #uniform(p, name, kind, ...values) {
    let loc = p.loc.get(name);
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(p.prog, name);
      p.loc.set(name, loc);
    }
    if (loc) this.gl[kind](loc, ...values);
  }

  /** Gemensamma uniforms för ett pass, med målets storlek w × h pixlar. */
  #begin(p, f, target, w, h) {
    const { gl } = this;
    gl.useProgram(p.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, w, h);
    const u = (name, kind, ...vals) => this.#uniform(p, name, kind, ...vals);
    u('uRes', 'uniform2f', w, h);
    u('uScale', 'uniform1f', w / f.v.width);
    u('uSize', 'uniform2f', f.v.width, f.v.height);
    u('uCenter', 'uniform2f', f.v.cx, f.v.cy);
    u('uFocal', 'uniform1f', f.v.focal);
    u('uCam', 'uniform3f', f.v.camX, f.v.camY, 0);
    u('uTime', 'uniform1f', f.v.time);
    u('uDusk', 'uniform1f', f.v.dusk);
    u('uThin', 'uniform1f', f.v.thin);
    u('uTop', 'uniform1f', f.top);
    u('uPeaks', 'uniform4fv', f.peaks);
    u('uPeakBox', 'uniform4f', ...f.box);
    u('uPeakCount', 'uniform1i', f.peakCount);
    u('uPad', 'uniform3f', f.v.pad?.x ?? 0, f.v.pad?.z ?? 0, f.v.pad?.r ?? 0);
    u('uLight', 'uniform3f', ...f.light);
    u('uSunDir', 'uniform3f', ...f.sunDir);
    u('uClouds', 'uniform1f', f.clouds);
    u('uCloudSteps', 'uniform1i', f.q.cloudSteps);
    u('uRowZ0', 'uniform1f', GRID.z0);
    u('uRowLog', 'uniform1f', f.rowLog);
    u('uColK', 'uniform1f', f.colK);
    u('uA', 'uniform1f', f.A);
    u('uPrevCamX', 'uniform1f', f.prevCamX);
    u('uPrevA', 'uniform1f', f.prevA);
    u('uNC', 'uniform1i', f.NC);
    u('uNR', 'uniform1i', f.NR);
    u('uNoise', 'uniform1i', 0);
    return u;
  }

  /** Binder texturen till enheten unit och samplern name. */
  #bind(u, name, unit, target) {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, target ? target.tex : null);
    u(name, 'uniform1i', unit);
  }

  /**
   * Ritar landskapet.
   * @param {object} v
   * @param {number} v.width, v.height  canvasens storlek i CSS-pixlar
   * @param {number} v.scale            upplösningen, målets pixlar per CSS-pixel
   * @param {number} v.cx, v.cy, v.focal  optiska mitten och brännvidden (CSS-pixlar)
   * @param {number} [v.gridFocal]      brännvidden utan utzoomning: rutnätets kolumner följer den,
   *                                    så att rutnätet inte behöver räknas om när kameran zoomar
   * @param {number} v.camX, v.camY     kamerans läge (m)
   * @param {number} v.dusk, v.thin, v.time
   * @param {{x:number, y:number}} [v.sun]  kvällssolens plats i bild, andel av bredd och höjd
   * @param {number} [v.clouds]         stackmolnen, 0 = klart, 1 = vanligt
   * @param {'high'|'low'} [v.quality]  rutnätets täthet och antal steg genom molnen
   * @param {{x:number, z:number, h:number, r:number}[]} v.peaks
   * @param {{x:number, z:number, r:number}|null} v.pad
   */
  render(v) {
    if (!this.ready) return;
    const { canvas } = this;
    const w = Math.max(1, Math.round(v.width * v.scale));
    const h = Math.max(1, Math.round(v.height * v.scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.#draw(this.main, v, w, h, true);
  }

  /** Ritar landskapet; den sista bilden hamnar i out, eller på canvasen om out saknas. */
  #draw(s, v, w, h, roomToZoom, out = null) {
    const { gl } = this;
    const q = QUALITY[v.quality ?? 'high'];
    const gridFocal = v.gridFocal ?? v.focal;
    const span = v.width + 2 * GRID.margin;
    const colK = q.px / gridFocal; // kolumnens bredd i världen per meter avstånd
    const cols = Math.ceil((span * gridFocal) / (v.focal * q.px)) + 2; // kolumner i bild
    const rowScale = roomToZoom ? 1 : Math.min(GRID.maxRowScale, Math.max(1, GRID.rowFocal / v.focal));
    const rowLog = Math.log(GRID.rowStep) * rowScale;
    const NR = Math.ceil(Math.log(GRID.zFar / GRID.z0) / rowLog) + 1;
    let NC = roomToZoom ? Math.ceil((span * GRID.zoomRoom) / q.px) + 4 : cols;
    if (s.grid && s.grid.colK === colK && s.grid.NC >= cols) NC = s.grid.NC; // behåll rutnätet
    NC = Math.max(NC, cols);
    const gridKey = `${NC}|${NR}|${colK}`;
    const fresh = s.gridKey !== gridKey;
    if (fresh) {
      s.cache = this.#target(s.cache, NC, NR, gl.RGBA32F);
      s.shadow = this.#target(s.shadow, NC, NR, gl.R8);
      s.gridKey = gridKey;
      s.grid = { colK, NC };
    }

    // Topparna, och rutorna där de har flyttat sig sedan förra bilden. Topparna styrs lite
    // varje bild (peaks3d.js); i huvudbilden flyttas de i rutnätet först när de har glidit
    // en bit (under en halv pixel i bild), så att rutnätet inte räknas om i varje bild.
    const peaks = new Float32Array(MAX_PEAKS * 4);
    const prev = s.peaks ?? new Float32Array(MAX_PEAKS * 4);
    let top = 3400; // fjällen når som högst ~3 380 m
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    const list = (v.peaks ?? []).slice(0, MAX_PEAKS);
    list.forEach((p, i) => {
      const o = i * 4;
      const tol = (PEAK_SNAP_PX * p.z) / v.focal;
      const keep = roomToZoom && prev[o + 2] === p.h && prev[o + 3] === p.r && Math.abs(prev[o] - p.x) < tol && Math.abs(prev[o + 1] - p.z) < tol;
      peaks.set(keep ? prev.subarray(o, o + 4) : [p.x, p.z, p.h, p.r], o);
      const [x, z] = peaks.subarray(o, o + 2);
      top = Math.max(top, p.h + 80);
      box[0] = Math.min(box[0], x - p.r);
      box[1] = Math.min(box[1], z - p.r);
      box[2] = Math.max(box[2], x + p.r);
      box[3] = Math.max(box[3], z + p.r);
    });
    const light = lightDir(v.dusk);
    const smooth = norm(DAY_LIGHT.map((d, i) => d + (DUSK_LIGHT[i] - d) * Math.min(1, Math.max(0, v.dusk))));
    const dirty = [];
    const shadowDirty = [];
    for (let i = 0; i < MAX_PEAKS; i++) {
      const a = prev.subarray(i * 4, i * 4 + 4);
      const b = peaks.subarray(i * 4, i * 4 + 4);
      if (a.every((x, k) => x === b[k])) continue;
      for (const [x, z, ph, r] of [a, b]) {
        if (ph <= 0) continue;
        dirty.push([x - r, z - r, x + r, z + r]);
        // Toppens skugga faller en bit bort, åt andra hållet från solen
        const reach = Math.min(8000, (ph * Math.hypot(light.dir[0], light.dir[2])) / Math.max(0.1, light.dir[1]));
        const sx = x - light.dir[0] * reach;
        const sz = z - light.dir[2] * reach;
        shadowDirty.push([Math.min(x, sx) - r, Math.min(z, sz) - r, Math.max(x, sx) + r, Math.max(z, sz) + r]);
      }
    }
    // För många ändringar: räkna om allt
    const tooMany = shadowDirty.length > MAX_DIRTY;
    s.peaks = peaks;

    const A = ((v.cx + GRID.margin) * gridFocal) / (v.focal * q.px);
    const f = {
      v,
      q,
      top,
      peaks,
      box: box[0] < Infinity ? box : [0, 0, 0, 0],
      peakCount: list.length,
      light: smooth,
      sunDir: sunDir(v),
      clouds: v.clouds ?? 1,
      colK,
      rowLog,
      A,
      prevCamX: s.camX ?? v.camX,
      prevA: s.A ?? A,
      NC,
      NR,
    };
    const valid = !fresh && !tooMany && s.camX !== undefined;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0);

    // Har kameran inte flyttat sig i sidled och ingen topp flyttat sig finns allt redan i rutnätet
    const still = valid && v.camX === s.camX && A === s.A && !dirty.length;

    // 1a. Höjder och lutningar
    let u;
    if (!still) {
      u = this.#begin(this.programs.cache, f, s.cache, NC, NR);
      u('uValid', 'uniform1i', valid ? 1 : 0);
      u('uDirtyCount', 'uniform1i', dirty.length);
      if (dirty.length) u('uDirty', 'uniform4fv', new Float32Array(dirty.flat()));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // 1b. Skuggor
    const lightSame = s.lightKey === light.key;
    if (!still || !lightSame) {
      u = this.#begin(this.programs.shadow, f, s.shadow, NC, NR);
      this.#bind(u, 'uCache', 1, s.cache);
      u('uLight', 'uniform3f', ...light.dir); // skuggorna följer solen i steg
      u('uValid', 'uniform1i', valid && s.lightKey === light.key ? 1 : 0);
      u('uDirtyCount', 'uniform1i', shadowDirty.length);
      if (shadowDirty.length) u('uDirty', 'uniform4fv', new Float32Array(shadowDirty.flat()));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    s.lightKey = light.key;
    s.camX = v.camX;
    s.A = A;

    // 2. G-bufferten: rutnätet som trianglar, och spegelbilden om sjön kan synas. Står kameran
    // still (bara tiden har gått) är den densamma som förra bilden: då ritas bara molnen och färgerna om.
    const halfW = Math.max(1, Math.round(w / 2));
    const halfH = Math.max(1, Math.round(h / 2));
    // Spegelbilden i full upplösning: i halv blev fjällens kanter i sjön trappstegiga
    const reflW = w;
    const reflH = h;
    const water = v.cy + ((v.camY - WATER_M) * v.focal) / 3500 < v.height;
    const gKey = [w, h, v.width, v.height, v.cx, v.cy, v.focal, v.camY, cols, water].join('|');
    const sameG = still && lightSame && s.gKey === gKey && s.g?.w === w && s.g?.h === h;
    s.gKey = gKey;
    s.g = this.#target(s.g, w, h, gl.RGBA32F, { depth: true });
    if (water) s.refl = this.#target(s.refl, reflW, reflH, gl.RGBA32F, { depth: true });
    gl.bindVertexArray(this.empty);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    const gPasses = sameG ? [] : [[s.g, w, h, 1, 0], ...(water ? [[s.refl, reflW, reflH, 1, 1]] : [])];
    for (const [target, tw, th, stride, mirror] of gPasses) {
      u = this.#begin(mirror ? this.programs.mirror : this.programs.mesh, f, target, tw, th);
      this.#bind(u, 'uCache', 1, s.cache);
      this.#bind(u, 'uShadow', 2, s.shadow);
      u('uRow0', 'uniform1i', 0);
      u('uStride', 'uniform1i', stride);
      u('uMirror', 'uniform1f', mirror);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const n = Math.ceil(cols / stride);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 2 * n, Math.floor((NR - 1) / stride));
    }
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.quad);

    // 3. Molnen i halv upplösning
    const hasClouds = f.clouds > 0;
    if (hasClouds) {
      s.clouds = this.#target(s.clouds, halfW, halfH, gl.RGBA16F, { linear: true });
      u = this.#begin(this.programs.clouds, f, s.clouds, halfW, halfH);
      this.#bind(u, 'uG', 3, s.g);
      u('uGRatio', 'uniform1f', w / halfW);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // 4. Färgerna till canvasen
    u = this.#begin(this.programs.final, f, out, w, h);
    this.#bind(u, 'uG', 3, s.g);
    this.#bind(u, 'uReflG', 4, water ? s.refl : null);
    this.#bind(u, 'uCloudTex', 5, hasClouds ? s.clouds : null);
    u('uReflScale', 'uniform1f', water ? reflW / v.width : 0);
    u('uHasClouds', 'uniform1f', hasClouds ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Små bilder av landskapet, t.ex. till korten i Fjällräddaren-menyn och flygloggens
   * karta. Ritas i en textur utanför bild och läses tillbaka, så att canvasen bakom
   * spelet varken byter storlek eller behöver ritas om.
   * @param {object[]} views  som till render(), med width, height och scale
   * @returns {HTMLCanvasElement[]|null}  null om landskapet inte är klart
   */
  snapshots(views) {
    if (!this.ready) return null;
    const { gl } = this;
    const shots = views.map((v) => {
      const w = Math.max(1, Math.round(v.width * v.scale));
      const h = Math.max(1, Math.round(v.height * v.scale));
      this.snap.camX = undefined; // varje bild har sin egen kamera: räkna om rutnätet
      this.snap.out = this.#target(this.snap.out, w, h, gl.RGBA8);
      this.#draw(this.snap, v, w, h, false, this.snap.out);
      const px = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.snap.out.fbo);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // WebGL läser nedifrån och upp: vänd raderna
      const image = new ImageData(w, h);
      const row = w * 4;
      for (let y = 0; y < h; y++) image.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
      const full = document.createElement('canvas');
      full.width = w;
      full.height = h;
      full.getContext('2d').putImageData(image, 0, 0);
      const cw = Math.round(v.width);
      const ch = Math.round(v.height);
      if (cw === w && ch === h) return full;
      // Kopian i CSS-pixlar: ritad i högre upplösning och nedskalad blir kanterna mjuka
      const copy = document.createElement('canvas');
      copy.width = cw;
      copy.height = ch;
      copy.getContext('2d').drawImage(full, 0, 0, cw, ch);
      return copy;
    });
    // Bilderna tas sällan: lämna inte kvar deras buffertar i grafikminnet
    for (const t of Object.values(this.snap)) {
      if (!t?.fbo) continue;
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
      if (t.depth) gl.deleteRenderbuffer(t.depth);
    }
    this.snap = {};
    return shots;
  }
}
