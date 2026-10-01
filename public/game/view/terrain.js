// Landskapet i 3D med WebGL2: terrängen strålföljs i en fragment-shader, som i
// Inigo Quilez "Elevated". Alpina fjäll med snö, sten, hed och skog, en sjö i dalen som
// speglar fjällen, stackmoln i 3D, slöjmoln, dis och himmel i dags- och kvällsljus.
// Ritas på en egen canvas bakom spelets 2D-canvas (render.js), som ritar helikoptern,
// etiketterna och instrumenten.
//
// Kameran står på helikopterns höjd och tittar rakt in i bilden (+z, ingen lutning).
// Helikoptern flyger i ett plan PLANE_M framför kameran, där skalan är densamma som i
// 2D-scenen: en meter i höjd är lika många pixlar i båda. Spelets mark (0 m) är
// dalbottnen där. Allt på en viss höjd ligger på helikopterns linje när helikoptern är
// på den höjden, hur långt bort det än är – därför passerar fjälltopparna helikoptern
// precis när milstolpen nås. Saknas WebGL2 ritar render.js det enklare landskapet själv.

/** Helikopterns plan: så här långt framför kameran (m). */
export const PLANE_M = 400;
/** Högst så här många milstolpstoppar i landskapet samtidigt. */
export const MAX_PEAKS = 12;
const NOISE_SIZE = 64; // 3D-brustexturen för molnen
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;
/** Antal steg i shaderns slingor: hög kvalitet, och lägre för en svag grafikprocessor. */
export const QUALITY = {
  high: { steps: 320, cloudSteps: 110, shadowSteps: 40 },
  low: { steps: 200, cloudSteps: 60, shadowSteps: 24 },
};

const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform vec2 uRes;      // målets storlek i pixlar
uniform float uScale;   // målets pixlar per CSS-pixel
uniform vec2 uCenter;   // optiska mitten i CSS-pixlar (y uppifrån)
uniform float uFocal;   // brännvidd i CSS-pixlar
uniform vec3 uCam;      // kamerans läge (m)
uniform float uTime;    // s, för molnens drift och vågorna
uniform float uDusk;    // 0 dag, 1 kvällssol
uniform float uThin;    // 0–1, tunn luft högt upp: mörkare himmel och stjärnor
uniform float uTop;     // högsta terrängen (m), strålar över den träffar inget
uniform vec4 uPeaks[${MAX_PEAKS}];  // milstolparnas toppar: x, z, höjd, radie (höjd 0 = tom)
uniform vec4 uPeakBox;  // rutan (x0, z0, x1, z1) som alla toppar ryms i
uniform vec3 uPad;      // helikopterplattan: x, z, radie (0 = ingen)
uniform vec2 uSun;      // kvällssolen syns här i bild (andel av bredd och höjd)
uniform float uClouds;  // 0 = klart, 1 = vanligt med stackmoln
uniform int uPeakCount; // antal toppar i uPeaks
// Antal steg i slingorna. Som uniforms, så att kompilatorn inte vecklar ut dem (långsam
// kompilering i Windows) och så att de går att sänka på en svag dator.
uniform int uSteps;      // strålen mot marken
uniform int uCloudSteps; // genom molnen
uniform int uShadowSteps;
uniform sampler3D uNoise;
out vec4 outColor;

