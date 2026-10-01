# CLAUDE.md

Ergcopter är ett helikopterspel som drivs av en Concept2 SkiErg: effekten från ergen lyfter en simulerad helikopter. Grundspelet heter "så högt som möjligt". Ovanpå det byggs Fjällräddaren med övningar, karriär och uppdrag; läget väljs på startskärmen. Projektet är vibe-kodat, så håll det enkelt och lätt att läsa.

- `spec.md` beskriver grundspelet: datakälla, signal, fysik, spelflöde, UI och standardvärden (§12).
- `plan.md` beskriver Fjällräddaren och byggordningen (§8).

Uppdatera dem när beteendet ändras. Kommentarer i koden hänvisar till dem, till exempel `(spec §5)` eller `(plan.md §3)`.

## Kommandon

```sh
npm test                          # alla tester (node --test), inga beroenden
node --test test/physics.test.js  # en testfil
npm run simulate                  # strategisimulatorn: maxhöjder med aktuella parametrar
npm run exercises                 # övningar, lektioner och uppflygningen headless med autopilot
npm run flightlog -- logg.txt     # läser en flyglogg och spelar upp den (--set namn=värde provar andra parametrar)
node server.js                    # http://localhost:3000 (PORT=… för annan port)
docker compose up                 # samma server i Docker, public/ monteras live
```

- `?demo` (knappen Demo på startskärmen) flyger en demospelare utan erg. `?demo=<id>` låter autopiloten flyga en övning (t.ex. `hover`, `freefall`, `rings`; se `core/exercise.js`), en lektion (`lesson-1` … `lesson-4`) eller uppflygningen (`exam`). `dashboard.html?demo` visar live-dashboarden med påhittad data.
- Tangenter i spelet: Enter startar så högt som möjligt, Esc avbryt, S inställningar, L flygloggar, D debug, F helskärm. På startskärmen och i Fjällräddaren-menyn flyttar piltangenterna mellan valen, och i menyn byter 1–4 flik. I flygloggarnas uppspelning spelar och pausar mellanslag, och pilarna spolar.
- Varje flygning spelas in som en flyglogg (spec §9.1). Klistrar någon in en logg: spara den i en fil och kör `npm run flightlog -- fil` för sammanfattning, de sista dragen före varje sättning och uppspelning.
- CI (`.github/workflows/pages.yml`) kör `node --test` och `node tools/simulate.js` och publicerar sedan `public/` på GitHub Pages vid push till `master`.

## Struktur

```
public/                  allt som publiceras, statiska filer utan byggsteg
  index.html             spelet
  dashboard.html         live-dashboarden (siffror och kraftkurva via USB, höjden från spelet)
  favicon.svg            ikonen: räddningshelikoptern framför ett fjäll
  shared/                delas av spelet och dashboarden
    csafe.js, pm5.js     CSAFE-protokollet och PM5 via WebHID
    screen.js            helskärm och "håll skärmen vaken"
    live.js              livedata från spelet till dashboarden (BroadcastChannel)
    sources/             datakällor: usb, ble (Bluetooth), mock (?demo), scripted (tester)
  dashboard/             dashboard.js, forcecurve.js, dashboard.css
  fonts/                 Barlow Condensed (woff2) med licens (OFL.txt)
  game/
    main.js              kopplar ihop allt: källa → spel → rendering, knappar, tangenter, loop
    game.css
    core/                ren logik utan DOM, testbar headless
      config.js          alla parametrar: DEFAULT_CONFIG, CONFIG_SCHEMA, sanitize
      physics.js         fysikmodellen: rotor, lyftkraft och tyngd (spec §5)
      engine.js          motorn: senaste dragets effekt tills nästa drag (spec §4)
      game.js            spelflödet, tillstånd IDLE → … → FINISHED (spec §7)
      exercise.js        övningsmotorn och övningarna (plan.md §3)
      lessons.js         lektionerna, uppflygningen och vad som är öppet i dag (plan.md §3)
      autopilot.js       pilot för övningarna: tester, tools/exercises.js och ?demo=<id>
      helicopters.js     helikoptertyper (plan.md §4)
      leaderboard.js     topplistan (localStorage)
      progress.js        spelarprofilen: grad, stjärnor, lektioner, loggbok (localStorage)
      results.js         resultatet: topparna kring maxhöjden, meningen och vilket rekord det blev
      calibration.js     förväntat utfall och balanskontroll (spec §12)
      milestones.js      fjälltopparna, med källor
      flightlog.js       flygloggen: inspelning, text, tolkning och de sparade loggarna (spec §9.1)
      replay.js, sim.js  snabbspolad landning, headless-körning och uppspelning av flygloggar
    view/                allt som ritar, visar eller låter
      render.js          canvasen: himmel, berg, helikopter, hjälplinjer, höjdskalan
      heli-draw.js, mountains.js    ritfunktioner: helikoptern, moln, granar, toppar med etiketter
      scenery.js         himmel i dag- och kvällsljus, fjällkedjor, molntäcke och norrsken efter höjd
      effects.js         fartstreck, rotordamm och konfetti
      attract.js         startskärmens demotur
      color.js           färgblandning för canvasen
      ui.js              DOM: startskärmen, Ny flygning, redo, notiser, topplista, inställningar
      hud.js             instrumenten: höjdrutan, effekten, variometern, tiden och övningens panel
      career.js, thumbs.js  Fjällräddaren-menyn och korten med ritade bilder
      results.js         resultatskärmen
      logplayer.js       flygloggarna med uppspelning
      rotor.js           rotorns animation
      audio.js, helicopter-sound.js rotorljud (Web Audio)
test/                    node:test, en fil per område
tools/                   simulate.js, exercises.js, flightlog.js
server.js                minimal statisk server utan beroenden
```

