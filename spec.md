# Helikopterspelet – specifikation

Ett eventspel där en simulerad helikopter drivs av effekten från en Concept2 SkiErg. Målet är att komma så högt som möjligt.

## 1. Koncept

Deltagaren står på en SkiErg. Effekten (watt) läses live från ergens PM5-display via Bluetooth och driver en simulerad helikopter. Helikoptern lättar när effekten överstiger deltagarens personliga lyfteffekt, som beror på kroppsvikten. Ju högre upp, desto tunnare luft och desto mer effekt krävs för att hålla höjden. Om effekten sjunker under det som krävs sjunker helikoptern. Poängen är den högsta höjd man når.

Designmål: flera strategier ska vara gångbara, till exempel explosivt upp, jämnt och länge, eller jämnt med slutspurt. Med standardparametrarna ligger den bästa insatsen runt 3–5 minuter, där både explosiva och uthålliga deltagare har chans.

Den här specen beskriver grundspelet, "så högt som möjligt". Standardvärdena för blandad publik står i avsnitt 12. Övningar, karriär och uppdrag (Fjällräddaren) beskrivs i `plan.md`.

## 2. Plattform

- Webbapp på en enda sida som körs i Chrome eller Edge på en dator kopplad till en storskärm.
- PM5 läses via USB (WebHID) eller Bluetooth (Web Bluetooth). Båda kräver säker kontext (https eller localhost), och anslutningen måste startas av ett användarklick. USB ger även kraftkurvan. Fungerar inte i Firefox; på iPhone/iPad fungerar bara Bluetooth, via appen Bluefy.
- Ingen backend behövs: sidan är statiska filer. Den publiceras på GitHub Pages (https), och `server.js` eller Docker räcker för att köra lokalt. Topplista, inställningar och övningsframsteg sparas lokalt i webbläsaren (localStorage).
- En separat dashboard (`dashboard.html`) visar siffror och kraftkurva från PM via USB, med samma datakälla som spelet.
- Valfri renderingsteknik; Canvas 2D räcker.
- Fysiken ska vara helt separerad från rendering och datakälla så att den kan testas och köras headless.

## 3. Datakälla: Concept2 PM5

Spelet kan läsa PM5 via USB (WebHID och CSAFE, `usb.js`) eller Bluetooth (`ble.js`). Resten av avsnittet beskriver Bluetooth.

Officiell referens: *Concept2 PM Bluetooth Smart Communications Interface Definition*, rev 1.30:
http://www.concept2.co.in/files/pdf/us/monitors/PM5_BluetoothSmartInterfaceDefinition.pdf

Alla UUID:er följer basen `CE06xxxx-43E5-11E4-916C-0800200C9A66`.

| Syfte | UUID |
|---|---|
| Discovery-tjänst (filter i `requestDevice`) | `ce060000-43e5-11e4-916c-0800200c9a66` |
| Device Information-tjänst | `ce060010-43e5-11e4-916c-0800200c9a66` |
| Erg Machine Type (läs, 1 byte) | `ce060016-43e5-11e4-916c-0800200c9a66` |
| Control-tjänst | `ce060020-43e5-11e4-916c-0800200c9a66` |
| Rowing-tjänst (livedata) | `ce060030-43e5-11e4-916c-0800200c9a66` |
| Additional stroke data (effekt per drag, notify) | `ce060036-43e5-11e4-916c-0800200c9a66` |
| Multiplexad data (fallback, notify) | `ce060080-43e5-11e4-916c-0800200c9a66` |

Anslutning: `navigator.bluetooth.requestDevice` med filter på discovery-tjänsten och de övriga tjänsterna som `optionalServices`. Starta notiser på 0x0036.

Byteformat för 0x0036 (little-endian):

| Byte | Innehåll |
|---|---|
| 0–2 | Elapsed time (0,01 s) |
| 3–4 | Stroke power (W, uint16) |
| 5–6 | Stroke calories (cal/h) |
| 7–8 | Stroke count (uint16) |
| 9–14 | Projected work time/distance (används inte) |

```js
const dv = event.target.value;           // DataView
const power = dv.getUint16(3, true);
const strokeCount = dv.getUint16(7, true);
```

Att tänka på:

- PM5 måste vara i anslutningsläge: huvudmenyn → More Options → Turn Wireless ON. Bara en app åt gången kan vara ansluten, så ErgData får inte vara uppkopplad samtidigt.
- Erg Machine Type 128 betyder SkiErg. Spelet fungerar även med RowErg och BikeErg, men parametrarna är trimmade för SkiErg. Visa en varning om det inte är en SkiErg, men blockera inte.
- Om direkta notiser på 0x0036 inte fungerar (vissa Android-enheter begränsar antalet notiser), använd den multiplexade karaktäristiken 0x0080. Enligt dokumentets tabell anger första byten vilken karaktäristik datan kommer från (0x36), och resten är payload med samma layout. Verifiera detta mot en riktig enhet.
- Bygg ett debugläge som loggar råa bytes från alla notiser, så att tolkningen kan verifieras.
- Hantera frånkoppling (`gattserverdisconnected`): pausa fysiken, visa ett överlägg och försök återansluta.

### Abstraktion och mock

Datakällan ska ligga bakom ett gränssnitt så att spelet kan utvecklas och testas utan erg:

```ts
interface Stroke { t: number; power: number; strokeCount: number }

interface PowerSource {
  onStroke(cb: (s: Stroke) => void): void;
  start(): Promise<void>;
  stop(): void;
}
```

Implementationer (`public/shared/sources/`):

- **UsbPm5Source**: USB via WebHID och CSAFE-kommandon. Läser dragfas och kraftbuffert var 50:e ms och ger både drag och kraftsampel.
- **Pm5Source**: Web Bluetooth enligt ovan.
- **MockSource**: genererar drag i en inställbar takt (standard 40 drag/min) med aktuell effekt och en påhittad kraftkurva, så att signalbehandlingen körs precis som med riktig erg. Används av `?demo`.
- **ScriptedSource**: spelar upp en fördefinierad effektprofil, till exempel "245 W i 300 s". Används av strategisimulatorn och testerna.

## 4. Signalbehandling

PM5 rapporterar effekt per drag, ungefär var 1,2–2 sekund på en SkiErg. Fysiken behöver en kontinuerlig signal:

- Ett nytt drag identifieras på att `strokeCount` har ändrats. Dubbla notiser med samma räknare ignoreras.
- `P_smooth` är medelvärdet av de senaste `smoothingStrokes` dragen (standard 3).
- Mellan dragen hålls värdet konstant.
- Om inget nytt drag har kommit på `strokeTimeoutS` sekunder (standard 3) tonas `P_smooth` ned linjärt till 0 under `fadeOutS` sekunder (standard 1). Därefter töms bufferten.

## 5. Fysikmodell

All effekt uttrycks relativt deltagarens personliga lyfteffekt `P0`. Då skalar spelet automatiskt med kroppsvikten.

```
P0       = P_ref * (bodyMass / m_ref) ^ k      // effekt som krävs för att sväva vid marken
P_req(h) = P0 * (1 + h / H_air)                // effekt som krävs för att hålla höjden h
dh/dt    = G * (P_smooth - P_req(h)) / P0      // stig- eller sjunkhastighet (m/s)
```

- Integration med fast tidssteg `dt` = 0,05 s (20 Hz). Explicit Euler räcker.
- Markvillkor: om `h <= 0` och `dh/dt < 0` sätts `h = 0` och `dh/dt = 0`. Helikoptern står då kvar på marken tills `P_smooth > P0`.
- Valfritt: `maxSinkRate` begränsar sjunkhastigheten. Av som standard.
- `h_max` uppdateras varje tidssteg.

### Parametrar

Tabellen visar grundspelets värden. Standard i koden är värdena för blandad publik i avsnitt 12.1.

| Namn | Grundvärde | Betydelse |
|---|---|---|
| `P_ref` | 100 W | Lyfteffekt vid referensvikten |
| `m_ref` | 80 kg | Referensvikt |
| `k` | 1.0 | Viktexponent. 1.0 = ren W/kg ("linjär"), 0.667 = "rättvis" (se avsnitt 6) |
| `H_air` | 2700 m | Hur fort luften tunnas ut. Vid `h = H_air` krävs dubbla lyfteffekten. 2700 m ger samma lutning som originalidén: 180 W vid marken och 200 W på 300 m |
| `G` | 22,5 m/s | Stigförmåga. Stighastighet när effekten ligger en hel `P0` över det som krävs |
| `maxSinkRate` | av | Maximal sjunkhastighet (m/s) |
| `dt` | 0,05 s | Fysikens tidssteg |
| `smoothingStrokes` | 3 | Antal drag i medelvärdet |
| `strokeTimeoutS` | 3 s | Tid utan drag innan effekten tonas ned |
| `fadeOutS` | 1 s | Nedtoningstid |