#define PLANE ${PLANE_M.toFixed(1)}
#define NOISE_SIZE ${NOISE_SIZE.toFixed(1)}
const float WATER = -1.0;          // sjöns yta (m)
const float CLOUD_BASE = 1250.0;   // stackmolnens bas
const float CLOUD_TOP = 2350.0;    // och de högsta topparna
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
  return smoothstep(0.36, 0.46, n) * (1.0 - smoothstep(420.0, 640.0, h + 90.0 * (n - 0.5))) * smoothstep(PLANE + 160.0, PLANE + 320.0, p.y);
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
  float s = r * (0.78 + 0.5 * lobes);
  float cone = pow(max(1.0 - s, 0.0), 1.25);
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
  float e = eroded(p * (1.0 / 2700.0) + vec2(13.1, 7.7), oct);
  // Fjällen: vassa toppar och breda dalar, högre längre bort
  float a = clamp(0.42 + 1.2 * e, 0.0, 1.0);
  float ramp = smoothstep(PLANE + 2800.0, PLANE + 7000.0, z) * (1.0 + 0.35 * smoothstep(14000.0, 40000.0, z));
  float mtn = ramp * (280.0 + 2500.0 * a * a * (3.0 - 2.0 * a));
  // Skogsklädda kullar bakom sjön
  float hills = smoothstep(shore - 160.0, shore + 2200.0, z) * (60.0 + 560.0 * clamp(0.5 + 1.1 * e, 0.0, 1.15));
  float h = max(hills, mtn);
  // Dalbotten: helt platt närmast planet, små ojämnheter längre bort, sjön bakom plattan
  float rough = (2.0 + 6.0 * vnoise(p * 0.005)) * smoothstep(40.0, 260.0, abs(z - PLANE));
  float lake = lakeHere(p.x) * smoothstep(PLANE + 70.0, PLANE + 140.0, z) * (1.0 - smoothstep(shore - 110.0, shore - 10.0, z));
  h = mix(max(h, rough), -7.0, lake);
  // Trädkronorna ger skogen struktur på nära håll
  if (oct > 9) h += forestAt(p, h) * (11.0 + 9.0 * vnoise(p * 0.15)) * (1.0 - lake) * smoothstep(9.5, 11.5, float(oct));
  if (p.x > uPeakBox.x && p.x < uPeakBox.z && p.y > uPeakBox.y && p.y < uPeakBox.w) {
    for (int i = 0; i < uPeakCount; i++) {
      h = smax(h, peakAt(p, uPeaks[i], oct - 1), 60.0);
    }
  }
  return h;
}

// --- Ljus och himmel -------------------------------------------------------------------

// Dagsolen står högt till höger. Kvällssolen står lågt och syns på samma ställe i bild
// på varje skärm (uSun), oavsett var helikoptern är.
vec3 sunDir() {
  vec2 size = uRes / uScale;
  vec3 dusk = normalize(vec3((uSun.x * size.x - uCenter.x) / uFocal, (uCenter.y - uSun.y * size.y) / uFocal, 1.0));
  return normalize(mix(vec3(0.72, 0.6, 0.34), dusk, uDusk));
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
  vec3 hor = mix(vec3(0.55, 0.7, 0.88), vec3(0.32, 0.44, 0.7), uThin);
  vec3 day = mix(hor, zen, pow(y, mix(0.42, 0.3, uThin)));
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
    col = mix(col, lit * (1.0 - 0.6 * uThin), c * 0.65);
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
  float amount = 1.0 - exp(-tau);
  vec3 sun = sunDir();
  vec3 hor = skyBase(vec3(rd.x, 0.015, rd.z));
  vec3 near = mix(vec3(0.3, 0.42, 0.62), vec3(0.3, 0.32, 0.44), uDusk);
  vec3 fogCol = mix(near, hor, smoothstep(0.0, 0.7, amount));
  fogCol += mix(vec3(0.3, 0.25, 0.15), vec3(0.7, 0.3, 0.08), uDusk) * pow(max(dot(rd, sun), 0.0), 8.0) * amount;
  return mix(col, fogCol, amount);
}

// --- Moln ------------------------------------------------------------------------------

// Stackmolnens täthet: enskilda moln med platt bas och bulliga toppar, högre där
// molnet är kraftigt, med luckor emellan
float cloudMap(vec3 p, int oct, float sharp) {
  float y = p.y - CLOUD_BASE;
  if (y <= 0.0 || y >= CLOUD_TOP - CLOUD_BASE) return 0.0;
  vec2 drift = vec2(uTime * 5.0, uTime * 1.5);
  vec2 c = (p.xz + drift) * 0.0007;
  float m = noise3(vec3(c.x, 0.37, c.y)) * 0.6 + noise3(vec3(c.x * 2.6, 1.63, c.y * 2.6)) * 0.4;
  // Glesare på kvällen, så att solnedgången syns
  m = smoothstep(0.42 + 0.3 * uDusk, 0.8 + 0.1 * uDusk, m) * smoothstep(CLOUD_NEAR, CLOUD_NEAR + 2500.0, p.z) * uClouds;
  float hn = y / (CLOUD_TOP - CLOUD_BASE);
  vec3 q = (p + vec3(drift.x, 0.0, drift.y)) * 0.0026;
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
  float d = m * 1.35 - 0.2 - 1.15 * hn + 0.95 * (f - 0.47);
  d *= smoothstep(0.0, 0.12, hn - 0.06 * (1.0 - m));
  return clamp(d * sharp, 0.0, 1.0);
}

