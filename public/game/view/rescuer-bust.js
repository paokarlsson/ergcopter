// Fjällräddaren på nära håll, uppe till höger i Fjällräddaren-menyn: räddaren sedd snett bakifrån över vänster axel,
// med blank hjälm och skidglasögon, röd skaljacka med fleecekrage och en mörk ryggsäck med remmar, spännen och ett
// rep. Figuren byggs av mjuka former (avståndsfält) och strålföljs i WebGL med samma låga, varma sol som i scenen,
// blå himmel som fyllnadsljus och mjuka skuggor. Bilden räknas fram en gång per storlek, i smala remsor över
// några bildrutor så att spelet inte hackar, och ligger sedan stilla (ingen kostnad per bildruta).

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Figurens egna enheter är meter: y uppåt, fötterna i y = 0, ansiktet mot −z och ryggen mot +z (kameran står bakom
// till vänster). Bilden mäts i canvasens höjd från högerkanten, så att figuren hamnar på samma ställe oavsett format.
const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform int uSamples;
out vec4 outColor;

const float PI = 3.14159265;
// Kameran: snett bakom räddarens vänstra axel, en aning ovanför
const vec3 LOOK = vec3(0.0, 1.66, 0.0);
const vec3 CAM = vec3(-1.78, 1.9, 1.72);
const float FOCAL = 1.36;           // brännvidd i canvashöjder
const vec2 LOOK_AT = vec2(-0.235, 0.86); // var LOOK hamnar: från högerkanten och nerifrån, i canvashöjder
// Huvudet vrids mot vänster, så att glasögonen syns i profil, och böjs lite framåt
const float HEAD_YAW = 1.2;
const float HEAD_PITCH = 0.12;
const vec3 NECK = vec3(0.0, 1.55, 0.0);

// Ljuset: låg kvällssol från vänster, snett framifrån; ett svalare motljus från höger; blå himmel ovanifrån
const vec3 SUN = normalize(vec3(-0.8, 0.55, -0.1));
const vec3 SUN_COL = vec3(3.6, 2.6, 1.75);
const vec3 RIM = normalize(vec3(0.85, 0.25, -0.45));
const vec3 RIM_COL = vec3(1.25, 1.0, 0.85);

// Material
const float M_JACKET = 1.0;
const float M_FLEECE = 2.0;
const float M_HELMET = 3.0;
const float M_TRIM = 4.0;
const float M_LENS = 5.0;
const float M_GOGFRAME = 6.0;
const float M_PACK = 7.0;
const float M_WEB = 8.0;
const float M_BUCKLE = 9.0;
const float M_ROPE = 10.0;
const float M_SKIN = 11.0;
const float M_DARK = 12.0;

// --- Brus ----------------------------------------------------------------------------------------------------

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
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}

// --- Former ----------------------------------------------------------------------------------------------------

float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}
float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a;
  float l2 = dot(ba, ba);
  float rr = r1 - r2;
  float a2 = l2 - rr * rr;
  float il2 = 1.0 / l2;
  vec3 pa = p - a;
  float y = dot(pa, ba);
  float z = y - l2;
  vec3 xv = pa * l2 - ba * y;
  float x2 = dot(xv, xv);
  float y2 = y * y * l2;
  float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
vec2 opU(vec2 a, vec2 b) { return a.x < b.x ? a : b; }

vec3 rotY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
}
// Punkt i huvudets egna koordinater (huvudet tittar mot −z innan det vrids)
vec3 headSpace(vec3 p) {
  vec3 q = rotY(p - NECK, HEAD_YAW);
  float c = cos(HEAD_PITCH);
  float s = sin(HEAD_PITCH);
  q = vec3(q.x, c * q.y + s * q.z, -s * q.y + c * q.z);
  return q + NECK;
}

// Hjälmen: ett äggformat skal som slutar högre fram än bak
const vec3 HELM_C = vec3(0.0, 1.70, 0.005);
const vec3 HELM_R = vec3(0.128, 0.118, 0.148);
float helmetCut(vec3 h) { return 1.664 - 0.29 * h.z - h.y; } // < 0 ovanför kanten

// Ryggsäcken
const vec3 PACK_C = vec3(0.025, 1.245, 0.25);
const vec3 PACK_B = vec3(0.18, 0.29, 0.105);

