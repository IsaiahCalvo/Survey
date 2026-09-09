-- Private durable byte/history retention, NOT generation publication.
-- No head or documents.file_path update and no new browser/service capability.
-- A future publication transaction must call this and commit its state/head CAS
-- together. The original actor is provenance, never the asset lifetime owner.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

-- A checked marker keeps retained history out of pending-only indexes. It is
-- not authority: the immutable bundle/assets are the durable source of truth.
ALTER TABLE survey_private.document_generation_uploads ADD COLUMN IF NOT EXISTS retained_at timestamptz;

CREATE TABLE IF NOT EXISTS survey_private.document_generation_bundles (
  candidate_operation_id uuid PRIMARY KEY REFERENCES survey_private.document_generation_uploads(operation_id),
  generation_id uuid NOT NULL UNIQUE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL, owner_user_id uuid NOT NULL, source_id uuid NOT NULL,
  source_generation_id uuid, source_sql_sha256 text NOT NULL,
  body_id uuid NOT NULL REFERENCES survey_private.document_generation_source_bodies(body_id),
  body_sha256 text NOT NULL, wal_head bigint NOT NULL CHECK(wal_head>=0),
  source_bytes jsonb NOT NULL, archive_operation_ids uuid[] NOT NULL,
  retained_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(source_sql_sha256 ~ '^[0-9a-f]{64}$' AND body_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK(jsonb_typeof(source_bytes)='object'),
  CHECK(cardinality(archive_operation_ids) BETWEEN 1 AND 10000)
);
CREATE INDEX IF NOT EXISTS generation_bundles_document_idx ON survey_private.document_generation_bundles(document_id);
CREATE INDEX IF NOT EXISTS generation_bundles_body_idx ON survey_private.document_generation_bundles(body_id);
CREATE TABLE IF NOT EXISTS survey_private.document_generation_assets (
  operation_id uuid PRIMARY KEY REFERENCES survey_private.document_generation_uploads(operation_id),
  candidate_operation_id uuid NOT NULL REFERENCES survey_private.document_generation_bundles(candidate_operation_id) ON DELETE CASCADE,
  document_id uuid NOT NULL, generation_id uuid NOT NULL,
  purpose text NOT NULL CHECK(purpose IN('candidate-pdf','source-object-archive')),
  source_object jsonb, path text NOT NULL UNIQUE,
  object_id uuid NOT NULL, object_version text NOT NULL,
  byte_length bigint NOT NULL CHECK(byte_length>0), content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK(object_version ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  CHECK((purpose='candidate-pdf' AND source_object IS NULL AND operation_id=candidate_operation_id)
    OR (purpose='source-object-archive' AND source_object IS NOT NULL AND jsonb_typeof(source_object)='object' AND operation_id<>candidate_operation_id))
);
CREATE INDEX IF NOT EXISTS generation_assets_bundle_idx ON survey_private.document_generation_assets(candidate_operation_id);
CREATE INDEX IF NOT EXISTS generation_assets_document_idx ON survey_private.document_generation_assets(document_id);
ALTER TABLE survey_private.document_generation_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_private.document_generation_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_generation_bundles,survey_private.document_generation_assets FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION survey_private.guard_retained_generation_rows()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.documents WHERE id=OLD.document_id) THEN RETURN OLD;END IF;
  RAISE EXCEPTION 'Retained generation assets are immutable' USING ERRCODE='23514';
END; $$;
CREATE OR REPLACE FUNCTION survey_private.reject_retained_generation_truncate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Generation retention cannot be truncated' USING ERRCODE='42501';END; $$;
DROP TRIGGER IF EXISTS retained_generation_bundle_immutable ON survey_private.document_generation_bundles;
CREATE TRIGGER retained_generation_bundle_immutable BEFORE UPDATE OR DELETE ON survey_private.document_generation_bundles
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_retained_generation_rows();
DROP TRIGGER IF EXISTS retained_generation_asset_immutable ON survey_private.document_generation_assets;
CREATE TRIGGER retained_generation_asset_immutable BEFORE UPDATE OR DELETE ON survey_private.document_generation_assets
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_retained_generation_rows();
DROP TRIGGER IF EXISTS retained_generation_bundle_no_truncate ON survey_private.document_generation_bundles;
CREATE TRIGGER retained_generation_bundle_no_truncate BEFORE TRUNCATE ON survey_private.document_generation_bundles
  FOR EACH STATEMENT EXECUTE FUNCTION survey_private.reject_retained_generation_truncate();
DROP TRIGGER IF EXISTS retained_generation_asset_no_truncate ON survey_private.document_generation_assets;
CREATE TRIGGER retained_generation_asset_no_truncate BEFORE TRUNCATE ON survey_private.document_generation_assets
  FOR EACH STATEMENT EXECUTE FUNCTION survey_private.reject_retained_generation_truncate();

CREATE OR REPLACE FUNCTION survey_private.document_generation_bundle_descriptor(p_candidate uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
  SELECT to_jsonb(b)||jsonb_build_object('version',1,'wal_head',b.wal_head::text,
    'assets',(SELECT coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('byte_length',a.byte_length::text)
       ORDER BY a.operation_id),'[]') FROM survey_private.document_generation_assets a WHERE a.candidate_operation_id=b.candidate_operation_id))
  FROM survey_private.document_generation_bundles b WHERE b.candidate_operation_id=p_candidate
