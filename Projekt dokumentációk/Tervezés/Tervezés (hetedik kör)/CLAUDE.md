# CLAUDE.md — Táltos tudásbázis (10. verzió)

Agent-onboarding fájl. A teljes kontextus a tervdokumentumokban van (lásd: Dokumentumtérkép). **Ez a fájl a kényszerek desztillátuma, nem helyettesíti őket.** Ütközés esetén a döntési napló nyer; ha eltérést találsz, jelezd, ne dönts helyette.

*Forrás: az Obsidian-vault `Tervezés/Tervezés (hetedik kör)` mappája (a kódrepóban: `Projekt dokumentációk/`). A kódrepó `Arch/` mappája ennek tükre — NE ott szerkeszd: a vaultban módosíts, utána `py -3 tools/sync_arch.py`. A dokumentumokban lévő `[[…]]` wikilinkek a vault jegyzeteire mutatnak (pl. `[[Felhasználók/Szerepkörök]]` = `Projekt dokumentációk/Felhasználók/Szerepkörök.md`).*

## A projekt egy mondatban

Webes, markdown-alapú tudásbázis ~200 fős szervezetnek, elsősorban AI-eszközök (promptok, skillek, agent-definíciók) gyűjteményeként: a tartalom, a teljes revíziótörténet és minden kísérő adat **egyetlen PostgreSQL-adatbázisban** él; a tudás **zárt színterekben** van, és minden tartalmi változás **két review-er jóváhagyásával** véglegesedik. Szakdolgozati projekt, egyszemélyes fejlesztés, agent-delegált munkacsomagokkal.

## Kőbe vésett szabályok

### Tartalom és tárolás
- PostgreSQL az EGYETLEN adatréteg (D1). Git-alapú tárolás, lokális clone, pg-boss queue, GitService, reindex NINCS — ne építsd.
- Az MVP-ben csak szöveges markdown-tartalom van. Csatolmány-kezelést (HTML-riport, `.skill`, PDF, Excel) NE implementálj: az a második ütem (D42). Statikus képek csak az alkalmazás assets-útvonaláról (D15).
- Minden írás a backend API-n át megy (D2).
- A dokumentum identitása UUID, amit az alkalmazás generál, SOHA nem a DB. Átnevezéskor csak a `slug` változik.
- A revíziók megváltoztathatatlanok (append-only). Visszaállítás = új revízió, review-val (D45).
- Személyes adat (név, e-mail) csak a `users` táblában él; minden más `user_id`-vel hivatkozik (D48).

### Szerepkörök és láthatóság (D43, D44)
- Globális szerep: **Rendszeradminisztrátor** (allowlist, színterek, kezdeti Színtérgazda, fajta-lista). **Tartalmi joga nincs**: tartalmat csak színtér-tagként lát és szerkeszt.
- Színtér-szerepek: **Szerző** és **Színtérgazda**. Más szerepet (Olvasó, Jóváhagyó, Auditor, Vendég) NE vezess be.
- A színterek **zártak**: nem tag semmit nem lát a tartalomból. MINDEN olvasó lekérdezés (lista, keresés, Atlasz, kapcsolatok, értesítések, export, MCP) a „látható dokumentumok” lekérdezés-építőn megy át. Új olvasó végpont = új láthatósági teszt.
- Minden jogosultsági döntés az egyetlen `can(user, action, resource)` policy-függvényen át megy — REST-middleware-ben és a Hocuspocus `onAuthenticate`-ben is. A felület csak elrejt, nem véd.
- Nem tag hozzáférése: 403 `not_space_member` a színtér nevével és a Színtérgazdákkal, a dokumentum címe NÉLKÜL.

