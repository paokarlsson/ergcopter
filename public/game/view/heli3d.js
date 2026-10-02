// Räddningshelikoptern i 3D med WebGL2: en H135-liknande modell som byggs i koden
// (kabin, motorkåpa, stjärtbom, fenestron, stabilisator, medar och fyrbladig rotor).
// Lacken, rutorna och skarvarna ritas i fragment-shadern efter läget på kroppen, så att
// kanterna blir skarpa oavsett hur fint nätet är. Ljuset kommer från samma sol som i
// 3D-landskapet (terrain.js), med himmel ovanifrån och mark underifrån, blank lack och
// speglande glas. Rotorn är en skiva där bladen och rörelseoskärpan räknas ut per pixel.
//
// Ritas på en egen liten canvas utanför sidan, som render.js lägger in i 2D-scenen med
// drawImage. Då hamnar helikoptern i rätt lager mellan etiketter och ringar. Saknas
// WebGL2 ritar render.js den platta helikoptern från sidan (heli-draw.js) i stället.
//
// Modellens koordinater i meter: nosen mot +z, upp +y, medarnas undersida på y = 0.

const ROTOR_R = 5.1; // huvudrotorns radie (m)
const HUB = [0, 2.98, 0.15]; // rotornavet
const CENTER = [0, 1.55, -1.6];
const INTAKE_X = 0.5; // motorernas luftintag på var sida om masten // punkten som kameran tittar på och som render.js placerar
const SIZE_STEP = 64; // canvasens storlek avrundas uppåt, så att den inte byts varje bild
const MAX_DIM = 2400; // canvasens största sida i bildpunkter

