# Táltos — szervezeti tudásbázis-platform

Szakdolgozati projekt (SZTE, MSc): egyedi fejlesztésű, webes, markdown-alapú tudásbázis
egy kb. 200 fős szervezet számára. A cél egy közös, kereshető tudástár, ahol minden
korábbi változat, szerkesztés és döntés visszakövethető marad. A tartalom elsősorban
**AI-eszközök** gyűjteménye: promptok, skillek, rendszerutasítások, sablonok, guide-ok
és best practice-ek.

> **Állapot:** tervezési fázis. A repóban az architektúra-terv (10. verzió), a design system és egy
> kattintható UI-prototípus található. Az éles stack (React + Fastify + PostgreSQL)
> megvalósítása még nem indult el.

## Gyors indítás — a prototípus

A prototípus build és backend nélküli vanília HTML/CSS/JS. A `Prototypes/tudasbazis-prototype/index.html`
dupla kattintással is megnyitható, de helyi szerverrel a legmegbízhatóbb:

```bash
python -m http.server 8123 --directory Prototypes/tudasbazis-prototype
```

Windowson, ha a `python` csak a Microsoft Store álparancsa, a `py` launcher működik:

```bash
py -m http.server 8123 --directory Prototypes/tudasbazis-prototype
```

Utána: <http://localhost:8123>

- **Nincs perzisztencia:** újratöltéskor a generált seed-adat áll vissza. Csak a
  témaválasztás marad meg (`localStorage`).
- **Más korpusz:** `?seed=7` másik véletlen mintát, `?docs=120` más dokumentumszámot ad
  (alapértelmezés: 56 dokumentum).
- **Demó-eszközök:** a fejléc felhasználóváltójával kipróbálható a lock, a privát
  kedvencek és a komment-jogosultság. „Szabó Kata” szándékosan nincs az allowlisten, így
  a 403-as ágat mutatja.

## Mappaszerkezet

```
.
├── Projekt dokumentációk/             Obsidian-vault — a MESTER: egységjegyzetek, áttekintés, tervezési körök
│   ├── Táltos – Áttekintés.md         a funkcionális egységek térképe, állapotjelöléssel
│   ├── Dokumentumok/, Felhasználók/, Kollaboráció/, …   egységjegyzetek (funkcionális részletek)
│   └── Tervezés/Tervezés (hetedik kör)/                 az aktuális tervkör (v10); a korábbi körök történetiek
├── taltos-app/                        az alkalmazás: pnpm monorepo (apps/backend, apps/frontend, packages/shared), Compose — lásd taltos-app/README.md
├── .github/workflows/taltos-app-ci.yml   CI: lint, formázás, typecheck, teszt, build + Compose-füstpróba
├── tools/sync_arch.py                 az Arch/ tükör frissítése / ellenőrzése a vaultból
├── Arch/                              Architektúra-terv, 10. verzió (a vault aktuális körének tükre — nem itt szerkesztjük)
│   ├── tudasbazis-architektura-dontesi-naplo.md   D1–D49 döntések, követelmények, 20 pontos MVP, nyitott kérdések
│   ├── tudasbazis-db-sema-b4.md                   PostgreSQL-séma (Drizzle + kézi SQL-migrációk)
│   ├── tudasbazis-api-kontraktus-b5.md            REST /api/v1 + WebSocket kontraktus, hibakódok
│   ├── tudasbazis-munkacsomagok-h5.md             WP0–WP23 (+ második ütem), függőségek, kész-kritériumok
│   └── CLAUDE.md                                  agent-onboarding: a terv kőbe vésett szabályai
└── Prototypes/
    ├── taltos-projekt-overview.html   konzultációs áttekintő — v10 ELŐTTI pillanatkép, nem mérvadó
    ├── taltos-design-system.md        design system — elsődleges, agent-optimalizált referencia
    ├── taltos-design-tokens.json      ugyanezek a tokenek strukturáltan (build-tooling)
    ├── taltos-design-system.html      a renderelt design system (vizuális referencia)
    ├── taltos-login-handoff.md        integrációs spec: bejelentkező felület
    ├── taltos-home-handoff.md         integrációs spec: „Élő Atlasz” kezdőoldal
    ├── .claude/CLAUDE.md              kötelező design-system munkafolyamat UI-munkához
    └── tudasbazis-prototype/          a kattintható prototípus
        ├── index.html, app.js, styles.css, tokens.css
        ├── data.js, seedGenerator.js  determinisztikus, seedelt mintaadat
        ├── login/                     csillagkép-hátteres login, állapotgéppel
        ├── home/                      „Élő Atlasz”: kategóriánként klaszterezett tudástérkép + találati lista
        ├── NOTES.md                   a prototípus fejlesztési naplója (visszajelzési körök)
        └── design.md                  ELAVULT (Cobalt/Hallmark rendszer) — csak történeti dokumentáció
```

## Architektúra

Az egyetlen forrás-igazság a [döntési napló (10. verzió)](Arch/tudasbazis-architektura-dontesi-naplo.md);
a részletek a [B4 sémában](Arch/tudasbazis-db-sema-b4.md), a [B5 API-kontraktusban](Arch/tudasbazis-api-kontraktus-b5.md)
és a [H5 munkacsomag-tervben](Arch/tudasbazis-munkacsomagok-h5.md). Az `Arch/` mappa a
[`Projekt dokumentációk/`](Projekt%20dokument%C3%A1ci%C3%B3k/) Obsidian-vault `Tervezés (hetedik kör)` mappájának
tükre; a dokumentumokban lévő `[[…]]` hivatkozások a vault jegyzeteire mutatnak. Módosítani a vaultban kell, utána
`py -3 tools/sync_arch.py` frissíti a tükröt (`--check`: csak ellenőriz).

