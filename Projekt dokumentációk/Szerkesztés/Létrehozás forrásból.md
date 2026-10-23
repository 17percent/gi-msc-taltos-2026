---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 3
---

# Létrehozás forrásból

## Cél

Új markdown dokumentum négyféleképpen jöhessen létre:

| Út | Kiindulás | Ütemezés |
|---|---|---|
| **Üres** | üres dokumentum | MVP 3 |
| **Duplikálás** | egy meglévő dokumentum másolata (a színterek közötti átvitel egyetlen módja, V26) | MVP 3 |
| **Létrehozás sablonból** | egy sablonként megjelölt (`is_template`) markdown dokumentum | **hátrasorolva** (2026-10-23) |
| **Létrehozás forrásból** | egy meglévő szöveges fájl (`.txt`, `.docx` …) átalakítása markdown dokumentummá | **hátrasorolva** (2026-10-23) |

> [!note] Fogalomváltás (2026-10-23)
> A D17 eddig a sablonból létrehozást és a duplikálást együtt nevezte „létrehozás forrásból” műveletnek. Az új szóhasználatban a **„forrásból” csak a fájlimportot jelenti**; a sablonból létrehozás külön út. A D17 megvalósítási egyesítése (új UUID, első revízió, `draft`, `duplicated_from`) a sablonból létrehozásra és a duplikálásra továbbra is érvényes. Rögzítve: **D47** (Döntési napló v10).
>
> **Hátrasorolás:** mindkét út nem prioritás, a megvalósításban hátra kerül (javaslat: második ütem). Az MVP 3. pontjában az üres létrehozás és a duplikálás marad.

## Működés a prototípusban

Új dokumentum nézet (`#/new`): három kártya. Duplikáláskor új UUID, `draft` státusz, iteráció nullázva, `duplicated_from` esemény mindkét oldalon. A sablon is tudásanyag (`is_template`), a Sablonok kategóriában és a Sablon faceten.

## Létrehozás forrásból (fájlimport) — vázlat

- **Bemenet:** `.txt`, `.md`, `.docx` (később esetleg `.html`, `.odt`, `.rtf`). PDF nem, mert a szövegkinyerés minősége bizonytalan.
- **Átalakítás:** szerveroldali pandoc (`-t gfm`), ugyanaz az eszköz, mint az [[Kimenet/Export|Export]] (D15, D21). A `.txt` és a `.md` átalakítás nélkül kerül be.
- **Eredmény:** új dokumentum Piszkozat állapotban (D45), a létrehozó a tulajdonos, az átalakított szöveg az első revízió. Esemény: `imported_from` (eredeti fájlnév, formátum, méret). Az eredeti fájl nem tárolódik. Egyszerre egy fájl.
- **Előnézet mentés előtt:** az átalakított markdown a szerkesztőben jelenik meg; mentés csak megerősítés után.
- **Biztonság:** a kimenet ugyanúgy `rehype-sanitize`-on megy át (D16); méretkorlát; a `.docx` makrói és beágyazott objektumai elvesznek.
- **Képek:** a D15 szerint képfeltöltés nincs, ezért a `.docx` képei kimaradnak, helyükön jelölés (`[kép kihagyva]`).

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D17 (a sablon is tudásanyag; „létrehozás forrásból” egységes művelet).

## Nyitott kérdések

- **Duplikátum-figyelmeztetés ([[Versenytárs-elemzés]] V13, módosítva D49):** cím beírásakor és az első mentéskor **a cím** `pg_trgm`-hasonlósága alapján legfeljebb 5 hasonló, nem archivált dokumentumot ajánlunk fel a saját színtereken belül („Ezt kerested?”). Nem tilt.
- ~~Tartalom-összevetés költsége?~~ **Tárgytalan (D49):** csak a cím kerül összevetésre.
- ~~Melyik színtérbe kerül a másolat?~~ **Döntve (D44):** bármelyikbe, amelynek a felhasználó tagja; a másolat Piszkozatként indul, és a célszíntér két review-erével válik Jóváhagyottá.
- ~~„Származik” kapcsolat?~~ **Döntve (D39):** igen, a Kapcsolatok része.
- ~~Sablonok?~~ **Döntve (D47):** a sablonná jelölés metaadat-változás, két review-er hagyja jóvá; a Jóváhagyott sablonok globálisan használhatók (D44 kivétel).
- ~~Fájlimport?~~ **Döntve (D47):** egyenként; az eredeti fájl nem tárolódik, az `imported_from` esemény rögzíti a nevét. Tömeges import: jövőbeli munka.

## Kapcsolódó egységek

[[Dokumentumok/Kapcsolatok|Kapcsolatok]] · [[Dokumentumok/Címkék|Címkék]] · [[Szerkesztés/Markdown szerkesztő|Markdown szerkesztő]]