const VERTEX = `#version 300 es
in vec3 aPos;
in vec3 aNor;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
out vec3 vW;
out vec3 vN;
out vec3 vObj;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = mat3(uModel) * aNor;
  vObj = aPos;
  gl_Position = uProj * uView * w;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vN;
in vec3 vObj;
uniform int uMat;       // 0 lack, 1 mörk metall, 2 rotorskivan, 3 ljus metall, 4 lampa, 5 medarna, 6 strålkastarglas
uniform vec3 uEye;
uniform vec3 uSun;      // riktning mot solen
uniform vec3 uSunCol;
uniform vec3 uSky;      // himlen ovanför (linjärt)
uniform vec3 uGround;   // marken under
uniform vec3 uBody;     // lackens grundfärg (linjärt)
uniform vec3 uAccent;   // dekorfärgen
uniform vec3 uTrim;
uniform float uDark;    // 1 = mörk dekorfärg: smala ränder i stället för breda fält
uniform float uLower;   // 1 = dekorfärgen bara nedtill, på nosen och stjärten (skolhelikoptern, livery.scheme 'lower')
uniform float uAngle;   // rotorns vinkel
uniform float uBlur;    // 0–1, rörelseoskärpa
uniform float uFill;    // skuggsidans ljus från himlen (mindre ger tydligare form i lågt solljus)
uniform float uWarm;    // 0–1: hovringen över den solbelysta plattan, som ger varmt återsken i skuggorna
uniform vec3 uGlow;     // lampornas färg (uMat 4)
uniform vec3 uRimDir;   // motljuset: riktning mot en andra, låg sol bakom helikoptern (startskärmen)
uniform vec3 uRimCol;   // och dess färg; svart = inget motljus
uniform float uWhite;   // 1 = vit kabin med röd bakdel, nos och stjärt (livery.scheme 'white', startskärmen)
uniform float uShine;   // 0–1: blank lack och glas som speglar kvällshimlen (startskärmens närbild)
uniform highp sampler2DShadow uShadowMap; // djupet sett från solen (skuggkartan)
uniform mat4 uLightVP;
out vec4 outColor;

// Andel solljus (1 = helt i sol). Mjuk kant: 3×3 jämförelser som hårdvaran filtrerar.
float sunlit(vec3 w, vec3 n) {
  vec4 lp = uLightVP * vec4(w + n * 0.05, 1.0);
  vec3 s = lp.xyz / lp.w * 0.5 + 0.5;
  if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
  vec2 texel = 1.0 / vec2(textureSize(uShadowMap, 0));
  float sum = 0.0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) sum += texture(uShadowMap, vec3(s.xy + vec2(i, j) * texel * 1.5, s.z - 0.0008));
  }
  return sum / 9.0;
}

const float PI = 3.14159265;

// 1 innanför (d < 0), mjuk kant en bildpunkt bred
float inside(float d) {
  float w = max(fwidth(d), 1e-4);
  return clamp(0.5 - d / w, 0.0, 1.0);
}
float line(float d, float halfWidth) {
  float w = max(fwidth(d), 1e-4);
  return 1.0 - smoothstep(halfWidth, halfWidth + w, abs(d));
}
float roundRect(vec2 p, vec2 c, vec2 h, float r) {
  vec2 q = abs(p - c) - h + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

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

// Omgivningen som lacken och glaset speglar: mörk dal, en skarp ljus horisont (den ger
// de långa glansstrecken längs kroppens rundningar) och blå himmel som mörknar uppåt.
vec3 envColor(vec3 r) {
  vec3 horizon = mix(uSky, vec3(1.0, 0.97, 0.92), 0.6) * 1.0;
  vec3 c = mix(uGround * 0.6, uGround, smoothstep(-0.9, -0.08, r.y));
  c = mix(c, horizon, smoothstep(-0.03, 0.03, r.y));
  c = mix(c, uSky * 0.6, smoothstep(0.04, 0.3, r.y));
  // Solen själv i speglingen, varm och mjukt utsmetad
  float s = max(dot(r, normalize(uSun)), 0.0);
  c += uSunCol * (pow(s, 48.0) * 0.6 + pow(s, 8.0) * 0.08);
  return c;
}

// Kvällshimlen som lacken och glaset speglar i närbilden (uShine): djupblå zenit, en varm horisont
// åt solnedgången (uRimDir), ljusa molnstråk strax ovanför den och mörka fjäll nedanför. Molnen och
// fjällkammen ger speglingen detaljer, så att rutorna och lacken läses som blanka ytor.
// detail 0–1: molnen och fjällkammen fullt ut (glaset) eller utsmetade (lacken, som är mindre slät)
vec3 skyEnv(vec3 r, float detail) {
  vec2 h = normalize(r.xz + vec2(1e-4));
  vec2 sd = normalize(uRimDir.xz + vec2(1e-4));
  float toward = pow(max(dot(h, sd), 0.0), 2.0);
  vec3 zen = vec3(0.09, 0.15, 0.34);
  vec3 hor = mix(vec3(0.55, 0.58, 0.78), vec3(1.7, 0.82, 0.42), toward);
  vec3 c = mix(hor, zen, smoothstep(0.0, 0.55, r.y));
  float up = max(r.y, 0.0);
  float cl = noise(vec3(h * 3.0 / (up + 0.25), 2.0)) * 0.7 + noise(vec3(h * 9.0 / (up + 0.25), 5.0)) * 0.3;
  c = mix(c, hor * 1.25 + vec3(0.1), smoothstep(0.55, 0.8, cl) * smoothstep(0.4, 0.06, r.y) * step(0.0, r.y) * 0.8 * detail);
  float az = atan(r.x, r.z);
  float ridge = 0.02 + 0.07 * noise(vec3(az * 6.0, 1.0, 0.0)) + 0.03 * noise(vec3(az * 21.0, 4.0, 0.0));
  vec3 below = mix(vec3(0.05, 0.05, 0.08), hor * 0.18, smoothstep(-0.5, 0.0, r.y));
  c = mix(c, below, mix(smoothstep(0.12, -0.25, r.y), inside((r.y - ridge) * 40.0), detail));
  c += uRimCol * 0.12 * pow(max(dot(r, normalize(uRimDir)), 0.0), 120.0);
  return c;
}

// Lackering, rutor och skarvar på kroppen. Returnerar färg och glans (a = 1 är glas).
vec4 livery(vec3 p, out float lines) {
  float z = p.z;
  float y = p.y;
  float ax = abs(p.x);
  lines = 0.0;
  vec3 col = uBody;
  // Kabinens sidor och stjärten i dekorfärgen, taket och motorkåpan i grundfärgen,
  // med en rand i grundfärgen längs kabinens nederkant
  float belt = 1.98 - 0.05 * smoothstep(0.5, 2.2, z);
  // Skolhelikoptern (uLower): vit kabin med dekorfärgen bara nedtill, på nosen och stjärten
  float sill = 0.95 + 0.05 * smoothstep(-1.5, 1.8, z);
  float lower = inside(y - mix(belt, sill, uLower)) * (1.0 - uWhite);
  // Skolhelikopterns nos är vit framtill, med dekorfärgen bara på sidorna under rutorna
  lower *= 1.0 - uLower * smoothstep(1.75, 2.25, z) * (1.0 - smoothstep(0.32, 0.58, ax));
  lines += line(y - sill, 0.008) * uLower * step(-2.15, z) * inside(z - 2.3);
  float tail = inside(z + 2.12);
  col = mix(col, uAccent, max(lower, tail));
  // Vita lackeringen: kabinens bakdel röd med en sned kant som lutar bakåt uppåt, och en smal röd rand
  float rearRed = z + 0.4 + 0.75 * (y - 0.9);
  col = mix(col, uAccent, inside(rearRed) * step(-2.15, z) * uWhite);
  lines += line(rearRed, 0.006) * step(-2.15, z) * step(y, 2.05) * uWhite;
  float redPin = inside(abs(y - 0.93 - 0.04 * sin(z * 0.8)) - 0.03) * step(-2.15, z) * inside(z - 2.3);
  col = mix(col, uAccent, redPin * uWhite);
  // (med mörk dekorfärg slutar randen före nosen, så att nosen och strålkastarna står rena)
  float bandZ = step(-2.15, z) * mix(1.0, inside(z - 2.0), uDark);
  bandZ *= (1.0 - uLower) * (1.0 - uWhite);
  float band = inside(abs(y - 0.86 - 0.04 * sin(z * 0.8)) - 0.07) * bandZ;
  col = mix(col, uTrim, band);
  lines += line(abs(y - 0.86 - 0.04 * sin(z * 0.8)) - 0.07, 0.006) * bandZ;
  // Vit rand längs bommen, som på räddningshelikoptrarna
  float boomStripe = inside(abs(y - (1.66 + (z + 2.0) * -0.03)) - 0.05) * inside(z + 2.6) * inside(-6.3 - z);
  col = mix(col, uTrim, boomStripe * step(0.1, ax));
  // Kåpans bakre del i dekorfärgen med sned kant och vit rand, så att stjärtens färg fortsätter upp
  float rearCowl = z + 0.75 + 1.1 * (y - 2.05);
  col = mix(col, uAccent, inside(rearCowl) * step(1.9, y));
  col = mix(col, uTrim, inside(abs(rearCowl - 0.12) - 0.04) * step(1.95, y) * inside(z - 0.2));
  // Nosen i dekorfärgen
  col = mix(col, uAccent, inside(2.38 - z) * inside(y - 1.02) * (1.0 - uLower));
  // Den vita lackeringens nos: hela noskonen under vindrutan i dekorfärgen
  col = mix(col, uAccent, inside(2.3 - z) * inside(y - 1.3) * uWhite);
  // Radomen mitt på nosen: en mörk, blank kåpa mellan strålkastarna, som går upp i vindrutans mitt
  float radome = roundRect(vec2(p.x, y), vec2(0.0, 0.98), vec2(0.14, 0.36), 0.11);
  // (den vita lackeringen har nosen i dekorfärgen, utan mörk radom)
  col = mix(col, mix(vec3(0.025, 0.027, 0.03), uAccent, uWhite), inside(radome) * step(2.4, z));
  lines += line(radome, 0.006) * step(2.4, z);
  // Strålkastarna sitter i mörka fördjupningar på var sida om radomen
  float pocket = roundRect(vec2(ax, y), vec2(0.3, 0.79), vec2(0.13, 0.1), 0.08);
  col = mix(col, vec3(0.05, 0.055, 0.06), inside(pocket) * step(2.35, z));
  lines += line(pocket, 0.006) * step(2.35, z);
  lines += line(y - belt, 0.01) * step(-2.15, z) * (1.0 - uLower);
  // Bred vit sida på kabinen som stiger lite bakåt; mitt bak är röd, som på räddningshelikoptrarna
  float swoosh = abs(y - 1.12 + 0.05 * z) - mix(0.27, 0.05, uDark);
  float sides = smoothstep(0.42, 0.62, ax) * step(-2.15, z) * inside(z - 2.45);
  col = mix(col, uTrim, inside(swoosh) * sides);
  lines += line(swoosh, 0.006) * sides * (1.0 - uLower) * (1.0 - uWhite);
  // Smal vit rand under bältet och en vit vinkel på bakdörrarna, som syns bakifrån
  float pin = inside(abs(y - belt + 0.17) - 0.035) * step(-2.15, z) * inside(z - 2.3) * (1.0 - uDark) * (1.0 - uLower) * (1.0 - uWhite);
  col = mix(col, uTrim, pin);
  float rearEnd = smoothstep(-1.55, -1.75, z) * step(-2.16, z);
  float chevron = abs(y - 1.0 - 0.62 * ax) - 0.075;
  col = mix(col, uTrim, inside(chevron) * rearEnd * inside(ax - 0.78));
  lines += line(chevron - 0.012, 0.006) * rearEnd * inside(ax - 0.78) * (1.0 - uLower);

  // Inga if-satser här: fwidth behöver samma väg för alla bildpunkter.
  float cabin = step(-1.75, z) * step(y, 2.12) * step(0.5, y);
  // Sidorutor: framdörr, skjutdörr och ett litet fönster bakom
  float side = step(0.35, ax) * cabin;
  float front = roundRect(vec2(z, y), vec2(1.05, 1.56), vec2(0.42, 0.34), 0.12);
  float slide = roundRect(vec2(z, y), vec2(0.05, 1.58), vec2(0.5, 0.32), 0.12);
  float rear = roundRect(vec2(z, y), vec2(-1.12, 1.62), vec2(0.28, 0.22), 0.1);
  // Den vita lackeringen (startskärmen): som på H135 två rader rutor i skjutdörren, stora upptill och
  // små nedtill, med breda vita stolpar emellan, och en mindre ruta i framdörren
  float wFront = roundRect(vec2(z, y), vec2(1.08, 1.6), vec2(0.38, 0.3), 0.12);
  float wUp = min(roundRect(vec2(z, y), vec2(0.36, 1.64), vec2(0.25, 0.27), 0.1), roundRect(vec2(z, y), vec2(-0.26, 1.64), vec2(0.25, 0.27), 0.1));
  float wLow = min(roundRect(vec2(z, y), vec2(0.36, 1.13), vec2(0.23, 0.14), 0.07), roundRect(vec2(z, y), vec2(-0.26, 1.13), vec2(0.23, 0.14), 0.07));
  float wRear = roundRect(vec2(z, y), vec2(-1.0, 1.64), vec2(0.22, 0.2), 0.08);
  float sideWin = mix(min(min(front, slide), rear), min(min(wFront, wUp), min(wLow, wRear)), uWhite);
  float glass = side * inside(sideWin);
  // Rutornas gummilist: en mörk kant runt varje ruta
  float seal = side * uWhite * inside(sideWin - 0.03) * (1.0 - inside(sideWin));
  // Vindrutan, delad i mitten, och de små rutorna i nosen
  // Vindrutan går upp i taket längst fram, som på H135. Nedtill slutar den i en båge över nosen,
  // som är lackerad med strålkastarna; runt rutorna en mörk ram och en bred mittstolpe.
  float wsLow = 1.3 + 0.16 * smoothstep(0.05, 0.6, ax);
  float wsTopD = y - 2.06 + (z - 1.62) * 0.55 * (1.0 - smoothstep(1.9, 2.3, z));
  float wsD = max(max(1.62 - z, wsLow - y), wsTopD);
  float ws = inside(wsD);
  float frame = inside(wsD - 0.035) * (1.0 - ws); // ramen runt rutorna
  float post = (line(p.x, 0.04) * ws + frame) * cabin; // mittstolpen och ramen, mörka
  ws *= 1.0 - line(p.x, 0.04);
  // Torkarna: ett tunt mörkt streck snett upp på var ruta
  float wiper = line(ax - 0.2 - (y - wsLow) * 0.35, 0.012) * step(y, wsLow + 0.42) * step(1.9, z);
  post = max(post, wiper * ws * cabin);
  ws *= 1.0 - wiper;
  lines += line(wsD - 0.035, 0.006) * cabin;
  glass = max(glass, ws * cabin);
  float chin = inside(roundRect(vec2(z, y), vec2(2.35, 0.78), vec2(0.28, 0.15), 0.08)) * step(0.12, ax);
  glass = max(glass, chin * cabin * (1.0 - uLower));
  // Dörrarnas skarvar
  float door = roundRect(vec2(z, y), vec2(0.05, 1.22), vec2(0.62, 0.78), 0.08);
  float fdoor = roundRect(vec2(z, y), vec2(1.12, 1.25), vec2(0.5, 0.75), 0.1);
  lines += (line(door, 0.008) + line(fdoor, 0.008)) * side;
  // Motorkåpan: luckor, galler och avgasrör bak
  float cowl = step(2.05, y) * step(z, 1.0) * step(-2.7, z);
  lines += (line(z + 0.95, 0.008) + line(z - 0.15, 0.008)) * cowl;
  float grille = inside(roundRect(vec2(z, y), vec2(-0.45, 2.3), vec2(0.32, 0.08), 0.03)) * step(0.3, ax) * cowl;
  col = mix(col, vec3(0.02), grille * (0.6 + 0.4 * step(0.5, fract(z * 30.0))));
  // Luftintagen ovanpå kåpan bakom masten, och skarven mitt på kåpan
  float intake = roundRect(vec2(ax, z), vec2(0.42, -0.5), vec2(0.07, 0.3), 0.06);
  col = mix(col, vec3(0.015, 0.017, 0.02), inside(intake) * step(2.25, y));
  lines += line(intake - 0.03, 0.008) * step(2.25, y);
  lines += line(p.x, 0.006) * step(2.3, y) * inside(-0.2 - z) * inside(z + 2.3);
  // Bakdörrarna (musselskal) i kabinens bakre ände
  float back = step(z, -1.7) * step(-2.15, z) * step(y, 1.62);
  // Två små rutor i bakdörrarna
  float rearWin = roundRect(vec2(ax, y), vec2(0.27, 1.36), vec2(0.15, 0.1), 0.06);
  glass = max(glass, inside(rearWin) * back);
  lines += (line(p.x, 0.008) + line(roundRect(vec2(p.x, y), vec2(0.0, 1.02), vec2(0.5, 0.52), 0.12), 0.008)) * back;
  // Skarvar på bommen
  lines += (line(z + 2.62, 0.01) + line(z + 4.6, 0.008)) * inside(-2.3 - z) * inside(z + 6.4);
  // Fenestron: det runda hålet i fenan med fläkten innanför
  float fin = step(z, -6.3) * step(0.06, ax);
  float fd = length(vec2(z + 7.0, y - 2.02));
  col = mix(col, vec3(0.03), inside(fd - 0.44) * fin);
  lines += line(fd - 0.47, 0.015) * fin;
  // Lite smuts: sot från avgaserna längs bommens ovansida och ojämn lack nertill
  float soot = smoothstep(1.9, 2.1, y) * inside(-2.4 - z) * inside(z + 4.5) * smoothstep(0.25, 0.7, noise(p * vec3(4.0, 4.0, 1.5)));
  col *= 1.0 - 0.35 * soot;
  col *= 0.94 + 0.06 * noise(p * 9.0);
  col *= 1.0 - 0.18 * smoothstep(0.75, 0.45, y) * noise(p * 3.0 + 7.0);
  col = mix(col, vec3(0.035, 0.038, 0.042), max(post, seal));
  // Bakom rutorna: mörk instrumentpanel nedtill, ljusare tak och bakre rutor högre upp
  // Instrumentbrädans skärm nedtill (mörk), ovanför den kabinens ljusare tak och de bakre rutorna
  vec3 interior = mix(vec3(0.015, 0.016, 0.02), vec3(0.11, 0.12, 0.13), smoothstep(1.45, 1.95, y));
  // Skärmarnas sken på instrumentbrädan
  interior += vec3(0.02, 0.05, 0.06) * inside(abs(ax - 0.33) - 0.1) * inside(abs(y - 1.42) - 0.04);
  // Piloterna bakom vindrutan: ljusa hjälmar och mörka axlar
  float helmet = inside(length(vec2(ax - 0.4, (y - 1.62) * 0.9)) - 0.1);
  float torso = inside(roundRect(vec2(ax, y), vec2(0.4, 1.3), vec2(0.21, 0.2), 0.1));
  float crew = ws * cabin;
  interior = mix(interior, vec3(0.03, 0.035, 0.045), torso * crew);
  // Hjälmarna: ljusa former bakom glaset med mörkt visir
  interior = mix(interior, vec3(0.2, 0.2, 0.19), helmet * crew);
  interior = mix(interior, vec3(0.01), inside(y - 1.6) * helmet * crew); // visiret
  // Närbilden: genom sidorutorna syns rutorna på andra sidan, ljusa av himlen, med stolsryggarnas
  // mörka siluetter framför dem
  vec3 dir = normalize(vW - uEye);
  float seats = inside(abs(fract((z - 0.25) / 0.85) - 0.5) * 0.85 - 0.1) * inside(y - 1.72);
  vec3 through = skyEnv(dir, 1.0) * 0.13 * smoothstep(1.35, 1.7, y) * (1.0 - 0.8 * seats);
  interior = mix(interior, interior * 0.6 + through, uShine * side * (1.0 - ws));
  col = mix(col, interior, glass);
  return vec4(col, glass);
}

// Ungefärlig skuggning i vinklar och skrymslen (ambient occlusion), räknad efter läget på
// modellen: magen och medarnas fästen, där bommen går in i kabinen, längs motorkåpans
// fot, runt masten och på medarnas tvärbommar under kroppen.
float occlusion(vec3 p, vec3 n) {
  float ax = abs(p.x);
  float ao = 1.0;
  if (uMat == 0) {
    ao *= mix(0.5, 1.0, smoothstep(0.3, 0.95, p.y)); // magen, mot medarna
    // Tvärbommarnas fästen under kabinen
    float strut = min(abs(p.z - 1.05), abs(p.z + 0.75));
    ao *= 1.0 - 0.45 * smoothstep(0.35, 0.0, strut) * smoothstep(0.85, 0.45, p.y);
    // Bommen där den går in i kabinens bakdel: en mörk krage runt bommen
    float junction = length(vec2(length(p.xy - vec2(0.0, 1.83)) - 0.28, p.z + 2.05));
    ao *= mix(0.45, 1.0, smoothstep(0.02, 0.55, junction));
    // Bommen under motorkåpans bakkant
    ao *= 1.0 - 0.35 * smoothstep(-3.2, -2.6, p.z) * smoothstep(-1.9, -2.3, p.z) * smoothstep(1.98, 1.8, p.y) * step(p.y, 2.0);
    // Vecket där motorkåpan sitter på kabintaket
    float crease = smoothstep(0.22, 0.0, abs(ax - 0.52)) * smoothstep(0.2, 0.0, abs(p.y - 2.17)) * step(-2.6, p.z) * step(p.z, 0.95);
    ao *= 1.0 - 0.5 * crease;
    // Runt masten ovanpå kåpan
    float mast = length(vec2(p.x, p.z - ${HUB[2].toFixed(2)}));
    ao *= mix(0.5, 1.0, clamp(smoothstep(0.12, 0.7, mast) + step(p.y, 2.2), 0.0, 1.0));
  } else if (uMat == 1 || uMat == 5) {
    // Medarnas tvärbommar och stöttor nära kroppen, masten nära kåpan
    ao *= 1.0 - 0.5 * smoothstep(0.25, 0.46, p.y) * step(p.y, 1.0) * smoothstep(1.2, 0.7, ax);
    ao *= mix(0.45, 1.0, clamp(smoothstep(2.3, 2.65, p.y) + step(0.25, length(p.xz - vec2(0.0, ${HUB[2].toFixed(2)}))), 0.0, 1.0));
  }
  // Ytor som vetter nedåt ser mindre av himlen
  return ao * mix(0.7, 1.0, smoothstep(-0.8, 0.2, n.y));
}

vec3 tonemap(vec3 x) {
  // ACES (Narkowicz)
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uEye - vW);
  // Insidan av öppna rör (avgasrören) syns från baksidan: vänd normalen och gör den mörk
  float inner = step(dot(N, V), -0.2);
  if (inner > 0.5) N = -N;
  vec3 L = normalize(uSun);
  vec3 Hh = normalize(L + V);
  float ndl = max(dot(N, L), 0.0);
  float nv = clamp(dot(N, V), 0.0, 1.0);
  vec3 amb = mix(uGround, uSky, N.y * 0.5 + 0.5);
  vec3 R = reflect(-V, N);

  if (uMat == 4) {
    outColor = vec4(uGlow, 1.0);
    return;
  }
  if (uMat == 6) {
    // Strålkastarnas glas: blankt och mörkt, med en krom reflektor bakom som fångar solen och
    // himlen, och bara en svag glöd i mitten (dagsljus: lamporna är tända men lyser inte upp)
    float Fl = 0.08 + 0.92 * pow(1.0 - nv, 4.0);
    vec3 c = envColor(R) * (0.35 + 0.65 * Fl) + uSunCol * pow(max(dot(N, Hh), 0.0), 300.0) * 2.5;
    c += uGlow * 0.08 * smoothstep(0.4, 0.95, nv);
    c = pow(tonemap(c * 0.5), vec3(1.0 / 2.2)); // dämpat: två ljusa prickar i den mörka nosen ser ut som ögon
    outColor = vec4(c, 1.0);
    return;
  }
  if (uMat == 2) {
    // Rotorskivan: fyra blad som svepts över en båge under exponeringen, som på ett foto.
    // En punkt på skivan täcks av bladet en andel av tiden: nära navet nästan hela tiden
    // (bladen syns tydligt), ute vid spetsarna bara en liten stund (skivan blir genomskinlig).
    vec2 q = vObj.xz;
    float r = length(q);
    if (r > ${ROTOR_R.toFixed(2)} || r < 0.22) discard;
    float phi = atan(q.y, q.x);
    float quarter = PI * 0.5;
    float chord = 0.1 * smoothstep(0.3, 1.1, r) + 0.045; // halva bladbredden (m), smalare vid roten
    float halfW = chord / r;
    // Svepet under exponeringen (rad). Kortare in mot navet: där är bladet brett i förhållande till
    // radien, och ett fullt svep blir en grå solfjäder kring navet i stället för fyra blad.
    float arc = mix(0.0, 0.32, uBlur) * smoothstep(1.2, 4.0, r);
    float px = length(fwidth(q)) / r; // en bildpunkt i radianer
    // d: vinkeln bakom bladets främre läge, 0 … quarter
    float d = mod(uAngle - phi + halfW + px, quarter) - halfW - px;
    // Täckningen: bladet [-halfW, halfW] svept över [0, arc], med mjuk kant en bildpunkt bred
    float lo = max(d - halfW, 0.0);
    float hi = min(d + halfW, arc);
    float swept = clamp((hi - lo + px) / max(arc + px, 1e-4), 0.0, 1.0) * step(-halfW - px, d) * step(d, arc + halfW + px);
    float sharp = 1.0 - smoothstep(halfW - px, halfW + px, abs(d));
    // Slutaren: mest ljus i början av svepet, så att bladets framkant syns och svansen tonar ut
    float fade = 1.0 - 0.75 * clamp(d / max(arc, 1e-3), 0.0, 1.0);
    float a = mix(sharp, swept * fade * 2.2, smoothstep(0.02, 0.25, uBlur));
    a = clamp(a, 0.0, 0.92);
    a = max(a, 0.06 * uBlur); // skivan syns svagt
    // Spetsarnas målade band blir en ljus ring när det går fort
    float tip = smoothstep(${(ROTOR_R - 0.42).toFixed(2)}, ${(ROTOR_R - 0.3).toFixed(2)}, r) * (1.0 - smoothstep(${(ROTOR_R - 0.12).toFixed(2)}, ${(ROTOR_R - 0.02).toFixed(2)}, r));
    a = max(a, tip * 0.07 * uBlur);
    a *= smoothstep(${ROTOR_R.toFixed(2)}, ${(ROTOR_R - 0.03).toFixed(2)}, r);
    // Bladen är mörkgrå men blanka: ovansidan speglar himlen, så de ses ljusa mot marken
    vec3 Nb = vec3(0.0, sign(dot(V, vec3(0.0, 1.0, 0.0)) + 1e-4), 0.0);
    vec3 blade = vec3(0.045, 0.048, 0.055);
    float bl = max(dot(Nb, L), 0.0);
    vec3 lit = blade * (amb * 0.6 + uSunCol * bl * 0.6);
    float spec = pow(max(dot(Nb, Hh), 0.0), 30.0) * 0.5;
    vec3 c = lit + uSunCol * spec * 0.1 + envColor(reflect(-V, Nb)) * 0.07;
    c = mix(c, vec3(0.9, 0.9, 0.86) * (amb + uSunCol * bl) * 0.6, tip * 0.7);
    c = pow(tonemap(c), vec3(1.0 / 2.2));
    outColor = vec4(c * a, a);
    return;
  }

  vec3 base;
  float gloss;
  float shin;
  float specK;
  float lines = 0.0;
  float glassAmt = 0.0;
  if (uMat == 0) {
    vec4 lv = livery(vObj, lines);
    glassAmt = lv.a;
    base = lv.rgb * mix(0.72, 1.0, lv.a); // lacken under full vithet, så att vitt får form i solen och inte bränns ut
    base *= mix(1.0, 0.86, uShine * (1.0 - lv.a)); // närbilden: lite utrymme för glansen och formen
    gloss = mix(0.7, 1.0, lv.a);
    shin = mix(45.0, 500.0, lv.a);
    specK = mix(1.1, 2.2, lv.a);
  } else if (uMat == 5) {
    // Medarna: grålackerade rör med blank yta, så att de får ljusa glansstrimmor
    base = vec3(0.035, 0.037, 0.042);
    gloss = 0.55;
    shin = 90.0;
    specK = 1.4;
  } else if (uMat == 1) {
    base = vec3(0.05, 0.053, 0.06);
    gloss = 0.6;
    shin = 70.0;
    specK = 0.9;
  } else {
    base = vec3(0.32, 0.33, 0.35);
    gloss = 0.5;
    shin = 60.0;
    specK = 0.8;
  }
  float ao = occlusion(vObj, N);
  float F = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
  float sh = sunlit(vW, N) * step(0.0, ndl);
  // Skuggsidan får himlens kalla blå ljus ovanifrån och lite grönt från dalen underifrån
  vec3 fill = mix(mix(uGround, uSky * 0.7, 0.45), uSky * 1.1, smoothstep(-0.6, 0.8, N.y));
  // Över plattan: varmt återsken från hällen i skuggorna, så att de blir gyllene i stället för blågrå
  fill = mix(fill, uGround * 1.6, uWarm * 0.45 * smoothstep(0.7, -0.3, N.y));
  // Närbilden: tydligare form, ljus ovansida och mörk mage
  fill *= mix(1.0, 0.55 + 1.25 * smoothstep(-0.7, 0.9, N.y), uShine);
  // och magen får ett varmt återsken från de solbelysta molnen under, i stället för att bli smutsgrå
  fill += uShine * vec3(0.55, 0.3, 0.17) * smoothstep(0.1, -0.9, N.y);
  // Bakom tonat glas når solen knappt in: kabinens insida ska inte lysa grå genom rutorna
  vec3 diffuse = base * (fill * uFill * ao + uSunCol * ndl * sh * mix(0.6, 1.0, ao)) * (1.0 - 0.8 * glassAmt);
  vec3 spec = uSunCol * pow(max(dot(N, Hh), 0.0), shin) * specK * (0.3 + 0.7 * ndl) * sh;
  // Klarlacken: en liten, skarp glansdager ovanpå
  spec += uSunCol * pow(max(dot(N, Hh), 0.0), 900.0) * (uMat == 0 ? 3.0 : 0.6) * step(0.0, ndl) * sh;
  // Klarlacken och glaset speglar omgivningen; glaset mycket mer, och mest i flack vinkel
  // Rutorna är djupt tonade: rakt framifrån speglar de lite, i flack vinkel mycket (Fresnel)
  // Lacken speglar måttligt även i flack vinkel, annars blir konturen en ljus kant runt hela kroppen
  float coat = uMat == 0 ? mix(0.035, 0.16, glassAmt) + F * mix(0.55, 1.3, glassAmt) : 0.03 + F * (uMat == 5 ? 0.25 : 0.45);
  // Rutorna är tonade: de speglar en mörk dal nedtill och himlen upptill, inte den ljusa horisonten,
  // så att vindrutan läses som glas framifrån
  vec3 env = envColor(R);
  vec3 glassEnv = mix(uGround * 0.15, mix(uSky, vec3(0.95, 0.97, 1.0), 0.35) * 0.9, smoothstep(0.0, 0.5, R.y)) + uSunCol * pow(max(dot(R, normalize(uSun)), 0.0), 60.0) * 0.8;
  // Fjällen speglas strax ovanför horisonten: en taggig blågrå kam med snö på topparna
  float az = atan(R.x, R.z);
  float ridge = 0.03 + 0.09 * noise(vec3(az * 7.0, 0.0, 0.0)) + 0.04 * noise(vec3(az * 23.0, 3.0, 0.0));
  float mtn = inside((R.y - ridge) * 60.0) * step(0.0, R.y);
  glassEnv = mix(glassEnv, mix(uSky * 0.45, vec3(0.75, 0.78, 0.85), smoothstep(ridge - 0.03, ridge, R.y)), mtn);
  // Horisonten som ett ljust streck över rutorna: det som gör att de läses som böjt glas
  glassEnv += mix(uSky, vec3(1.0), 0.6) * 1.1 * exp(-abs(R.y - 0.03) * 40.0);
  env = mix(env, glassEnv, glassAmt);
  // Närbilden: lacken och glaset speglar kvällshimlen, glaset kraftigt i flack vinkel
  env = mix(env, skyEnv(R, glassAmt), uShine);
  coat += uShine * (uMat == 0 ? mix(0.04 + F * 0.35, 0.05 + 0.55 * pow(1.0 - nv, 3.0), glassAmt) : 0.05);
  vec3 refl = env * coat * gloss * mix(0.35, 1.0, ao);
  // Närbilden: medarna och masten är svartlackerade, inte grå av speglad himmel
  refl *= 1.0 - 0.6 * uShine * float(uMat != 0);
  refl *= 1.0 - 0.5 * uShine * clamp((base.r - base.g) * 3.0, 0.0, 1.0) * (1.0 - glassAmt);
  // Kantljus: solen strålar över rundningarna där ytan vänder sig bort från kameran, varmt på
  // solsidan, så att konturen lyfter från bakgrunden i stället för att se urklippt ut
  float rimK = pow(1.0 - nv, 3.0) * smoothstep(-0.25, 0.5, dot(N, L)) * (1.0 - glassAmt) * (uMat == 0 ? 1.0 : 0.15);
  vec3 c = (diffuse + spec + refl + uSunCol * rimK * 0.22 * mix(0.4, 1.0, sh) * ao) * (1.0 - 0.85 * inner);
  // Motljuset: kvällssolen bakom helikoptern lägger en varm kant längs konturen och en glans på glaset
  float back = max(dot(N, uRimDir), 0.0);
  c += uRimCol * (pow(1.0 - nv, 2.5) * back * mix(1.0, 0.5, glassAmt) + pow(max(dot(R, uRimDir), 0.0), 40.0) * glassAmt * 0.6)
    * ao * (1.0 - 0.85 * inner) * (uMat == 2 ? 0.0 : 1.0);
  // Närbilden: rutorna är djupt tonat glas. Rakt framifrån syns bara en mörk kabin, i flack vinkel
  // speglar de kvällshimlen helt (Fresnel), med solens skarpa glans ovanpå.
  if (uMat == 0) {
    vec3 sky = skyEnv(R, glassAmt);
    float Fg = 0.04 + 0.45 * pow(1.0 - nv, 4.0);
    vec3 cg = c * 0.12 * (1.0 - Fg) + sky * Fg * 0.8 + uSunCol * pow(max(dot(N, Hh), 0.0), 600.0) * 4.0 * sh;
    c = mix(c, cg, uShine * glassAmt);
    // Klarlacken: kvällshimlen speglas i lacken, tydligast i flack vinkel och på rundningarna
    // (dämpat på den röda lacken, så att den förblir djupt röd och inte blir rosa av himlen)
    // Lacken speglar som en bil: ljus himmel ovanför horisonten och mörk dal under den, med en skarp
    // horisontlinje tvärs över rundningarna. Det är den som gör att lacken läses som blank.
    float red = clamp((base.r - base.g) * 3.0, 0.0, 1.0);
    vec3 paintSky = skyEnv(R, 0.7) * 1.15;
    float Fp = (0.07 + 0.55 * pow(1.0 - nv, 4.0)) * ao * uShine * (1.0 - glassAmt) * (1.0 - 0.5 * red);
    c = mix(c, paintSky, Fp);
    // och kvällssolen bakom ger en varm glansdager på nosen och kanterna som vetter mot den
    c += uRimCol * pow(max(dot(N, normalize(uRimDir + V)), 0.0), 40.0) * 0.35 * ao * uShine * (1.0 - glassAmt);
  }
  // (i närbilden är skarvarna tunnare streck i lacken, inte svarta konturer)
  c *= 1.0 - mix(0.75, 0.5, uShine) * clamp(lines, 0.0, 1.0);
  c = pow(tonemap(c), vec3(1.0 / 2.2));
  outColor = vec4(c, 1.0);
}`;

