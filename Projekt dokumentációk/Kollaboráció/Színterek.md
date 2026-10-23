---
tags:
  - taltos/egyseg
allapot: döntve
mvp: 2
---

# Színterek

> [!success] Döntve — D30, D43, D44
> Rögzítve a [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]]-ben. A prototípusban még nincs megvalósítva.

> [!warning] Módosítva — D44 (Döntési napló v10): zárt színterek
> A színtér tartalmát **csak a tagjai látják**. Ez felülírta a D30 „olvasás mindig nyitott” pontját. A színteret a Rendszeradminisztrátor hozza létre, és létrehozáskor kijelöli a Színtérgazdát; a tagokat a Színtérgazda veszi fel (szerepek: Színtérgazda, Szerző). Lásd [[Felhasználók/Szerepkörök|Szerepkörök]].
>
> **Érintett egységek (láthatósági szűrés a tagságra):** [[Felfedezés/Keresés|Keresés]] · [[Felfedezés/Élő Atlasz|Élő Atlasz]] · [[Dokumentumok/Kapcsolatok|Kapcsolatok]] · [[Nyomonkövetés/Értesítések|Értesítések]] · [[Kimenet/MCP és API|MCP és API]]. **Általános:** minden felhasználó automatikusan Szerző benne (D43). **Idegen link:** csonk „nem elérhető” üzenettel, rejtett címmel és „Felvétel kérése” gombbal (D44).

## Cél

A tudás egy közös térben, de csapatonként és projektenként tagolva éljen: legyen gazdája, tagjai és saját jóváhagyói.

## Működés a prototípusban

A prototípusban nincs színtér. Minden dokumentum egyetlen közös térben él.

## Javaslat

A színtér egyszerre lehet **csapat-munkatér** és **projekt-tér**. Ugyanaz az entitás, egy `type` mező különbözteti meg őket.

| | Csapat-munkatér | Projekt-tér |
|---|---|---|
| Élettartam | tartós | időben korlátos, lezárható |
| Tagság | a csapat (később Entra ID csoportból) | a projekt résztvevői |
| Lezáráskor | — | csak olvasható lesz, majd archiválható |

- **Általános:** a beépített alapszíntér; minden allowlistes felhasználó automatikusan Szerző benne (D43). A közös, szervezeti szintű tudás itt él. ~~„mindenki által látható”~~ → D44: az Általános is zárt, tagsága viszont automatikus.
- ~~**Olvasás mindig nyitott:** minden színtér tartalmát minden belépett felhasználó látja… Zárt színtér nincs.~~ **Felülírva (D44):** a színtér tartalmát csak a tagjai látják; a színtér olvasási és írási határ is.
- **Egy dokumentum = egy színtér (döntve):** pontosan egy színtér birtokolja (`documents.space_id`), onnan jön a jogosultság. Más színterek [[Dokumentumok/Kapcsolatok|kapcsolattal]] hivatkozhatnak rá, megosztás nincs.
- A színtér a jogosultság egysége, lásd [[Felhasználók/Jogosultságok|Jogosultságok]].
- **Felületen:** színtérváltó a sidebarban; az Atlasz és a lista alapból az aktuális színteret mutatja, „Összes színtér” nézettel; a színtér facetként is szűrhető.
- **Adatmodell:** `spaces (id, name, type, description, color, closed_at, deleted_at)` (a `color` az Atlasz alapszíne, V28), `user_space_colors (user_id, space_id, color)` (egyéni felülírás), `space_members (space_id, user_id, role)`.
- **Események:** `space_created`, `space_closed`, `space_updated` (leírás, szín), `member_added`, `member_removed`, `role_changed`, `space_manager_assigned`, `space_requested`, `membership_requested` stb.
- **Lezárt projekt-tér:** a dokumentumok és a tagság megmarad, minden csak olvasható (D44). A lezáráskor függő review sorsa és a lezárt tér archiválása: ❓ nyitott (NY11–NY19 a naplóban).

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D30 (színterek), D37 (színezés), D43, D44 (zárt színterek, felvételi kérés), D6 (felülírva).

## Nyitott kérdések

- ~~Áthelyezhető-e dokumentum színterek között?~~ **Döntve ([[Versenytárs-elemzés]] V26):** nem. Másik színtérbe csak duplikálással kerülhet (új dokumentum a célszíntérben, `származik` kapcsolattal); az eredeti szükség szerint archiválható. A `document_moved` esemény megszűnik.
- ~~**Atlasz (V25):** egy közös térkép; a többi színtér halványan látszik.~~ **Felülírva (D44):** lásd az utolsó pontot.
- **Ki hoz létre színteret?** **Döntve (2026-10-23):** a Rendszeradminisztrátor hozza létre és zárja le, és ő nevezi ki a Színtérgazdát; a tagokat a Színtérgazda kezeli. Minden színtérnek legalább egy Színtérgazdája van (409 `last_space_manager`). Lásd [[Felhasználók/Szerepkörök|Szerepkörök]].
- ~~Lezárt projekt-tér dokumentumai?~~ **Döntve (D44):** maradnak, a tér és a tagság csak olvasható. Ami máshol is kell, duplikálással (review-val) vihető át.
- ~~Ki kérhet projekt-teret?~~ **Döntve (D43):** bárki kérheti, a Rendszeradminisztrátor hagyja jóvá.
- **Atlasz (D44, felülírja a V25-öt):** csak a saját színterek látszanak; alapból az aktuális színtér, a többi saját színtér facetként bekapcsolható.

## Kapcsolódó egységek

[[Felhasználók/Jogosultságok|Jogosultságok]] · [[Felfedezés/Élő Atlasz|Élő Atlasz]] · [[Felfedezés/Szűrők|Szűrők]] · [[Nyomonkövetés/Értesítések|Értesítések]]