// Molnens skugga på marken: tätheten där solens stråle går genom molnlagret
float cloudShadow(vec3 pos) {
  vec3 sun = sunDir();
  vec3 c = pos + sun * ((CLOUD_BASE + 450.0 - pos.y) / max(sun.y, 0.05));
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
      // Molnen långt bort försvinner i diset
      c = applyFog(c, ro, rd, t);
      float alpha = 1.0 - exp(-den * dt * 0.045);
      sum += vec4(c * alpha, alpha) * (1.0 - sum.a);
    }
    t += dt;
  }
  return sum;
}

// --- Strålföljning ----------------------------------------------------------------------

int octFor(float t) {
  return t < 1500.0 ? 10 : t < 5000.0 ? 8 : t < 14000.0 ? 7 : 6;
}

float surface(vec2 p, float t) {
  return max(heightAt(p, octFor(t)), WATER);
}

// Avståndet till marken (eller sjöytan) längs strålen, -1 om den inte träffar
float march(vec3 ro, vec3 rd, float tmax, int steps, float minStep) {
  float t = 0.5;
  if (ro.y > uTop) {
    if (rd.y >= 0.0) return -1.0;
    t = (ro.y - uTop) / -rd.y;
  }
  float tPrev = t;
  for (int i = 0; i < steps; i++) {
    vec3 p = ro + rd * t;
    float dh = p.y - surface(p.xz, t);
    if (dh < 0.0) {
      // Gick igenom: halvera tillbaka till ytan
      float ta = tPrev, tb = t;
      for (int j = 0; j < 6; j++) {
        float tm = 0.5 * (ta + tb);
        vec3 q = ro + rd * tm;
        if (q.y - surface(q.xz, tm) < 0.0) tb = tm;
        else ta = tm;
      }
      return 0.5 * (ta + tb);
    }
    if (dh < 0.0007 * t) return t;
    if (t > tmax || (rd.y > 0.0 && p.y > uTop)) break;
    tPrev = t;
    t += max(0.45 * dh, minStep * t + 0.3);
  }
  return -1.0;
}

float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0;
  float t = 6.0;
  for (int i = 0; i < uShadowSteps; i++) {
    vec3 p = ro + rd * t;
    float h = p.y - heightAt(p.xz, 5);
    res = min(res, 10.0 * h / t);
    t += clamp(h, 8.0 + 0.03 * t, 800.0);
    if (res < 0.004 || p.y > uTop) break;
  }
  return smoothstep(0.0, 1.0, clamp(res, 0.0, 1.0));
}

vec3 normalAt(vec2 p, float t) {
  float e = max(0.6, 0.0015 * t);
  int oct = octFor(t) + 2;
  float hx = heightAt(p - vec2(e, 0.0), oct) - heightAt(p + vec2(e, 0.0), oct);
  float hz = heightAt(p - vec2(0.0, e), oct) - heightAt(p + vec2(0.0, e), oct);
  return normalize(vec3(hx, 2.0 * e, hz));
}

// --- Material ----------------------------------------------------------------------------

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