// Skuggkartan: bara djupet, sett från solen
const DEPTH_VERTEX = `#version 300 es
in vec3 aPos;
uniform mat4 uLightVP;
uniform mat4 uModel;
void main() {
  gl_Position = uLightVP * uModel * vec4(aPos, 1.0);
}`;
const DEPTH_FRAGMENT = `#version 300 es
precision mediump float;
void main() {}`;
const SHADOW_SIZE = 1024;
const SHADOW_HALF = 8.6; // halva sidan på skuggkartans ruta (m), rymmer helikoptern med rotorn

// --- Geometri ------------------------------------------------------------------------

/** Nät med hörn, normaler och index. Normalerna pekar bort från varje rings mitt. */
class Mesh {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.idx = [];
  }

  /**
   * Ringar som binds ihop till en sluten mantel, med lock i ändarna.
   * @param {number[][][]} rings  varje ring är en lista med [x, y, z]
   * @param {number[][]} centers  ringarnas mittpunkter
   */
  rings(rings, centers, caps = true) {
    const n = rings[0].length;
    const start = this.pos.length / 3;
    for (const ring of rings) for (const p of ring) this.pos.push(...p);
    const normals = new Array(rings.length * n).fill(0).map(() => [0, 0, 0]);
    const tris = [];
    for (let r = 0; r < rings.length - 1; r++) {
      for (let i = 0; i < n; i++) {
        const a = r * n + i;
        const b = r * n + ((i + 1) % n);
        const c = a + n;
        const d = b + n;
        tris.push([a, b, d], [a, d, c]);
      }
    }
    const P = (k) => rings[Math.floor(k / n)][k % n];
    for (const [a, b, c] of tris) {
      const fn = cross(sub(P(b), P(a)), sub(P(c), P(a)));
      for (const k of [a, b, c]) addTo(normals[k], fn);
      this.idx.push(start + a, start + b, start + c);
    }
    normals.forEach((nm, k) => {
      const out = sub(P(k), centers[Math.floor(k / n)]);
      let v = normalize(nm);
      if (dot(v, out) < 0) v = scale(v, -1);
      this.nor.push(...v);
    });
    // caps: true = båda ändarna, 'start' = bara den första (öppet rör i andra änden)
    if (caps) this.#cap(rings[0], centers[0], sub(centers[0], centers[1]));
    if (caps === true) {
      this.#cap(rings[rings.length - 1], centers[centers.length - 1], sub(centers[centers.length - 1], centers[centers.length - 2]));
    }
  }

  #cap(ring, center, dir) {
    const nrm = normalize(dir);
    if (!isFinite(nrm[0])) return;
    const start = this.pos.length / 3;
    this.pos.push(...center);
    this.nor.push(...nrm);
    for (const p of ring) {
      this.pos.push(...p);
      this.nor.push(...nrm);
    }
    for (let i = 0; i < ring.length; i++) this.idx.push(start, start + 1 + i, start + 1 + ((i + 1) % ring.length));
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));
function addTo(t, v) {
  t[0] += v[0];
  t[1] += v[1];
  t[2] += v[2];
}

