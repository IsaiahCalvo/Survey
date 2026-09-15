-- Checked-generation legacy sidecar retirement. Raw bytes remain private
-- recovery evidence; no sidecar field is adopted as shared document truth.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS survey_private.document_generation_legacy_sidecar_retirements (
 document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
 generation_id uuid NOT NULL,
 origin_generation_id uuid NOT NULL,
 source_generation_id uuid NOT NULL,
 archive_operation_id uuid NOT NULL REFERENCES survey_private.document_generation_assets(operation_id),
 retired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(document_id,generation_id)
);
CREATE INDEX IF NOT EXISTS document_generation_legacy_sidecar_archive_idx
 ON survey_private.document_generation_legacy_sidecar_retirements(archive_operation_id);
ALTER TABLE survey_private.document_generation_legacy_sidecar_retirements OWNER TO postgres;
ALTER TABLE survey_private.document_generation_legacy_sidecar_retirements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_generation_legacy_sidecar_retirements FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS document_generation_legacy_sidecar_retirement_immutable ON survey_private.document_generation_legacy_sidecar_retirements;
CREATE TRIGGER document_generation_legacy_sidecar_retirement_immutable
 BEFORE UPDATE OR DELETE ON survey_private.document_generation_legacy_sidecar_retirements
 FOR EACH ROW EXECUTE FUNCTION survey_private.guard_retained_generation_rows();
DROP TRIGGER IF EXISTS document_generation_legacy_sidecar_retirement_no_truncate ON survey_private.document_generation_legacy_sidecar_retirements;
CREATE TRIGGER document_generation_legacy_sidecar_retirement_no_truncate
 BEFORE TRUNCATE ON survey_private.document_generation_legacy_sidecar_retirements
 FOR EACH STATEMENT EXECUTE FUNCTION survey_private.reject_retained_generation_truncate();

-- One bounded row binds the complete offered request IDs to the exact prefix
-- consumed by the verified PDF(+sidecar) proof and the private v4 plan field.
CREATE TABLE IF NOT EXISTS survey_private.document_generation_replacement_archive_offers (
 candidate_operation_id uuid PRIMARY KEY REFERENCES survey_private.document_generation_replacement_requests(candidate_operation_id) ON DELETE CASCADE,
 offered_archive_operation_ids uuid[] NOT NULL CHECK(cardinality(offered_archive_operation_ids) BETWEEN 1 AND 2),
 used_archive_operation_ids uuid[] NOT NULL CHECK(cardinality(used_archive_operation_ids) BETWEEN 1 AND 2),
 legacy_sidecar_archive jsonb,
 plan_sha256 text NOT NULL CHECK(plan_sha256 ~ '^[0-9a-f]{64}$'),
 CHECK(used_archive_operation_ids=offered_archive_operation_ids[1:cardinality(used_archive_operation_ids)]),
 CHECK((cardinality(used_archive_operation_ids)=1 AND legacy_sidecar_archive IS NULL)
   OR (cardinality(used_archive_operation_ids)=2 AND jsonb_typeof(legacy_sidecar_archive)='object'))
);
ALTER TABLE survey_private.document_generation_replacement_archive_offers OWNER TO postgres;
ALTER TABLE survey_private.document_generation_replacement_archive_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_generation_replacement_archive_offers FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION survey_private.guard_document_generation_replacement_archive_offer()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(
  SELECT 1 FROM survey_private.document_generation_replacement_requests r
   WHERE r.candidate_operation_id=OLD.candidate_operation_id) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Replacement archive offer is immutable' USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS document_generation_replacement_archive_offer_immutable ON survey_private.document_generation_replacement_archive_offers;
CREATE TRIGGER document_generation_replacement_archive_offer_immutable
 BEFORE UPDATE OR DELETE ON survey_private.document_generation_replacement_archive_offers
 FOR EACH ROW EXECUTE FUNCTION survey_private.guard_document_generation_replacement_archive_offer();
DROP TRIGGER IF EXISTS document_generation_replacement_archive_offer_no_truncate ON survey_private.document_generation_replacement_archive_offers;
CREATE TRIGGER document_generation_replacement_archive_offer_no_truncate
 BEFORE TRUNCATE ON survey_private.document_generation_replacement_archive_offers
 FOR EACH STATEMENT EXECUTE FUNCTION survey_private.reject_document_generation_replacement_truncate();