$$;

CREATE OR REPLACE FUNCTION survey_private.retain_document_generation_bundle(
  p_actor uuid,p_source uuid,p_candidate_operation uuid,p_archive_operations uuid[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE existing survey_private.document_generation_bundles%ROWTYPE; frozen jsonb; fresh jsonb; proof jsonb; member jsonb;
  source_row survey_private.document_generation_sources%ROWTYPE; candidate survey_private.document_generation_uploads%ROWTYPE;
  u survey_private.document_generation_uploads%ROWTYPE; o storage.objects%ROWTYPE; operation uuid;
  archives uuid[]; operations uuid[]; matched uuid[]:='{}'; member_id uuid; matches integer; owner_id uuid;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Retention requires READ COMMITTED' USING ERRCODE='25001';END IF;
  IF p_actor IS NULL OR p_source IS NULL OR p_candidate_operation IS NULL OR p_archive_operations IS NULL
    OR array_ndims(p_archive_operations) IS DISTINCT FROM 1
    OR cardinality(p_archive_operations) NOT BETWEEN 1 AND 10000
    OR array_position(p_archive_operations,NULL) IS NOT NULL OR p_candidate_operation=ANY(p_archive_operations)
    OR (SELECT count(DISTINCT x) FROM unnest(p_archive_operations) x)<>cardinality(p_archive_operations) THEN
    RAISE EXCEPTION 'Invalid retention operation set' USING ERRCODE='22023';END IF;
  SELECT array_agg(x ORDER BY x) INTO archives FROM unnest(p_archive_operations) x;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('survey:generation-upload:'||p_candidate_operation::text,0)) THEN
    RAISE EXCEPTION 'Generation retention contention' USING ERRCODE='55P03';END IF;
  SELECT * INTO existing FROM survey_private.document_generation_bundles WHERE candidate_operation_id=p_candidate_operation FOR SHARE NOWAIT;
  IF FOUND THEN
    IF existing.actor_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Generation retention is not yours' USING ERRCODE='42501';END IF;
    IF existing.source_id IS DISTINCT FROM p_source OR existing.archive_operation_ids IS DISTINCT FROM archives THEN
      RAISE EXCEPTION 'Generation retention identity differs' USING ERRCODE='23505';END IF;
    PERFORM survey_private.assert_document_generation_upload_authority(p_actor,existing.document_id,existing.owner_user_id);
    IF (SELECT count(*) FROM survey_private.document_generation_assets WHERE candidate_operation_id=p_candidate_operation)<>cardinality(archives)+1
      OR NOT EXISTS(SELECT 1 FROM survey_private.document_generation_assets WHERE candidate_operation_id=p_candidate_operation
        AND operation_id=p_candidate_operation AND purpose='candidate-pdf')
      OR EXISTS(SELECT 1 FROM survey_private.document_generation_assets WHERE candidate_operation_id=p_candidate_operation
        AND operation_id<>p_candidate_operation AND (purpose<>'source-object-archive' OR NOT(operation_id=ANY(archives)))) THEN
      RAISE EXCEPTION 'Retained generation asset set differs' USING ERRCODE='23514';END IF;
    -- Durable receipt replay never rechecks the expiring upload/source lease or
    -- recaptures a newer annotation head. Physical assets remain checked below.
    FOR u IN SELECT upload.* FROM survey_private.document_generation_uploads upload
      JOIN survey_private.document_generation_assets asset ON asset.operation_id=upload.operation_id
      WHERE asset.candidate_operation_id=p_candidate_operation ORDER BY upload.operation_id FOR SHARE OF upload NOWAIT LOOP
      IF survey_private.touch_document_storage_path(u.path) THEN RAISE EXCEPTION 'Retained generation path is retired' USING ERRCODE='23514';END IF;
      SELECT * INTO o FROM storage.objects WHERE bucket_id='documents' AND name=u.path FOR SHARE NOWAIT;
      IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM survey_private.document_generation_assets a WHERE a.operation_id=u.operation_id
        AND a.object_id=o.id AND a.object_version=o.version AND a.byte_length::text=o.metadata->>'size'
        AND a.content_sha256=u.content_sha256 AND a.path=u.path AND a.byte_length=u.byte_length
        AND a.object_id=u.verified_object_id AND a.object_version=u.verified_object_version)
        OR NOT EXISTS(SELECT 1 FROM survey_private.document_generation_storage_references r
          WHERE r.document_id=u.document_id AND r.generation_id=u.generation_id AND r.path=u.path) THEN
        RAISE EXCEPTION 'Retained generation object differs' USING ERRCODE='23514';END IF;
    END LOOP;
    RETURN survey_private.document_generation_bundle_descriptor(p_candidate_operation);
  END IF;
  frozen:=public.read_document_generation_transform_source(p_actor,p_source);
  proof:=frozen->'source_bytes';
  SELECT * INTO source_row FROM survey_private.document_generation_sources WHERE source_id=p_source;
  owner_id:=(frozen->'payload'->'semantic'->'document'->>'user_id')::uuid;
  IF jsonb_array_length(proof->'objects')<>cardinality(archives) THEN RAISE EXCEPTION 'Every source object requires one archive' USING ERRCODE='23514';END IF;
  SELECT array_agg(x ORDER BY x) INTO operations FROM unnest(archives||p_candidate_operation) x;
  -- Existing verification holds upload before source; TRY/NOWAIT on every
  -- reverse-order edge makes contention a rollback, never a deadlock wait.
  -- The final marker changes these rows; reserve UPDATE locks now rather than
  -- waiting on a late SHARE-to-UPDATE upgrade after writing the bundle.
  PERFORM operation_id FROM survey_private.document_generation_uploads WHERE operation_id=ANY(operations) ORDER BY operation_id FOR UPDATE NOWAIT;
  IF (SELECT count(*) FROM survey_private.document_generation_uploads WHERE operation_id=ANY(operations))<>cardinality(operations) THEN
    RAISE EXCEPTION 'Retention upload is missing' USING ERRCODE='23514';END IF;
  SELECT * INTO candidate FROM survey_private.document_generation_uploads WHERE operation_id=p_candidate_operation;
  FOR u IN SELECT * FROM survey_private.document_generation_uploads WHERE operation_id=ANY(operations) ORDER BY path LOOP
    IF u.actor_user_id IS DISTINCT FROM p_actor OR u.source_id IS DISTINCT FROM p_source
      OR u.document_id IS DISTINCT FROM source_row.document_id OR u.owner_user_id IS DISTINCT FROM owner_id
      OR u.expected_source_generation_id IS DISTINCT FROM source_row.generation_id
      OR u.source_sql_sha256 IS DISTINCT FROM source_row.source_sql_sha256 OR u.state<>'verified'
      OR u.expires_at<=clock_timestamp() OR u.verified_at IS NULL OR u.verified_object_id IS NULL OR u.verified_object_version IS NULL THEN
      RAISE EXCEPTION 'Verified retention upload binding differs' USING ERRCODE='23514';END IF;
    IF u.operation_id=p_candidate_operation THEN
      IF u.purpose IS DISTINCT FROM 'candidate-pdf' OR u.archived_source_object_id IS NOT NULL THEN
        RAISE EXCEPTION 'Retention candidate must be a candidate PDF' USING ERRCODE='23514';END IF;
    ELSE
      IF u.purpose IS DISTINCT FROM 'source-object-archive' OR u.archived_source_object_id IS NULL THEN
        RAISE EXCEPTION 'Retention archive must bind an exact source object' USING ERRCODE='23514';END IF;
      SELECT count(*) INTO matches FROM jsonb_array_elements(proof->'objects') x WHERE x->>'id'=u.archived_source_object_id::text;
      SELECT x INTO member FROM jsonb_array_elements(proof->'objects') x WHERE x->>'id'=u.archived_source_object_id::text;
      IF matches<>1 OR u.archived_source_object_id=ANY(matched) OR member->>'content_sha256' IS DISTINCT FROM u.content_sha256
        OR member->>'byte_length' IS DISTINCT FROM u.byte_length::text THEN
        RAISE EXCEPTION 'Retention source archive set differs' USING ERRCODE='23514';END IF;
      matched:=array_append(matched,u.archived_source_object_id);
    END IF;
    IF survey_private.touch_document_storage_path(u.path) THEN RAISE EXCEPTION 'Retention path is retired' USING ERRCODE='23514';END IF;
    PERFORM 1 FROM survey_private.document_generation_storage_references r
      WHERE r.document_id=u.document_id AND r.generation_id=u.generation_id AND r.path=u.path FOR SHARE NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION 'Retention reference is missing' USING ERRCODE='23514';END IF;
    SELECT * INTO o FROM storage.objects WHERE bucket_id='documents' AND name=u.path FOR SHARE NOWAIT;
    IF NOT FOUND OR o.id IS DISTINCT FROM u.verified_object_id OR o.version IS DISTINCT FROM u.verified_object_version
      OR o.metadata->>'size' IS DISTINCT FROM u.byte_length::text THEN
      RAISE EXCEPTION 'Retention physical object differs' USING ERRCODE='23514';END IF;
  END LOOP;
  fresh:=survey_private.capture_document_generation_source(p_actor,source_row.document_id,source_row.generation_id);
  IF fresh->>'source_sql_sha256' IS DISTINCT FROM frozen->>'source_sql_sha256'
    OR fresh->'payload'->'semantic' IS DISTINCT FROM frozen->'payload'->'semantic' THEN
    RAISE EXCEPTION 'Generation source changed before retention' USING ERRCODE='40001';END IF;
  IF source_row.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM survey_private.document_generation_uploads
    WHERE operation_id=ANY(operations) AND expires_at<=clock_timestamp()) THEN
    RAISE EXCEPTION 'Generation retention lease expired' USING ERRCODE='23514';END IF;
  INSERT INTO survey_private.document_generation_bundles(candidate_operation_id,generation_id,document_id,actor_user_id,owner_user_id,
    source_id,source_generation_id,source_sql_sha256,body_id,body_sha256,wal_head,source_bytes,archive_operation_ids)
    VALUES(p_candidate_operation,candidate.generation_id,source_row.document_id,p_actor,owner_id,p_source,source_row.generation_id,
      source_row.source_sql_sha256,source_row.body_id,frozen->>'body_sha256',source_row.wal_head,proof,archives);
  FOR u IN SELECT * FROM survey_private.document_generation_uploads WHERE operation_id=ANY(operations) ORDER BY operation_id LOOP
    member:=NULL;
    IF u.operation_id<>p_candidate_operation THEN SELECT x INTO member FROM jsonb_array_elements(proof->'objects') x WHERE x->>'id'=u.archived_source_object_id::text;END IF;
    INSERT INTO survey_private.document_generation_assets(operation_id,candidate_operation_id,document_id,generation_id,purpose,
      source_object,path,object_id,object_version,byte_length,content_sha256)
      VALUES(u.operation_id,p_candidate_operation,u.document_id,u.generation_id,u.purpose,member,u.path,u.verified_object_id,u.verified_object_version,u.byte_length,u.content_sha256);
  END LOOP;
  UPDATE survey_private.document_generation_uploads upload SET retained_at=bundle.retained_at
    FROM survey_private.document_generation_assets asset JOIN survey_private.document_generation_bundles bundle
      ON bundle.candidate_operation_id=asset.candidate_operation_id
    WHERE upload.operation_id=asset.operation_id AND bundle.candidate_operation_id=p_candidate_operation;
  -- Inserts/triggers may take time: a lease must still be live at the final
  -- receipt, not only at the preceding capture/validation step.
  IF source_row.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM survey_private.document_generation_uploads
    WHERE operation_id=ANY(operations) AND expires_at<=clock_timestamp()) THEN
    RAISE EXCEPTION 'Generation retention lease expired' USING ERRCODE='23514';END IF;
  RETURN survey_private.document_generation_bundle_descriptor(p_candidate_operation);
