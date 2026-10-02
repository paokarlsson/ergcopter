# Fjällräddaren – plan

En utbyggnad av helikopterspelet (se `spec.md`). Man börjar som aspirant i fjällräddningen, övar moment med en skolhelikopter och får med tiden skarpa räddningsuppdrag. Man väljer alltid själv om man tar ett uppdrag eller en övning.

Status: aspirantens flygskola går att spela: 14 övningar, 4 lektioner och uppflygningen, med profil, loggbok och räddningshelikoptern som belöning. Skarpa uppdrag återstår (se §8).

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
- Från aspirant till junior krävs en godkänd uppflygning (se 3.5). Lektionerna är valfria, men uppflygningen är svår nog att den som är ovan behöver några.

## 3. Aspirant: flygskolan vid verkstan

Aspiranten är inte betrodd med skarpa räddningar. Hen övar momenten, flyger lektioner och gör till sist uppflygningen. Allt flygs med skolhelikoptern rakt upp och ned vid verkstan, utan framåtfart: landskapet står still, verkstan syns hela tiden och man landar på plattan man lyfte från. Inga fjälltoppar skickas in. Undantaget är ringbanan, som rullar framåt i jämn fart.

Spelet pratar flygning, inte träning. Ord som intervaller eller uppvärmning förekommer inte i gränssnittet.

### Övningar

Alla övningar är alltid öppna. Varje godkänd övning får 1–3 stjärnor för precisionen, och det bästa resultatet sparas.

| Id | Övning | Mål |
|---|---|---|
| first-lift | Första lyftet | Lyft till 50 m och landa (högst 3 m/s) |
| bounce | Studsa | Lyft till 30 m och sätt ner mjukt, tre gånger |
| hover | Hovring | 300 m ±25 m i 30 s |
| stairs | Trappan | Hovra 12 s på 100, 200, 300 och 400 m (±20 m) |
| altitude | Höjdflygning | Stig till 1 000 m och landa mjukt |
| freefall | Fritt fall | Släpp på 1 000 m, hämta upp under 650 m men före 450 m |
| elevator | Hissen | Tre fall i rad: släpp på 700 m, hämta upp mellan 500 och 330 m |
| late-catch | Sen hämtning | Släpp på 800 m, vänta till 400 m, hämta upp före 280 m |
| sandbag | Sandsäcken | Hovra på 150 m medan vinschen går, landa med lasten (20 % av kroppsvikten) |
| engine | Motorstopp | Hovra på 400 m; motorn stannar efter 4–12 s, startar 100 m lägre; hämta upp före 180 m |
| follow | Följ instruktören | Håll dig i nivå (±25 m) med instruktörens helikopter i 80 s, minst 60 % av tiden |
| clouds | Molnflygning | I moln: stig till 350 m och håll 350 m ±30 m i 30 s med bara höjdmätaren |
| patrol | Patrull | Mellan 400 och 500 m i sammanlagt 2 minuter |
| rings | Ringbanan | Flyg genom minst 7 av 10 ringar |

Stjärnorna bygger på landningsfarten (andel av gränsen), medelavvikelsen i hovringsbandet, hur djupt under hämtgränsen man hämtar upp (andel av utrymmet ned till golvet), andelen tid i nivå med instruktören och antalet ringar. En övning får stjärnorna från sitt svagaste moment.

### Lektioner

Lektionerna sätter ihop övningar till ett längre pass i samma flygning (`core/lessons.js`). De flygs i ordning och är valfria. Instruktören hälsar i början, kommenterar varje moment och avslutar med en teaser om nästa lektion. Ett misslyckat moment stoppar inte lektionen.

| Lektion | Moment | Teaser efteråt |
|---|---|---|
| 1 Första lektionen | Första lyftet, Studsa, Hovring | Trappan, följ instruktören och 1 000 m |
| 2 Höjd | Trappan, Följ instruktören, Höjdflygning | Fritt fall |
| 3 Fritt fall | Fritt fall, Hissen, Sen hämtning | Sandsäcken och motorstopp |
| 4 Last och nödläge | Sandsäcken, Motorstopp, Molnflygning, Ringbanan | Uppflygningen väntar |

### Det som får en att komma tillbaka

- **En ny lektion per dag** (`lessonPerDay`, på som standard eftersom spelet körs hemma). Genomförda lektioner, övningar och fri flygning är alltid öppna.
- **Teaser** efter varje lektion, och räddningshelikoptern står vid verkstan med skylten "Väntar på dig efter uppflygningen".
- **Loggbok:** all flygtid räknas, även fri flygning. Menyn visar total flygtid och hur många dagar man flugit den här veckan. Ingen svit som bryts.
- **Instruktören minns:** klar-skärmen visar ditt bästa i övningen, och resultatet säger när det blir nytt personbästa.

