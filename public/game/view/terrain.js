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
//    Under flygningen räknas också krökningen och den stora lutningen ur grannarna, som snön följer.
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
uniform float uCloudNear; // inga moln närmare kameran än så här (z), så att man ser helikoptern
uniform float uCloudMore; // 0 = vanligt, mer = tätare molnhav (startskärmens utsikt)
uniform vec4 uLake;     // en extra sjö: x, z och radier i sidled och på djupet (0 = ingen)
uniform float uCloudLift; // molnlagret så här mycket högre (m), t.ex. kring massivets fot i utsikten
uniform float uVista;   // 0–1, startskärmens utsikt: mindre snö, blåare skuggor och mer kontrast, som ett foto
uniform int uPeakCount; // antal toppar i uPeaks
uniform int uCloudSteps;
uniform sampler3D uNoise;
${GRID_GLSL}
#define PLANE ${PLANE_M.toFixed(1)}
#define NOISE_SIZE ${NOISE_SIZE.toFixed(1)}
#define CLOUD_BASE (850.0 + uCloudLift)   // stackmolnens bas
#define CLOUD_TOP (1550.0 + uCloudLift)   // och de högsta topparna
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

// Åsbrus (ridged multifractal): skarpa krön där bruset byter tecken, och toppar där flera
// oktavers krön möts. Ger kedjor av spetsiga toppar med branta flanker, 0..ungefär 1.
float ridged(vec2 p, int oct) {
  float a = 0.0, b = 0.6, w = 1.0;
  for (int i = 0; i < oct; i++) {
    float n = 1.0 - abs(gnoised(p).x) * 1.5;
    n *= n;
    a += b * n * w;
    w = clamp(n * 1.4, 0.0, 1.0); // finare krön bara uppe på de grövre
    b *= 0.48;
    p = M2 * p * 2.07;
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
// Avståndet ut från en tresidig pyramids mitt: plana sidor som möts i skarpa åsar (som ett horn),
// i stället för en rund kon. Mellan 0,5 och 1 gånger det vanliga avståndet.
float facets(vec2 u, float ang) {
  float m = -1e4;
  for (int i = 0; i < 3; i++) {
    float a = ang + float(i) * 2.094 + 0.35 * sin(ang * 3.7 + float(i) * 1.9);
    m = max(m, dot(u, vec2(cos(a), sin(a))));
  }
  return m;
}

// Ett fält av pyramidformade toppar, en per ruta (cell m) på ett slumpat ställe i rutan, med egen
// höjd, bredd och vridning: tresidiga pyramider med plana sidor och skarpa åsar, 0..1. Ger kedjorna
// långt bort tydliga, spetsiga toppar med djupa dalar emellan i stället för en kuperad platå.
float pyramids(vec2 p, float cell, float soft) {
  vec2 c = p / cell;
  vec2 i = floor(c);
  vec2 f = fract(c);
  float h = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = f - g - (0.15 + 0.7 * hash22(i + g));
      float r = hash12(i + g + 17.3);
      float ang = r * 6.2832;
      vec2 cs = vec2(cos(ang), sin(ang));
      vec2 u = vec2(cs.x * o.x - cs.y * o.y, cs.y * o.x + cs.x * o.y);
      // Tre sidor (120° emellan) som möts i åsar, lite rundade (soft): skarpa åsar blev trappsteg i rutnätet
      float fa = smax(smax(u.x, dot(u, vec2(-0.5, 0.866)), soft), dot(u, vec2(-0.5, -0.866)), soft);
      float d = mix(length(u), fa * 1.5, 0.75) / (0.7 + 0.4 * fract(r * 7.13));
      // Konkava sidor: branta mot toppen och flackare ut mot dalen, som ett horn
      h = max(h, (0.5 + 0.5 * fract(r * 3.71)) * pow(max(1.0 - d, 0.0), 1.8));
    }
  }
  return h;
}

// Djupet för kedjorna långt bort, där brusets skala växer 2,6 gånger mellan 10 och 40 km: integralen av
// 1 / skalan, så att koordinaten alltid växer med avståndet
float farZ(float z) {
  float z1 = PLANE + 10000.0;
  float u = clamp((z - z1) / 30000.0, 0.0, 1.0);
  return min(z, z1) + 18750.0 * log(1.0 + 1.6 * u) + max(z - z1 - 30000.0, 0.0) / 2.6;
}

float peakAt(vec2 p, vec4 k, int oct) {
  vec2 d = p - k.xy;
  float r = length(d) / k.w;
  if (r >= 1.0) return -1e4;
  float seed = fract(k.z * 0.01373) * 40.0;
  vec2 u = d / k.w;
  // Åsar åt några håll: radien varierar mjukt runt toppen
  vec2 dir = u / max(r, 1e-4);
  float lobes = vnoise(dir * 1.3 + seed) * 0.65 + vnoise(dir * 3.1 - seed) * 0.35;
  // Varje massiv är utdraget åt sitt eget håll och har sin egen profil, så att topparna inte blir kloner:
  // några är långa åsar med en spets, andra breda pyramider eller smalare horn
  vec2 ax = vec2(cos(seed * 2.3), sin(seed * 2.3));
  float el = 0.55 + 0.4 * fract(seed * 0.53);
  vec2 ue = vec2(dot(u, ax) * el, dot(u, vec2(-ax.y, ax.x)));
  // Plana sidor som möts i skarpa åsar, och bitoppar som ger massivet breda axlar
  float re = mix(length(ue), facets(ue, seed * 1.3) * 1.5, 0.7);
  float s = re * (0.72 + 0.62 * lobes);
  float cone = pow(max(1.0 - s, 0.0), 1.05 + 0.3 * fract(seed * 0.29)) * (1.0 - smoothstep(0.5, 1.0, r));
  // Bitoppar på åsarna, lägre än huvudtoppen: ett massiv med flera spetsar i stället för en ensam kon
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ang = seed * 1.7 + fi * 2.25 + 0.7 * sin(seed * 3.1 + fi);
    vec2 c = vec2(cos(ang), sin(ang)) * (0.34 + 0.16 * fract(seed * 0.37 + fi * 0.61));
    float hs = 0.5 + 0.34 * fract(seed * 0.71 + fi * 0.37);
    vec2 uc = u - c;
    float sc = mix(length(uc), facets(uc, ang * 2.1 + fi) * 1.5, 0.6);
    cone = smax(cone, hs * pow(max(1.0 - sc / 0.5, 0.0), 1.2), 0.06);
  }
  float e = clamp(eroded(u * 4.2 + seed, oct) * 2.4, -1.0, 1.0);
  // Raviner och klippribbor nedför sidorna, ända upp mot toppen: inga släta pyramidsidor
  float gully = 1.0 - ridged(vec2(dot(u, ax), dot(u, vec2(-ax.y, ax.x))) * vec2(9.0, 5.0) + seed * 1.9, max(oct - 5, 2));
  float w = 1.0 - smoothstep(0.45, 1.0, r);
  // Upphöjningar växer nedåt, raviner skärs ut ända upp mot toppen. Måttliga, så att foten inte blir en lodrät mur.
  float lift = (1.0 - cone) * max(e, 0.0) * 0.45;
  float carve = pow(1.0 - cone, 0.6) * max(-e, 0.0) * 0.7;
  return k.z * (cone + (lift - carve) * w - 0.07 * gully * smoothstep(0.98, 0.7, cone) * w);
}

// Startskärmens massiv (uVista): en huvudtopp med långa åsar åt olika håll, som en alptopp sedd från luften,
// i stället för en kon. Två långa armar bildar en ryggrad och två kortare sporrar sticker ut åt sidorna.
// Krönen sjunker i förtoppar, axlar och sadlar. Sedan skär ett erosionsfilter raviner och klippribbor
// längs fallinjen, där snön ligger i rännor. Toppen ligger exakt på k.z.
float sGully = 0.0; // massifAt: hur djupt i en ränna punkten ligger (0–1)
float sMask = 0.0;  // heightAt: rännan i det massiv som bestämmer höjden, där snön samlas (0–1)

// Massivets grundform (i toppens höjd) ur armarna, utan raviner. u är förvrängd, i radier från toppen.
float massifShape(vec2 u, float seed, float base, float ratio) {
  float f = -1e4;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float j = fract(seed * 0.37 + fi * 0.71) - 0.5;
    float ang = base + (i == 0 ? 0.0 : i == 1 ? 3.1416 + 0.7 * j : i == 2 ? 1.5708 + 0.9 * j : -1.5708 + 0.9 * j);
    vec2 dir = vec2(cos(ang), sin(ang));
    float L = (i == 0 ? 0.95 : i == 1 ? 0.7 : i == 2 ? 0.5 : 0.38) * (0.85 + 0.3 * fract(seed * 0.53 + fi * 0.29));
    float t = dot(u, dir);
    float tc = clamp(t, 0.0, L);
    float perp = length(u - dir * tc);
    float s = tc / L;
    // Krönet: brant just under toppen, sedan en flackare axel. Ryggraden är på en del massiv en lång egg.
    float drop = i < 2 ? mix(0.36, 0.1, fract(seed * 0.83)) : 0.36;
    float crest = 1.0 - drop * smoothstep(0.0, 0.3, s) - (0.88 - drop) * s * s;
    // Förtoppar och hack i krönet: en åsprofil som en riktig egg, inte en rak linjal från toppen
    crest += (0.3 * (vnoise(vec2(s * 5.0 + seed, fi * 3.7)) - 0.5) + 0.1 * (vnoise(vec2(s * 13.0 - seed, fi * 1.3)) - 0.5)) * smoothstep(0.05, 0.3, s) * (1.0 - 0.6 * s);
    // Sidorna i meter per meter (ratio = radie / höjd), olika branta på var sida: brant under krönet och
    // flackare nedåt (konkavt, som en eroderad fjällsida), så att toppen inte blir en pyramid med raka sidor
    float side = dot(u - dir * tc, vec2(-dir.y, dir.x));
    float steep = (mix(0.85, 0.6, smoothstep(-0.08, 0.08, side)) + 0.2 * fract(seed * 0.41 + fi * 0.17)) * ratio;
    float prof = 0.08 * (1.0 - exp(-perp / 0.08)) + 0.62 * perp;
    float arm = crest - steep * prof - 2.0 * max(t - L, 0.0) - 0.8 * max(-t, 0.0);
    f = smax(f, arm, 0.05);
  }
  return f;
}

