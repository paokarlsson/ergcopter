# Fjällräddaren – plan

En utbyggnad av helikopterspelet (se `spec.md`). Man börjar som aspirant i fjällräddningen, övar moment med en skolhelikopter och får med tiden skarpa räddningsuppdrag. Man väljer alltid själv om man tar ett uppdrag eller en övning.

Status: idéstadium. Inget är byggt än.

## 1. Grundidé

- Input är som i dag: namn, vikt och ålder.
- Fysiken är densamma som i dag (spec §5). Allt nytt byggs ovanpå: övningar, uppdrag, helikoptertyper och karriär.
- Det gamla läget, "så högt som möjligt" med topplista, finns kvar som ett eget läge tills vidare.

### Designprincip: inte bara styrka och kondition

Det gamla läget mäter i princip bara styrka och kondition. Fjällräddaren ska belöna fler saker:

- **Precision:** hålla ett höjdband och landa mjukt. Alla mål uttrycks relativt den egna lyfteffekten `P0`, så en lätt eller otränad spelare har samma chans. Att hovra på 300 m kräver bara 11 % över `P0`.
- **Timing och läsförmåga:** sluta och börja veva i rätt ögonblick, parera en luftgrop, utnyttja uppvind.
- **Hushållning:** fördela krafterna över ett långt uppdrag i stället för att ta ut sig tidigt.
- **Beslut:** ta uppdraget eller inte, vänta ut vädret, välja flyghöjd, vända i tid.

Uppdrag bedöms därför på precision, säkerhet och beslut, inte på hur högt man kommer. Låga höjder är det som jämnar ut skillnaden i styrka, så de flesta moment bör ligga där.

### Varför fysiken passar

- **Patienten blir last.** Lyfteffekten räknas från vikten, `P0 = P_ref · (m / m_ref)^k`. En patient som plockas upp ökar `m` mitt i passet, och man måste dra hårdare för att komma hem. Det krävs ingen ny fysik, bara en ny vikt.
- **Att hovra är ren uthållighet.** Varje höjd kräver effekten `P_req(h)`. Ett moment som "håll dig på 845 m i 20 s medan vinschen går" blir ett jämnt tröskelpass på ergen.
- **Topparna finns redan.** `milestones.js` har riktiga toppar med höjder, till exempel Suljätten 845 m, Mullfjället, Åreskutan och Helags. De kan bli platserna för uppdragen.

## 2. Karriär

| Grad | Helikopter | Innehåll |
|---|---|---|
| Aspirant | Skolhelikopter | Bara övningar från verkstan, inga skarpa räddningar |
| Junior fjällräddare | Lätt räddningshelikopter | Enklare uppdrag: Suljätten, Mullfjället, Drommen, en patient |
| Fjällräddare | Lätt räddningshelikopter | Åreskutan, tidsgräns (patienten blir nedkyld) |
| Senior fjällräddare | Tung räddningshelikopter | Helags, två personer, byig vind och luftgropar |
| Räddningsledare | Tung räddningshelikopter | Kebnekaise, mörker, flera hämtningar i samma pass |

- Man går upp i grad genom erfarenhet från godkända övningar och uppdrag.
- Från aspirant till junior krävs en godkänd examensflygning (se 3.5).

## 3. Aspirant: övningar från verkstan

Aspiranten är inte betrodd med skarpa räddningar. Hen får öva momenten och göra testflygningar från verkstan. Varje övning tränar ett moment som kommer tillbaka i de skarpa uppdragen.

| # | Övning | Mål | Tränar |
|---|---|---|---|
| 1 | Första lyftet | Lyft till 50 m och landa igen | Att hitta lyfteffekten |
| 2 | Hovring | Håll dig på 300 m ±25 m i 30 s | Jämn effekt (vinschen senare) |
| 3 | Höjdflygning | Stig till 1 000 m och landa sedan mjukt vid verkstan | Kontrollerad nedstigning |
| 4 | Fritt fall | Stig till 1 000 m, sluta veva, fall till 500 m och fånga upp helikoptern där | Timing och reaktion |
| 5 | Examensflygning | Hovring, höjd, fritt fall och landning i ett pass | Allt ovan. Godkänd examen ger graden junior och ny helikopter |

Senare varianter blir svårare: högre hovring, smalare band och längre tid.

### 3.1 Mjuk landning

- Sjunkhastigheten beror direkt på hur mycket effekten ligger under behovet: `dh/dt = G · (P − P_req) / P0`. Med 0 W faller man i över 20 m/s.
- För att sätta ner under 2 m/s måste man ligga inom ungefär 9 % under sin lyfteffekt. Det kräver precision snarare än kraft.
- **Nytt:** en regel för vad som räknas som hård landning, alltså en gräns för sjunkhastigheten när helikoptern når marken. Den finns inte i dag.

### 3.2 Fritt fall