/** Catmull–Rom genom kontrollpunkterna (tal eller vektorer), steps punkter per sträcka. */
function spline(points, steps) {
  const out = [];
  const lerp = (a, b, f) => (Array.isArray(a) ? a.map((x, i) => x + (b[i] - x) * f) : a + (b - a) * f);
  const cr = (p0, p1, p2, p3, t) => {
    const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    return Array.isArray(p1) ? p1.map((_, i) => f(p0[i], p1[i], p2[i], p3[i])) : f(p0, p1, p2, p3);
  };
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) out.push(cr(p0, points[i], points[i + 1], p3, s / steps));
  }
  out.push(points[points.length - 1]);
  void lerp;
  return out;
}

/**
 * Kropp som byggs av tvärsnitt längs z: superellipser med egen höjd uppåt och nedåt.
 * Varje snitt är [z, cy, halvbredd, höjd upp, höjd ned, exponent, cx, bukens bredd (andel)].
 * map byter axlar för delar som ligger längs x (stabilisatorn).
 */
function loft(mesh, sections, { segs = 28, steps = 4, map = (p) => p } = {}) {
  const smooth = spline(sections.map((s) => [s[0], s[1], s[2], s[3], s[4], s[5] ?? 2, s[6] ?? 0, s[7] ?? 1]), steps);
  const rings = [];
  const centers = [];
  for (const [z, cy, w0, ht, hb, pw, cx, taper] of smooth) {
    const ring = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const e = 2 / pw;
      // Nedre halvan kan vara smalare (taper), som kabinens buk som smalnar av mot medarna
      const w = s < 0 ? w0 * (1 - (1 - taper) * Math.abs(s) ** 1.5) : w0;
      const x = cx + w * Math.sign(c) * Math.abs(c) ** e;
      const y = cy + (s > 0 ? ht : hb) * Math.sign(s) * Math.abs(s) ** e;
      ring.push(map([x, y, z]));
    }
    rings.push(ring);
    centers.push(map([cx, cy, z]));
  }
  mesh.rings(rings, centers);
}

