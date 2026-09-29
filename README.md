# SkiErg-helikoptern

Ett eventspel där effekten från en Concept2 SkiErg lyfter en helikopter. Ju hårdare och jämnare du drar, desto högre flyger du förbi fjälltopparna. Lyfteffekten beror på kroppsvikten, och topplistan delas upp i Barn, Ungdom och Vuxen.

Ovanpå grundspelet ("så högt som möjligt", med topplista per klass) byggs **Fjällräddaren**: övningar med en skolhelikopter, och med tiden skarpa räddningsuppdrag.

## Kom igång

Du behöver Node 22 eller senare. Det finns inga beroenden att installera.

```sh
node server.js      # öppna http://localhost:3000 i Chrome eller Edge
npm test            # kör testerna
```

- Anslut PM5 med USB-kabel (WebHID) eller Bluetooth. På iPhone/iPad fungerar bara Bluetooth, via appen Bluefy.
- Inget erg till hands? Öppna `http://localhost:3000/?demo`.
- Dashboarden med siffror och kraftkurva finns på `dashboard.html`.
- Med Docker: `docker compose up`.

Spelet publiceras automatiskt på GitHub Pages när `master` uppdateras och testerna går igenom.

## Dokument

- [`spec.md`](spec.md) – grundspelet: datakälla, fysik, spelflöde, UI och standardvärden.
- [`plan.md`](plan.md) – Fjällräddaren: karriär, övningar, helikoptrar, uppdrag och väder.
- [`CLAUDE.md`](CLAUDE.md) – kodstrukturen, reglerna och kommandona. Läs den innan du ändrar något (den läses också av Claude).
