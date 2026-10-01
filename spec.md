# Helikopterspelet – specifikation

Ett eventspel där en simulerad helikopter drivs av effekten från en Concept2 SkiErg. Målet är att komma så högt som möjligt.

## 1. Koncept

Deltagaren står på en SkiErg. Effekten (watt) läses live från ergens PM5-display via Bluetooth och driver en simulerad helikopter. Helikoptern lättar när effekten överstiger deltagarens personliga lyfteffekt, som beror på kroppsvikten. Ju högre upp, desto tunnare luft och desto mer effekt krävs för att hålla höjden. Om effekten sjunker under det som krävs sjunker helikoptern. Poängen är den högsta höjd man når.

Designmål: flera strategier ska vara gångbara, till exempel explosivt upp, jämnt och länge, eller jämnt med slutspurt. Med standardparametrarna ligger den bästa insatsen runt 3–5 minuter, där både explosiva och uthålliga deltagare har chans.

Spelet heter **Ergcopter**. På startskärmen väljer man grundspelet, "så högt som möjligt", eller **Fjällräddaren** med övningar, karriär och uppdrag. Den här specen beskriver grundspelet; Fjällräddaren beskrivs i `plan.md`. Standardvärdena för blandad publik står i avsnitt 12.

## 2. Plattform

- Webbapp på en enda sida som körs i Chrome eller Edge på en dator kopplad till en storskärm.
- PM5 läses via USB (WebHID) eller Bluetooth (Web Bluetooth). Båda kräver säker kontext (https eller localhost), och anslutningen måste startas av ett användarklick. USB ger även kraftkurvan. Fungerar inte i Firefox; på iPhone/iPad fungerar bara Bluetooth, via appen Bluefy.
- Ingen backend behövs: sidan är statiska filer. Den publiceras på GitHub Pages (https), och `server.js` eller Docker räcker för att köra lokalt. Topplista, inställningar och övningsframsteg sparas lokalt i webbläsaren (localStorage).
- En separat live-dashboard (`dashboard.html`) för operatören visar siffror och kraftkurva från PM via USB, med samma datakälla som spelet, plus medel- och maxeffekt och antal drag. Flyger spelet i en annan flik i samma webbläsare visar dashboarden också höjden och skillnaden mot det som krävs (`shared/live.js`, BroadcastChannel). Krävd effekt i watt skickas bara när råa watt är påslaget (avsnitt 6).
- Landskapet ritas i 3D med WebGL2 när webbläsaren och datorn klarar det (`terrain.js`), annars i Canvas 2D. Helikoptern, etiketterna, linjerna och höjdskalan ritas alltid i Canvas 2D ovanpå, och instrumenten är DOM.
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
- **MockSource**: genererar drag i en inställbar takt (standard 40 drag/min) med aktuell effekt och en påhittad kraftkurva, så att motorn och fysiken körs precis som med riktig erg. Används av `?demo`.
- **ScriptedSource**: spelar upp en fördefinierad effektprofil, till exempel "245 W i 300 s". Används av strategisimulatorn och testerna.

## 4. Motorn

PM5 rapporterar effekt per drag, ungefär var 1,2–2 sekund på en SkiErg. Varje drag redovisar rätt effekt, så spelet räknar inget medelvärde. Motorn (`engine.js`) gör dragen till en motoreffekt `P` som driver rotorn (avsnitt 5):

- Ett nytt drag identifieras på att `strokeCount` har ändrats. Dubbla notiser med samma räknare ignoreras.
- Motoreffekten är senaste dragets effekt. Den gäller tills nästa drag kommer.
- Kommer inget drag inom 1,25 × förra dragperioden stannar motorn och `P = 0`. Första draget, och första draget efter en paus, gäller i `maxStrokeS` sekunder (standard 3).
- Utjämningen mellan dragen kommer från rotorbladens massa, inte från motorn.

## 5. Fysikmodell

Helikoptern är en människodriven helikopter med fast bladvinkel. Motorn (avsnitt 4) driver rotorn, rotorns varv ger lyftkraften och lyftkraften mot tyngden ger accelerationen (`physics.js`).

All effekt uttrycks relativt deltagarens personliga lyfteffekt `P0`. Då skalar spelet automatiskt med kroppsvikten: alla flyger samma helikopter, skalad efter sin egen lyfteffekt.

