-- Checked current-generation metadata/checkpoint read. No download URL,
-- Storage policy change, publication grant, or private source/history response.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.read_document_generation_open(
 p_document_id uuid,p_generation_id uuid DEFAULT NULL,p_include_snapshot boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET bytea_output='hex' SET lock_timeout='2s' AS $$
DECLARE actor uuid:=auth.uid(); d public.documents%ROWTYPE; generation uuid; frontier bigint; account_id uuid; closing boolean;
 publication survey_private.document_generation_publications%ROWTYPE;
 asset survey_private.document_generation_assets%ROWTYPE; bundle record; physical record; guard record;
 baseline_seq bigint; raw_length bigint; annotations jsonb; checkpoint_hash text;
 selected_snapshot boolean; checkpoint_seq bigint; checkpoint_encoding integer;
BEGIN
 IF p_include_snapshot IS NULL THEN RAISE EXCEPTION 'Snapshot mode is required' USING ERRCODE='22023';END IF;
 IF actor IS NULL OR p_document_id IS NULL OR public.user_can_access_document(p_document_id,'viewer') IS NOT TRUE THEN
  RAISE EXCEPTION 'Document content is not permitted' USING ERRCODE='42501';END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Generation open requires READ COMMITTED' USING ERRCODE='25001';END IF;
 -- Lock before discovery: NULL means current adopted generation, never a
 -- fallback to unversioned PDF/state. Pure readers share this publication lock.
 IF NOT pg_try_advisory_xact_lock_shared(hashtextextended(p_document_id::text,0)) THEN
  RAISE EXCEPTION 'Generation open contention' USING ERRCODE='40001';END IF;
 SELECT * INTO d FROM public.documents WHERE id=p_document_id FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Document content is not permitted' USING ERRCODE='42501';END IF;
 SELECT generation_id INTO generation FROM survey_private.annotation_generation_heads WHERE document_id=p_document_id;
 -- Scope establishes the exact existing direct/inherited viewer lock set and
 -- rechecks access. Discovering the private head above grants no authority.
 frontier:=survey_private.annotation_generation_scope(p_document_id,coalesce(p_generation_id,generation),false);
 IF generation IS NULL THEN RAISE EXCEPTION 'Document has no published generation' USING ERRCODE='SG001';END IF;
 FOR account_id IN SELECT DISTINCT x FROM unnest(ARRAY[actor,d.user_id]) x ORDER BY x LOOP
  SELECT g.closing INTO closing FROM survey_private.account_write_guards g WHERE g.user_id=account_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN
   -- A never-writing viewer may need one guard row. Existing healthy guards
   -- are read/locked only: no INSERT attempt or hot-row UPDATE on later opens.
   PERFORM survey_private.assert_account_open(account_id);
  ELSIF closing THEN RAISE EXCEPTION 'ACCOUNT_CLOSING' USING ERRCODE='23514';END IF;
 END LOOP;
 SELECT * INTO publication FROM survey_private.document_generation_publications
  WHERE document_id=p_document_id AND generation_id=generation FOR SHARE NOWAIT;
 IF NOT FOUND OR publication.owner_user_id IS DISTINCT FROM d.user_id THEN
  RAISE EXCEPTION 'Published generation receipt is unavailable' USING ERRCODE='23514';END IF;
 SELECT b.document_id,b.generation_id,b.owner_user_id,b.actor_user_id,b.source_id,b.source_generation_id,b.wal_head INTO bundle
  FROM survey_private.document_generation_bundles b WHERE b.candidate_operation_id=publication.operation_id FOR SHARE NOWAIT;
 IF NOT FOUND OR bundle.document_id IS DISTINCT FROM p_document_id OR bundle.generation_id IS DISTINCT FROM generation
  OR bundle.owner_user_id IS DISTINCT FROM d.user_id OR bundle.actor_user_id IS DISTINCT FROM publication.actor_user_id
  OR bundle.source_id IS DISTINCT FROM publication.source_id OR bundle.source_generation_id IS DISTINCT FROM publication.previous_generation_id
  OR bundle.wal_head IS DISTINCT FROM publication.wal_head OR frontier<publication.wal_head THEN
  RAISE EXCEPTION 'Published generation bundle differs' USING ERRCODE='23514';END IF;
 SELECT base_seq INTO baseline_seq FROM survey_private.annotation_generations
  WHERE document_id=p_document_id AND generation_id=generation FOR SHARE NOWAIT;
 IF NOT FOUND OR baseline_seq IS DISTINCT FROM publication.wal_head THEN
  RAISE EXCEPTION 'Published generation baseline differs' USING ERRCODE='23514';END IF;
 SELECT * INTO asset FROM survey_private.document_generation_assets
  WHERE operation_id=publication.operation_id AND candidate_operation_id=publication.operation_id FOR SHARE NOWAIT;
 IF NOT FOUND OR asset.document_id IS DISTINCT FROM p_document_id OR asset.generation_id IS DISTINCT FROM generation
  OR asset.purpose IS DISTINCT FROM 'candidate-pdf' OR asset.source_object IS NOT NULL
  OR asset.path IS DISTINCT FROM d.file_path OR asset.byte_length IS DISTINCT FROM d.file_size THEN
  RAISE EXCEPTION 'Published PDF binding differs' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM survey_private.document_generation_storage_references
  WHERE document_id=p_document_id AND generation_id=generation AND path=asset.path
   AND path_hash=survey_private.document_storage_path_hash(asset.path) FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Published PDF reference is missing' USING ERRCODE='23514';END IF;
 -- Do NOT touch_document_storage_path here: that would increment the hot path
 -- row on every read. Its committed, active guard already exists from staging.
 SELECT retired,retirement_xid INTO guard FROM survey_private.document_storage_path_guards
  WHERE path_hash=survey_private.document_storage_path_hash(asset.path) FOR SHARE NOWAIT;
 IF NOT FOUND OR guard.retired OR guard.retirement_xid IS NOT NULL THEN
  RAISE EXCEPTION 'Published PDF path is unavailable' USING ERRCODE='23514';END IF;
 SELECT id,version,metadata->>'size' AS byte_length INTO physical FROM storage.objects
  WHERE bucket_id='documents' AND name=asset.path FOR SHARE NOWAIT;
 IF NOT FOUND OR physical.id IS DISTINCT FROM asset.object_id OR physical.version IS DISTINCT FROM asset.object_version
  OR physical.byte_length IS DISTINCT FROM asset.byte_length::text THEN
  RAISE EXCEPTION 'Published PDF object differs' USING ERRCODE='23514';END IF;
 IF p_include_snapshot THEN
  -- Inspect TOAST length before allocating a hexadecimal response. Accepted
  -- writer RPCs hold the exclusive document lock; this read holds its shared
  -- counterpart, plus the chosen existing checkpoint tuple through return.
  SELECT octet_length(snapshot),at_seq,encoding_version INTO raw_length,checkpoint_seq,checkpoint_encoding FROM survey_private.annotation_generation_snapshots
   WHERE document_id=p_document_id AND generation_id=generation FOR SHARE NOWAIT;
  selected_snapshot:=FOUND;
  IF NOT FOUND THEN
   SELECT octet_length(baseline_snapshot),base_seq,baseline_encoding_version INTO raw_length,checkpoint_seq,checkpoint_encoding FROM survey_private.annotation_generations
    WHERE document_id=p_document_id AND generation_id=generation FOR SHARE NOWAIT;
  END IF;
  IF raw_length IS NULL OR raw_length<=0 OR raw_length>67108864 THEN
   RAISE EXCEPTION 'Generation checkpoint exceeds open bounds' USING ERRCODE='54000';END IF;
  IF checkpoint_seq IS NULL OR checkpoint_seq<publication.wal_head OR checkpoint_seq>frontier
   OR checkpoint_encoding IS NULL OR checkpoint_encoding NOT IN(1,2) THEN
   RAISE EXCEPTION 'Generation checkpoint metadata differs' USING ERRCODE='23514';END IF;
  -- Hash the bounded stored bytes directly, not a second decoded copy of the
  -- much larger hexadecimal JSON response. The chosen tuple stays locked.
  IF selected_snapshot THEN
   SELECT encode(sha256(snapshot),'hex') INTO checkpoint_hash FROM survey_private.annotation_generation_snapshots
    WHERE document_id=p_document_id AND generation_id=generation;
  ELSE
   SELECT encode(sha256(baseline_snapshot),'hex') INTO checkpoint_hash FROM survey_private.annotation_generations
    WHERE document_id=p_document_id AND generation_id=generation;
  END IF;
  annotations:=public.read_annotation_snapshot_v2(p_document_id,generation);
  IF annotations->'snapshot' IS NULL OR annotations->'snapshot'='null'::jsonb
   OR annotations->>'wal_head' IS DISTINCT FROM frontier::text THEN
   RAISE EXCEPTION 'Generation checkpoint is unavailable' USING ERRCODE='23514';END IF;
  annotations:=annotations||jsonb_build_object('snapshot_sha256',checkpoint_hash);
 ELSE
  -- Confirmation after download/tail repeats every authority and PDF check,
  -- but neither reads checkpoint bytes nor encodes/hashes a second large copy.
  annotations:=jsonb_build_object('version',2,'document_id',p_document_id,'generation_id',generation,
   'wal_head',frontier::text,'snapshot',NULL,'snapshot_sha256',NULL);
 END IF;
 RETURN jsonb_build_object('version',1,'actor_user_id',actor,'document_id',p_document_id,'generation_id',generation,
  'document',to_jsonb(d)||jsonb_build_object('file_size',d.file_size::text),
  'publication',jsonb_build_object('operation_id',publication.operation_id,'generation_id',publication.generation_id,
   'published_at',publication.published_at,'wal_head',publication.wal_head::text),
  'pdf',jsonb_build_object('bucket_id','documents','path',asset.path,'id',asset.object_id,'version',asset.object_version,
   'byte_length',asset.byte_length::text,'content_sha256',asset.content_sha256),'annotations',annotations);
END; $$;
ALTER FUNCTION public.read_document_generation_open(uuid,uuid,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.read_document_generation_open(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_document_generation_open(uuid,uuid,boolean) TO authenticated;
COMMENT ON FUNCTION public.read_document_generation_open(uuid,uuid,boolean) IS
 'Authorized current adopted-generation open/confirmation only. No download URL or private source/history. NULL generation discovers current; false snapshot mode confirms bindings without reading checkpoint bytes.';
COMMIT;
