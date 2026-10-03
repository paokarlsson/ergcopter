// Fjällräddaren på nära håll, uppe till höger i Fjällräddaren-menyn: räddaren sedd snett bakifrån över vänster axel,
// med sliten klätterhjälm (blanklackad grafitkalott som speglar himlen, rött skal med ventiler, repor och en kort
// skärm, hakrem) och rökfärgade glasögon, balaklava och en buff, kinden synlig under glasögonen, röd skaljacka i
// skrynklig nylon med vadderad ståkrage, sömmar och förstärkta axlar, och en marinblå ryggsäck med bruna kantband,
// remmar, spännen och ett stort hoprullat rep. Figuren byggs av mjuka former (avståndsfält) och strålföljs i WebGL med
// en varm sol snett ovanifrån, blå himmel som fyllnadsljus, ett motljus längs konturen och mjuka skuggor. Bilden räknas
// fram en gång per storlek, i smala remsor över några bildrutor så att spelet inte hackar, och ligger sedan stilla
// (ingen kostnad per bildruta).

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
const vec3 CAM = vec3(-1.78, 1.74, 1.72);
const float FOCAL = 1.36;           // brännvidd i canvashöjder
const vec2 LOOK_AT = vec2(-0.235, 0.86); // var LOOK hamnar: från högerkanten och nerifrån, i canvashöjder
// Huvudet vrids mot vänster, så att glasögonen syns snett framifrån, och böjs lite framåt
const float HEAD_YAW = 1.05;
const float HEAD_PITCH = 0.12;
const vec3 NECK = vec3(0.0, 1.55, 0.0);

// Ljuset: varm sol snett ovanifrån bakom kamerans högra axel; ett varmt kantljus från vänster; blå himmel ovanifrån
const vec3 SUN = normalize(vec3(0.45, 0.62, 0.5));
const vec3 SUN_COL = vec3(4.0, 2.85, 1.9);
const vec3 RIM = normalize(vec3(-0.85, 0.3, -0.2));
const vec3 RIM_COL = vec3(2.4, 1.7, 1.15);
const vec3 BACK = normalize(vec3(0.75, 0.45, -0.5)); // motljuset bakom figuren, sett från kameran

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
const vec3 PACK_C = vec3(0.025, 1.235, 0.25);
const vec3 PACK_B = vec3(0.175, 0.27, 0.11);
const float PACK_R = 0.042; // kanternas rundning: en styv säck med tydliga hörn
// Locket: en platt, vadderad låda ovanpå säcken
const vec3 LID_C = vec3(0.025, 1.505, 0.25);
const vec3 LID_B = vec3(0.165, 0.038, 0.128);

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
  // Två större ventiler snett bak på varje sida, under silverkalotten
  vec3 sv = vec3(abs(hv.x), hv.y, hv.z) - vec3(0.075, 0.07, 0.1);
  sv = rotY(sv, 0.9);
  vents = min(vents, sdRoundBox(sv, vec3(0.026, 0.011, 0.02), 0.01));
  // En rad med tre sneda ventiler längs vardera sidan, där den ljusa kalotten möter det röda skalet
  for (int i = 0; i < 3; i++) {
    float z = -0.045 + float(i) * 0.048;
    vec3 sq = vec3(abs(hv.x), hv.y, hv.z) - vec3(0.108 - 0.12 * z * z, 0.064 - 0.07 * z, z);
    sq.yz = mat2(0.94, -0.34, 0.34, 0.94) * sq.yz;
    vents = min(vents, sdRoundBox(sq, vec3(0.03, 0.0075, 0.017), 0.006));
  }
  // Två avlånga spår i nackskyddet
  vec3 bq = vec3(abs(hv.x), hv.y, hv.z) - vec3(0.042, 0.03, 0.135);
  vents = min(vents, sdRoundBox(bq, vec3(0.024, 0.008, 0.03), 0.007));
  return vents;
}

// Glasögonens halva höjd: högst mitt fram och rundat ut mot tinningarna, där glaset slutar i en mjuk båge
float gogHalf(float a) { return 0.047 * sqrt(max(1.0 - pow(a / 1.4, 4.0), 0.0)); }

// Locket: en stoppad tygficka som buktar uppåt på mitten och hänger ner lite över säckens baksida
float lidShape(vec3 p) {
  vec3 q = p - LID_C;
  vec2 u = clamp(q.xz / LID_B.xz, -1.0, 1.0);
  // Mjukt kuddformad: tunn ut mot kanterna och tjock på mitten
  float bulge = 0.032 * sqrt(max((1.0 - u.x * u.x) * (1.0 - u.y * u.y), 0.0));
  q.y += 0.02 * smoothstep(0.2, 1.0, u.y) + 0.008 * smoothstep(0.5, 1.0, abs(u.x)); // bak- och sidokanterna sjunker
  float d = sdRoundBox(q - vec3(0.0, bulge * 0.4, 0.0), LID_B + vec3(0.0, bulge * 0.6 - 0.008, 0.0), 0.034);
  // Tyget veckas på tvären där remmarna drar ihop locket
  float near = smoothstep(0.045, 0.012, min(abs(q.x + 0.095), abs(q.x - 0.08)));
  float crease = 1.0 - sqrt(abs(sin(q.z * 55.0 + q.x * 20.0 + 2.0 * noise(p * 10.0))));
  return d - 0.003 * (noise(p * vec3(12.0, 6.0, 12.0)) - 0.5) + 0.004 * near * crease;
}

// Kragens avstånd från dess mittyta (negativt innanför): en ring som vidgas nertill mot axlarna
float collarR(vec3 p) {
  float r = 0.088 + 0.3 * max(1.53 - p.y, 0.0) + 0.006 * smoothstep(1.55, 1.59, p.y);
  return length((p.xz - vec2(0.0, 0.004)) * vec2(1.0, 0.92)) - r;
}

// Kanten på axelförstärkningen: positiv ovanför
float padEdge(vec3 p) {
  float ax = abs(p.x);
  return p.y - 1.448 - 0.45 * max(abs(p.z - 0.005) - 0.035, 0.0) + 0.3 * max(ax - 0.19, 0.0);
}
float shoulderPad(vec3 p) {
  return smoothstep(-0.0015, 0.0015, padEdge(p)) * step(0.1, abs(p.x));
}