/** Rör längs en bana av punkter. */
function tube(mesh, points, r, { segs = 10, steps = 4, caps = true } = {}) {
  const path = spline(points, steps);
  const rings = [];
  let u = null;
  for (let i = 0; i < path.length; i++) {
    const t = normalize(sub(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)]));
    // Ramen följer med längs banan (parallellförflyttning), så att röret inte vrids i kurvorna
    if (!u) u = normalize(cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    else u = normalize(sub(u, scale(t, dot(u, t))));
    const v = cross(t, u);
    const ring = [];
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      ring.push(add(path[i], add(scale(u, Math.cos(a) * r), scale(v, Math.sin(a) * r))));
    }
    rings.push(ring);
  }
  mesh.rings(rings, path, caps);
}

/** Kabinen, motorkåpan, stjärtbommen, fenan och stabilisatorn (lackerade delar). */
function buildBody() {
  const m = new Mesh();
  // [z, cy, halvbredd, upp, ned, exponent]
  loft(
    m,
    [
      [2.86, 0.98, 0.03, 0.03, 0.03, 2],
      [2.78, 0.99, 0.34, 0.36, 0.33, 2.2],
      [2.5, 1.06, 0.6, 0.6, 0.56, 2.6],
      [2.05, 1.17, 0.63, 0.86, 0.72, 3.0, 0, 0.9],
      [1.45, 1.25, 0.7, 0.95, 0.82, 2.9, 0, 0.88],
      [0.6, 1.28, 0.73, 0.94, 0.86, 3.0, 0, 0.88],
      [-0.6, 1.3, 0.73, 0.92, 0.86, 3.0, 0, 0.88],
      [-1.3, 1.36, 0.7, 0.86, 0.8, 2.9, 0, 0.86],
      [-1.72, 1.44, 0.66, 0.74, 0.68, 2.9],
      [-1.98, 1.52, 0.5, 0.58, 0.48, 2.5],
      [-2.1, 1.56, 0.3, 0.3, 0.22, 2.2],
      [-2.13, 1.58, 0.03, 0.03, 0.03, 2],
    ],
    { segs: 40, steps: 5 }
  );
  // Stjärtbommen ut från kabinens övre bakkant (bakom den finns kabinens bakdörrar)
  loft(
    m,
    [
      [-1.5, 1.82, 0.3, 0.28, 0.28, 2.2],
      [-2.6, 1.84, 0.25, 0.24, 0.22, 2],
      [-5.0, 1.87, 0.18, 0.18, 0.16, 2],
      [-6.45, 1.9, 0.14, 0.14, 0.13, 2],
      [-6.6, 1.89, 0.03, 0.03, 0.03, 2],
    ],
    { segs: 32, steps: 4 }
  );
  // Motorkåpan ovanpå kabinen
  loft(
    m,
    [
      [1.1, 2.1, 0.06, 0.04, 0.04, 2],
      [0.92, 2.14, 0.5, 0.26, 0.08, 2.6],
      [0.3, 2.17, 0.6, 0.46, 0.1, 3.2],
      [-1.0, 2.15, 0.6, 0.46, 0.1, 3.2],
      [-1.9, 2.06, 0.52, 0.34, 0.12, 2.8],
      [-2.5, 2.0, 0.42, 0.2, 0.12, 2.4],
      [-2.95, 1.96, 0.26, 0.13, 0.1, 2.2],
      [-3.1, 1.95, 0.04, 0.03, 0.03, 2],
    ],
    { segs: 32, steps: 4 }
  );
  // Motorernas luftintag: två kåpor på var sida om masten, med mörka öppningar framåt (buildFrame)
  for (const sx of [-INTAKE_X, INTAKE_X]) {
    loft(
      m,
      [
        [0.84, 2.3, 0.18, 0.13, 0.12, 2.8, sx],
        [0.55, 2.32, 0.2, 0.15, 0.14, 3.0, sx],
        [-0.3, 2.31, 0.17, 0.12, 0.13, 2.6, sx],
        [-0.8, 2.26, 0.08, 0.05, 0.05, 2, sx],
      ],
      { segs: 20, steps: 3 }
    );
  }
  // Mastens kåpa: en låg kon runt rotoraxeln ovanpå motorkåpan
  loft(
    m,
    [
      [2.42, HUB[2], 0.36, 0.36, 0.36, 2.2],
      [2.56, HUB[2], 0.3, 0.3, 0.3, 2.2],
      [2.7, HUB[2], 0.18, 0.18, 0.18, 2],
      [2.74, HUB[2], 0.04, 0.04, 0.04, 2],
    ],
    { segs: 24, steps: 2, map: ([x, y, z]) => [x, z, y] }
  );
  // Fenan med fenestron: den runda kåpan nedtill och en hög, bakåtsvept fena ovanför, som på H135.
  // Det är den höga fenan som gör siluetten igenkännbar snett framifrån.
  loft(
    m,
    [
      [-6.25, 1.91, 0.05, 0.19, 0.19, 2],
      [-6.5, 1.985, 0.09, 0.565, 0.565, 2.6],
      [-7.0, 2.105, 0.1, 0.745, 0.745, 2.8],
      [-7.45, 2.37, 0.085, 0.77, 0.77, 3],
      [-7.8, 2.71, 0.065, 0.71, 0.71, 3.2],
      [-8.0, 2.875, 0.04, 0.575, 0.575, 3.2],
      [-8.1, 2.96, 0.012, 0.44, 0.44, 3],
    ],
    { segs: 24, steps: 4 }
  );
  // Stabilisatorn tvärs över bommen, med ändplattor
  loft(
    m,
    [
      [-0.9, 1.86, 0.02, 0.01, 0.01, 2],
      [-0.86, 1.86, 0.2, 0.028, 0.022, 2],
      [0.86, 1.86, 0.2, 0.028, 0.022, 2],
      [0.9, 1.86, 0.02, 0.01, 0.01, 2],
    ].map(([a, cy, w, ht, hb, p]) => [a, cy, w, ht, hb, p, 0]),
    { segs: 16, steps: 1, map: ([x, y, z]) => [z, y, x - 5.95] }
  );
  for (const sx of [-0.88, 0.88]) {
    loft(
      m,
      [
        [-5.62, 1.86, 0.02, 0.1, 0.08, 2, sx],
        [-5.75, 1.88, 0.035, 0.2, 0.15, 2.4, sx],
        [-6.15, 1.92, 0.035, 0.2, 0.15, 2.4, sx],
        [-6.25, 1.95, 0.02, 0.12, 0.08, 2, sx],
      ],
      { segs: 12, steps: 2 }
    );
  }
  return m;
}

