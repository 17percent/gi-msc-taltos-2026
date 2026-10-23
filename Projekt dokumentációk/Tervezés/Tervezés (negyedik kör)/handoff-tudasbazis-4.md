> [!warning] Elavult — 4. kör
> Az érvényes terv: [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] és a hetedik kör dokumentumai.

# Handoff — Vállalati tudásbázis projekt (szakdolgozat), 4. munkamenet

## Kontextus

A felhasználó ~200 fős vállalat számára készít webes, markdown-alapú tudásbázis-rendszert egyetemi szakdolgozatként; egyedül fejleszt, otthoni szerveren, éles üzem később céges infrastruktúrán (Azure Repos + Entra ID). Ez a munkamenet a **delegálás-előkészítés lezárása** volt: a 3. munkamenetben azonosított B1–B5 blokkolók és a H1/H4/H5 hatékonyságnövelők MIND elkészültek. **A WP0 munkacsomag delegálható.**

A felhasználó tételesen, gyorsan döntött; minden döntés a naplóba került (D22–D27). Kód továbbra sincs — minden artifact tervdokumentum.

## Kulcs-artifactok (NE duplikáld — hivatkozz, és kérd el, ha nem elérhetők)

Mind a `/mnt/user-data/outputs/`-ban készültek; a felhasználónál vannak meg véglegesen:

1. **`tudasbazis-architektura-dontesi-naplo.md` — 7. verzió!** D1–D27, NY1–NY4, 13 pontos MVP. A korábbi (1–6. verziójú) naplók elavultak. Ütközésnél MINDIG a napló nyer.
2. **`tudasbazis-db-sema-b4.md`** — teljes Drizzle-séma (9 tábla) + kézi SQL-migrációk (magyar tsvector + pg_trgm; `events` append-only trigger) + **S1–S8 séma-mikrodöntések** (a felhasználó jóváhagyta mindet) + backup-kategorizálás.
3. **`tudasbazis-api-kontraktus-b5.md`** — **A1–A8 kontraktus-elvek** (a felhasználó jóváhagyta), teljes végpontlista, RFC 9457 hibakód-katalógus, reprezentatív OpenAPI-vázlat.
4. **`tudasbazis-munkacsomagok-h5.md`** — WP0–WP14 delegálható csomagok, függőségi térkép, kész-kritériumok, MVP-lefedettségi tábla.
5. ~~User story-k (H1)~~ — *törölve 2026-10-23; a funkcionális elvárások forrása a H5 (10. verzió) kész-kritériumai és a vault egységjegyzetei.*
6. **`CLAUDE.md`** — agent-onboarding: parancs-formájú kényszer-desztillátum, dokumentumtérkép, PR-előtti önellenőrző lista. A repo gyökerébe szánva.

## E munkamenet döntései (részletek a naplóban)

- **D22 (B1):** TypeScript end-to-end, Node.js + **Fastify**; worker queue: **pg-boss** (nincs Redis; tranzakcionális job+DB-írás).
- **D23 (B2):** **Vite + React SPA + React Router** (Next.js/SSR elvetve).
- **D24 (B3):** **simple-git**, kötelező saját **`GitService`-absztrakció** mögött; írás kizárólag a pg-boss queue-ból; műveletenkénti shell-out csere megengedett a GitService-en belül.
- **D25 (B4):** **Drizzle** (Prisma elvetve a tsvector/pg_trgm miatt); keresési infrastruktúra kézi SQL-migrációban.
- **D26 (B5):** cookie-session (httpOnly) + CSRF; RFC 9457 + stabil `code`; mentés = szinkron lokális commit + aszinkron push, **kötelező `baseCommitHash` → 412**; code-first OpenAPI (@fastify/swagger); egyesített `feed` végpont; export szinkron streaming.
- **D27 (H5):** WP0–WP14 sorrend, elve: **kockázat-előrehozás** (GitService+queue = WP3, korán), gerinc először, demó-érték hátulról védett (export = WP14, elsőként esik ki).

