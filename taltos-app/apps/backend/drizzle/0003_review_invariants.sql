-- 0003_review_invariants.sql  (D45, S7; D51)

-- (D51, S22) Revízió-hivatkozások: kompozit FK, így a hivatkozott revízió mindig ugyanahhoz a dokumentumhoz tartozik.
-- A cél a document_revisions UNIQUE (document_id, id) megszorítása (a TS-sémában). MATCH SIMPLE: NULL hivatkozásnál nincs ellenőrzés.
ALTER TABLE documents
  ADD CONSTRAINT documents_approved_revision_fk
  FOREIGN KEY (id, approved_revision_id) REFERENCES document_revisions (document_id, id) ON DELETE RESTRICT;

ALTER TABLE change_requests
  ADD CONSTRAINT change_requests_base_revision_fk
  FOREIGN KEY (document_id, base_revision_id) REFERENCES document_revisions (document_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT change_requests_proposed_revision_fk
  FOREIGN KEY (document_id, proposed_revision_id) REFERENCES document_revisions (document_id, id) ON DELETE RESTRICT;

-- Dokumentumonként legfeljebb egy függő kérés
CREATE UNIQUE INDEX change_requests_one_pending_uq
  ON change_requests (document_id) WHERE state = 'pending';

-- (D51) Dokumentumonként az iteration egyedi (a jóváhagyott kérések sorszáma)
CREATE UNIQUE INDEX change_requests_iteration_uq
  ON change_requests (document_id, iteration) WHERE iteration IS NOT NULL;

-- (D51 b) Egy aktív review-er-hely személyenként; a korábban lezárt (cserélt, kiesett) személy újra megjelölhető
CREATE UNIQUE INDEX crr_active_reviewer_uq
  ON change_request_reviewers (change_request_id, reviewer_id) WHERE ended_at IS NULL;

-- A review-er nem lehet az indítványozó
CREATE OR REPLACE FUNCTION reviewer_not_initiator() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM change_requests
             WHERE id = NEW.change_request_id AND initiator_id = NEW.reviewer_id) THEN
    RAISE EXCEPTION 'reviewer_is_initiator';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crr_not_initiator
  BEFORE INSERT ON change_request_reviewers
  FOR EACH ROW EXECUTE FUNCTION reviewer_not_initiator();

-- (D51 b) Legfeljebb két aktív review-er kérésenként — a tranzakció végén ellenőrizve
-- (csere: az új sor beszúrása és a régi lezárása egy tranzakcióban, átmenetileg három aktív sorral).
CREATE OR REPLACE FUNCTION crr_at_most_two() RETURNS trigger AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM change_request_reviewers
   WHERE change_request_id = NEW.change_request_id AND ended_at IS NULL;
  IF n > 2 THEN RAISE EXCEPTION 'too_many_reviewers'; END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER crr_at_most_two
  AFTER INSERT OR UPDATE ON change_request_reviewers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION crr_at_most_two();

-- (D51 b) Beküldéskor pontosan két aktív review-er: a kérés létrehozó tranzakciója végén ellenőrizve.
-- Később (kiesés után) lehet egy aktív hely: a kérés addig nem dönthető el (lásd change_requests_guard).
CREATE OR REPLACE FUNCTION cr_exactly_two_at_submission() RETURNS trigger AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM change_request_reviewers
   WHERE change_request_id = NEW.id AND ended_at IS NULL;
  IF n <> 2 THEN RAISE EXCEPTION 'exactly_two_reviewers_required'; END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER cr_exactly_two_at_submission
  AFTER INSERT ON change_requests
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION cr_exactly_two_at_submission();

-- (D51) Lezárt kérés megváltoztathatatlan; a függő kérés azonosító mezői is. Jóváhagyáshoz két aktív jóváhagyó döntés kell.
-- Egyetlen kivétel: elutasított/visszavont kérés javasolt revíziójának lecsatolása (retenció, D51 h).
CREATE OR REPLACE FUNCTION change_requests_guard() RETURNS trigger AS $$
DECLARE n int;
BEGIN
  IF OLD.state <> 'pending' THEN
    IF OLD.state IN ('rejected', 'withdrawn')
       AND NEW.proposed_revision_id IS NULL
       AND (to_jsonb(NEW) - 'proposed_revision_id') = (to_jsonb(OLD) - 'proposed_revision_id') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'change_request_closed';
  END IF;

  IF NEW.document_id <> OLD.document_id
     OR NEW.kind <> OLD.kind
     OR NEW.initiator_id <> OLD.initiator_id
     OR NEW.created_at <> OLD.created_at
     OR NEW.base_revision_id IS DISTINCT FROM OLD.base_revision_id
     OR NEW.proposed_revision_id IS DISTINCT FROM OLD.proposed_revision_id
     OR NEW.proposed_review_due_at IS DISTINCT FROM OLD.proposed_review_due_at THEN
    RAISE EXCEPTION 'change_request_immutable_fields';
  END IF;

  IF NEW.state = 'approved' THEN
    SELECT count(*) INTO n
      FROM change_request_reviewers
     WHERE change_request_id = NEW.id AND ended_at IS NULL AND decision = 'approved';
    IF n <> 2 THEN RAISE EXCEPTION 'two_approvals_required'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER change_requests_guard
  BEFORE UPDATE ON change_requests
  FOR EACH ROW EXECUTE FUNCTION change_requests_guard();

-- (D51) Review-ra várás alatt az élő tartalom és metaadat befagyott (D45). Az állapotváltással járó
-- írás (jóváhagyás, visszavonás, restore-alkalmazás) nem érintett: a WHEN csak a pending → pending frissítésre igaz.
CREATE OR REPLACE FUNCTION documents_frozen_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.tag_text IS DISTINCT FROM OLD.tag_text THEN
    RAISE EXCEPTION 'document_frozen';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_frozen_while_pending
  BEFORE UPDATE ON documents
  FOR EACH ROW
  WHEN (OLD.review_state = 'pending' AND NEW.review_state = 'pending')
  EXECUTE FUNCTION documents_frozen_guard();
