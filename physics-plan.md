# Ny fysik: rotorn som energilager

Plan för att ersätta signalbehandlingen (spec §4) och fysikmodellen (spec §5).

Utgångspunkten är att varje drag redovisar rätt effekt. Då ska inget medelvärde ligga mellan draget och helikoptern. Den utjämning som finns kvar ska komma ur fysiken, alltså ur rotorns och helikopterns massa.

## Status

Byggt med g = 15 m/s² och rotorbladens massa 0,5 s. Spec §4–5 beskriver nu modellen och gäller före den här planen. Steg 1–9 i byggordningen (§6) är klara, men steg 10, att prova på riktig erg, återstår.

Avvikelser från planen:

- **Ljudet** följer motoreffekten `P / P0` som förut, inte rotorvarvet. Ljudmodulen har en egen rotor med tröghet och en gas där 1 är hovring och 3 är max. Med varvet skulle det låta som hovring även i en hård stigning, eftersom varvet är detsamma i stadig stigning som i hovring.
- **Rotorvarv och lyftkraft** visas på raden med råa watt, som syns när operatören slår på råa watt, och inte i debugpanelen.
- **Mjuka sättningar:** vid en mjuk sättning är lyftkraften nästan lika stor som tyngden, så helikoptern kunde skutta en bråkdel av en millimeter och skriva över landningsfarten. Ett skutt lägre än 0,1 m räknas inte längre som en ny sättning.
- **`runPhysicsOnly`** räknar med uppbromsningen efter profilen, alltså farten helikoptern har kvar när effekten slutar, så att "Fysik" i simulatorn är samma maxhöjd som spelet ger.
- **Autorotationen slår över:** utan motor faller helikoptern först fortare än sluthastigheten (omkring 40 m/s mot 30 m/s från 1 000 m) innan autorotationen bromsar.
- **Fritt fall:** autopiloten hämtar nu upp ungefär 50 m under gränsen i stället för 30 m, eftersom rotorn måste varva upp. Hovringen har i stället blivit exaktare: i snitt 3 m från målet i stället för 5 m.

## 1. Varför

I dag går effekten genom tre led som inte är fysik:

- **Medelvärde över 3 drag** (`smoothingStrokes`). Ett nytt drag ger bara en tredjedel av ändringen.
- **Håll i 3 s och tona ned under 1 s** (`strokeTimeoutS`, `fadeOutS`). Slutar man dra märks det först efter 3–4 s.
- **Farten jagar en målfart** med 2 s tidskonstant (`inertiaS`). Det är ett påhittat luftmotstånd, och det finns ingen rotor.

Vid 30 drag/min ger ett enda drag på +20 % sin högsta fart först efter 6 s, alltså tre drag senare. Efter två drag syns 41 % av höjdvinsten (§3).

## 2. Modellen

Helikoptern är en människodriven helikopter med fast bladvinkel, som AeroVelo Atlas. Ergen driver rotorn, och rotorns varv ger lyftkraften. Kedjan är drag → motor → rotor → lyftkraft → helikopter.

```
Motorn    P_motor(t) = P_k                          senaste dragets effekt, tills nästa drag
Luften    σ(h)       = 1 / (1 + h / H_air)²         täthet relativt marken
Rotorn    n          = √(E / E0)                    varv relativt hovringsvarvet vid marken
          dE/dt      = P_motor − P0·σ·n³ − T·v      motor − luftförlust − arbete på helikoptern
Lyftet    T / Mg     = σ · n²
Farten    dv/dt      = g · (σ · n² − 1)
Höjden    dh/dt      = v
```

Här är `E0 = 1,5 · rotorTauS · P0` rotorns energi vid hovringsvarv och `Mg = P0 / G`, så `T·v = (P0 / G) · σ · n² · v`.

**Motorn** ersätter `signal.js`:

- Varje drag sätter motoreffekten till dragets effekt `P_k`. Den gäller tills nästa drag kommer. Inget medelvärde.
- Kommer inget drag inom 1,25 × förra dragperioden (högst `maxStrokeS`), stannar motorn och `P_motor = 0`. Rotorn varvar då ned av sig själv. Första draget, eller första draget efter en paus, gäller i `maxStrokeS`.
- Dubbla notiser med samma `strokeCount` ignoreras, som i dag.

**Rotorn** är ett energilager, precis som ergens svänghjul. Den tar emot motoreffekten, förlorar energi till luften (∝ varv³) och gör arbete på helikoptern när den stiger. När helikoptern sjunker går arbetet åt andra hållet: fallet driver rotorn. Det är autorotation.

**Rotorbladen har massa.** Motoreffekten byter direkt när ett nytt drag kommer, men varvet gör det inte. Bladens rörelseenergi är `E = ½·I·ω²`, och varvet ändras bara så fort som nettoeffekten hinner fylla på eller tömma den. Nettoeffekten är motorn minus luftförlusten minus arbetet på helikoptern. Lyftet följer varvet, inte effekten. `rotorTauS` är bladens massa uttryckt som tid, och tröghetsmomentet `I` väljs så att `E` vid hovringsvarv vid marken blir `1,5 · rotorTauS · P0`.

Så här följer varvet när motoreffekten byts, räknat för 80 kg (`P0` = 60 W) och med helikoptern stilla på höjden. Varje ruta visar tiden tills varvet har ändrats halvvägs / till 90 %:

| `rotorTauS` | 300 m, 70 → 105 W | 300 m, 105 → 70 W | 4 200 m, 200 → 300 W | 4 200 m, 300 → 200 W |
|---|---|---|---|---|
| 0,5 s | 0,4 s / 1,2 s | 0,4 s / 1,3 s | 1,0 s / 3,3 s | 1,2 s / 3,8 s |
| 1 s | 0,7 s / 2,3 s | 0,8 s / 2,7 s | 2,0 s / 6,7 s | 2,3 s / 7,7 s |
| 2 s | 1,4 s / 4,7 s | 1,6 s / 5,4 s | 4,0 s / 13,4 s | 4,6 s / 15,3 s |

Varvet ändras ±13–14 % i alla fallen, eftersom varvet växer som effekten upphöjt till 1/3.

- **Tunn luft gör bladen tyngre.** Högre upp bromsar luften bladen mindre och rotorn snurrar fortare. Tidskonstanten växer därför med `(1 + h / H_air)`: på 4 200 m är den 3,3 gånger så lång som vid marken.
- **Nedvarvning går lite långsammare än uppvarvning**, eftersom luftens broms avtar när varvet sjunker.
- **Tyngre blad jämnar ut dragen men för tillbaka fördröjningen.** Det är samma avvägning som medelvärdet i dag, men den kommer nu ur fysiken och varvet börjar ändras direkt. Med tunga blad (2 s) går det också att ge rotorn dragets energi i stötar som den faktiskt kommer (§4), utan att helikoptern hoppar mer än ±3 m.

**Allt räknas relativt spelarens `P0`.** Alla flyger alltså samma helikopter, skalad efter sin egen lyfteffekt, och rättvisan i spec §6 ändras inte.

### Det som följer av modellen

Kontrollerat i en prototyp:

- Att hovra på höjden h kräver exakt `P_req(h) = P0 · (1 + h / H_air)`, som i dag. Luftens täthet är vald så, eftersom hovringseffekten är ∝ 1/√ρ enligt rörelsemängdsteorin.
- Stadig stigning ger `v = G · (P − P_req(h)) / P0`, samma som dagens målfart. Jämviktshöjderna och τ = `H_air / G` ändras inte. Pass från 3 min och uppåt landar inom 1 % av dagens höjder.
- Utan motor faller helikoptern med g tills autorotationen bromsar fallet vid −G (20 m/s). Det är samma sluthastighet som i dag, men nu kommer den ur fysiken. Övningen Motorstopp blir en riktig autorotation.
- Lyftet börjar ändras när draget kommer, men bara så fort som bladens massa tillåter (tabellen ovan).
- Korta spurter tappar höjd, eftersom rotorn måste varva upp först och lyftet bara växer som effekten upphöjt till 2/3. 3 s @ 500 W går från 355 till ungefär 275 m, och 30 s @ 350 W tappar 1,5 %.
- Explicit Euler med `dt` = 0,05 s räcker. Det ger samma maxhöjder som 0,01 s.