vec3 terrainShade(vec3 pos, vec3 nor, vec3 rd, float t, bool shadows) {
  vec3 sun = sunDir();
  vec2 p = pos.xz;
  float h = pos.y;
  float n1 = fbm(p * 0.0016, 3);
  float n2 = vnoise(p * 0.021);
  float n3 = vnoise(p * 0.19);
  float slope = nor.y;
  float flat_ = smoothstep(0.62, 0.86, slope + 0.08 * (n2 - 0.5));

  // Sten: grå med bruna stråk och mörkare ränder
  vec3 rock = mix(vec3(0.16, 0.155, 0.15), vec3(0.3, 0.285, 0.27), n2);
  rock = mix(rock, vec3(0.26, 0.21, 0.16), smoothstep(0.55, 0.8, n1) * 0.6);
  rock *= 0.8 + 0.4 * vnoise(vec2(p.x * 0.01, h * 0.06));
  // Ängar i dalen, fjällhed ovanför trädgränsen, myr på flacka partier
  vec3 meadow = mix(vec3(0.06, 0.085, 0.04), vec3(0.11, 0.125, 0.062), n2);
  meadow = mix(meadow, vec3(0.06, 0.08, 0.04), smoothstep(0.5, 0.8, vnoise(p * 0.11)) * 0.3);
  vec3 heath = mix(vec3(0.19, 0.17, 0.1), vec3(0.27, 0.24, 0.14), n2);
  float alpine = smoothstep(420.0, 850.0, h + 180.0 * (n1 - 0.5));
  vec3 veg = mix(meadow, heath, alpine);
  veg = mix(veg, vec3(0.25, 0.22, 0.12), (1.0 - alpine) * smoothstep(0.6, 0.72, n1) * 0.7);
  vec3 col = mix(rock, veg, flat_);
  // Skog: mörk gran med ljusare björkfläckar
  float forest = forestAt(p, h) * smoothstep(0.55, 0.75, slope);
  vec3 trees = mix(vec3(0.016, 0.03, 0.018), vec3(0.04, 0.062, 0.03), n3);
  trees = mix(trees, vec3(0.085, 0.11, 0.035), smoothstep(0.68, 0.85, vnoise(p * 0.012)) * 0.6);
  col = mix(col, trees, forest);
  // Strand närmast sjön, grus kring plattan
  float beach = smoothstep(0.9, 0.2, h - WATER) * (1.0 - forest);
  col = mix(col, vec3(0.24, 0.22, 0.17), beach * 0.8);
  if (uPad.z > 0.0) {
    float apron = 1.0 - smoothstep(uPad.z + 10.0, uPad.z + 35.0 + 15.0 * n2, length(p - uPad.xy));
    col = mix(col, mix(vec3(0.2, 0.19, 0.17), vec3(0.27, 0.25, 0.22), n3), apron);
  }
  // Snö: över snögränsen på allt som inte är för brant, högre upp även brantare
  float line = 1250.0 + 320.0 * (n1 - 0.5);
  float above = smoothstep(line - 120.0, line + 120.0, h);
  float hold = slope + 0.18 * (n2 - 0.5) + 0.08 * smoothstep(2500.0, 4500.0, h);
  float snow = above * smoothstep(0.5, 0.68, hold);
  col = mix(col, vec3(0.9, 0.93, 0.97), snow);
  col = padColor(p, col);

  // Ljus: sol med mjuka skuggor och molnskuggor, himmel, studs från marken
  float dif = clamp(dot(nor, sun), 0.0, 1.0);
  float sha = 1.0;
  if (shadows && dif > 0.001) sha = softShadow(pos + nor * 2.0, sun);
  sha *= cloudShadow(pos);
  float sky = clamp(0.5 + 0.5 * nor.y, 0.0, 1.0);
  float bou = clamp(0.3 - 0.7 * nor.y, 0.0, 1.0);
  // Skrymslen får mindre himmelsljus
  float occ = mix(0.55, 1.0, smoothstep(-0.2, 0.6, n3 * 0.4 + slope * 0.6)) * (1.0 - 0.35 * forest);
  vec3 skyAmb = mix(vec3(0.38, 0.52, 0.85), vec3(0.28, 0.33, 0.52), uDusk) * (1.0 - 0.3 * uThin);
  vec3 lin = dif * sha * sunColor() + sky * occ * skyAmb * 0.75 + bou * mix(vec3(0.25, 0.22, 0.16), vec3(0.3, 0.18, 0.1), uDusk) * 0.4;
  col *= lin;
  // Snön blänker i solen
  float spe = pow(clamp(dot(reflect(rd, nor), sun), 0.0, 1.0), 20.0);
  col += snow * spe * sha * sunColor() * 0.25;
  return col;
}