### 3.1 Mjuk landning

- Sjunkhastigheten styrs av hur mycket effekten ligger under behovet: den stadiga farten är `G · (P − P_req) / P0`, och rotorn och helikoptern tar ett par sekunder på sig att komma dit (spec §5). Med 0 W faller man i över 20 m/s.
- För att sätta ner under 2 m/s måste man ligga inom ungefär 9 % under sin lyfteffekt. Det kräver precision snarare än kraft.
- **Byggt:** fysiken registrerar sjunkhastigheten när helikoptern sätter ner (`flight.touchdown`). Landningssteget underkänner en landning över gränsen.
- **Flygloggen** (spec §9.1) visar för varje landning hur många drag under 25 m som ledde till en mjuk sjunk och de sista dragen före sättningen. Loggar från riktiga spelare avgör om landningen är för svår. Spelet ska vara mer kul än svårt, så visar loggarna det förenklas landningen.

### 3.2 Fritt fall och hämtning

- Från 1 000 m med 0 W bär rotorn en halv sekund, sedan faller helikoptern. Autorotationen bromsar fallet mot ungefär 28–31 m/s, men farten slår först över till omkring 40 m/s.
- Motorn går 1,25 dragperioder efter sista draget (högst `maxStrokeS`, 3 s) och stannar sedan. Man måste alltså sluta dra en stund innan man vill börja falla. Fallet räknas bara om motoreffekten når 0 ovanför släpphöjden.
- **Hämtgränsen:** man får börja hämta upp först när man passerat en viss höjd nedåt. Ett drag ovanför gränsen är för tidigt: då blir det ett nytt försök (i uppflygningen underkänt).
- **Hämtningen mäts:** tiden från gränsen tills helikoptern slutar sjunka (sjunker långsammare än 1 m/s) och hur djupt under gränsen den kom. När man börjar dra syns effekten först när draget är klart, och rotorbladen och helikoptern har massa, så helikoptern vänder inte direkt. I drygt 30 m/s blir bromssträckan ungefär 50 m med 50 % överskott.
- **Golvet:** hämtar man inte upp före golvhöjden tar instruktören över. Hen bromsar kraftigt (P_req + P0) och håller sedan höjden tills spelaren drar minst 80 % av behovet själv. Helikoptern kan alltså aldrig slå i marken i ett fall. Samma skydd gäller om man faller under golvet innan man släppt.
- **Sen hämtning** har lägre gräns och mindre utrymme ned till golvet (120 m i stället för 200 m), så man måste ta i hårdare. Golvet ligger ändå kvar på 280 m.
- **Motorstopp** vänder på det: motorn stannar vid en tidpunkt man inte kan förutse, dragen gör ingenting medan den står, och när den startar räknas bara nya drag.
- Skolhelikoptern har ingen fallbroms. Instruktören kan slå på en broms i inställningarna (`maxSinkRate`) om övningarna blir för svåra.

### 3.3 Ändringar som övningarna kräver

- **Byggt:** under en övning är det bara övningen som avgör när passet är slut: godkänd, underkänd, tidsgränsen eller Esc. Reglerna om tid utan drag (`idleEndS`), tid på marken (`groundEndS`) och max passlängd gäller bara fri flygning.
- Övningar hamnar inte på topplistan och ger inga notiser om passerade toppar.

### 3.4 Sandsäcken

Vinschen går bara medan man är i bandet, men börjar inte om när man lämnar det. När säcken är ombord räknas lyfteffekten om från kroppsvikten plus 20 % (`Flight.setLoad`), så lasten blir lika tung för alla. Lasten lämnas av när momentet är slut.

### 3.5 Uppflygningen

Uppflygningen är obligatorisk för att bli junior. Den är fem moment i ett pass med en examinator, och varje moment bedöms strängt: för tidig hämtning eller ett övertagande underkänner momentet direkt, utan nytt försök. Alla moment flygs ändå, så att protokollet blir komplett.

| Moment | Krav |
|---|---|
| Lyft och hovring | 150 m ±15 m i 20 s |
| Fritt fall | Släpp på 800 m, hämta upp under 550 m men före 400 m |
| Motorstopp | Hovra på 450 m; hämta upp före 230 m när motorn startar igen |
| Precisionshovring | 250 m ±15 m i 20 s |
| Landning | Högst 1,5 m/s |

