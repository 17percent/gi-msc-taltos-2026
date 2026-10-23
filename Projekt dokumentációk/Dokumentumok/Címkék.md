---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 3
---

# Címkék

> [!info] Átnevezve
> Korábban **Kategóriák**. A [[Versenytárs-elemzés]] V23–V24 döntése óta a fogalom neve **címke**, és nem kézzel karbantartott törzsadat.

## Cél

Lapos címkékkel lehessen csoportosítani a tudásanyagokat. Egy dokumentumnak több címkéje is lehet.

## Döntés (V23–V24)

- **Globális készlet (V23):** egyetlen címkekészlet, amelyen minden színtér osztozik. Színtér-saját címke nincs.
- **Nincs külön létrehozás (V24):** a címkét a dokumentum létrehozásakor vagy szerkesztésekor adják meg: a meglévő címkék listájából választva, vagy szabad kézzel beírva. A Kategóriák nézet (`#/categories`) mint létrehozó felület megszűnik.
- **Redundancia-szűrés (V24):** szabad kézi megadásnál a rendszer ellenőrzi, létezik-e már azonos vagy hasonló címke, és azt kínálja fel, hogy ne kerüljenek redundáns címkék a rendszerbe. Összevetés normalizált alakon (kis- és nagybetű, ékezet, szóközök) és `pg_trgm`-hasonlósággal (pl. „Prompt” ↔ „promptok”).
- Új címke csak akkor jön létre, ha a felhasználó a felajánlás után is az új alakot választja (`tag_created` esemény).
- **Fajta külön mezőben (V27):** a dokumentum fajtája (prompt, skill, agent-definíció, MCP-szerver …) nem címke, hanem kötelező, egyértékű `documents.kind` mező rögzített listából (Admin bővítheti). A címkék a témát jelölik.
- **Nincs utólagos összevonás vagy átnevezés (V29):** a redundancia ellen kizárólag a beíráskori felajánlás véd.
- **Árva címkék rejtve (V30):** a dokumentumhoz már nem kötött címke nem jelenik meg a listában és a facetben, de a rekord megmarad; újbóli beíráskor ugyanaz a címke tér vissza.
- Adatmodell: `categories` → `tags` (`id`, `name`, `normalized_name UNIQUE`, `created_by`, `created_at`), `document_categories` → `document_tags`.

## Működés a prototípusban

*(Előzmény, a V24 előtti állapot.)* Kategóriák nézet (`#/categories`): létrehozás, átnevezés, törlés. Használatban lévő kategória nem törölhető és nem nevezhető át (409 `category_in_use`).
A seed-korpuszban a kategória a dokumentum **fajtája** (Promptok, Skillek, Guide-ok, Sablonok, Best practice-ek, Rendszerutasítások, Agent-definíciók, Kiértékelő készletek, MCP-szerverek), nem a témaköre.
Az Élő Atlaszon a kategória színt és szűrőt ad, helyet nem (5. kör). Több kategória esetén a csomópont színátmenetet kap (6. kör).

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D19 (lapos, több-a-többhöz, bárki létrehozhat, használatban lévő védett, műveletek naplózva), D28 (a kategória szűrő, nem hely; az Arch-mappa naplójában).

## Nyitott kérdések

- Szükség lesz-e mégis hierarchiára vagy egy második dimenzióra (pl. téma vagy fajta)? Ma szándékosan egy dimenzió van. **[[Versenytárs-elemzés]] V5:** a lapos címke marad; a SharePoint-féle típusos metaadatokat és a BookStack-hierarchiát nem vesszük át.
- ~~Színterenként saját készlet vagy globális?~~ **Döntve (V23):** globális.
- ~~Utólagos összevonás?~~ **Döntve (V29):** senki. Ha mégis bekerül egy elírt címke, az a dokumentum szerkesztésével cserélhető, a régi alak pedig árvaként elrejtődik (V30).
- ~~Árva címkék?~~ **Döntve (V30):** rejtve maradnak.
- ~~Atlasz-szín?~~ **Döntve (V28):** a színtérből jön, lásd [[Felfedezés/Élő Atlasz|Élő Atlasz]].
- ~~Fajta?~~ **Döntve (V27):** külön, rögzített `kind` mező.
- ~~Seed-migráció?~~ **Döntve (V33):** a kilenc kategória `kind` érték lesz; a seed-generátor dokumentumonként 1–3 témacímkét kap egy rögzített listából, hogy a címke-facet és a felajánlás kipróbálható legyen.
- ~~Hasonlósági küszöb?~~ **Döntve (V34):** a normalizált (kisbetűs, ékezet nélküli, szóköz-normalizált) pontos egyezést automatikusan a meglévő címkére cseréljük; `pg_trgm` hasonlóság ≥ 0,4 esetén legfeljebb 3 javaslat jelenik meg. A küszöb a pilotban hangolandó.

## Kapcsolódó egységek

[[Felfedezés/Szűrők|Szűrők]] · [[Felfedezés/Élő Atlasz|Élő Atlasz]] · [[Dokumentumok/Kapcsolatok|Kapcsolatok]]