// Ventilationsspåren: tre längs hjässan och två snett bak på varje sida
float helmetVents(vec3 h) {
  vec3 hv = h - HELM_C;
  float vents = 1e3;
  for (int i = -1; i <= 1; i++) {
    float x = float(i) * 0.042;
    vec3 v = hv - vec3(x, 0.115 - abs(x) * 0.4, 0.0);
    vents = min(vents, sdRoundBox(v, vec3(0.009, 0.03, 0.045), 0.009));
  }
  vec3 a = vec3(abs(hv.x), hv.y, hv.z) - vec3(0.098, 0.05, 0.075);
  a = rotY(a, 0.6);
  vents = min(vents, sdRoundBox(a, vec3(0.03, 0.009, 0.022), 0.008));
  return vents;
}

float jacketFolds(vec3 q) {
  // Mjuka veck i tyget: lågfrekvent brus plus veck som drar snett från axelremmarna
  float n = noise(q * vec3(5.0, 3.0, 5.0)) - 0.5;
  // Veck: mjuka kullar med smala dalar, som tyg som spänns av remmarna
  float w = q.y * 24.0 + q.x * 13.0 + 3.5 * noise(q * 3.5);
  float crease = 1.0 - sqrt(abs(sin(w)));
  float big = noise(q * vec3(3.0, 6.0, 3.0) + 7.0) - 0.5; // stora, långa veck nedåt från axeln
  return 0.016 * n + 0.012 * big - 0.009 * crease * smoothstep(1.5, 1.3, q.y);
}

