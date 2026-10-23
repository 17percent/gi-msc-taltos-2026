-- 0006_function_search_path.sql  (S26, D51; appsec F-9)
-- A 0001-0003 trigger- és guard-függvényei rögzített search_path-szal futnak: a hívó munkamenet search_path-ja
-- (pl. egy előre létrehozott, azonos nevű objektum egy másik sémában) nem módosíthatja, mely táblát és operátort oldják fel.
-- A 0001-0005 már alkalmazva van a dev/CI előzményekben, ezért külön migráció (ALTER FUNCTION), nem szerkesztés.
-- A függvények csak a public séma tábláit és a pg_catalog beépítettjeit használják; az átmeneti táblákat (new_rows, old_rows) névvel oldja fel a trigger.
ALTER FUNCTION document_tag_text(uuid)                SET search_path = pg_catalog, public;
ALTER FUNCTION document_tags_sync_after_insert()      SET search_path = pg_catalog, public;
ALTER FUNCTION document_tags_sync_after_delete()      SET search_path = pg_catalog, public;
ALTER FUNCTION forbid_mutation()                      SET search_path = pg_catalog, public;
ALTER FUNCTION forbid_truncate()                      SET search_path = pg_catalog, public;
ALTER FUNCTION reviewer_not_initiator()               SET search_path = pg_catalog, public;
ALTER FUNCTION crr_at_most_two()                      SET search_path = pg_catalog, public;
ALTER FUNCTION cr_exactly_two_at_submission()         SET search_path = pg_catalog, public;
ALTER FUNCTION change_requests_guard()                SET search_path = pg_catalog, public;
ALTER FUNCTION documents_frozen_guard()               SET search_path = pg_catalog, public;