// Sjön: speglar fjällen och himlen, mörkt vatten rakt ned, små vågor
vec3 waterShade(vec3 pos, vec3 rd, float t) {
  vec3 sun = sunDir();
  vec2 w = pos.xz * vec2(0.012, 0.035) + vec2(uTime * 0.04, uTime * 0.015);
  float amp = 0.004 * (1.0 - smoothstep(300.0, 2000.0, t));
  vec3 nor = normalize(vec3((vnoise(w) - 0.5) * amp, 1.0, (vnoise(w * 1.9 + 4.3) - 0.5) * amp * 2.0));
  vec3 ref = reflect(rd, nor);
  ref.y = max(ref.y, 0.002);
  float fre = 0.02 + 0.98 * pow(1.0 - clamp(dot(-rd, nor), 0.0, 1.0), 5.0);
  vec3 ro = pos + vec3(0.0, 0.5, 0.0);
  float tr = march(ro, ref, 40000.0, uSteps / 2, 0.012);
  vec3 refl;
  if (tr > 0.0) {
    vec3 rp = ro + ref * tr;
    refl = terrainShade(rp, normalAt(rp.xz, tr + t), ref, tr, true);
    refl = applyFog(refl, ro, ref, tr);
  } else {
    refl = skyColor(ref);
  }
  vec4 cl = uClouds > 0.0 ? clouds(ro, ref, tr > 0.0 ? tr : 45000.0, uCloudSteps / 4, 0.5) : vec4(0.0);
  refl = refl * (1.0 - cl.a) + cl.rgb;
  vec3 deep = mix(vec3(0.012, 0.03, 0.035), vec3(0.03, 0.025, 0.04), uDusk);
  vec3 col = mix(deep, refl, fre);
  col += sunColor() * pow(max(dot(ref, sun), 0.0), 300.0) * 3.0 * fre;
  return col;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec3 rd = normalize(vec3((frag.x - uCenter.x) / uFocal, (uCenter.y - frag.y) / uFocal, 1.0));
  vec3 ro = uCam;
  const float tmax = 80000.0;

  float t = march(ro, rd, tmax, uSteps, 0.0012);
  vec3 col;
  float tHit = 1e5;
  if (t > 0.0) {
    tHit = t;
    vec3 pos = ro + rd * t;
    if (heightAt(pos.xz, 6) < WATER) col = waterShade(pos, rd, t);
    else col = terrainShade(pos, normalAt(pos.xz, t), rd, t, true);
    col = applyFog(col, ro, rd, t);
  } else {
    col = skyColor(rd);
  }
  // Gitter mot bandning i molnen (interleaved gradient noise, jämnare än vitt brus)
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec4 cl = uClouds > 0.0 ? clouds(ro, rd, tHit, uCloudSteps, ign) : vec4(0.0);
  col = col * (1.0 - cl.a) + cl.rgb;
  float disc = t > 0.0 ? 0.0 : clamp(sunDisc(rd), 0.0, 1.0) * (1.0 - cl.a);

  col = aces(col * mix(0.9, 1.05, uDusk));
  col = pow(col, vec3(1.0 / 2.2));
  col = mix(col, mix(vec3(1.0, 0.99, 0.95), vec3(1.0, 0.97, 0.86), uDusk), disc);
  // Lite mer mättnad, som ett foto
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = clamp(mix(vec3(luma), col, 1.12), 0.0, 1.0);
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

export class TerrainRenderer {
  /**
   * Skapar landskapet på en egen canvas. Shadern byggs i bakgrunden där webbläsaren
   * kan (KHR_parallel_shader_compile); tills den är klar är `ready` false och spelet
   * ritar det enklare landskapet i 2D.
   * @returns {TerrainRenderer|null} null om WebGL2 saknas
   */
  static create(canvas) {
    try {
      const gl = canvas.getContext('webgl2', { antialias: false, depth: false, alpha: false, preserveDrawingBuffer: true });
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
    this.parallel = gl.getExtension('KHR_parallel_shader_compile');
    const program = gl.createProgram();
    this.shaders = [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]].map(([type, src]) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
      return shader;
    });
    gl.linkProgram(program);
    this.program = program;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
  }

  /** Shadern är byggd och landskapet kan ritas. */
  get ready() {
    if (this.failed || this.lost) return false;
    if (!this.pending) return true;
    const { gl, program } = this;
    if (this.parallel && !gl.getProgramParameter(program, this.parallel.COMPLETION_STATUS_KHR)) return false;
    this.pending = false;
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = this.shaders.map((s) => gl.getShaderInfoLog(s)).join(' ') || gl.getProgramInfoLog(program);
      console.warn('[Ergcopter] 3D-landskapet går inte att bygga:', log);
      this.failed = true;
      return false;
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = Object.fromEntries(
      ['uRes', 'uScale', 'uCenter', 'uFocal', 'uCam', 'uTime', 'uDusk', 'uThin', 'uTop', 'uPeaks', 'uPeakBox', 'uPad', 'uSun', 'uClouds', 'uPeakCount', 'uSteps', 'uCloudSteps', 'uShadowSteps', 'uNoise'].map((n) => [
        n,
        gl.getUniformLocation(program, n),
      ])
    );
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
    gl.uniform1i(this.u.uNoise, 0);
  }

  /**
   * Ritar landskapet.
   * @param {object} v
   * @param {number} v.width, v.height  canvasens storlek i CSS-pixlar
   * @param {number} v.scale            upplösningen, målets pixlar per CSS-pixel
   * @param {number} v.cx, v.cy, v.focal  optiska mitten och brännvidden (CSS-pixlar)
   * @param {number} v.camX, v.camY     kamerans läge (m)
   * @param {number} v.dusk, v.thin, v.time
   * @param {{x:number, y:number}} [v.sun]  kvällssolens plats i bild, andel av bredd och höjd
   * @param {number} [v.clouds]         stackmolnen, 0 = klart, 1 = vanligt
   * @param {'high'|'low'} [v.quality]  antal steg i strålföljningen
   * @param {{x:number, z:number, h:number, r:number}[]} v.peaks
   * @param {{x:number, z:number, r:number}|null} v.pad
   */
  render(v, remember = true) {
    if (!this.ready) return;
    if (remember) this.lastView = v;
    const { gl, canvas, u } = this;
    const w = Math.max(1, Math.round(v.width * v.scale));
    const h = Math.max(1, Math.round(v.height * v.scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(u.uRes, w, h);
    gl.uniform1f(u.uScale, w / v.width);
    gl.uniform2f(u.uCenter, v.cx, v.cy);
    gl.uniform1f(u.uFocal, v.focal);
    gl.uniform3f(u.uCam, v.camX, v.camY, 0);
    gl.uniform1f(u.uTime, v.time);
    gl.uniform1f(u.uDusk, v.dusk);
    gl.uniform1f(u.uThin, v.thin);
    const peaks = new Float32Array(MAX_PEAKS * 4);
    let top = 3800; // fjällen når som högst ~3 750 m långt bort
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    (v.peaks ?? []).slice(0, MAX_PEAKS).forEach((p, i) => {
      peaks.set([p.x, p.z, p.h, p.r], i * 4);
      top = Math.max(top, p.h + 80);
      box[0] = Math.min(box[0], p.x - p.r);
      box[1] = Math.min(box[1], p.z - p.r);
      box[2] = Math.max(box[2], p.x + p.r);
      box[3] = Math.max(box[3], p.z + p.r);
    });
    gl.uniform1f(u.uTop, top);
    gl.uniform4fv(u.uPeaks, peaks);
    gl.uniform4f(u.uPeakBox, ...(box[0] < Infinity ? box : [0, 0, 0, 0]));
    gl.uniform3f(u.uPad, v.pad?.x ?? 0, v.pad?.z ?? 0, v.pad?.r ?? 0);
    gl.uniform2f(u.uSun, v.sun?.x ?? 0.86, v.sun?.y ?? 0.2);
    gl.uniform1f(u.uClouds, v.clouds ?? 1);
    gl.uniform1i(u.uPeakCount, Math.min(MAX_PEAKS, v.peaks?.length ?? 0));
    const q = QUALITY[v.quality ?? 'high'];
    gl.uniform1i(u.uSteps, q.steps);
    gl.uniform1i(u.uCloudSteps, q.cloudSteps);
    gl.uniform1i(u.uShadowSteps, q.shadowSteps);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Små bilder av landskapet, t.ex. till korten i Fjällräddaren-menyn. Ritas på samma
   * canvas som bakgrunden, som sedan ritas om direkt så att den inte hinner visa något annat.
   * @param {object[]} views  som till render(), med width, height och scale
   * @returns {HTMLCanvasElement[]|null}  null om landskapet inte är klart
   */
  snapshots(views) {
    if (!this.ready) return null;
    const shots = views.map((v) => {
      this.render(v, false);
      // Kopian i CSS-pixlar: ritad i högre upplösning och nedskalad blir kanterna mjuka
      const copy = document.createElement('canvas');
      copy.width = Math.round(v.width);
      copy.height = Math.round(v.height);
      copy.getContext('2d').drawImage(this.canvas, 0, 0, copy.width, copy.height);
      return copy;
    });
    if (this.lastView) this.render(this.lastView);
    return shots;
  }
}