// Erosionsfilter (som clayjohns "eroded terrain noise"): i varje cell ränder längs fallinjen (dir är
// vinkelrät mot lutningen), mjukt blandade med grannarna, så att rännorna grenar sig nedför sluttningen.
// Ger höjden (-1..1) och dess lutning.
vec3 erosionCells(vec2 p, vec2 dir) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  vec3 va = vec3(0.0);
  float wt = 0.0;
  for (int i = -2; i <= 1; i++) {
    for (int j = -2; j <= 1; j++) {
      vec2 o = vec2(float(i), float(j));
      vec2 pp = fp + o - hash22(ip - o) * 0.5;
      float w = exp(-2.0 * dot(pp, pp));
      float mag = dot(pp, dir) * 6.2832;
      va += vec3(cos(mag), -sin(mag) * dir) * w;
      wt += w;
    }
  }
  return va / wt;
}

float massifAt(vec2 p, vec4 k, int oct) {
  sGully = 0.0;
  vec2 d = p - k.xy;
  float r = length(d) / k.w;
  if (r >= 1.0) return -1e4;
  float seed = fract(k.z * 0.01373) * 40.0;
  vec2 u = d / k.w;
  // Krokiga åsar, inte linjaler; ingen förvrängning just vid toppen så att den står kvar
  vec2 wu = u + smoothstep(0.0, 0.25, r) * (0.2 * (vec2(vnoise(u * 2.2 + seed), vnoise(u * 2.2 - seed + 5.0)) - 0.5)
    + 0.06 * (vec2(vnoise(u * 7.0 + seed), vnoise(u * 7.0 - seed + 3.0)) - 0.5));
  // Ryggradens riktning: bråkdelen av radien är ett varv (0–1) när den är satt, annars slumpad
  float turn = fract(k.w);
  float base = turn > 0.0 ? turn * 6.2832 : seed * 2.3;
  float ratio = k.w / k.z;
  float f = massifShape(wu, seed, base, ratio);
  // Lutningen (i toppens höjd per radie) styr rännornas riktning. Den räknas över ~100 m, så att den blir
  // liten på krönen, där rännorna från båda sidor annars möttes i en kam av taggar.
  const float E = 0.025;
  vec2 grad = vec2(massifShape(wu + vec2(E, 0.0), seed, base, ratio) - massifShape(wu - vec2(E, 0.0), seed, base, ratio),
    massifShape(wu + vec2(0.0, E), seed, base, ratio) - massifShape(wu - vec2(0.0, E), seed, base, ratio)) / (2.0 * E);
  // Rännorna följer fallinjen, och varje finare oktav böjs av de grövre så att de grenar sig
  vec2 dir = vec2(grad.y, -grad.x) * 0.9;
  vec3 e = vec3(0.0);
  float a = 0.5, fq = 1.0;
  int n = oct >= 7 ? 3 : 2;
  for (int i = 0; i < 4; i++) {
    if (i >= n) break;
    e += erosionCells(wu * 4.5 * fq + seed, dir + e.zy * vec2(1.0, -1.0)) * a * vec3(1.0, fq, fq);
    a *= 0.45;
    fq *= 2.0;
  }
  // Djupast i de branta sidorna, inget vid toppen och inget på flacka partier
  float slope = length(grad) / ratio; // meter per meter
  float amt = smoothstep(0.02, 0.15, r) * smoothstep(0.25, 0.6, slope);
  f += 0.085 * e.x * amt;
  sGully = smoothstep(-0.05, -0.5, e.x) * amt * (1.0 - smoothstep(0.75, 0.95, r));
  // Grövre eroderat brus: block och små kammar, inget vid toppen
  f += 0.08 * eroded(u * 4.0 + seed, min(oct, 6)) * smoothstep(0.0, 0.12, r);
  // Tonas ned mot kanten, så att massivet går över i fjällen omkring
  f -= 1.2 * smoothstep(0.7, 1.0, r);
  return k.z * min(f, 1.0);
}