### Parametrar

| Namn | Standard | Betydelse |
|---|---|---|
| `g` | 15 m/s² | Tyngdacceleration. Styr hur fort farten följer effekten, ungefär `3G / (2g)`: 2 s vid 15, 3 s vid 9,81 |
| `rotorTauS` | 0,5 s | Rotorbladens massa, uttryckt som tidskonstanten för varvet vid hovring vid marken. Växer med höjden |
| `maxStrokeS` | 3 s | Längsta tid ett drag driver motorn |

- Tas bort: `smoothingStrokes`, `strokeTimeoutS`, `fadeOutS` och `inertiaS`. `sanitize` rensar sparade värden av sig själv.
- Oförändrade: `P_ref`, `m_ref`, `weightMode`, `H_air`, `G`, `maxSinkRate` och `dt`.
- Förslaget är g = 15 och inte 9,81. Världen är redan skalad (G = 20 m/s per P0 överskott), så g är ett spelval. Med 9,81 tar det ungefär 3 s att nå en ny stigfart, vilket är längre än dagens 2 s.

## 3. Siffror från prototypen

Förutsättningar: 30 drag/min och hovring på 300 m. "Ett drag" betyder ett enda drag 20 % över hovring och sedan hovring igen. "Sjunker" betyder att sjunkfarten har nått 1 m/s. Alla nya varianter har `rotorTauS` = 0,5 s.

| Modell | Ett drag: högsta fart efter | Ett drag: andel av höjdvinsten efter 2 drag | Slutar dra: sjunker efter | Fartens brus vid ±5 % brus i effekten |
|---|---|---|---|---|
| I dag (3 drag, tröghet 2 s) | 6,0 s | 41 % | 3,5 s | ±1,0 m/s |
| I dag med 1 drag | 2,0 s | 82 % | 3,5 s | ±1,6 m/s |
| Ny, g 9,81 | 2,6 s | 58 % | 3,0 s | ±1,0 m/s |
| **Ny, g 15 (förslag)** | 2,4 s | 75 % | 2,9 s | ±1,4 m/s |
| Ny, g 20 | 2,3 s | 86 % | 2,8 s | ±1,7 m/s |

- Det mesta av fördröjningen i dag kommer från medelvärdet och hållningen, och båda försvinner. Det som är kvar är fysik: det tar tid att ändra farten på en helikopter, och g avgör hur lång tid.
- Ju kvickare helikoptern svarar, desto mer syns variationen mellan dragen. g är ratten mellan de två.

## 4. Varianter som provades och valdes bort

- **Hela dragets energi direkt när draget kommer.** Helikoptern hoppar ±3–15 m per drag, beroende på rotorns tröghet (2–0,5 s). Utan hopp blir rotorn så tung att den blir trög igen.
- **Dragets energi utspridd över dragets egen längd.** Energin blir exakt, men ojämn takt ger luckor och överlapp. ±10 % i takt gav ±2–4 m/s i ryck.
- **Dagens modell med 1 drag.** Den svarar lika fort, men den är ingen fysik: det finns ingen rotor och ingen autorotation, och farten jagar en målfart.

## 5. UI

- **Lyftmätaren** visar senaste dragets effekt mot `P_req(h)` och uppdateras vid varje drag. 100 % betyder att draget håller höjden. Den återkopplingen per drag saknas i dag.
- **Rotorn och ljudet** följer rotorvarvet `n` i stället för effekten, så man ser och hör varje drag.
- **Debug (D)** visar `n`, `T/Mg` och motoreffekten.
- **Integriteten** (spec §6) ändras inte: storskärmen visar procent, aldrig watt.

