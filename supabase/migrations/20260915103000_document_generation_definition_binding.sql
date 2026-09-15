-- A checked replacement is tied to the exact accepted shared definition that
-- was current when its bytes were prepared.  V5 is additive: V3/V4 receipts
-- and callers keep their old behavior.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE survey_private.document_generation_replacement_definition_bindings (
  candidate_operation_id uuid PRIMARY KEY
    REFERENCES survey_private.document_generation_replacement_requests(candidate_operation_id)
    ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  definition_revision bigint NOT NULL
    CHECK (definition_revision BETWEEN 1 AND 9007199254740991),
  definition_digest text NOT NULL CHECK (definition_digest ~ '^[0-9a-f]{64}$'),
  UNIQUE (candidate_operation_id, document_id, definition_revision, definition_digest),
  FOREIGN KEY (document_id, definition_revision, definition_digest)
    REFERENCES survey_private.document_definition_revisions(
      document_id, definition_revision, definition_digest)
);
ALTER TABLE survey_private.document_generation_replacement_definition_bindings OWNER TO postgres;
ALTER TABLE survey_private.document_generation_replacement_definition_bindings ENABLE ROW LEVEL SECURITY;
CREATE INDEX document_generation_replacement_definition_binding_document_idx
  ON survey_private.document_generation_replacement_definition_bindings(
    document_id, definition_revision, definition_digest);
REVOKE ALL ON survey_private.document_generation_replacement_definition_bindings
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION survey_private.guard_document_generation_definition_binding()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (NOT EXISTS (
    SELECT 1 FROM survey_private.document_generation_replacement_requests r
    WHERE r.candidate_operation_id = OLD.candidate_operation_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.documents d WHERE d.id = OLD.document_id
  )) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Replacement definition binding is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER document_generation_definition_binding_immutable
  BEFORE UPDATE OR DELETE ON survey_private.document_generation_replacement_definition_bindings
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_document_generation_definition_binding();
CREATE TRIGGER document_generation_definition_binding_no_truncate
  BEFORE TRUNCATE ON survey_private.document_generation_replacement_definition_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION survey_private.reject_document_generation_replacement_truncate();

CREATE TABLE survey_private.document_generation_publication_definition_bindings (
  operation_id uuid PRIMARY KEY REFERENCES survey_private.document_generation_publications(operation_id)
    ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  generation_id uuid NOT NULL,
  definition_revision bigint NOT NULL CHECK (definition_revision BETWEEN 1 AND 9007199254740991),
  definition_digest text NOT NULL CHECK (definition_digest ~ '^[0-9a-f]{64}$'),
  UNIQUE(document_id, generation_id),
  FOREIGN KEY(document_id, definition_revision, definition_digest)
    REFERENCES survey_private.document_definition_revisions(document_id, definition_revision, definition_digest)
);
ALTER TABLE survey_private.document_generation_publication_definition_bindings OWNER TO postgres;
ALTER TABLE survey_private.document_generation_publication_definition_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_generation_publication_definition_bindings
  FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION survey_private.guard_document_generation_publication_definition_binding()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' AND (NOT EXISTS(
    SELECT 1 FROM survey_private.document_generation_publications p WHERE p.operation_id=OLD.operation_id
  ) OR NOT EXISTS(
    SELECT 1 FROM public.documents d WHERE d.id=OLD.document_id
  )) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Published definition binding is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER document_generation_publication_definition_binding_immutable
  BEFORE UPDATE OR DELETE ON survey_private.document_generation_publication_definition_bindings
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_document_generation_publication_definition_binding();
CREATE TRIGGER document_generation_publication_definition_binding_no_truncate
  BEFORE TRUNCATE ON survey_private.document_generation_publication_definition_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION survey_private.reject_document_generation_replacement_truncate();