- Från 1 000 m med 0 W faller helikoptern i ungefär 27–31 m/s. De 500 metrarna tar runt 17 s utan fallbroms.
- Effekten ligger kvar i 3 s efter sista draget (`strokeTimeoutS`) och tonas sedan ned under 1 s (`fadeOutS`). Man måste alltså sluta veva innan man vill börja falla.
- När man börjar igen syns effekten först när draget är klart. Då faller man ytterligare 30–40 m.
- Momentet blir alltså att sluta i tid och börja igen i tid, inte bara att reagera.
- I skolhelikoptern (med fallbroms) är fallet lugnare, ungefär 50 s för 500 m. Förslag: övningen görs först i skolhelikoptern, där det är lätt att fånga upp den. Den görs sedan om som junior utan broms, där det är på riktigt. Alternativet är att instruktören slår av bromsen för övningen.

### 3.3 Ändringar som övningarna kräver

- Passet avslutas i dag efter `idleEndS` (10 s) utan drag, så fritt fall skulle avbryta spelet. Den regeln stängs av under övningarna.
- På samma sätt behöver `groundEndS` ses över, så att en landning mitt i en övning inte avslutar passet i förtid.

## 4. Helikoptrar

En helikopter byggs av parametrar som redan finns:

| Egenskap | Parameter | Effekt |
|---|---|---|
| Maxhöjd | `H_air` | Lågt värde gör att helikoptern "tar slut" tidigt |
| Stigförmåga | `G` | Lågt värde ger en trög och förlåtande helikopter |
| Fallbroms | `maxSinkRate` (avstängd i dag) | Begränsar hur fort man kan falla, vilket gör landningen lättare |
| Last | Patientens vikt läggs på förarens | Avgör om den kan ta patient och hur många |

Balansen styrs av tidskonstanten `τ = H_air / G` (spec §5). Om maxhöjden ska ändras utan att balansen ändras, ändras `H_air` och `G` med samma faktor.

### Typer

1. **Skolhelikopter** (aspirant)
   - Den förlåtande egenskapen är en fallbroms på cirka 10 m/s, så en miss straffas mildare och det blir lättare att landa mjukt.
   - Luften tunnas ut snabbare än i dag. Den klarar övningshöjderna men inte de höga topparna.
   - Den har ingen vinsch och ingen plats för patient. Det förklarar varför aspiranten bara övar.
   - Den är gul med texten SKOLA (`heli-draw.js`).
   - Ljudet får ljusare ton och snabbare rotor (`helicopter-sound.js`).
2. **Lätt räddningshelikopter** (junior och fjällräddare)
   - Vinsch och en patient. Ingen fallbroms längre, fysiken som i dag.
   - Räcker till fjällen i Jämtland och Härjedalen.
3. **Tung räddningshelikopter** (senior och uppåt)
   - Högre tak och plats för två eller tre patienter.
   - Den väger mer i sig själv, så den kräver mer effekt redan tom. Det blir en avvägning: kraftfullare men tyngre att dra.

Uppgraderingen är en belöning: examensflygningen ger både graden junior och en ny helikopter.

Egna, påhittade namn på helikoptrarna i stället för riktiga modeller, så slipper man varumärken.

## 5. Skarpa uppdrag (junior och uppåt)

### Faser i ett uppdrag

1. **Utlarmning:** "Skadad skidåkare vid Suljätten, 845 m. Tar du uppdraget?" Man väljer **Ja** eller **Nej**.
2. **Utflygning:** man stiger till målhöjden.
3. **Vinsch:** man hovrar inom ±30 m från målhöjden i X sekunder. Det räcker att ligga på rätt effekt.
4. **Hemflygning:** patienten är ombord, så lasten ökar och man måste flyga ner med den.
5. **Landning:** man sätter ner helikoptern mjukt vid basen, med sjunkhastighet under en gräns.

### Svårighet

Svårigheten kan skruvas med:
- höjd
- patientens vikt
- vinschtid
- tidsgräns
- väder (se avsnitt 6)
- antal personer

### Valet att ta uppdraget

- Man får 2–3 larm samtidigt och väljer ett, eller tackar nej till alla.
- Att tacka nej kostar inget, men svårare uppdrag ger mer erfarenhet och man stiger fortare i graderna.
- Om man tar ett för svårt uppdrag och misslyckas kan man förlora lite "förtroende". Det gör valet till en riktig avvägning.
- Spelet kan märka larmen med "Rekommenderat" utifrån spelarens tidigare resultat. Då behövs ingen gissning om hur stark personen är.

## 6. Väder

Vädret gör att samma uppdrag blir olika varje gång och att det inte räcker att bara dra hårt.

### Fenomen

