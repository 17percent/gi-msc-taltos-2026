---
tags:
  - taltos/egyseg
allapot: döntve
mvp: 2
---

# Színterek

> [!success] Döntve — D30
> Rögzítve a [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]]-ben. A prototípusban még nincs megvalósítva; a jegyzet nyitott kérdései továbbra is nyitottak.

> [!warning] Módosítva — D44 (Döntési napló v10): zárt színterek
> A színtér tartalmát **csak a tagjai látják**. Ez felülírja a lenti „Olvasás mindig nyitott” pontot (D30). A színteret a Rendszeradminisztrátor hozza létre, és létrehozáskor kijelöli a Színtérgazdát; a tagokat a Színtérgazda veszi fel (szerepek: Színtérgazda, Szerző). Lásd [[Felhasználók/Szerepkörök|Szerepkörök]].
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

- **Általános:** a beépített, mindenki által látható alapszíntér. A közös, szervezeti szintű tudás itt él.
- **Olvasás mindig nyitott (döntve):** minden színtér tartalmát minden belépett felhasználó látja, keresi és az Atlaszon is megjelenik. A színtér csak **írási és jóváhagyási** határ, így a D6 olvasási nyitottsága megmarad. Zárt színtér nincs.
- **Egy dokumentum = egy színtér (döntve):** pontosan egy színtér birtokolja (`documents.space_id`), onnan jön a jogosultság. Más színterek [[Dokumentumok/Kapcsolatok|kapcsolattal]] hivatkozhatnak rá, megosztás nincs.
- A színtér a jogosultság egysége, lásd [[Felhasználók/Jogosultságok|Jogosultságok]].
- **Felületen:** színtérváltó a sidebarban; az Atlasz és a lista alapból az aktuális színteret mutatja, „Összes színtér” nézettel; a színtér facetként is szűrhető.
- **Adatmodell:** `spaces (id, name, type, description, color, closed_at, deleted_at)` (a `color` az Atlasz alapszíne, V28), `user_space_colors (user_id, space_id, color)` (egyéni felülírás), `space_members (space_id, user_id, role)`.
- **Események:** `space_created`, `space_closed`, `member_added`, `member_removed`, `role_changed`.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D6 (felülírva), D19. Új D-pont szükséges.

## Nyitott kérdések

- ~~Áthelyezhető-e dokumentum színterek között?~~ **Döntve ([[Versenytárs-elemzés]] V26):** nem. Másik színtérbe csak duplikálással kerülhet (új dokumentum a célszíntérben, `származik` kapcsolattal); az eredeti szükség szerint archiválható. A `document_moved` esemény megszűnik.
- **Atlasz (V25, döntve):** egy közös térkép; alapból az aktuális színtér van kiemelve, a többi halványan látszik („kiemel, nem töröl”), a színtér facetként szűrhető.
- **Ki hoz létre színteret?** **Döntve (2026-10-23):** a Rendszeradminisztrátor hozza létre és zárja le, és ő nevezi ki a Színtérgazdát; a tagokat a Színtérgazda kezeli. Minden színtérnek legalább egy Színtérgazdája van (409 `last_space_manager`). Lásd [[Felhasználók/Szerepkörök|Szerepkörök]].
- ~~Lezárt projekt-tér dokumentumai?~~ **Döntve (D44):** maradnak, a tér és a tagság csak olvasható. Ami máshol is kell, duplikálással (review-val) vihető át.
- ~~Ki kérhet projekt-teret?~~ **Döntve (D43):** bárki kérheti, a Rendszeradminisztrátor hagyja jóvá.
- **Atlasz (D44, felülírja a V25-öt):** csak a saját színterek látszanak; alapból az aktuális színtér, a többi saját színtér facetként bekapcsolható.

## Kapcsolódó egységek

[[Felhasználók/Jogosultságok|Jogosultságok]] · [[Felfedezés/Élő Atlasz|Élő Atlasz]] · [[Felfedezés/Szűrők|Szűrők]] · [[Nyomonkövetés/Értesítések|Értesítések]]
