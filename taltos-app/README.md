# taltos-app

A Táltos tudásbázis alkalmazása: pnpm monorepo, TypeScript end-to-end. A WP0 (skeleton, Compose,
CI) és a WP1 (adatbázis-séma, migrációk, seed) kész; üzleti funkció még nincs benne. A terv és a szabályok a repó gyökerében:
[`Arch/CLAUDE.md`](../Arch/CLAUDE.md), a munkacsomagok: [H5](../Arch/tudasbazis-munkacsomagok-h5.md).

## Szerkezet

```
taltos-app/
├── apps/
│   ├── backend/     Fastify (REST /api/v1, /healthz), Hocuspocus /collab, WebSocket /ws/notifications;
│   │                src/db (Drizzle-séma, migrátor, seed), drizzle/ (generált és kézi SQL-migrációk)
│   └── frontend/    Vite + React + React Router + Tailwind a Táltos tokenekkel; élesben nginx + reverse proxy
├── packages/
│   └── shared/      közös kontraktus: útvonalak, Problem Details, B5 hibakód-katalógus
├── db/initdb/       Postgres-inicializálás (szerepkörök, első indításkor)
├── scripts/         fejlesztői secretek létrehozása, füstpróba
├── secrets/         Compose secretek (nem kerül a repóba)
├── compose.yaml     postgres, migrate, backend, frontend, assets-volume
└── compose.override.yaml   csak fejlesztés: Mailpit, seed
```

A csomagok egymást nem importálják, csak a `@taltos/shared`-et. Ez fejlesztésben, tesztben és a
frontend buildjében forrásból töltődik (`@taltos/source` export-feltétel), a backend éles
buildjében a lefordított `dist/`-ből.

## Előfeltétel

- Node.js 24 (LTS)
- pnpm a corepackon át, a PATH-on: `corepack enable` (a Node telepítési mappájába ír, ehhez
  rendszergazdai jog kellhet), vagy rendszergazda nélkül
  `corepack enable --install-directory <egy PATH-on lévő saját mappa> pnpm`. A gyökér szkriptjei
  (`pnpm check`, `pnpm test` …) belül is `pnpm`-et hívnak, ezért a `corepack pnpm …` előtag nem elég.
- Docker (csak a Compose-hoz)

## Fejlesztés

```bash
pnpm install
pnpm dev
```

A backend a `http://localhost:3000`, a frontend a `http://localhost:5173` címen fut; a Vite
proxyzza a `/api`, `/healthz`, `/collab` és `/ws/notifications` útvonalat a backendre.

## Kapuk (ugyanezt futtatja a CI)

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Egyben: `pnpm check`. A CI: [`.github/workflows/taltos-app-ci.yml`](../.github/workflows/taltos-app-ci.yml).

## Compose

```bash
pnpm secrets:init
docker compose up --build
node scripts/smoke.mjs
```

Az alkalmazás a `http://localhost:8080` címen érhető el; a frontend-konténer nginx-e szolgálja ki
az SPA-t, és ugyanez a reverse proxy a backend felé, WebSocket-upgrade-del (D50). A Mailpit
felülete: `http://localhost:8025`. Élesben csak az alapfájl: `docker compose -f compose.yaml up`.

A secretek a `secrets/` mappában élnek, a backend fájlból olvassa őket (D13):
[`secrets/README.md`](secrets/README.md). Alkalmazásszintű statikus képek: az `assets` volume,
a `/static/` útvonalon (D15).

## Adatbázis (WP1)

PostgreSQL 18 az egyetlen adatréteg (D1); a séma forrása a [B4](../Arch/tudasbazis-db-sema-b4.md) (10. verzió,
D51-kiegészítés). A séma Drizzle-ben él (`apps/backend/src/db/schema.ts`), a keresési infrastruktúra, az append-only
triggerek, a review-invariánsok, a részleges indexek és a szerepkör-jogok kézi SQL-migrációk (B4 3. szakasz), egyetlen
rendezett naplóban: `apps/backend/drizzle/0000_base_schema` (generált) és `0001`-`0005` (kézi).
**`drizzle-kit push` TILOS** (a `search_vector`, a kompozit FK-k és a kézi indexek a TS-sémán kívül élnek).

### Szerepkörök: ki mit hoz létre (B4 S23)

