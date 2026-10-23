-- 0004_partial_indexes.sql  (D51 indexterv)
-- Aktív tagság gyors ellenőrzése (policy-függvény, láthatósági szűrés — D43, D44); a role a covering miatt kerül bele,
-- így a can() szerep-ellenőrzése index-only. Ez váltja ki a korábbi space_members_user_idx-et.
CREATE INDEX space_members_active_idx
  ON space_members (user_id, space_id) INCLUDE (role) WHERE removed_at IS NULL;

-- Az Általános színtérből pontosan egy van (D43)
CREATE UNIQUE INDEX spaces_one_general_uq ON spaces (type) WHERE type = 'general';

-- Egy felhasználónak egy színtérbe egyszerre egy függő felvételi kérése lehet (D44)
CREATE UNIQUE INDEX membership_requests_one_pending_uq
  ON membership_requests (space_id, user_id) WHERE state = 'pending';