/** Medarna och tvärbommarna (grålackerade, blanka rör). */
function buildGear() {
  const m = new Mesh();
  for (const sx of [-1, 1]) {
    const x = sx * 1.12;
    tube(
      m,
      [
        [x, 0.08, -1.45],
        [x, 0.06, -1.2],
        [x, 0.06, 0.8],
        [x, 0.06, 1.7],
        [x, 0.1, 1.98],
        [x, 0.19, 2.12],
        [x, 0.22, 2.15],
      ],
      0.052,
      { segs: 14, steps: 5 }
    );
  }
  for (const z of [1.05, -0.75]) {
    tube(
      m,
      [
        [-1.12, 0.06, z],
        [-1.06, 0.18, z],
        [-0.82, 0.42, z],
        [-0.56, 0.52, z],
        [0.56, 0.52, z],
        [0.82, 0.42, z],
        [1.06, 0.18, z],
        [1.12, 0.06, z],
      ],
      0.048,
      { segs: 14, steps: 4 }
    );
  }
  return m;
}

/** Masten och sotet innanför avgasrören (mörk metall). */
function buildFrame() {
  const m = new Mesh();
  for (const sx of [-1, 1]) {
    tube(m, [[sx * 0.36, 2.285, -2.3], [sx * 0.45, 2.33, -2.52]], 0.1, { segs: 14, steps: 1 }); // sotigt innanför avgasröret
  }
  tube(m, [[HUB[0], 2.3, HUB[2]], [HUB[0], HUB[1] - 0.05, HUB[2]]], 0.13, { segs: 16, steps: 1 });
  // Styrplattan runt masten och stängerna upp till bladfästena
  loft(
    m,
    [
      [2.76, 0, 0.05, 0.05, 0.05, 2],
      [2.77, 0, 0.27, 0.27, 0.27, 2],
      [2.84, 0, 0.27, 0.27, 0.27, 2],
      [2.85, 0, 0.05, 0.05, 0.05, 2],
    ],
    { segs: 24, steps: 1, map: ([x, y, z]) => [x, z, y + HUB[2]] }
  );
  // Sökarljuset under buken: ett kort, mörkt hus på en stötta, riktat framåt och lite nedåt
  tube(m, [[-0.24, 0.47, 1.62], [-0.24, 0.34, 1.68]], 0.035, { segs: 8, steps: 1 });
  tube(m, [[-0.24, 0.34, 1.52], [-0.24, 0.31, 1.84]], 0.1, { segs: 16, steps: 1 });
  // Intagens öppningar: mörka, nästan platta skivor precis framför intagskåporna
  for (const sx of [-INTAKE_X, INTAKE_X]) {
    loft(
      m,
      [
        [0.852, 2.3, 0.02, 0.02, 0.02, 2, sx],
        [0.85, 2.3, 0.155, 0.11, 0.1, 2.8, sx],
        [0.838, 2.3, 0.155, 0.11, 0.1, 2.8, sx],
      ],
      { segs: 20, steps: 1 }
    );
  }
  return m;
}

/** Avgasrören och antennerna (ljus metall). */
function buildHoist() {
  const m = new Mesh();
  // Avgasrören bak på motorkåpan, i värmetålig stål
  for (const sx of [-1, 1]) {
    tube(m, [[sx * 0.3, 2.27, -2.05], [sx * 0.37, 2.29, -2.35], [sx * 0.5, 2.37, -2.62]], 0.115, { segs: 14, steps: 3, caps: 'start' });
  }
  // Antenner på bommen och under kabinen
  tube(m, [[0, 2.05, -3.3], [0, 2.32, -3.5]], 0.02, { segs: 6, steps: 1 });
  tube(m, [[0, 2.02, -4.2], [0, 2.22, -4.35]], 0.018, { segs: 6, steps: 1 });
  tube(m, [[0.2, 0.42, -0.4], [0.2, 0.22, -0.55]], 0.02, { segs: 6, steps: 1 });
  return m;
}

/** Vinschen på höger sida ovanför skjutdörren (bara räddningshelikoptern har vinsch). */
function buildWinch() {
  const m = new Mesh();
  tube(m, [[-0.5, 2.18, 0.55], [-0.85, 2.2, 0.55], [-1.12, 2.16, 0.55]], 0.06, { segs: 8, steps: 2 });
  tube(m, [[-0.5, 2.14, 0.0], [-0.9, 2.18, 0.35], [-1.1, 2.16, 0.5]], 0.045, { segs: 8, steps: 2 });
  loft(
    m,
    [
      [0.2, 2.16, 0.03, 0.03, 0.03, 2, -1.18],
      [0.26, 2.16, 0.15, 0.15, 0.15, 2.4, -1.18],
      [0.95, 2.16, 0.15, 0.15, 0.15, 2.4, -1.18],
      [1.05, 2.16, 0.06, 0.06, 0.06, 2, -1.18],
    ],
    { segs: 16, steps: 1 }
  );
  // Linan och kroken
  tube(m, [[-1.18, 2.02, 0.55], [-1.18, 1.74, 0.55]], 0.012, { segs: 6, steps: 1 });
  tube(m, [[-1.18, 1.76, 0.55], [-1.18, 1.64, 0.55]], 0.04, { segs: 8, steps: 1 });
  return m;
}

/** Lamporna: blinkljuset på bommen och lanternorna (ritas självlysande). */
const LAMPS = [
  { at: [0, 2.08, -2.95], color: '#ff2a1a', r: 0.07, flash: true },
  { at: [0.92, 2.06, -6.0], color: '#ff3b2f', r: 0.045 },
  { at: [-0.92, 2.06, -6.0], color: '#3bff7a', r: 0.045 },
  { at: [0, 2.2, -7.74], color: '#ffffff', r: 0.045 },
  // Strålkastarna i nosen; de lyser bara mot kameran när nosen pekar ditåt (dir)
  { at: [0.27, 0.8, 2.74], color: '#fff3d6', r: 0.075, dir: [0.25, -0.15, 1] },
  { at: [-0.27, 0.8, 2.74], color: '#fff3d6', r: 0.075, dir: [-0.25, -0.15, 1] },
  { at: [-0.24, 0.31, 1.85], color: '#fff3d6', r: 0.07, dir: [0, -0.1, 1] }, // sökarljuset
];
function buildLamp(r) {
  const m = new Mesh();
  loft(m, [[-r, 0, 0.005, 0.005, 0.005, 2], [-r * 0.6, 0, r * 0.8, r * 0.8, r * 0.8, 2], [r * 0.6, 0, r * 0.8, r * 0.8, r * 0.8, 2], [r, 0, 0.005, 0.005, 0.005, 2]], {
    segs: 10,
    steps: 2,
  });
  return m;
}

