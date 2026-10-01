# Ergcopter

Ett eventspel där effekten från en Concept2 SkiErg lyfter en räddningshelikopter. Ju hårdare och jämnare du drar, desto högre flyger du förbi fjälltopparna. Lyfteffekten beror på kroppsvikten, och topplistan delas upp i Barn, Ungdom och Vuxen efter åldern.

På startskärmen väljer du grundspelet, **Så högt som möjligt** med topplista per klass, eller **Fjällräddaren**: lektioner och övningar med en skolhelikopter, uppflygningen, och med tiden skarpa räddningsuppdrag.

## Kom igång

Du behöver Node 22 eller senare. Det finns inga beroenden att installera.

```sh
node server.js      # öppna http://localhost:3000 i Chrome eller Edge
npm test            # kör testerna
```

- Anslut PM5 med USB-kabel (WebHID) eller Bluetooth. På iPhone/iPad fungerar bara Bluetooth, via appen Bluefy.
- Inget erg till hands? Öppna `http://localhost:3000/?demo`. `?demo=lesson-1` eller `?demo=exam` låter autopiloten flyga en lektion eller uppflygningen.
- Live-dashboarden med siffror och kraftkurva finns på `dashboard.html`. Flyger spelet i en annan flik visar den också höjden.
- Varje flygning spelas in. Under Flygloggar på startskärmen (eller tangent L) kan du spela upp flygningen över fjälltopparna, och kopiera loggen för att klistra in den för analys: alla drag med kraftkurvan och hur helikoptern svarade.
- Landskapet ritas i 3D med WebGL2 (fjäll, sjö som speglar fjällen, moln) och kräver en dator med grafikprocessor. Utan stöd, eller om datorn inte hinner med, ritas det i 2D. 3D går att stänga av under Inställningar → Visning.
- Med Docker: `docker compose up`.

Spelet publiceras automatiskt på GitHub Pages när `master` uppdateras och testerna går igenom.

## Dokument

- [`spec.md`](spec.md) – grundspelet: datakälla, fysik, spelflöde, UI och standardvärden.
- [`plan.md`](plan.md) – Fjällräddaren: karriär, övningar, helikoptrar, uppdrag och väder.
- [`CLAUDE.md`](CLAUDE.md) – kodstrukturen, reglerna och kommandona. Läs den innan du ändrar något (den läses också av Claude).