- Uppflygningen är öppen från början. Banden på ±15 m och landningen under 1,5 m/s kräver att man övat.
- Underkänd: protokollet visar vad som brast, och med `lessonPerDay` görs omprovet nästa dag.
- Godkänd: certifikat med namn och datum, konfetti, graden junior och den lätta räddningshelikoptern i fri flygning. Menyn visar första larmet (Suljätten, 845 m) som kommer med uppdragen.

## 4. Helikoptrar

En helikopter byggs av parametrar som redan finns:

| Egenskap | Parameter | Effekt |
|---|---|---|
| Maxhöjd | `H_air` | Lågt värde gör att helikoptern "tar slut" tidigt |
| Stigförmåga | `G` | Lågt värde ger en trög och förlåtande helikopter |
| Fallbroms | `maxSinkRate` (avstängd i dag, ingen helikopter använder den) | Begränsar hur fort man kan falla |
| Last | Patientens vikt läggs på förarens | Avgör om den kan ta patient och hur många |

Balansen styrs av tidskonstanten `τ = H_air / G` (spec §5). Om maxhöjden ska ändras utan att balansen ändras, ändras `H_air` och `G` med samma faktor.

### Typer

1. **Skolhelikopter** (aspirant, `school`)
   - Ingen fallbroms: den faller lika fort som de andra.
   - Ett tak på 1 500 m, där den inte stiger mer. Den klarar övningshöjderna men inte de höga topparna. Taket valdes i stället för att luften tunnas ut snabbare, eftersom det senare hade gjort övningarna på 1 000 m tyngre och gynnat styrka.
   - Den har ingen vinsch och ingen plats för patient. Det förklarar varför aspiranten bara övar.
   - Den är vit med rött bara nedtill (röd nos, buk och stjärt, medan räddningshelikoptern har röda kabinsidor) och texten SKOLA (`helicopters.js`, ritas av `heli-draw.js` och `heli3d.js`).
   - Ljudet får ljusare ton och snabbare rotor (`helicopter-sound.js`). Inte byggt än.
2. **Lätt räddningshelikopter** (junior och fjällräddare, `rescue`)
   - Vinsch och en patient. Fysiken som i dag.
   - Vit och röd med texten 112, som i mockupen. Den står vid verkstan medan man är aspirant och blir ens egen i fri flygning efter uppflygningen.
   - Räcker till fjällen i Jämtland och Härjedalen.
3. **Tung räddningshelikopter** (senior och uppåt)
   - Högre tak och plats för två eller tre patienter.
   - Den väger mer i sig själv, så den kräver mer effekt redan tom. Det blir en avvägning: kraftfullare men tyngre att dra.

Uppgraderingen är en belöning: uppflygningen ger både graden junior och en ny helikopter.

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

- **Namnet** blir spelarprofilen (`core/progress.js`, `skierg.progress.v2`). Grad, godkända övningar, bästa resultat, genomförda lektioner, uppflygningen och loggboken sparas lokalt, så den som kommer tillbaka fortsätter sin karriär. Anonyma spelare sparas bara under passet.
- **Vikten** används som i dag och sparas inte i profilen (spec §6).
- **Åldern** anges i inmatningen och ger klassen (spec §12.2). Den kan också styra vilka uppdrag som erbjuds: barn kan få en egen, snällare karriärstege. Åldern sparas inte, bara klassen.

## 8. Byggordning