// Jackans sömmar: raglansömmen från kragen snett ner mot armhålan, oksömmen tvärs över ryggen och sömmen runt
// axelns förstärkning. Värdet är avståndet till närmaste söm i meter.
float seamDist(vec3 p) {
  float ax = abs(p.x);
  float raglan = abs((p.y - 1.5) + 1.64 * (ax - 0.09)) / 1.92;
  raglan = max(raglan, 1.3 - p.y);
  float yoke = abs(p.y - 1.365 - 0.05 * p.z + 0.04 * ax);
  yoke = max(yoke, ax - 0.2);
  // Förstärkningen ovanpå axlarna, där remmarna skaver: en sadel från kragen ut över axelkulan
  float pad = max(abs(padEdge(p)) * 0.8, 0.1 - ax);
  return min(min(raglan, yoke), pad);
}

// Ett veck: mjuk kulle med en smal dal där sin(x) = 0. Dalen är lite avrundad, så att avståndsfältet inte får en
// spets som strålen kan kliva förbi.
float creaseWave(float x) {
  float s = sin(x);
  return 1.0 - sqrt(sqrt(s * s + 0.004));
}

float jacketFolds(vec3 q) {
  // Mjuka veck i tyget: lågfrekvent brus plus veck som drar snett från axelremmarna
  float n = noise(q * vec3(5.0, 3.0, 5.0)) - 0.5;
  // Veck: mjuka kullar med smala dalar, som tyg som spänns av remmarna
  float w = q.y * 19.0 + q.x * 15.0 * sign(q.x) + 7.0 * noise(q * 4.0);
  float crease = creaseWave(w) * smoothstep(0.3, 0.6, noise(q * 6.0 + 2.0));
  float big = noise(q * vec3(3.0, 6.0, 3.0) + 7.0) - 0.5; // stora, långa veck nedåt från axeln
  // Sömmarna drar in tyget i en smal fåra, och tyget puffar upp på båda sidor om den
  float sd = seamDist(q);
  float seam = -0.0028 * smoothstep(0.004, 0.0, sd) + 0.0016 * smoothstep(0.004, 0.008, sd) * smoothstep(0.02, 0.008, sd);
  // Tyget trycks ihop under axelremmarna och buktar ut längs deras kanter, med veck tvärs ut från remmen
  float sx = abs(abs(q.x) - 0.125 - 0.02 * smoothstep(0.0, -0.15, q.z));
  float onStrap = smoothstep(1.27, 1.32, q.y) * smoothstep(0.17, 0.14, q.z);
  float bulge = smoothstep(0.03, 0.04, sx) * smoothstep(0.065, 0.042, sx) * onStrap;
  float pull = creaseWave(q.y * 70.0 + sx * 40.0 + 2.0 * noise(q * 12.0)) * smoothstep(0.08, 0.035, sx) * onStrap;
  // Skrynklor i skaltyget: korta, sneda veck med skarpa dalar och mjuka kullar, i fläckar som bryts upp av brus
  float wv = q.y * 48.0 - q.x * 26.0 * sign(q.x) + 12.0 * noise(q * 5.0);
  float wrinkle = creaseWave(wv) * smoothstep(0.42, 0.75, noise(q * 7.0 + 4.0));
  return 0.009 * n + 0.009 * big - 0.011 * crease * smoothstep(1.52, 1.32, q.y) + seam + 0.006 * bulge - 0.005 * pull
    - 0.0045 * wrinkle;
}