### Balans och trimning

- Tidskonstanten `τ = H_air / G` (standard 120 s) avgör vilken strategi som vinner. Större τ, alltså en trögare helikopter, gynnar uthållighet. Mindre τ gynnar explosivitet.
- Jämviktshöjden vid konstant effekt är `h_eq = H_air * (P / P0 - 1)`.
- För att ändra höjdskalan utan att ändra balansen: ändra `H_air` och `G` med samma faktor.

### Analytisk lösning och referensvärden

Från marken med konstant effekt `P > P0`:

```
h(t) = H_air * (P / P0 - 1) * (1 - exp(-t * G / H_air))
```

Referensprofil: en antagen vältränad person på 80 kg (500 W i 3 s, 350 W i 30 s, 260 W i 3 min, 245 W i 5 min, 225 W i 10 min, 200 W i 60 min). Med standardparametrar och `k = 1`:

| Insats | Maxhöjd |
|---|---|
| 3 s @ 500 W | 267 m |
| 30 s @ 350 W | 1 493 m |
| 3 min @ 260 W | 3 356 m |
| 5 min @ 245 W | 3 594 m |
| 10 min @ 225 W | 3 352 m |
| 60 min @ 200 W | 2 700 m |

Effektkurvan är en uppskattning. Parametrarna ska trimmas efter tester med riktiga deltagare.

## 6. Kroppsvikt, rättvisa och integritet

- Vikten anges före start, som ett heltal mellan 15 och 200 kg. Rekommendation för eventet: ha en våg vid stationen, eftersom lägre angiven vikt gör det lättare att flyga.
- Två viktlägen väljs i inställningarna:
  - **Linjär** (`k = 1`, standard): ren W/kg. Tydlig berättelse: din vikt är lasten i helikoptern.
  - **Rättvis** (`k = 2/3`): motsvarar ungefär Concept2:s egen viktjustering (vikt i pund / 270, upphöjt till 0,222, omräknat från tid till effekt). Ren W/kg gynnar annars lätta personer på en SkiErg.
- Exempel på `P0` med grundvärdet `P_ref` = 100 W: 60 kg ger 75 W (linjär) eller 82,5 W (rättvis). 100 kg ger 125 W eller 116 W. Med standardvärdena, se tabellen i avsnitt 12.1.
- Vikten visas aldrig på storskärmen och sparas inte i topplistan.
- `P0` och råa watt visas inte heller på storskärmen som standard. I linjärt läge går vikten att räkna ut direkt från lyfteffekten (vikt = P0 / 1,25). Använd relativa mått i stället (se avsnitt 8). Råa watt kan slås på i inställningarna.

## 7. Spelflöde

Tillstånd: `IDLE → SETUP → MENU → READY → COUNTDOWN → FLYING → FINISHED → IDLE`

I MENU väljer deltagaren fri flygning (det som beskrivs här) eller en övning (se `plan.md` §3). Efter en övning går FINISHED tillbaka till MENU.

- **IDLE**: vänteskärm med topplista och "Tryck för att starta".
- **SETUP**: operatören matar in namn eller alias (valfritt, tomt blir "Anonym"), vikt och klass (avsnitt 12.2). Ergen måste vara ansluten.
- **READY**: ergen är ansluten. Visa "Dra för att lyfta!".
- **COUNTDOWN**: 3-2-1. Drag under nedräkningen ignoreras. Fysiken nollställs.
- **FLYING**: fysik och UI körs, tiden räknas. Passet avslutas vid det första av följande:
  1. Helikoptern har varit i luften och sedan stått på marken med `P_smooth < P0` i `groundEndS` sekunder (standard 5).
  2. Inga drag på `idleEndS` sekunder (standard 10).
  3. `maxSessionS` har uppnåtts (standard 480 s, 0 = av).
  4. Operatören trycker Esc.
- **FINISHED**: visa maxhöjd, placering i topplistan och högsta passerade milstolpe. Landningen spelas upp snabbspolad på högst 3 sekunder. Återgå till IDLE efter `resultDisplayS` sekunder (standard 15) eller vid tangenttryck.