## FÜGGŐBEN: pnpm workspaces naplóba emelése

A CLAUDE.md rögzítettként hivatkozza a **pnpm workspaces monorepót** (`apps/backend`, `apps/frontend`, `packages/shared`), de ez formálisan NINCS a naplóban — az agent felajánlotta D27-kiegészítésként, **a felhasználó még nem válaszolt** (a /handoff jött helyette). Első dolgok egyike: kérdezz rá, és ha igen, vezesd be a naplóba.

## Nyitott kérdések, következő lépések (sorrendben)

1. **H2 — OIDC-mock a dev/CI-ben: a felhasználó BIZTONSÁGI DÖNTÉSE, az agent NEM hozhatja meg.** Az agent felajánlotta a két opció (mock-identitás vs. mindig valódi Google-login) trade-off-vázlatát; döntés után **D28** a naplóba. A CLAUDE.md is tiltja az agentnek ezt a döntést.
2. **H3 — tesztstratégia** rövid egységesítő dokumentum (a story-DoD-ok már implikálják a kereteket: CI-zöld, AC-lefedő tesztek, integrációs tesztek a WP3 mentés-zápor/remote-leállás forgatókönyvre).
3. **NY2 — Azure Repos branch policy (SÜRGŐS, külső):** többször rákérdezve, a felhasználó MÉG NEM válaszolt, egyeztetett-e a DevOps-adminnal. Kérdezz rá újra. Ha a mainre kötelező PR-review van, a „mentés = commit main-re" modell borul — service account bypass kell.
4. **NY4 — retention policy:** a felhasználó fogja kifejteni. Szembesítendő feszültség (naplóban NY4-nél + B4 doksi 0002 migrációnál): az `events` append-only triggere és a Git-történet nem felejt — a retention reálisan csak a Postgres-oldali soft delete-ekre terjedhet ki; a triggert a retention-folyamatnak fel kellene oldania (szándékos súrlódás, kimondva).
5. **Delegálás indítása:** WP0 (skeleton+Compose+CI) minden előfeltétele kész. A delegált agent a CLAUDE.md + munkacsomag-doksi alapján dolgozik; csomag-zárás = CI zöld + naplópont-visszaellenőrzés + összefoglaló.

## Suggested skills

- **grill-me** (`/mnt/skills/user/grill-me/SKILL.md`) — a H2 OIDC-mock döntésre vagy az NY4 retention-kifejtésre. **D1–D27-et és a jóváhagyott S/A-pontokat NE nyisd újra.** `disable-model-invocation: true` — a felhasználó indítja `/grilling`-gel, magadtól ne.
- **prototype** (`/mnt/skills/user/prototype/SKILL.md`) — lock/heartbeat állapotmodell vagy diff-UX kipróbálására, ha a WP6/WP7 delegálása előtt kérdés merül fel.
- **repo-atlas** — amint létezik kódbázis (WP0 után), a szakdolgozat architektúra-fejezetéhez is hasznos lehet.
- **handoff** (`/mnt/skills/user/handoff/SKILL.md`) — munkamenet végén.
- **docx/pdf** csak kifejezett leadandó-kérésre (pl. a szakdolgozat fejezeteinek Word-be öntése).

## Stílus / kommunikáció

Magyar nyelv. A felhasználó technikailag képzett, tételesen és gyorsan dönt („mehet", „elfogadom"); kéri a kemény, konstruktív rákérdezést és a KIMONDOTT trade-offokat — minden javaslatnál mondd ki az árát. Munkamódszer, ami bevált: az agent hozza a javaslatot indoklással + tételes döntési pontokkal (A/S-pontok mintájára), a felhasználó jóváhagy, az agent AZONNAL naplóba rögzíti (verzió-bump + új D-pont) és külön megvalósítási referencia-dokumentumot ír. A scope-fegyelem szabály (D21) szent: új igény csak a naplón át. A napló a szakdolgozat tervezési fejezetének váza — a dokumentumok minősége leadandó-szintű legyen.