// Höjden (m) i punkten p = (x, z): platt dalbotten i helikopterns plan, sjön bakom,
// skogsklädda kullar och sedan fjällen. oct = detaljnivå.
float heightAt(vec2 p, int oct) {
  float z = p.y;
  float shore = shoreZ(p.x);
  // Förvrängda koordinater, så att topparna inte står i ett regelbundet mönster som kloner
  vec2 warp = vec2(vnoise(p * (1.0 / 9000.0) + 2.3), vnoise(p * (1.0 / 9000.0) + 7.9)) - 0.5;
  vec2 pw = p + warp * 3400.0;
  // Längre bort tätare toppar (världen är fast, kameran flyttar sig bara i sidled och uppåt): från flyghöjd
  // ser man då rad på rad med spetsiga toppar i stället för långa, låga kullar
  float freq = mix(1.0 / 3000.0, 1.0 / 2200.0, smoothstep(6000.0, 20000.0, z));
  float e = eroded(pw * freq + vec2(13.1, 7.7), oct);
  // Ett andra lager toppar i bassängerna mellan det förstas, så att det inte blir stora platta slätter
  // (tonas in och ut över några hundra meter: ett hugg i höjden syntes som en mörk linje tvärs över dalen)
  float second = smoothstep(PLANE + 1700.0, PLANE + 2600.0, z) * (1.0 - smoothstep(PLANE + 8500.0, PLANE + 9400.0, z));
  if (second > 0.0) e = mix(e, smax(e, 0.85 * eroded(pw * (freq * 1.37) + vec2(41.3, 27.9), oct - 1), 0.2), second);
  // Fjällen samlas i massiv med breda, skogiga dalar emellan. Massivens höjd varierar, så att
  // topparna inte blir lika höga kloner. Som i den svenska fjällvärlden ligger de flesta
  // topparna på 900–1 600 m: från flyghöjd ser man ned på kedja efter kedja.
  float mass = vnoise(p * (1.0 / 15000.0) + vec2(3.1, 8.2)) * 0.68 + vnoise(p * (1.0 / 5200.0) + vec2(1.7, 4.4)) * 0.32;
  mass = 0.7 + 0.3 * smoothstep(0.2, 0.7, mass);
  // Kedjorna går i band på tvären, med lägre dalar emellan där molnen ligger: lager bakom lager
  float band = vnoise(vec2(pw.x * (1.0 / 17000.0), pw.y * (1.0 / 4300.0)) + vec2(4.7, 1.3));
  band = 0.74 + 0.26 * smoothstep(0.22, 0.72, band);
  // Inget tak på a: ett tak gav platåer där alla toppar kapades på samma höjd
  float a = max(0.5 + 1.1 * e, 0.0);
  // Längre bort lite högre, så att de bortre kedjorna når upp mot horisonten bakom de närmare
  float ramp = smoothstep(PLANE + 2800.0, PLANE + 7000.0, z) * (1.0 + 0.1 * smoothstep(9000.0, 30000.0, z));
  // Längre bort brantare relief, så att de bortre kedjorna syns som rader av toppar och inte som en slätt
  float far = smoothstep(5000.0, 18000.0, z);
  float relief = 950.0 * (1.0 + 0.8 * far);
  float mtn = ramp * (260.0 + mass * band * (500.0 + relief * pow(a, 2.0 + 0.4 * far)));
  // Bakom milstolparnas toppar (som står 3–7 km bort) reser sig kedja bakom kedja med skarpa krön
  // på 1 500–2 500 m, ungefär i höjd med helikoptern: från flyghöjd syns de som lager av
  // siluetter mot horisonten i stället för en karta man ser ned på. Kedjorna går mest på tvären.
  float back = smoothstep(PLANE + 5500.0, PLANE + 9000.0, z);
  if (back > 0.0) {
    // Längre bort större kedjor och färre oktaver: lugna, tydliga toppar mot horisonten i stället för ett brusigt fält
    float zs = 1.0 + 1.6 * clamp((z - PLANE - 10000.0) / 30000.0, 0.0, 1.0);
    // På djupet räknas skalan som en integral (farZ): med z / zs vände bruset tillbaka runt 25 km och
    // drogs ut på djupet, så att rader av pyramider blev långa, raka krön med tänder tvärs över bilden
    vec2 q = vec2(pw.x / zs, farZ(pw.y));
    // Få oktaver: åsbrusets fina krön blev långa, släta dyner med regelbundna tänder långt bort
    float rg = ridged(q * vec2(1.0 / 5200.0, 1.0 / 3400.0) + vec2(7.3, 2.1), max(oct - 3 - int(zs > 1.5), 2));
    float lift = 0.7 + 0.35 * smoothstep(0.25, 0.75, vnoise(p * (1.0 / 11000.0) + vec2(5.5, 9.1)));
    // Kedjorna stiger mot horisonten: de närmaste lägre, så att de bortre syns över dem
    // Längst bort höga toppar med djupa dalar: på 30 km avstånd syns bara stor relief som toppar mot horisonten
    float amp = mix(1500.0, 2200.0, smoothstep(PLANE + 7000.0, PLANE + 22000.0, z)) + 700.0 * smoothstep(PLANE + 20000.0, PLANE + 40000.0, z);
    // Spetsiga toppar med djupa dalar emellan, där diset och molnen ligger: med en lägre exponent blev
    // kedjorna breda, snötäckta platåer
    // Pyramidformade toppar med åsbruset som raviner och klippribbor på sidorna, och lägre åsar emellan
    float py = pyramids(q + vec2(1730.0, 940.0), 2700.0, 0.015 + 0.035 * smoothstep(8000.0, 30000.0, z));
    float rr = pow(clamp(rg, 0.0, 1.2), 1.75);
    // Raviner skärs ned i pyramidernas sidor där åsbruset är lågt, så att snön ligger i stråk och inte som en kupol
    // Finare raviner nedför sidorna (på tvären mot dem): mörka klippribbor mellan snöstråken
    float gul = 1.0 - ridged(q * vec2(1.0 / 1300.0, 1.0 / 800.0) + vec2(3.7, 8.9), 3);
    mtn = mix(mtn, 260.0 + amp * lift * (1.05 * py * (0.72 + 0.4 * rg) + 0.15 * rr - py * (0.1 * (1.0 - py) + 0.12 * gul)), back);
  }
  // Mjukt tak högt upp, så att de enstaka jättarna långt bort inte reser sig som en mur över horisonten
  // Taket ligger högre långt bort: där sticker de spetsigaste topparna upp över horisonten
  // I startskärmens utsikt ligger kameran nära taket: där blev de avplanade krönen långa vågräta linjer
  float cap = 2500.0 + 400.0 * smoothstep(15000.0, 35000.0, z) + 1100.0 * uVista;
  if (mtn > cap) mtn = cap + 450.0 * (1.0 - exp(-(mtn - cap) / 450.0));
  // Skogsklädda kullar bakom sjön
  float hills = smoothstep(shore - 160.0, shore + 2200.0, z) * (60.0 + 560.0 * clamp(0.5 + 1.1 * e, 0.0, 1.15));
  // Åsar och raviner i kullarna längre bort, så att de har relief när man ser dem från höjden
  float rid = eroded(p * (1.0 / 1100.0) + vec2(5.3, 2.9), min(oct, 7));
  // Längre bort högre: dalbottnarna mellan kedjorna blir då förberg i stället för platta slätter
  hills += smoothstep(shore + 300.0, shore + 2400.0, z) * (300.0 + 350.0 * smoothstep(6000.0, 14000.0, z)) * clamp(rid + 0.35, 0.0, 1.0);
  float h = max(hills, mtn);
  // Dalbotten: helt platt närmast planet, små ojämnheter längre bort, sjön bakom plattan
  float rough = (2.0 + 6.0 * vnoise(p * 0.005)) * smoothstep(40.0, 260.0, abs(z - PLANE));
  float lake = lakeHere(p.x) * smoothstep(PLANE + 70.0, PLANE + 140.0, z) * (1.0 - smoothstep(shore - 110.0, shore - 10.0, z));
  h = mix(max(h, rough), -7.0, lake);
  // Tjärnar på flacka partier i dalen
  float tarn = smoothstep(0.64, 0.72, vnoise(p * 0.0011 + 3.7)) * (1.0 - smoothstep(12.0, 40.0, h)) * smoothstep(PLANE + 300.0, PLANE + 800.0, z);
  h = mix(h, -6.0, tarn);
  // Startskärmens sjö långt bort: dalen sänks mjukt ned mot en stor sjö mellan kedjorna
  if (uLake.z > 0.0) {
    vec2 ld = (p - uLake.xy) / uLake.zw;
    float lr = length(ld) + 0.35 * (vnoise(p * (1.0 / 1800.0) + 6.1) - 0.5);
    float basin = smoothstep(0.92, 2.1, lr);
    h = mix(-7.0, h, basin * basin);
    tarn = max(tarn, 1.0 - smoothstep(0.85, 1.0, lr));
  }
  float wet = max(lake, tarn);
  // Trädkronorna ger skogen struktur på nära håll
  if (oct > 9) h += forestAt(p, h) * (11.0 + 9.0 * vnoise(p * 0.15)) * (1.0 - wet) * smoothstep(9.5, 11.5, float(oct));
  sMask = 0.0;
  if (p.x > uPeakBox.x && p.x < uPeakBox.z && p.y > uPeakBox.y && p.y < uPeakBox.w) {
    for (int i = 0; i < uPeakCount; i++) {
      if (uVista > 0.5) {
        float hm = massifAt(p, uPeaks[i], oct - 1);
        if (hm > h) sMask = sGully;
        h = smax(h, hm, 60.0);
      } else {
        h = smax(h, peakAt(p, uPeaks[i], oct - 1), 60.0);
      }
    }
  }
  return h;
}

// Detaljnivån efter avståndet
int octFor(float t) {
  // Långt bort är rutnätets rutor 50–150 m: finare brus än så vek sig till regelbundna mönster (vikning)
  return t < 1500.0 ? 10 : t < 5000.0 ? 8 : t < 14000.0 ? 7 : t < 26000.0 ? 5 : 4;
}

// --- Ljus och himmel -------------------------------------------------------------------

// Strålen genom bildpunkten frag (CSS-pixlar, y uppifrån)
vec3 rayDir(vec2 frag) {
  return normalize(vec3((frag.x - uCenter.x) / uFocal, (uCenter.y - frag.y) / uFocal, 1.0));
}

vec2 cssFrag() {
  return vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
}

// Solen på himlen: dagsolen står högt till höger, i höjd med kameran. Kvällssolen står lågt och syns på
// samma ställe i bild på varje skärm, oavsett var helikoptern är. Terrängen belyses
// från uLight, en fast riktning nära solens, så att skuggorna kan sparas.
// Räknas ut en gång per bild i JavaScript (sunDir i terrain.js).
vec3 sunDir() {
  return uSunDir;
}

vec3 sunColor() {
  vec3 c = mix(vec3(1.0, 0.94, 0.85) * 3.6, vec3(1.0, 0.64, 0.34) * 5.2, uDusk);
  return mix(c, vec3(1.0, 0.6, 0.36) * 4.6, uVista); // utsikten: varmt, gyllene släpljus som i en solnedgång
}