CREATE OR REPLACE FUNCTION survey_private.document_generation_used_archives_v4(p_actor uuid,p_source uuid,p_offered uuid[])
RETURNS uuid[] LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE proof jsonb; count_objects integer; used uuid[]; content_model smallint;
BEGIN
 IF p_actor IS NULL OR p_source IS NULL OR p_offered IS NULL OR array_ndims(p_offered) IS DISTINCT FROM 1
  OR cardinality(p_offered) NOT BETWEEN 1 AND 2 OR array_position(p_offered,NULL) IS NOT NULL
  OR (SELECT count(DISTINCT x) FROM unnest(p_offered) x)<>cardinality(p_offered) THEN
  RAISE EXCEPTION 'Invalid archive offer' USING ERRCODE='22023';END IF;
 SELECT content_model_version INTO content_model FROM survey_private.document_generation_sources WHERE source_id=p_source FOR SHARE NOWAIT;
 IF NOT FOUND OR content_model NOT IN(1,2) THEN
  RAISE EXCEPTION 'Verified checked source required' USING ERRCODE='23514';END IF;
 proof:=survey_private.assert_document_generation_source_bytes_v2(p_actor,p_source,content_model);
 count_objects:=jsonb_array_length(proof->'objects');
 IF count_objects NOT BETWEEN 1 AND 2 OR cardinality(p_offered)<count_objects
  OR proof->'objects'->0->>'kind' IS DISTINCT FROM 'pdf'
  OR (count_objects=2 AND proof->'objects'->1->>'kind' IS DISTINCT FROM 'sidecar') THEN
  RAISE EXCEPTION 'Archive offer does not cover the verified source' USING ERRCODE='23514';END IF;
 used:=p_offered[1:count_objects]; RETURN used;
END $$;

