---
tags:
  - taltos/egyseg
allapot: döntve
---

# Pilot-terv

> [!success] Döntve — D41
> A [[Versenytárs-elemzés]] V55–V60 döntéseiből; rögzítve a [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]]-ben. A szakdolgozat értékelési fejezetének módszertana.

## Cél és kutatási kérdések

A pilot azt vizsgálja, hogy a Táltos a jelenlegi gyakorlathoz (Confluence vagy SharePoint) képest hogyan teljesít a tudás **megtalálásában**, **rögzítésében** és **adminisztrálásában**.

- **K1 — Megtalálás:** mennyi idő alatt és milyen sikerrel talál meg a felhasználó egy adott tudásanyagot?
- **K2 — Rögzítés:** markdown-tudás nélkül is létre tud-e hozni egy dokumentumot sablonból, címkével és kapcsolattal (D40), és ehhez mennyi idő és segítség kell?
- **K3 — Adminisztráció:** mekkora ráfordítás egy színtér, tagság, szerepkör, review és tulajdonjog-átadás kezelése (D30, D31, D43, D45)? (A tulajdonjog-átadás végpontja ❓ nyitott, NY11–NY19 a naplóban — a T8 ettől függ.)
- **K4 — Észlelt használhatóság:** milyen SUS-pontszámot ad a két megoldás?

## Design

| Elem | Döntés |
|---|---|
| Viszonyítás (V55) | A szervezet jelenlegi megoldása: **Confluence vagy SharePoint** |
| Elrendezés | Résztvevőn belüli összehasonlítás: mindenki mindkét eszközben elvégzi a feladatsort; a sorrend **kiegyensúlyozott** (a résztvevők fele a jelenlegi megoldással kezd), hogy a tanulási hatás kiegyenlítődjön |
| Résztvevők (V56) | **8–12 fő, legalább 3 csapatból**, vegyesen fejlesztők és nem fejlesztők (a K2 miatt legalább 3 fő, aki nem ismeri a markdownt) |
| Forma (V58) | **1. szakasz:** 45 perces moderált, hangos gondolkodásos feladat-session mindkét eszközben. **2. szakasz:** 2 hetes használat a Táltosban, naplóadatokkal; a végén SUS és rövid interjú |
| Környezet (V59) | **Fejlesztői környezet, dummy tartalommal** (D11); nincs céges telepítés |
| Kiértékelés (V60) | **Csak leíró eredmények**, előre rögzített célértékek nélkül |

## Környezet és korpusz

- **Korpusz:** ugyanaz a dummy korpusz kerül a Táltosba és a jelenlegi megoldás egy külön teszt-terébe (Confluence-space vagy SharePoint-site), hogy a feladatok összevethetők legyenek. Javasolt méret: 60–80 dokumentum, a seed-generátor fajtáival (D34) és témacímkéivel, köztük szándékosan néhány hasonló és egy elavult (`helyettesíti`) dokumentummal.
- **Színterek:** egy Általános + három csapat-színtér (a riport 10. fejezetének mintastruktúrája).
- **Felülvizsgálat a 2 hetes szakaszban:** a 12 hónapos alapérték (D33) a pilot alatt nem járna le, ezért a seed néhány dokumentumnak a pilot második hetére eső esedékességet ad.
- **Belépés:** fejlesztői környezetben Google OIDC (D5); a résztvevők e-mail-címei az allowlistre kerülnek.

## Feladatsor (1. szakasz)

| # | Feladat | Kutatási kérdés | Érintett döntés |
|---|---|---|---|
| T1 | Keresd meg a(z) X témájú, Jóváhagyott promptot, és másold ki | K1 | D4, D36, D21 |
| T2 | Keresd meg, melyik dokumentum váltotta fel az Y guide-ot | K1 | D39 (`helyettesíti`) |
| T3 | Találd meg a Z csapat összes agent-definícióját | K1 | D30, D34 (facet) |
| T4 | Hozz létre egy új promptot (üresen vagy duplikálással; ~~sablonból~~ — a sablonból létrehozás a D47 szerint második ütem), adj neki címkét, és kapcsold a meglévő W dokumentumhoz `épít_rá` típussal | K2 | D17, D34, D39, D40, D47 |
| T5 | Formázz meg egy bekezdést listává, és szúrj be egy táblázatot | K2 | D40 |
| T6 | Küldd review-ra a dokumentumodat két review-errel, majd review-erként hagyd jóvá vagy utasítsd el indoklással | K3 | D45 (~~D32~~) |
| T7 | Kérj projekt-teret (Rendszeradmin-jóváhagyással), majd Színtérgazdaként vegyél fel két tagot Szerzőként (~~Szerző és Jóváhagyó szereppel~~) | K3 | D30, D43, D44 (~~D31~~) |
| T8 | Add át egy dokumentum tulajdonjogát egy kollégának | K3 | D31 |

