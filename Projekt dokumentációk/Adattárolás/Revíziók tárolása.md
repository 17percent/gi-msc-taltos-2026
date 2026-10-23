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
- **Retenció (D48, D51h–i):** a Jóváhagyott és a függő kérés revíziói nem törlődnek automatikusan; a köztes checkpoint-revízió 1 évvel azután törlődik, hogy egy újabb Jóváhagyott revízió meghaladta; az elutasított vagy visszavont kérés javasolt revíziója 1 év után; az eldobott piszkozat revíziói az eldobás után 1 évvel. A revízió append-only, a törlés csak a retenciós folyamat dolga.
- **Verziócímke:** az `iteration` (v1, v2 …) a dokumentumon él; hogy a revízió–verziószám megfeleltetés hol tárolódik (a revízió megváltoztathatatlan), a B4 feladata; nem döntési kérdés.
- **Review (D45, D51e):** `documents.approved_revision_id` mutat a legutóbbi Jóváhagyott revízióra; az `iteration` a Jóváhagyott változások száma.

## Kapcsolódó egységek

[[Dokumentumok/Verziózás|Verziózás]] · [[Adattárolás/Adatmodell|Adatmodell]] · [[Adattárolás/Tranzakciós mentés|Tranzakciós mentés]]