END; $$;

CREATE OR REPLACE FUNCTION survey_private.document_generation_active_pdf(p_document uuid,p_generation uuid,p_owner uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE asset survey_private.document_generation_assets%ROWTYPE; physical storage.objects%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Active asset read requires READ COMMITTED' USING ERRCODE='25001';END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_document::text,0)) THEN RAISE EXCEPTION 'Active asset contention' USING ERRCODE='40001';END IF;
  PERFORM id FROM public.documents WHERE id=p_document AND user_id=p_owner FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active asset owner differs' USING ERRCODE='23514';END IF;
  SELECT a.* INTO asset FROM survey_private.document_generation_assets a
    JOIN survey_private.document_generation_bundles b ON b.candidate_operation_id=a.candidate_operation_id
    WHERE b.document_id=p_document AND b.generation_id=p_generation AND b.owner_user_id=p_owner
      AND a.operation_id=b.candidate_operation_id AND a.purpose='candidate-pdf' FOR SHARE OF a,b NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Durable active PDF binding is unavailable' USING ERRCODE='23514';END IF;
  IF survey_private.touch_document_storage_path(asset.path) THEN RAISE EXCEPTION 'Active asset path is retired' USING ERRCODE='23514';END IF;
  PERFORM 1 FROM survey_private.document_generation_storage_references r
    WHERE r.document_id=p_document AND r.generation_id=p_generation AND r.path=asset.path FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active asset reference is missing' USING ERRCODE='23514';END IF;
  SELECT * INTO physical FROM storage.objects WHERE bucket_id='documents' AND name=asset.path FOR SHARE NOWAIT;
  IF NOT FOUND OR physical.id IS DISTINCT FROM asset.object_id OR physical.version IS DISTINCT FROM asset.object_version
    OR physical.metadata->>'size' IS DISTINCT FROM asset.byte_length::text THEN
    RAISE EXCEPTION 'Active asset metadata differs' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('bucket_id','documents','path',asset.path,'id',asset.object_id,'version',asset.object_version,
    'byte_length',asset.byte_length::text,'content_sha256',asset.content_sha256);
END; $$;

-- Private owner-only durability guards also cover accidental future definers.
CREATE OR REPLACE FUNCTION survey_private.guard_retained_generation_upload()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.retained_at IS NOT NULL THEN RAISE EXCEPTION 'Retention marker requires an existing complete bundle' USING ERRCODE='23514';END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND NEW.retained_at IS DISTINCT FROM OLD.retained_at THEN
    IF OLD.retained_at IS NULL AND NEW.retained_at IS NOT NULL
      AND (to_jsonb(NEW)-'retained_at')=(to_jsonb(OLD)-'retained_at')
      AND EXISTS(SELECT 1 FROM survey_private.document_generation_assets a JOIN survey_private.document_generation_bundles b
        ON b.candidate_operation_id=a.candidate_operation_id WHERE a.operation_id=OLD.operation_id
        AND b.retained_at=NEW.retained_at AND a.document_id=OLD.document_id AND a.generation_id=OLD.generation_id
        AND a.path=OLD.path AND a.object_id=OLD.verified_object_id AND a.object_version=OLD.verified_object_version
        AND a.content_sha256=OLD.content_sha256 AND a.byte_length=OLD.byte_length
        AND b.actor_user_id=OLD.actor_user_id AND b.owner_user_id=OLD.owner_user_id AND b.source_id=OLD.source_id
        AND b.source_sql_sha256=OLD.source_sql_sha256 AND b.source_generation_id IS NOT DISTINCT FROM OLD.expected_source_generation_id
        AND OLD.state='verified'
        AND (SELECT count(*) FROM survey_private.document_generation_assets member WHERE member.candidate_operation_id=b.candidate_operation_id)=cardinality(b.archive_operation_ids)+1
        AND EXISTS(SELECT 1 FROM survey_private.document_generation_assets candidate WHERE candidate.operation_id=b.candidate_operation_id AND candidate.purpose='candidate-pdf')) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Retention marker is immutable and requires its exact bundle' USING ERRCODE='23514';
  END IF;
  IF OLD.retained_at IS NOT NULL THEN
    IF TG_OP='UPDATE' AND NEW.state='canceled' AND (to_jsonb(NEW)-'state')=(to_jsonb(OLD)-'state')
      AND NOT EXISTS(SELECT 1 FROM public.documents WHERE id=OLD.document_id) THEN RETURN NEW;END IF;
    RAISE EXCEPTION 'Retained generation upload cannot change' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM survey_private.document_generation_assets WHERE operation_id=OLD.operation_id)
    AND EXISTS(SELECT 1 FROM public.documents WHERE id=OLD.document_id) THEN
    RAISE EXCEPTION 'Retained generation upload cannot change' USING ERRCODE='23514';END IF;
  IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS a_retained_generation_upload_guard ON survey_private.document_generation_uploads;