```
Böngésző
   │
   ▼
React SPA — Vite + React Router (CodeMirror 6 élő előnézet, feladat-dashboard, Élő Atlasz)
   │  REST /api/v1   ·   WebSocket /collab (Yjs)   ·   WebSocket /ws/notifications
   ▼
Backend — Node.js + Fastify + Hocuspocus (TypeScript)  ──►  OIDC (fejlesztés: Google, éles: Microsoft Entra ID)
   │  can() policy · láthatósági szűrés · ReviewService · audit · diff
   ▼
PostgreSQL — egyetlen adatréteg
   documents + document_revisions (teljes revíziótörténet) · change_requests (review)
   spaces + space_members · tags · document_links · notifications · events (append-only) · comments
```

**Stack:** TypeScript end-to-end · Fastify (JSON Schema → generált OpenAPI) · Hocuspocus + Yjs ·
PostgreSQL + Drizzle · Vite + React SPA · shadcn/ui + Tailwind + Motion · CodeMirror 6 + rehype-sanitize ·
Nodemailer (SMTP) · pandoc · Docker Compose.

**Fontosabb elvek:**

- **Zárt színterek.** A tartalmat csak a színtér tagjai látják. Szerepek: Rendszeradminisztrátor
  (globális, tartalmi jog nélkül), Színtérgazda és Szerző (színterenként).
- **Két review-er.** Minden tartalmi változás (létrehozás, módosítás, archiválás, visszaállítás)
  Piszkozat → Review-ra vár → Jóváhagyott / Átdolgozandó úton, két megjelölt review-er
  jóváhagyásával véglegesedik.
- **Valós idejű közös szerkesztés** a Piszkozatban (Yjs + Hocuspocus); lock nincs.
- **Minden írás a backend API-n át megy**, minden jogosultsági döntés egyetlen policy-függvényen.
- **Nincs fizikai törlés.** Minden törlés soft delete; végleges törlés csak a retenciós
  folyamatban (második ütem).
- **Biztonságos megjelenítés:** minden renderelés ugyanazt a sanitize-pipeline-t használja.
  Nyers HTML és külső kép-URL nem jut át.
- **Az MVP-ben csak szöveges tartalom.** HTML-riport, `.skill` csomag, PDF és Excel a második ütemben.
- **Csak dummy adat.** Éles céges tartalom nem kerülhet a fejlesztői környezetbe vagy a GitHubra.

## MVP

A [döntési napló](Arch/tudasbazis-architektura-dontesi-naplo.md) 5. fejezete szerint 20 pont:

1. OIDC login + allowlist + allowlist-védelem
2. Zárt színterek + Rendszeradminisztrátor, Színtérgazda, Szerző + kötelező tulajdonos
3. Létrehozás üresen vagy duplikálással + kötelező fajta + címkék
4. Valós idejű közös szerkesztés
5. Verziótörténet + diff + visszaállítás
6. Review-folyamat két review-errel + felülvizsgálati esedékesség
7. Teljes szövegű keresés (magyar) + facetek + rangsor
8. Élő Atlasz
9. Eseménynaplózás + kommentfolyam + @említés
10. Értesítések alkalmazáson belül
11. Archívum + visszaállítás
12. Postgres backup
13. Kedvencek
14. Vágólap + nyers `.md` letöltés
15. Felülvizsgálati értesítések
16. Kapcsolatok és visszahivatkozások
17. E-mail értesítés
18. Duplikátum-figyelmeztetés
19. Export `.pdf`/`.docx` — hátrasorolt, határidő-nyomásnál elsőként kiesik
20. Személyes feladat-dashboard (főoldal)

A prototípus a v10 előtti felületi modellt mutatja (lock, nyitott olvasás, négy státusz); a pontok és a
képernyők megfeleltetése a [`NOTES.md`](Prototypes/tudasbazis-prototype/NOTES.md)-ben található.

## Design system

A felület a **Táltos Design Systemre** épül: kétrétegű (primitív → szemantikus) tokenek,
automatikus világos/sötét téma a `data-theme="dark"` attribútummal, és Fraunces (cím) +
Inter (törzs) + JetBrains Mono (adat) betűtípusok.

Minden UI-munka előtt a [`taltos-design-system.md`](Prototypes/taltos-design-system.md)
az elsődleges forrás. A [`Prototypes/.claude/CLAUDE.md`](Prototypes/.claude/CLAUDE.md)
megfelelőségi checklistje kötelező: komponens-CSS-ben nincs nyers hex vagy px, csak
szemantikus token szerepel.

## Agent-delegált fejlesztés

A munka agent-delegált munkacsomagokban halad. A két `CLAUDE.md` az agentek
belépési pontja:

- [`Arch/CLAUDE.md`](Arch/CLAUDE.md) — architektúra- és munkafegyelmi szabályok (10. verzió).
  Ami nincs a döntési naplóban, az nem épül meg.
- [`Prototypes/.claude/CLAUDE.md`](Prototypes/.claude/CLAUDE.md) — design-system
  munkafolyamat UI-hoz.

