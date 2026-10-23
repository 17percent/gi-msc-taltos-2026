-- 0005_roles_and_grants.sql  (S23, D51; a retenciós jogok a WP33-ban finomítandók)
-- Három NOLOGIN csoportszerepkör: taltos_owner (séma-tulajdonos), taltos_app (alkalmazás), taltos_retention (2. ütem).
-- A jelszavas LOGIN-szerepköröket (taltos_migrator, taltos_backend) NEM ez a migráció hozza létre: azokat a Postgres
-- init-szkriptje (db/initdb) a Compose secretekből (D13). Az init-szkript a csoportszerepköröket is előre létrehozza, mert
-- a migrátor a kapcsolat elején SET ROLE taltos_owner-t hajt végre; az alábbi blokk csak védőháló más telepítésekre
-- (hiányzó szerepkör létrehozásához CREATEROLE jog kell). A migrátor tagja a taltos_owner-nek, a backend a taltos_app-nak.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taltos_owner')     THEN CREATE ROLE taltos_owner NOLOGIN;     END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taltos_app')       THEN CREATE ROLE taltos_app NOLOGIN;       END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taltos_retention') THEN CREATE ROLE taltos_retention NOLOGIN; END IF;
END $$;

-- A táblák tulajdonosa a taltos_owner (az app nem tulajdonos: nem tilthatja le a triggereket, nem TRUNCATE-elhet).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO taltos_owner', r.tablename);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO taltos_app, taltos_retention;

-- Alkalmazás: olvasás, beszúrás, módosítás; fizikai törlés csak a D51 (j) táblákon; TRUNCATE sehol.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO taltos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO taltos_app, taltos_retention;
GRANT DELETE ON favorites, subscriptions, user_space_colors, document_tags TO taltos_app;
-- Az append-only táblákon az UPDATE-jog is elvéve (a trigger mellett második védvonal).
REVOKE UPDATE ON events, document_revisions FROM taltos_app;

-- Későbbi táblákra ugyanez az alap (új append-only táblánál a jogot kézzel kell szűkíteni).
ALTER DEFAULT PRIVILEGES FOR ROLE taltos_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO taltos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE taltos_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO taltos_app, taltos_retention;

-- Retenciós folyamat (használat: 2. ütem, WP33). A login-szerepkör tagja, és tranzakciónként SET LOCAL ROLE taltos_retention-t hajt végre
-- (a forbid_mutation current_user-t ellenőriz). Pszeudonimizálás: csak a személyes oszlopok.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO taltos_retention;
GRANT INSERT ON events TO taltos_retention;                      -- retention_purge, user_pseudonymized
GRANT DELETE ON events, document_revisions, documents, document_collab_state, change_requests,
                change_request_reviewers, comments, notifications, document_links,
                favorites, subscriptions, document_tags, sessions TO taltos_retention;
GRANT UPDATE (tag_text) ON documents TO taltos_retention;                    -- a document_tags törlés triggere frissíti (B4 S9)
GRANT UPDATE (proposed_revision_id) ON change_requests TO taltos_retention;   -- javasolt revízió lecsatolása (D51 h)
GRANT UPDATE (oidc_sub, email, display_name, avatar_url, pseudonymized_at) ON users TO taltos_retention;