Poäng: `h_max`. Spara namn, `h_max`, tid till `h_max`, klass och tidsstämpel.

## 8. UI (storskärm)

- Vertikal höjdskala med helikoptern. Kameran följer helikoptern och visar marken när höjden är låg.
- Stor siffra för aktuell höjd i meter och en mindre för maxhöjden i passet.
- **Lyftmätare** (det centrala elementet): `P_smooth / P_req(h)` i procent. 100 % betyder att höjden hålls. Grön över 100 %, röd under. På marken visas `P_smooth / P0`.
- Variometer: stig- eller sjunkhastighet i m/s med pil.
- Rotorns animationshastighet proportionell mot `P_smooth / P0`, så att deltagaren ser respons redan innan helikoptern lättar.
- Horisontella linjer för dagens rekord, maxhöjden i passet och milstolpar.
- Milstolpar (konfigurerbara): verkliga toppar från Jämtland och Härjedalen via Norge och Europa upp till Mount Everest, tätare där de flesta pass slutar (800–2 500 m). Listan med källor finns i `milestones.js`. Topparna ritas som berg med röse och skylt som passerar under helikoptern; en topp högt över helikoptern ritas genomskinlig, som om den låg långt bort. Flyger man över en topp blir skylten grön och det sprutar konfetti. Visa en kort banderoll ("Topp passerad") när en milstolpe passeras.
- Landskapet visar höjden utan siffror (`scenery.js`): tre fjällkedjor (granskog, fjällbjörk och hed, kalfjäll med snö) som sjunker undan när man stiger, ett molntäcke vid 1 900–2 040 m som man flyger igenom med ett molnhav ovanför, och norrsken högt upp.
- Fartkänsla (`effects.js`): fartstreck och en lätt utzoomning när man stiger eller faller fort, damm från rotorvinden nära marken, och helikoptern gungar i luften och skakar i full stigning. Allt detta är bara bild och påverkar inte fysiken.
- Tid sedan start.
- Topplista per klass i IDLE och FINISHED med namn och höjd, aldrig vikt eller watt (avsnitt 12.2).
- Valfritt ljud: helikopterljud som följer `P_smooth / P0`. Hovring (100 %) ger fullt rotorvarv; över 100 % låter det mer (bladslag, dunk, volym) upp till taket 300 %, med tydlig skillnad vid 200 %.

## 9. Inställningar och data

- Alla parametrar ligger i ett samlat konfigurationsobjekt.
- Dold inställningspanel för operatören (tangent S) med redigering och återställning till standard. Sparas i localStorage.
- Topplistan kan exporteras som JSON eller CSV och rensas (med bekräftelse).

## 10. Tester

**Fysik**
- Konstant effekt från marken jämförs med den analytiska lösningen. Tolerans 0,5 %. Använd referenstabellen i avsnitt 5.
- 80 kg och 90 W: helikoptern lättar aldrig.
- Höjden blir aldrig negativ.
- Effekt och sedan 0 W: helikoptern sjunker, landar på 0 och blir stående.

**Viktskalning** (tolerans ±0,1 W)
- `k = 1`: 60 kg → 75,0 W, 80 kg → 100,0 W, 100 kg → 125,0 W.
- `k = 2/3`: 60 kg → 82,5 W, 100 kg → 116,0 W.

**Signalbehandling**
- Medelvärdet av de 3 senaste dragen.
- Dubbletter av samma `strokeCount` ignoreras.
- Nedtoning efter timeout.

**Strategisimulator** (utvecklarverktyg)
Ett headless-skript (`npm run simulate`) som kör `ScriptedSource`-profiler genom samma signalbehandling och fysik och skriver ut `h_max`. Används för trimning. Profilerna står i avsnitt 12.3.

## 11. Byggordning

1. Fysikkärna, konfiguration, enhetstester och strategisimulator.
2. MockSource och grundläggande UI.
3. Pm5Source med Web Bluetooth och debugläge för råa bytes.
4. Spelflöde, topplista och inställningspanel.
5. Finputs: milstolpar, ljud och animationer.

## 12. Standardvärden för blandad publik

Parametrarna i avsnitt 5 är trimmade för vältränade vuxna. På ett event med barn, otränade och elit gäller i stället värdena nedan. De är standard i koden (`config.js`); avsnitt 5 och dess referenstabell finns kvar som grund för fysiktesterna.

### 12.1 Standardvärden

