-- 0001_search_infrastructure.sql  (D4, D36, D49; D51)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- TODO (WP6 méretkorlát): ALTER TABLE documents ADD CONSTRAINT documents_content_len CHECK (length(content) <= N);
-- Az N a WP6 dokumentált méretkorlátjából jön (a tsvector 1 MB-os korlátja alatt); itt szándékosan nincs szám.

-- Súlyozás: cím (A) > tartalom (B) > címkék + fajta (C).
-- A generált oszlop csak a saját sorát olvashatja, ezért a címkék a denormalizált tag_text-ből jönnek (S9).
ALTER TABLE documents
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('hungarian', coalesce(title, '')),   'A') ||
    setweight(to_tsvector('hungarian', coalesce(content, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(tag_text, '') || ' ' || coalesce(kind, '')), 'C')
  ) STORED;

CREATE INDEX documents_search_vector_idx ON documents USING GIN (search_vector);
CREATE INDEX documents_title_trgm_idx    ON documents USING GIN (title gin_trgm_ops);           -- duplikátum-figyelmeztetés: csak cím (D49)
CREATE INDEX tags_normalized_trgm_idx    ON tags      USING GIN (normalized_name gin_trgm_ops); -- címke-felajánlás (D34)
-- A korábbi documents_content_trgm_idx megszűnt: a tartalom nem kerül trigram-összevetésre (D49).

-- (D51, S9) A tag_text-et a document_tags triggere tartja karban, nem az alkalmazás.
-- Utasításszintű, átmeneti táblás trigger: egy INSERT/DELETE utasítás dokumentumonként egyetlen UPDATE-et ad,
-- és a változatlan tag_text-et nem írja újra (a generált search_vector újraszámítása drága).
CREATE OR REPLACE FUNCTION document_tag_text(p_document_id uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(t.name, ' ' ORDER BY t.name), '')
    FROM document_tags dt
    JOIN tags t ON t.id = dt.tag_id
   WHERE dt.document_id = p_document_id
$$;

CREATE OR REPLACE FUNCTION document_tags_sync_after_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE documents d
     SET tag_text = x.txt
    FROM (SELECT n.document_id, document_tag_text(n.document_id) AS txt
            FROM (SELECT DISTINCT document_id FROM new_rows) n) x
   WHERE d.id = x.document_id
     AND d.tag_text IS DISTINCT FROM x.txt;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION document_tags_sync_after_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE documents d
     SET tag_text = x.txt
    FROM (SELECT o.document_id, document_tag_text(o.document_id) AS txt
            FROM (SELECT DISTINCT document_id FROM old_rows) o) x
   WHERE d.id = x.document_id
     AND d.tag_text IS DISTINCT FROM x.txt;
  RETURN NULL;
END;
$$;

CREATE TRIGGER document_tags_tag_text_ins
  AFTER INSERT ON document_tags
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION document_tags_sync_after_insert();

CREATE TRIGGER document_tags_tag_text_del
  AFTER DELETE ON document_tags
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION document_tags_sync_after_delete();
-- A címke neve nem változik (nincs átnevezés, V29), ezért a tags táblán nincs trigger.