CREATE TRIGGER a_retained_generation_upload_guard BEFORE INSERT OR UPDATE OR DELETE ON survey_private.document_generation_uploads
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_retained_generation_upload();
CREATE OR REPLACE FUNCTION survey_private.guard_retained_generation_reference()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM survey_private.document_generation_assets WHERE document_id=OLD.document_id AND generation_id=OLD.generation_id AND path=OLD.path)
    AND EXISTS(SELECT 1 FROM public.documents WHERE id=OLD.document_id) THEN
    RAISE EXCEPTION 'Retained generation reference cannot be released' USING ERRCODE='23514';END IF;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS a_retained_generation_reference_guard ON survey_private.document_generation_storage_references;
CREATE TRIGGER a_retained_generation_reference_guard BEFORE DELETE ON survey_private.document_generation_storage_references
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_retained_generation_reference();
CREATE OR REPLACE FUNCTION survey_private.guard_retained_generation_body()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM survey_private.document_generation_bundles WHERE body_id=OLD.body_id) THEN
    RAISE EXCEPTION 'Retained generation source body is immutable' USING ERRCODE='23514';END IF;
  IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS retained_generation_body_guard ON survey_private.document_generation_source_bodies;
CREATE TRIGGER retained_generation_body_guard BEFORE UPDATE OR DELETE ON survey_private.document_generation_source_bodies
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_retained_generation_body();
CREATE OR REPLACE FUNCTION survey_private.collect_released_generation_body()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  DELETE FROM survey_private.document_generation_source_bodies b WHERE b.body_id=OLD.body_id
    AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_sources s WHERE s.body_id=b.body_id)
    AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_bundles retained WHERE retained.body_id=b.body_id);
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS retained_generation_body_cleanup ON survey_private.document_generation_bundles;
CREATE TRIGGER retained_generation_body_cleanup AFTER DELETE ON survey_private.document_generation_bundles
  FOR EACH ROW EXECUTE FUNCTION survey_private.collect_released_generation_body();