```
P0       = P_ref * (bodyMass / m_ref) ^ k      // effekt som krävs för att sväva vid marken
P_req(h) = P0 * (1 + h / H_air)                // effekt som krävs för att hålla höjden h
σ(h)     = 1 / (1 + h / H_air)²                // luftens täthet relativt marken
n        = √(E / E0)                            // rotorvarv relativt hovringsvarvet vid marken
T / Mg   = σ * n²                               // lyftkraft relativt tyngden
dE/dt    = P - P0 * σ * n³ - T * v              // motor − luftförlust − arbete på helikoptern
dv/dt    = g * (T / Mg - 1)                     // acceleration
dh/dt    = v                                    // stig- eller sjunkhastighet (m/s)
```

med `E0 = 1,5 * rotorTauS * P0` (rotorns energi vid hovringsvarv vid marken) och tyngden `Mg = P0 / G`.

- **Rotorn** är ett energilager, som ergens svänghjul. `E` är rotorbladens rörelseenergi. Bladen har massa, så motoreffekten byter direkt vid ett drag men varvet gör det inte. Vid marken följer varvet motorn med tidskonstanten `rotorTauS`. Med standardvärdet 0,5 s har varvet kommit halvvägs efter 0,4 s och till 90 % efter 1,2 s. Högre upp snurrar rotorn fortare, och tidskonstanten växer med `1 + h / H_air`.
- **Lyftet** följer varvet, inte effekten. Luftens täthet är vald så att hovring på höjden h kräver exakt `P_req(h)`, eftersom hovringseffekten är ∝ 1/√ρ.
- **Stadig stigning** ger `v = G * (P - P_req(h)) / P0`, eftersom överskottet går till lägesenergi. Jämviktshöjden och τ är därför desamma som i den analytiska lösningen nedan.
- **Farten** följer effekten på ungefär `3G / 2g` sekunder: 2 s med standardvärdet g = 15 m/s², 3 s med jordens 9,81. `g` är ett spelval, eftersom världen redan är skalad.
- **Autorotation:** utan motor bär rotorn en kort stund, sedan faller helikoptern. När den sjunker driver fallet rotorn, eftersom arbetet `T * v` blir negativt. Fallet bromsas mot sluthastigheten `G * P_req(h) / P0`, alltså den stadiga farten vid 0 W. Farten slår först över en stund innan den lägger sig. Drar man grönt i hög fart fortsätter helikoptern nedåt en stund innan den vänder.
- **Last** (sandsäcken, patienten) ökar massan så att hovringen kräver `P0` för den nya vikten. Rotorn är densamma, så helikoptern sjunker tills varvet har hunnit upp.
- **Långa insatser** hamnar inom 1 % av den analytiska lösningen. Korta spurter tappar, eftersom rotorn och helikoptern först måste komma upp i fart: 30 s @ 450 W ungefär −3,5 % och 3 s nästan hälften.

- Integration med fast tidssteg `dt` = 0,05 s (20 Hz), uppdelat i inre steg på 0,01 s. Explicit Euler räcker.
- Rotorn står still när passet börjar.
- Markvillkor: om `h <= 0` och `dh/dt < 0` sätts `h = 0` och `dh/dt = 0`. Helikoptern står då kvar på marken tills lyftkraften är större än tyngden, alltså när motoreffekten har legat över `P0` så länge att rotorn hunnit varva upp. Vid sättningen sparas farten i nedslaget och farten nollställs. Ett skutt lägre än 0,1 m efter en sättning räknas inte som en ny sättning.
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
| `g` | 15 m/s² | Tyngdacceleration. Styr hur fort farten följer effekten, ungefär `3G / 2g` |
| `rotorTauS` | 0,5 s | Rotorbladens massa: tidskonstanten för varvet vid hovring vid marken |
| `maxSinkRate` | av | Maximal sjunkhastighet (m/s) |
| `dt` | 0,05 s | Fysikens tidssteg |
| `maxStrokeS` | 3 s | Längsta tid ett drag driver motorn |

### Balans och trimning

- Tidskonstanten `τ = H_air / G` (standard 120 s) avgör vilken strategi som vinner. Större τ, alltså en trögare helikopter, gynnar uthållighet. Mindre τ gynnar explosivitet.
- Jämviktshöjden vid konstant effekt är `h_eq = H_air * (P / P0 - 1)`.
- För att ändra höjdskalan utan att ändra balansen: ändra `H_air` och `G` med samma faktor.