vec2 map(vec3 p) {
  // --- Kropp och jacka
  float torso = sdEllipsoid(p - vec3(0.0, 1.27, 0.0), vec3(0.2, 0.25, 0.135));
  torso = smin(torso, sdCapsule(p, vec3(-0.16, 1.41, 0.01), vec3(0.16, 1.41, 0.01), 0.088), 0.07);
  torso = smin(torso, sdEllipsoid(p - vec3(0.0, 1.02, 0.0), vec3(0.175, 0.2, 0.125)), 0.05);
  // Armarna hänger ner, lite framåt; ärmarna är vida och veckas vid armbågen
  float armL = sdRoundCone(p, vec3(-0.215, 1.395, 0.0), vec3(-0.262, 1.14, -0.025), 0.074, 0.062);
  armL = smin(armL, sdRoundCone(p, vec3(-0.262, 1.14, -0.025), vec3(-0.245, 0.93, -0.12), 0.062, 0.052), 0.02);
  float armR = sdRoundCone(p, vec3(0.215, 1.395, 0.0), vec3(0.262, 1.14, -0.025), 0.074, 0.062);
  armR = smin(armR, sdRoundCone(p, vec3(0.262, 1.14, -0.025), vec3(0.245, 0.93, -0.12), 0.062, 0.052), 0.02);
  float jacket = smin(torso, min(armL, armR), 0.035);
  float elbow = smoothstep(0.1, 0.0, abs(p.y - 1.14));
  // Vecken räknas bara nära ytan; längre bort räcker en försiktig gräns (de buktar högst 3 cm)
  if (jacket > 0.06) jacket -= 0.03;
  else jacket -= jacketFolds(p) + 0.004 * elbow * sin(p.y * 160.0 + 3.0 * noise(p * 20.0));
  vec2 res = vec2(jacket * 0.8, M_JACKET);
  // Varje del nedan räknas bara när en gränsvolym runt den ligger närmare än det som redan hittats
  if (length(p - vec3(0.0, 1.53, 0.02)) - 0.22 < res.x) {

  // Kragen: hög, vadderad och fodrad med fleece, med den nedrullade huvan bakom nacken
  vec3 c = p - vec3(0.0, 1.5, 0.0);
  float collar = length(vec2(length(c.xz * vec2(1.0, 0.92)) - 0.105, c.y * 0.9)) - 0.05;
  c.y -= 0.09;
  collar = smin(collar, length(vec2(length(c.xz * vec2(1.0, 0.92)) - 0.094, c.y * 0.75)) - 0.04, 0.04);
  collar = smin(collar, sdEllipsoid(p - vec3(0.0, 1.49, 0.1), vec3(0.14, 0.06, 0.07)), 0.035); // huvan bakom nacken
  // Kragen veckar sig där den viks runt halsen
  float cw = atan(p.x, p.z) * 5.0 + 2.5 * noise(p * 7.0) + p.y * 18.0;
  collar -= 0.01 * (noise(p * 9.0) - 0.5) - 0.016 * (1.0 - sqrt(abs(sin(cw)))) * smoothstep(0.25, 0.7, noise(p * 8.0 + 4.0));
  res = opU(res, vec2(collar * 0.85, M_FLEECE));
  }

  // Handskar och byxor: mörka
  if (p.y - 1.01 < res.x) {
  float glove = sdEllipsoid(p - vec3(-0.243, 0.88, -0.14), vec3(0.045, 0.06, 0.05));
  float pants = sdEllipsoid(p - vec3(0.0, 0.88, 0.0), vec3(0.17, 0.12, 0.12));
  pants = min(pants, sdRoundCone(p, vec3(-0.09, 0.85, 0.0), vec3(-0.1, 0.1, 0.02), 0.085, 0.06));
  pants = min(pants, sdRoundCone(p, vec3(0.09, 0.85, 0.0), vec3(0.11, 0.1, -0.03), 0.085, 0.06));
  res = opU(res, vec2(min(glove, pants), M_DARK));
  }

  // --- Huvudet
  if (length(p - vec3(0.0, 1.63, 0.0)) - 0.24 < res.x) {
  vec3 h = headSpace(p);
  float neck = sdCapsule(h, vec3(0.0, 1.47, 0.0), vec3(0.0, 1.6, -0.01), 0.056);
  float face = sdEllipsoid(h - vec3(0.0, 1.655, -0.02), vec3(0.083, 0.102, 0.098));
  float gaiter = sdEllipsoid(h - vec3(0.0, 1.6, -0.02), vec3(0.088, 0.07, 0.1));
  // Balaklavan täcker bakhuvudet under hjälmen och hakan; bara kinden vid glasögonen syns
  gaiter = min(gaiter, max(sdEllipsoid(h - vec3(0.0, 1.655, -0.015), vec3(0.089, 0.106, 0.104)), h.y - 1.655 + 0.25 * min(h.z + 0.06, 0.0)));
  res = opU(res, vec2(min(neck, gaiter), M_DARK));
  res = opU(res, vec2(face, M_SKIN));

  float shell = sdEllipsoid(h - HELM_C, HELM_R);
  float helmet = max(shell, helmetCut(h));
  // Kanten runt skalet är en tjockare, mörk list
  float rimD = max(abs(helmetCut(h)) - 0.012, shell - 0.006);
  rimD = max(rimD, -sdEllipsoid(h - HELM_C, HELM_R - 0.02));
  // Ventilationsspår i skalet
  helmet = max(helmet, -helmetVents(h));
  res = opU(res, vec2(helmet, M_HELMET));
  res = opU(res, vec2(rimD, M_TRIM));

  // Glasögonen: en böjd ram över ögonen, remmen runt hjälmens baksida
  float gy = h.y - 1.676;
  float gR = length((h.xz - vec2(0.0, -0.02)) / vec2(0.104, 0.12));
  float gog = max(abs(gR - 0.985) * 0.11 - 0.011, abs(gy + 0.004 * h.x) - 0.031);
  gog = max(gog, h.z + 0.015);
  gog -= 0.003;
  float strap = max(abs(shell - 0.004) - 0.0035, abs(gy - 0.004 + 0.08 * max(h.z, 0.0)) - 0.015);
  strap = max(strap, -h.z - 0.02);
  res = opU(res, vec2(gog, M_GOGFRAME));
  res = opU(res, vec2(strap, M_WEB));
  }

  // --- Ryggsäcken
  vec3 pk = p - PACK_C;
  if (sdRoundBox(pk - vec3(0.0, 0.06, 0.02), PACK_B + vec3(0.07, 0.11, 0.07), 0.0) < res.x) {
  float taper = 1.0 + 0.12 * clamp(-pk.y / PACK_B.y, -1.0, 1.0);
  float pack = sdRoundBox(pk * vec3(1.0 / taper, 1.0, 1.0), PACK_B, 0.07);
  pack = smin(pack, sdEllipsoid(p - vec3(0.025, 1.535, 0.23), vec3(0.175, 0.07, 0.12)), 0.04); // locket
  // Ficka nertill på baksidan
  pack = smin(pack, sdRoundBox(pk - vec3(-0.01, -0.13, PACK_B.z + 0.005), vec3(0.13, 0.1, 0.03), 0.028), 0.012);
  // Tyget buktar och veckas där remmarna drar åt
  pack -= 0.006 * (noise(p * vec3(6.0, 10.0, 6.0)) - 0.5);
  res = opU(res, vec2(pack * 0.9, M_PACK));

  // En rem över locket med ett spänne
  vec3 lq = p - vec3(-0.06, 1.535, 0.23);
  float lid = abs(sdEllipsoid(lq + vec3(-0.085, 0.0, 0.0), vec3(0.175, 0.07, 0.12))) - 0.003;
  lid = max(lid, abs(lq.x) - 0.014);
  lid = max(lid, -lq.z - 0.02);
  lid = max(lid, -lq.y - 0.01);
  float lidBuckle = sdRoundBox(lq - vec3(0.0, 0.03, 0.105), vec3(0.018, 0.024, 0.008), 0.005);
  // Bärhandtaget överst
  vec3 lp = p - vec3(0.085, 1.6, 0.25);
  float loopD = length(vec2(length(lp.xy) - 0.05, lp.z)) - 0.011;
  loopD = max(loopD, -lp.y + 0.005);
  // Kompressionsremmar runt säcken och spännen på dem
  float bandShell = abs(sdRoundBox(pk * vec3(1.0 / taper, 1.0, 1.0), PACK_B + 0.004, 0.07)) - 0.004;
  float bands = max(bandShell, abs(pk.y - 0.1) - 0.012);
  // Två lodräta remmar från locket över baksidan
  for (int i = 0; i < 2; i++) {
    float x = i == 0 ? -0.075 : 0.1;
    float vb = max(abs(pk.z - PACK_B.z - 0.006 - (pk.y < -0.03 ? 0.03 : 0.0)) - 0.0035, abs(pk.x - x) - 0.013);
    bands = min(bands, max(vb, abs(pk.y - 0.01) - 0.21));
  }
  float buckles = 1e3;
  for (int i = 0; i < 2; i++) {
    float x = i == 0 ? -0.075 : 0.1;
    buckles = min(buckles, sdRoundBox(pk - vec3(x, 0.18, PACK_B.z + 0.013), vec3(0.02, 0.026, 0.007), 0.005));
  }
  buckles = min(buckles, sdRoundBox(pk - vec3(0.02, 0.1, PACK_B.z + 0.012), vec3(0.026, 0.018, 0.007), 0.005));
  res = opU(res, vec2(min(min(loopD, bands), lid), M_WEB));
  res = opU(res, vec2(min(buckles, lidBuckle), M_BUCKLE));
  }
  // Axelremmarna över axlarna
  if (sdRoundBox(p - vec3(0.0, 1.39, 0.0), vec3(0.2, 0.13, 0.2), 0.0) < res.x) {
  float straps = 1e3;
  for (int s = -1; s <= 1; s += 2) {
    float x = float(s) * 0.13;
    vec3 a = vec3(x, 1.43, 0.16);
    vec3 b = vec3(x * 1.06, 1.488, 0.06);
    vec3 cc = vec3(x * 1.1, 1.462, -0.075);
    vec3 d = vec3(x * 1.08, 1.3, -0.16);
    vec3 sp = p;
    sp.x -= clamp(p.x - x, -0.024, 0.024); // platta, breda band: kapslar som dras ut i sidled
    float st = min(sdCapsule(sp, a, b, 0.011), min(sdCapsule(sp, b, cc, 0.011), sdCapsule(sp, cc, d, 0.01)));
    straps = min(straps, st);
  }
  res = opU(res, vec2(straps, M_WEB));
  }

  // Repet: en hoprullad bunt som är fastspänd på säckens baksida och sticker ut åt höger
  // Varven ligger som ovala öglor bredvid varandra, var och en lite förskjuten
  vec3 rp = p - vec3(0.17, 1.27, PACK_C.z + PACK_B.z + 0.025);
  if (length(rp) - 0.2 < res.x) {
  rp = rotY(rp, -0.5);
  float rope = 1e3;
  for (int i = 0; i < 6; i++) {
    float f = float(i);
    vec3 q = rp - vec3(0.004 * sin(f * 2.1), 0.006 * cos(f * 1.7), f * 0.011 - 0.03);
    float l = length(q.xy / vec2(0.085 + 0.003 * f, 0.15 + 0.002 * f));
    vec2 tq = vec2((l - 1.0) * 0.1, q.z);
    rope = min(rope, length(tq) - 0.0085);
  }
  res = opU(res, vec2(rope * 0.8, M_ROPE));
  }
  return res;
}