-- Retained path checks remain valid even if a privileged future caller tries to
-- remove a legacy pin out of order. All retirement/physical unlink lanes reuse it.
CREATE OR REPLACE FUNCTION survey_private.document_storage_path_is_referenced(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.documents WHERE file_path=p_path)
    OR EXISTS(SELECT 1 FROM survey_private.document_generation_storage_references r
      WHERE r.path_hash=survey_private.document_storage_path_hash(p_path) AND r.path=p_path)
    OR EXISTS(SELECT 1 FROM survey_private.document_generation_assets WHERE path=p_path)
$$;

-- Fail on unknown predecessors instead of silently missing a cleanup lane.
DO $wire$
DECLARE signature text; definition text; before_text text; after_text text; marker text:='-- durable generation retention fence';
BEGIN
  FOR signature IN SELECT unnest(ARRAY[
    'public.begin_document_generation_upload(uuid,uuid,text,bigint)',
    'public.begin_document_generation_upload_v2(uuid,uuid,text,text,bigint)',
    'public.begin_document_generation_source_archive(uuid,uuid,uuid)',
    'public.expire_document_generation_uploads(integer)']) LOOP
    definition:=pg_get_functiondef(to_regprocedure(signature));
    -- Recognize both this indexed version and the earlier local anti-join draft
    -- so replay cannot leave old predicates scanning all retained history.
    IF position('retained_at IS NULL' IN definition)>0 THEN CONTINUE;END IF;
    before_text:='state<>''canceled''';
    definition:=replace(definition,' AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_assets retained WHERE retained.operation_id=document_generation_uploads.operation_id)','');
    after_text:='state<>''canceled'' AND retained_at IS NULL';
    IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Unknown staging admission or expiry prerequisite' USING ERRCODE='55000';END IF;
    EXECUTE replace(replace(definition,before_text,after_text),'BEGIN',E'BEGIN\n  '||marker);
  END LOOP;
  signature:='survey_private.cancel_document_generation_upload(uuid)';definition:=pg_get_functiondef(to_regprocedure(signature));
  IF position(marker IN definition)=0 THEN
    before_text:='  UPDATE survey_private.document_generation_uploads SET state=''canceled''';
    IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Unknown generation cancel prerequisite' USING ERRCODE='55000';END IF;
    EXECUTE replace(definition,before_text,E'  '||marker||E'\n  IF EXISTS(SELECT 1 FROM survey_private.document_generation_assets WHERE operation_id=p_operation) AND EXISTS(SELECT 1 FROM public.documents WHERE id=u.document_id) THEN RAISE EXCEPTION ''Retained generation upload cannot be canceled'' USING ERRCODE=''23514'';END IF;\n'||before_text);
  END IF;
  signature:='survey_private.release_document_generation_source(uuid,text)';definition:=pg_get_functiondef(to_regprocedure(signature));
  IF position(marker IN definition)=0 THEN
    before_text:='AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_sources s WHERE s.body_id=b.body_id)';
    IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Unknown source release prerequisite' USING ERRCODE='55000';END IF;
    EXECUTE replace(definition,before_text,before_text||E'\n    AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_bundles retained WHERE retained.body_id=b.body_id) '||marker||E'\n');
  END IF;
