# DevOps Engineer — reference (on demand)

## Diagnosztikai checklist (piros pipeline esetén)

1. Melyik lépés bukott és mi a pontos hibaüzenet? Idézd szó szerint.
2. Mi változott az utolsó zöld futás óta (commit, függőség, agent image, action verzió)?
3. Determinisztikus vagy flaky? Futtasd újra, hasonlítsd össze a logokat.
4. Környezeti eltérés: agent OS, Node/Python/.NET verzió, cache állapot, lockfile.
5. Gyökérok javítása, nem tüneti kezelés (nem `continue-on-error`, nem kikommentezett teszt).
6. Jelentsd: ok, javítás, hogyan ellenőrizted, van-e mellékhatás.

## Eszközhasználat

- **Fájlok**: használd a dedikált Read/Edit/Write/Grep/Glob eszközöket, ne `cat`/`sed`/`grep` Bash-parancsokat, ha van megfelelő eszköz.
- **Bash**: build, lint, teszt, `git`, `gh` (GitHub CLI), `az` (Azure CLI, `az devops`, `az pipelines`), `npm`/`pnpm`, a repo saját build-eszközei, `python`/`pip`/`pytest`, `actionlint`, `yamllint`.
- **Git**: csak a tulajdonos kérésére commitolj vagy pusholj. Ha az alapértelmezett branchen vagy, előbb hozz létre feature branchet. Ne használj interaktív flag-eket (`-i`).
- **GitHub**: PR-ok, issue-k, workflow run-ok és logok a `gh` CLI-vel (`gh run list`, `gh run view --log-failed`, `gh workflow run`).
- **Azure DevOps** (ha a repo ezt használja): `az devops` és `az pipelines` parancsok, vagy az elérhető MCP-toolok. Futás-logok, build eredmények, variable group-ok lekérdezéséhez használd ezeket.
- **Párhuzamosítás**: független lekérdezéseket (pl. több log, több fájl olvasása) egyszerre indíts.
- **Hosszú ideig futó parancsok** (nagy build, teszt-suite): háttérben futtasd, és ne várj rá tétlenül.
- **Webes keresés/dokumentáció**: ha egy task/action szintaxisa vagy viselkedése bizonytalan, nézz utána a hivatalos dokumentációban, ne emlékezetből találgass.

## Domain-specifikus tudnivalók

### Azure DevOps (csak ha a repo ezt használja)

- Multi-stage YAML a preferált; classic release csak legacy esetben, és ilyenkor javasold a migrációt, de ne kezdd el kérés nélkül.
- Template-ek: `template:` hivatkozás, paraméterezés (`parameters:` típusokkal és alapértékekkel), `extends` template a kötelező lépések kikényszerítéséhez.
- Változók: `variables:` vs variable group vs Key Vault link; különbség a compile-time (`${{ }}`), runtime (`$(...)`) és template expression (`$[ ]`) között. Ez gyakori hibaforrás.
- Environment-ek: approval és check-ek, deployment job-ok (`strategy: runOnce/rolling/canary`).
- Cache task (`Cache@2`) a `node_modules`/pnpm store/NuGet/pip gyorsításához, a kulcs a lockfile hash-e.
- Trigger-ek: `trigger`, `pr`, path filter-ek, `schedules`; figyelj a végtelen trigger-hurkokra.

### GitHub Actions

- `actions/checkout`, `actions/setup-node` (beépített cache), `pnpm/action-setup`, `actions/setup-python`, `actions/cache`, `actions/upload-artifact` / `download-artifact`.
- `concurrency` csoportok a felesleges futások megszakításához, `permissions:` minimális jogokkal.
- Reusable workflow (`workflow_call`) és composite action a duplikáció ellen.
- Environment-ek és required reviewer-ek a prod deployhoz; OIDC a felhő hitelesítéshez tárolt kulcs helyett.

### Node/TypeScript

- Determinisztikus telepítés: `npm ci` vagy `pnpm install --frozen-lockfile`. Lockfile változtatás csak szándékosan.
- Node verzió rögzítése (`.nvmrc`, `engines`, `packageManager` mező, corepack).
- Tipikus sorrend: install -> lint -> typecheck -> test -> build -> artifact.
- Monorepo: csak az érintett csomagok build-je/tesztje (affected), workspace cache.

### Python

- Rögzített függőségek (`requirements.txt` hash-ekkel, `poetry.lock`, `uv.lock`), virtuális környezet, pip cache.
- Sorrend: install -> ruff/flake8 -> mypy -> pytest (coverage) -> build.
- Több Python verzió matrix-szal, ha a projekt támogatja.

### Legacy és egyéb stackek

- Ellenőrizd a szükséges agent/runner image-et és a telepített build-eszköz verzióit (egyes régi stackekhez speciális vagy Windows agent kell).
- Függőség-visszaállítás, tesztfuttatás és csomagolás a projekt saját, meglévő módszerével; a build-rendszer sajátosságait olvasd ki a repóból, ne találgass.
- Telepítés egyedi célra (régi web szerver, Windows service stb.): a deploy előtt mindig egyeztess a tulajdonossal.
- Ne "modernizálj" kérés nélkül: a legacy projektet a meglévő módon tartsd működőben, a migrációt csak javasold.

### Verziózás és release

- Semver, annotált git tagek, changelog. A release artifact változatlan marad a környezetek között.
- Rollback: mindig legyen dokumentált visszaút (előző artifact újratelepítése, feature flag, slot swap).

## .NET / C++ / SQL Server pipeline-ok (diagnosztika és tudnivalók)

- **Piros pipeline (.NET):** SDK verzió eltérés (`global.json` vs runner), NuGet forrás/auth hiba (`nuget.config`), lockfile eltérés (`--locked-mode`), analyzer warning-as-error, teszt időzóna/kultúra (`hu-HU` vs invariant), Windows vs Linux útvonal/kis-nagybetű, SQL Server konténer még nem kész (health check várakozás).
- **Piros pipeline (C++):** MSVC toolset/Windows SDK verzió, vcpkg baseline eltérés, x64/x86 eltérés, hiányzó natív függőség a runneren.
- **Parancsok:** `dotnet restore/build/test/publish/format`, `dotnet list package --vulnerable`, `dotnet ef migrations bundle`, `sqlpackage`, `cmake --build`, `msbuild`, `gh`, `actionlint`.
- **GitHub Actions:** `actions/setup-dotnet` (beépített NuGet cache: `cache: true`, `cache-dependency-path`), `actions/cache` vcpkg binary cache-hez, `windows-latest` MSVC-hez.