### Review-folyamat (D45)
- Állapotok: Piszkozat → Review-ra vár → Jóváhagyott / Átdolgozandó. A régi `draft/review/tested/published` státusz NINCS.
- Minden tartalmi változás (létrehozás, módosítás, metaadat, visszaállítás, archiválás) csak két megjelölt review-er jóváhagyásával véglegesedik. A Jóváhagyott állapotot (`approved_revision_id`, `iteration`, `deleted_at`) KIZÁRÓLAG a `ReviewService` írhatja.
- Review nélküli kivételek: komment, kedvenc, követés, tagság- és szerepkezelés, „Még aktuális” megerősítés, soha be nem küldött piszkozat eldobása, a `helyettesíti` kapcsolat cél általi törlése (V50).
- Az MCP, az export és a nyers letöltés mindig a legutóbbi Jóváhagyott revíziót adja.

### Adatbázis
- Drizzle a séma- és query-réteg (D25). A keresési infrastruktúra, az append-only triggerek, a review-invariánsok és a részleges indexek KÉZI SQL-migrációban élnek — NE erőltesd TS-sémába.
- A séma forrása: `tudasbazis-db-sema-b4.md` (10. verzió). Ettől eltérni csak a napló módosításával lehet.
- Fizikai DELETE TILOS az alkalmazáskódból; minden törlés soft delete (D20). Végleges törlés csak a második ütemes retenciós folyamat, a `taltos_retention` DB-szerepből (D48).
- Az `events` és a `document_revisions` append-only — a triggereket kikapcsolni, megkerülni TILOS.
- Minden mutáló művelet eseményt naplóz (katalógus: B4 2. szakasz). Új eseménytípus = TS-union bővítés, NEM DB-migráció.

### Közös szerkesztés (D29, D40)
- Yjs + Hocuspocus (a Fastify-jal közös Node-folyamatban, `/collab`) + CodeMirror 6 élő előnézettel. Írás csak Piszkozat és Átdolgozandó állapotban; Review-ra váró dokumentumon és lezárt színtérben `readOnly`.
- A checkpoint revíziót hoz létre, de NEM véglegesít — véglegesíteni csak a review tud.
- A lock (D7) csak a prototípusban él; az SPA-ba NE vidd át (kivéve, ha a WP3 megállási feltétele teljesül, és a napló ezt rögzíti).

### API
- Kontraktus: `tudasbazis-api-kontraktus-b5.md` (10. verzió). Új végpont vagy szemantika-változás csak a dokumentum frissítésével.
- Hibaválasz: RFC 9457 Problem Details + stabil `code` mező, a katalógus szerinti kódokkal. Ad-hoc hibaformátumot NE találj ki.
- Review-ra küldés kötelezően `baseRevisionId`-vel; eltérésnél 412 `stale_base_revision`.
- Allowlist-ellenőrzés MINDEN kérésnél (D5). Session: httpOnly cookie, 8 óra abszolút lejárat, 60 perc tétlenség; CSRF-token minden mutáló kérésen. Bearer-token flow-t NE vezess be az SPA-ban.
- OIDC: fejlesztésben is valódi Google; OIDC-mockot NE építs — tesztekben session-injektálás (D49).
- Valós idejű csatorna: `/collab` és `/ws/notifications`; polling NINCS.

### Frontend
- Vite + React SPA + React Router (D23). SSR-t, Next.js-t NE hozz be.
- shadcn/ui = bemásolt, saját tulajdonú komponenskód + Tailwind + Motion (D14). Új runtime UI-könyvtárat NE vegyél fel a napló módosítása nélkül.
- Markdown-megjelenítés: CodeMirror 6 élő előnézet a szerkesztőben, `rehype-sanitize` MINDEN renderelésnél, azonos pipeline-nal (D16, D40). Nyers HTML átengedése = betárolt XSS, TILOS. Külső kép-URL blokkolt.
- Belépés utáni főoldal a személyes feladat-dashboard (D46); az Élő Atlasz egy kattintásra, csak a saját színterekkel (D44).
- UI-munka előtt kötelező a `Prototypes/.claude/CLAUDE.md` design-system munkafolyamata.