vec2 map(vec3 p) {
  // --- Kropp och jacka
  // Axlarna ligger högt (ungefär 82 % av längden), med trapetsmuskeln som en mjuk sluttning upp mot kragen
  float torso = sdEllipsoid(p - vec3(0.0, 1.3, 0.0), vec3(0.205, 0.25, 0.135));
  torso = smin(torso, sdCapsule(p, vec3(-0.165, 1.452, 0.01), vec3(0.165, 1.452, 0.01), 0.088), 0.07);
  torso = smin(torso, sdRoundCone(p, vec3(-0.06, 1.485, 0.0), vec3(-0.16, 1.465, 0.01), 0.05, 0.075), 0.04);
  torso = smin(torso, sdRoundCone(p, vec3(0.06, 1.485, 0.0), vec3(0.16, 1.465, 0.01), 0.05, 0.075), 0.04);
  torso = smin(torso, sdEllipsoid(p - vec3(0.0, 1.04, 0.0), vec3(0.175, 0.2, 0.125)), 0.05);
  // Armarna hänger ner, lite framåt; ärmarna är vida och veckas vid armbågen
  float armL = sdRoundCone(p, vec3(-0.222, 1.43, 0.0), vec3(-0.265, 1.17, -0.025), 0.078, 0.064);
  armL = smin(armL, sdRoundCone(p, vec3(-0.265, 1.17, -0.025), vec3(-0.245, 0.95, -0.12), 0.064, 0.052), 0.02);
  float armR = sdRoundCone(p, vec3(0.222, 1.43, 0.0), vec3(0.265, 1.17, -0.025), 0.078, 0.064);
  armR = smin(armR, sdRoundCone(p, vec3(0.265, 1.17, -0.025), vec3(0.245, 0.95, -0.12), 0.064, 0.052), 0.02);
  float jacket = smin(torso, min(armL, armR), 0.035);
  float elbow = smoothstep(0.1, 0.0, abs(p.y - 1.17));
  // Vecken räknas bara nära ytan; längre bort räcker en försiktig gräns (de buktar högst 3 cm)
  if (jacket > 0.06) jacket -= 0.03;
  else jacket -= jacketFolds(p) + 0.004 * elbow * sin(p.y * 160.0 + 3.0 * noise(p * 20.0));
  vec2 res = vec2(jacket * 0.8, M_JACKET);
  // Varje del nedan räknas bara när en gränsvolym runt den ligger närmare än det som redan hittats
  if (length(p - vec3(0.0, 1.56, 0.03)) - 0.24 < res.x) {

  // Kragen: en hög, styv ståkrage runt halsen med en rundad överkant, vidare nertill där den går över i axlarna.
  // Den slutar under hjälmkanten, så att balaklavan syns i glipan.
  vec2 cq = vec2(collarR(p), p.y - 1.53);
  float collar = length(max(abs(cq) - vec2(0.01, 0.055), 0.0)) - 0.016;
  // Den vadderade överkanten: en tjock, rundad valk som vecklar sig runt halsen
  float lipY = 1.594 + 0.006 * sin(atan(p.x, p.z) * 3.0 + 1.0);
  collar = smin(collar, length(vec2(collarR(p) + 0.004, p.y - lipY) * vec2(0.9, 1.0)) - 0.026, 0.014);
  // Huvan: hoprullad i en tjock valk bakom nacken, under kragens kant
  vec3 hq = p - vec3(0.0, 1.535, 0.115);
  float hood = sdEllipsoid(hq, vec3(0.155, 0.06, 0.072));
  hood = smin(hood, sdEllipsoid(hq - vec3(0.0, 0.032, -0.03), vec3(0.125, 0.05, 0.06)), 0.025);
  collar = smin(collar, hood, 0.02);
  // Tyget: mjuka bucklor, några djupa veck i kragen och tvärgående veck där huvan rullats ihop
  float ca = atan(p.x, p.z);
  collar -= 0.011 * (noise(p * vec3(9.0, 16.0, 9.0)) - 0.5);
  // Några mjuka, sneda veck där kragen viks, och en fåra under den vadderade kanten
  collar += 0.009 * pow(1.0 - abs(sin(ca * 3.0 + p.y * 40.0 + 1.5 * noise(p * 4.0))), 4.0) * smoothstep(1.5, 1.56, p.y);
  collar += 0.004 * smoothstep(0.01, 0.0, abs(p.y - lipY + 0.024));
  collar += 0.013 * (1.0 - sqrt(abs(sin(hq.x * 30.0 + 2.5 * noise(p * 6.0))))) * smoothstep(0.09, 0.0, length(hq.yz));
  res = opU(res, vec2(collar * 0.8, M_FLEECE));
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
  float neck = sdCapsule(h, vec3(0.0, 1.47, 0.0), vec3(0.0, 1.6, -0.01), 0.063);
  // Ansiktet i profil: kind, käke och en näsa som sticker fram under glasögonen
  float face = sdEllipsoid(h - vec3(0.0, 1.655, -0.02), vec3(0.08, 0.1, 0.098));
  face = smin(face, sdEllipsoid(h - vec3(0.0, 1.6, -0.06), vec3(0.06, 0.04, 0.06)), 0.03); // käken
  face = smin(face, sdRoundCone(h, vec3(0.0, 1.652, -0.108), vec3(0.0, 1.622, -0.13), 0.009, 0.012), 0.012);
  // Buffen är uppdragen över näsan mot kylan och balaklavan täcker bakhuvudet och öronen. Bara en smal glipa hud
  // syns under glasögonen. Tyget ligger an mot ansiktet och veckas runt halsen.
  float gaiter = sdEllipsoid(h - vec3(0.0, 1.552, -0.03), vec3(0.08, 0.052, 0.094));
  float bal = sdEllipsoid(h - vec3(0.0, 1.655, -0.012), vec3(0.087, 0.106, 0.104));
  bal = smin(bal, face - 0.005, 0.012);
  float hole = max(h.z + 0.05 - 0.3 * (h.y - 1.62), max(1.605 - h.y, h.y - 1.72));
  bal = max(bal, -hole);
  gaiter = smin(gaiter, bal, 0.012);
  float ga0 = atan(h.x, -(h.z + 0.02));
  gaiter -= 0.0035 * creaseWave(h.y * 120.0 + 4.0 * ga0 + 2.0 * noise(h * 30.0)) * smoothstep(1.64, 1.56, h.y);
  res = opU(res, vec2(min(neck, gaiter) * 0.85, M_DARK));
  res = opU(res, vec2(face, M_SKIN));
  // Hakremmen: från hjälmkanten framför örat ner under käken, med ett spänne på sidan
  vec3 cs = vec3(abs(h.x), h.y, h.z);
  float chin = sdCapsule(cs, vec3(0.086, 1.668, -0.008), vec3(0.08, 1.596, -0.05), 0.0042);
  chin = min(chin, sdCapsule(cs, vec3(0.08, 1.596, -0.05), vec3(0.0, 1.562, -0.082), 0.0042));
  chin = min(chin, sdCapsule(cs, vec3(0.086, 1.668, -0.008), vec3(0.086, 1.66, 0.05), 0.0042));
  res = opU(res, vec2(chin, M_WEB));
  res = opU(res, vec2(sdRoundBox(h - vec3(-0.083, 1.61, -0.042), vec3(0.006, 0.011, 0.008), 0.003), M_BUCKLE));

  float shell = sdEllipsoid(h - HELM_C, HELM_R);
  // Två upphöjda åsar längs hjässan och en list runt nacken, så att skalet inte blir ett slätt ägg
  vec3 hr = h - HELM_C;
  float ribs = smoothstep(0.016, 0.004, abs(abs(hr.x) - 0.066)) * smoothstep(0.02, 0.07, hr.y);
  shell -= 0.0045 * ribs;
  float helmet = max(shell, helmetCut(h));
  // Skärmen fram: en kort, nedåtböjd läpp ovanför glasögonen
  vec3 pq = h - vec3(0.0, 1.722, -0.128);
  pq.y += 1.8 * pq.x * pq.x;
  helmet = smin(helmet, sdEllipsoid(pq, vec3(0.088, 0.011, 0.036)), 0.012);
  // Kanten runt skalet är en rundad, mörk list som följer snittet
  float rimD = length(vec2(helmetCut(h), shell + 0.003)) - 0.0055;
  // Ventilationsspår i skalet
  helmet = max(helmet, -helmetVents(h));
  res = opU(res, vec2(helmet, M_HELMET));
  res = opU(res, vec2(rimD, M_TRIM));
  // Justeringsratten i nacken, på hjälmens bärsele under kanten
  vec3 dq = h - vec3(0.0, 1.618, 0.128);
  float dial = max(length(dq.xy) - 0.021, abs(dq.z) - 0.009) - 0.003;
  dial = min(dial, sdRoundBox(dq - vec3(0.0, 0.0, -0.014), vec3(0.055, 0.012, 0.008), 0.005));
  res = opU(res, vec2(dial, M_BUCKLE));

  // Glasögonen: en böjd ram över ögonen som slutar vid tinningarna, och remmen som går runt hjälmens baksida
  float gy = h.y - 1.676;
  float gR = length((h.xz - vec2(0.0, -0.02)) / vec2(0.104, 0.12));
  float ga = abs(atan(h.x, -(h.z + 0.02))); // vinkeln från rakt fram
  float gog = max(abs(gR - 1.0) * 0.11 - 0.014, abs(gy) - gogHalf(ga));
  gog = max(gog, ga - 1.38);
  gog = max(gog, -gy - 0.041 + 0.02 * smoothstep(0.32, 0.0, ga)); // urtag för näsan
  gog -= 0.002;
  float strap = max(abs(shell - 0.0025) - 0.0025, abs(h.y - 1.676 - 0.03 * smoothstep(-0.02, 0.14, h.z)) - 0.014);
  strap = max(strap, 1.32 - ga);
  strap = max(strap, helmetCut(h) + 0.004);
  res = opU(res, vec2(gog, M_GOGFRAME));
  res = opU(res, vec2(strap, M_WEB));
  }

  // --- Ryggsäcken
  vec3 pk = p - PACK_C;
  if (sdRoundBox(pk - vec3(0.0, 0.06, 0.02), PACK_B + vec3(0.07, 0.11, 0.07), 0.0) < res.x) {
  float taper = 1.0 + 0.12 * clamp(-pk.y / PACK_B.y, -1.0, 1.0);
  // Säcken är fylld: sidorna och baksidan buktar ut mellan sömmarna, som en stoppad tygsäck
  vec2 pu = clamp(pk.xy / PACK_B.xy, -1.0, 1.0);
  float pillow = 0.007 * (1.0 - pu.x * pu.x) * (1.0 - pu.y * pu.y);
  float pack = sdRoundBox(pk * vec3(1.0 / taper, 1.0, 1.0), PACK_B - vec3(0.004, 0.0, 0.0), PACK_R) - pillow;
  pack = smin(pack, lidShape(p), 0.016); // locket
  // Ficka nertill på baksidan
  pack = smin(pack, sdRoundBox(pk - vec3(-0.01, -0.13, PACK_B.z + 0.005), vec3(0.13, 0.1, 0.03), 0.028), 0.012);
  // Tyget veckas där kompressionsremmen drar åt och buktar mellan remmarna
  float pinch = smoothstep(0.035, 0.0, abs(pk.y - 0.1));
  pack += 0.006 * pinch * (1.0 - sqrt(abs(sin(pk.x * 70.0 + 2.0 * noise(p * 8.0)))));
  pack -= 0.006 * (noise(p * vec3(7.0, 11.0, 7.0)) - 0.5);
  res = opU(res, vec2(pack * 0.85, M_PACK));

  // Två remmar över locket som spänns ner i spännen på säckens baksida och fortsätter nedåt
  float lidShell = abs(lidShape(p) - 0.003) - 0.0028;
  float bands = 1e3;
  float buckles = 1e3;
  for (int i = 0; i < 2; i++) {
    float x = i == 0 ? -0.07 : 0.105;
    float over = max(lidShell, abs(pk.x - x) - 0.013);
    over = max(over, max(-(p.z - LID_C.z) - 0.03, LID_C.y - 0.012 - p.y));
    float vb = max(abs(pk.z - PACK_B.z - pillow - 0.004 - (pk.y < -0.03 ? 0.03 : 0.0)) - 0.0032, abs(pk.x - x) - 0.012);
    bands = min(bands, min(over, max(vb, abs(pk.y + 0.02) - 0.2)));
    // Spänne: en platt hane och hona, med ett urtag i mitten
    vec3 bq = pk - vec3(x, 0.19, PACK_B.z + pillow + 0.012);
    float b = sdRoundBox(bq, vec3(0.019, 0.03, 0.0055), 0.004);
    b = max(b, -sdRoundBox(bq - vec3(0.0, 0.012, 0.006), vec3(0.01, 0.006, 0.004), 0.002));
    buckles = min(buckles, b);
  }
  // Kompressionsremmen runt säcken, med ett spänne på baksidan
  float bandShell = abs(sdRoundBox(pk * vec3(1.0 / taper, 1.0, 1.0), PACK_B + 0.004 - vec3(0.004, 0.0, 0.0), PACK_R) - pillow) - 0.0035;
  bands = min(bands, max(bandShell, abs(pk.y - 0.1) - 0.011));
  buckles = min(buckles, sdRoundBox(pk - vec3(0.015, 0.1, PACK_B.z + 0.012), vec3(0.026, 0.017, 0.006), 0.004));
  // Bärhandtaget överst: en platt bandögla
  vec3 lp = p - vec3(0.1, LID_C.y + LID_B.y + 0.022, 0.255);
  vec2 lr = vec2(length(lp.xy * vec2(0.85, 1.0)) - 0.046, lp.z);
  float loopD = length(max(abs(lr) - vec2(0.0035, 0.012), 0.0)) - 0.003;
  loopD = max(loopD, -lp.y + 0.005);
  // Lastjusteringsremmarna: från axelremmarnas topp upp till lockets hörn, med ett stegspänne
  float lifters = 1e3;
  for (int i = 0; i < 2; i++) {
    float sgn = i == 0 ? -1.0 : 1.0;
    vec3 a = vec3(0.128 * sgn, 1.535, 0.065);
    vec3 b = vec3(0.128 * sgn, 1.49, 0.145);
    vec3 pa = p - a;
    vec3 ba = b - a;
    float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    vec3 d = pa - ba * hh;
    lifters = min(lifters, length(max(abs(vec2(d.x, length(d.yz))) - vec2(0.011, 0.0), 0.0)) - 0.0025);
    buckles = min(buckles, sdRoundBox(p - mix(a, b, 0.35) - vec3(0.0, 0.004, 0.003), vec3(0.015, 0.006, 0.012), 0.003));
  }
  res = opU(res, vec2(min(min(loopD, bands), lifters), M_WEB));
  res = opU(res, vec2(buckles, M_BUCKLE));
  }
  // Axelremmarna: tjocka, vadderade band som ligger an mot axlarna (ett skal utanpå kroppen), från säcken fram
  // över bröstet. Kanterna är rundade och lite tunnare än mitten, som en stoppad rem.
  if (sdRoundBox(p - vec3(0.0, 1.42, 0.0), vec3(0.22, 0.17, 0.2), 0.0) < res.x) {
    float sx = abs(p.x) - 0.125 - 0.02 * smoothstep(0.0, -0.15, p.z);
    float sw = 0.033;
    float pad = 0.009 * sqrt(max(1.0 - (sx / sw) * (sx / sw), 0.0));
    float straps = max(abs(torso - 0.019 - pad * 0.5) - 0.002 - pad * 0.5, abs(sx) - sw);
    straps = max(straps, max(p.z - 0.16, 1.25 - p.y));
    straps = max(straps, -max(0.04 - p.z, p.y - 1.47)); // på ryggen går remmarna in i säcken
    res = opU(res, vec2(straps * 0.7, M_WEB));
  }

  // Repet: en stor hoprullad bunt som är fastspänd på säckens baksida, över högra halvan och ut över kanten.
  // Varven ligger som ovala öglor bredvid varandra, var och en lite förskjuten och vriden.
  vec3 rp = p - vec3(0.12, 1.33, PACK_C.z + PACK_B.z + 0.03);
  if (length(rp) - 0.27 < res.x) {
  rp = rotY(rp, -0.25);
  float rope = 1e3;
  for (int i = 0; i < 7; i++) {
    float f = float(i);
    vec3 q = rp - vec3(0.008 * sin(f * 2.1), 0.01 * cos(f * 1.7), f * 0.0105 - 0.035);
    float tilt = 0.06 * sin(f * 1.3);
    q.xy = vec2(q.x + tilt * q.y, q.y);
    float l = length(q.xy / vec2(0.105 + 0.004 * f, 0.19 + 0.003 * f));
    vec2 tq = vec2((l - 1.0) * 0.105, q.z);
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
  float specK = 1.0; // tyg glänser svagt och brett, inte som plast
  vec3 tint = vec3(1.0);
  vec3 h = headSpace(p);

  if (m == M_JACKET) {
    // Halvblank nylon: vecken fångar solen i mjuka glansränder
    alb = vec3(0.2, 0.009, 0.013);
    rough = 0.42;
    specK = 0.85;
    alb *= 0.88 + 0.24 * noise(p * 60.0);
    // Förstärkningen ovanpå axlarna i mörkgrå, slitstark väv
    float pad = shoulderPad(p);
    alb = mix(alb, vec3(0.1, 0.006, 0.01) * (0.85 + 0.3 * noise(p * 300.0)), pad);
    rough = mix(rough, 0.8, pad);
    // Reflexkant längs förstärkningen
    float piping = smoothstep(0.0028, 0.0012, abs(padEdge(p) - 0.004)) * step(0.105, abs(p.x));
    alb = mix(alb, vec3(0.5, 0.51, 0.53), piping);
    rough = mix(rough, 0.35, piping);
    // Sömmarna: en mörk fåra med dubbla stygnrader bredvid
    float sd = seamDist(p);
    alb *= 1.0 - 0.5 * smoothstep(0.0025, 0.0, sd);
    float stitch = smoothstep(0.0012, 0.0, abs(sd - 0.0055)) * step(0.5, fract(dot(p, vec3(1.0, 1.0, 1.0)) * 220.0));
    alb = mix(alb, alb * 1.7 + 0.01, stitch);
    // Reflexband runt överarmen, som på räddningsjackor
    float tape = smoothstep(0.003, 0.0, abs(p.y - 1.215 + 0.06 * p.z) - 0.011) * step(0.17, abs(p.x));
    alb = mix(alb, vec3(0.55, 0.56, 0.58), tape);
    rough = mix(rough, 0.3, tape);
    sheen = 0.45;
    // Skaltygets krusiga yta
    n = bump(p, n, 45.0, 0.12);
    n = bump(p, n, 160.0, 0.04);
    // Ett litet märke på vänster överarm
    vec3 b = p - vec3(-0.27, 1.3, 0.025);
    float badge = step(abs(b.y), 0.022) * step(abs(b.z), 0.034) * step(p.x, -0.2);
    float badgeIn = step(abs(b.y), 0.016) * step(abs(b.z), 0.027);
    alb = mix(alb, mix(vec3(0.8, 0.82, 0.85), vec3(0.05, 0.45, 0.62), badgeIn * step(0.0, b.z)), badge);
    rough = mix(rough, 0.35, badge);
    // Räddningsmärket på vänster skulderblad: en vit sköld med ett blått kors
    vec3 en = normalize(vec3(-0.55, 0.35, 0.75));
    vec3 eu = normalize(cross(vec3(0.0, 1.0, 0.0), en));
    vec3 ev = cross(en, eu);
    vec3 ed = p - vec3(-0.17, 1.43, 0.085);
    vec2 e2 = vec2(dot(ed, eu), dot(ed, ev));
    float shield = step(abs(dot(ed, en)), 0.06) * smoothstep(0.003, 0.0, length(max(abs(e2) - vec2(0.013, 0.011), 0.0)) - 0.006);
    float cross_ = step(min(abs(e2.x) - 0.005, abs(e2.y) - 0.005), 0.0) * step(max(abs(e2.x), abs(e2.y)), 0.011);
    alb = mix(alb, mix(vec3(0.62, 0.63, 0.64), vec3(0.03, 0.22, 0.5), cross_), shield);
    rough = mix(rough, 0.3, shield);
  } else if (m == M_FLEECE) {
    // Ståkragen i samma tyg som jackan, med grått fleecefoder på insidan
    alb = vec3(0.28, 0.02, 0.016);
    rough = 0.75;
    sheen = 0.5;
    alb *= 0.85 + 0.3 * noise(p * 50.0);
    float lining = smoothstep(-0.001, -0.006, collarR(p)) * smoothstep(1.545, 1.56, p.y);
    alb = mix(alb, vec3(0.05, 0.05, 0.055) * (0.8 + 0.4 * noise(p * 400.0)), lining);
    sheen = mix(sheen, 1.0, lining);
    specK = 0.45;
    // Dragkedjan till huvfickan längs valkens ovansida, med ett dragsnöre
    vec3 hq = p - vec3(0.0, 1.535, 0.115);
    float zy = hq.y - 0.03 + 0.25 * hq.x * hq.x;
    float zip = smoothstep(0.0028, 0.0012, abs(zy)) * step(0.0, hq.z) * step(abs(hq.x), 0.1);
    alb = mix(alb, vec3(0.025, 0.025, 0.03) * (0.7 + 0.6 * (0.5 + 0.5 * sin(hq.x * 1500.0))), zip);
    float puller = smoothstep(0.002, 0.0, max(abs(hq.x + 0.055) - 0.004, abs(zy + 0.01) - 0.012)) * step(0.0, hq.z);
    alb = mix(alb, vec3(0.03, 0.03, 0.035), puller);
    rough = mix(rough, 0.35, max(zip, puller));
    n = bump(p, n, 50.0, 0.12);
  } else if (m == M_HELMET) {
    // Klätterhjälm i lackad komposit: mörk grafitkalott med klarlack som speglar himlen, rött skal runt om och en
    // svart list mellan dem. Skalet är slitet: breda högdagrar i lacken, repor och nötta fläckar där färgen gått igenom.
    float top = smoothstep(1.754, 1.762, h.y - 0.22 * h.z);
    alb = mix(vec3(0.36, 0.022, 0.016), vec3(0.028, 0.03, 0.036), top);
    float stripe = smoothstep(0.0025, 0.0, abs(h.y - 0.22 * h.z - 1.749) - 0.0032);
    alb = mix(alb, vec3(0.012, 0.012, 0.014), stripe);
    float wear = noise(h * 28.0);
    rough = mix(0.36 + 0.12 * wear, 0.24 + 0.1 * wear, top);
    specK = 1.2;
    // Ventilationsspåren är svarta hål i skalet
    alb = mix(alb, vec3(0.006, 0.006, 0.008), smoothstep(0.004, -0.001, helmetVents(h)));
    // Repor och skrapmärken: tunna ljusa streck och nötta fläckar där färgen gått igenom
    float scratch = smoothstep(0.93, 0.99, 1.0 - abs(sin(dot(h, vec3(140.0, 60.0, 90.0)) + 6.0 * noise(h * 20.0))));
    scratch *= smoothstep(0.55, 0.75, noise(h * 35.0 + 3.0));
    float scuff = smoothstep(0.68, 0.82, fbm(h * 40.0));
    alb = mix(alb, mix(vec3(0.3, 0.26, 0.24), vec3(0.16, 0.16, 0.17), top), max(scratch * 0.6, scuff * 0.4));
    alb *= 0.9 + 0.2 * fbm(h * 18.0); // lacken är ojämnt blekt av solen
    rough = mix(rough, 0.8, max(scratch, scuff));
    n = bump(h, n, 70.0, 0.04);
    coat = mix(0.45, 0.85, top) * (1.0 - 0.8 * max(scratch, scuff));
  } else if (m == M_TRIM) {
    alb = vec3(0.02, 0.02, 0.024);
    rough = 0.45;
  } else if (m == M_GOGFRAME) {
    // Ramen är svart med en grå kant, glaset rökfärgat och speglar himlen och molnen
    float gy = h.y - 1.676;
    float ga = abs(atan(h.x, -(h.z + 0.02)));
    float edgeD = gogHalf(ga) - abs(gy);
    float lens = smoothstep(0.008, 0.0105, edgeD);
    lens *= smoothstep(0.0, 0.003, gy + 0.033 - 0.02 * smoothstep(0.32, 0.0, ga));
    float rim = smoothstep(0.0035, 0.0055, edgeD) * (1.0 - lens);
    alb = mix(vec3(0.015, 0.015, 0.018), vec3(0.003, 0.004, 0.006), lens);
    alb = mix(alb, vec3(0.55, 0.56, 0.58), rim * 0.8);
    rough = mix(mix(0.55, 0.25, rim), 0.03, lens);
    f0 = mix(0.04, 0.32, lens);
    // Rökfärgat glas med en svag spegelbeläggning: mörkt där det speglar marken, blått och ljust där det speglar
    // himlen. Glaset är välvt även på höjden, så att det speglar himlen överst och det solbelysta fjället nederst.
    tint = mix(vec3(1.0), mix(vec3(0.95, 0.62, 0.36), vec3(0.6, 0.72, 1.0), smoothstep(1.655, 1.7, h.y)), lens);
    n = normalize(mix(n, normalize(n + vec3(0.0, 1.0, 0.0) * clamp(gy / 0.04, -1.0, 1.0) * 0.9), lens));
    coat = lens;
  } else if (m == M_PACK) {
    // Mörkt marinblå cordura med en svag glans i väven; locket i en något ljusare blå
    vec3 lq = p - LID_C;
    float onLid = smoothstep(-0.05, -0.035, lq.y);
    alb = mix(vec3(0.005, 0.0075, 0.019), vec3(0.0075, 0.011, 0.025), onLid);
    rough = 0.55;
    sheen = 0.35;
    specK = 0.45;
    alb *= 0.75 + 0.5 * noise(p * 35.0);
    // Ljusgrå kantband längs säckens hörn och kanter, som på en tålig räddningsryggsäck
    vec3 pk = p - PACK_C;
    float taper = 1.0 + 0.12 * clamp(-pk.y / PACK_B.y, -1.0, 1.0);
    vec3 eq = abs(pk * vec3(1.0 / taper, 1.0, 1.0)) - (PACK_B - vec3(0.004, 0.0, 0.0) - PACK_R);
    float edgeXZ = step(0.0, min(eq.x, eq.z)) * smoothstep(0.005, 0.002, abs(eq.x - eq.z));
    float edgeYZ = step(0.0, min(eq.y, eq.z)) * smoothstep(0.005, 0.002, abs(eq.y - eq.z)) * step(pk.y, 0.0);
    float edgeXY = step(0.0, min(eq.x, eq.y)) * smoothstep(0.005, 0.002, abs(eq.x - eq.y)) * step(pk.y, 0.0);
    float body = 1.0 - onLid;
    // Fickan nertill på baksidan: kantband runt kanten och en dragkedja tvärs över
    vec3 fq = pk - vec3(-0.01, -0.13, PACK_B.z + 0.005);
    float pocketRim = smoothstep(0.004, 0.0015, abs(sdRoundBox(fq, vec3(0.13, 0.1, 0.03), 0.028))) * step(0.015, fq.z);
    float pocketZip = smoothstep(0.0035, 0.0015, abs(fq.y - 0.06)) * step(0.02, fq.z) * step(abs(fq.x), 0.1);
    float edges = max(max(edgeXZ, max(edgeYZ, edgeXY)) * body, pocketRim);
    alb = mix(alb, vec3(0.26, 0.17, 0.09), edges);
    alb = mix(alb, vec3(0.04, 0.04, 0.045) * (0.7 + 0.6 * (0.5 + 0.5 * sin(p.x * 1800.0))), pocketZip);
    rough = mix(rough, 0.45, max(edges, pocketZip));
    // Ripstop: ett svagt rutnät i väven
    vec2 rs = abs(fract(vec2(p.x + p.z, p.y + 0.5 * p.z) * 90.0) - 0.5);
    alb *= 1.0 + 0.18 * smoothstep(0.42, 0.5, max(rs.x, rs.y));
    // Kantband runt lockets sidor, strax under den rundade överkanten (följer bakkanten som sjunker)
    vec2 lu = clamp(lq.xz / LID_B.xz, -1.0, 1.0);
    float seamY = 0.014 - 0.02 * smoothstep(0.2, 1.0, lu.y) - 0.008 * smoothstep(0.5, 1.0, abs(lu.x));
    float pipe = smoothstep(0.0032, 0.0014, abs(lq.y - seamY)) * step(0.85, max(abs(lu.x), abs(lu.y)));
    alb = mix(alb, vec3(0.26, 0.17, 0.09), pipe * onLid);
    // Dragkedjan runt lockets baksida, med ett dragsnöre i rött
    float zip = smoothstep(0.003, 0.0, abs(lq.y + 0.008) - 0.003) * step(LID_B.z - 0.012, lq.z);
    float teeth = 0.5 + 0.5 * sin(p.x * 1800.0);
    alb = mix(alb, vec3(0.05, 0.05, 0.055) * (0.7 + 0.6 * teeth), zip);
    rough = mix(rough, 0.35, zip);
    vec3 zq = lq - vec3(0.075, -0.026, LID_B.z + 0.004);
    float puller = smoothstep(0.002, 0.0, max(abs(zq.x) - 0.004, abs(zq.y) - 0.018)) * step(LID_B.z - 0.02, lq.z);
    alb = mix(alb, vec3(0.6, 0.06, 0.05), puller);
    // Reflexmärke på lockets baksida: en silvergrå list med ett rött kors
    vec2 lg = vec2(lq.x - 0.015, lq.y + 0.004);
    float logo = smoothstep(0.002, 0.0, max(abs(lg.x) - 0.034, abs(lg.y) - 0.012)) * step(LID_B.z - 0.004, lq.z) * step(lq.y, 0.02);
    float rc = step(min(abs(lg.x + 0.022) - 0.0025, abs(lg.y) - 0.0025), 0.0) * step(max(abs(lg.x + 0.022), abs(lg.y)), 0.008);
    alb = mix(alb, mix(vec3(0.5, 0.52, 0.55), vec3(0.6, 0.04, 0.03), rc), logo);
    rough = mix(rough, 0.4, logo);
    sheen = mix(sheen, 0.0, logo);
    n = bump(p, n, 30.0, 0.12);
    n = bump(p, n, 140.0, 0.05);
  } else if (m == M_WEB) {
    alb = vec3(0.022, 0.023, 0.026);
    rough = 0.72;
    sheen = 0.3;
    specK = 0.3;
    alb *= 0.7 + 0.6 * (0.5 + 0.5 * sin(dot(p, vec3(1.0)) * 1400.0));
    // Glasögonremmen har ljusa kanter och ett tryckt mönster
    if (length(p - HELM_C) < 0.2) {
      float sy = abs(h.y - 1.676 - 0.03 * smoothstep(-0.02, 0.14, h.z));
      float edges = smoothstep(0.0025, 0.0, abs(sy - 0.011) - 0.0012);
      alb = mix(alb, vec3(0.13, 0.135, 0.145), edges);
    }
  } else if (m == M_BUCKLE) {
    alb = vec3(0.05, 0.05, 0.055);
    rough = 0.25;
    coat = 0.4;
  } else if (m == M_ROPE) {
    // Repets snodda kardeler
    alb = vec3(0.38, 0.21, 0.09);
    vec3 rp = p - vec3(0.13, 1.2, 0.0);
    float a = atan(rp.y, rp.x);
    float tw = sin(a * 90.0 + rp.z * 260.0);
    alb *= 0.75 + 0.35 * tw;
    alb = mix(alb, vec3(0.12, 0.1, 0.09), smoothstep(0.92, 1.0, sin(a * 45.0 + 1.3)) * 0.6);
    rough = 0.8;
    sheen = 0.4;
    n = bump(p, n, 200.0, 0.25);
  } else if (m == M_SKIN) {
    // Kinden är röd av kylan och skuggad under glasögonen, med lite skäggstubb mot käken
    alb = vec3(0.44, 0.21, 0.14) * (0.85 + 0.3 * noise(h * 120.0));
    alb = mix(alb, vec3(0.5, 0.15, 0.1), 0.35 * smoothstep(0.03, 0.0, abs(h.y - 1.62)));
    alb *= mix(1.0, 0.55 + 0.4 * noise(h * 600.0), smoothstep(1.615, 1.595, h.y));
    rough = 0.5;
    sheen = 0.6;
  } else if (m == M_DARK) {
    alb = vec3(0.02, 0.02, 0.025);
    rough = 0.75;
    // Balaklavan och buffen är stickade i mörkgrått: fina ränder och lite ludd
    if (p.y > 1.45) {
      alb = vec3(0.045, 0.045, 0.05) * (0.8 + 0.4 * fbm(p * 90.0));
      alb *= 0.75 + 0.5 * (0.5 + 0.5 * sin(p.y * 900.0 + 3.0 * noise(p * 60.0)));
      sheen = 0.6;
      n = bump(p, n, 300.0, 0.08);
    }
  }

  vec3 v = -rd;
  float nv = max(dot(n, v), 0.0);
  float occ = ambientOcclusion(p, n);
  // Solen
  float nl = dot(n, SUN);
  float wrap = clamp((nl + 0.45 * sheen) / (1.0 + 0.45 * sheen), 0.0, 1.0);
  float sh = nl > -0.35 ? softShadow(p + n * 0.003, SUN) : 0.0;
  vec3 hs = normalize(SUN + v);
  float spec = ggx(n, hs, rough) * mix(f0, 1.0, pow(1.0 - max(dot(hs, v), 0.0), 5.0));
  vec3 col = alb * SUN_COL * wrap * sh + SUN_COL * spec * specK * max(nl, 0.0) * sh * tint;
  // Det varma kantljuset från vänster
  float nr = max(dot(n, RIM), 0.0);
  col += alb * RIM_COL * nr * 0.35 + RIM_COL * ggx(n, normalize(RIM + v), rough) * nr * 0.04 * specK * tint;
  // Motljus: den ljusa himlen bakom figuren lägger en smal, ljus kant längs konturen, så att figuren hör ihop med
  // himlen i stället för att se urklippt ut. Kanten är varm där den vetter mot solen och kall uppåt mot himlen.
  float edge = pow(1.0 - nv, 3.0);
  float nb = clamp(dot(n, BACK) + 0.35, 0.0, 1.0);
  vec3 backCol = mix(vec3(0.55, 0.72, 1.05), vec3(1.5, 1.05, 0.7), clamp(dot(n, SUN) * 0.5 + 0.5, 0.0, 1.0));
  col += (alb * 2.2 + 0.05 * specK) * backCol * edge * nb * mix(occ, 1.0, 0.5);
  // Himlen och marken som fyllnadsljus: kallt blått ovanifrån, varmt och mörkt nerifrån, så att skuggorna blir blåaktiga
  vec3 skyFill = mix(vec3(0.13, 0.09, 0.07), vec3(0.36, 0.5, 0.9), smoothstep(-0.6, 0.9, n.y));
  col += alb * skyFill * occ * mix(occ, 1.0, 0.4) * 0.26;
  // Tygets glans i kanterna
  col += sheen * alb * pow(1.0 - nv, 3.0) * vec3(1.6, 1.2, 1.0) * occ;
  // Speglingen av himlen i blanka ytor
  vec3 r = reflect(rd, n);
  float fr = mix(f0, 1.0, pow(1.0 - nv, 5.0));
  // Bara de blanka ytorna (lacken, glaset) kollar om speglingen skyms; tyget nöjer sig med ocklusionen
  float envVis = mix(occ, 1.0, 0.3) * (coat > 0.0 && r.y > -0.1 ? mix(0.35, 1.0, softShadow(p + n * 0.004, r)) : 0.6);
  col += sky(r) * tint * envVis * (coat * fr * (m == M_GOGFRAME ? 0.9 : 1.5) + (1.0 - coat) * fr * (1.0 - rough) * (1.0 - rough) * 0.3);
  return col;
}

// Himlen och molnen bakom räddaren: klarblå himmel med stackmoln i två bankar, belysta ovanifrån till vänster.
// Allt tonar bort mot canvasens vänsterkant och ner mot panelerna, så att det smälter in i bakgrunden.
// s mäts från högerkanten och nerifrån i canvashöjder, u är andelen av bredden.
float cloudDensity(vec2 s) {
  vec2 q = vec2(s.x * 5.0, s.y * 9.0);
  float bank = 0.75 * exp(-pow((s.y - 0.935) / 0.045, 2.0) - pow((s.x + 0.1) / 0.17, 2.0));
  bank += 0.6 * exp(-pow((s.y - 0.84) / 0.03, 2.0) - pow((s.x + 0.03) / 0.12, 2.0));
  bank += 0.45 * exp(-pow((s.y - 0.82) / 0.02, 2.0) - pow((s.x + 0.33) / 0.1, 2.0));
  float n = fbm(vec3(q, 0.7)) + 0.12 * noise(vec3(q * 9.0, 2.0));
  return n * 1.15 + bank - 0.9;
}
vec4 clouds(vec2 s, float u) {
  float fade = smoothstep(0.0, 0.45, u) * smoothstep(0.66, 0.8, s.y);
  if (fade <= 0.0) return vec4(0.0);
  // Himlen: dämpat blå uppåt, ljus och lite varm i diset ner mot horisonten
  vec3 col = mix(vec3(0.8, 0.8, 0.8), vec3(0.4, 0.54, 0.74), smoothstep(0.7, 1.0, s.y));
  float d = cloudDensity(s);
  float dens = smoothstep(0.0, 0.1, d);
  if (dens > 0.0) {
    // Ljust och varmt där molnet tunnas ut mot solen, gråblått i undersidan och i vecken
    float toward = cloudDensity(s + vec2(-0.008, 0.012));
    float lit = clamp(0.6 + (d - toward) * 7.0, 0.0, 1.0);
    lit *= smoothstep(-0.05, 0.2, d - 0.12);
    vec3 cc = mix(vec3(0.66, 0.69, 0.76), vec3(1.0, 0.95, 0.88), lit);
    cc = mix(cc, vec3(1.0, 0.88, 0.74), 0.3 * smoothstep(0.08, 0.0, d)); // solbelysta, tunna kanter
    col = mix(col, cc, dens);
  }
  float a = fade * 0.85;
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