| Namn | Standard | Jämfört med avsnitt 5 |
|---|---|---|
| `P_ref` | 60 W (0,75 W/kg vid 80 kg) | 100 W |
| `H_air` | 1 800 m | 2 700 m |
| `G` | 20 m/s | 22,5 m/s |
| τ = `H_air / G` | 90 s | 120 s |
| `maxSessionS` | 480 s | 600 s |
| Viktläge | Linjär (`k = 1`) | samma |

- Vikten anges som heltal mellan 15 och 200 kg.
- Sparade inställningar som är exakt de gamla standardvärdena (100 W, 2 700 m, 22,5 m/s, 600 s) byts automatiskt mot de nya. Allt som operatören själv har ändrat behålls.

`P0` med standardvärdena (`k = 1`):

| Vikt | 15 kg | 20 kg | 30 kg | 50 kg | 60 kg | 80 kg | 100 kg | 120 kg |
|---|---|---|---|---|---|---|---|---|
| `P0` | 11,25 W | 15 W | 22,5 W | 37,5 W | 45 W | 60 W | 75 W | 90 W |

Med `k = 2/3` ger 30 kg `P0` = 31,2 W. Det rättvisa läget slår alltså hårt mot barn.

### 12.2 Klasser och topplista per klass

- Klasserna är **Barn** (till och med 12 år), **Ungdom** (13–17 år) och **Vuxen** (18 år och äldre). Bara klassen sparas, aldrig åldern.
- För barn visas en påminnelse till operatören: spjäll 3–5, och pall vid behov om barnet inte når handtagen.
- Topplistan visas per klass. Startskärmen bläddrar själv mellan klasserna (var 8:e sekund) så att publiken ser alla. En sammanlagd lista kan slås på som extra flik i inställningarna.
- Placering och dagens rekord räknas inom deltagarens klass.

### 12.3 Förväntat utfall och balanskontroll

Förväntad maxhöjd efter 240 s jämn effekt:

| Person | Vikt | Effekt | Maxhöjd |
|---|---|---|---|
| Barn | 30 kg | 40 W | 1 303 m |
| Otränad vuxen | 70 kg | 110 W | 1 834 m |
| Motionär | 80 kg | 180 W | 3 350 m |
| Stark SkiErg-användare | 80 kg | 300 W | 6 700 m |
| Elit | 90 kg | 420 W | 8 747 m |

Balanskontroll för en stark person på 80 kg. Den bästa insatsen ska ligga på 3–5 minuter:

| Insats | Maxhöjd |
|---|---|
| 30 s @ 450 W | 3 317 m |
| 3 min @ 320 W | 6 744 m |
| 5 min @ 295 W | 6 799 m |
| 10 min @ 260 W | 5 992 m |
| 60 min @ 200 W | 4 200 m |

Strategisimulatorn (`npm run simulate`) skriver ut båda tabellerna med aktuella parametrar, plus slutspurt (4 min @ 250 W + 30 s @ 380 W) och för hård start (1 min @ 380 W + 3 min @ 240 W).

### 12.4 Kalibrering för operatören

Inställningspanelen visar förväntat utfall och balanskontroll omräknade med de värden som står i panelen, plus τ. Procedur:

1. Kör själv ett fyraminuterspass och notera maxhöjden.
2. Testa med minst en otränad vuxen och ett barn.
3. Justera enligt tabellen:

| Problem | Åtgärd |
|---|---|
| Någon lättar inte inom 30 s | Sänk `P_ref` i steg om 10 W |
| Alla höjder känns för stora eller för små | Ändra `H_air` och `G` med samma faktor. Höjdskalan ändras men inte balansen |
| Passen blir för långa | Höj `G` utan att ändra `H_air` (τ sjunker) |
| Korta explosiva pass vinner för ofta | Sänk `G` utan att ändra `H_air` (τ ökar) |

### 12.5 Tester

`test/defaults.test.js` kontrollerar standardvärdena, `P0`-tabellen, förväntat utfall och balanskontrollen (±0,5 %), viktgränserna 15–200 kg, att förhandsvisningen räknas om, klasserna och topplistan per klass.

## 13. Öppna punkter

- Standardparametrarna bygger på en antagen effektkurva. `G` och `H_air` ska trimmas efter tester med riktiga deltagare.
- Om linjärt eller rättvist viktläge ska vara standard.
- Om vågen ska kopplas direkt till spelet.