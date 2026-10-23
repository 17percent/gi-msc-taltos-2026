# taltos-app

A Táltos tudásbázis alkalmazása: pnpm monorepo, TypeScript end-to-end. A WP0 (skeleton, Compose,
CI) állapota: a váz fut, üzleti funkció még nincs benne. A terv és a szabályok a repó gyökerében:
[`Arch/CLAUDE.md`](../Arch/CLAUDE.md), a munkacsomagok: [H5](../Arch/tudasbazis-munkacsomagok-h5.md).

## Szerkezet

```
taltos-app/
├── apps/
│   ├── backend/     Fastify (REST /api/v1, /healthz), Hocuspocus /collab, WebSocket /ws/notifications
│   └── frontend/    Vite + React + React Router + Tailwind a Táltos tokenekkel; élesben nginx + reverse proxy
├── packages/
│   └── shared/      közös kontraktus: útvonalak, Problem Details, B5 hibakód-katalógus
├── scripts/         fejlesztői secretek létrehozása, füstpróba
├── secrets/         Compose secretek (nem kerül a repóba)
├── compose.yaml     postgres, backend, frontend, assets-volume
└── compose.override.yaml   csak fejlesztés: Mailpit
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