// Himlen utan moln: djupblå zenit och ljus horisont på dagen, på kvällen glöd mot solen
// och rosa-lila åt andra hållet. Högt upp mörknar den.
vec3 skyBase(vec3 rd) {
  vec3 sun = sunDir();
  float y = max(rd.y, 0.0);
  float s = max(dot(rd, sun), 0.0);
  // Ett blekt, gråvitt dis just över horisonten som snabbt går över i mättat blått, djupare mot zenit
  vec3 zen = mix(vec3(0.03, 0.13, 0.42), vec3(0.004, 0.012, 0.05), uThin);
  vec3 mid = mix(vec3(0.14, 0.29, 0.5), vec3(0.03, 0.08, 0.25), uThin);
  vec3 hor = mix(vec3(0.47, 0.51, 0.57), vec3(0.32, 0.44, 0.7), uThin);
  vec3 day = mix(hor, mid, 1.0 - exp(-y / 0.042));
  day = mix(day, zen, smoothstep(0.08, 0.6, y));
  // Ljusare och blekare åt solens sida (till höger), som i ett foto med solen snett bakom
  float side = smoothstep(-0.1, 0.7, rd.x * sign(sun.x));
  day = mix(day, hor * 1.08, 0.32 * side * (1.0 - smoothstep(0.0, 0.45, y)) * (1.0 - uThin));
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
  // Flata bankar och stråk över horisonten, inte höga bulliga stackmoln som tar över himlen
  float hn = H / 1000.0;
  if (hn < 0.0 || hn > 1.0) return col;
  float cov = smoothstep(0.3, 0.7, vnoise(vec2(X / 7000.0, seed)));
  vec2 q = vec2(X, H * 2.4) / 1100.0 + seed * 3.7 + vec2(uTime * 0.01, 0.0);
  float f = fbm(q, 5);
  float d = f + 0.5 * cov - 0.62 - 0.55 * hn;
  // Mjuk kant, som molnen nere i dalarna: inga utklippta vita former mot himlen
  float a = smoothstep(0.0, 0.16, d) * smoothstep(0.0, 0.25, hn);
  if (a <= 0.0) return col;
  // Belyst ovanpå och mot solen, grå undersida; långt bort tonar molnen mot horisontens dis
  float lit = clamp(0.25 + 1.1 * hn + 1.6 * (f - 0.5) + 2.0 * (d - 0.1), 0.0, 1.0);
  vec3 cc = mix(vec3(0.56, 0.63, 0.75), vec3(1.08, 1.06, 1.03), lit);
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
    float c = fbm(q * vec2(1.0, mix(2.0, 3.2, uDusk)), 5);
    // Få, mjuka slöjor på dagen: mest klarblå himmel, inga tunna strimmor som ser ut som repor
    c = smoothstep(0.64 - 0.24 * uDusk, 0.9 - 0.1 * uDusk, c) * smoothstep(0.0, 0.15, rd.y);
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
  // Under flygningen tunnare luft nära (startskärmens utsikt som förut)
  float a = mix(1.0 / 38000.0, 1.0 / 21000.0, uVista);
  const float b = 1.0 / 1900.0;
  float k = abs(rd.y) > 1e-4 ? (1.0 - exp(-t * rd.y * b)) / (rd.y * b) : t;
  float tau = a * exp(-ro.y * b) * k;
  // Luftperspektiv på dagen även högt upp: kedja efter kedja tonar mot blått dis med avståndet
  // Nära klart, sedan allt tätare: de närmaste åsarna har full kontrast, de bortre bleknar bort
  // Längst bort syns kedjorna ändå som bleka, blå siluetter mot horisonten.
  // Kedjorna bakom milstolparna (8–20 km) ska ha tydligt mindre kontrast än de närmaste topparna.
  // Diset växer jämnt från en dryg kilometer: även milstolparnas toppar (3–7 km) får lite blå luft, så att de
  // hör ihop med kedjorna bakom i stället för att se inklistrade ut, och de bortersta kedjorna behåller
  // ändå lite kontrast mellan snö och sten i stället för att bli en vit målad fond.
  // Tunnare längst bort än förut: även de bortersta kedjorna har kvar sina ljusa och skuggade sidor
  // Luftperspektiv i steg: de närmaste topparna (3–7 km) nästan klara med svart sten och vit snö, kedjorna
  // på 10–20 km gråblå och de bortersta bleka (diset växer med kvadraten på avståndet)
  float km = max(t - 2500.0, 0.0) * 0.001;
  float kmV = max(t - 1500.0, 0.0) * 0.001;
  tau += mix(0.012 * km + 0.0011 * km * km, 0.032 * kmV + 0.00018 * kmV * kmV, uVista) * (1.0 - 0.7 * uDusk);
  // Ett tätare dislager nere i dalen, som syns först när man ser ned på det från höjden:
  // dalen långt under helikoptern blir blåaktig och platt i färgen, som i ett flygfoto.
  const float a2 = 1.0 / 5000.0;
  const float b2 = 1.0 / 700.0;
  float k2 = abs(rd.y) > 1e-4 ? (1.0 - exp(-t * rd.y * b2)) / (rd.y * b2) : t;
  float low = 1.0 - exp(-a2 * exp(-ro.y * b2) * k2 * smoothstep(400.0, 1600.0, ro.y));
  // Dalens dis är djupare blått än luften högre upp, och ligger närmast marken: läggs på först
  col = mix(col, mix(vec3(0.1, 0.19, 0.32), vec3(0.16, 0.14, 0.2), uDusk), low * 0.75);
  tau *= 1.0 - 0.62 * uVista; // utsikten: klarare luft, de bortre kedjorna behåller kontrasten
  float amount = 1.0 - exp(-tau);
  vec3 sun = sunDir();
  vec3 hor = skyBase(vec3(rd.x, 0.015, rd.z));
  // Ljust gråblått även på mellanavstånd: skuggorna lyfts mot luftens färg i stället för att bli djupt mörkblå
  vec3 near = mix(vec3(0.13, 0.22, 0.36), vec3(0.3, 0.32, 0.44), uDusk);
  near = mix(near, vec3(0.17, 0.26, 0.46), uVista); // utsikten: blått luftperspektiv, inte lila
  // Långt bort ljust gråblått som fjärran fjäll, inte vitt: kedjorna bakom varandra tonar bort i diset
  // Mörkare än himlen vid horisonten, så att de bortersta kedjorna ändå syns som siluetter mot den
  // Allra längst bort närmare himlens ljusa horisont, så att den bortersta kedjan inte blir en mörk mur
  // Kedjorna på mellanavstånd blir djupt gråblå (som i ett flygfoto i klart väder), inte mjölkvita
  float wall = mix(0.92, 0.55, smoothstep(25000.0, 60000.0, t));
  // I utsikten blir kedjorna blågrå mot den varma himlen, som i ett kvällsfoto
  hor = mix(hor, mix(vec3(0.19, 0.275, 0.42), hor, uDusk * (1.0 - 0.75 * uVista)), mix(wall, 0.55, uDusk));
  vec3 fogCol = mix(near, hor, smoothstep(0.0, 0.7, amount));
  fogCol += mix(vec3(0.3, 0.25, 0.15), vec3(0.7, 0.3, 0.08), uDusk) * pow(max(dot(rd, sun), 0.0), 8.0) * amount;
  return mix(col, fogCol, amount);
}

// --- Moln ------------------------------------------------------------------------------

// Hur mycket stackmoln det finns här ovanifrån sett (0–1): enskilda moln med luckor emellan
float cloudCover(vec2 xz) {
  vec2 c = (xz + vec2(uTime * 5.0, uTime * 1.5)) * vec2(0.00026, 0.0005); // långa molnbankar på tvären med luckor emellan
  float m = noise3(vec3(c.x, 0.37, c.y)) * 0.6 + noise3(vec3(c.x * 2.6, 1.63, c.y * 2.6)) * 0.4;
  // Glesare på kvällen, så att solnedgången syns
  // Tätare bara på nära håll: långt bort blev ett tätt lager prickigt när strålen gick snett genom det
  float more = uCloudMore * (1.0 - smoothstep(4500.0, 7500.0, xz.y));
  return smoothstep(0.49 + 0.23 * uDusk - more, 0.84 + 0.06 * uDusk - more, m) * uClouds;
}

// Stackmolnens täthet: platt bas och bulliga toppar, högre där molnet är kraftigt
float cloudMap(vec3 p, int oct, float sharp) {
  float y = p.y - CLOUD_BASE;
  if (y <= 0.0 || y >= CLOUD_TOP - CLOUD_BASE) return 0.0;
  // Glesare långt bort: snett genom molnlagret blev de annars ett vitt täcke över de bortre kedjorna
  float m = cloudCover(p.xz) * smoothstep(uCloudNear, uCloudNear + 2500.0, p.z) * (1.0 - 0.75 * smoothstep(14000.0, 30000.0, p.z));
  // I utsikten ovanifrån blev de bortre molnen rader av prickar när strålen gick snett genom det tunna lagret
  m *= 1.0 - uVista * smoothstep(9000.0, 13000.0, p.z);
  // Mellan kedjorna (6–16 km) ligger molnen tätare: vita molnbankar i dalarna mellan lagren av fjäll
  m = min(1.0, m * (1.0 + 0.6 * smoothstep(5000.0, 8000.0, p.z) * (1.0 - smoothstep(14000.0, 20000.0, p.z))));
  float hn = y / (CLOUD_TOP - CLOUD_BASE);
  // Bruset nedan ger högst +0,5: där räcker det inte till något moln
  float base = m * 1.35 - 0.2 - 1.15 * hn - 0.95 * 0.47;
  if (base + 0.95 * 0.93 * 1.08 <= 0.0) return 0.0;
  // Bredare än höga: flata bankar med bulliga toppar i stället för runda bollar
  vec3 q = (p + vec3(uTime * 5.0, 0.0, uTime * 1.5)) * vec3(0.0024, 0.0042, 0.0028);
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
  // Över molnen faller ingen molnskugga: annars skuggade molnen under topparna dem bakifrån
  float over = smoothstep(CLOUD_BASE + 450.0, CLOUD_TOP, pos.y);
  if (over >= 1.0) return 1.0;
  vec3 c = pos + uLight * ((CLOUD_BASE + 450.0 - pos.y) / max(uLight.y, 0.05));
  return 1.0 - 0.7 * (1.0 - over) * smoothstep(0.0, 0.25, cloudMap(c, 3, 4.0));
}

// Utsiktens molnhav ovanifrån: stackmoln som en höjdkarta av halvklot i tre storlekar (blomkålsform), så
// att varje bulle får en tydlig, belyst ovansida och skuggade sidor och veck. Volymmolnen ovan blev ett
// platt, suddigt täcke när man såg ned på dem.
float puffs(vec2 q, float cell, float seed) {
  vec2 c = q / cell;
  vec2 i = floor(c);
  vec2 f = fract(c);
  float h = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 d = g + hash22(i + g + seed) - f;
      float r = 0.5 + 0.45 * hash12(i + g + seed + 7.1);
      h = max(h, sqrt(max(r * r - dot(d, d), 0.0)));
    }
  }
  return h * cell;
}

// Molnhavets ovansida (m) och hur tätt det är här (0–1)
vec2 seaTop(vec2 xz) {
  vec2 q = xz + vec2(uTime * 4.0, uTime * 1.2);
  float cov = cloudCover(xz) * smoothstep(uCloudNear, uCloudNear + 1500.0, xz.y) * (1.0 - smoothstep(9000.0, 13000.0, xz.y));
  // Stora tornar, bullar på dem och små knottror, och lite brus så att halvkloten inte blir som bubbelplast
  float h = 0.42 * puffs(q, 1100.0, 0.0) + 0.42 * puffs(q, 420.0, 3.3) + 0.22 * puffs(q, 150.0, 9.1);
  h += 14.0 * (vnoise(q * (1.0 / 45.0)) - 0.5);
  // Molnen packas upp mot det främsta massivets fot (som när fuktig luft stiger längs fjällsidan)
  float bank = 0.0;
  if (uPeakCount > 0) {
    float d = length(xz - uPeaks[0].xy) / uPeaks[0].w;
    bank = smoothstep(1.05, 0.6, d) * smoothstep(0.2, 0.45, d);
    cov = max(cov, 0.8 * bank);
  }
  return vec2(CLOUD_BASE - 160.0 + cov * (60.0 + h) + 300.0 * bank, cov);
}