### Analytisk lösning och referensvärden

Från marken med konstant effekt `P > P0`, i gränsen där rotorn och farten ställer in sig direkt. Fysiken ligger inom 1 % av den för insatser från 3 minuter och uppåt:

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
- Flygloggen (avsnitt 9.1) har effekten i procent av `P0` och ingen vikt. `P0` i watt tas med bara när råa watt är påslaget.
- Samma regel gäller överallt på storskärmen: inmatningen visar lyfteffekten i watt bara med råa watt (annars "Räknas från vikten"), vikten skrivs i ett dolt fält, instrumenten visar "Din effekt" och "Krävd effekt här" i watt bara med råa watt, och resultatet visar medel- och maxeffekt i procent av lyfteffekten.

## 7. Spelflöde

Tillstånd: `IDLE → SETUP → MENU → READY → COUNTDOWN → FLYING → FINISHED → IDLE`

Läget väljs på startskärmen. "Så högt som möjligt" (det som beskrivs här) går från SETUP direkt till READY. Fjällräddaren går till MENU, där deltagaren väljer en övning, en lektion eller uppflygningen (se `plan.md` §3); efter skolan går FINISHED tillbaka till MENU. Alla flygningar förs in i deltagarens loggbok.

- **IDLE**: startskärmen med loggan ERGCOPTER, "Driv högre. Nå längre." och menyn: Så högt som möjligt, Fjällräddaren, Inställningar, Topplista och Flygloggar, plus Demo (`?demo`) nere till vänster. Enter väljer Så högt som möjligt, piltangenterna flyttar mellan valen. Topplistan visas med knappen, efter en fri flygning och av sig själv när ingen rört spelet på 30 s (20 s topplista, 30 s meny, om och om igen). Bakom flyger helikoptern en demotur (`attract.js`) i kvällsljus: den lyfter, stiger förbi topparna och genom molntäcket till 2 300 m, sjunker och landar, om och om igen. Demoturen är bara bild, låter inte och påverkar inte topplistan.
- **SETUP** (Ny flygning): operatören matar in namn eller alias (valfritt, tomt blir "Anonym"), ålder och vikt. Åldern ger klassen (avsnitt 12.2) och sparas inte. Ergen måste vara ansluten; anslutningen finns överst i formuläret.
- **READY**: ergen är ansluten. Visa "Dra för att lyfta!".
- **COUNTDOWN**: 3-2-1. Drag under nedräkningen ignoreras. Fysiken nollställs.
- **FLYING**: fysik och UI körs, tiden räknas. Passet avslutas vid det första av följande:
  1. Helikoptern har varit i luften och sedan stått på marken med motoreffekt under `P0` i `groundEndS` sekunder (standard 5).
  2. Inga drag på `idleEndS` sekunder (standard 10).
  3. `maxSessionS` har uppnåtts (standard 480 s, 0 = av).
  4. Operatören trycker Esc.
- **FINISHED**: resultatet till vänster i kvällsljus, med landningen uppspelad snabbspolad på högst 3 sekunder till höger. Överst vilket rekord det blev (`core/results.js`): nytt rekord i klassen, dagens rekord i klassen (minst två flygningar) eller nytt personligt rekord (samma namn och klass, inte anonyma), annars namn och klass. Sedan maxhöjden, en mening om topparna ("Du flög högre än Helags men nådde inte helt till Kebnekaise."), tid, medel- och maxeffekt, antal drag och placering i klassen, och de två senast passerade topparna plus nästa. "Flyg igen" går till READY med samma deltagare. "Till topplistan", tangenttryck eller `resultDisplayS` sekunder (standard 15) går till IDLE med topplistan.

Poäng: `h_max`. Spara namn, `h_max`, tid till `h_max`, klass och tidsstämpel.

## 8. UI (storskärm)

Utseendet följer en mockup: mörka glaspaneler ovanpå scenen, rubriker och siffror i Barlow Condensed (SIL OFL, i `public/fonts/` så att spelet fungerar utan nät), blå knapp för huvudvalet och grön för att starta. Panelerna är mörka i både ljust och mörkt tema; bara inställningspanelen följer temat.