// --- Strålföljning ----------------------------------------------------------------------------------------------

vec2 boxHit(vec3 ro, vec3 rd, vec3 lo, vec3 hi) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (lo - ro) * inv;
  vec3 t1 = (hi - ro) * inv;
  vec3 a = min(t0, t1);
  vec3 b = max(t0, t1);
  return vec2(max(max(a.x, a.y), a.z), min(min(b.x, b.y), b.z));
}

vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(0.0007, -0.0007);
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0;
  float t = 0.01;
  for (int i = 0; i < 48; i++) {
    float h = map(ro + rd * t).x;
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.006, 0.08);
    if (res < 0.002 || t > 1.4) break;
  }
  return clamp(res, 0.0, 1.0);
}

float ambientOcclusion(vec3 p, vec3 n) {
  float occ = 0.0;
  float w = 1.0;
  for (int i = 1; i <= 5; i++) {
    float d = 0.012 * float(i * i);
    occ += w * (d - map(p + n * d).x);
    w *= 0.7;
  }
  return clamp(1.0 - 6.0 * occ, 0.0, 1.0);
}

// Himlen som speglas i hjälmen och glasögonen: blått ovanför, varmt dis mot horisonten, moln och solen
vec3 sky(vec3 d) {
  float y = d.y;
  vec3 zen = vec3(0.16, 0.34, 0.78);
  vec3 hor = vec3(0.95, 0.78, 0.6);
  vec3 col = mix(hor, zen, pow(clamp(y, 0.0, 1.0), 0.55));
  float cl = smoothstep(0.55, 0.85, fbm(vec3(d.xz / max(y + 0.25, 0.1) * 2.2, 1.3)));
  col = mix(col, vec3(1.2, 1.05, 0.92), cl * smoothstep(0.0, 0.18, y) * 0.8);
  col = mix(col, vec3(0.16, 0.13, 0.12), smoothstep(0.0, -0.12, y)); // marken och fjällen nedanför
  col += SUN_COL * 0.9 * pow(max(dot(d, SUN), 0.0), 900.0);
  col += SUN_COL * 0.12 * pow(max(dot(d, SUN), 0.0), 12.0);
  return col;
}

