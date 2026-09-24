# Helikopterspelet – specifikation

Ett eventspel där en simulerad helikopter drivs av effekten från en Concept2 SkiErg. Målet är att komma så högt som möjligt.

## 1. Koncept

Deltagaren står på en SkiErg. Effekten (watt) läses live från ergens PM5-display via Bluetooth och driver en simulerad helikopter. Helikoptern lättar när effekten överstiger deltagarens personliga lyfteffekt, som beror på kroppsvikten. Ju högre upp, desto tunnare luft och desto mer effekt krävs för att hålla höjden. Om effekten sjunker under det som krävs sjunker helikoptern. Poängen är den högsta höjd man når.

Designmål: flera strategier ska vara gångbara, till exempel explosivt upp, jämnt och länge, eller jämnt med slutspurt. Med standardparametrarna ligger den bästa insatsen runt 3–10 minuter, där både explosiva och uthålliga deltagare har chans.

## 2. Plattform

- Webbapp på en enda sida som körs lokalt i Chrome eller Edge på en dator kopplad till en storskärm.
- Web Bluetooth används för att läsa PM5. Det kräver säker kontext (https eller localhost), och anslutningen måste startas av ett användarklick. Fungerar inte i Safari/iOS eller Firefox.
- Ingen server behövs. Topplista och inställningar sparas lokalt i webbläsaren (localStorage).
- Valfri renderingsteknik; Canvas 2D räcker.
- Fysiken ska vara helt separerad från rendering och datakälla så att den kan testas och köras headless.

## 3. Datakälla: Concept2 PM5 via Bluetooth

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

Implementationer:

- **Pm5Source**: Web Bluetooth enligt ovan.
- **MockSource**: effekt styrs med reglage och piltangenter (±10 W). Genererar drag i en inställbar takt (standard 40 drag/min) med aktuell effekt, så att signalbehandlingen körs precis som med riktig erg.
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

| Namn | Standard | Betydelse |
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

- Vikten anges före start, som ett heltal mellan 20 och 200 kg. Rekommendation för eventet: ha en våg vid stationen, eftersom lägre angiven vikt gör det lättare att flyga.
- Två viktlägen väljs i inställningarna:
  - **Linjär** (`k = 1`, standard): ren W/kg. Tydlig berättelse: din vikt är lasten i helikoptern.
  - **Rättvis** (`k = 2/3`): motsvarar ungefär Concept2:s egen viktjustering (vikt i pund / 270, upphöjt till 0,222, omräknat från tid till effekt). Ren W/kg gynnar annars lätta personer på en SkiErg.
- Exempel på `P0`: 60 kg ger 75 W (linjär) eller 82,5 W (rättvis). 100 kg ger 125 W eller 116 W.
- Vikten visas aldrig på storskärmen och sparas inte i topplistan.
- `P0` och råa watt visas inte heller på storskärmen som standard. I linjärt läge går vikten att räkna ut direkt från lyfteffekten (vikt = P0 / 1,25). Använd relativa mått i stället (se avsnitt 8). Råa watt kan slås på i inställningarna.

## 7. Spelflöde

Tillstånd: `IDLE → SETUP → READY → COUNTDOWN → FLYING → FINISHED → IDLE`

- **IDLE**: vänteskärm med topplista och "Tryck för att starta".
- **SETUP**: operatören matar in namn eller alias, vikt och eventuell klass.
- **READY**: ergen är ansluten. Visa "Dra för att lyfta!".
- **COUNTDOWN**: 3-2-1. Drag under nedräkningen ignoreras. Fysiken nollställs.
- **FLYING**: fysik och UI körs, tiden räknas. Passet avslutas vid det första av följande:
  1. Helikoptern har varit i luften och sedan stått på marken med `P_smooth < P0` i `groundEndS` sekunder (standard 5).
  2. Inga drag på `idleEndS` sekunder (standard 10).
  3. `maxSessionS` har uppnåtts (standard 600 s, 0 = av).
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
- Milstolpar (konfigurerbara), standard: Åreskutan 1 420 m, Kebnekaise 2 097 m, Galdhøpiggen 2 469 m, Mont Blanc 4 806 m, Kilimanjaro 5 895 m, Mount Everest 8 849 m. Visa en kort notis när en milstolpe passeras.
- Tid sedan start.
- Topplista i IDLE och FINISHED med namn och höjd, aldrig vikt eller watt.
- Valfritt ljud: rotorljud vars tonhöjd följer `P_smooth / P0`.

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
Ett headless-skript som kör `ScriptedSource`-profiler genom samma signalbehandling och fysik och skriver ut `h_max`. Används för trimning. Profiler att ha med:
- Konstanta insatser enligt referenstabellen.
- Slutspurt: 4 min @ 235 W följt av 30 s @ 330 W.
- För hård start: 1 min @ 330 W följt av 5 min @ 215 W.

## 11. Byggordning

1. Fysikkärna, konfiguration, enhetstester och strategisimulator.
2. MockSource och grundläggande UI.
3. Pm5Source med Web Bluetooth och debugläge för råa bytes.
4. Spelflöde, topplista och inställningspanel.
5. Finputs: milstolpar, ljud och animationer.

## 12. Öppna punkter

- Standardparametrarna bygger på en antagen effektkurva. `G` och `H_air` ska trimmas efter tester med riktiga deltagare.
- Om linjärt eller rättvist viktläge ska vara standard.
- Om vågen ska kopplas direkt till spelet.s