CREATE OR REPLACE FUNCTION survey_private.document_generation_legacy_sidecar_marker(p_document uuid,p_generation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE marker survey_private.document_generation_legacy_sidecar_retirements%ROWTYPE;
 asset survey_private.document_generation_assets%ROWTYPE; physical storage.objects%ROWTYPE; guard record;
BEGIN
 SELECT * INTO marker FROM survey_private.document_generation_legacy_sidecar_retirements
  WHERE document_id=p_document AND generation_id=p_generation FOR SHARE NOWAIT;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO asset FROM survey_private.document_generation_assets WHERE operation_id=marker.archive_operation_id FOR SHARE NOWAIT;
 IF NOT FOUND OR asset.document_id IS DISTINCT FROM p_document OR asset.purpose IS DISTINCT FROM 'source-object-archive'
  OR asset.source_object->>'kind' IS DISTINCT FROM 'sidecar' THEN
  RAISE EXCEPTION 'Retired legacy sidecar binding differs' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM survey_private.document_generation_storage_references r
  WHERE r.document_id=asset.document_id AND r.generation_id=asset.generation_id AND r.path=asset.path FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Retired legacy sidecar reference is missing' USING ERRCODE='23514';END IF;
 SELECT retired,retirement_xid INTO guard FROM survey_private.document_storage_path_guards
  WHERE path_hash=survey_private.document_storage_path_hash(asset.path) FOR SHARE NOWAIT;
 IF NOT FOUND OR guard.retired OR guard.retirement_xid IS NOT NULL THEN
  RAISE EXCEPTION 'Retired legacy sidecar archive is unavailable' USING ERRCODE='23514';END IF;
 SELECT * INTO physical FROM storage.objects WHERE bucket_id='documents' AND name=asset.path FOR SHARE NOWAIT;
 IF NOT FOUND OR physical.id IS DISTINCT FROM asset.object_id OR physical.version IS DISTINCT FROM asset.object_version
  OR physical.metadata->>'size' IS DISTINCT FROM asset.byte_length::text THEN
  RAISE EXCEPTION 'Retired legacy sidecar object differs' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('version',1,'state','archived','source_generation_id',marker.source_generation_id);
END $$;

CREATE OR REPLACE FUNCTION survey_private.prepare_document_generation_replacement_v4(
 p_actor uuid,p_source uuid,p_candidate uuid,p_archives uuid[],p_expected_generation uuid,
 p_expected_wal_head bigint,p_operation jsonb,p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE used uuid[]; plan3 jsonb; policy jsonb; digest text; existing survey_private.document_generation_replacement_archive_offers%ROWTYPE;
 semantic jsonb; sidecar_id uuid;
BEGIN
 IF p_expected_generation IS NULL OR jsonb_typeof(p_plan)<>'object'
  OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_plan) k) IS DISTINCT FROM
   ARRAY['aggregateAdmissionVersion','baseline_base64','contentModelVersion','legacy','legacySidecarArchive','operation','operationId','projection','source','version']::text[]
  OR p_plan->'version'<>'4'::jsonb OR p_plan->'contentModelVersion'<>'2'::jsonb
  OR p_plan->'aggregateAdmissionVersion'<>'1'::jsonb OR p_plan->'projection'->'sidecars'<>'[]'::jsonb THEN
  RAISE EXCEPTION 'Invalid v4 replacement preparation' USING ERRCODE='22023';END IF;
 used:=survey_private.document_generation_used_archives_v4(p_actor,p_source,p_archives);
 policy:=NULLIF(p_plan->'legacySidecarArchive','null'::jsonb);digest:=encode(sha256(convert_to(p_plan::text,'UTF8')),'hex');
 SELECT payload->'semantic' INTO semantic FROM survey_private.document_generation_sources s
  JOIN survey_private.document_generation_source_bodies b USING(body_id) WHERE s.source_id=p_source;
 IF cardinality(used)=2 THEN
  sidecar_id:=(semantic->'sidecar_objects'->0->>'id')::uuid;
  IF policy IS NULL OR policy->'version'<>'1'::jsonb OR policy->>'sourceObjectId' IS DISTINCT FROM sidecar_id::text
   OR policy->>'entities' NOT IN('absent','accepted-catalog') THEN
   RAISE EXCEPTION 'Legacy sidecar policy differs' USING ERRCODE='23514';END IF;
  IF policy->>'entities'='accepted-catalog' AND NOT EXISTS(
   SELECT 1 FROM survey_private.document_entity_catalogs c WHERE c.document_id=(semantic->>'document_id')::uuid) THEN
   RAISE EXCEPTION 'Legacy sidecar entities require an accepted document entity catalog' USING ERRCODE='SG004';END IF;
 ELSE
  IF policy IS NOT NULL THEN RAISE EXCEPTION 'Unexpected legacy sidecar policy' USING ERRCODE='23514';END IF;
 END IF;
 plan3:=(p_plan-'legacySidecarArchive')||jsonb_build_object('version',3);
 PERFORM survey_private.prepare_document_generation_replacement_v3(p_actor,p_source,p_candidate,used,
  p_expected_generation,p_expected_wal_head,p_operation,plan3);
 SELECT * INTO existing FROM survey_private.document_generation_replacement_archive_offers
  WHERE candidate_operation_id=p_candidate FOR SHARE NOWAIT;
 IF FOUND THEN
  IF existing.offered_archive_operation_ids IS DISTINCT FROM p_archives OR existing.used_archive_operation_ids IS DISTINCT FROM used
   OR existing.legacy_sidecar_archive IS DISTINCT FROM policy OR existing.plan_sha256 IS DISTINCT FROM digest THEN
   RAISE EXCEPTION 'V4 replacement retry identity differs' USING ERRCODE='23505';END IF;
 ELSE
  INSERT INTO survey_private.document_generation_replacement_archive_offers VALUES(p_candidate,p_archives,used,policy,digest);
 END IF;
 RETURN survey_private.read_document_generation_replacement_v4(p_actor,p_source,p_candidate,p_archives,
  p_expected_generation,p_expected_wal_head,p_operation);
END $$;

