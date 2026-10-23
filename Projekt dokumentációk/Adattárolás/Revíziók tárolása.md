---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 5
---

# Revíziók tárolása

## Cél

Minden mentés megmarad: bármelyik korábbi állapot megnézhető, összehasonlítható és visszaállítható.

## Működés a prototípusban

A dokumentum `versions` tömbje revízió-pillanatképeket tárol (`{rev, ts, authorId, message, content}`). A Verziók fülön `r1`, `r2`, … jelöléssel látszanak.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D1 (a `document_revisions` tábla a Git-történet helyettesítője), 4. fejezet, 6. fejezet (tárhelyigény-kockázat).

- Teljes szövegű pillanatkép, nem delta: egyszerűbb és megbízhatóbb, cserébe a méret a mentések számával nő.
- A verziófogalom kettős: revízió-történet + `iteration` mező. Kézi „verziószám” nincs.

## Nyitott kérdések

- Tárhely-becslés a dolgozatba: dokumentumszám × mentés/dokumentum × átlagos méret.
- ~~A revíziók retenciója?~~ **Döntve (D48):** a Jóváhagyott revíziók megmaradnak; az elutasított vagy visszavont kérések piszkozat-revíziói 1 év után törlődnek.
- **Review (D45):** `documents.approved_revision_id` mutat a legutóbbi Jóváhagyott revízióra; az `iteration` a Jóváhagyott változások száma.

## Kapcsolódó egységek

[[Dokumentumok/Verziózás|Verziózás]] · [[Adattárolás/Adatmodell|Adatmodell]] · [[Adattárolás/Tranzakciós mentés|Tranzakciós mentés]]
