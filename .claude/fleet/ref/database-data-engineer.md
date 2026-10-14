# Database / Data Engineer — reference (on demand)

## Eszközhasználat

- **Fájlműveletek**: használd a dedikált eszközöket (Read, Edit, Write, Grep, Glob) a shell helyett, ahol lehet. Szerkesztés előtt olvasd el a fájlt.
- **Bash**: adatbázis kliensek (`psql`, `sqlcmd`), migrációs CLI-k CSAK script-generálásra és listázásra (`dotnet ef migrations script/list`, `sqlpackage /Action:Script`), `date`. Adatbázisba NEM írsz: tilos az író SQL, a `dotnet ef database update`, `prisma migrate deploy/dev`, `sqlpackage /Action:Publish`, `bcp ... in`, `pg_restore` (a guard a parancssori utakat blokkolja).
- **Migrációk generálása**: az ORM által generált migrációt mindig nézd át, a generált SQL gyakran nem lock-biztos (pl. `CREATE INDEX` helyett `CREATE INDEX CONCURRENTLY` Postgresben, nagy táblán `ALTER TABLE` költsége).
- **Ellenőrzés**: a migrációt NEM futtatod: nézd át a scriptet (up és down), becsüld a hatást, és írd meg az olvasó ellenőrző lekérdezéseket (sorszám, constraint-ek, árva rekordok), amelyeket a tulajdonos a futtatás után lefuttat.
- **Párhuzamos hívások**: független tool hívásokat egyszerre indíts.
- **Web keresés / dokumentáció**: verzió-specifikus viselkedésnél (Postgres verzió, SQL Server verzió) ellenőrizd a hivatalos dokumentációt.
- **Hosszú elemzés**: nagy feladatnál (audit, teljes séma review) használhatsz al-ágenst, de a végső következtetést te foglald össze.

## Domain-specifikus ellenőrzőlisták

**Új tábla tervezésekor:**
- Van PK? Megfelelő típus? Kellenek FK-k és hozzájuk index (Postgres nem hoz létre automatikusan FK indexet)?
- `NOT NULL`, `CHECK`, `UNIQUE` megvan, ahol az üzleti szabály megköveteli?
- Időbélyegek `timestamptz` (Postgres) / `datetimeoffset` vagy `datetime2` (MS SQL)? `created_at`/`updated_at`?
- Pénz: `numeric(p,s)`/`decimal`, soha nem `float`.

**Migráció review:**
- Zár-e hosszan a tábla? Nagy táblán okoz-e teljes újraírást?
- Van-e visszaút, vagy ha nincs, az kimondva?
- Kompatibilis-e a régi és az új alkalmazás-verzióval a deploy alatt?
- Backfill batch-elve fut, nem egy óriás tranzakcióban?

**Lassú lekérdezés:**
1. Terv lekérése (`EXPLAIN (ANALYZE, BUFFERS)`).
2. Statisztikák frissessége, becslés vs. valóság eltérés.
3. Hiányzó vagy nem használt index, nem sargable feltétel, implicit típuskonverzió.
4. Lekérdezés átírása, csak ezután index, végül séma-módosítás.

**ETL / bulk:**
- Batch méret, memória, tranzakció-hossz.
- Idempotens újrafuttatás, checkpoint, hibás sorok kezelése.
- Bulk betöltés alatt index/constraint stratégia, utána `ANALYZE`/statisztika frissítés.

**Konkurencia:**
- Lock sorrend egységes (deadlock megelőzés)?
- Megfelelő izolációs szint? Szükséges-e retry serialization failure esetén?
- Kritikus szakasz: `FOR UPDATE`, `SKIP LOCKED` queue mintához, unique constraint a versenyhelyzet ellen.

> Minden itteni ellenőrzés olvasó (terv, katalógus, DMV, SELECT). Adatbázisba nem írsz, indexet nem hozol létre: javaslat. Az SQL-t mindig optimalizáld idő és tér szerint: `.claude/fleet/ref/sql-optimization.md`.

## MS SQL Server / T-SQL kiegészítő ellenőrzőlisták (a fentiek Postgres-példái mellé)

**Új tábla (T-SQL):** PK és clustered index tudatosan; FK-hoz index kézzel (SQL Server nem hozza létre); `datetime2(n)`/`datetimeoffset`, `decimal(p,s)`, `nvarchar` ahol Unicode kell; `rowversion` ha optimista konkurencia kell; sémanévvel minősített objektum; `CHECK`/`UNIQUE` a szabályra; collation egyezés a kapcsolódó táblákkal.

**Migráció review (T-SQL):** séma-módosítás (`ALTER TABLE`) Sch-M zárat kér: futó forgalom mellett blokkolhat; oszlop típusváltás/`NOT NULL` hozzáadás nagy táblán újraírhat; `sp_rename` törheti a függőségeket (nézd meg `sys.sql_expression_dependencies`); online index csak ha az edition engedi (`WITH (ONLINE = ON)`); `SET LOCK_TIMEOUT` hosszú DDL előtt; deploy-szkript idempotens (`IF NOT EXISTS`, `CREATE OR ALTER`).

**Lassú lekérdezés (T-SQL):** 1) actual execution plan + `SET STATISTICS IO, TIME ON`; 2) Query Store: terv-regresszió, parameter sniffing (`OPTION (RECOMPILE)`/`OPTIMIZE FOR` csak mérés után); 3) becslés vs tényleges sorszám, statisztika frissesség (`UPDATE STATISTICS`); 4) implicit konverzió (`varchar` vs `nvarchar`), nem sargable feltétel; 5) hiányzó/felesleges index (`sys.dm_db_missing_index_*` csak javaslat, nem utasítás).

**ETL / bulk (T-SQL):** `BULK INSERT` / `SqlBulkCopy` / batch-elt `INSERT ... SELECT`; staging tábla + validáció + upsert (külön `UPDATE`/`INSERT` egy tranzakcióban, `MERGE` csak ha biztonságos); batch (`TOP (n)` ciklus), tranzakciós napló növekedés, checkpoint a hibás sorokhoz; betöltés után statisztika frissítés.

**Konkurencia (T-SQL):** RCSI/snapshot izolációs szint az olvasók-írók blokkolása ellen; deadlock gráf extended events-ből; egységes lock-sorrend; `UPDLOCK, ROWLOCK`/`sp_getapplock` csak indokoltan; queue minta: `READPAST, UPDLOCK`.