### Secrets és adat
- OIDC client secret, DB-jelszó, SMTP-hitelesítő SOHA nem kerül image-be, repóba, commitolható `.env`-be, logba (D13). Betöltés Compose secrets-ként; kizárólag a backend konténer kapja.
- Fejlesztés kizárólag dummy adattal; éles céges tartalom a fejlesztői környezetbe és GitHubra SOHA (D11). E-mail fejlesztésben csak Mailpitbe megy.

## Munkafegyelem

- **Scope-szabály (D21): ami nincs a döntési naplóban, azt NEM építed meg.** Ha új igény vagy döntési pont merül fel, NE implementáld — jelezd a delegálónak, hogy naplópontként felvehesse.
- A munka egysége a munkacsomag (`tudasbazis-munkacsomagok-h5.md`, 10. verzió: WP0–WP23, második ütem WP30–WP35). Tartsd a sorrendet és a függőségeket; a csomag „kész”-kritériuma a definíció.
- A funkcionális elvárások forrása a munkacsomagok „kész”-kritériumai, a napló D-pontjai és a vault egységjegyzetei (pl. `Felhasználók/Szerepkörök`, `Dokumentumok/Státusz-workflow`). A jogosultsági mátrix minden cellája egy teszteset.
- Csomag-zárás: CI zöld + az érintett naplópontok visszaellenőrizve + rövid összefoglaló (mi készült, milyen döntéseket hoztál a szabad sávban, mibe ütköztél).
- Nyitott kérdést NE dönts el magad — jelenleg: **NY8** (a pilot összehasonlítási alapja), **NY9** (a pilot hozzáférése és moderálása), az MCP-olvasás naplózása (D38).

## Stack-rögzítés (nem újratárgyalható a napló nélkül)

TypeScript end-to-end · Node.js + Fastify (JSON Schema → generált OpenAPI) · PostgreSQL + Drizzle · Yjs + Hocuspocus + CodeMirror 6 (`y-codemirror.next`) · Vite + React SPA + React Router · shadcn/ui + Tailwind + Motion · rehype-sanitize · Nodemailer (SMTP; dev: Mailpit) · pandoc (export) · Docker Compose + nginx (reverse proxy a frontend-konténerben, D50) · pnpm workspaces monorepo a kódrepó `taltos-app/` mappájában: `apps/backend`, `apps/frontend`, `packages/shared`. Worker queue nincs; ütemezett feladat cron-nal (D22). Kapuk: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build` (a `taltos-app/`-ban; a CI ugyanezt futtatja).

## Dokumentumtérkép

| Fájl | Szerep |
|---|---|
| `tudasbazis-architektura-dontesi-naplo.md` | A forrás-igazság (10. verzió): D1–D50, követelmények, 20 pontos MVP, NY-pontok. Ütközésnél EZ nyer. |
| `tudasbazis-db-sema-b4.md` | Séma-referencia: Drizzle-kód, kézi SQL-migrációk, S1–S13 mikrodöntések, retenció táblánként |
| `tudasbazis-api-kontraktus-b5.md` | API-referencia: A1–A12 elvek, végpontlista szerepkörrel, hibakód-katalógus |
| `tudasbazis-munkacsomagok-h5.md` | WP0–WP23 + WP30–WP35: sorrend, függőségek, kész-kritériumok, kiesési sorrend |

## Gyors önellenőrzés minden PR előtt

1. Olvas-e dokumentumot vagy színtér-adatot? → a láthatósági lekérdezés-építőn át, láthatósági teszttel?
2. Mutál-e adatot? → a `can()` policy engedi, esemény naplózva, allowlist + CSRF middleware fedi?
3. Változtatja-e a Jóváhagyott állapotot? → kizárólag a `ReviewService`-en és egy review-kérésen át?
4. Töröl-e bármit? → soft delete, review-val (ha tartalom), esemény naplózva?
5. Renderel-e user-tartalmat? → sanitize pipeline-on át?
6. Hoz-e új függőséget, végpontot, táblát, funkciót? → van rá naplópont és kontraktus-frissítés? Ha nincs: STOP, jelezd.
7. CI zöld, a kész-kritériumot lefedő tesztekkel?