1. ✅ **Övningsmotor.** Varje övning är en lista med steg: stig till X, håll X ±Y i Z s, fall till X, landa under V m/s. Motorn är ren logik, enhetstestad och körbar headless, som fysiken. Se `public/game/core/exercise.js`. `npm run exercises` kör övningarna med en autopilot (`tools/autopilot.js`).
2. ✅ **Skolhelikopter.** Helikoptertyp som parameteruppsättning, med tak (1 500 m) och egen grafik. Se `public/game/core/helicopters.js`. Ljudet återstår.
3. ✅ **Fjällräddaren-menyn efter inmatningen** (`view/career.js`): rubrik med räddningshelikoptern, namn, grad och loggbok, och karriärens steg som flikar: 1. Flygskolan (lektionerna och sedan övningarna, hela flygskolan i ett rutnät), 2. Övningar (de fjorton övningarna), 3. Uppflygning (med sina fem moment) och 4. Räddningsuppdrag (låst tills uppdragen finns). Korten ligger fyra i bredd och fyra rader i höjd på en glaspanel; fler rader rullas fram. Varje val är ett kort med en bild (`view/thumbs.js`): med 3D får varje lektion och övning en egen liten scen (`view/thumb-shots.js`) med egen kamera i 3D-landskapet, ofta en brant topp nära, ibland hyllan med plattan (`hoverpad.js`) med skugga, damm och den gröna ringen, och den belysta 3D-helikoptern (`heli3d.js`) i en vinkel som visar uppgiften (underifrån mot toppen i höjdflygningen, ovanifrån i fritt fall, med rök i motorstoppet, med last i linan, genom ringarna bakifrån) – inga diagram; utan 3D ritad himmel och fjäll med den platta helikoptern och förklarande band och pilar; stjärnor eller läge, och låsta kort under mörkt glas med ett hänglås; sidopanelen beskriver fliken och målet för kortet man pekar på, och visar vad ett drag startar. Juniorer har också Fri flygning där. Man väljer med piltangenterna och Enter, siffrorna 1–4 byter flik, ett tryck eller avstår (Esc). Efter en övning kommer man tillbaka till menyn, så att man kan fortsätta öva utan att skriva in sig igen. Godkända övningar sparas på namnet (`progress.js`). Man står på ergen och ska inte behöva röra skärmen: menyn föreslår nästa ej godkända övning (sedan fri flygning) och ett drag startar den direkt. Efter en övning går ett drag tillbaka till menyn. De första 3 sekunderna i menyn och på resultatet räknas inga drag, så att man hinner läsa. Att trycka eller använda tangenterna behövs bara för att välja något annat än förslaget.
4. ✅ **Hjälplinjer på skärmen:** målhöjd som streckad linje, hovringsband som fylls på med en lysande ring på målhöjden runt helikoptern (vid längre hovringar med WebGL2 i stället framifrån över en platta med en lysande målring, se spec §8), släpphöjd och fångstzon i fritt fall, en pulserande ring på plattan när man ska landa, och verkstaden vid startplatsen. Rubriken uppe till vänster säger vilken övning det är ("Övning 3 – Hovring", i lektioner också momentet). Panelen till höger tar effektstapelns plats under övningen och visar uppgiften med ett kort råd och återkopplingen, vad som krävs för en, två och tre stjärnor i steget (`starGuide` i `exercise.js`, samma gränser som bedömningen) som rader med guldstjärnor, höjd, mål (sjunkfarten mot gränsen under landningen) och den relativa effekten, och effekten de senaste 30 sekunderna. `?demo=hover` (eller annat övnings-id) flyger en övning utan erg.
5. ✅ **Profiler och grader** som sparas på namnet, med loggbok och personbästa.
6. ✅ **Uppflygningen**, lektionerna, övningarna 5–14 och den lätta räddningshelikoptern. `?demo=<id>` flyger en övning, lektion (`lesson-1`) eller uppflygningen (`exam`) med autopiloten.
7. **Skarpa uppdrag** med larmskärm (Ja/Nej), vinsch och patient som last.
8. **Väder:** vädermotor med frö, byar, luftgropar, uppvind, motvind och prognos i larmet.
9. **Svårare grader:** tung helikopter, tidsgräns, flera patienter, moln och isbildning.

Första bygget omfattade steg 1–4 med övningarna 1–4, andra bygget steg 5–6.

## 9. Öppna frågor

- **Riktning:** Ska det bara vara upp och ner, som i dag, eller en sidovy där man också flyger åt sidan till platsen? Sidovyn blir snyggare men kräver mycket mer, eftersom ergen bara ger ett värde, effekten.
- **Tröghet:** Byggt som fysik (spec §4–5, `physics-plan.md`): motorn ger varje drags effekt utan medelvärde, rotorbladen har massa (`rotorTauS`, 0,5 s) och `g` (15 m/s²) styr hur fort farten följer. Öppet är om värdena är rätt när riktiga spelare provar, och om hämtningarna i fritt fall har blivit för svåra: autopiloten hämtar nu upp ungefär 50 m under gränsen i stället för 30 m. Rotorbladens massa kan också bli en egenskap per helikopter, där den tunga helikoptern är trögare.
- **Användning:** Spelet körs hemma, av samma personer över tid. Därför är karriären med sparade profiler och en lektion per dag viktig. På ett event stängs `lessonPerDay` av.
- **Svårighet i uppflygningen:** är ±15 m och 1,5 m/s lagom för att motivera några lektioner? Behöver provas av riktiga spelare. Flygloggarna (spec §9.1) visar vilka moment som är svåra.
- **Gamla läget:** Ska "så högt som möjligt" med topplista finnas kvar på sikt?
- **Namn på helikoptrarna.**
- **Förvarning om luftgropar:** ska de alltid synas i förväg, eller bara hos högre grader?
- **Poäng:** hur vägs precision, säkerhet, tid och beslut ihop till ett resultat?