- **Höjdskala** till vänster från marken till en bit över det man siktar på, i fasta steg (2 000, 3 000, 5 000 m …; i skolan 250–1 500 m). Aktuell höjd står i en blå ruta på skalan som en mekanisk räknare där siffrorna rullar; över 15 m/s byts de direkt, eftersom de ändå inte hinner rulla klart. Skalan visar också milstolparna, dagens rekord och maxhöjden i passet som små markeringar. Kameran följer helikoptern och visar marken när höjden är låg.
- **Effekt (relativ)** uppe till höger (det centrala elementet): `P / P_req(h) − 1` i procent, där `P` är motoreffekten, alltså senaste dragets effekt. Den ändras vid varje drag, så att man direkt ser om draget var för lätt eller för hårt. ±0 % betyder att draget håller höjden när rotorn och farten har ställt in sig. På marken visas `P / P0 − 1`. Stapeln har ett vitt streck för att hålla höjden en tredjedel in; grönt växer åt höger upp till +200 % och rött åt vänster ned till −100 %, tätare nära strecket. Från +100 % lyser stapeln. Bredvid står maxhöjden i passet och dagens rekord, eller "Din effekt" och "Krävd effekt här" i watt när råa watt är påslaget.
- **Variometer** nere till höger: en rund mätare för stig- och sjunkhastighet med noll klockan nio och stigning uppåt, tätare skala nära noll (0, 10, 20, 50 m/s). I övningarna står stigningen i panelen i stället.
- Tid sedan start nere till vänster, som 02:14.
- Rotorns animation följer fysikens rotorvarv under flygningen. Före lyftet följer den ergen (kraftkurvan, eller `P / P0` utan kraftdata), så att deltagaren ser respons redan innan helikoptern lättar.
- Horisontella linjer för dagens rekord och maxhöjden i passet.
- Milstolpar (konfigurerbara): verkliga toppar från Jämtland och Härjedalen via Norge och Europa upp till Mount Everest, tätare där de flesta pass slutar (800–2 500 m). Listan med källor finns i `milestones.js`. Varje topp får en etikett i glas ovanför: namn, höjd och en bock när toppen är passerad; etiketten lyfts över helikoptern när den kommer nära. Når man en topp sprutar det konfetti, och en banderoll ("Topp passerad") visas.
  - **I 3D** (`peaks3d.js`) står toppen 2,6–10 km bort med sin riktiga höjd, som en spetsig eroderad topp med förberg. Kameran står på helikopterns höjd och tittar rakt fram, så toppen ligger på helikopterns linje precis när helikoptern når höjden, hur långt bort den än står. Topparna kommer in utanför högerkanten och glider fram mot en plats strax höger om helikoptern dit de ska nå när helikoptern når höjden, förutsagt från stighastigheten. Ändras stigningen styrs en topp som inte passerats mjukt: den glider högst 45 % fortare eller långsammare än landskapet omkring, alltid åt vänster. Svävar man skickas inga nya toppar, och en topp som inte hinner in i bild före passagen visas inte.
  - **I 2D** ritas topparna som berg med snö och skugga som passerar under helikoptern, med samma etiketter. En topp högt över helikoptern ritas genomskinlig, som om den låg långt bort.
