---
tags:
  - taltos/moc
---

# Táltos – Áttekintés

A projekt funkcionális egységeinek térképe. Állapotjelölés: ✅ a prototípusban működik · ✖ elvetve · ⚙️ nem UI-elem (backend/üzem) · 📘 döntve, a prototípusban még nincs · 💡 javaslat (még nincs naplópontja) · ❓ nyitott kérdés (NY).

Források: [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] · prototípus: `msc/Szakdoga/Prototypes/tudasbazis-prototype` · [[Branding]] · [[Versenytárs-elemzés]]

## Adattárolás

| Egység | Lényeg | MVP (v10) | Állapot |
|---|---|---|---|
| [[Adattárolás/Adatmodell\|Adatmodell]] | Postgres-only, táblák és szerepük | — | ✅ |
| [[Adattárolás/Revíziók tárolása\|Revíziók tárolása]] | teljes pillanatkép mentésenként | 5 | ✅ |
| [[Adattárolás/Keresőindex\|Keresőindex]] | generált `tsvector` + `pg_trgm` | 7 | ✅ |
| [[Adattárolás/Tranzakciós mentés\|Tranzakciós mentés]] | mentés = egy ACID-tranzakció | 4 | ✅ |
| [[Adattárolás/Többformátumú tartalom és verziókövetés\|Többformátumú tartalom]] | HTML-riport, `.skill`, PDF, Excel; blobok Postgresben | 2. ütem | 📘 D42 |

## Dokumentumok

| Egység | Lényeg | MVP (v10) | Állapot |
|---|---|---|---|
| [[Dokumentumok/Címkék\|Címkék]] | globális, szabadon megadott címkék, duplikátumszűrés | 3 | ✅ (átalakítandó: V24) |
| [[Dokumentumok/Verziózás\|Verziózás]] | történet, diff, visszaállítás | 5 | ✅ |
| [[Dokumentumok/Státusz-workflow\|Státusz-workflow]] | Piszkozat → Review-ra vár → Jóváhagyott / Átdolgozandó, két review-er (2026-10-23) | 6 | ✅ (régi 4 státusz) · 📘 D45 |
| [[Dokumentumok/Archívum\|Archívum]] | soft delete + visszaállítás | 11 | ✅ |
| [[Dokumentumok/Kapcsolatok\|Kapcsolatok]] | explicit, típusos dokumentum-kapcsolatok | 16 | 📘 |
| [[Dokumentumok/Felülvizsgálat\|Felülvizsgálat]] | szerző által megadott esedékesség, értesítés | 15 | 📘 |

## Felhasználók

| Egység | Lényeg | MVP (v10) | Állapot |
|---|---|---|---|
| [[Felhasználók/Bejelentkezés\|Bejelentkezés]] | OIDC (Google → Entra ID) | 1 | ✅ |
| [[Felhasználók/Allowlist\|Allowlist]] | kérésenkénti belépési jog | 1 | ✅ |
| [[Felhasználók/Munkamenet és CSRF\|Munkamenet és CSRF]] | httpOnly cookie + CSRF | — | ⚙️ |
| [[Felhasználók/Jogosultságok\|Jogosultságok]] | színterenkénti szerepkörök | 2 | 📘 |
| [[Felhasználók/Szerepkörök\|Szerepkörök]] | Rendszeradminisztrátor; színtéren belül Színtérgazda + Szerző; jogosultsági mátrix | 2 | 📘 D43 |

## Kollaboráció

| Egység | Lényeg | MVP (v10) | Állapot |
|---|---|---|---|
| [[Kollaboráció/Színterek\|Színterek]] | csapat- és projekt-terek, Általános; **zárt: csak a tagok látják** | 2 | 📘 D44 |
| [[Kollaboráció/Kommentek\|Kommentek]] | egyesített feed, auditált szerkesztés | 9 | ✅ |
| [[Kollaboráció/Valós idejű közös szerkesztés\|Valós idejű közös szerkesztés]] | Yjs + Hocuspocus, névcímkés kurzorok; kiváltja a zárolást | 4 | 📘 |

## Felfedezés

| Egység | Lényeg | MVP (v10) | Állapot |
|---|---|---|---|
| [[Felfedezés/Élő Atlasz\|Élő Atlasz]] | élő tudástérkép + találati lista | 8 | ✅ |
| [[Felfedezés/Keresés\|Keresés]] | cím + tartalom, kiemeléssel | 7 | ✅ |
| [[Felfedezés/Szűrők\|Szűrők]] | facetek, kiemelés törlés helyett | 7 | ✅ |
| [[Felfedezés/Kedvencek\|Kedvencek]] | privát, nem naplózott | 13 | ✅ |