vec4 seaClouds(vec3 ro, vec3 rd, float tmax, float dither) {
  const float LIFT = 700.0; // högsta bullarna över molnbasen
  if (rd.y >= -1e-3) return vec4(0.0);
  float t0 = (CLOUD_BASE + LIFT - ro.y) / rd.y;
  if (rd.z > 0.0) t0 = max(t0, (uCloudNear - ro.z) / rd.z);
  float t1 = min(min(tmax, (CLOUD_BASE - 160.0 - ro.y) / rd.y), 16000.0);
  if (t1 <= t0) return vec4(0.0);
  float t = t0, prev = t0;
  bool hit = false;
  // Närmaste passagen förbi en bulle (i bildpunkter) och var: mjuk kant i stället för trappsteg i halv upplösning
  float near = 1e9, tNear = t0;
  float pxM = 2.0 / (uFocal * rd.z); // meter per halv bildpunkt och meter avstånd
  for (int i = 0; i < 72; i++) {
    vec3 p = ro + rd * t;
    float gap = p.y - seaTop(p.xz).x;
    if (gap < 0.0) {
      hit = true;
      break;
    }
    float px = gap / (pxM * t);
    if (px < near) {
      near = px;
      tNear = t;
    }
    prev = t;
    t += clamp(gap * 0.6, 6.0 + 0.002 * t, 300.0) * (i == 0 ? dither + 0.5 : 1.0);
    if (t > t1) break;
  }
  float soft = 1.0;
  if (!hit) {
    soft = 1.0 - smoothstep(0.0, 2.5, near);
    if (soft <= 0.0) return vec4(0.0);
    t = tNear;
    prev = tNear;
  }
  // Halvering till ytan
  for (int i = 0; i < (hit ? 5 : 0); i++) {
    float m = 0.5 * (prev + t);
    vec3 p = ro + rd * m;
    if (p.y < seaTop(p.xz).x) t = m;
    else prev = m;
  }
  vec3 p = ro + rd * t;
  vec2 top = seaTop(p.xz);
  float e = 8.0 + 0.004 * t;
  vec3 n = normalize(vec3(seaTop(p.xz - vec2(e, 0.0)).x - seaTop(p.xz + vec2(e, 0.0)).x, 2.0 * e,
    seaTop(p.xz - vec2(0.0, e)).x - seaTop(p.xz + vec2(0.0, e)).x));
  vec3 sun = sunDir();
  // Kvällssolen snett ovanifrån bakom molnen: varma ovansidor mot solen, gråvioletta sidor och veck
  vec3 L = normalize(sun + vec3(0.0, 0.7, 0.0));
  float wrap = clamp((dot(n, L) + 0.3) / 1.3, 0.0, 1.0);
  float hgt = clamp((p.y - CLOUD_BASE + 100.0) / 600.0, 0.0, 1.0);
  vec3 col = mix(vec3(0.4, 0.31, 0.43), vec3(1.9, 1.24, 0.98), pow(wrap, 1.3));
  col *= 0.55 + 0.45 * hgt; // längre ned i vecken mörkare
  // Varm kant där ytan vänder sig från oss mot solen (motljus genom molnets tunna kant)
  float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0) * pow(max(dot(rd, sun), 0.0), 2.0);
  col += sunColor() * 0.12 * rim;
  // Mjuk kant där molnet är tunt, så att det tonar ut över fjällen i stället för att sluta tvärt
  float a = smoothstep(CLOUD_BASE - 160.0, CLOUD_BASE - 40.0, p.y) * smoothstep(0.02, 0.3, top.y);
  col = applyFog(col, ro, rd, t);
  return vec4(col, 1.0) * a * soft;
}

