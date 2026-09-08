-- SQL survey source token, not a whole-document/PDF-generation receipt.
-- Counts every attached session (including inactive ones), its metadata/binding,
-- and its items. Detached sessions have no document until attached. Storage
-- sidecars and other SQL tables remain separate sources. No capture API here.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE survey_private.document_survey_revisions (
  document_id uuid PRIMARY KEY,
  revision bigint NOT NULL CHECK(revision>=0)
);
ALTER TABLE survey_private.document_survey_revisions OWNER TO postgres;
ALTER TABLE survey_private.document_survey_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_survey_revisions FROM PUBLIC,anon,authenticated,service_role;
-- UUID-only permanent counter: document deletion SET NULL and session deletion
-- cascades cannot remove/reset the token. Missing counter means baseline zero.

CREATE FUNCTION survey_private.lock_document_survey_revision()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE old_id uuid; new_id uuid; docs uuid[]; doc uuid;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Survey writes require READ COMMITTED' USING ERRCODE='25001';
  END IF;
  IF TG_TABLE_NAME='survey_items' THEN
    IF TG_OP<>'INSERT' THEN old_id:=OLD.session_id; END IF;
    IF TG_OP<>'DELETE' THEN new_id:=NEW.session_id; END IF;
    -- Item UPDATE/DELETE already owns its tuple. Freeze both exact session
    -- bindings first, including NULL-document/inactive sessions. NOWAIT avoids
    -- a cycle with a rebind or a parent deletion already holding its row.
    PERFORM s.id FROM public.survey_sessions s
      WHERE s.id=ANY(ARRAY[old_id,new_id]) ORDER BY s.id FOR SHARE NOWAIT;
    SELECT array_agg(DISTINCT s.document_id ORDER BY s.document_id) INTO docs
      FROM public.survey_sessions s WHERE s.id=ANY(ARRAY[old_id,new_id]) AND s.document_id IS NOT NULL;
    -- A parent absent in its own DELETE cascade is accounted by the session
    -- OLD transition table. Missing INSERT/UPDATE parents remain FK errors.
  ELSIF TG_TABLE_NAME='survey_sessions' THEN
    IF TG_OP<>'INSERT' THEN old_id:=OLD.document_id; END IF;
    IF TG_OP<>'DELETE' THEN new_id:=NEW.document_id; END IF;
    docs:=ARRAY[old_id,new_id];
  ELSE
    RAISE EXCEPTION 'Unexpected survey revision table' USING ERRCODE='22023';
  END IF;
  FOR doc IN SELECT DISTINCT value FROM unnest(docs) value WHERE value IS NOT NULL ORDER BY value LOOP
    -- Same lock as accepted annotation WAL and future publication. Never wait
    -- on it while holding an item/session row; abort the entire write instead.
    IF NOT pg_try_advisory_xact_lock(hashtextextended(doc::text,0)) THEN
      RAISE EXCEPTION 'Survey write contention' USING ERRCODE='40001';
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION survey_private.bump_document_survey_revision()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE affected text;
BEGIN
  -- Only fixed SQL fragments; neither payload nor caller supplies SQL. Both
  -- OLD and NEW bindings count on UPDATE. Session moves cover all existing
  -- items without rewriting them; session DELETE covers its absent-parent item
  -- cascade. An empty event makes no increment. Bulk writes bump once/doc/event.
  IF TG_TABLE_NAME='survey_sessions' THEN
    IF TG_OP='INSERT' THEN affected:='SELECT document_id FROM new_rows';
    ELSIF TG_OP='DELETE' THEN affected:='SELECT document_id FROM old_rows';
    ELSE affected:='SELECT document_id FROM old_rows UNION SELECT document_id FROM new_rows'; END IF;
  ELSIF TG_TABLE_NAME='survey_items' THEN
    IF TG_OP='INSERT' THEN affected:='SELECT session_id FROM new_rows';
    ELSIF TG_OP='DELETE' THEN affected:='SELECT session_id FROM old_rows';
    ELSE affected:='SELECT session_id FROM old_rows UNION SELECT session_id FROM new_rows'; END IF;
    affected:='SELECT s.document_id FROM public.survey_sessions s JOIN ('||affected||') items ON items.session_id=s.id';
  ELSE
    RAISE EXCEPTION 'Unexpected survey revision table' USING ERRCODE='22023';
  END IF;
  EXECUTE 'INSERT INTO survey_private.document_survey_revisions AS r(document_id,revision)
    SELECT DISTINCT document_id,1 FROM ('||affected||') affected WHERE document_id IS NOT NULL ORDER BY document_id
    ON CONFLICT(document_id) DO UPDATE SET revision=r.revision+1';
  RETURN NULL;
END;
$$;

CREATE FUNCTION survey_private.reject_document_survey_truncate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION 'Use row deletion so survey revisions remain complete' USING ERRCODE='42501';
END;
$$;
ALTER FUNCTION survey_private.lock_document_survey_revision() OWNER TO postgres;
ALTER FUNCTION survey_private.bump_document_survey_revision() OWNER TO postgres;
ALTER FUNCTION survey_private.reject_document_survey_truncate() OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.lock_document_survey_revision(),survey_private.bump_document_survey_revision(),
  survey_private.reject_document_survey_truncate() FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['survey_sessions','survey_items'] LOOP
    EXECUTE format('CREATE TRIGGER a_document_survey_revision_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION survey_private.lock_document_survey_revision()',relation);
    EXECUTE format('CREATE TRIGGER document_survey_revision_insert AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION survey_private.bump_document_survey_revision()',relation);
    EXECUTE format('CREATE TRIGGER document_survey_revision_update AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION survey_private.bump_document_survey_revision()',relation);
    EXECUTE format('CREATE TRIGGER document_survey_revision_delete AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION survey_private.bump_document_survey_revision()',relation);
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM PUBLIC,anon,authenticated,service_role',relation);
    EXECUTE format('CREATE TRIGGER document_survey_revision_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION survey_private.reject_document_survey_truncate()',relation);
  END LOOP;
END;
$$;
COMMENT ON TABLE survey_private.document_survey_revisions IS
  'Private monotonic SQL token for all attached survey sessions and items; not Storage sidecar/PDF or whole-document state. Missing row means baseline zero.';
COMMIT;