| Szerepkör          | Típus                         | Ki hozza létre                                   | Mire jó                                                                                                                                                                    |
| ------------------ | ----------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taltos_admin`     | superuser                     | a postgres-konténer (`POSTGRES_USER`)            | csak az inicializálás és a karbantartás                                                                                                                                    |
| `taltos_owner`     | NOLOGIN csoport               | `db/initdb/10-roles.sh` (a 0005 védőhálóként is) | a séma és az összes tábla tulajdonosa; `CREATE` jog az adatbázison és a `public` sémán                                                                                     |
| `taltos_app`       | NOLOGIN csoport               | init-szkript (0005 védőháló)                     | DML; DELETE csak a `favorites`, `subscriptions`, `user_space_colors`, `document_tags` táblán (D51 j); nincs TRUNCATE, nincs UPDATE az `events`/`document_revisions` táblán |
| `taltos_retention` | NOLOGIN csoport               | init-szkript (0005 védőháló)                     | a második ütemes retenció (WP33); törléshez `SET LOCAL ROLE taltos_retention` kell                                                                                         |
| `taltos_migrator`  | LOGIN, a `taltos_owner` tagja | init-szkript (`db_migrator_password`)            | csak a `migrate` szolgáltatás használja; a kapcsolat elején `SET ROLE taltos_owner`                                                                                        |
| `taltos_backend`   | LOGIN, a `taltos_app` tagja   | init-szkript (`db_app_password`)                 | a `backend` és a `seed`; DDL-jog nincs                                                                                                                                     |

A migrátornak pontosan ennyi kell: tagság a `taltos_owner`-ben (azon át `CREATE` az adatbázison: `drizzle` séma és
`pg_trgm` (megbízható bővítmény); `CREATE` a `public` sémán). `CREATEROLE` NEM kell, mert az init-szkript előre
létrehozza a csoportokat (a 0005 `IF NOT EXISTS` blokkja csak védőháló más telepítésekre). A szerepkörök jelszava az
adatbázis ELSŐ inicializálásakor íródik be; régi (WP0-s) `pgdata` volume-ot egyszer el kell dobni: `docker compose down -v`.

### Migráció és seed

```bash
pnpm secrets:init
docker compose up --build          # a migrate szolgáltatás lefut, utána indul a backend
docker compose --profile seed run --rm seed      # dummy adat (csak üres DB-re, csak fejlesztésben)
```

- A `migrate` egyszeri szolgáltatás (`node dist/db/migrate.js`, `taltos_migrator`); a `backend` csak sikeres lefutás után
  indul (`service_completed_successfully`), és `taltos_backend`-ként csatlakozik. A backend indulásához az adatbázis
  nem kell (`/healthz` nem érinti).
- Helyben (host): `DB_HOST`, `DB_PORT`, `DB_NAME` és a `DB_*_PASSWORD_FILE` változókkal `pnpm --filter @taltos/backend
db:migrate` / `db:seed`. Séma-módosítás után: `pnpm --filter @taltos/backend db:generate` (kézi SQL: `drizzle-kit
generate --custom --name …`).
- **Seed** (`pnpm --filter @taltos/backend db:seed`, `apps/backend/src/db/seed.ts`): determinisztikus (seedelt PRNG),
  NODE_ENV=production esetén megtagadja a futást, és csak üres adatbázisra fut. A `taltos_backend` (app) szerepkörrel
  fut, így ugyanazokon a DB-invariánsokon megy át, mint a későbbi `ReviewService`. Tartalom: Általános tér (mindenki
  Szerző), három csapat-tér és egy projekt-tér, a prototípus kilenc kategóriájából képzett fajták, 1-3 témacímke
  dokumentumonként, vegyes review-állapotok konzisztens kérésekkel, review-er sorokkal, revíziókkal és eseményekkel.

### Adatbázis-tesztek

`pnpm test` adatbázis nélkül is zöld: a migrációkat a Postgres saját parserén (`libpg-query`, WASM) szintaktikailag
ellenőrzi, a seed-tervet pedig egységtesztek. Az integrációs tesztek (`src/db/schema.int.test.ts`) csak a
`TEST_DATABASE_URL` megadásakor futnak: ez egy ELDOBHATÓ Postgres superuser URL-je (adatbázist és szerepkört hozhat
létre), pl. `postgres://postgres:…@localhost:5432/postgres`. Minden futás friss adatbázist kap, migrál, seedel, majd mindent
eldob. A CI a `db` jobban egy `postgres:18-alpine` service containerrel futtatja őket.