float ggx(vec3 n, vec3 h, float r) {
  float a = r * r;
  float a2 = a * a;
  float nh = max(dot(n, h), 0.0);
  float d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

// Bucklar i ytan (bump): normalen vrids längs brusets lutning
vec3 bump(vec3 p, vec3 n, float freq, float amp) {
  float e = 0.35 / freq;
  float c = noise(p * freq);
  vec3 g = vec3(noise((p + vec3(e, 0, 0)) * freq), noise((p + vec3(0, e, 0)) * freq), noise((p + vec3(0, 0, e)) * freq)) - c;
  g /= e * freq; // lutningen per brusvåg, så att amp blir en vinkel
  return normalize(n - amp * (g - n * dot(g, n)));
}

vec3 shade(vec3 p, vec3 rd, vec3 n, float m) {
  vec3 alb = vec3(0.5);
  float rough = 0.6;
  float f0 = 0.04;
  float sheen = 0.0;
  float coat = 0.0; // blank lack ovanpå
  vec3 tint = vec3(1.0);
  vec3 h = headSpace(p);

  if (m == M_JACKET) {
    alb = vec3(0.34, 0.02, 0.022);
    rough = 0.5;
    alb *= 0.88 + 0.24 * noise(p * 60.0);
    // Reflexband runt överarmen, som på räddningsjackor
    float tape = smoothstep(0.003, 0.0, abs(p.y - 1.215 + 0.06 * p.z) - 0.011) * step(0.17, abs(p.x));
    alb = mix(alb, vec3(0.55, 0.56, 0.58), tape);
    rough = mix(rough, 0.3, tape);
    sheen = 0.45;
    // Skaltygets krusiga yta
    n = bump(p, n, 45.0, 0.12);
    n = bump(p, n, 160.0, 0.04);
    // Söm vid axeloket och ett litet märke på vänster överarm
    float seam = smoothstep(0.004, 0.0, abs(p.y - 1.365 - 0.05 * p.z + 0.04 * abs(p.x)));
    alb *= 1.0 - 0.45 * seam;
    vec3 b = p - vec3(-0.27, 1.3, 0.025);
    float badge = step(abs(b.y), 0.022) * step(abs(b.z), 0.034) * step(p.x, -0.2);
    float badgeIn = step(abs(b.y), 0.016) * step(abs(b.z), 0.027);
    alb = mix(alb, mix(vec3(0.8, 0.82, 0.85), vec3(0.05, 0.45, 0.62), badgeIn * step(0.0, b.z)), badge);
    rough = mix(rough, 0.35, badge);
  } else if (m == M_FLEECE) {
    // Vadderad krage i samma tyg som jackan
    alb = vec3(0.4, 0.025, 0.025);
    rough = 0.75;
    sheen = 0.6;
    alb *= 0.85 + 0.3 * noise(p * 50.0);
    n = bump(p, n, 50.0, 0.12);
  } else if (m == M_HELMET) {
    // Svart blank kupol, ett rött band runt om och en mörk nedre kant, med en smal reflexlist mellan
    float top = smoothstep(1.748, 1.756, h.y - 0.2 * h.z);
    alb = mix(vec3(0.56, 0.026, 0.024), vec3(0.012, 0.012, 0.014), top);
    float stripe = smoothstep(0.0025, 0.0, abs(h.y - 0.2 * h.z - 1.743) - 0.003);
    alb = mix(alb, vec3(0.75, 0.76, 0.78), stripe);
    float low = smoothstep(1.704, 1.698, h.y + 0.22 * h.z);
    alb = mix(alb, vec3(0.025, 0.025, 0.03), low);
    alb = mix(alb, vec3(0.06, 0.06, 0.065), smoothstep(0.002, -0.001, helmetVents(h)));
    // Små repor i lacken
    rough = 0.22 + 0.15 * smoothstep(0.6, 0.9, noise(h * 90.0));
    coat = 1.0;
  } else if (m == M_TRIM) {
    alb = vec3(0.02, 0.02, 0.024);
    rough = 0.45;
  } else if (m == M_GOGFRAME) {
    // Ramen är mörk, glaset framtill speglar himlen i guld och blått
    float lens = smoothstep(0.025, 0.021, abs(h.y - 1.676)) * smoothstep(-0.03, -0.045, h.z);
    alb = mix(vec3(0.03, 0.03, 0.035), vec3(0.01, 0.008, 0.01), lens);
    rough = mix(0.5, 0.04, lens);
    f0 = mix(0.04, 0.7, lens);
    // Spegelglaset skiftar från blålila upptill till guld nertill
    tint = mix(vec3(1.0), mix(vec3(1.1, 0.55, 0.18), vec3(0.45, 0.4, 1.0), smoothstep(1.66, 1.695, h.y)), lens);
    coat = lens;
  } else if (m == M_PACK) {
    alb = vec3(0.012, 0.016, 0.032);
    rough = 0.75;
    sheen = 0.5;
    alb *= 0.8 + 0.4 * noise(p * 40.0);
    // Kantsömmar längs säckens lodräta hörn
    vec3 pq = p - PACK_C;
    float edge = smoothstep(0.004, 0.0, abs(abs(pq.x) - PACK_B.x + 0.012) - 0.002) * step(PACK_B.z - 0.03, pq.z);
    alb = mix(alb, vec3(0.3, 0.2, 0.1), edge * 0.7);
    // Väven i cordura-tyget och en ljus dragkedja runt locket
    float zip = smoothstep(0.005, 0.0, abs(p.y - 1.485 + 0.06 * (p.x - 0.025) * (p.x - 0.025)));
    alb = mix(alb, vec3(0.45, 0.3, 0.16), zip * 0.8); // ljus kantsöm runt locket
    // Dragkedjan på lockets ficka
    float lz = smoothstep(0.004, 0.0, abs(p.z - 0.29 - 0.25 * (p.y - 1.55)) - 0.002) * step(1.5, p.y) * step(abs(p.x - 0.03), 0.12);
    alb = mix(alb, vec3(0.08, 0.08, 0.09), lz);
    n = bump(p, n, 30.0, 0.1);
    n = bump(p, n, 140.0, 0.05);
  } else if (m == M_WEB) {
    alb = vec3(0.018, 0.018, 0.022);
    rough = 0.6;
    alb *= 0.8 + 0.4 * (0.5 + 0.5 * sin(dot(p, vec3(1.0)) * 1400.0));
  } else if (m == M_BUCKLE) {
    alb = vec3(0.05, 0.05, 0.055);
    rough = 0.25;
    coat = 0.4;
  } else if (m == M_ROPE) {
    // Repets snodda kardeler
    alb = vec3(0.6, 0.33, 0.1);
    vec3 rp = p - vec3(0.13, 1.2, 0.0);
    float a = atan(rp.y, rp.x);
    float tw = sin(a * 90.0 + rp.z * 260.0);
    alb *= 0.75 + 0.35 * tw;
    alb = mix(alb, vec3(0.12, 0.1, 0.09), smoothstep(0.92, 1.0, sin(a * 45.0 + 1.3)) * 0.6);
    rough = 0.8;
    sheen = 0.4;
    n = bump(p, n, 200.0, 0.25);
  } else if (m == M_SKIN) {
    alb = vec3(0.5, 0.27, 0.19);
    rough = 0.55;
  } else if (m == M_DARK) {
    alb = vec3(0.02, 0.02, 0.025);
    rough = 0.75;
  }

  vec3 v = -rd;
  float nv = max(dot(n, v), 0.0);
  float occ = ambientOcclusion(p, n);
  // Solen
  float nl = dot(n, SUN);
  float wrap = clamp((nl + 0.15 * sheen) / (1.0 + 0.15 * sheen), 0.0, 1.0);
  float sh = nl > -0.2 ? softShadow(p + n * 0.003, SUN) : 0.0;
  vec3 hs = normalize(SUN + v);
  float spec = ggx(n, hs, rough) * mix(f0, 1.0, pow(1.0 - max(dot(hs, v), 0.0), 5.0));
  vec3 col = alb * SUN_COL * wrap * sh + SUN_COL * spec * max(nl, 0.0) * sh * tint;
  // Motljuset från höger
  float nr = max(dot(n, RIM), 0.0);
  col += alb * RIM_COL * nr * 0.35 + RIM_COL * ggx(n, normalize(RIM + v), rough) * nr * 0.04 * tint;
  // Himlen och marken som fyllnadsljus
  vec3 skyFill = mix(vec3(0.16, 0.13, 0.11), vec3(0.42, 0.55, 0.85), 0.5 + 0.5 * n.y);
  col += alb * skyFill * occ * occ * 0.55;
  // Tygets glans i kanterna
  col += sheen * alb * pow(1.0 - nv, 3.0) * vec3(1.6, 1.2, 1.0) * occ;
  // Speglingen av himlen i blanka ytor
  vec3 r = reflect(rd, n);
  float fr = mix(f0, 1.0, pow(1.0 - nv, 5.0));
  // Bara de blanka ytorna (lacken, glaset) kollar om speglingen skyms; tyget nöjer sig med ocklusionen
  float envVis = mix(occ, 1.0, 0.3) * (coat > 0.0 && r.y > -0.1 ? mix(0.35, 1.0, softShadow(p + n * 0.004, r)) : 0.6);
  col += sky(r) * tint * envVis * (coat * fr * 1.1 + (1.0 - coat) * fr * (1.0 - rough) * (1.0 - rough) * 0.3);
  return col;
}

// Molnen bakom räddaren: stackmoln i två bankar, belysta ovanifrån till vänster, som tonar bort mot canvasens
// vänsterkant och ner mot panelerna. s mäts från högerkanten och nerifrån i canvashöjder, u är andelen av bredden.
float cloudDensity(vec2 s) {
  vec2 q = vec2(s.x * 4.5, s.y * 8.0);
  float bank = 0.75 * exp(-pow((s.y - 0.94) / 0.05, 2.0) - pow((s.x + 0.12) / 0.2, 2.0));
  bank += 0.62 * exp(-pow((s.y - 0.855) / 0.032, 2.0) - pow((s.x + 0.04) / 0.14, 2.0));
  bank += 0.45 * exp(-pow((s.y - 0.83) / 0.02, 2.0) - pow((s.x + 0.33) / 0.1, 2.0));
  return fbm(vec3(q, 0.7)) * 1.1 + bank - 0.86;
}
vec4 clouds(vec2 s, float u) {
  float d = cloudDensity(s);
  float dens = smoothstep(0.0, 0.22, d);
  if (dens <= 0.0) return vec4(0.0);
  // Ljust där molnet tunnas ut mot solen, grått och blått i undersidan
  float toward = cloudDensity(s + vec2(-0.012, 0.016));
  float lit = clamp(0.55 + (d - toward) * 5.0, 0.0, 1.0) * smoothstep(-0.05, 0.25, d - 0.1 * (0.9 - s.y));
  vec3 col = mix(vec3(0.6, 0.66, 0.78), vec3(1.0, 0.96, 0.9), lit);
  float a = dens * 0.95 * smoothstep(0.0, 0.4, u) * smoothstep(0.7, 0.78, s.y);
  return vec4(col * a, a);
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 fwd = normalize(LOOK - CAM);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 sum = vec3(0.0);
  float cover = 0.0;
  int n = uSamples * uSamples;
  for (int i = 0; i < n; i++) {
    vec2 o = (vec2(float(i % uSamples), float(i / uSamples)) + 0.5) / float(uSamples);
    vec2 fc = gl_FragCoord.xy - 0.5 + o;
    vec2 sp = vec2((fc.x - uRes.x) / uRes.y, fc.y / uRes.y) - LOOK_AT;
    vec3 rd = normalize(fwd * FOCAL + right * sp.x + up * sp.y);
    vec2 tb = boxHit(CAM, rd, vec3(-0.45, 0.0, -0.45), vec3(0.45, 1.86, 0.55));
    if (tb.y < max(tb.x, 0.0)) continue;
    float t = max(tb.x, 0.0);
    vec2 hit = vec2(1e3, 0.0);
    bool found = false;
    for (int k = 0; k < 200; k++) {
      hit = map(CAM + rd * t);
      if (hit.x < 0.0004 * t) { found = true; break; }
      t += hit.x;
      if (t > tb.y) break;
    }
    if (!found) continue;
    vec3 p = CAM + rd * t;
    vec3 nrm = calcNormal(p);
    vec3 c = shade(p, rd, nrm, hit.y);
    sum += aces(c * 0.95);
    cover += 1.0;
  }
  float fn = float(n);
  // Förmultiplicerad alfa: kanterna blandas mjukt mot bakgrunden
  vec4 fig = vec4(pow(sum / fn, vec3(1.0 / 2.2)) * pow(cover / fn, 1.0 - 1.0 / 2.2), cover / fn);
  vec2 px = gl_FragCoord.xy;
  vec4 sky = fig.a < 1.0 ? clouds(vec2((px.x - uRes.x) / uRes.y, px.y / uRes.y), px.x / uRes.x) : vec4(0.0);
  outColor = fig + (1.0 - fig.a) * sky;
}`;

/**
 * Ritar räddaren på en canvas och ritar om när storleken ändras. Bilden räknas i förväg redan när sidan laddas, i
 * den storlek canvasen får när menyn visas (se .career-figure i game.css), så att den är klar när menyn öppnas.
 * @param {HTMLCanvasElement|null} canvas
 */
export function mountRescuerBust(canvas) {
  if (!canvas) return;
  let shown = '';
  let job = null;
  const want = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    // Dold: samma mått som i game.css (30vw bred, hela höjden)
    const cssW = rect.width >= 2 ? rect.width : innerWidth * 0.3;
    const cssH = rect.height >= 2 ? rect.height : innerHeight;
    return [Math.round(cssW * dpr), Math.round(cssH * dpr)];
  };
  const start = () => {
    const [w, h] = want();
    const key = `${w}x${h}`;
    if (w < 2 || h < 2 || key === shown || job?.key === key) return;
    job?.cancel();
    job = renderBust(w, h, (image) => {
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(image, 0, 0);
      shown = key;
      job = null;
    });
    if (job) job.key = key;
  };
  let timer = 0;
  const later = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(start, ms);
  };
  new ResizeObserver(() => later(150)).observe(canvas);
  addEventListener('resize', () => later(300));
  later(200);
}

/**
 * Strålföljer figuren i en egen WebGL-kontext, några rader i taget per bildruta, och lämnar bilden till done.
 * @returns {{ cancel: () => void } | null}  null om WebGL2 saknas
 */
function renderBust(w, h, done) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const gl = c.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, alpha: true });
  if (!gl) return null;
  const par = gl.getExtension('KHR_parallel_shader_compile');
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, VERT);
  const fs = shader(gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  let cancelled = false;
  let row = 0;
  // Remsorna är så smala att varje bildruta bara får några millisekunder extra arbete på grafikkortet
  const stripH = Math.max(4, Math.round(8000 / w));
  const free = () => gl.getExtension('WEBGL_lose_context')?.loseContext();
  const step = () => {
    if (cancelled) return;
    if (row === 0) {
      if (par && !gl.getProgramParameter(prog, par.COMPLETION_STATUS_KHR)) return requestAnimationFrame(step);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('Räddaren (rescuer-bust):', gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(prog));
        return free();
      }
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), w, h);
      gl.uniform1i(gl.getUniformLocation(prog, 'uSamples'), 2);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.SCISSOR_TEST);
    }
    // Uppifrån och ner (WebGL räknar rader nerifrån)
    const y1 = h - row;
    const y0 = Math.max(0, y1 - stripH);
    gl.scissor(0, y0, w, y1 - y0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    row = h - y0;
    if (row < h) return requestAnimationFrame(step);
    done(c);
    free();
  };
  requestAnimationFrame(step);
  return {
    cancel() {
      cancelled = true;
      free();
    },
  };
}
