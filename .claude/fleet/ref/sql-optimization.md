# SQL-optimalizálás: idő ÉS tér (kötelező, ha a feladat SQL-t érint)

Forrás: `fleet/stack/sql-optimization.md` (a build másolja ide: `.claude/fleet/ref/sql-optimization.md`). Minden agentre érvényes, amelynek a munkája SQL-t érint: kézzel írt T-SQL, tárolt eljárás, EF Core / Dapper / ADO.NET által generált vagy küldött SQL, tesztadat- és ETL-lekérdezés.

## Alapszabályok

1. **Adatbázisba nem írsz.** Minden elérhető adatbázison (prod, test, dev, LocalDB) csak olvasó művelet: `SELECT`, becsült/tényleges terv `SELECT`-en, katalógus-nézetek és DMV-k, Query Store. Nincs `INSERT/UPDATE/DELETE/MERGE/TRUNCATE`, nincs DDL, nincs index-, statisztika- vagy objektum-módosítás, nincs migráció- vagy `database update` futtatás, nincs író teszt. (Claude Code-ban a guard-hook a parancssori utakat blokkolja; GitHub Copilotban nincs hook, ott csak ez a szabály véd. Az írást végző kódot/tesztet mindkét esetben te sem futtatod.)
2. **Index, séma, statisztika, tömörítés = JAVASLAT, nem végrehajtás.** Futtatható scriptként add át (lásd "Javaslat-formátum"), hatás- és kockázatbecsléssel. A futtatás a tulajdonosé.
3. **Az érintett SQL-t mindig optimalizáld**, akár natív SQL, akár ORM-szinten: írd át a kódban (ez repo-változtatás, nem DB-írás), és mérd olvasó módon. Ami csak séma-/index-változtatással érhető el, azt javasold.
4. **Mérés nélkül nincs állítás.** Csak olvasó módszerrel mérj (lásd lent); ami nem mérhető, az hipotézis, jelöld úgy.
5. **Általános, de profi**: a szabályok bármely adatmennyiségre jók; a sorrend mindig: kevesebb sor, kevesebb oszlop, kevesebb körút, kevesebb munka soronként.

## Olvasó mérés (írás nélkül)

- Becsült terv: `SET SHOWPLAN_XML ON` (nem hajt végre semmit) - DML-nél (UPDATE/DELETE/INSERT) KIZÁRÓLAG ez.
- `SELECT`-nél tényleges terv + `SET STATISTICS IO, TIME ON`: logikai olvasás, CPU, eltelt idő. Nagy/éles táblán óvatosan: előbb becsült terv, korlátozott tartomány (`TOP`, szűkítő feltétel).
- Query Store (`sys.query_store_*`), `sys.dm_exec_query_stats`, `sys.dm_db_index_usage_stats`, `sys.dm_db_missing_index_*` (csak jelzés, nem utasítás), `sys.dm_db_partition_stats`, `sp_spaceused`, `sys.dm_exec_query_memory_grants`: mind olvasó.
- ORM-nél előbb a ténylegesen generált SQL: EF Core `ToQueryString()` / `LogTo` / `EnableSensitiveDataLogging` csak fejlesztői logban (titok/PII nélkül), Dapper-nél a küldött szöveg és a paraméter-típusok.

## IDŐ: kevesebb munka

**Lekérdezés alak**
- Sargable feltétel: nincs függvény/kifejezés az indexelt oszlopon (`WHERE YEAR(d)=...` helyett tartomány), nincs vezető-joker `LIKE '%x'` ott, ahol index kell.
- Implicit konverzió tiltása: a paraméter típusa egyezzen az oszlopéval (`varchar` vs `nvarchar`, `int` vs `bigint`, `datetime2` pontosság). EF-ben `IsUnicode(false)`/`HasColumnType`, Dapper-ben `DbType.AnsiString`/`DbString`, ADO.NET-ben explicit `SqlDbType` és méret.
- Halmazalapú gondolkodás: nincs kurzor/ciklus/skalár UDF soronként, ahol egy halmazművelet megoldja; `EXISTS` a `COUNT(*) > 0` helyett; `NOT EXISTS` a `NOT IN` helyett (NULL-csapda); `UNION ALL` a felesleges `UNION` (rendezés/dedup) helyett; `DISTINCT` ne foltozzon rossz join-t.
- Join-fan-out kerülése (ismeretlen kardinalitású join duplikál), korrelált algselect helyett join/`APPLY` ha olcsóbb; a CTE SQL Serverben nem materializálódik: ha többször használt és drága, ideiglenes tábla (statisztikával) lehet jobb.
- Lapozás: mély oldalakra keyset (seek) lapozás az `OFFSET/FETCH` helyett; mindig determinisztikus `ORDER BY`; a rendezést index támogassa.
- Paraméter-szippantás (sniffing): stabil terv a cél; `OPTION (RECOMPILE)` / `OPTIMIZE FOR` csak mért indokkal, javaslatként.
- Rövid tranzakció, nincs felesleges zárolási hint; olvasásra snapshot/RCSI-tudatosság (javaslat), `NOLOCK` NEM megoldás (téves adat).