// Stackmolnen längs strålen fram till tmax, förmultiplicerad färg
vec4 clouds(vec3 ro, vec3 rd, float tmax, int steps, float dither) {
  if (uVista > 0.5) return seaClouds(ro, rd, tmax, dither);
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
  if (rd.z > 0.0) t0 = max(t0, (uCloudNear - ro.z) / rd.z);
  t1 = min(min(t1, tmax), 45000.0);
  if (t1 <= t0) return vec4(0.0);
  vec3 sun = sunDir();
  vec3 sunCol = sunColor();
  vec3 amb = mix(vec3(0.5, 0.6, 0.78), vec3(0.34, 0.34, 0.48), uDusk) * (1.0 - 0.3 * uThin);
  amb = mix(amb, vec3(0.58, 0.44, 0.5), 0.5 * uVista); // utsikten: molnhavet rosa i kvällsljuset
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
    // Mjuka kanter: tätheten växer långsamt inåt, så att molnen tonar ut i diset i stället för att bli utklippta
    // Under flygningen lite skarpare än förut: nu när molnen har en skuggsida syns bullarna i stället för en vit fläck
    // utsikten: bulligare, tydligare moln
    float sharp = mix(2.4, 1.7, smoothstep(2000.0, 20000.0, t)) * (1.0 + 0.7 * uVista) * (1.0 + 0.3 * (1.0 - uVista));
    float den = cloudMap(p, t < 12000.0 ? 5 : 4, sharp);
    if (den > 0.005) {
      // Första träffen: ett steg tillbaka och sedan kortare steg, så att kanten blir skarp
      if (!fine) {
        fine = true;
        t = max(t0, t - dt * 0.9);
        continue;
      }
      // Ljuset: hur mycket tunnare molnet är en bit mot solen (Quilez)
      // Starkare skillnad mellan sol- och skuggsidan och mörkare undersida: bulliga moln, inte vita fläckar
      // Solljuset dämpas av molnet mellan punkten och solen (Beer), och undersidan får mindre ljus:
      // vita, belysta toppar och gråblå sidor och bottnar, så att molnen får volym
      float y = clamp((p.y - CLOUD_BASE) / 900.0, 0.0, 1.0);
      // Solen står bakom kameran: utan den här självskuggningen blev sidan mot oss en platt vit yta
      // Under flygningen ett längre steg mot solen: hela bullar skuggar varandra, så att molnet får en ljus
      // sida mot solen och en grå, skuggad sida i stället för att vara jämnt vitt
      float od = cloudMap(p + sun * mix(380.0, 220.0, uVista), 3, sharp) * mix(1.25, 1.0, uVista);
      float dif = exp(-(4.5 + 3.5 * uVista) * od) * (0.22 + 0.78 * smoothstep(0.05, 0.8, y));
      // Utsikten: mörkare skuggsidor mellan bulorna, så att molnhavet får form i det låga ljuset
      vec3 lin = amb * (0.25 + 0.7 * y) * (1.0 - 0.3 * uVista) * (1.0 - 0.18 * (1.0 - uVista))
        + sunCol * dif * mix(0.7, 0.66, uVista);
      vec3 c = mix(vec3(1.0), vec3(0.72, 0.78, 0.88), den) * lin;
      // Tunna kanter släpper igenom mycket: molnet tonar ut i stället för att sluta i en skarp, vit kontur
      float alpha = 1.0 - exp(-den * den * dt * 0.05);
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
  float mask = sMask;
  // Lutningen med finare detaljer än höjden, som ljuset sedan visar
  // Steget följer radavståndet (0,4 % av z): finare detaljer än raderna hann inte med i bild och blev
  // trappsteg av snö och sten på de branta väggarna. De finaste detaljerna lägger bildpunktsshadern på.
  float e = max(0.6, 0.0035 * z);
  float h0 = heightAt(p, oct + 1);
  float hx = heightAt(p + vec2(e, 0.0), oct + 1);
  float hz = heightAt(p + vec2(0.0, e), oct + 1);
  outColor = vec4(h, (hx - h0) / e, (hz - h0) / e, mask);
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
    // Börja en kolumnbredd bort: långt bort är kolumnerna breda, och ett krön som går mot solen
    // skuggade sig självt i varannan kolumn (prickiga krön)
    float cw = uColK * z;
    // Med solen från sidan går strålen längs raderna, där närmaste-rutan-höjden skuggade solsidan i prickar:
    // börja lite högre och längre bort
    vec3 ro = vec3(p.x, max(g.x, WATER), z) + nor * (3.0 + 1.0 * cw);
    float t = 8.0 + 2.5 * cw;
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

// 1c. Under flygningen: krökningen och den stora formens lutning ur grannarna i höjdrutnätet, för rutor som är
// nya eller vars grannar har ändrats sedan förra bilden (snön följer dem, se terrainShade).
const DERIVE_FS = `#version 300 es
${COMMON}
uniform int uValid;
uniform vec4 uDirty[${MAX_DIRTY}];
uniform int uDirtyCount;
uniform sampler2D uCache;
out vec4 outColor;

const float KX = 15.0; // kolumner bort
const int KZ = 6;      // och rader bort: ungefär lika långt, ~2,5 % av avståndet

// Rutans grannar räknas om även när bara de har ändrats: rutorna med ändrade toppar växer med grannavståndet
bool dirty(vec2 p, float m) {
  for (int i = 0; i < uDirtyCount; i++) {
    vec4 b = uDirty[i];
    if (p.x > b.x - m && p.x < b.z + m && p.y > b.y - m && p.y < b.w + m) return true;
  }
  return false;
}

// Låg världskolumnen n på raden j i förra bildens fönster?
bool wasThere(float n, int j) {
  float n0 = rowStart(rowZ(float(j)), uPrevCamX, uPrevA);
  return n >= n0 && n < n0 + float(uNC);
}

// Höjden i rutnätet vid världskolumnen n på raden j, inom fönstret
float cacheH(float n, int j) {
  float z = rowZ(float(j));
  float n0 = rowStart(z, uCam.x, uA);
  return texelFetch(uCache, ivec2(texCol(clamp(n, n0, n0 + float(uNC) - 1.0)), j), 0).x;
}

// Krökningen ur grannarna i rutnätet, dimensionslös (> 0 i rännor och skålar, < 0 på krön och åsar).
// kx kolumner och kz rader bort är ungefär lika långt (kx = 15, kz = 6 ger 2,5 % av avståndet), alltså lika
// många bildpunkter på alla avstånd: snön samlas i rännorna och åsarna blir mörka klippribbor, även långt bort.
// Ger också lutningen över samma avstånd (sGrad): den stora formen utan rutnätets brus.
vec2 sGrad = vec2(0.0);
float curvature(float n, int j, float h, float kx, int kz) {
  float z = rowZ(float(j));
  float x = n * uColK * z;
  int ja = max(j - kz, 0);
  int jb = min(j + kz, uNR - 1);
  float za = rowZ(float(ja));
  float zb = rowZ(float(jb));
  float hl = cacheH(n - kx, j);
  float hr = cacheH(n + kx, j);
  float hb = cacheH(floor(x / (uColK * za) + 0.5), ja);
  float hf = cacheH(floor(x / (uColK * zb) + 0.5), jb);
  float dx = kx * uColK * z;
  float dz = max(0.5 * (zb - za), 1.0);
  sGrad = vec2((hr - hl) / (2.0 * dx), (hf - hb) / (2.0 * dz));
  return 0.5 * ((hl + hr - 2.0 * h) / dx + (hb + hf - 2.0 * h) / dz);
}

void main() {
  int c = int(gl_FragCoord.x);
  int j = int(gl_FragCoord.y);
  float z = rowZ(float(j));
  float n = colAt(c, rowStart(z, uCam.x, uA));
  vec2 p = vec2(n * uColK * z, z);
  int ja = max(j - KZ, 0);
  int jb = min(j + KZ, uNR - 1);
  float na = floor(p.x / (uColK * rowZ(float(ja))) + 0.5);
  float nb = floor(p.x / (uColK * rowZ(float(jb))) + 0.5);
  if (uValid == 1 && wasThere(n - KX, j) && wasThere(n + KX, j) && wasThere(na, ja) && wasThere(nb, jb)
    && !dirty(p, 0.03 * z)) discard;
  float h = texelFetch(uCache, ivec2(c, j), 0).x;
  float cv = curvature(n, j, h, KX, KZ);
  outColor = vec4(clamp(0.5 + 1.6 * cv, 0.0, 1.0), 1.0 / sqrt(1.0 + dot(sGrad, sGrad)), 0.0, 1.0);
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
uniform sampler2D uDerive; // krökningen och den stora lutningen (1c), under flygningen
uniform float uCurv;    // 1 = fjärde kanalen får terrängens krökning i stället för snörännan (flygningen)
out float vZ;
out vec2 vGrad;
out float vShadow;
out float vWater;
out float vMask;
out float vBig;

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
  vMask = g.w;
  vBig = 0.0;
  if (uCurv > 0.5) {
    vec2 d = texelFetch(uDerive, tc, 0).xy;
    vMask = d.x;
    vBig = d.y;
  }
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
in float vMask;
in float vBig;
out vec4 outColor;
void main() {
  ${mirror ? '// I spegelbilden ligger vattenytan kvar där den är och skulle dölja det som speglas\n  if (vWater > 0.5) discard;' : ''}
  // Fjärde kanalen: skuggan (0–1) + 2 för vatten + 4 × (snörännan eller krökningen i 64 steg + 64 × den stora
  // formens lutning i 64 steg), se gShadow, gWater, gMask och gBig
  float packed = floor(clamp(vMask, 0.0, 1.0) * 63.0 + 0.5) + 64.0 * floor(clamp(vBig, 0.0, 1.0) * 63.0 + 0.5);
  outColor = vec4(vZ, vGrad, vShadow + 2.0 * step(0.5, vWater) + 4.0 * packed);
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

// Snögränsen på milstolparnas toppar: knappt halvvägs upp, så att även de lägre topparna
// har snöfält och snöstråk med mörka klippor emellan, som fjällen i bakgrunden.
// Ger snögränsen och hur nära en topp punkten är (0–1).
vec2 peakSnowLine(vec2 p) {
  float line = 1e4, near = 0.0;
  if (p.x > uPeakBox.x && p.x < uPeakBox.z && p.y > uPeakBox.y && p.y < uPeakBox.w) {
    for (int i = 0; i < uPeakCount; i++) {
      vec4 k = uPeaks[i];
      float r = length(p - k.xy) / k.w;
      if (r < 1.0) {
        line = min(line, mix((0.6 - 0.22 * uVista) * k.z + 150.0, 3000.0, smoothstep(0.5, 1.0, r)));
        near = max(near, 1.0 - smoothstep(0.4, 0.9, r));
      }
    }
  }
  return vec2(line, near);
}

// Den stora formens lutning (normalens y, se gBig) för nästa terrainShade, eller -1 = ta normalens
float sBig = -1.0;

vec3 terrainShade(vec3 pos, vec3 nor, vec3 rd, float sha, float gully) {
  vec3 sun = uLight;
  vec2 p = pos.xz;
  float h = pos.y;
  // Brusets koordinater följer också höjden, så att mönstret inte dras ut på branta väggar mot kameran
  vec2 pn = vec2(p.x, p.y + 1.3 * h);
  float n1 = fbm(pn * 0.0016, 3);
  float n2 = vnoise(pn * 0.021);
  float n3 = vnoise(pn * 0.19);
  // Fina sprickor och revben i berget, bara på nära håll (längre bort skulle de flimra)
  float dist = length(pos - uCam);
  float near = 1.0 - smoothstep(2500.0, 9000.0, dist);
  // Långt bort jämnare snö och sten: små skiftningar blev där ett kornigt brus av vita prickar
  float farS = smoothstep(5000.0, 16000.0, dist);
  n2 = mix(n2, 0.5, 0.7 * farS);
  // Snön följer den större formen: med de fina detaljerna i lutningen blev snöfälten prickiga
  float slopeBig = sBig > 0.0 ? sBig : nor.y;
  sBig = -1.0;
  if (near > 0.0) {
    // Varje oktav bara där den är minst några bildpunkter stor: annars blev den ett korn av ljusa och
    // mörka bildpunkter på snön, som flimrade
    float pxPerM = uFocal / dist;
    vec3 b = gnoised(pn * 0.03) * smoothstep(3.0, 9.0, 33.0 * pxPerM)
      + 0.5 * gnoised(pn * 0.09 + 3.1) * smoothstep(3.0, 9.0, 11.0 * pxPerM);
    // Måttligt: starkare gav ett krispigt, överskärpt brus i berget som syntes lika mycket på alla avstånd
    nor = normalize(nor + vec3(b.y, 0.0, b.z) * 0.22 * near * smoothstep(0.95, 0.6, nor.y));
  }
  float slope = nor.y;
  float flat_ = smoothstep(0.62, 0.86, slope + 0.08 * (n2 - 0.5));
  // Krökningen (under flygningen, se curvature i MESH_VS): > 0 i rännor och skålar, < 0 på åsar och krön
  float cv = uVista > 0.5 ? 0.0 : clamp((gully - 0.5) * 2.0, -1.0, 1.0);

  // Sten: mörk, nästan neutral skiffer med svaga bruna stråk: i solen mörkgrå, i skuggan nästan svart, så att
  // snön lyser mot den
  vec3 rock = mix(vec3(0.026, 0.029, 0.036), vec3(0.06, 0.062, 0.07), n2);
  rock = mix(rock, mix(vec3(0.034, 0.044, 0.064), vec3(0.08, 0.092, 0.115), n2), uVista); // utsikten som förut
  rock = mix(rock, vec3(0.2, 0.17, 0.14), smoothstep(0.6, 0.85, n1) * 0.25);
  rock *= 0.9 + 0.2 * vnoise(vec2(p.x * 0.01, h * 0.035) + n2);
  // Ängar i dalen, fjällhed ovanför trädgränsen, myr på flacka partier
  // Dämpade, gråaktiga gröna: från ovan ska dalen se ut som i ett flygfoto, inte som en gräsmatta
  vec3 meadow = mix(vec3(0.058, 0.07, 0.046), vec3(0.092, 0.098, 0.066), n2);
  meadow = mix(meadow, vec3(0.05, 0.065, 0.045), smoothstep(0.5, 0.8, vnoise(p * 0.11)) * 0.3);
  // Myrar: gulbruna på flacka partier i dalen
  meadow = mix(meadow, vec3(0.12, 0.105, 0.068), smoothstep(0.55, 0.7, vnoise(p * 0.004 + 9.1)) * 0.6);
  // Fjällhed: dämpad grönbrun, inte gul, så att dalarna långt bort inte lyser gula i diset
  vec3 heath = mix(vec3(0.13, 0.14, 0.095), vec3(0.2, 0.19, 0.12), n2);
  float alpine = smoothstep(420.0, 850.0, h + 180.0 * (n1 - 0.5));
  vec3 veg = mix(meadow, heath, alpine);
  veg = mix(veg, vec3(0.25, 0.22, 0.12), (1.0 - alpine) * smoothstep(0.6, 0.72, n1) * 0.7);
  // Långt bort blir växtligheten gråblå i luften, inte olivgrön: dalarna mellan kedjorna ska inte lysa gröna
  veg = mix(veg, vec3(dot(veg, vec3(0.3, 0.5, 0.2))) * vec3(0.7, 1.0, 1.15), 0.6 * smoothstep(3500.0, 9000.0, dist));
  // Långt bort syns inte skogen och skuggorna i dalen var för sig, men de gör den mörkare (under flygningen):
  // dalbottnarna mellan topparna blir djupt grönblå i stället för en ljus, gröngrå slätt
  veg *= 1.0 - 0.4 * (1.0 - uVista) * smoothstep(2500.0, 8000.0, dist);
  // Långt bort syns mest sten på fjällsidorna: de bortre topparna blir mörkt blågrå med snö, inte gröngrå
  vec3 col = mix(rock, veg, flat_ * (1.0 - 0.6 * smoothstep(7000.0, 14000.0, dist) * smoothstep(500.0, 900.0, h)));
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
  // Kedjorna bakom milstolparna har snö på sina övre delar: det är snön som gör dem till tydliga toppar i diset
  float line = 1250.0 + 300.0 * (n1 - 0.5) + 150.0 * smoothstep(6000.0, 14000.0, p.y) + 250.0 * smoothstep(14000.0, 30000.0, p.y);
  // Under flygningen ligger snön längre ned på kedjorna bakom milstolparna: där ser man ned på dem, och med
  // snö bara på spetsarna blev de gråblå kartonger i diset
  line -= 380.0 * (1.0 - uVista) * smoothstep(4000.0, 10000.0, dist);
  vec2 pk = peakSnowLine(p);
  line = min(line, pk.x + 200.0 * (n1 - 0.5));
  float above = smoothstep(line - 140.0, line + 140.0, h);
  // Högt upp fastnar snön även i branta sluttningar: stora snöfält med mörka klippribbor emellan
  float hold = mix(slopeBig, slope, 0.35) - uVista * (0.26 - 0.36 * farS) + 0.14 * (n2 - 0.5) + 0.15 * smoothstep(1100.0, 1900.0, h) + 0.08 * smoothstep(2500.0, 4500.0, h) + 0.15 * pk.y;
  // Snön ligger i stråk och fåror nedför sluttningen, med mörk sten emellan
  float streak = vnoise(vec2(pn.x * 0.014, pn.y * 0.005));
  // Stråken är ~70 m breda: när de blir smalare än några pixlar i bild blev krönen långt bort prickiga
  streak = mix(0.5, streak, smoothstep(4.0, 12.0, 71.0 * uFocal / dist));
  float sw = 0.1 * farS; // bredare övergång långt bort, så att snöfälten inte blir prickiga
  // Bara de flackare partierna håller snön: snöfält och fåror med mycket mörk sten emellan, som i ett flygfoto
  float snow = above * smoothstep(0.63 - sw + 0.13 * farS, 0.8 + sw + 0.13 * farS, hold + 0.3 * (streak - 0.5) * (1.0 - 0.5 * farS));
  if (uVista < 0.5) {
    // Snön ligger i skålar, rännor och på avsatser; vinden blåser åsarna och de branta väggarna rena, så att
    // varje topp får mörka klippribbor med vita snöfält emellan. Krönen blåses bara delvis rena och närmast
    // toppen ligger mer snö: toppkalotten är vit. Lutningen är den stora formens (slopeBig): med normalens
    // fina detaljer blev snökanten ett korn av enstaka bildpunkter.
    float hold2 = mix(slopeBig, slope, 0.12) + 0.45 * max(cv, 0.0) + 0.2 * min(cv, 0.0) + 0.1 * (n2 - 0.5)
      + 0.12 * smoothstep(1300.0, 2300.0, h) + 0.16 * pk.y * smoothstep(pk.x, pk.x + 600.0, h);
    // Längre bort lägre tröskel: de bortre kedjorna är branta pyramider, och utan snö på sidorna blev de
    // gråblå kartonger i diset i stället för vita fjäll med mörka ribbor
    float lo = 0.62 - 0.03 * farS;
    // Rännor och klippribbor som löper nedför sluttningen: ränder tvärs över höjdkurvorna, ~70 m breda och
    // några hundra meter långa. Kedjorna långt bort har plana pyramidsidor, där krökningen inte ser något.
    // Som en triplanar textur: ränder längs höjden, i x på sidor som vetter mot oss och i z på sidor som vetter
    // åt sidan. (Med koordinater längs normalens riktning gav minsta brus i normalen helt andra ränder: korn.)
    float side = smoothstep(0.35, 0.75, abs(nor.x) / (abs(nor.x) + abs(nor.z) + 1e-4));
    float rib = mix(vnoise(vec2(p.x * (1.0 / 70.0), h * (1.0 / 320.0))),
      vnoise(vec2(p.y * (1.0 / 70.0), h * (1.0 / 320.0)) + 7.7), side);
    // Smalare ribbor på nära håll, där de är några bildpunkter breda
    float rib2 = mix(vnoise(vec2(p.x * (1.0 / 32.0), h * (1.0 / 140.0)) + 3.1),
      vnoise(vec2(p.y * (1.0 / 32.0), h * (1.0 / 140.0)) + 9.4), side);
    rib = mix(rib, rib2, 0.45 * smoothstep(3.0, 8.0, 32.0 * uFocal / dist));
    hold2 += 0.7 * (rib - 0.5) * smoothstep(0.97, 0.75, slopeBig) * smoothstep(2000.0, 6000.0, dist);
    // Mjuk övergång: med en smal blev snögränsen ett prickigt, korn av vita och svarta bildpunkter
    float snow2 = above * smoothstep(lo - 0.03 - sw, lo + 0.11 + sw, hold2 + 0.2 * (streak - 0.5) * (1.0 - 0.5 * farS));
    snow = snow2;
  }
  // Startskärmens massiv: snön ligger i rännorna och på flacka avsatser, med mörk sten på ribborna emellan
  if (uVista > 0.5 && pk.y > 0.0) {
    float ledge = smoothstep(0.8, 0.92, slopeBig + 0.12 * (n2 - 0.5) + 0.14 * (streak - 0.5));
    float chute = smoothstep(0.1, 0.45, gully + 0.3 * (streak - 0.5)) * smoothstep(0.2, 0.42, slopeBig + 0.1 * (n2 - 0.5));
    // Fläckar och band av snö över hela väggen, inte bara i rännorna
    float fleck = smoothstep(0.56, 0.68, vnoise(pn * 0.011) * 0.55 + vnoise(pn * 0.037) * 0.3 + vnoise(pn * 0.11) * 0.15)
      * smoothstep(0.3, 0.55, slopeBig);
    snow = mix(snow, above * max(max(ledge, chute), fleck), pk.y);
  }
  // Över snögränsen är det som inte är snö kal sten, inte gräs (gröna fläckar på krönen)
  if (uVista < 0.5) col = mix(col, rock, smoothstep(line - 350.0, line + 50.0, h) * (1.0 - forest));
  col = mix(col, vec3(0.78, 0.81, 0.86), snow);
  col = padColor(p, col);

  // Ljus: sol med mjuka skuggor och molnskuggor, himmel, studs från marken
  float dif = clamp(dot(nor, sun), 0.0, 1.0);
  sha *= cloudShadow(pos);
  float sky = clamp(0.5 + 0.5 * nor.y, 0.0, 1.0);
  float bou = clamp(0.3 - 0.7 * nor.y, 0.0, 1.0);
  // Skrymslen får mindre himmelsljus
  float occ = mix(0.55, 1.0, smoothstep(-0.2, 0.6, n3 * 0.4 + slope * 0.6)) * (1.0 - 0.35 * forest);
  // Rännorna ser mindre av himlen, krönen mer
  occ *= clamp(1.0 - 0.45 * cv, 0.45, 1.25);
  // Skuggsidorna får bara himlens blå ljus: djupt blå snö och mörk skiffer i skuggan
  // Gråblått, inte mättat: skuggsidorna blir mörk skiffer och blågrå snö i stället för klarblått
  // Svagare himmelsljus än solen: snön i skugga blir tydligt blå och mörkare än den solbelysta, så att varje topp
  // har en ljus och en skuggad sida även långt bort
  // Klart blått himmelsljus i skuggan: snön i skugga blir ljust blågrå och stenen mörk skiffer, som i ett flygfoto
  // Dämpat, inte koboltblått: skuggsidorna blir skiffergrå med en blå ton
  vec3 skyAmb = mix(mix(vec3(0.3, 0.4, 0.64), vec3(0.25, 0.4, 0.8), uVista), vec3(0.28, 0.33, 0.52), uDusk) * (1.0 - 0.3 * uThin);
  skyAmb = mix(skyAmb, vec3(0.36, 0.37, 0.56), 0.8 * uVista); // utsikten: blåvioletta skuggsidor
  vec3 lin = dif * sha * sunColor() + sky * occ * skyAmb * mix(0.6, 0.5, uDusk) + bou * mix(vec3(0.25, 0.22, 0.16), vec3(0.3, 0.18, 0.1), uDusk) * 0.4;
  // Utsikten: snön i skugga lyser ljust blågrå av himlen, som i ett kvällsfoto, i stället för att bli mörkblå
  lin += snow * sky * skyAmb * 0.35 * uVista;
  // Snön i skugga får ljus från himlen och från snöfälten omkring (flerfaldig spridning): ljust blågrå,
  // inte mörkblå, så att skuggsidan läses som snö och stenen blir det mörka
  lin += snow * sky * skyAmb * 0.3 * (1.0 - uVista);
  col *= lin;
  // Snön blänker i solen
  float spe = pow(clamp(dot(reflect(rd, nor), sun), 0.0, 1.0), 20.0);
  col += snow * spe * sha * sunColor() * 0.25;
  return col;
}

// G-buffertens fjärde kanal (se meshFS): skuggan, vatten och snörännan
float gShadow(vec4 g) { return min(g.w - 4.0 * floor(g.w / 4.0), 1.0); }
bool gWater(vec4 g) { return g.w - 4.0 * floor(g.w / 4.0) > 1.5; }
float gMask(vec4 g) { return mod(floor(g.w / 4.0), 64.0) / 63.0; }
float gBig(vec4 g) { return floor(floor(g.w / 4.0) / 64.0) / 63.0; }

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
      vec3 c = terrainShade(pr, gridNormal(g), dir, gShadow(g), gMask(g));
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

// Dis i dalarna mellan kedjorna: de låga dalbottnarna några kilometer bort försvinner i en ljus, gråblå
// slöja med lite moln i, så att kedjorna står i lager över dimman i stället för på gröna slätter.
vec3 valleyMist(vec3 col, vec3 pos, float t) {
  float far = smoothstep(5500.0, 10000.0, t) * (1.0 - uDusk * 0.5);
  if (far <= 0.0) return col;
  float pat = vnoise(pos.xz * (1.0 / 2600.0) + vec2(3.3, 1.9)) * 0.6 + vnoise(pos.xz * (1.0 / 900.0)) * 0.4;
  // Längre bort når dimman högre: platåerna bakom milstolparna ligger också i den
  // Bara nere i dalarna: topparna på mellanavstånd ska stå klara över diset, inte tvättas ur av det
  float top = 760.0 + 320.0 * pat + 260.0 * smoothstep(7000.0, 13000.0, t);
  float m = smoothstep(top, top - 520.0, pos.y) * far;
  // Blått dis, inte mjölkvitt: dalarna blir djupa och blå mellan kedjorna
  // Ljusare än stenen men mörkare än snön: dalarna mellan kedjorna fylls av ljust blått dis, så att varje
  // kedja står som en egen siluett framför nästa (luftperspektiv), utan att topparna tvättas ur
  vec3 mist = mix(vec3(0.2, 0.28, 0.42), vec3(0.32, 0.4, 0.53), smoothstep(0.35, 0.8, pat));
  mist = mix(mist, vec3(0.3, 0.27, 0.34), uDusk * (1.0 - 0.6 * uVista)); // i kvällsljuset ljuslila skymningsdis
  return mix(col, mist, m * 0.62);
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
    if (gWater(g)) col = waterShade(pos, rd, t, frag);
    else {
      if (uVista < 0.5) sBig = gBig(g); // den stora formens lutning, som snön följer
      col = terrainShade(pos, gridNormal(g), rd, gShadow(g), gMask(g));
    }
    col = valleyMist(col, pos, t);
    col = applyFog(col, ro, rd, t);
  } else if (rd.y < 0.0 && -ro.y / rd.y * rd.z < uRowZ0) {
    // Närmare än rutnätets första rad: platt dalbotten
    float t = -ro.y / rd.y;
    col = applyFog(terrainShade(ro + rd * t, vec3(0.0, 1.0, 0.0), rd, 1.0, uVista > 0.5 ? 0.0 : 0.5), ro, rd, t);
    hit = true;
  } else {
    col = skyColor(rd);
  }
  vec4 cl = uHasClouds > 0.0 ? texture(uCloudTex, gl_FragCoord.xy / uRes) : vec4(0.0);
  // Utsikten: fjällen och molnen mörkare mot den ljusa himlen, som i ett kvällsfoto
  if (hit) col *= 1.0 - 0.4 * uVista;
  // Utsikten: blått dis nere vid molnhavet, så att fjällens fötter tonar bort och topparna står mörka över dem
  if (hit && uVista > 0.0) {
    float py = uCam.y + rd.y * g.x / rd.z;
    col = mix(col, vec3(0.075, 0.085, 0.13), uVista * 0.55 * smoothstep(CLOUD_BASE + 1000.0, CLOUD_BASE + 100.0, py));
  }
  col = col * (1.0 - cl.a) + cl.rgb * (1.0 - 0.35 * uVista);
  float disc = hit ? 0.0 : clamp(sunDisc(rd), 0.0, 1.0) * (1.0 - cl.a);

  col = aces(col * mix(0.82, 1.05, uDusk));
  col = pow(col, vec3(1.0 / 2.2));
  col = mix(col, mix(vec3(1.0, 0.99, 0.95), vec3(1.0, 0.97, 0.86), uDusk), disc);
  // Lite mer mättnad, som ett foto
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = clamp(mix(vec3(luma), col, 1.08), 0.0, 1.0);
  // Utsikten: blå skuggor och varma högdagrar (split toning), som ett kvällsfoto i fjällen
  if (uVista > 0.0) {
    vec3 tone = mix(vec3(0.76, 0.95, 1.2), vec3(1.06, 0.98, 0.9), smoothstep(0.15, 0.75, luma));
    col = clamp(mix(col, col * tone, uVista), 0.0, 1.0);
  }
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

// Dagsolen står högt till höger, i höjd med kameran: rent sidoljus, så att varje topp vänder en solbelyst
// högersida och en skuggad vänstersida mot betraktaren. Med solen bakom kameran blev ljuset platt; framifrån
// var nästan allt skuggsidor i motljus. Ungefär som 3D-helikopterns sol i heli3d.js.
const DAY_LIGHT = norm([0.75, 0.6, -0.05]);
const VISTA_DAY_LIGHT = norm([0.78, 0.45, -0.42]); // startskärmens utsikt: dagsolen bakom kameran, som förut
const DUSK_LIGHT = norm([0.75, 0.15, 1]); // ungefär där kvällssolen står i bild

function norm(v) {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
}

/** Solen på himlen: dagsolen högt till höger, i höjd med kameran, kvällssolen på samma ställe i bild (v.sun) på varje skärm. */
function sunDir(v) {
  const sun = v.sun ?? { x: 0.86, y: 0.2 };
  const dusk = norm([(sun.x * v.width - v.cx) / v.focal, (v.cy - sun.y * v.height) / v.focal, 1]);
  const k = Math.min(1, Math.max(0, v.dusk));
  const day = v.vista ? VISTA_DAY_LIGHT : DAY_LIGHT;
  return norm(day.map((d, i) => d + (dusk[i] - d) * k));
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
      derive: this.#program(VERTEX, DERIVE_FS),
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
    u('uCloudNear', 'uniform1f', f.v.cloudNear ?? 4500);
    u('uCloudMore', 'uniform1f', f.v.cloudMore ?? 0);
    u('uVista', 'uniform1f', f.v.vista ?? 0);
    u('uCloudLift', 'uniform1f', f.v.cloudLift ?? 0);
    u('uLake', 'uniform4f', ...(f.v.lake ? [f.v.lake.x, f.v.lake.z, f.v.lake.rx, f.v.lake.rz] : [0, 0, 0, 0]));
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
   * @param {number} [v.vista]          0–1, startskärmens utsikt: mindre snö nära, blå skuggor, kvällston
   * @param {{x:number, z:number, rx:number, rz:number}} [v.lake]  en extra sjö i dalen
   * @param {number[]} [v.light]        egen riktning för solljuset över terrängen
   * @param {boolean} [v.mirror]        rita spegelbilden i sjön även när heuristiken säger nej
   * @param {number} [v.cloudNear]      inga moln närmare än så här (m, standard 4 500)
   * @param {number} [v.cloudMore]      tätare stackmoln på nära håll (0 = vanligt)
   * @param {number} [v.cloudLift]      molnlagret så här mycket högre (m)
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
      s.derive = this.#target(s.derive, NC, NR, gl.RG8);
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
    // Egen ljusriktning (startskärmens utsikt), annars mellan dags- och kvällsljuset
    const light = v.light ? { key: 'v' + v.light.join(','), dir: norm(v.light) } : lightDir(v.dusk);
    const smooth = v.light ? light.dir : norm(DAY_LIGHT.map((d, i) => d + (DUSK_LIGHT[i] - d) * Math.min(1, Math.max(0, v.dusk))));
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
    // En ny sjö (startskärmens utsikt) ändrar höjderna överallt: räkna om allt
    const lakeKey = v.lake ? [v.lake.x, v.lake.z, v.lake.rx, v.lake.rz].join('|') : '';
    const valid = !fresh && !tooMany && s.camX !== undefined && s.lakeKey === lakeKey;
    s.lakeKey = lakeKey;
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

    // 1c. Krökningen och den stora lutningen (bara under flygningen, inte i startskärmens utsikt)
    const curv = (v.vista ?? 0) <= 0.5;
    if (curv && (!still || !s.deriveValid)) {
      u = this.#begin(this.programs.derive, f, s.derive, NC, NR);
      this.#bind(u, 'uCache', 1, s.cache);
      u('uValid', 'uniform1i', valid && s.deriveValid ? 1 : 0);
      u('uDirtyCount', 'uniform1i', dirty.length);
      if (dirty.length) u('uDirty', 'uniform4fv', new Float32Array(dirty.flat()));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    s.deriveValid = curv;

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
    const water = v.mirror ?? v.cy + ((v.camY - WATER_M) * v.focal) / 3500 < v.height;
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
      this.#bind(u, 'uDerive', 6, s.derive);
      u('uCurv', 'uniform1f', curv ? 1 : 0);
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
   * Håller grafikkortet igång när landskapet inte ritas (t.ex. under flygloggens uppspelning i
   * helskärm): en liten ritning i en egen textur varje bild. Fick kortet vila mellan bilderna gav
   * grafikdrivrutinen långa stopp (300–500 ms).
   */
  keepAlive() {
    if (!this.ready) return;
    const { gl } = this;
    this.idle = this.#target(this.idle, 1, 1, gl.RGBA8);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.idle.fbo);
    gl.viewport(0, 0, 1, 1);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.flush();
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