## Regler

- **Inga beroenden och inget byggsteg.** ES-moduler laddas direkt i webbläsaren. Importera med relativ sökväg och `.js`-ändelse. Lägg inte till npm-paket.
- **`core/` är ren logik.** Ingen DOM och ingen egen klocka: tiden skickas in (`tick(now)`), och lagring tas som parameter så att testerna kan ge en egen. `core/` får importera `core/` och `shared/sources/`, men aldrig `view/`. Ny spellogik hamnar i `core/` och får ett test.
- **`view/` och `main.js`** får importera `core/`, men inte tvärtom.
- **`shared/`** får inte importera från `game/` eller `dashboard/`.
- **Parametrar** ligger i `core/config.js`. En ny inställning läggs både i `DEFAULT_CONFIG` och i `CONFIG_SCHEMA`, annars syns den inte i panelen och `sanitize` tar bort den.
- **localStorage-nycklar** börjar med `skierg.` och har versionssuffix när formatet kan ändras (`skierg.config.v1`).
- **Integritet (spec §6):** vikt, råa watt och `P0` visas aldrig på storskärmen och sparas aldrig i topplistan, utom när operatören slår på råa watt.
- **Datakällor** ärver `SourceBase` (`shared/sources/source.js`) och skickar händelserna `stroke`, `force`, `status` och `raw`.

## Svenska överallt

- UI-texter, kommentarer, testnamn, dokumentation och commit-meddelanden skrivs på svenska. Identifierare i koden (variabler, funktioner, filnamn) är på engelska, som i dag.
- Commit-meddelanden: kort rubrik i imperativ, till exempel "Gör namnet valfritt i formuläret". Brödtext vid behov.

## Stil

- 2 mellanslag, enkla citattecken, semikolon och rader upp till ungefär 130 tecken.
- Korta kommentarer som förklarar *varför*. JSDoc (`/** … */`) på exporterade funktioner och klasser.
- Privata fält och metoder med `#`.

## Innan du är klar

1. `npm test` och `npm run simulate` ska gå utan fel. CI kör båda.
2. Vid ändringar i UI eller rendering: starta `node server.js`, öppna `?demo` och kontrollera att sidan laddar utan fel i konsolen.
3. USB och Bluetooth går bara att verifiera med en riktig erg. Säg till när en ändring berör `shared/sources/usb.js`, `ble.js`, `csafe.js` eller `pm5.js`.
4. Uppdatera `spec.md` eller `plan.md` om beteendet har ändrats.