/** Navet med bladfästen, kring origo; roteras med rotorn. */
function buildHub() {
  const m = new Mesh();
  loft(
    m,
    [
      [-0.14, 0, 0.05, 0.05, 0.05, 2],
      [-0.12, 0, 0.3, 0.3, 0.3, 3],
      [0.06, 0, 0.3, 0.3, 0.3, 3],
      [0.1, 0, 0.2, 0.2, 0.2, 2.4],
      [0.22, 0, 0.12, 0.12, 0.12, 2],
      [0.26, 0, 0.03, 0.03, 0.03, 2],
    ],
    { segs: 20, steps: 2, map: ([x, y, z]) => [x, z, y] }
  );
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const d = [Math.cos(a), 0, -Math.sin(a)];
    // Bladfästet: en grov hylsa närmast navet, sedan bladets rot
    tube(m, [scale(d, 0.2), scale(d, 0.62)], 0.085, { segs: 10, steps: 1 });
    tube(m, [scale(d, 0.6), add(scale(d, 1.05), [0, 0.02, 0])], 0.055, { segs: 8, steps: 1 });
    // Stången från styrplattan upp till bladfästet
    const side = [-Math.sin(a), 0, -Math.cos(a)];
    tube(m, [add(scale(d, 0.3), add(scale(side, 0.14), [0, -0.17, 0])), add(scale(d, 0.42), add(scale(side, 0.12), [0, 0.0, 0]))], 0.022, {
      segs: 6,
      steps: 1,
    });
  }
  return m;
}

/** Rotorskivan: en kvadrat i xz-planet som shadern skär till en cirkel med blad. */
function buildDisc() {
  const m = new Mesh();
  const r = ROTOR_R + 0.05;
  m.pos.push(-r, 0, -r, r, 0, -r, r, 0, r, -r, 0, r);
  m.nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
  m.idx.push(0, 1, 2, 0, 2, 3);
  return m;
}

/** Kompilerar och länkar ett shaderprogram; aPos och aNor får fasta platser i alla program. */
function link(gl, vs, fs) {
  const program = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.bindAttribLocation(program, 0, 'aPos');
  gl.bindAttribLocation(program, 1, 'aNor');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
}

function uniforms(gl, program) {
  const u = {};
  const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(program, i).name;
    u[name] = gl.getUniformLocation(program, name);
  }
  return u;
}

/** Ortografisk projektion (kolumnvis). */
function ortho(h, near, far) {
  return new Float32Array([1 / h, 0, 0, 0, 0, 1 / h, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1]);
}

// --- Matriser (kolumnvis, som WebGL) --------------------------------------------------

function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}
function translate(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}
function rotX(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}
function rotY(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}
function rotZ(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
function lookAt(eye, target, up) {
  const f = normalize(sub(target, eye));
  const s = normalize(cross(f, up));
  const u = cross(s, f);
  return new Float32Array([s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -dot(s, eye), -dot(u, eye), dot(f, eye), 1]);
}
function apply(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Inversen av en stel transform (rotation och förflyttning), kolumnvis. */
function invertRigid(m) {
  const o = new Float32Array(16);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[c * 4 + r] = m[r * 4 + c];
  for (let r = 0; r < 3; r++) o[12 + r] = -(o[r] * m[12] + o[4 + r] * m[13] + o[8 + r] * m[14]);
  o[15] = 1;
  return o;
}

// Kabinen och motorkåpan som en låda i modellens koordinater, för att se om en lampa skyms
const CABIN_BOX = { lo: [-0.68, 0.35, -2.1], hi: [0.68, 2.55, 2.75] };

/** Skär sträckan från ögat (modellens koordinater) till punkten p genom kabinens låda? */
function hiddenByCabin(eye, p) {
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = p[i] - eye[i];
    if (Math.abs(d) < 1e-9) {
      if (eye[i] < CABIN_BOX.lo[i] || eye[i] > CABIN_BOX.hi[i]) return false;
      continue;
    }
    let a = (CABIN_BOX.lo[i] - eye[i]) / d;
    let b = (CABIN_BOX.hi[i] - eye[i]) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return t1 < 0.999; // lampan själv ligger utanför lådan, så skärningen måste vara före den
}

/** sRGB-färg (#rrggbb) till linjära värden. */
function linear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255) ** 2.2);
}