| Fenomen | Vad som händer i spelet | Vad det kräver av spelaren |
|---|---|---|
| **Luftgropar** | Lyftet försvinner i 1–3 s och helikoptern sjunker plötsligt | Reaktion. Med förvarning (mörkt moln, skakning) blir det att förutse |
| **Byig vind** | Effektbehovet svajar hela tiden | Aktiv styrning för att hålla sig i hovringsbandet |
| **Motvind** | Utflygningen tar längre tid | Hushållning med krafterna |
| **Uppvind** vid fjällsidor | Gratis lyft en stund | Att läsa terrängen och utnyttja den |
| **Moln och dålig sikt** | Målhöjden syns inte, bara instrumenten | Instrumentflygning: lita på höjdmätaren |
| **Isbildning** | Helikoptern blir sakta tyngre | Att inse när man ska vända |

### Hur det byggs

- Vädret blir en faktor på effektbehovet: `P_req(h, t) = P0 · (1 + h / H_air) · (1 + w(t))`.
  - Byar och luftgropar gör `w(t)` positivt, alltså tyngre.
  - Uppvind gör `w(t)` negativt, alltså lättare.
- `w(t)` räknas från ett frö, så samma väder kan spelas upp igen och testas headless.
- Motvind påverkar inte fysiken. Den förlänger en **transportfas**: man ska hålla marschhöjd i X sekunder för att "komma fram", och motvind gör X längre.
- Isbildning är en vikt som ökar under passet, på samma sätt som patienten.

### Beslut som vädret ger

- **Väderprognos i larmet:** "Suljätten, 845 m. Byig vind, risk för luftgropar." Man väljer att ta uppdraget, avstå eller vänta på ett bättre väderfönster.
- **Flyghöjd under transporten:** lågt kräver mindre effekt men har mer turbulens nära terrängen. Högt är lugnare men kostar mer.
- **Att vända är ett godkänt beslut.** Den som avbryter i tid när vädret blir för dåligt får poäng för säkerhet, inte ett misslyckande.

### Väder i karriären

- Aspiranten övar i lugnt väder. Senare övningar kan ha lätt vind.
- Svårare grader får tuffare väder, men prognosen säger alltid vad som väntar.

## 7. Namn, vikt och ålder

- **Namnet** blir spelarprofilen. Grad, erfarenhet och godkända övningar sparas lokalt (localStorage), så den som kommer tillbaka fortsätter sin karriär.
- **Vikten** används som i dag och sparas inte i profilen (spec §6).
- **Åldern** kan styra vilka uppdrag som erbjuds. Barn kan få en egen, snällare karriärstege, ungefär som klasserna fungerar i dag. Åldern sparas inte, bara klassen.

## 8. Byggordning

1. **Övningsmotor.** Varje övning är en lista med steg: stig till X, håll X ±Y i Z s, fall till X, landa under V m/s. Motorn är ren logik, enhetstestad och körbar headless, som fysiken.
2. **Skolhelikopter.** Helikoptertyp som parameteruppsättning, med fallbroms och egen grafik.
3. **Menyskärm efter inmatningen:** "Aspirant [namn]: Dagens övningar" med godkända övningar bockade. Man väljer övning eller avstår.
4. **Hjälplinjer på skärmen:** hovringsband, fallmål och ett landningsmål med sjunkhastighetsmätare.
5. **Profiler och grader** som sparas på namnet.
6. **Examensflygning** och den lätta räddningshelikoptern.
7. **Skarpa uppdrag** med larmskärm (Ja/Nej), vinsch och patient som last.
8. **Väder:** vädermotor med frö, byar, luftgropar, uppvind, motvind och prognos i larmet.
9. **Svårare grader:** tung helikopter, tidsgräns, flera patienter, moln och isbildning.

Första bygget omfattar steg 1–4 med övningarna 1–4.

## 9. Öppna frågor

- **Riktning:** Ska det bara vara upp och ner, som i dag, eller en sidovy där man också flyger åt sidan till platsen? Sidovyn blir snyggare men kräver mycket mer, eftersom ergen bara ger ett värde, effekten.
- **Tröghet:** Helikoptern har ingen tröghet: så fort effekten ändras ändras farten direkt. Det gör att ett fall aldrig känns som att fart byggs upp. Tröghet påverkar balansen i hela spelet, så den väntar. Det kan bli ett senare steg om fallet känns platt.
- **Fritt fall i skolhelikoptern:** ska fallbromsen styra svårigheten, eller slår instruktören av den för övningen?
- **Användning:** Ska spelet fortfarande köras på event, med många olika spelare, eller mer av samma person över tid? Det avgör hur viktig karriären med sparade profiler är.
- **Gamla läget:** Ska "så högt som möjligt" med topplista finnas kvar på sikt?
- **Namn på helikoptrarna.**
- **Förvarning om luftgropar:** ska de alltid synas i förväg, eller bara hos högre grader?
- **Poäng:** hur vägs precision, säkerhet, tid och beslut ihop till ett resultat?
