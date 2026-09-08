-- Exact SQL annotation/cache change token, NOT a whole-document revision.
-- Covers document_annotations, doc_yjs_state and the old doc_yjs_updates lane.
-- Excludes survey_items/session remaps, Storage JSON sidecars and PDF bytes.
-- Does not attest that cached JSON represents current annotation rows. Future
-- publication must compare this token AND the WAL/checkpoint/PDF binding.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE survey_private.document_legacy_revisions (
  document_id uuid PRIMARY KEY,
  revision bigint NOT NULL CHECK (revision >= 0)
);
ALTER TABLE survey_private.document_legacy_revisions OWNER TO postgres;
ALTER TABLE survey_private.document_legacy_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_legacy_revisions FROM PUBLIC,anon,authenticated,service_role;
-- No lifecycle FK: deletion cascades still advance this UUID-only token;
-- neither deleting nor recreating a cache slot can reset its document token.

CREATE FUNCTION survey_private.lock_legacy_annotation_revision()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE old_doc uuid; new_doc uuid; doc uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Legacy annotation writes require READ COMMITTED' USING ERRCODE='25001';
  END IF;
  IF TG_OP <> 'INSERT' THEN old_doc := OLD.document_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_doc := NEW.document_id; END IF;
  FOR doc IN SELECT DISTINCT value FROM unnest(ARRAY[old_doc,new_doc]) value
    WHERE value IS NOT NULL ORDER BY value LOOP
    -- UPDATE/DELETE already hold a child tuple. Never wait on the WAL lock
    -- from that state; opposite-order bulk statements fail and roll back.
    IF NOT pg_try_advisory_xact_lock(hashtextextended(doc::text,0)) THEN
      RAISE EXCEPTION 'Legacy annotation write contention' USING ERRCODE='40001';
    END IF;
    IF TG_TABLE_NAME='document_annotations' THEN
      -- The existing AFTER STATEMENT timestamp trigger updates documents.
      -- Take its non-key-update lock NOWAIT before entering that late path.
      -- An already-deleted parent in our own cascade needs no new lock.
      PERFORM id FROM public.documents WHERE id=doc FOR NO KEY UPDATE NOWAIT;
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION survey_private.bump_legacy_annotation_revision()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- Transition tables contain actual changes, not attempted/conflicting
  -- inserts. One increment per affected document per statement event, never
  -- per annotation. An upsert may emit both INSERT and UPDATE events: this is
  -- an opaque monotonic token, not an edit count. All increments roll back.
  IF TG_OP='INSERT' THEN
    INSERT INTO survey_private.document_legacy_revisions AS r(document_id,revision)
      SELECT DISTINCT document_id,1 FROM new_rows WHERE document_id IS NOT NULL ORDER BY document_id
      ON CONFLICT(document_id) DO UPDATE SET revision=r.revision+1;
  ELSIF TG_OP='DELETE' THEN
    INSERT INTO survey_private.document_legacy_revisions AS r(document_id,revision)
      SELECT DISTINCT document_id,1 FROM old_rows WHERE document_id IS NOT NULL ORDER BY document_id
      ON CONFLICT(document_id) DO UPDATE SET revision=r.revision+1;
  ELSE
    INSERT INTO survey_private.document_legacy_revisions AS r(document_id,revision)
      SELECT document_id,1 FROM (
        SELECT document_id FROM old_rows UNION SELECT document_id FROM new_rows
      ) affected WHERE document_id IS NOT NULL ORDER BY document_id
      ON CONFLICT(document_id) DO UPDATE SET revision=r.revision+1;
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION survey_private.reject_legacy_annotation_truncate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION 'Use row deletion so SQL annotation revisions remain complete' USING ERRCODE='42501';
END;
$$;

ALTER FUNCTION survey_private.lock_legacy_annotation_revision() OWNER TO postgres;
ALTER FUNCTION survey_private.bump_legacy_annotation_revision() OWNER TO postgres;
ALTER FUNCTION survey_private.reject_legacy_annotation_truncate() OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.lock_legacy_annotation_revision(),
  survey_private.bump_legacy_annotation_revision(),survey_private.reject_legacy_annotation_truncate()
  FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['document_annotations','doc_yjs_state','doc_yjs_updates'] LOOP
    EXECUTE format('CREATE TRIGGER a_legacy_annotation_revision_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION survey_private.lock_legacy_annotation_revision()',relation);
    EXECUTE format('CREATE TRIGGER legacy_annotation_revision_insert AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION survey_private.bump_legacy_annotation_revision()',relation);
    EXECUTE format('CREATE TRIGGER legacy_annotation_revision_update AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION survey_private.bump_legacy_annotation_revision()',relation);
    EXECUTE format('CREATE TRIGGER legacy_annotation_revision_delete AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION survey_private.bump_legacy_annotation_revision()',relation);
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM PUBLIC,anon,authenticated,service_role',relation);
    EXECUTE format('CREATE TRIGGER legacy_annotation_revision_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION survey_private.reject_legacy_annotation_truncate()',relation);
  END LOOP;
END;
$$;

COMMENT ON TABLE survey_private.document_legacy_revisions IS
  'Private SQL annotation/cache revision. Missing row means baseline zero. Not a survey_items, Storage sidecar, PDF-generation or cache-source correctness token. No public capture API.';
COMMIT;
