# Stack-profil: Táltos — szervezeti tudásbázis-platform

Forrás: `.claude/fleet/project/profile.md` (a `/configure-fleet` generálta, 2026-10-14; ezt a fájlt szerkeszd, utána futtasd újra: `py -3 .claude/fleet/tools/apply_project_overlay.py`).

Szakdolgozati projekt (SZTE MSc), egyszemélyes fejlesztés, agent-delegált munkacsomagokkal. Webes, markdown-alapú tudásbázis egy kb. 200 fős szervezetnek; a tartalom elsősorban AI-eszközök (promptok, skillek, rendszerutasítások, sablonok, guide-ok, best practice-ek). **Állapot:** tervezési fázis — terv-dokumentumok, design system és egy kattintható vanília JS prototípus; az éles stack kódja még nem létezik (a WP0-val indul).

## Rögzített tények

- **Nyelv:** TypeScript end-to-end. Más futásidejű nyelv (C#, Python, Java) bevezetése architektúra-döntés.
- **Monorepo (rögzített, tulajdonosi döntés):** pnpm workspaces — `apps/backend`, `apps/frontend`, `packages/shared` (közös típusok, API-kontraktus típusai).
- **Backend:** Node.js + Fastify; JSON Schema validáció → code-first, generált OpenAPI. REST `/api/v1`.
- **Adatréteg: PostgreSQL az EGYETLEN adatréteg** — tartalom, teljes revíziótörténet (`documents` + `document_revisions`, mentésenként teljes szövegű pillanatkép), generált keresőindex (`tsvector`, magyar konfiguráció, `GENERATED ALWAYS AS … STORED`, GIN, `pg_trgm`), színterek és tagság, review-kérések, címkék, kapcsolatok, értesítések, events, comments, favorites, allowlist, users (teljes lista: `Arch/tudasbazis-db-sema-b4.md`, 10. verzió). **Drizzle** a séma- és query-réteg; a keresési infrastruktúra és az append-only trigger kézi SQL-migrációban él.
- **Nincs Git-alapú tárolás:** nincs Git source of truth, nincs lokális clone, nincs pg-boss queue, nincs GitService, nincs SSH-kulcs, nincs reindex/konzisztencia-őr. Az `Arch/` dokumentumok (10. verzió) már ezt a felépítést írják le.
- **Frontend (éles):** Vite + React SPA + React Router (SSR / Next.js nincs); shadcn/ui (bemásolt, saját komponenskód) + Tailwind + Motion; szerkesztő: CodeMirror 6 élő előnézettel; közös szerkesztés: Yjs + Hocuspocus (`/collab`, a Fastify-jal közös Node-folyamatban); `rehype-sanitize` minden renderelésnél azonos pipeline-nal.
- **Prototípus (aktív terület):** `Prototypes/tudasbazis-prototype/` — vanília HTML/CSS/JS, **semmilyen külső futásidejű könyvtár**; Canvas 2D + Web Animations API + saját állapotgépek; klasszikus `<script>`-ek (nincs build, nincs modul-bundler); seedelt mintaadat (`seedGenerator.js`, `?seed=`, `?docs=`).
- **Design system: Táltos Design System** (nem Telerik, nem Cobalt). Elsődleges forrás: `Prototypes/taltos-design-system.md`; tokenek: `Prototypes/taltos-design-tokens.json`, vizuális referencia: `Prototypes/taltos-design-system.html`. Kétrétegű tokenek (primitív → szemantikus), téma `data-theme="dark"`; Fraunces (csak cím) · Inter (törzs, UI) · JetBrains Mono (adat).
- **Auth:** generikus OIDC (fejlesztés: Google, éles: Microsoft Entra ID); httpOnly cookie-session + CSRF-token minden mutáló kérésen; e-mail allowlist minden kérésnél, middleware-ben. Bearer-token flow nincs.
- **Infrastruktúra:** Docker Compose (frontend, backend, Postgres); secretek Compose secrets-ként, csak a backend kapja; backup: napi `pg_dump`, 30 napos + 12 havi megőrzés, titkosítva, külön tárolón; e-mail: Nodemailer (SMTP), fejlesztésben Mailpit. Fejlesztés saját infrastruktúrán, éles üzem céges infrastruktúrán. Repó: GitHub (`17percent/gi-msc-taltos-2026`).

## Architektúra és rétegszabályok

`böngésző → React SPA → REST /api/v1 → Fastify backend → PostgreSQL`; a backend az egyetlen író kapu.

- A frontend SOHA nem ér el közvetlenül adatbázist; minden írás a backend API-n át megy.
- A közös típusok/kontraktus a `packages/shared`-ben élnek; a `apps/frontend` és a `apps/backend` egymást nem importálja.
- **Szerkesztés és véglegesítés (D29, D45):** a tartalom a `/collab` WebSocketen folyamatosan perzisztálódik, a checkpoint revíziót ír, de nem véglegesít. Véglegesíteni csak a **két review-eres folyamat** tud (Piszkozat → Review-ra vár → Jóváhagyott / Átdolgozandó); a Jóváhagyott állapotot kizárólag a `ReviewService` írja, egy tranzakcióban. Review-ra küldés kötelezően `baseRevisionId`-vel; eltérésnél 412. Lock nincs (csak a prototípusban).
- **Nincs fizikai DELETE az alkalmazáskódból:** minden törlés soft delete (`deleted_at` / archívum); végleges törlés csak a retenciós folyamatban (D48, második ütem, `taltos_retention` DB-szerep).
- Az `events` és a `document_revisions` tábla append-only (trigger tiltja az UPDATE/DELETE-et); minden mutáló művelet eseményt naplóz. Új eseménytípus = TS-union bővítés, nem DB-migráció.
- A dokumentum identitása UUID, amit az alkalmazás generál (nem a DB).
- Hibaválasz: RFC 9457 Problem Details + stabil `code` mező; ad-hoc hibaformátum nincs.
- Az MVP-ben csak szöveges tartalom; statikus képek az alkalmazás saját assets-útvonaláról; külső kép-URL blokkolt a sanitize-sémában. Többformátumú tartalom (HTML-riport, `.skill`, PDF, Excel) a második ütemben (D42) — addig ne építsd.
- **Hozzáférési modell (D43, D44):** globálisan Rendszeradminisztrátor (tartalmi jog nélkül); színterenként Szerző és Színtérgazda. A színterek **zártak**: minden olvasó lekérdezés a „látható dokumentumok” lekérdezés-építőn megy át, minden jogosultsági döntés az egyetlen `can(user, action, resource)` policy-függvényen. Nem tagnak 403 `not_space_member`, cím nélkül.

## Kockázatos területek (L-tier a dev-loopban, tulajdonosi döntés)

- **Auth és hozzáférés:** OIDC, session (8 óra / 60 perc tétlenség), CSRF, allowlist-middleware, `can()` policy, láthatósági szűrés (szivárgás minden olvasó úton).
- **Review- és szerkesztési útvonal:** `ReviewService` állapotgépe és versenyhelyzetei, `baseRevisionId`-ellenőrzés, Hocuspocus `onAuthenticate` és `readOnly`, eseménynapló (append-only).

A flotta általános jelei (pl. SQL/migráció, titok, kriptó) változatlanul érvényesek.

## Konvenciók

- **Forrás-hierarchia:** a döntési napló (`Arch/tudasbazis-architektura-dontesi-naplo.md`, 10. verzió) az egyetlen forrás-igazság; utána a B4, B5, H5 és az `Arch/CLAUDE.md`. Az `Arch/` az Obsidian-vault (`Projekt dokumentációk/`, a mester) hetedik körének tükre: az `Arch/`-ot nem szerkeszted, a vaultban módosítasz, és `py -3 tools/sync_arch.py` frissíti. Ütközést jelezz, ne dönts helyette.
- **Scope-fegyelem (D21):** ami nincs a döntési naplóban, azt NEM építed meg; új igényt naplópontként jelezz.
- Nyitott kérdést ne dönts el magad (jelenleg: NY8 pilot-alap, NY9 pilot-hozzáférés, az MCP-olvasás naplózása). OIDC-mock nincs: tesztben session-injektálás (D49).
- **UI-munka előtt kötelező:** `Prototypes/.claude/CLAUDE.md` munkafolyamata és megfelelőségi checklistje — komponens-CSS-ben nincs nyers hex/px, csak szemantikus token; `:focus-visible` mindenhol; kontraszt ≥ 4.5:1 mindkét témában; `prefers-reduced-motion`; 360px-ig reszponzív; a felület hangja cselekvő, nincs zsargon (a prototípusból a Git-szókincs is kikerült).
- A prototípus visszajelzési köreit a `Prototypes/tudasbazis-prototype/NOTES.md` naplózza; nagyobb felületi változás után bővítsd. A `design.md` ELAVULT (Cobalt), kódot ne emitálj belőle.
- **Nyelv:** dokumentáció és UI magyarul; commit üzenet angolul, felszólító módú tárgysor + indokló törzs.
- **Csak dummy adat:** éles céges tartalom soha nem kerül a fejlesztői környezetbe vagy GitHubra (D11). Secretek soha nem kerülnek image-be, repóba, commitolható `.env`-be vagy logba.
- Új függőség, végpont, tábla, funkció → kell hozzá naplópont/kontraktus-frissítés; ha nincs: STOP, jelezd.

## Kapuk

- **Jelenleg nincs build/teszt kapu** (nincs `package.json`, nincs CI). Ne találj ki parancsot.
- **Prototípus-ellenőrzés:** helyi szerver (`py -m http.server 8123 --directory Prototypes/tudasbazis-prototype`, vagy a `.claude/launch.json` „tudasbazis-prototype” konfigja), a böngésző-konzol hibamentes, a DS-checklist teljesül, mindkét témában ellenőrizve.
- **A WP0 után (tervezett, még nem ellenőrzött):** CI-ben lint (ESLint + Prettier), typecheck, test, build pnpm-mel; a pontos parancsokat a WP0 rögzíti — onnantól azokat használd, és frissítsd ezt a profilt (`/configure-fleet`).
- Windowson a `python` a Microsoft Store álparancsa; Pythonhoz `py -3`.

## Platform és munkafolyamat

- Repó: GitHub, egyetlen hosszú életű ág: `main`; feature-ágak rövid életűek, fast-forwarddal kerülnek a `main`-re. Push csak kifejezett tulajdonosi jóváhagyással.
- CI: a WP0 hozza létre (GitHub Actions, PR-en zöld). Compose: `docker compose up` a fejlesztői környezet.
- Munkacsomagok: WP0–WP23, második ütem WP30–WP35 (`Arch/tudasbazis-munkacsomagok-h5.md`, 10. verzió) — sorrend, függőségek, kész-kritériumok; kockázat-előrehozott elemek: a közös szerkesztés spike (WP3, megállási feltétellel) és a láthatósági szűrés (WP4).
- MVP: 20 pont (napló 5. fejezet); az export (.pdf/.docx, pandoc) hátrasorolt, elsőként esik ki; a dashboard (WP23) nem eshet ki.
- Éles: céges infrastruktúra, Entra ID; Azure-specifikus munka csak kifejezett kérésre.

## Domain-szótár

| Fogalom (HU) | Kódban (EN) | Jelentés |
|---|---|---|
| Táltos | taltos | a termék neve |
| tudásanyag, dokumentum | document | egy markdown-tartalom UUID-identitással |
| revízió, verzió | revision | mentésenkénti teljes szövegű pillanatkép; visszaállítás = új revízió |
| iteráció | iteration | a Jóváhagyott változások száma (v1, v2 …) |
| sablon | template (`is_template`) | sablon is tudásanyag |
| létrehozás | create | üres vagy duplikálás (MVP); sablonból és forrásból = fájlimport (második ütem, D47) |
| fajta | kind | kötelező, egyértékű típus (prompt, skill, agent …) a `document_kinds` listából (D34) |
| címke | tag | globális, lapos címke normalizált duplikátum-szűréssel (D34) |
| színtér | space | Általános / csapat / projekt; zárt, csak a tagok látják (D30, D44) |
| Színtérgazda, Szerző | space_manager, author | színtér-szerepek (D43) |
| Rendszeradminisztrátor | system_admin | globális adminisztratív szerep, tartalmi jog nélkül (D43) |
| review-kérés | change_request | két review-er jóváhagyásával véglegesedő változás (D45) |
| kedvenc | favorite | privát, felhasználónkénti jelölés; nem naplózott |
| review-állapot | review_state | Piszkozat (draft) → Review-ra vár (pending) → Jóváhagyott (approved) / Átdolgozandó (changes_requested) |
| feladat-dashboard | dashboard | belépés utáni főoldal a személyes teendőkkel (D46) |
| archívum | archive | soft delete + felületi visszaállítás |
| esemény | event | append-only auditnyom; a rendszerüzenetek forrása |
| komment | comment | szerkesztés/törlés csak a szerzőnek, soft delete |
| allowlist | allowlist | engedélyezett e-mail címek, minden kérésnél ellenőrizve |
| Élő Atlasz | atlas | tudástérkép a saját színterekről, színtér szerint színezve + találati lista |

## Derítsd ki a repóból (ne találgass)

| Kérdés | Hol nézd |
|---|---|
| Aktuális architektúra, MVP, nyitott kockázatok | `Arch/tudasbazis-architektura-dontesi-naplo.md` (10. verzió), `README.md` |
| Döntések indoklása (D1–D49), NY-pontok | `Arch/tudasbazis-architektura-dontesi-naplo.md` |
| Munkacsomag, sorrend, kész-kritérium | `Arch/tudasbazis-munkacsomagok-h5.md` |
| Kőbe vésett fejlesztési szabályok | `Arch/CLAUDE.md` |
| Tokenek, komponens-receptek, UI-szabályok | `Prototypes/taltos-design-system.md`, `Prototypes/.claude/CLAUDE.md` |
| Login / Atlasz integrációs spec | `Prototypes/taltos-login-handoff.md`, `Prototypes/taltos-home-handoff.md` |
| Prototípus döntései, visszajelzési körök | `Prototypes/tudasbazis-prototype/NOTES.md` |
| DB-séma (B4), API-kontraktus (B5) | `Arch/tudasbazis-db-sema-b4.md`, `Arch/tudasbazis-api-kontraktus-b5.md` |
| Jogosultsági mátrix, review-szabályok részletei | a vault egységjegyzetei: `Projekt dokumentációk/` (pl. `Felhasználók/Szerepkörök.md`, `Dokumentumok/Státusz-workflow.md`); térkép: `Projekt dokumentációk/Táltos – Áttekintés.md` |
| Build/teszt parancsok | a WP0 után: gyökér `package.json`, `.github/workflows/` |

## Közös szabályok (ebből a stackből következnek)

- **TypeScript:** `strict` mód; `any` csak indoklással; a kontraktus-típusok a `packages/shared`-ből; a futásidejű validáció a Fastify JSON Schema (a TS-típus nem validáció).
- **Fastify:** minden route-nak request/response séma; a hibák Problem Details-ként a katalógus kódjaival; allowlist + CSRF hook minden mutáló route-on; a session cookie httpOnly.
- **Postgres + Drizzle:** paraméterezett lekérdezés; a tsvector/GIN/trigger/review-invariáns kézi SQL-migráció, ne erőltesd TS-sémába; soft delete ÉS tagsági (láthatósági) szűrés minden listázáson; a revízió-tábla növekedése mentésszámmal arányos — lekérdezésnél figyelj a teljes szövegű oszlopokra.
- **React:** a markdown kizárólag a közös sanitize-pipeline-on át renderelődik; nyers HTML átengedése tilos; offline piszkozat `y-indexeddb`-vel (D29).
- **Prototípus:** nincs külső könyvtár, nincs build; csak szemantikus tokenek; a `position:fixed` popover `<body>`-ba portálozva, ha a szülőn `backdrop-filter`/`transform` van; háttér-animáció `prefers-reduced-motion` alatt leáll.

## Adatbázis-hozzáférés: csak olvasás (kivétel nélkül)

- Minden elérhető adatbázison kizárólag olvasó művelet: `SELECT`, `EXPLAIN` (ANALYZE nélkül, ha író lekérdezésről van szó), katalógus-nézetek (`pg_catalog`, `information_schema`), `pg_stat_*`.
- TILOS: `INSERT/UPDATE/DELETE/MERGE/TRUNCATE`, bármilyen DDL, index létrehozása, migráció futtatása (`drizzle-kit push`/`migrate`), seed-adat betöltése, író integrációs teszt futtatása elérhető adatbázison.
- A projekt munkacsomagjai (WP1 migráció a Compose-indulásban, seed, integrációs tesztek) ettől nem változnak: az agent MEGÍRJA a migrációt, a seedet és az író tesztet, a **futtatás a tulajdonosé** (pl. `docker compose up` az ő gépén).
- Optimalizálási lehetőséget (index, séma) futtatható scriptként ajánlj, hatás- és kockázatbecsléssel.
- A guard a parancssori írási utakat blokkolja (`psql` író SQL-lel); a tesztből történő írást nem látja, ezért azt sem futtatod.

## SQL-optimalizálás (kötelező)

Ha a feladat SQL-t érint (natív vagy Drizzle-generált), optimalizáld idő ÉS tér szerint: `.claude/fleet/ref/sql-optimization.md` (az MS SQL-specifikus eszközök helyett a PostgreSQL megfelelőit használd: `EXPLAIN`, `pg_stat_statements`, GIN/GiST, részleges index).

## Felelősségek

| Terület | Elsődleges | Review |
|---|---|---|
| Prototípus (vanília JS/CSS, Canvas, állapotgépek) | `frontend-web` (új flow: `ux-ui-designer` előtte) | `code-reviewer` |
| React SPA (`apps/frontend`) | `frontend-web` | `code-reviewer` |
| Design system, tokenek, mikroszöveg | `ux-ui-designer` | `code-reviewer` (ha kód) |
| Fastify API, üzleti logika, policy, `ReviewService`, Hocuspocus (`apps/backend`) | `backend` | `code-reviewer` (+ `appsec` auth/hozzáférés/láthatóság esetén) |
| Közös típusok, API-kontraktus (`packages/shared`, OpenAPI) | `backend` (+ `architect`, ha a kontraktus nyitott) | `code-reviewer` |
| PostgreSQL-séma, Drizzle, kézi SQL-migráció, keresőindex | `database-data-engineer` | `code-reviewer` |
| OIDC-szolgáltatók, SMTP, export (pandoc) | `integration-engineer` (+ `backend`) | `code-reviewer` + `appsec` |
| Docker Compose, GitHub Actions, backup | `devops-engineer` | `code-reviewer` |
| Tesztek (unit / integráció / e2e) | `qa-automation` | – |
| Terv-dokumentumok, README, döntési napló | `technical-writer` (döntés: `architect` + tulajdonos) | – |
| Architektúra-döntés, ADR | `architect` | `challenger` (nagy/irreverzibilis) |
| Kész app/bináris viselkedésének visszafejtése (REA) | `technical-researcher` | – |

## Projekt-eszközök (MCP)

- **REA** (`rea-agents@6.7.0`, visszafejtés: JS/Electron, .NET, natív bináris, weboldal) — tulajdonosi döntés 2026-10-18. MCP-regisztráció: `claude mcp add --scope local rea -- cmd.exe /d /c npx -y rea-agents@6.7.0 mcp` (a `~/.claude.json`-ban, csak ebben a projektben; nem commitolt). Skill: `.claude/skills/reverse-engineer-anything/` (v6.7.0), engedélylistán: `technical-researcher` (`skills.json`). Csak a `technical-researcher` kapja az eszközöket: `tools:` sorában `mcp__rea__*`.
- **Fleet-frissítés után kézzel vissza kell tenni** a `mcp__rea__*`-t a `.claude/agents/technical-researcher.md` `tools:` sorába: az overlay-applier csak a `Skill` eszközt kezeli, a többi eszközt egy újragenerált agent-fájlba nem írja vissza.
- Csak olyan célpontra, amelynek elemzésére a tulajdonos jogosult (REA `DISCLAIMER.md`). Futásidejű rögzítés (böngésző-/Electron-/folyamat-capture) a célt a felhasználó jogaival futtatja: ehhez kérd a tulajdonos jóváhagyását.

## Nem releváns itt

- `azure-cloud-engineer` — csak kifejezett kérésre.
- .NET / C# / Blazor / Telerik / ForSharp / ERP / C++ / MS SQL — a flotta alapértelmezett stackje; ebben a projektben NEM érvényes.