/** Ungefärlig ljushet (linjär luminans) för en sRGB-färg. */
function luma(hex) {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const DEFAULT_LIVERY = { body: '#f4f5f7', accent: '#d3302a', trim: '#ffffff' };

export class Heli3D {
  /**
   * Skapar helikoptern på en egen canvas utanför sidan.
   * @returns {Heli3D|null} null utan WebGL2 (då ritas helikoptern i 2D)
   */
  static create() {
    if (typeof document === 'undefined') return null;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
      return gl ? new Heli3D(canvas, gl) : null;
    } catch (err) {
      console.warn('[Ergcopter] 3D-helikoptern går inte att starta:', err.message);
      return null;
    }
  }

  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    const program = link(gl, VERTEX, FRAGMENT);
    this.program = program;
    gl.useProgram(program);
    this.u = uniforms(gl, program);
    this.aPos = 0;
    this.aNor = 1;
    // Skuggkartan: ett djup-ritmål som solen ser helikoptern i
    this.depthProgram = link(gl, DEPTH_VERTEX, DEPTH_FRAGMENT);
    this.du = uniforms(gl, this.depthProgram);
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.parts = {
      body: this.#upload(buildBody()),
      frame: this.#upload(buildFrame()),
      gear: this.#upload(buildGear()),
      hub: this.#upload(buildHub()),
      disc: this.#upload(buildDisc()),
      hoist: this.#upload(buildHoist()),
      winch: this.#upload(buildWinch()),
      lamps: LAMPS.map((l) => ({ ...l, mesh: this.#upload(buildLamp(l.r)), glow: linear(l.color) })),
    };
    this.box = { x0: 0, y0: 0, w: 0, h: 0 };
  }

  #upload(mesh) {
    const { gl } = this;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = (data, loc) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    };
    buf(mesh.pos, this.aPos);
    buf(mesh.nor, this.aNor);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: mesh.idx.length };
  }

  /**
   * Ritar helikoptern och returnerar var canvasen ska ligga i förhållande till
   * modellens mittpunkt (CENTER) i CSS-pixlar.
   * @param {object} o
   * @param {number} o.pxPerM     skala vid mittpunkten (CSS-pixlar per meter)
   * @param {number} [o.dpr]
   * @param {number} [o.yaw]      kamerans vinkel runt helikoptern (rad), 0 = rakt bakifrån, π/2 = från höger sida
   * @param {number} [o.pitch]    kamerans höjdvinkel (rad), positiv = ovanifrån
   * @param {number} [o.dist]     kamerans avstånd (m)
   * @param {number} [o.roll, o.nose, o.heading]  helikopterns lutning i sidled, nosens lutning och kurs (rad)
   * @param {number} [o.discTilt] rotorskivans lutning framåt mot kroppen (rad)
   * @param {{angle:number, blur:number}} o.rotor
   * @param {object} [o.livery]   { body, accent, trim, scheme } (scheme 'lower' skolhelikoptern, 'white' vit kabin)
   * @param {number} [o.dusk]     0–1 kvällsljus
   * @param {number} [o.time]     s, för blinkljuset
   * @param {number[]} [o.sun]   riktning mot solen sett från kameran (x vänster, y upp, z framåt), i stället för dagens sol
   * @param {number} [o.warm]    0–1: varmare, gyllene sol (hovringen över plattan, som landskapet där)
   * @param {number} [o.shine]  0–1: blank lack och glas som speglar kvällshimlen (startskärmens närbild)
   * @param {number} [o.sunK]   solens styrka (1 = som i landskapet)
   * @param {{dir:number[], color:string, k:number}} [o.rim]  motljus från en låg sol bakom helikoptern
   *   (riktning sett från kameran som o.sun, färg #rrggbb och styrka)
   * @returns {{canvas:HTMLCanvasElement, x0:number, y0:number, w:number, h:number, lights:object[]}|null}
   *   lights: lampornas plats (CSS-pixlar från mittpunkten), färg och styrka, för ljusskenet i 2D
   */
  render(o) {
    if (this.lost) return null;
    const { gl, u, canvas } = this;
    const dpr = o.dpr ?? 1;
    const dist = o.dist ?? 18;
    const yaw = o.yaw ?? 0;
    const pitch = o.pitch ?? 0.3;
    const C = CENTER;
    const eye = [
      C[0] - dist * Math.sin(yaw) * Math.cos(pitch),
      C[1] + dist * Math.sin(pitch),
      C[2] - dist * Math.cos(yaw) * Math.cos(pitch),
    ];
    const view = lookAt(eye, C, [0, 1, 0]);
    // Helikopterns hållning kring mittpunkten: kurs, nos och sidlutning
    const model = mul(
      translate(C[0], C[1], C[2]),
      mul(rotY(o.heading ?? 0), mul(rotX(o.nose ?? 0), mul(rotZ(o.roll ?? 0), translate(-C[0], -C[1], -C[2]))))
    );
    const focal = o.pxPerM * dist;
    // Rotorskivan lutar framåt i fart, mer än kroppen; bakifrån ses den då nästan från kanten
    const tilt = o.discTilt ?? 0.05;
    const hubModel = mul(model, mul(translate(HUB[0], HUB[1], HUB[2]), rotX(tilt)));
    const discModel = mul(hubModel, translate(0, 0.08, 0));

    // Bildens utsträckning: rotorskivan och kroppens ytterpunkter
    const pts = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      pts.push(apply(discModel, [Math.cos(a) * ROTOR_R, 0, Math.sin(a) * ROTOR_R]));
    }
    for (const x of [-1.42, 1.42]) for (const y of [0, 3.35]) for (const z of [-8.1, 2.9]) pts.push(apply(model, [x, y, z]));
    let [u0, v0, u1, v1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of pts) {
      const q = apply(view, p);
      const zz = Math.max(0.5, -q[2]);
      const sx = (focal * q[0]) / zz;
      const sy = (-focal * q[1]) / zz;
      u0 = Math.min(u0, sx);
      u1 = Math.max(u1, sx);
      v0 = Math.min(v0, sy);
      v1 = Math.max(v1, sy);
    }
    const pad = 6;
    u0 -= pad;
    v0 -= pad;
    const wCss = u1 - u0 + pad;
    const hCss = v1 - v0 + pad;
    const k = Math.min(dpr, MAX_DIM / Math.max(wCss, hCss));
    const want = (x) => Math.ceil((x * k) / SIZE_STEP) * SIZE_STEP;
    const W = want(wCss);
    const H = want(hCss);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    // Projektionen i bildpunkter, med mittpunkten på (-u0, -v0)
    const cxp = -u0 * k;
    const cyp = -v0 * k;
    const f = focal * k;
    const near = 0.5;
    const far = dist + 30;
    const proj = new Float32Array(16);
    proj[0] = (2 * f) / W;
    proj[5] = (2 * f) / H;
    proj[8] = 1 - (2 * cxp) / W;
    proj[9] = (2 * cyp) / H - 1;
    proj[10] = -(far + near) / (far - near);
    proj[11] = -1;
    proj[14] = (-2 * far * near) / (far - near);

    // Ljuset som i landskapet: solen högt till höger på dagen, lågt och varmt på kvällen.
    // Kameran tittar längs +z, så "höger i bild" är −x.
    const dusk = o.dusk ?? 0;
    const sunDay = [-0.82, 0.5, 0.3]; // till höger som i landskapet, lågt nog att högra flanken lyser och den vänstra hamnar i skugga
    const sunDusk = [-0.62, 0.16, 0.77];
    const sunW = normalize(o.sun ?? sunDay.map((v, i) => v + (sunDusk[i] - v) * dusk));
    const sun = apply(rotY(yaw), sunW); // solen står still i bild när kameran går runt helikoptern
    const lv = { ...DEFAULT_LIVERY, ...(o.livery ?? {}) };
    // I närbilden (shine) kastar navet ingen skugga: bladfästenas skuggor blir mörka streck tvärs över
    // kabinen, där den snurrande rotorn i verkligheten bara ger en svag, utsmetad skugga
    const lightVP = this.#shadowPass(sun, model, hubModel, o.rotor?.angle ?? 0, lv.scheme !== 'lower', !(o.shine > 0));

    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform3fv(u.uEye, eye);
    gl.uniformMatrix4fv(u.uLightVP, false, lightVP);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniform1i(u.uShadowMap, 0);

    gl.uniform3fv(u.uSun, sun);
    const warm = o.warm ?? 0;
    const day = [0, 1, 2].map((i) => [1.0, 0.9, 0.76][i] * 2.8 * (1 - warm) + [1.0, 0.82, 0.6][i] * 3.0 * warm);
    const sunK = o.sunK ?? 1;
    gl.uniform3fv(u.uSunCol, [0, 1, 2].map((i) => (day[i] * (1 - dusk) + [1.0, 0.62, 0.34][i] * 3.0 * dusk) * sunK));
    gl.uniform3fv(u.uSky, [0, 1, 2].map((i) => [0.3, 0.46, 0.8][i] * (1 - dusk) + [0.5, 0.38, 0.5][i] * dusk));
    // Marken under: grön dal, eller i hovringen (warm) den solbelysta, beige plattan som lyser upp magen varmt
    const ground = [0, 1, 2].map((i) => [0.16, 0.18, 0.14][i] * (1 - warm) + [0.34, 0.27, 0.19][i] * warm);
    gl.uniform3fv(u.uGround, [0, 1, 2].map((i) => ground[i] * (1 - dusk) + [0.18, 0.12, 0.1][i] * dusk));
    // En mörk dekorfärg målar ränderna och ramarna, inte halva kroppen, så att helikoptern inte
    // blir en mörk klump framifrån.
    const dark = luma(lv.accent) < 0.12;
    gl.uniform3fv(u.uBody, linear(lv.body));
    gl.uniform3fv(u.uAccent, linear(dark ? lv.body : lv.accent));
    gl.uniform3fv(u.uTrim, linear(dark ? lv.accent : lv.trim));
    gl.uniform1f(u.uDark, dark ? 1 : 0);
    gl.uniform1f(u.uLower, lv.scheme === 'lower' ? 1 : 0);
    gl.uniform1f(u.uAngle, o.rotor?.angle ?? 0);
    gl.uniform1f(u.uBlur, o.rotor?.blur ?? 0);
    gl.uniform1f(u.uFill, 0.34 - 0.16 * warm);
    gl.uniform1f(u.uWarm, warm);
    const rim = o.rim ?? null;
    gl.uniform3fv(u.uRimDir, rim ? apply(rotY(yaw), normalize(rim.dir)) : [0, 1, 0]);
    gl.uniform3fv(u.uRimCol, rim ? linear(rim.color).map((v) => v * rim.k) : [0, 0, 0]);
    gl.uniform1f(u.uWhite, lv.scheme === 'white' ? 1 : 0);
    gl.uniform1f(u.uShine, o.shine ?? 0);

    const draw = (part, mat, m) => {
      gl.uniform1i(u.uMat, mat);
      gl.uniformMatrix4fv(u.uModel, false, m);
      gl.bindVertexArray(part.vao);
      gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_INT, 0);
    };
    gl.disable(gl.BLEND);
    draw(this.parts.body, 0, model);
    draw(this.parts.frame, 1, model);
    draw(this.parts.gear, 5, model);
    draw(this.parts.hoist, 3, model);
    // Skolhelikoptern (lackeringen 'lower') har ingen vinsch (core/helicopters.js)
    const winch = lv.scheme !== 'lower';
    if (winch) draw(this.parts.winch, 3, model);
    // Lamporna: blinkljuset blinkar en gång i sekunden, lanternorna lyser hela tiden
    const time = o.time ?? 0;
    const lights = [];
    for (const lamp of this.parts.lamps) {
      const on = lamp.flash ? Math.max(0, 1 - ((time * 1.1) % 1) * 6) : 1;
      gl.uniform3fv(u.uGlow, lamp.glow.map((v) => v * (0.25 + 0.75 * on) + 0.05));
      draw(lamp.mesh, lamp.dir ? 6 : 4, mul(model, translate(...lamp.at)));
      const wp = apply(model, lamp.at);
      const q = apply(view, wp);
      const zz = Math.max(0.5, -q[2]);
      // Riktade lampor syns bara framifrån (skenet ritas i 2D, utan djup)
      const facing = lamp.dir ? Math.max(0, dot(normalize(sub(apply(model, add(lamp.at, lamp.dir)), wp)), normalize(sub(eye, wp)))) ** 2 : 1;
      // Skenet ritas i 2D utan djup: en lampa som kroppen skymmer (blinkljuset bakom kabinen sett
      // framifrån) får inget sken, annars lyser det rött genom vindrutan
      const seen = hiddenByCabin(apply(invertRigid(model), eye), lamp.at) ? 0 : 1;
      lights.push({ x: (focal * q[0]) / zz, y: (-focal * q[1]) / zz, color: lamp.color, a: seen * on * facing * (lamp.flash ? 1 : lamp.dir ? 0.12 : 0.55) });
    }
    draw(this.parts.hub, 1, mul(hubModel, rotY(-(o.rotor?.angle ?? 0))));
    // Rotorskivan sist, genomskinlig och utan att skriva djup
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    draw(this.parts.disc, 2, discModel);
    gl.depthMask(true);
    gl.bindVertexArray(null);

    this.box = { x0: u0, y0: v0, w: W / k, h: H / k };
    return { canvas, ...this.box, lights };
  }

  /**
   * Ritar helikopterns djup sett från solen, så att kåpan, bommen och navet kastar
   * skuggor på kroppen och medarna. Rotorskivan är genomskinlig och kastar ingen skugga.
   * @returns {Float32Array} solens vy och projektion, för uppslagningen i shadern
   */
  #shadowPass(sun, model, hubModel, angle, winch, hub = true) {
    const { gl, du } = this;
    const C = CENTER;
    const up = Math.abs(sun[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
    const lightVP = mul(ortho(SHADOW_HALF, 1, 40), lookAt(add(C, scale(sun, 20)), C, up));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.5, 3);
    gl.useProgram(this.depthProgram);
    gl.uniformMatrix4fv(du.uLightVP, false, lightVP);
    const draw = (part, m) => {
      gl.uniformMatrix4fv(du.uModel, false, m);
      gl.bindVertexArray(part.vao);
      gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_INT, 0);
    };
    draw(this.parts.body, model);
    draw(this.parts.frame, model);
    draw(this.parts.gear, model);
    draw(this.parts.hoist, model);
    if (winch) draw(this.parts.winch, model);
    if (hub) draw(this.parts.hub, mul(hubModel, rotY(-angle)));
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return lightVP;
  }
}