CREATE OR REPLACE FUNCTION survey_private.assert_document_generation_definition_head_v5(
  p_document uuid, p_revision bigint, p_digest text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE head survey_private.document_definition_revision_heads%ROWTYPE;
BEGIN
  IF p_document IS NULL OR p_revision NOT BETWEEN 1 AND 9007199254740991
     OR p_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid document definition binding' USING ERRCODE='22023';
  END IF;
  SELECT * INTO head FROM survey_private.document_definition_revision_heads
    WHERE document_id=p_document FOR SHARE NOWAIT;
  IF NOT FOUND OR head.current_revision IS DISTINCT FROM p_revision
     OR head.current_digest IS DISTINCT FROM p_digest THEN
    RAISE EXCEPTION 'Document definition head is stale' USING ERRCODE='40001';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION survey_private.lock_document_generation_definition_v5(p_document uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_document::text,0)) THEN
    RAISE EXCEPTION 'Replacement document contention' USING ERRCODE='40001';
  END IF;
  PERFORM 1 FROM public.documents d WHERE d.id=p_document FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Replacement document differs' USING ERRCODE='23514'; END IF;
END $$;

CREATE OR REPLACE FUNCTION survey_private.read_document_generation_replacement_v5(
  p_actor uuid,p_document uuid,p_source uuid,p_candidate uuid,p_archives uuid[],p_expected_generation uuid,
  p_expected_wal_head bigint,p_operation jsonb,p_expected_definition_revision bigint,
  p_expected_definition_digest text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE base jsonb; binding survey_private.document_generation_replacement_definition_bindings%ROWTYPE;
  published_binding survey_private.document_generation_publication_definition_bindings%ROWTYPE;
BEGIN
  -- V4 performs the actor/source/archive authorization even for a completed
  -- operation.  Never return a persisted binding before that proof.
  base:=survey_private.read_document_generation_replacement_v4(p_actor,p_source,p_candidate,p_archives,
    p_expected_generation,p_expected_wal_head,p_operation);
  SELECT * INTO binding FROM survey_private.document_generation_replacement_definition_bindings
    WHERE candidate_operation_id=p_candidate FOR SHARE NOWAIT;
  IF FOUND THEN
    IF binding.definition_revision IS DISTINCT FROM p_expected_definition_revision
       OR binding.definition_digest IS DISTINCT FROM p_expected_definition_digest
       OR binding.document_id IS DISTINCT FROM p_document
       OR binding.document_id IS DISTINCT FROM (base->>'document_id')::uuid THEN
      RAISE EXCEPTION 'V5 replacement binding differs' USING ERRCODE='23505';
    END IF;
    IF base->'publication' IS NOT NULL AND base->'publication'<>'null'::jsonb THEN
      SELECT * INTO published_binding FROM survey_private.document_generation_publication_definition_bindings
        WHERE operation_id=p_candidate FOR SHARE NOWAIT;
      IF NOT FOUND OR published_binding.document_id IS DISTINCT FROM binding.document_id
         OR published_binding.generation_id IS DISTINCT FROM (base->'publication'->>'generation_id')::uuid
         OR published_binding.definition_revision IS DISTINCT FROM binding.definition_revision
         OR published_binding.definition_digest IS DISTINCT FROM binding.definition_digest THEN
        RAISE EXCEPTION 'Published V5 definition binding differs' USING ERRCODE='23514';
      END IF;
      base:=base || jsonb_build_object('publication',((base->'publication')-'version')
        ||jsonb_build_object('version',5,'definition_revision',published_binding.definition_revision::text,
          'definition_digest',published_binding.definition_digest));
    END IF;
    RETURN (base-'version') || jsonb_build_object('version',5,
      'definition_revision',binding.definition_revision::text,
      'definition_digest',binding.definition_digest);
  END IF;
  IF base->>'state' <> 'missing' THEN
    RAISE EXCEPTION 'V5 definition binding is missing' USING ERRCODE='23514';
  END IF;
  -- Cold replay discovery happens before source capture.  The handler binds
  -- the supplied document id to its signed request; authorize that exact pair
  -- and preflight its head before the worker receives any PDF bytes.
  IF p_expected_definition_revision NOT BETWEEN 1 AND 9007199254740991
     OR p_expected_definition_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid document definition binding' USING ERRCODE='22023';
  END IF;
  PERFORM survey_private.assert_document_generation_upload_authority(p_actor,p_document);
  PERFORM survey_private.lock_document_generation_definition_v5(p_document);
  PERFORM survey_private.assert_document_generation_definition_head_v5(p_document,
    p_expected_definition_revision,p_expected_definition_digest);
  RETURN (base-'version') || jsonb_build_object('version',5,
    'definition_revision',p_expected_definition_revision::text,
    'definition_digest',p_expected_definition_digest);
END $$;

CREATE OR REPLACE FUNCTION survey_private.prepare_document_generation_replacement_v5(
  p_actor uuid,p_source uuid,p_candidate uuid,p_archives uuid[],p_expected_generation uuid,
  p_expected_wal_head bigint,p_operation jsonb,p_plan jsonb,p_expected_definition_revision bigint,
  p_expected_definition_digest text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE base jsonb; source_document uuid; binding survey_private.document_generation_replacement_definition_bindings%ROWTYPE;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('survey:generation-upload:'||p_candidate::text,0)) THEN
    RAISE EXCEPTION 'Replacement operation contention' USING ERRCODE='55P03';
  END IF;
  SELECT s.document_id INTO source_document FROM survey_private.document_generation_sources s
    WHERE s.source_id=p_source FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Replacement source differs' USING ERRCODE='23514';
  END IF;
  SELECT * INTO binding FROM survey_private.document_generation_replacement_definition_bindings
    WHERE candidate_operation_id=p_candidate FOR SHARE NOWAIT;
  IF FOUND THEN
    IF binding.document_id IS DISTINCT FROM source_document
       OR binding.definition_revision IS DISTINCT FROM p_expected_definition_revision
       OR binding.definition_digest IS DISTINCT FROM p_expected_definition_digest THEN
      RAISE EXCEPTION 'V5 replacement retry identity differs' USING ERRCODE='23505';
    END IF;
    base:=survey_private.prepare_document_generation_replacement_v4(p_actor,p_source,p_candidate,p_archives,
      p_expected_generation,p_expected_wal_head,p_operation,p_plan);
    IF base->>'state' IS DISTINCT FROM 'prepared' THEN
      RAISE EXCEPTION 'V5 preparation cannot bind an existing publication' USING ERRCODE='23514';
    END IF;
  ELSE
    base:=survey_private.prepare_document_generation_replacement_v4(p_actor,p_source,p_candidate,p_archives,
      p_expected_generation,p_expected_wal_head,p_operation,p_plan);
    -- V4 has verified the source/assets.  Lock document then definition head
    -- before making this new prepared request durable; a stale head rolls the
    -- entire function transaction back, including the V4 request rows.
    PERFORM survey_private.lock_document_generation_definition_v5(source_document);
    PERFORM survey_private.assert_document_generation_definition_head_v5(source_document,
      p_expected_definition_revision,p_expected_definition_digest);
    INSERT INTO survey_private.document_generation_replacement_definition_bindings(
      candidate_operation_id,document_id,definition_revision,definition_digest)
    VALUES(p_candidate,source_document,p_expected_definition_revision,p_expected_definition_digest);
  END IF;
  IF base->'publication' IS NOT NULL AND base->'publication'<>'null'::jsonb THEN
    base:=base || jsonb_build_object('publication',((base->'publication')-'version')
      ||jsonb_build_object('version',5,'definition_revision',p_expected_definition_revision::text,
        'definition_digest',p_expected_definition_digest));
  END IF;
  RETURN (base-'version') || jsonb_build_object('version',5,
    'definition_revision',p_expected_definition_revision::text,
    'definition_digest',p_expected_definition_digest);
END $$;

CREATE OR REPLACE FUNCTION survey_private.publish_document_generation_v5(
  p_actor uuid,p_source uuid,p_candidate uuid,p_archives uuid[],p_plan jsonb,
  p_expected_definition_revision bigint,p_expected_definition_digest text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE binding survey_private.document_generation_replacement_definition_bindings%ROWTYPE;
  published_binding survey_private.document_generation_publication_definition_bindings%ROWTYPE;
  request_row survey_private.document_generation_replacement_requests%ROWTYPE; base jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('survey:generation-upload:'||p_candidate::text,0)) THEN
    RAISE EXCEPTION 'Replacement operation contention' USING ERRCODE='55P03';
  END IF;
  SELECT * INTO binding FROM survey_private.document_generation_replacement_definition_bindings
    WHERE candidate_operation_id=p_candidate FOR SHARE NOWAIT;
  IF NOT FOUND OR binding.definition_revision IS DISTINCT FROM p_expected_definition_revision
     OR binding.definition_digest IS DISTINCT FROM p_expected_definition_digest THEN
    RAISE EXCEPTION 'V5 publication binding differs' USING ERRCODE='23505';
  END IF;
  SELECT * INTO request_row FROM survey_private.document_generation_replacement_requests
    WHERE candidate_operation_id=p_candidate FOR SHARE NOWAIT;
  IF NOT FOUND OR request_row.document_id IS DISTINCT FROM binding.document_id THEN
    RAISE EXCEPTION 'V5 publication request differs' USING ERRCODE='23514';
  END IF;
  -- V4 passes a V3-normalized plan down to its request row, so that stored
  -- digest cannot be compared to the caller's V4 plan bytes here.  Delegate
  -- the complete V4 plan proof to publish_document_generation_v4 below.
  -- A completed operation is an authorized exact replay, not a new write.
  -- Read V4 first so its actor/source/archive/plan proof still applies even
  -- when the definition head has since moved.
  base:=survey_private.read_document_generation_replacement_v4(p_actor,p_source,p_candidate,p_archives,
    request_row.expected_generation_id,request_row.expected_wal_head,p_plan->'operation');
  IF base->>'state'='published' THEN
    -- V4's publisher validates the complete supplied plan on an immutable
    -- replay without writing a new generation.
    base:=survey_private.publish_document_generation_v4(p_actor,p_source,p_candidate,p_archives,p_plan);
    SELECT * INTO published_binding FROM survey_private.document_generation_publication_definition_bindings
      WHERE operation_id=p_candidate FOR SHARE NOWAIT;
    IF NOT FOUND OR published_binding.document_id IS DISTINCT FROM binding.document_id
       OR published_binding.generation_id IS DISTINCT FROM (base->>'generation_id')::uuid
       OR published_binding.definition_revision IS DISTINCT FROM binding.definition_revision
       OR published_binding.definition_digest IS DISTINCT FROM binding.definition_digest THEN
      RAISE EXCEPTION 'Published V5 definition binding differs' USING ERRCODE='23514';
    END IF;
    RETURN (base-'version') || jsonb_build_object('version',5,
      'definition_revision',published_binding.definition_revision::text,
      'definition_digest',published_binding.definition_digest);
  END IF;
  PERFORM survey_private.lock_document_generation_definition_v5(binding.document_id);
  -- The document lock is always first; this head share lock then makes an
  -- in-flight definition apply either finish first (stale) or wait for this
  -- short publish transaction.
  PERFORM survey_private.assert_document_generation_definition_head_v5(binding.document_id,
    binding.definition_revision,binding.definition_digest);
  base:=survey_private.publish_document_generation_v4(p_actor,p_source,p_candidate,p_archives,p_plan);
  IF (base->>'document_id')::uuid IS DISTINCT FROM binding.document_id
     OR nullif(base->>'generation_id','') IS NULL
     OR (base->>'source_id')::uuid IS DISTINCT FROM p_source
     OR (base->>'operation_id')::uuid IS DISTINCT FROM p_candidate THEN
    RAISE EXCEPTION 'Published V5 replacement receipt differs' USING ERRCODE='23514';
  END IF;
  INSERT INTO survey_private.document_generation_publication_definition_bindings(
    operation_id,document_id,generation_id,definition_revision,definition_digest)
  VALUES(p_candidate,(base->>'document_id')::uuid,(base->>'generation_id')::uuid,
    binding.definition_revision,binding.definition_digest);
  RETURN (base-'version') || jsonb_build_object('version',5,
    'definition_revision',binding.definition_revision::text,
    'definition_digest',binding.definition_digest);
END $$;

DO $$ DECLARE signature text; BEGIN FOREACH signature IN ARRAY ARRAY[
  'survey_private.guard_document_generation_definition_binding()',
  'survey_private.guard_document_generation_publication_definition_binding()',
  'survey_private.assert_document_generation_definition_head_v5(uuid,bigint,text)',
  'survey_private.lock_document_generation_definition_v5(uuid)',
  'survey_private.read_document_generation_replacement_v5(uuid,uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,bigint,text)',
  'survey_private.prepare_document_generation_replacement_v5(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb,bigint,text)',
  'survey_private.publish_document_generation_v5(uuid,uuid,uuid,uuid[],jsonb,bigint,text)'
] LOOP
  EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC,anon,authenticated,service_role';
END LOOP; END $$;
COMMIT;