- Landskapet visar höjden utan siffror. **I 3D** (`terrain.js`, WebGL2) strålföljs terrängen i en fragment-shader som i Inigo Quilez "Elevated": platt dalbotten med helikopterplattan, en sjö bakom som speglar fjällen och molnen, skog och myr, kullar och sedan alpina fjäll med snö på allt som inte är för brant, mjuka skuggor, molnskuggor och dis som tätnar nära marken. Stackmoln i 3D mellan 1 250 och 2 350 m (glesare på kvällen) som man flyger igenom och ser ovanifrån högre upp, slöjmoln högt upp, och himlen mörknar med höjden tills stjärnorna syns. Kameran har samma skala som 2D-scenen i helikopterns plan, 400 m framför kameran, så plattan, marken och linjerna hamnar rätt. Under flygningen är det dag; på start- och resultatskärmen står kvällssolen lågt till höger. Upplösningen sänks automatiskt om bilderna tar för lång tid, och räcker inte ens lägsta upplösningen ritas landskapet i 2D resten av besöket. Shadern byggs i bakgrunden; tills den är klar ritas 2D. **I 2D** (`scenery.js`): taggiga fjällkedjor i tre lager med snö och skuggsida som sjunker undan när man stiger, en sjö i dalen och helikopterplattan med gul cirkel, ett molntäcke vid 1 900–2 040 m och norrsken högt upp.
- Helikoptern är en räddningshelikopter i vitt och rött som en H135 (`heli-draw.js`): välvd vindruta, skjutdörr, motorkåpa med luftintag, vinsch, sökarljus, stabilisator och inbyggd stjärtrotor (fenestron) i fenan. Lacken skuggas som en rundad kropp med blank högdager och rutorna speglar himlen, varmare i kvällsljus. Rotorbladen syns när rotorn går sakta och blir en skiva i fart.
- Utan grafikprocessor (programvarurendering i webbläsaren) används inte 3D, eftersom varje bild då tar flera sekunder.
- Fartkänsla (`effects.js`): fartstreck och en lätt utzoomning när man stiger eller faller fort, damm från rotorvinden nära marken, och helikoptern gungar i luften och skakar i full stigning. Allt detta är bara bild och påverkar inte fysiken.
- Topplista per klass på startskärmen med namn och höjd, aldrig vikt eller watt (avsnitt 12.2).
- Valfritt ljud: helikopterljud som följer motoreffekten `P / P0`. Hovring (100 %) ger fullt rotorvarv; över 100 % låter det mer (bladslag, dunk, volym) upp till taket 300 %, med tydlig skillnad vid 200 %.

## 9. Inställningar och data

- Alla parametrar ligger i ett samlat konfigurationsobjekt.
- Inställningspanel för operatören (tangent S, kugghjulet eller Inställningar på startskärmen) med redigering och återställning till standard. Sparas i localStorage. Under Visning går 3D-landskapet att stänga av, t.ex. på en dator med svag grafik.
- Topplistan kan exporteras som JSON eller CSV och rensas (med bekräftelse).

### 9.1 Flygloggen

Varje flygning spelas in (`flightlog.js`), så att man i efterhand kan se vilka moment som är svåra och varför. Loggen är text som går att klistra in i en chatt för analys.

- **Huvud:** övning, helikopter, parametrar, resultat och de slumpvärden övningen drog (när motorn stannar).
- **Sammanfattning** per moment och steg: tid och utfall, antal drag, snitteffekt och hur mycket effekten ändras från drag till drag, höjder, vändningar (farten byter riktning) och sättningar. I ett landningssteg räknas dragen under 25 m: hur många som leder till en mjuk sjunk, hur många som får helikoptern att stiga och hur många som sjunker för fort. Kraftkurvan sammanfattas med toppkraft och hur lång tid det tar från att kraften börjar tills effekten når motorn.
- **Händelser:** steg, instruktörens besked, lyft, sättningar med fart, motorstopp, övertagande, paus och slut.
- **Drag:** flygtiden då motorn fick draget, effekten, höjd och fart, effekten mot det som krävs (`P / P_req` i %, instrumentet visar samma minus 100), stigfarten draget leder till, om draget drev motorn (ok, dubblett, paus eller motorstopp) och kraftkurvan i N med tiden från första sampel (USB och demo).
- **Spår:** höjd, fart, lyftkraft mot tyngd och motoreffekt var 0,5 s, och var 0,1 s under 25 m och när farten ändras fort (fall och hämtningar).
- **Integritet (avsnitt 6):** effekten står i procent av lyfteffekten `P0` utan last, aldrig i watt, och vikten finns inte med.
- **Uppspelning:** fysiken räknas relativt `P0`, så dragen och slumpvärdena räcker för att flyga samma pass igen genom spelet (`replayLog` i `sim.js`). `npm run flightlog -- logg.txt` skriver ut sammanfattningen, de sista dragen före varje sättning och hur väl uppspelningen följer loggen. Med `--set rotorTauS=1` provas samma drag med andra parametrar; spelaren hade förstås flugit annorlunda, så det är en fingervisning.
- **I gränssnittet:** Flygloggar på startskärmen (tangent L) listar de 10 senaste flygningarna med Spela upp, Kopiera och Ladda ned. De sparas i localStorage (`skierg.flightlog.v1`); blir lagringen full släpps de äldsta. Går urklippet inte att använda visas loggen markerad, så att man kan kopiera den själv.
- **Uppspelning** (`logplayer.js`): höjden över tiden som en linje över fjälltopparna man passerade, med toppen där linjen nådde höjden. Linjen är grön när helikoptern stiger, gul när den håller höjden och röd när den sjunker; sättningar är vita prickar vid marken och helikoptern ritas där den var. Spela och pausa (mellanslag), spola med reglaget eller piltangenterna och välj fart 1–16×. Topparna och sättningarna läses ur loggens händelser (`logTimeline` i `flightlog.js`).
- En övning på ett par minuter ger 20–60 kB, mest spåret nära marken och kraftkurvorna.