END; $wire$;

-- Populate the checked marker on a replay of this local prerequisite as well.
-- The trigger permits exactly this null-to-bound transition, nothing else.
UPDATE survey_private.document_generation_uploads upload SET retained_at=bundle.retained_at
  FROM survey_private.document_generation_assets asset JOIN survey_private.document_generation_bundles bundle
    ON bundle.candidate_operation_id=asset.candidate_operation_id
  WHERE upload.operation_id=asset.operation_id AND upload.retained_at IS NULL;
DROP INDEX IF EXISTS survey_private.document_generation_upload_actor_pending_idx;
CREATE INDEX document_generation_upload_actor_pending_idx
  ON survey_private.document_generation_uploads(actor_user_id,expires_at) WHERE state<>'canceled' AND retained_at IS NULL;
DROP INDEX IF EXISTS survey_private.document_generation_upload_document_idx;
CREATE INDEX document_generation_upload_document_idx
  ON survey_private.document_generation_uploads(document_id,state,operation_id);
DROP INDEX IF EXISTS survey_private.document_generation_upload_document_pending_idx;
CREATE INDEX document_generation_upload_document_pending_idx
  ON survey_private.document_generation_uploads(document_id,operation_id) WHERE state<>'canceled' AND retained_at IS NULL;
DROP INDEX IF EXISTS survey_private.document_generation_upload_expiry_idx;
CREATE INDEX document_generation_upload_expiry_idx
  ON survey_private.document_generation_uploads(expires_at,operation_id) WHERE state<>'canceled' AND retained_at IS NULL;