CREATE OR REPLACE FUNCTION survey_private.read_document_generation_replacement_v4(
 p_actor uuid,p_source uuid,p_candidate uuid,p_archives uuid[],p_expected_generation uuid,p_expected_wal_head bigint,p_operation jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE offer survey_private.document_generation_replacement_archive_offers%ROWTYPE; base jsonb; plan4 jsonb; publication4 jsonb;
BEGIN
 SELECT * INTO offer FROM survey_private.document_generation_replacement_archive_offers
  WHERE candidate_operation_id=p_candidate FOR SHARE NOWAIT;
 IF NOT FOUND THEN
  base:=survey_private.read_document_generation_replacement_v3(p_actor,p_source,p_candidate,p_archives[1:1],
   p_expected_generation,p_expected_wal_head,p_operation);
  IF base->>'state'<>'missing' THEN RAISE EXCEPTION 'V4 archive offer is missing' USING ERRCODE='23514';END IF;
  RETURN (base-'version'-'aggregate_admission_version'-'archive_operation_ids')||jsonb_build_object(
   'version',4,'aggregate_admission_version',1,'offered_archive_operation_ids',p_archives,'used_archive_operation_ids',NULL);
 END IF;
 IF offer.offered_archive_operation_ids IS DISTINCT FROM p_archives THEN
  RAISE EXCEPTION 'V4 archive offer differs' USING ERRCODE='23505';END IF;
 base:=survey_private.read_document_generation_replacement_v3(p_actor,p_source,p_candidate,offer.used_archive_operation_ids,
  p_expected_generation,p_expected_wal_head,p_operation);
 IF base->'plan' IS NOT NULL AND base->'plan'<>'null'::jsonb THEN
  plan4:=(base->'plan')||jsonb_build_object('version',4,'legacySidecarArchive',offer.legacy_sidecar_archive);
 END IF;
 IF base->'publication' IS NOT NULL AND base->'publication'<>'null'::jsonb THEN
  publication4:=((base->'publication')-'version')||jsonb_build_object('version',4,
   'offered_archive_operation_ids',offer.offered_archive_operation_ids,
   'used_archive_operation_ids',offer.used_archive_operation_ids,
   'legacy_sidecar_migration',survey_private.document_generation_legacy_sidecar_marker(
    (base->'publication'->>'document_id')::uuid,(base->'publication'->>'generation_id')::uuid));
 END IF;
 RETURN (base-'version'-'aggregate_admission_version'-'archive_operation_ids'-'plan'-'publication')||jsonb_build_object(
  'version',4,'aggregate_admission_version',1,'offered_archive_operation_ids',offer.offered_archive_operation_ids,
  'used_archive_operation_ids',offer.used_archive_operation_ids,'plan',plan4,'publication',publication4);
END $$;

CREATE OR REPLACE FUNCTION survey_private.publish_document_generation_v4(
 p_actor uuid,p_source uuid,p_candidate uuid,p_archives uuid[],p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE offer survey_private.document_generation_replacement_archive_offers%ROWTYPE; base jsonb; plan3 jsonb;
 target uuid; document uuid; source_generation uuid; sidecar_asset survey_private.document_generation_assets%ROWTYPE;
 carried survey_private.document_generation_legacy_sidecar_retirements%ROWTYPE;
 existing_marker survey_private.document_generation_legacy_sidecar_retirements%ROWTYPE;
 marker_origin uuid; marker_source uuid; marker_archive uuid;
BEGIN
 SELECT * INTO offer FROM survey_private.document_generation_replacement_archive_offers
  WHERE candidate_operation_id=p_candidate FOR SHARE NOWAIT;
 IF NOT FOUND OR offer.offered_archive_operation_ids IS DISTINCT FROM p_archives
  OR offer.plan_sha256 IS DISTINCT FROM encode(sha256(convert_to(p_plan::text,'UTF8')),'hex')
  OR offer.legacy_sidecar_archive IS DISTINCT FROM NULLIF(p_plan->'legacySidecarArchive','null'::jsonb) THEN
  RAISE EXCEPTION 'V4 publication identity differs' USING ERRCODE='23505';END IF;
 IF offer.legacy_sidecar_archive->>'entities'='accepted-catalog' AND NOT EXISTS(
  SELECT 1 FROM survey_private.document_entity_catalogs c JOIN survey_private.document_generation_replacement_requests r
   ON r.document_id=c.document_id WHERE r.candidate_operation_id=p_candidate) THEN
  RAISE EXCEPTION 'Legacy sidecar entities require an accepted document entity catalog' USING ERRCODE='SG004';END IF;
 plan3:=(p_plan-'legacySidecarArchive')||jsonb_build_object('version',3);
 PERFORM set_config('survey.legacy_sidecar_publication_v4',p_candidate::text,true);
 IF current_setting('survey.legacy_sidecar_publication_v4',true) IS DISTINCT FROM p_candidate::text THEN
  RAISE EXCEPTION 'V4 publication context differs' USING ERRCODE='55000';END IF;
 base:=survey_private.publish_document_generation_v3(p_actor,p_source,p_candidate,offer.used_archive_operation_ids,plan3);
 target:=(base->>'generation_id')::uuid;document:=(base->>'document_id')::uuid;source_generation:=(base->>'previous_generation_id')::uuid;
 IF cardinality(offer.used_archive_operation_ids)=2 THEN
  SELECT * INTO sidecar_asset FROM survey_private.document_generation_assets
   WHERE operation_id=offer.used_archive_operation_ids[2] AND candidate_operation_id=p_candidate FOR SHARE NOWAIT;
 IF NOT FOUND OR sidecar_asset.source_object->>'kind'<>'sidecar' THEN
   RAISE EXCEPTION 'Published legacy sidecar archive differs' USING ERRCODE='23514';END IF;
  marker_origin:=target;marker_source:=source_generation;marker_archive:=sidecar_asset.operation_id;
 ELSE
  SELECT * INTO carried FROM survey_private.document_generation_legacy_sidecar_retirements
   WHERE document_id=document AND generation_id=source_generation FOR SHARE NOWAIT;
  IF FOUND THEN marker_origin:=carried.origin_generation_id;marker_source:=carried.source_generation_id;
   marker_archive:=carried.archive_operation_id;END IF;
 END IF;
 IF marker_archive IS NOT NULL THEN
  SELECT * INTO existing_marker FROM survey_private.document_generation_legacy_sidecar_retirements
   WHERE document_id=document AND generation_id=target FOR SHARE NOWAIT;
  IF FOUND THEN
   IF existing_marker.origin_generation_id IS DISTINCT FROM marker_origin
    OR existing_marker.source_generation_id IS DISTINCT FROM marker_source
    OR existing_marker.archive_operation_id IS DISTINCT FROM marker_archive THEN
    RAISE EXCEPTION 'Published legacy sidecar marker differs' USING ERRCODE='23514';END IF;
  ELSE
   INSERT INTO survey_private.document_generation_legacy_sidecar_retirements
    VALUES(document,target,marker_origin,marker_source,marker_archive,clock_timestamp());
  END IF;
 END IF;
 RETURN (base-'version')||jsonb_build_object('version',4,
  'offered_archive_operation_ids',offer.offered_archive_operation_ids,
  'used_archive_operation_ids',offer.used_archive_operation_ids,
  'legacy_sidecar_migration',survey_private.document_generation_legacy_sidecar_marker(document,target));
END $$;

-- V3 still owns the atomic publication body. Under the exact v4 candidate
-- context only, treat the verified legacy sidecar as archive evidence rather
-- than a projection input. The retained bundle still binds both raw objects.
DO $patch_publish$ DECLARE definition text; anchor text; old_guard text; new_guard text;
BEGIN
 definition:=pg_get_functiondef('survey_private.publish_document_generation_v3(uuid,uuid,uuid,uuid[],jsonb)'::regprocedure);
 anchor:='semantic:=frozen->''payload''->''semantic'';';
 old_guard:='IF semantic->''sidecar_objects'' IS DISTINCT FROM ''[]''::jsonb OR projection->''sidecars'' IS DISTINCT FROM ''[]''::jsonb THEN';
 new_guard:='IF (semantic->''sidecar_objects'' IS DISTINCT FROM ''[]''::jsonb OR projection->''sidecars'' IS DISTINCT FROM ''[]''::jsonb) AND current_setting(''survey.legacy_sidecar_publication_v4'',true) IS DISTINCT FROM p_candidate::text THEN';
 IF position('survey.legacy_sidecar_publication_v4' IN definition)=0 THEN
  IF position(anchor IN definition)=0 OR position(old_guard IN definition)=0 THEN
   RAISE EXCEPTION 'Unexpected v3 publication semantic shape' USING ERRCODE='55000';END IF;
  definition:=replace(definition,old_guard,new_guard);
  EXECUTE definition;
 END IF;
END $patch_publish$;

-- A marked checked generation ignores the old fixed mutable sidecar path.
DO $replace_capture$ DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('survey_private.capture_document_generation_source_v3(uuid,uuid,uuid,smallint)'::regprocedure);
 definition:=replace(definition,
  'IF d.project_id IS NOT NULL THEN sidecar_path:=d.project_id::text||''/''||d.id::text||''_data.json'';END IF;',
  'IF d.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_legacy_sidecar_retirements r WHERE r.document_id=p_document AND r.generation_id=p_generation) THEN sidecar_path:=d.project_id::text||''/''||d.id::text||''_data.json'';END IF;');
 IF position('document_generation_legacy_sidecar_retirements' IN definition)=0 THEN
  RAISE EXCEPTION 'Unexpected v3 source capture shape' USING ERRCODE='55000';END IF;
 EXECUTE definition;
END $replace_capture$;

-- The byte checker independently rebuilds the fixed sidecar path. Suppress it
-- under the same direct marker lookup or a successor source could capture one
-- object and then fail (or later recapture the retired mutable JSON).
DO $replace_source_bytes$ DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('survey_private.check_document_generation_source_bytes_v2(uuid,uuid,smallint)'::regprocedure);
 definition:=replace(definition,
  'IF d.project_id IS NOT NULL THEN sidecar_path:=d.project_id::text||''/''||d.id::text||''_data.json'';END IF;',
  'IF d.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_legacy_sidecar_retirements retired WHERE retired.document_id=r.document_id AND retired.generation_id=r.generation_id) THEN sidecar_path:=d.project_id::text||''/''||d.id::text||''_data.json'';END IF;');
 IF position('document_generation_legacy_sidecar_retirements' IN definition)=0 THEN
  RAISE EXCEPTION 'Unexpected v2 source byte check shape' USING ERRCODE='55000';END IF;
 EXECUTE definition;
END $replace_source_bytes$;

CREATE OR REPLACE FUNCTION survey_private.guard_legacy_sidecar_retirement_head()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.generation_id IS DISTINCT FROM OLD.generation_id
  AND EXISTS(SELECT 1 FROM survey_private.document_generation_legacy_sidecar_retirements r
   WHERE r.document_id=OLD.document_id AND r.generation_id=OLD.generation_id)
  AND coalesce(current_setting('survey.legacy_sidecar_publication_v4',true),'')='' THEN
  RAISE EXCEPTION 'Retired legacy sidecar requires v4 publication' USING ERRCODE='SG004';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS legacy_sidecar_retirement_head_guard ON survey_private.annotation_generation_heads;
CREATE TRIGGER legacy_sidecar_retirement_head_guard BEFORE UPDATE ON survey_private.annotation_generation_heads
 FOR EACH ROW EXECUTE FUNCTION survey_private.guard_legacy_sidecar_retirement_head();

CREATE OR REPLACE FUNCTION public.read_document_generation_open_v4(
 p_document_id uuid,p_generation_id uuid,p_content_model_version smallint,p_include_snapshot boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE result jsonb;
BEGIN
 result:=public.read_document_generation_open_v3(p_document_id,p_generation_id,p_content_model_version,p_include_snapshot);
 RETURN (result-'version')||jsonb_build_object('version',4,'legacy_sidecar_migration',
  survey_private.document_generation_legacy_sidecar_marker(p_document_id,(result->>'generation_id')::uuid));
END $$;

CREATE OR REPLACE FUNCTION public.read_document_generation_legacy_sidecar_archive_v1(p_document_id uuid,p_generation_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE actor uuid:=auth.uid(); d public.documents%ROWTYPE; marker survey_private.document_generation_legacy_sidecar_retirements%ROWTYPE;
 asset survey_private.document_generation_assets%ROWTYPE; bundle survey_private.document_generation_bundles%ROWTYPE;
BEGIN
 IF actor IS NULL OR p_document_id IS NULL OR p_generation_id IS NULL THEN
  RAISE EXCEPTION 'Legacy sidecar recovery is not permitted' USING ERRCODE='42501';END IF;
 IF NOT pg_try_advisory_xact_lock_shared(hashtextextended(p_document_id::text,0)) THEN
  RAISE EXCEPTION 'Legacy sidecar recovery contention' USING ERRCODE='40001';END IF;
 SELECT * INTO d FROM public.documents WHERE id=p_document_id FOR SHARE NOWAIT;
 SELECT * INTO marker FROM survey_private.document_generation_legacy_sidecar_retirements
  WHERE document_id=p_document_id AND generation_id=p_generation_id FOR SHARE NOWAIT;
 IF NOT FOUND OR d.user_id IS DISTINCT FROM actor THEN
  RAISE EXCEPTION 'Legacy sidecar recovery is not permitted' USING ERRCODE='42501';END IF;
 SELECT * INTO asset FROM survey_private.document_generation_assets WHERE operation_id=marker.archive_operation_id FOR SHARE NOWAIT;
 SELECT * INTO bundle FROM survey_private.document_generation_bundles WHERE candidate_operation_id=asset.candidate_operation_id FOR SHARE NOWAIT;
 IF bundle.owner_user_id IS DISTINCT FROM actor OR asset.purpose<>'source-object-archive'
  OR asset.source_object->>'kind'<>'sidecar' OR d.project_id IS NULL
  OR asset.source_object->>'path' IS DISTINCT FROM d.project_id::text||'/'||d.id::text||'_data.json'
  OR asset.source_object->>'byte_length' IS DISTINCT FROM asset.byte_length::text
  OR asset.source_object->>'content_sha256' IS DISTINCT FROM asset.content_sha256
  OR asset.byte_length>16777216
  OR survey_private.document_generation_legacy_sidecar_marker(p_document_id,p_generation_id) IS NULL THEN
  RAISE EXCEPTION 'Legacy sidecar recovery is not permitted' USING ERRCODE='42501';END IF;
 PERFORM survey_private.assert_account_open(actor);
 RETURN jsonb_build_object('version',1,'actor_user_id',actor,'document_id',p_document_id,'generation_id',p_generation_id,
  'source_generation_id',marker.source_generation_id,'archive',jsonb_build_object('kind','sidecar','bucket_id','documents',
   'path',asset.path,'id',asset.object_id,'version',asset.object_version,'byte_length',asset.byte_length::text,
   'content_sha256',asset.content_sha256,'source_object',jsonb_build_object(
    'bucket_id',asset.source_object->>'bucket_id','path',asset.source_object->>'path',
    'id',asset.source_object->>'id','version',asset.source_object->>'version',
    'byte_length',asset.source_object->>'byte_length')));
END $$;

DO $$ DECLARE signature text; BEGIN FOREACH signature IN ARRAY ARRAY[
 'survey_private.document_generation_used_archives_v4(uuid,uuid,uuid[])',
 'survey_private.document_generation_legacy_sidecar_marker(uuid,uuid)',
 'survey_private.prepare_document_generation_replacement_v4(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb)',
 'survey_private.read_document_generation_replacement_v4(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb)',
 'survey_private.publish_document_generation_v4(uuid,uuid,uuid,uuid[],jsonb)',
 'survey_private.guard_document_generation_replacement_archive_offer()',
 'survey_private.guard_legacy_sidecar_retirement_head()',
 'public.read_document_generation_open_v4(uuid,uuid,smallint,boolean)',
 'public.read_document_generation_legacy_sidecar_archive_v1(uuid,uuid)'] LOOP
 EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO postgres';
 EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC,anon,authenticated,service_role';
 END LOOP;END $$;
GRANT EXECUTE ON FUNCTION public.read_document_generation_open_v4(uuid,uuid,smallint,boolean),
 public.read_document_generation_legacy_sidecar_archive_v1(uuid,uuid) TO authenticated;
COMMIT;
