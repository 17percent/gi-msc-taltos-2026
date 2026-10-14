# Táltos — szervezeti tudásbázis-platform

Szakdolgozati projekt (SZTE, MSc): egyedi fejlesztésű, webes, markdown-alapú tudásbázis
egy kb. 200 fős szervezet számára. A cél egy közös, kereshető tudástár, ahol minden
korábbi változat, szerkesztés és döntés visszakövethető marad. A tartalom elsősorban
**AI-eszközök** gyűjteménye: promptok, skillek, rendszerutasítások, sablonok, guide-ok
és best practice-ek.

> **Állapot:** tervezési fázis. A repóban az architektúra-terv, a design system és egy
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
├── Arch/                              Architektúra-terv (v7, Git-alapú változat — lásd lent)
│   ├── tudasbazis-architektura-dontesi-naplo.md   D1–D27 döntések, követelmények, MVP, nyitott kérdések
│   ├── tudasbazis-munkacsomagok-h5.md             WP0–WP14 munkacsomagok, függőségek, kész-kritériumok
│   ├── architecture-dashboard-v2.html             interaktív architektúra- és folyamat-dashboard
│   └── CLAUDE.md                                  agent-onboarding: a terv kőbe vésett szabályai
└── Prototypes/
    ├── taltos-projekt-overview.html   konzultációs áttekintő: aktuális architektúra + felületi terv
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

Az aktuális irányt a [`Prototypes/taltos-projekt-overview.html`](Prototypes/taltos-projekt-overview.html)
rögzíti:

```
Böngésző
   │
   ▼
React SPA — Vite + React Router (react-md-editor, keresés, kommentek)
   │  REST /api/v1
   ▼
Backend — Node.js + Fastify (TypeScript)  ──►  OIDC (fejlesztés: Google, éles: Microsoft Entra ID)
   │  lock · audit · diff-számítás · mentés = egy DB-tranzakció
   ▼
PostgreSQL — egyetlen adatréteg
   documents + document_revisions (teljes revíziótörténet)
   generált tsvector keresőindex (magyar) + events, comments, favorites, allowlist, locks
```

**Stack:** TypeScript end-to-end · Fastify (JSON Schema → generált OpenAPI) · PostgreSQL +
Drizzle · Vite + React SPA · shadcn/ui + Tailwind + Motion · @uiw/react-md-editor +
rehype-sanitize · Docker Compose.

**Fontosabb elvek:**

- **Minden írás a backend API-n át megy.** A mentés egyetlen ACID-tranzakció, amely
  revíziót ír, frissíti a keresőindexet és naplózza az eseményt.
- **Nincs fizikai törlés.** Minden törlés soft delete; végleges törlés csak egy később
  kidolgozandó retention-folyamatban lesz.
- **Egyidejű szerkesztés:** pesszimista lock heartbeattel, mellette `baseRevisionId`
  optimista ellenőrzés.
- **Biztonságos megjelenítés:** a szerkesztő és az olvasó nézet ugyanazt a sanitize
  pipeline-t használja. Nyers HTML és külső kép-URL nem jut át.
- **Csak szöveges tartalom.** Statikus képek az alkalmazás assets mappájából jönnek,
  képfeltöltés nincs.
- **Csak dummy adat.** Fejlesztéshez kizárólag mintaadat használható; éles céges tartalom
  nem kerülhet a fejlesztői környezetbe vagy a GitHubra.

### Eltérés a terv-dokumentumok között

Az `Arch/` mappa dokumentumai (döntési napló v7, munkacsomag-terv, dashboard) még a
korábbi, **Git-alapú** architektúrát írják le: a tartalom igazságforrása egy Git-repo,
mellette PostgreSQL-index, pg-boss queue és GitService. A projekt azóta erről
**csak-PostgreSQL** felépítésre váltott. A projekt-áttekintő már ezt tükrözi, az `Arch/`
fájlok még nem. Két további változás:

- A Git-írási alrendszer megszűnt, ezért a reindex/konzisztencia-őr tétel tárgytalanná
  vált. Az MVP így 13 helyett 12 pontos.
- A D6 („nincs jogosultságkezelés”) felülíródott: szerepkör-alapú hozzáférés és
  jóváhagyási (review) lépés lesz. A pontos modell kidolgozás alatt áll.

Ütközés esetén a [projekt-áttekintő](Prototypes/taltos-projekt-overview.html) az aktuális.

## MVP

1. Google OIDC login + e-mail allowlist
2. Dokumentum CRUD, „létrehozás forrásból” (üres / sablon / duplikálás)
3. Verziótörténet, visszaállítás, diff-nézet
4. Teljes szövegű keresés (magyar) + kategória/státusz/kedvenc szűrés
5. Lock heartbeattel
6. Eseménynaplózás + kommentfolyam auditnyommal
7. Archívum + visszaállítás
8. Postgres backup (ütemezett `pg_dump`)
9. Kategóriakezelés
10. Kedvencek (privát)
11. Vágólapra másolás + nyers `.md` letöltés
12. Export `.pdf`/`.docx` — hátrasorolt, határidő-nyomásnál elsőként kiesik

A prototípus a felületi pontokat lefedi. A pontok és a képernyők megfeleltetése a
[`NOTES.md`](Prototypes/tudasbazis-prototype/NOTES.md)-ben található.

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

- [`Arch/CLAUDE.md`](Arch/CLAUDE.md) — architektúra- és munkafegyelmi szabályok. Ami
  nincs a döntési naplóban, az nem épül meg.
- [`Prototypes/.claude/CLAUDE.md`](Prototypes/.claude/CLAUDE.md) — design-system
  munkafolyamat UI-hoz.

Az `Arch/CLAUDE.md` több olyan dokumentumra is hivatkozik, amely ebben a repóban nincs
meg: DB-séma (B4), API-kontraktus (B5), user story-k (H1).