A T6–T8 feladatot a jelenlegi megoldásban az ottani legközelebbi megfelelővel kell elvégezni (pl. oldal-engedélyek, space-jogosultságok); ahol nincs megfelelő, ott „nem támogatott” jelölés kerül az eredménybe.

## Mérőszámok

| Mérőszám (V57) | Mérés | Feladatok |
|---|---|---|
| **Megtalálási idő és siker** | Idő mp-ben (stopper / képernyőfelvétel), sikeres-e, kattintásszám | T1–T3 |
| **Dokumentumkészítés ideje és hibái** | Idő, segítségkérések száma, hibák (pl. rossz formázás, hiányzó kapcsolat), markdown-szintaxis begépelésének esetei | T4–T5 |
| **SUS** | 10 kérdéses System Usability Scale, eszközönként; a Táltosra a 2 hetes szakasz végén újra | mindkét szakasz |
| **Adminisztrációs ráfordítás** | Idő és lépésszám (kattintás, képernyőváltás) | T6–T8 |

**Naplóadatok a 2 hetes szakaszból** (az `events` táblából, D6): létrehozott és szerkesztett dokumentumok, checkpointok, kapcsolatok típusonként, kommentek és @említések, megnyitott értesítések, „Még aktuális” megerősítések, duplikátum-figyelmeztetések elfogadása vagy figyelmen kívül hagyása.

**Interjú-témák:** mit kerestek és nem találtak; hol akadtak el a szerkesztésben; a helyi menü és a lebegő formázósáv felfedezhetősége; az értesítések hasznossága vagy zaja; a jóváhagyási folyamat terhe.

## Elemzés

Leíró statisztika: medián és interkvartilis terjedelem az időkre, sikerarány és segítségkérés-szám feladatonként, SUS-átlag és szórás eszközönként; a két eszköz páronkénti különbsége résztvevőnként. Az interjúkból tematikus összegzés. A kis minta (8–12 fő) miatt következtetéses statisztikai állítás nincs.

## Adatkezelés

Résztvevői hozzájárulás a felvételhez és a naplóadatok elemzéséhez; az eredményekben pszeudonim azonosítók (R1, R2, …); a képernyőfelvételek a dolgozat leadása után törlődnek. Éles céges tartalom nem kerülhet a pilot-környezetbe (D11).

## Előfeltétel és ütemezés

- A pilot az MVP 1–14. pontjának elkészülte után indulhat (H5 WP0–WP16); ami a kiesési sorrend miatt kimarad (pl. e-mail, duplikátum-figyelmeztetés, export), az a pilotban nem mérhető, és ezt az eredményeknél jelezni kell.
- Előkészítés: korpusz és teszt-tér a jelenlegi megoldásban, feladatlapok, moderátori forgatókönyv, hozzájárulási nyilatkozat, SUS-űrlap → H5 **WP22**.

## Vállalt korlátok

- **Dummy tartalom (V59):** a feladatok és a 2 hetes használat mesterséges; a valós tudáskeresési helyzetet csak közelítik. Különösen a 2 hetes szakasz naplóadatai gyengébbek, mert nincs valódi munkaigény mögöttük.
- **A viszonyítás konfigurációja:** a jelenlegi megoldás teszt-terét mi állítjuk be, ez torzíthatja az összevetést; a beállítást dokumentálni kell.
- **Kis minta, moderátori hatás, a résztvevők ismerik a fejlesztőt** (szociális kívánatosság).
- **Leíró eredmények (V60):** nincs előre rögzített sikerkritérium, ezért a „jobb” állítás csak leíró összevetésként fogalmazható meg.

## Nyitott kérdések

- **NY8:** Confluence vagy SharePoint: melyik a szervezet tényleges jelenlegi eszköze, és lehet-e benne dummy teszt-teret létrehozni? *(Nyitott, cégen belül tisztázandó.)*
- **NY9:** A fejlesztői környezet elérése (alagút vagy céges VPN), és ki moderál (fejlesztő vagy semleges kolléga)? *(Nyitott, később dönt.)*
- **Új mérési pontok (v10):** a review-folyamat terhelése (átfutási idő, elutasítási arány), a `pg_trgm` keresés elégsége (D49), az Atlasz-fürtözés (D44).

## Kapcsolódó egységek

[[Versenytárs-elemzés]] · [[Tervezés/Tervezés (hetedik kör)/tudasbazis-munkacsomagok-h5|H5 munkacsomag-terv]] · [[Nyomonkövetés/Eseménynapló|Eseménynapló]] · [[Szerkesztés/Markdown szerkesztő|Markdown szerkesztő]]
