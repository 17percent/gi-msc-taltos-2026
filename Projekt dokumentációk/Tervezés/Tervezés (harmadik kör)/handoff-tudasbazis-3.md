# Handoff — Vállalati tudásbázis projekt (szakdolgozat), 3. munkamenet

## Kontextus

A felhasználó ~200 fős vállalat számára készít webes, markdown-alapú tudásbázis-rendszert egyetemi szakdolgozatként; egyedül fejleszt, otthoni szerveren, éles üzem később céges infrastruktúrán (Azure Repos + Entra ID). Ez a munkamenet két részből állt:

1. **Delegálás-előkészítő elemzés:** a felhasználó azt kérdezte, mi kell ahhoz, hogy az építkezést agentnek delegálhassa. Az agent hiánylistát adott: **B1–B5 blokkolók** (B1 backend stack + worker queue implementáció, B2 frontend app-keretrendszer/router, B3 Git-hívási mód a backendben, B4 konkrét DB-séma DDL-lel, B5 API-kontraktus) és **H1–H5 hatékonyságnövelők** (user story-k AC-kkel, dev-környezet + OIDC-mock kérdés, tesztstratégia, agent-onboarding CLAUDE.md, munkacsomag-sorrend). **Ezekben döntés MÉG NEM született** — ez a következő munka.
2. **Harmadik grilling session (funkcionális scope):** a felhasználó funkciólistát hozott, az agent G1–G7 kérdéseket tett fel, minden pont döntéssel zárult → **D17–D21** a naplóban. Az architektúra a funkcionális igényeket fedi.

## Kulcs-artifact (NE duplikáld, hivatkozz rá)

**`/mnt/user-data/outputs/tudasbazis-architektura-dontesi-naplo.md` — 3. verzió!** D1–D21, frissített követelmények, adatmodell (categories, document_categories, favorites, komment soft delete, új eseménytípusok), **13 pontos MVP**, NY1–NY4. Ha nem elérhető, kérd el a felhasználótól. **Az 1–2. verziójú naplók elavultak** (nincs bennük D17–D21, 13 pontos MVP).

## A 3. munkamenet döntéseinek lényege (részletek a naplóban)

- **D17:** sablon = ugyanolyan tudásanyag, frontmatter-jelöléssel; sablonból létrehozás és duplikálás egyetlen „létrehozás forrásból" művelet (új UUID, draft, owner=létrehozó, kommentek/események nem másolódnak, `duplicated_from` esemény). MVP.
- **D18:** kedvencek MVP, **privát** (csak a saját user látja); `favorites` elsődleges (mentendő) adat, a `users` tábla már nem tisztán eldobható cache.
- **D19:** kategória = lapos címke, **alkalmazásszintű entitás CRUD-dal**, több-a-többhöz; bárki létrehozhat, **használatban lévő nem törölhető/nevezhető át**; frontmatter hordozza a kategórianevek listáját (reindex-újraépíthetőség), üres kategória csak DB-ben él → `categories` mentendő.
- **D20:** komment szerkeszthető/törölhető auditnyommal (esemény őrzi a korábbi tartalmat; törlés = soft delete + felületi placeholder). **Rendszerszintű elv: minden törlés soft delete**, végleges törlés csak retention policy szerint (→ NY4).
- **D21:** MVP-be emelve: vágólap-másolás, .md letöltés, **diff-nézet UI**, **.pdf/.docx export (pandoc)**. Az export hátrasorolt csomag (határidőnél elsőként esik ki). **Scope-fegyelem szabály: új igény csak a naplón át.**
- G2 tudatosan döntés nélkül zárult: nincs harmadik „verziószám"-fogalom (commit-történet + frontmatter `iteration` elég).

## Nyitott kérdések, következő lépések (sorrendben)

1. **B1–B3 stack-döntések** — a felhasználónak feltett kérdés, válasz még nincs. Az agent javaslatai (a felhasználó dönt!): B1: TypeScript end-to-end (Node + Fastify/NestJS), queue-ra **pg-boss** (nincs új Redis-alkatrész); B2: Vite + React SPA (SSR-igény nincs); B3: Git-hívás módja (shell-out CLI vs. simple-git stb.) nyitott. Döntés után **D22+ pontként a naplóba!**
2. **B4 — PostgreSQL séma** konkrét DDL-lel + migrációs eszköz választás. A 3. grilling után gazdagabb: categories, document_categories, favorites, soft delete mezők.
3. **B5 — API-kontraktus** (végpontlista/OpenAPI-vázlat, hibaformátum).
4. **H1 — User story-k** a 13 MVP-ponthoz (→ user-story-spec skill KÖTELEZŐ).
5. **H4 — Agent-onboarding fájl** (CLAUDE.md): a napló kényszereinek parancs-formájú desztillátuma.
6. **H5 munkacsomag-sorrend** (naplóban nem, csak a beszélgetésben): skeleton+Compose+CI → séma → auth → **Git-szerviz+queue (korán, ez a legkockázatosabb!)** → CRUD+index → keresés → lock → események/kommentek → archívum → backup → kategóriák → kedvencek → vágólap/.md → export.
7. **NY2 — Azure Repos branch policy (SÜRGŐS, külső):** kérdezz rá, egyeztetett-e már a DevOps-adminnal.
8. **NY4 — retention policy:** a felhasználó fogja kifejteni. Előre jelzett feszültség (a naplóban NY4-nél): a Git-történet és az `events` auditnyom nem felejt — a `comment_edited` esemény őrzi a régi tartalmat, így a végleges törlésnek az auditba kellene nyúlnia; a hatókör-szűkítés a valószínű megoldás. Amikor kifejti, ezzel szembesítsd.
9. H2 (dev-környezet, OIDC-mock — biztonsági döntés, ne az agent hozza meg!) és H3 (tesztstratégia) szintén döntetlen.

## Suggested skills

- **grill-me** (`/mnt/skills/user/grill-me/SKILL.md`) — a B1–B3 stack-döntési körre vagy a retention-policy átvilágítására. **D1–D21-et NE nyisd újra** (három grilling zajlott le).
- **user-story-spec** (`/mnt/skills/user/user-story-spec/SKILL.md`) — a H1 lépéshez KÖTELEZŐ; magyar, rögzített sablon; immár 13 MVP-ponthoz.
- **prototype** (`/mnt/skills/user/prototype/SKILL.md`) — lock/heartbeat állapotmodell vagy szerkesztő/diff-UX kipróbálására.
- **repo-atlas** csak már létező kódbázishoz (kód még nincs).
- **docx/xlsx/pdf** csak kifejezett Office/PDF-leadandó kérésére.

## Stílus / kommunikáció

Magyar nyelv. A felhasználó technikailag képzett, gyorsan és tételesen dönt; kifejezetten kéri a kemény, konstruktív rákérdezést és a kimondott trade-offokat (pl. az export-MVP árát az agent kimondta, a felhasználó vállalta). Minden döntést a döntési naplóban rögzíts azonnal — a napló a szakdolgozat tervezési fejezetének váza. A scope-fegyelem szabály (D21) érvényes: ami nincs a naplóban, nem épül meg.
