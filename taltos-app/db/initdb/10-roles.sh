#!/bin/sh
# Egyszeri Postgres-inicializálás (B4 S23, D51). A postgres-konténer ÜRES adatkönyvtárnál futtatja,
# superuserként; meglévő adatkönyvtárnál nem fut le újra. Itt jönnek létre:
#   - a NOLOGIN csoportszerepkörök (taltos_owner, taltos_app, taltos_retention): a migrátor a kapcsolat elején
#     SET ROLE taltos_owner-t hajt végre, ezért a csoportoknak a migráció ELŐTT létezniük kell;
#   - a két jelszavas login-szerepkör: taltos_migrator (a taltos_owner tagja) és taltos_backend (a taltos_app tagja);
#   - a séma-tulajdonjog és a DB-szintű jogok: a taltos_owner hozhat létre sémát, bővítményt (a pg_trgm megbízható)
#     és objektumot.
# A jogosultságok táblánkénti része a 0005 migráció. A jelszavak a Compose secretekből (fájl) jönnek (D13),
# környezeti változón át adjuk a psql-nek (\getenv), így nem kerülnek a parancssorba.
# Alrétegben fut, hogy a `set -eu` ne szivárogjon a postgres entrypoint shelljébe, ha az sourcolja a szkriptet.
(
  set -eu
  MIGRATOR_PW="$(tr -d '\r\n' < "${DB_MIGRATOR_PASSWORD_FILE:?hiányzik a DB_MIGRATOR_PASSWORD_FILE}")"
  APP_PW="$(tr -d '\r\n' < "${DB_APP_PASSWORD_FILE:?hiányzik a DB_APP_PASSWORD_FILE}")"
  export MIGRATOR_PW APP_PW

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv migrator_pw MIGRATOR_PW
\getenv app_pw APP_PW

CREATE ROLE taltos_owner NOLOGIN;
CREATE ROLE taltos_app NOLOGIN;
CREATE ROLE taltos_retention NOLOGIN;
CREATE ROLE taltos_migrator LOGIN PASSWORD :'migrator_pw' IN ROLE taltos_owner;
CREATE ROLE taltos_backend LOGIN PASSWORD :'app_pw' IN ROLE taltos_app;

-- Csak a megnevezett szerepkörök csatlakozhatnak (a PUBLIC alapértelmezett CONNECT/TEMP joga elvéve).
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO taltos_owner, taltos_app, taltos_retention', current_database()) \gexec
-- A migráció sémát (drizzle) és bővítményt (pg_trgm) hoz létre.
SELECT format('GRANT CREATE ON DATABASE %I TO taltos_owner', current_database()) \gexec

ALTER SCHEMA public OWNER TO taltos_owner;
SQL
)