## Szerkesztés

| Egység | Lényeg | MVP (v10) | Állapot |
|---|---|---|---|
| [[Szerkesztés/Markdown szerkesztő\|Markdown szerkesztő]] | élő előnézet (Obsidian-modell), helyi menü, Tulajdonság-panel | 4 | ✅ (osztott nézet) · 📘 D40 |
| [[Szerkesztés/Zárolás\|Zárolás]] | lock + heartbeat — kivezetendő, lásd [[Kollaboráció/Valós idejű közös szerkesztés\|közös szerkesztés]] | — (csak prototípus) | ✅ (prototípus) |
| [[Szerkesztés/Létrehozás forrásból\|Létrehozás forrásból]] | üres, duplikálás (MVP) · sablonból, forrásból = fájlimport (2. ütem) | 3 | ✅ · 📘 D47 |

## Nyomonkövetés és transzparencia

| Egység | Lényeg | MVP (v10) | Állapot |
|---|---|---|---|
| [[Nyomonkövetés/Eseménynapló\|Eseménynapló]] | append-only `events` | 9 | ✅ |
| [[Nyomonkövetés/Értesítések\|Értesítések]] | alkalmazáson belül (WebSocket) + e-mail, napi összefoglaló | 10, 17 | 📘 D46 |
| [[Nyomonkövetés/Feladat-dashboard\|Feladat-dashboard]] | főoldal: review-k, indítványok, felülvizsgálatok, kérések | 20 | 📘 D46 |
| [[Transzparencia/Auditnapló\|Auditnapló]] | rendszerszintű audit nézet | 9 | ✅ |

## Kimenet és üzemeltetés

| Egység | Lényeg | MVP (v10) | Állapot |
|---|---|---|---|
| [[Kimenet/Vágólap és letöltés\|Vágólap és letöltés]] | másolás, nyers `.md` | 14 | ✅ |
| [[Kimenet/MCP és API\|MCP és API]] | AI-asszisztensek olvasási elérése | 2. ütem | 📘 |
| [[Kimenet/Export\|Export]] | `.pdf`/`.docx` pandoc-kal | 19 | ✅ (mock) |
| [[Üzemeltetés/Backup\|Backup]] | ütemezett `pg_dump` | 12 | ⚙️ |
| [[Üzemeltetés/Adatmegőrzés\|Adatmegőrzés]] | „a tudás megmarad, a zaj törlődik”; automatikus végleges törlés | — | 📘 D48 |
| [[Üzemeltetés/Vészhelyzeti tükör\|Vészhelyzeti tükör]] | napi `.md`-tükör | — | ✖ elvetve (NY5) |

## Értékelés

| Egység | Lényeg | MVP (v10) | Állapot |
|---|---|---|---|
| [[Értékelés/Pilot-terv\|Pilot-terv]] | 8–12 fő, Confluence/SharePoint-hoz viszonyítva, feladat-session + 2 hét | MVP 1–14 után | 📘 D41 |

## Teendők a naplóban

- ✅ A [[Versenytárs-elemzés]] V1–V39 pontjai a [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] D29–D41 pontjaiként rögzítve; a D6 felülírása (D31, D32) és a D28 átvétele megtörtént.
- ✅ NY6 lezárva: 19 pontos MVP, kiesési sorrend és megállási feltétel — [[Tervezés/Tervezés (hatodik kör)/tudasbazis-munkacsomagok-h5|H5 v9]] → [[Tervezés/Tervezés (hetedik kör)/tudasbazis-munkacsomagok-h5|H5 v10]].
- ✅ NY7 lezárva: Kapcsolatok = D39.
- ✅ **v10 (2026-10-23):** a vault nyitott kérdései és naplóütközései átvizsgálva → D42–D49 (többformátum, szerepkörök, zárt színterek, review-folyamat, dashboard, létrehozási utak, adatmegőrzés, kisebb döntések). NY3, NY4 lezárva, NY5 elvetve; MVP 20 pont.
- Nyitott a naplóban: **NY8** (pilot összehasonlítási alapja), **NY9** (pilot hozzáférése és moderálása), ~~NY10~~ (lezárva: 8 óra / 60 perc).
- ✅ A v10 részletdokumentumai: [[Tervezés/Tervezés (hetedik kör)/tudasbazis-db-sema-b4|B4 séma]] · [[Tervezés/Tervezés (hetedik kör)/tudasbazis-api-kontraktus-b5|B5 API]] · [[Tervezés/Tervezés (hetedik kör)/tudasbazis-munkacsomagok-h5|H5 munkacsomagok]] (WP0–WP23 + 6 második ütemes csomag).