## 10. Tester

**Fysik**
- Den analytiska lösningen ger referenstabellen i avsnitt 5 (tolerans 0,5 %). Fysiken ligger inom 1 % av den från 3 minuter och inom 7 % på 30 s. Korta spurter tappar.
- 80 kg och 90 W: helikoptern lättar aldrig.
- Höjden blir aldrig negativ.
- Effekt och sedan 0 W: helikoptern sjunker, landar på 0 och blir stående.
- Hovring på höjden h kräver exakt `P_req(h)`. Stadig stigning ger `G * (P - P_req) / P0`.
- Bladen har massa: motoreffekten byter direkt, men varvet följer efter, åt båda hållen.
- Utan motor faller helikoptern och autorotationen bromsar fallet.
- En mjuk sättning mäts med farten i första nedslaget.

**Viktskalning** (tolerans ±0,1 W)
- `k = 1`: 60 kg → 75,0 W, 80 kg → 100,0 W, 100 kg → 125,0 W.
- `k = 2/3`: 60 kg → 82,5 W, 100 kg → 116,0 W.

**Motorn**
- Varje drag gäller för sig, utan medelvärde, och hålls tills nästa drag.
- Motorn stannar när nästa drag dröjer mer än 1,25 × förra perioden.
- Dubbletter av samma `strokeCount` ignoreras.

**Flygloggen** (`test/flightlog.test.js`)
- Dragen, spåret, stegen och sättningarna spelas in. Spåret är tätt nära marken och glest högre upp.
- Effekten står i % av `P0`; `P0` i watt bara med råa watt påslaget.
- Drag som inte driver motorn märks: dubblett, paus och motorstopp. Kraftkurvan hör till nästa drag.
- Texten går att läsa tillbaka, även med annan text runt omkring.
- Uppspelningen flyger samma pass: samma utfall och sättningar, och höjden skiljer under 0,1 m.
- De 10 senaste loggarna sparas; blir lagringen full släpps de äldsta.

**Resultatet** (`test/results.test.js`)
- Topparna kring maxhöjden, meningen om höjden och vilket rekord det blev: i klassen, i dag eller personligt.

**Topparna i scenen** (`test/flyover.test.js`, `test/peaks3d.test.js`)
- 2D: bergen passerar strax under helikoptern när den når toppens höjd.
- 3D: i jämn stigning och i allt tunnare luft passeras varje topp i bild strax höger om helikoptern; stiger man i omgångar syns topparna ändå när de passeras, och svävar man skickas inga nya in. Landskapet får kameran på helikopterns höjd och plattan i helikopterns plan.

**Strategisimulator** (utvecklarverktyg)
Ett headless-skript (`npm run simulate`) som kör `ScriptedSource`-profiler genom samma motor och fysik och skriver ut `h_max`. Används för trimning. Profilerna står i avsnitt 12.3.

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

- Klasserna är **Barn** (till och med 12 år), **Ungdom** (13–17 år) och **Vuxen** (18 år och äldre). Inmatningen frågar efter åldern och räknar fram klassen (`classForAge` i `config.js`). Bara klassen sparas, aldrig åldern.
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

`test/defaults.test.js` kontrollerar standardvärdena, `P0`-tabellen, förväntat utfall och balanskontrollen (analytiskt ±0,5 %, fysiken ±1 %), viktgränserna 15–200 kg, att förhandsvisningen räknas om, klasserna och topplistan per klass.

## 13. Öppna punkter

- Standardparametrarna bygger på en antagen effektkurva. `G` och `H_air` ska trimmas efter tester med riktiga deltagare.
- Om linjärt eller rättvist viktläge ska vara standard.
- Om vågen ska kopplas direkt till spelet.