**Körutak és adatmozgatás (ORM/kliens)**
- N+1 kiirtása: `Include`/projekció/kötegelt lekérdezés; több `Include` kartéziánus-robbanásnál `AsSplitQuery` (mérve), egyébként egy lekérdezés.
- Olvasásra `AsNoTracking` (vagy `AsNoTrackingWithIdentityResolution`); csak a kellő oszlopokra `Select(...)` DTO-ba (nem teljes entitás).
- Szűrés és aggregálás az adatbázisban, nem a kliensben (`ToList()` a `Where` előtt = teljes tábla a memóriába); `Any()` a `Count()>0` helyett; `Contains` hatalmas listával helyett TVP / ideiglenes join-halmaz.
- Forró útvonalra `EF.CompileAsyncQuery`; nagy eredményhalmaz streamelve (`AsAsyncEnumerable`, Dapper `buffered: false`), nem teljes listába.
- Tömeges művelet kód szinten: `SqlBulkCopy`/TVP/`ExecuteUpdate`/`ExecuteDelete` (set-based) soronkénti `SaveChanges` helyett - megírhatod a kódot, de nem futtatod éles/elérhető adatbázison.
- Ritkán változó referenciaadat: memória-cache érvénytelenítéssel, ne minden kérésnél DB-hívás.
- Ha a LINQ rossz SQL-t generál: `FromSql` / Dapper / tárolt eljárás, indoklással és tesztekkel.

## TÉR: kevesebb lemez, memória, hálózat

- **Legkisebb elég adattípus**: `int`/`smallint`/`tinyint` a `bigint` helyett, ahol a tartomány engedi; `date` a `datetime2` helyett, ha idő nem kell; `decimal(p,s)` pontos precízióval; `varchar` ha nincs Unicode igény; rögzített hosszú kódokra `char(n)`; `nvarchar(max)`/`varbinary(max)` csak valódi LOB-ra. A sorszélesség közvetlenül I/O, memória és index-méret.
- **Csak a kellő oszlopok és sorok**: `SELECT *` tilos (hálózat + memória-grant + tempdb); nagy oszlopot (LOB) ne vigyen rendezés/hash/`DISTINCT`.
- **Memória-grant és spill**: felülbecsült/alulbecsült grant, sort/hash spill a tervben: oka általában rossz becslés (elavult statisztika, implicit konverzió, szélesség); javítsd az okot, ne a grantot.
- **Index-javaslat (soha létrehozás)**: keskeny, stabil, növekvő, egyedi clustered kulcs; a kulcs legyen szelektív sorrendben (egyenlőség előbb, tartomány utána); `INCLUDE` csak ha a covering valódi olvasást spórol; filtered index ritka részhalmazra; ne duplikálj/fedj át meglévő indexet (ellenőrizd olvasó DMV-kből); minden index írási költség + tárhely.
- **Tömörítés / oszloptár / particionálás / archiválás**: javaslatként, becsléssel (`sp_estimate_data_compression_savings` olvasó): ROW/PAGE tömörítés, columnstore elemző/nagy-scan terhelésre, adatmegőrzési és archiválási politika, partíció-eldobás törlés helyett.
- **Hálózat/payload**: lapozás, projekció, nincs bináris adat felesleges mozgatása, kötegelt hívások a beszédes helyett.
- **Karbantartás**: statisztika-frissítés, index-újraépítés/-szervezés, adatbázis-szintű beállítások (RCSI, Query Store, compatibility level) mind JAVASLAT.

## Javaslat-formátum (amit az eredményben adsz)

Minden optimalizált vagy javasolt elemre:
1. **Mi** (lekérdezés/kódhely, `fájl:sor`), **miért lassú/nagy** (terv-csomópont, becslés vs valóság, olvasás, szélesség).
2. **Átírás** (kódban, már elkészítve) - előtte/utána: logikai olvasás, CPU/idő, sorszám, sorszélesség, ha olvasó módon mérhető; különben "becsült/hipotézis".
3. **Javaslat (NEM futtatva)**: futtatható script (index, statisztika, tömörítés, séma) + várt haszon, **írási költség, becsült méret**, kockázat (zárolás, ablak), rollback, ellenőrző `SELECT`.
4. **Nem mért / nyitott**: mit nem tudtál olvasó módon ellenőrizni.

Ne optimalizálj kizárólag intuícióból, és ne bonyolíts: ha a lekérdezés már az olvasási minimumon van, mondd ki, hogy nincs mit javítani.