-- The separate document/state index above still includes retained uploads for
-- actual parent deletion, without scanning every actor's upload history.

-- No migration-time acceptance of a transient staged object as a durable head.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM survey_private.annotation_generation_heads h WHERE NOT EXISTS(
    SELECT 1 FROM survey_private.document_generation_bundles b JOIN survey_private.document_generation_assets a ON a.operation_id=b.candidate_operation_id
    WHERE b.document_id=h.document_id AND b.generation_id=h.generation_id AND a.purpose='candidate-pdf')) THEN
    RAISE EXCEPTION 'Existing generation head lacks durable retention' USING ERRCODE='23514';END IF;
END; $$;

DO $active$
DECLARE definition text; before_text text; after_text text; marker text:='-- durable active PDF binding';
BEGIN
  definition:=pg_get_functiondef('survey_private.capture_document_generation_source(uuid,uuid,uuid)'::regprocedure);
  IF position(marker IN definition)=0 THEN
    IF position('active_generation uuid;' IN definition)=0 THEN RAISE EXCEPTION 'Unknown active source declaration' USING ERRCODE='55000';END IF;
    definition:=replace(definition,'active_generation uuid;','active_generation uuid; active_pdf jsonb;');
    before_text:=$old$    SELECT u.path INTO source_path FROM survey_private.document_generation_uploads u
      WHERE u.document_id=p_document AND u.generation_id=active_generation AND u.owner_user_id=d.user_id AND u.state='verified'
        AND EXISTS(SELECT 1 FROM survey_private.document_generation_storage_references r WHERE r.document_id=u.document_id AND r.generation_id=u.generation_id AND r.path=u.path);
    IF NOT FOUND THEN RAISE EXCEPTION 'Active generation PDF binding is unavailable' USING ERRCODE='23514';END IF;$old$;
    after_text:=$new$    -- durable active PDF binding
    active_pdf:=survey_private.document_generation_active_pdf(p_document,active_generation,d.user_id);
    source_path:=active_pdf->>'path';$new$;
    IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Unknown active source lookup' USING ERRCODE='55000';END IF;
    definition:=replace(definition,before_text,after_text);
    before_text:=$old$  IF active_generation IS NOT NULL AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_uploads u WHERE u.document_id=p_document AND u.generation_id=active_generation
    AND u.verified_object_id::text=source_object->>'id' AND u.verified_object_version=source_object->>'version' AND u.byte_length::text=source_object->>'byte_length') THEN$old$;
    after_text:=$new$  IF active_generation IS NOT NULL AND (active_pdf-'content_sha256') IS DISTINCT FROM source_object THEN$new$;
    IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Unknown active source object check' USING ERRCODE='55000';END IF;
    EXECUTE replace(definition,before_text,after_text);
  END IF;
  definition:=pg_get_functiondef('survey_private.check_document_generation_source_bytes(uuid,uuid)'::regprocedure);
  IF position(marker IN definition)=0 THEN
    before_text:=$old$ ELSIF NOT EXISTS(SELECT 1 FROM survey_private.document_generation_uploads u
   JOIN survey_private.document_generation_storage_references ref ON ref.document_id=u.document_id AND ref.generation_id=u.generation_id AND ref.path=u.path
   WHERE u.document_id=r.document_id AND u.generation_id=r.generation_id AND u.owner_user_id=d.user_id AND u.state='verified' AND u.path=source_path
    AND u.verified_object_id::text=s->'source_object'->>'id' AND u.verified_object_version=s->'source_object'->>'version') THEN$old$;
    after_text:=$new$ -- durable active PDF binding
 ELSIF (survey_private.document_generation_active_pdf(r.document_id,r.generation_id,d.user_id)-'content_sha256') IS DISTINCT FROM s->'source_object' THEN$new$;
    IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Unknown active source byte binding' USING ERRCODE='55000';END IF;
    EXECUTE replace(definition,before_text,after_text);
  END IF;
  definition:=pg_get_functiondef('public.record_document_generation_source_bytes(uuid,uuid,uuid,jsonb)'::regprocedure);
  IF position(marker IN definition)=0 THEN
    before_text:=$old$ IF r->>'generation_id' IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM survey_private.document_generation_uploads u WHERE u.document_id=(r->>'document_id')::uuid
   AND u.generation_id=(r->>'generation_id')::uuid AND u.state='verified'
   AND u.path=p_objects->0->>'path' AND u.verified_object_id::text=p_objects->0->>'id'
   AND u.verified_object_version=p_objects->0->>'version' AND u.content_sha256=p_objects->0->>'content_sha256'
 ) THEN$old$;
    -- Deliberately use the current permanent owner, not the old upload actor.
    after_text:=$new$ -- durable active PDF binding
 IF r->>'generation_id' IS NOT NULL AND survey_private.document_generation_active_pdf((r->>'document_id')::uuid,(r->>'generation_id')::uuid,
   (SELECT user_id FROM public.documents WHERE id=(r->>'document_id')::uuid)) IS DISTINCT FROM (p_objects->0)-'kind' THEN$new$;
    IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Unknown active byte digest check' USING ERRCODE='55000';END IF;
    EXECUTE replace(definition,before_text,after_text);
  END IF;
END; $active$;

ALTER TABLE survey_private.document_generation_bundles OWNER TO postgres;
ALTER TABLE survey_private.document_generation_assets OWNER TO postgres;
DO $private$
DECLARE signature text;
BEGIN
  FOR signature IN SELECT unnest(ARRAY[
    'survey_private.guard_retained_generation_rows()','survey_private.reject_retained_generation_truncate()',
    'survey_private.document_generation_bundle_descriptor(uuid)','survey_private.retain_document_generation_bundle(uuid,uuid,uuid,uuid[])',
    'survey_private.document_generation_active_pdf(uuid,uuid,uuid)','survey_private.guard_retained_generation_upload()',
    'survey_private.guard_retained_generation_reference()','survey_private.guard_retained_generation_body()',
    'survey_private.collect_released_generation_body()']) LOOP
    EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO postgres';
    EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC,anon,authenticated,service_role';
  END LOOP;
END; $private$;
COMMIT;
