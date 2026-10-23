-- 0002_append_only.sql  (S6; D51)
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  -- Egyetlen kivétel: a retenciós folyamat (D48) DELETE-je. A retenciós login-szerepkör a tranzakcióban
  -- kifejezetten SET LOCAL ROLE taltos_retention-t hajt végre; így a törlés tudatos, nevesített lépés.
  IF TG_OP = 'DELETE' AND current_user = 'taltos_retention' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% append-only: % nem megengedett', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_append_only
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER document_revisions_append_only
  BEFORE UPDATE OR DELETE ON document_revisions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- (D51) A TRUNCATE a sor-triggert megkerüli: külön utasításszintű védelem.
CREATE OR REPLACE FUNCTION forbid_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% append-only: TRUNCATE nem megengedett', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_no_truncate
  BEFORE TRUNCATE ON events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

CREATE TRIGGER document_revisions_no_truncate
  BEFORE TRUNCATE ON document_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();
-- Következmény a tesztekre: teszt-adatbázis újraépítéssel (template DB / séma-eldobás) takarítható, TRUNCATE-tel nem.
