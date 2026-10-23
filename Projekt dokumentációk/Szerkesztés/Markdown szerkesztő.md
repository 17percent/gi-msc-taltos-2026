---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 4
---

# Markdown szerkesztő

## Cél

Markdown-tartalom kényelmes szerkesztése élő előnézettel, biztonságos megjelenítéssel.

## Működés a prototípusban

*(Prototípus — az éles alkalmazásban a D40 váltja ki.)* Osztott szerkesztő (`#/edit/:id`): bal oldalon a szöveg, jobb oldalon élő előnézet ugyanazzal a render-pipeline-nal, mint az olvasó nézet. A Mentés-sáv fixen alul van.

## Döntés (V40–V44, D40)

- **Élő előnézet (V40):** az éles alkalmazásban CodeMirror 6 élő előnézettel (Obsidian-modell): a forrás markdown marad, de a jelölők rejtve vannak, a formázás azonnal látszik. Az osztott (forrás + előnézet) nézet megszűnik. A Yjs-kötés (D29), a markdown-alapú diff, keresés és export változatlan.
- **Helyi menü (jobb kattintás, V41):** Obsidian-szerű menü minden beszúrási és formázási lehetőséggel, hogy a felhasználónak ne kelljen markdown-szintaxist tanulnia:
  - *Formázás:* félkövér, dőlt, áthúzott, kiemelés, beágyazott kód, formázás törlése
  - *Bekezdés:* címsor 1–3, felsorolás, számozott lista, feladatlista, idézet, kódblokk, vízszintes vonal
  - *Beszúrás:* táblázat, külső link, **kapcsolat másik dokumentumhoz** (típussal), @említés, kép az assets-mappából (D15)
  - *Szerkesztés:* kivágás, másolás, beillesztés, beillesztés formázás nélkül
  - A kijelöléstől függően csak a releváns pontok aktívak; minden pontnak billentyűparancsa is van, és a menü billentyűzettel is elérhető (`Shift+F10` / menü gomb).
- **Forrásnézet (V44):** Obsidian-szerű kapcsoló az élő nézet és a markdown-forrásnézet között; alapból az élő nézet nyílik meg.
- **Tulajdonság-panel (V42):** a dokumentum tetején „Tulajdonságok” panel: fajta, címkék, színtér, tulajdonos, felülvizsgálati esedékesség és a kapcsolatok típussal. Ez szerkesztési felület; az igazság az adatbázisban van.
- A `rehype-sanitize` és a képforrás-korlát (D16) az élő nézet renderelésére is érvényes.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D14 (shadcn/ui + Tailwind + Motion), D15 (csak szöveg, képfeltöltés nincs), D16 (`rehype-sanitize` mindenhol; nyers HTML és külső kép-URL tiltott; a szerkesztőkomponens a D29 óta CodeMirror 6), D29, **D40** (élő előnézet, helyi menü, tulajdonság-panel). A D7 localStorage-piszkozatát a D29 `y-indexeddb`-je váltja ki.

## Nyitott kérdések

- ~~Táblázat?~~ **Döntve (V45):** cellánként, helyben (rács, Tab/Enter navigáció); sor- és oszlopműveletek a helyi menüben.
- ~~Eszköztár?~~ **Döntve (V46):** lebegő formázósáv kijelöléskor (félkövér, dőlt, link, kapcsolat, címsor); állandó eszköztár nincs.
- ~~Érintőképernyő?~~ **Döntve (V47):** hosszú nyomásra a helyi menü, kijelöléskor a lebegő formázósáv.

- ~~Mentési üzenet?~~ **Döntve (D45):** mindig opcionális (a Review-ra küldéskor is).

## Kapcsolódó egységek

[[Szerkesztés/Zárolás|Zárolás]] · [[Szerkesztés/Létrehozás forrásból|Létrehozás forrásból]] · [[Adattárolás/Tranzakciós mentés|Tranzakciós mentés]]