## 6. Byggordning

1. **`core/engine.js`** ersätter `signal.js`. Klassen `Engine` får `stroke()`, `power(t)` och `reset()`. Tester: effekten gäller tills nästa drag, motorn stannar efter 1,25 × perioden, dubbletter ignoreras och inget medelvärde räknas.
2. **`core/physics.js`** får en ny `Flight` med tillstånden `E`, `v` och `h`. API:t utåt är detsamma (`step(power)`, `requiredPower`, `liftRatio`, `setLoad`, `clone`, `touchdown`, `ceiling`), plus `rotorSpeed` och `thrustRatio`. Tester:
   - hovring på `P_req(h)` på flera höjder,
   - stadig stigning,
   - autorotation vid −G,
   - fritt fall som börjar med g,
   - rotorns tidskonstant,
   - energibalans: motorns energi = rotorns energi + lägesenergi + rörelseenergi + luftförluster.
3. **Byt `StrokeSmoother` mot `Engine`** i `game.js`, `sim.js` och förhandsvisningen i `main.js`. Motorstopp nollställer motorn som i dag, och instruktörens effekt i `effectivePower` blir motoreffekt.
4. **`config.js`:** de nya parametrarna läggs i både `DEFAULT_CONFIG` och `CONFIG_SCHEMA`, och de gamla tas bort.
5. **Sandsäcken (`setLoad`):** lasten ökar massan. Tyngden väljs så att hovringseffekten blir `P0'` som i dag. När lasten hakas på sjunker helikoptern tills rotorn har varvat upp.
6. **UI:** lyftmätaren per drag, och rotor och ljud efter `n`.
7. **Kalibrering:** kör `npm run simulate` och uppdatera sedan referenstabellen i spec §5 och §12.3, `calibration.js` och `defaults.test.js`. Korta spurter ändras mest.
8. **Övningarna:** kör `npm run exercises`. Autopiloten bygger på samma jämviktssamband och bör fungera, men landningsfarter och stjärngränser kan behöva trimmas. Kommentaren om medelvärdet i `autopilot.js` tas bort.
9. **Dokumentation:** spec §4 (Motorn i stället för Signalbehandling), §5 och §12, plan.md §8 (tröghet) och strukturen i CLAUDE.md.
10. **Riktig erg:** prova g och `rotorTauS`, faktorn 1,25 och första draget efter en paus.

## 7. Senare

- **Effekt under draget (USB).** Kraftkurvan kommer var 50:e ms, och på ergens svänghjul är effekten ungefär ∝ kraft^1,5. Motorn kan alltså få effekt medan man drar, skalad efter förra draget och rättad när dragets effekt kommer. Det tar bort det halva drag man i dag väntar på att draget ska ta slut. Nackdelen är att energin kommer i stötar och att helikoptern hoppar per drag, så det provas först när grundmodellen fungerar.
- **Helikoptertyper med olika rotortröghet** (plan.md §4), till exempel en tyngre och trögare räddningshelikopter.
- **Riktig atmosfär** med exponentiell täthet. Den ändrar balansen, eftersom jämviktshöjden blir logaritmisk i effekten, och kräver ny kalibrering.

## 8. Öppna frågor

- Är PM:ens effekt för första draget efter en paus rimlig? Det kontrolleras med D-loggen.
- Är 2,9 s från sista draget tills helikoptern sjunker för långt? Att någon har slutat går inte att veta förrän nästa drag uteblir. USB ser dragfasen och skulle kunna stoppa motorn tidigare när återtaget drar ut på tiden.
- Är förlusten för korta spurter i "så högt som möjligt" acceptabel?
- Hur tunga ska bladen vara? 0,5 s är lätta blad och ger kvick respons. 1–2 s känns tyngre och jämnare men är långsammare. Det avgörs på ergen.
- Ska rotorn få bli trögare högt upp? Det är fysik, men på 4 000 m och uppåt blir den tre gånger så trög som vid marken.
