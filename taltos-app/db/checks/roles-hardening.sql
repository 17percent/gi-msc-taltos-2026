-- A szerepkörök megerősítésének ellenőrzése (B4 S23, appsec F-7): a CI compose jobja az init-szkript UTÁN futtatja
-- superuserként, a helyi socketen: `psql -U taltos_admin -d taltos -v ON_ERROR_STOP=1 -f -`.
-- Bármely sérülésnél kivételt dob, ezért a psql nem nulla kilépési kóddal áll le. Csak olvas.
DO $$
DECLARE
  bad text;
  db text := current_database();
BEGIN
  -- Mind az öt alkalmazás-szerepkör létezik (különben az ellenőrzés üres lenne).
  IF (SELECT count(*) FROM pg_roles
       WHERE rolname IN ('taltos_owner', 'taltos_app', 'taltos_retention', 'taltos_migrator', 'taltos_backend')) <> 5 THEN
    RAISE EXCEPTION 'hiányzik legalább egy taltos_* szerepkör';
  END IF;

  -- Egyik taltos_* szerepkör (a taltos_admin superuser kivételével) nem kaphat különleges jogot.
  SELECT string_agg(rolname, ', ') INTO bad
    FROM pg_roles
   WHERE rolname LIKE 'taltos\_%' ESCAPE '\' AND rolname <> 'taltos_admin'
     AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'túl erős szerepkör(ök): %', bad;
  END IF;

  -- Az alkalmazás login-szerepköre nem hozhat létre objektumot és ideiglenes táblát az adatbázisban, sem a public sémában.
  IF has_database_privilege('taltos_backend', db, 'CREATE') OR has_database_privilege('taltos_backend', db, 'TEMP') THEN
    RAISE EXCEPTION 'a taltos_backend CREATE vagy TEMP jogot kapott az adatbázison';
  END IF;
  IF has_schema_privilege('taltos_backend', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'a taltos_backend CREATE jogot kapott a public sémán';
  END IF;
END
$$;
