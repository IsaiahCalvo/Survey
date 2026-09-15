-- Explicit, owner-reviewed conversion of one legacy document into its first
-- checked/model-2 generation. The fixed-path source objects are retained as
-- immutable recovery evidence; their contents are never promoted as shared
-- document state by this migration.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE survey_private.document_first_generation_adoption_reviews (
 adoption_operation_id uuid PRIMARY KEY,
 actor_user_id uuid NOT NULL,
 owner_user_id uuid NOT NULL,
 document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
 source_id uuid NOT NULL UNIQUE REFERENCES survey_private.document_generation_sources(source_id),
 candidate_operation_id uuid NOT NULL UNIQUE,
 offered_archive_operation_ids uuid[] NOT NULL CHECK(cardinality(offered_archive_operation_ids)=2),
 used_archive_operation_ids uuid[] NOT NULL CHECK(cardinality(used_archive_operation_ids) BETWEEN 1 AND 2),
 review_sha256 text NOT NULL CHECK(review_sha256~'^[0-9a-f]{64}$'),
 source_sql_sha256 text NOT NULL CHECK(source_sql_sha256~'^[0-9a-f]{64}$'),
 wal_head bigint NOT NULL CHECK(wal_head>=0),
 objects jsonb NOT NULL CHECK(jsonb_typeof(objects)='array'),
 source_provenance jsonb NOT NULL CHECK(jsonb_typeof(source_provenance)='array'),
 canonical_annotations jsonb NOT NULL CHECK(jsonb_typeof(canonical_annotations)='object'),
 entity_catalog jsonb NOT NULL CHECK(jsonb_typeof(entity_catalog)='object'),
 survey_definition jsonb NOT NULL CHECK(jsonb_typeof(survey_definition)='object'),
 sidecar_entity_policy text NOT NULL CHECK(sidecar_entity_policy IN('absent','accepted-catalog')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 CHECK(used_archive_operation_ids=offered_archive_operation_ids[1:cardinality(used_archive_operation_ids)])
);
CREATE INDEX document_first_generation_adoption_document_idx
 ON survey_private.document_first_generation_adoption_reviews(document_id,adoption_operation_id);
CREATE TABLE survey_private.document_first_generation_adoption_confirmations (
 adoption_operation_id uuid PRIMARY KEY REFERENCES survey_private.document_first_generation_adoption_reviews(adoption_operation_id) ON DELETE CASCADE,
 review_sha256 text NOT NULL CHECK(review_sha256~'^[0-9a-f]{64}$'),
 confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE survey_private.document_first_generation_adoption_publications (
 adoption_operation_id uuid PRIMARY KEY REFERENCES survey_private.document_first_generation_adoption_reviews(adoption_operation_id) ON DELETE CASCADE,
 generation_id uuid NOT NULL UNIQUE,
 published_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE survey_private.document_generation_legacy_adoption_origins (
 document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
 generation_id uuid NOT NULL,
 adoption_operation_id uuid NOT NULL REFERENCES survey_private.document_first_generation_adoption_publications(adoption_operation_id) ON DELETE CASCADE,
 PRIMARY KEY(document_id,generation_id)
);
CREATE INDEX document_generation_legacy_adoption_origin_idx
 ON survey_private.document_generation_legacy_adoption_origins(adoption_operation_id);

ALTER TABLE survey_private.document_first_generation_adoption_reviews OWNER TO postgres;
ALTER TABLE survey_private.document_first_generation_adoption_confirmations OWNER TO postgres;
ALTER TABLE survey_private.document_first_generation_adoption_publications OWNER TO postgres;
ALTER TABLE survey_private.document_generation_legacy_adoption_origins OWNER TO postgres;
ALTER TABLE survey_private.document_first_generation_adoption_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_private.document_first_generation_adoption_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_private.document_first_generation_adoption_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_private.document_generation_legacy_adoption_origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_first_generation_adoption_reviews,
 survey_private.document_first_generation_adoption_confirmations,
 survey_private.document_first_generation_adoption_publications,
 survey_private.document_generation_legacy_adoption_origins FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION survey_private.guard_document_first_generation_adoption_rows()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.documents WHERE id=OLD.document_id) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Document adoption evidence is immutable' USING ERRCODE='23514';
END $$;
CREATE OR REPLACE FUNCTION survey_private.guard_document_first_generation_adoption_child_rows()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE doc uuid;
BEGIN
 SELECT document_id INTO doc FROM survey_private.document_first_generation_adoption_reviews
  WHERE adoption_operation_id=OLD.adoption_operation_id;
 IF TG_OP='DELETE' AND (doc IS NULL OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=doc)) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Document adoption evidence is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER document_first_generation_adoption_review_immutable BEFORE UPDATE OR DELETE
 ON survey_private.document_first_generation_adoption_reviews FOR EACH ROW
 EXECUTE FUNCTION survey_private.guard_document_first_generation_adoption_rows();
CREATE TRIGGER document_first_generation_adoption_confirmation_immutable BEFORE UPDATE OR DELETE
 ON survey_private.document_first_generation_adoption_confirmations FOR EACH ROW
 EXECUTE FUNCTION survey_private.guard_document_first_generation_adoption_child_rows();
CREATE TRIGGER document_first_generation_adoption_publication_immutable BEFORE UPDATE OR DELETE
 ON survey_private.document_first_generation_adoption_publications FOR EACH ROW
 EXECUTE FUNCTION survey_private.guard_document_first_generation_adoption_child_rows();
CREATE TRIGGER document_generation_legacy_adoption_origin_immutable BEFORE UPDATE OR DELETE
 ON survey_private.document_generation_legacy_adoption_origins FOR EACH ROW
 EXECUTE FUNCTION survey_private.guard_document_first_generation_adoption_rows();
DO $$ DECLARE relation text;BEGIN
 FOREACH relation IN ARRAY ARRAY['document_first_generation_adoption_reviews',
  'document_first_generation_adoption_confirmations','document_first_generation_adoption_publications',
  'document_generation_legacy_adoption_origins'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON survey_private.%I FOR EACH STATEMENT EXECUTE FUNCTION survey_private.reject_retained_generation_truncate()',
   relation||'_no_truncate',relation);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION survey_private.require_document_first_generation_owner(p_actor uuid,p_document uuid)
RETURNS public.documents LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE previous_sub text:=current_setting('request.jwt.claim.sub',true); d public.documents%ROWTYPE; role_name text; direct_role text;
BEGIN
 IF p_actor IS NULL OR p_document IS NULL OR current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Invalid document adoption authority check' USING ERRCODE='22023';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(p_document::text,0)) THEN
  RAISE EXCEPTION 'Document adoption contention' USING ERRCODE='40001';END IF;
 SELECT * INTO d FROM public.documents WHERE id=p_document FOR NO KEY UPDATE NOWAIT;
 IF NOT FOUND OR d.archived OR d.user_archived_at IS NOT NULL THEN
  RAISE EXCEPTION 'Document adoption is not permitted' USING ERRCODE='42501';END IF;
 PERFORM set_config('request.jwt.claim.sub',p_actor::text,true);
 -- Direct collaborator changes take the document parent lock already held.
 -- If access is inherited, hold the project parent lock which fences both the
 -- project owner and project collaborator role through this transaction.
 IF d.user_id IS DISTINCT FROM p_actor AND d.project_id IS NOT NULL THEN
  SELECT role INTO direct_role FROM public.document_collaborators
   WHERE document_id=p_document AND user_id=p_actor AND status='active';
  IF direct_role IS DISTINCT FROM 'owner' THEN
   PERFORM id FROM public.projects WHERE id=d.project_id FOR SHARE NOWAIT;
  END IF;
 END IF;
 SELECT public.get_my_document_role(p_document) INTO role_name;
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 IF role_name IS DISTINCT FROM 'owner' THEN
  RAISE EXCEPTION 'Document adoption requires effective owner access' USING ERRCODE='42501';END IF;
 RETURN d;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);RAISE;
END $$;

CREATE OR REPLACE FUNCTION survey_private.document_first_generation_definition_state(p_document uuid,p_kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE revision bigint; digest text;
BEGIN
 IF p_kind='entity' THEN
  SELECT catalog_revision,source_entities_sha256 INTO revision,digest
   FROM survey_private.document_entity_catalogs WHERE document_id=p_document;
 ELSIF p_kind='survey' THEN
  SELECT definition_revision,source_structure_sha256 INTO revision,digest
   FROM survey_private.document_survey_definitions WHERE document_id=p_document;
 ELSE RAISE EXCEPTION 'Invalid definition kind' USING ERRCODE='22023';END IF;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','absent','revision',NULL,'content_sha256',NULL);END IF;
 RETURN jsonb_build_object('status','accepted','revision',revision::text,'content_sha256',digest);
END $$;

CREATE OR REPLACE FUNCTION survey_private.document_first_generation_source_evidence(p_actor uuid,p_source uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE proof jsonb; objects jsonb; provenance jsonb;
BEGIN
 proof:=survey_private.assert_document_generation_source_bytes_v2(p_actor,p_source,1::smallint);
 SELECT jsonb_agg(jsonb_build_object('kind',x->>'kind','byte_length',x->>'byte_length','content_sha256',x->>'content_sha256') ORDER BY n),
  jsonb_agg(jsonb_build_object('kind',x->>'kind','bucket_id',x->>'bucket_id','path',x->>'path','id',x->>'id',
   'version',x->>'version','byte_length',x->>'byte_length','content_sha256',x->>'content_sha256','owner_id',o.owner_id) ORDER BY n)
  INTO objects,provenance
 FROM jsonb_array_elements(proof->'objects') WITH ORDINALITY m(x,n)
 JOIN storage.objects o ON o.bucket_id=x->>'bucket_id' AND o.name=x->>'path' AND o.id=(x->>'id')::uuid
  AND o.version=x->>'version' AND o.metadata->>'size'=x->>'byte_length';
 IF jsonb_array_length(coalesce(provenance,'[]'))<>jsonb_array_length(proof->'objects') THEN
  RAISE EXCEPTION 'Legacy source provenance differs' USING ERRCODE='40001';END IF;
 RETURN jsonb_build_object('objects',objects,'provenance',provenance);
END $$;

CREATE OR REPLACE FUNCTION survey_private.document_first_generation_adoption_receipt(p_adoption uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE r survey_private.document_first_generation_adoption_reviews%ROWTYPE;
 c survey_private.document_first_generation_adoption_confirmations%ROWTYPE;
 p survey_private.document_first_generation_adoption_publications%ROWTYPE; state text;
BEGIN
 SELECT * INTO r FROM survey_private.document_first_generation_adoption_reviews WHERE adoption_operation_id=p_adoption;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO c FROM survey_private.document_first_generation_adoption_confirmations WHERE adoption_operation_id=p_adoption;
 SELECT * INTO p FROM survey_private.document_first_generation_adoption_publications WHERE adoption_operation_id=p_adoption;
 state:=CASE WHEN p.adoption_operation_id IS NOT NULL THEN 'published' WHEN c.adoption_operation_id IS NOT NULL THEN 'confirmed' ELSE 'review' END;
 RETURN jsonb_build_object('version',1,'state',state,
  'actor_user_id',r.actor_user_id,'owner_user_id',r.owner_user_id,'document_id',r.document_id,
  'adoption_operation_id',r.adoption_operation_id,'source_id',r.source_id,
  'candidate_operation_id',r.candidate_operation_id,
  'offered_archive_operation_ids',r.offered_archive_operation_ids,
  'used_archive_operation_ids',r.used_archive_operation_ids,'review_sha256',r.review_sha256,
  'source_sql_sha256',r.source_sql_sha256,'wal_head',r.wal_head::text,'objects',r.objects,
  'canonical_annotations',r.canonical_annotations,'entity_catalog',r.entity_catalog,
  'survey_definition',r.survey_definition,'expires_at',r.expires_at)
  ||CASE WHEN state IN('confirmed','published') THEN jsonb_build_object('confirmed_at',c.confirmed_at) ELSE '{}'::jsonb END
  ||CASE WHEN state='published' THEN jsonb_build_object('generation_id',p.generation_id,'content_model_version',2,
   'pdf',(r.objects->0)-'kind','legacy_sidecar_migration',jsonb_build_object(
    'version',2,'state','archived','origin',jsonb_build_object('mode','legacy','adoption_operation_id',r.adoption_operation_id)),
   'published_at',p.published_at) ELSE '{}'::jsonb END;
END $$;

CREATE OR REPLACE FUNCTION survey_private.create_document_first_generation_adoption_review_v1(
 p_actor uuid,p_document uuid,p_adoption uuid,p_source uuid,p_candidate uuid,p_offered uuid[],
 p_canonical_annotations jsonb,p_sidecar_entity_policy text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE d public.documents%ROWTYPE; s survey_private.document_generation_sources%ROWTYPE; existing jsonb; evidence jsonb;
 proof jsonb; objects jsonb; provenance jsonb; used uuid[]; entity_state jsonb; survey_state jsonb;
 digest text; expiry timestamptz; source_member jsonb; physical storage.objects%ROWTYPE;
BEGIN
 IF p_actor IS NULL OR p_document IS NULL OR p_adoption IS NULL OR p_source IS NULL OR p_candidate IS NULL
  OR p_offered IS NULL OR array_ndims(p_offered) IS DISTINCT FROM 1 OR cardinality(p_offered)<>2
  OR array_position(p_offered,NULL) IS NOT NULL OR (SELECT count(DISTINCT x) FROM unnest(p_offered)x)<>2
  OR p_candidate=ANY(p_offered) OR p_adoption IN(p_source,p_candidate,p_offered[1],p_offered[2])
  OR p_source IN(p_candidate,p_offered[1],p_offered[2]) OR p_candidate IN(p_offered[1],p_offered[2])
  OR p_sidecar_entity_policy NOT IN('absent','accepted-catalog')
  OR jsonb_typeof(p_canonical_annotations)<>'object'
  OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_canonical_annotations) k) IS DISTINCT FROM
   ARRAY['baseline_sha256','contributors','policy','through_seq','version']::text[]
  OR p_canonical_annotations->'version'<>'1'::jsonb OR p_canonical_annotations->>'policy'<>'legacy-sql-v1'
  OR coalesce(p_canonical_annotations->>'through_seq','')!~'^(0|[1-9][0-9]{0,18})$'
  OR (p_canonical_annotations->>'through_seq')::numeric>9223372036854775807
  OR coalesce(p_canonical_annotations->>'baseline_sha256','')!~'^[0-9a-f]{64}$'
  OR jsonb_typeof(p_canonical_annotations->'contributors')<>'array'
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_canonical_annotations->'contributors') x
   WHERE x NOT IN('annotation-snapshot','annotation-wal','document-annotations','legacy-yjs-annotations'))
  OR (SELECT count(*) FROM jsonb_array_elements_text(p_canonical_annotations->'contributors'))<>
     (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p_canonical_annotations->'contributors') x)
  OR ((p_canonical_annotations->'contributors') ?| ARRAY['annotation-snapshot','annotation-wal'])
    AND ((p_canonical_annotations->'contributors') ?| ARRAY['document-annotations','legacy-yjs-annotations']) THEN
  RAISE EXCEPTION 'Invalid document adoption review' USING ERRCODE='22023';END IF;
 SELECT survey_private.document_first_generation_adoption_receipt(p_adoption) INTO existing;
 IF existing IS NOT NULL THEN
  IF existing->>'actor_user_id' IS DISTINCT FROM p_actor::text THEN
   RAISE EXCEPTION 'Document adoption is not yours' USING ERRCODE='42501';END IF;
  IF existing->>'document_id' IS DISTINCT FROM p_document::text
   OR existing->>'source_id' IS DISTINCT FROM p_source::text OR existing->>'candidate_operation_id' IS DISTINCT FROM p_candidate::text
   OR existing->'offered_archive_operation_ids' IS DISTINCT FROM to_jsonb(p_offered)
   OR existing->'canonical_annotations' IS DISTINCT FROM p_canonical_annotations
   OR (SELECT sidecar_entity_policy FROM survey_private.document_first_generation_adoption_reviews
       WHERE adoption_operation_id=p_adoption) IS DISTINCT FROM p_sidecar_entity_policy THEN
   RAISE EXCEPTION 'Document adoption review identity differs' USING ERRCODE='23505';END IF;
  PERFORM survey_private.require_document_first_generation_owner(p_actor,p_document);RETURN existing;
 END IF;
 d:=survey_private.require_document_first_generation_owner(p_actor,p_document);
 IF EXISTS(SELECT 1 FROM survey_private.annotation_generation_heads WHERE document_id=p_document) THEN
  RAISE EXCEPTION 'Document already has a checked generation' USING ERRCODE='40001';END IF;
 SELECT * INTO s FROM survey_private.document_generation_sources WHERE source_id=p_source FOR SHARE NOWAIT;
 IF NOT FOUND OR s.actor_user_id IS DISTINCT FROM p_actor OR s.document_id IS DISTINCT FROM p_document
  OR s.generation_id IS NOT NULL OR s.state<>'captured' OR s.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'Legacy adoption source differs' USING ERRCODE='40001';END IF;
 proof:=survey_private.assert_document_generation_source_bytes_v2(p_actor,p_source,1::smallint);
 IF jsonb_array_length(proof->'objects') NOT BETWEEN 1 AND 2 THEN
  RAISE EXCEPTION 'Legacy adoption byte proof differs' USING ERRCODE='23514';END IF;
 used:=p_offered[1:jsonb_array_length(proof->'objects')];
 IF jsonb_array_length(proof->'objects')=1 AND p_sidecar_entity_policy<>'absent' THEN
  RAISE EXCEPTION 'PDF-only adoption cannot declare sidecar entities' USING ERRCODE='22023';END IF;
 evidence:=survey_private.document_first_generation_source_evidence(p_actor,p_source);
 objects:=evidence->'objects';provenance:=evidence->'provenance';
 entity_state:=survey_private.document_first_generation_definition_state(p_document,'entity');
 survey_state:=survey_private.document_first_generation_definition_state(p_document,'survey');
 IF jsonb_array_length(proof->'objects')=2 AND p_sidecar_entity_policy='accepted-catalog'
  AND entity_state->>'status'<>'accepted' THEN
  RAISE EXCEPTION 'Legacy sidecar entities require an accepted document entity catalog' USING ERRCODE='SG004';END IF;
 expiry:=least(s.expires_at,clock_timestamp()+interval '15 minutes');
 digest:=encode(sha256(convert_to(jsonb_build_object('version',1,'actor_user_id',p_actor,'owner_user_id',d.user_id,
  'document_id',p_document,'adoption_operation_id',p_adoption,'source_id',p_source,'candidate_operation_id',p_candidate,
  'offered_archive_operation_ids',p_offered,'used_archive_operation_ids',used,'source_sql_sha256',s.source_sql_sha256,
  'wal_head',s.wal_head::text,'objects',objects,'source_provenance',provenance,'canonical_annotations',p_canonical_annotations,
  'entity_catalog',entity_state,'survey_definition',survey_state,'expires_at',expiry)::text,'UTF8')),'hex');
 INSERT INTO survey_private.document_first_generation_adoption_reviews(adoption_operation_id,actor_user_id,owner_user_id,
  document_id,source_id,candidate_operation_id,offered_archive_operation_ids,used_archive_operation_ids,review_sha256,
  source_sql_sha256,wal_head,objects,source_provenance,canonical_annotations,entity_catalog,survey_definition,
  sidecar_entity_policy,expires_at)
 VALUES(p_adoption,p_actor,d.user_id,p_document,p_source,p_candidate,p_offered,used,digest,s.source_sql_sha256,s.wal_head,
  objects,provenance,p_canonical_annotations,entity_state,survey_state,p_sidecar_entity_policy,expiry);
 RETURN survey_private.document_first_generation_adoption_receipt(p_adoption);
END $$;

CREATE OR REPLACE FUNCTION survey_private.confirm_document_first_generation_adoption_v1(
 p_actor uuid,p_adoption uuid,p_review_sha256 text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE r survey_private.document_first_generation_adoption_reviews%ROWTYPE; fresh jsonb; evidence jsonb;
BEGIN
 SELECT * INTO r FROM survey_private.document_first_generation_adoption_reviews WHERE adoption_operation_id=p_adoption FOR SHARE NOWAIT;
 IF NOT FOUND THEN RETURN jsonb_build_object('version',1,'state','missing','actor_user_id',p_actor,'adoption_operation_id',p_adoption);END IF;
 IF r.actor_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Document adoption is not yours' USING ERRCODE='42501';END IF;
 PERFORM survey_private.require_document_first_generation_owner(p_actor,r.document_id);
 IF r.review_sha256 IS DISTINCT FROM p_review_sha256 OR r.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'Document adoption review is stale' USING ERRCODE='40001';END IF;
 -- The source was captured through the versioned model-1 wrapper. Rebuild
 -- its comparison receipt with that same semantic envelope; the v1 helper
 -- omits the model fields and would make every valid review look stale.
 fresh:=survey_private.capture_document_generation_source_v3(p_actor,r.document_id,NULL,1::smallint);
 evidence:=survey_private.document_first_generation_source_evidence(p_actor,r.source_id);
 IF fresh->>'source_sql_sha256' IS DISTINCT FROM r.source_sql_sha256
  OR evidence->'objects' IS DISTINCT FROM r.objects OR evidence->'provenance' IS DISTINCT FROM r.source_provenance
  OR survey_private.document_first_generation_definition_state(r.document_id,'entity') IS DISTINCT FROM r.entity_catalog
  OR survey_private.document_first_generation_definition_state(r.document_id,'survey') IS DISTINCT FROM r.survey_definition THEN
  RAISE EXCEPTION 'Document adoption review is stale' USING ERRCODE='40001';END IF;
 INSERT INTO survey_private.document_first_generation_adoption_confirmations VALUES(p_adoption,p_review_sha256,clock_timestamp())
 ON CONFLICT(adoption_operation_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM survey_private.document_first_generation_adoption_confirmations
  WHERE adoption_operation_id=p_adoption AND review_sha256=p_review_sha256) THEN
  RAISE EXCEPTION 'Document adoption confirmation differs' USING ERRCODE='23505';END IF;
 RETURN survey_private.document_first_generation_adoption_receipt(p_adoption);
END $$;

CREATE OR REPLACE FUNCTION survey_private.publish_document_first_generation_adoption_v1(
 p_actor uuid,p_adoption uuid,p_review_sha256 text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE r survey_private.document_first_generation_adoption_reviews%ROWTYPE; p survey_private.document_first_generation_adoption_publications%ROWTYPE;
 request_row survey_private.document_generation_replacement_requests%ROWTYPE; plan_row survey_private.document_generation_replacement_plans%ROWTYPE;
 fresh jsonb; evidence jsonb; publication jsonb; baseline bytea; candidate survey_private.document_generation_assets%ROWTYPE;
BEGIN
 SELECT * INTO r FROM survey_private.document_first_generation_adoption_reviews WHERE adoption_operation_id=p_adoption FOR SHARE NOWAIT;
 IF NOT FOUND THEN RETURN jsonb_build_object('version',1,'state','missing','actor_user_id',p_actor,'adoption_operation_id',p_adoption);END IF;
 IF r.actor_user_id IS DISTINCT FROM p_actor OR r.review_sha256 IS DISTINCT FROM p_review_sha256 THEN
  RAISE EXCEPTION 'Document adoption publication identity differs' USING ERRCODE='42501';END IF;
 PERFORM survey_private.require_document_first_generation_owner(p_actor,r.document_id);
 SELECT * INTO p FROM survey_private.document_first_generation_adoption_publications WHERE adoption_operation_id=p_adoption FOR SHARE NOWAIT;
 IF FOUND THEN RETURN survey_private.document_first_generation_adoption_receipt(p_adoption);END IF;
 IF r.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM survey_private.document_first_generation_adoption_confirmations
  WHERE adoption_operation_id=p_adoption AND review_sha256=p_review_sha256) THEN
  RAISE EXCEPTION 'Document adoption is not confirmed' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM survey_private.annotation_generation_heads WHERE document_id=r.document_id) THEN
  RAISE EXCEPTION 'Document adoption head changed' USING ERRCODE='40001';END IF;
 fresh:=survey_private.capture_document_generation_source_v3(p_actor,r.document_id,NULL,1::smallint);
 evidence:=survey_private.document_first_generation_source_evidence(p_actor,r.source_id);
 IF fresh->>'source_sql_sha256' IS DISTINCT FROM r.source_sql_sha256
  OR evidence->'objects' IS DISTINCT FROM r.objects OR evidence->'provenance' IS DISTINCT FROM r.source_provenance
  OR survey_private.document_first_generation_definition_state(r.document_id,'entity') IS DISTINCT FROM r.entity_catalog
  OR survey_private.document_first_generation_definition_state(r.document_id,'survey') IS DISTINCT FROM r.survey_definition THEN
  RAISE EXCEPTION 'Document adoption source changed' USING ERRCODE='40001';END IF;
 SELECT * INTO request_row FROM survey_private.document_generation_replacement_requests
  WHERE candidate_operation_id=r.candidate_operation_id FOR SHARE NOWAIT;
 SELECT * INTO plan_row FROM survey_private.document_generation_replacement_plans
  WHERE candidate_operation_id=r.candidate_operation_id FOR SHARE NOWAIT;
 IF NOT FOUND OR request_row.actor_user_id IS DISTINCT FROM p_actor OR request_row.document_id IS DISTINCT FROM r.document_id
  OR request_row.source_id IS DISTINCT FROM r.source_id OR request_row.expected_generation_id IS NOT NULL
  OR request_row.expected_wal_head IS DISTINCT FROM r.wal_head
  OR request_row.archive_operation_ids IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(r.used_archive_operation_ids)x)
  OR plan_row.plan->'version'<>'3'::jsonb OR plan_row.plan->'contentModelVersion'<>'2'::jsonb
  OR plan_row.plan->'aggregateAdmissionVersion'<>'1'::jsonb
  OR plan_row.plan->'source'->'generationId'<>'null'::jsonb
  OR plan_row.plan->'source'->'contentModelVersion'<>'1'::jsonb THEN
  RAISE EXCEPTION 'Prepared adoption plan differs' USING ERRCODE='23514';END IF;
 baseline:=survey_private.generation_publication_base64(plan_row.plan->>'baseline_base64');
 IF encode(sha256(baseline),'hex') IS DISTINCT FROM r.canonical_annotations->>'baseline_sha256' THEN
  RAISE EXCEPTION 'Prepared adoption baseline differs' USING ERRCODE='23514';END IF;
 -- The existing v3 publisher may ignore a verified fixed-path sidecar only
 -- under the same transaction-local archive-only context used by v4. The raw
 -- object remains in retention; no sidecar projection enters the baseline.
 IF cardinality(r.used_archive_operation_ids)=2 THEN
  PERFORM set_config('survey.legacy_sidecar_publication_v4',r.candidate_operation_id::text,true);
  IF current_setting('survey.legacy_sidecar_publication_v4',true) IS DISTINCT FROM r.candidate_operation_id::text THEN
   RAISE EXCEPTION 'Adoption archive context differs' USING ERRCODE='55000';END IF;
 END IF;
 publication:=survey_private.publish_document_generation_v3(p_actor,r.source_id,r.candidate_operation_id,
  r.used_archive_operation_ids,plan_row.plan);
 IF publication->>'previous_generation_id' IS NOT NULL OR publication->>'content_model_version'<>'2'
  OR publication->>'document_id' IS DISTINCT FROM r.document_id::text THEN
  RAISE EXCEPTION 'Document adoption publication differs' USING ERRCODE='23514';END IF;
 SELECT * INTO candidate FROM survey_private.document_generation_assets WHERE operation_id=r.candidate_operation_id FOR SHARE NOWAIT;
 IF candidate.content_sha256 IS DISTINCT FROM r.objects->0->>'content_sha256'
  OR candidate.byte_length::text IS DISTINCT FROM r.objects->0->>'byte_length' THEN
  RAISE EXCEPTION 'Adopted PDF is not byte-identical' USING ERRCODE='23514';END IF;
 INSERT INTO survey_private.document_first_generation_adoption_publications VALUES(p_adoption,(publication->>'generation_id')::uuid,clock_timestamp());
 INSERT INTO survey_private.document_generation_legacy_adoption_origins
  VALUES(r.document_id,(publication->>'generation_id')::uuid,p_adoption);
 RETURN survey_private.document_first_generation_adoption_receipt(p_adoption);
END $$;

CREATE OR REPLACE FUNCTION survey_private.read_document_first_generation_adoption_v1(p_actor uuid,p_adoption uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE r survey_private.document_first_generation_adoption_reviews%ROWTYPE;
BEGIN
 SELECT * INTO r FROM survey_private.document_first_generation_adoption_reviews WHERE adoption_operation_id=p_adoption;
 IF NOT FOUND THEN RETURN jsonb_build_object('version',1,'state','missing','actor_user_id',p_actor,'adoption_operation_id',p_adoption);END IF;
 IF r.actor_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Document adoption is not yours' USING ERRCODE='42501';END IF;
 PERFORM survey_private.require_document_first_generation_owner(p_actor,r.document_id);
 RETURN survey_private.document_first_generation_adoption_receipt(p_adoption);
END $$;

-- Carry a legacy-origin marker to each direct checked successor without an
-- ancestry scan. The first adoption inserts its own origin after publication.
CREATE OR REPLACE FUNCTION survey_private.carry_document_generation_legacy_adoption_origin()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE origin survey_private.document_generation_legacy_adoption_origins%ROWTYPE;
BEGIN
 IF NEW.previous_generation_id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO origin FROM survey_private.document_generation_legacy_adoption_origins
  WHERE document_id=NEW.document_id AND generation_id=NEW.previous_generation_id FOR SHARE;
 IF FOUND THEN INSERT INTO survey_private.document_generation_legacy_adoption_origins
  VALUES(NEW.document_id,NEW.generation_id,origin.adoption_operation_id) ON CONFLICT DO NOTHING;END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_generation_legacy_adoption_origin_carry
 AFTER INSERT ON survey_private.document_generation_publications FOR EACH ROW
 EXECUTE FUNCTION survey_private.carry_document_generation_legacy_adoption_origin();

-- The existing v4 retirement implementation only recognized its v1 sidecar
-- receipt. A model-2 first adoption has the same fixed-path risk, but records
-- a v2 origin instead. Teach both independent source readers and the head
-- fence about that origin before any successor can be prepared.
DO $adoption_origin_capture$ DECLARE definition text; old_guard text; new_guard text;
BEGIN
 old_guard:='IF d.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_legacy_sidecar_retirements r WHERE r.document_id=p_document AND r.generation_id=p_generation) THEN sidecar_path:=d.project_id::text||''/''||d.id::text||''_data.json'';END IF;';
 new_guard:='IF d.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_legacy_sidecar_retirements r WHERE r.document_id=p_document AND r.generation_id=p_generation) AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_legacy_adoption_origins o WHERE o.document_id=p_document AND o.generation_id=p_generation) THEN sidecar_path:=d.project_id::text||''/''||d.id::text||''_data.json'';END IF;';
 definition:=pg_get_functiondef('survey_private.capture_document_generation_source_v3(uuid,uuid,uuid,smallint)'::regprocedure);
 IF position(old_guard IN definition)=0 THEN RAISE EXCEPTION 'Unexpected v3 adoption source capture shape' USING ERRCODE='55000';END IF;
 EXECUTE replace(definition,old_guard,new_guard);

 old_guard:='IF d.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_legacy_sidecar_retirements retired WHERE retired.document_id=r.document_id AND retired.generation_id=r.generation_id) THEN sidecar_path:=d.project_id::text||''/''||d.id::text||''_data.json'';END IF;';
 new_guard:='IF d.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_legacy_sidecar_retirements retired WHERE retired.document_id=r.document_id AND retired.generation_id=r.generation_id) AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_legacy_adoption_origins o WHERE o.document_id=r.document_id AND o.generation_id=r.generation_id) THEN sidecar_path:=d.project_id::text||''/''||d.id::text||''_data.json'';END IF;';
 definition:=pg_get_functiondef('survey_private.check_document_generation_source_bytes_v2(uuid,uuid,smallint)'::regprocedure);
 IF position(old_guard IN definition)=0 THEN RAISE EXCEPTION 'Unexpected v2 adoption source byte shape' USING ERRCODE='55000';END IF;
 EXECUTE replace(definition,old_guard,new_guard);
END $adoption_origin_capture$;

CREATE OR REPLACE FUNCTION survey_private.guard_legacy_sidecar_retirement_head()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.generation_id IS DISTINCT FROM OLD.generation_id
  AND (EXISTS(SELECT 1 FROM survey_private.document_generation_legacy_sidecar_retirements r
    WHERE r.document_id=OLD.document_id AND r.generation_id=OLD.generation_id)
   OR EXISTS(SELECT 1 FROM survey_private.document_generation_legacy_adoption_origins o
    WHERE o.document_id=OLD.document_id AND o.generation_id=OLD.generation_id))
  AND coalesce(current_setting('survey.legacy_sidecar_publication_v4',true),'')='' THEN
  RAISE EXCEPTION 'Retired legacy sidecar requires v4 publication' USING ERRCODE='SG004';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION survey_private.document_generation_legacy_sidecar_marker(p_document uuid,p_generation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE adoption uuid; marker survey_private.document_generation_legacy_sidecar_retirements%ROWTYPE;
 asset survey_private.document_generation_assets%ROWTYPE; physical storage.objects%ROWTYPE; guard record;
BEGIN
 SELECT adoption_operation_id INTO adoption FROM survey_private.document_generation_legacy_adoption_origins
  WHERE document_id=p_document AND generation_id=p_generation FOR SHARE NOWAIT;
 IF FOUND THEN RETURN jsonb_build_object('version',2,'state','archived','origin',
  jsonb_build_object('mode','legacy','adoption_operation_id',adoption));END IF;
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

CREATE OR REPLACE FUNCTION survey_private.read_document_first_generation_source_archive_v1(
 p_actor uuid,p_document uuid,p_generation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE d public.documents%ROWTYPE; o survey_private.document_generation_legacy_adoption_origins%ROWTYPE;
 r survey_private.document_first_generation_adoption_reviews%ROWTYPE; b survey_private.document_generation_bundles%ROWTYPE;
 assets jsonb;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended(p_document::text,0)) THEN RAISE EXCEPTION 'Archive recovery contention' USING ERRCODE='40001';END IF;
 SELECT * INTO d FROM public.documents WHERE id=p_document FOR SHARE NOWAIT;
 SELECT * INTO o FROM survey_private.document_generation_legacy_adoption_origins
  WHERE document_id=p_document AND generation_id=p_generation FOR SHARE NOWAIT;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO r FROM survey_private.document_first_generation_adoption_reviews WHERE adoption_operation_id=o.adoption_operation_id FOR SHARE NOWAIT;
 IF d.user_id IS DISTINCT FROM p_actor OR r.owner_user_id IS DISTINCT FROM p_actor THEN
  RAISE EXCEPTION 'Legacy archive recovery requires the permanent owner' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM survey_private.document_generation_bundles WHERE candidate_operation_id=r.candidate_operation_id FOR SHARE NOWAIT;
 IF NOT FOUND OR b.document_id IS DISTINCT FROM p_document OR b.source_id IS DISTINCT FROM r.source_id
  OR b.archive_operation_ids IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(r.used_archive_operation_ids)x) THEN
  RAISE EXCEPTION 'Legacy archive recovery binding differs' USING ERRCODE='23514';END IF;
 SELECT jsonb_agg(jsonb_build_object('kind',a.source_object->>'kind','bucket_id','documents','path',a.path,
  'id',a.object_id,'version',a.object_version,'byte_length',a.byte_length::text,'content_sha256',a.content_sha256,
  'source_object',r.source_provenance->((x.n-1)::integer)) ORDER BY x.n) INTO assets
 FROM unnest(r.used_archive_operation_ids) WITH ORDINALITY x(operation_id,n)
 JOIN survey_private.document_generation_assets a ON a.operation_id=x.operation_id AND a.candidate_operation_id=r.candidate_operation_id
 JOIN storage.objects s ON s.bucket_id='documents' AND s.name=a.path AND s.id=a.object_id AND s.version=a.object_version
  AND s.metadata->>'size'=a.byte_length::text;
 IF jsonb_array_length(coalesce(assets,'[]'))<>cardinality(r.used_archive_operation_ids) THEN
  RAISE EXCEPTION 'Legacy archive object differs' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('version',1,'state','available','actor_user_id',p_actor,'document_id',p_document,'generation_id',p_generation,
  'adoption_operation_id',r.adoption_operation_id,'objects',assets);
END $$;

CREATE OR REPLACE FUNCTION public.create_document_first_generation_adoption_review_service_v1(
 p_actor_user_id uuid,p_document_id uuid,p_adoption_operation_id uuid,p_source_id uuid,p_candidate_operation_id uuid,
 p_archive_operation_ids uuid[],p_canonical_annotations jsonb,p_sidecar_entity_policy text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM survey_private.require_generation_source_service();
 RETURN survey_private.create_document_first_generation_adoption_review_v1(p_actor_user_id,p_document_id,
  p_adoption_operation_id,p_source_id,p_candidate_operation_id,p_archive_operation_ids,
  p_canonical_annotations,p_sidecar_entity_policy);END $$;
CREATE OR REPLACE FUNCTION public.read_document_first_generation_adoption_service_v1(p_actor_user_id uuid,p_adoption_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM survey_private.require_generation_source_service();
 RETURN survey_private.read_document_first_generation_adoption_v1(p_actor_user_id,p_adoption_operation_id);END $$;
CREATE OR REPLACE FUNCTION public.confirm_document_first_generation_adoption_service_v1(p_actor_user_id uuid,p_adoption_operation_id uuid,p_review_sha256 text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM survey_private.require_generation_source_service();
 RETURN survey_private.confirm_document_first_generation_adoption_v1(p_actor_user_id,p_adoption_operation_id,p_review_sha256);END $$;
-- PostgREST exposes only public functions. Keep the model-2 replacement
-- planner private, and expose this adoption-scoped broker instead: it derives
-- every durable ID and CAS value from the immutable reviewed receipt rather
-- than accepting browser-supplied source/candidate/archive identities.
CREATE OR REPLACE FUNCTION public.prepare_document_first_generation_adoption_service_v1(
 p_actor_user_id uuid,p_adoption_operation_id uuid,p_operation jsonb,p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE r survey_private.document_first_generation_adoption_reviews%ROWTYPE;
BEGIN
 PERFORM survey_private.require_generation_source_service();
 SELECT * INTO r FROM survey_private.document_first_generation_adoption_reviews
  WHERE adoption_operation_id=p_adoption_operation_id FOR SHARE NOWAIT;
 IF NOT FOUND OR r.actor_user_id IS DISTINCT FROM p_actor_user_id
  OR NOT EXISTS(SELECT 1 FROM survey_private.document_first_generation_adoption_confirmations c
    WHERE c.adoption_operation_id=r.adoption_operation_id AND c.review_sha256=r.review_sha256) THEN
  RAISE EXCEPTION 'Document adoption is not confirmed' USING ERRCODE='42501';END IF;
 PERFORM survey_private.require_document_first_generation_owner(p_actor_user_id,r.document_id);
 RETURN survey_private.prepare_document_generation_replacement_v3(p_actor_user_id,r.source_id,r.candidate_operation_id,
  r.used_archive_operation_ids,NULL,r.wal_head,p_operation,p_plan);
END $$;
CREATE OR REPLACE FUNCTION public.publish_document_first_generation_adoption_service_v1(p_actor_user_id uuid,p_adoption_operation_id uuid,p_review_sha256 text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM survey_private.require_generation_source_service();
 RETURN survey_private.publish_document_first_generation_adoption_v1(p_actor_user_id,p_adoption_operation_id,p_review_sha256);END $$;
CREATE OR REPLACE FUNCTION public.read_document_first_generation_source_archive_service_v1(p_actor_user_id uuid,p_document_id uuid,p_generation_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM survey_private.require_generation_source_service();
 RETURN survey_private.read_document_first_generation_source_archive_v1(p_actor_user_id,p_document_id,p_generation_id);END $$;
CREATE OR REPLACE FUNCTION public.read_document_first_generation_source_archive_v1(p_document_id uuid,p_generation_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Legacy archive recovery requires authentication' USING ERRCODE='42501';END IF;
 RETURN survey_private.read_document_first_generation_source_archive_v1(actor,p_document_id,p_generation_id);
END $$;

DO $$ DECLARE sig text;BEGIN FOREACH sig IN ARRAY ARRAY[
 'survey_private.guard_document_first_generation_adoption_rows()',
 'survey_private.guard_document_first_generation_adoption_child_rows()',
 'survey_private.require_document_first_generation_owner(uuid,uuid)',
 'survey_private.document_first_generation_definition_state(uuid,text)',
 'survey_private.document_first_generation_source_evidence(uuid,uuid)',
 'survey_private.document_first_generation_adoption_receipt(uuid)',
 'survey_private.create_document_first_generation_adoption_review_v1(uuid,uuid,uuid,uuid,uuid,uuid[],jsonb,text)',
 'survey_private.confirm_document_first_generation_adoption_v1(uuid,uuid,text)',
 'survey_private.publish_document_first_generation_adoption_v1(uuid,uuid,text)',
 'survey_private.read_document_first_generation_adoption_v1(uuid,uuid)',
 'survey_private.carry_document_generation_legacy_adoption_origin()',
 'survey_private.document_generation_legacy_sidecar_marker(uuid,uuid)',
 'survey_private.read_document_first_generation_source_archive_v1(uuid,uuid,uuid)',
 'public.create_document_first_generation_adoption_review_service_v1(uuid,uuid,uuid,uuid,uuid,uuid[],jsonb,text)',
 'public.read_document_first_generation_adoption_service_v1(uuid,uuid)',
 'public.confirm_document_first_generation_adoption_service_v1(uuid,uuid,text)',
 'public.prepare_document_first_generation_adoption_service_v1(uuid,uuid,jsonb,jsonb)',
 'public.publish_document_first_generation_adoption_service_v1(uuid,uuid,text)',
 'public.read_document_first_generation_source_archive_service_v1(uuid,uuid,uuid)'] LOOP
 EXECUTE 'ALTER FUNCTION '||sig||' OWNER TO postgres';EXECUTE 'REVOKE ALL ON FUNCTION '||sig||' FROM PUBLIC,anon,authenticated,service_role';
END LOOP;END $$;
ALTER FUNCTION public.read_document_first_generation_source_archive_v1(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.read_document_first_generation_source_archive_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_document_first_generation_source_archive_v1(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_document_first_generation_adoption_review_service_v1(uuid,uuid,uuid,uuid,uuid,uuid[],jsonb,text),
 public.read_document_first_generation_adoption_service_v1(uuid,uuid),
 public.confirm_document_first_generation_adoption_service_v1(uuid,uuid,text),
 public.prepare_document_first_generation_adoption_service_v1(uuid,uuid,jsonb,jsonb),
 public.publish_document_first_generation_adoption_service_v1(uuid,uuid,text),
 public.read_document_first_generation_source_archive_service_v1(uuid,uuid,uuid),
 -- Model-2 wrappers were deliberately kept dark until a complete publisher
 -- existed. The adoption edge handler now needs this narrow, service-gated
 -- capture/verification/staging lane; browser roles retain no direct grant.
 public.begin_document_generation_source_v2(uuid,uuid,uuid,uuid,smallint),
 public.get_document_generation_source_v2(uuid,uuid,smallint),
 public.claim_document_generation_source_bytes_v2(uuid,uuid,uuid,smallint),
 public.record_document_generation_source_bytes_v2(uuid,uuid,uuid,jsonb,smallint),
 public.read_document_generation_transform_source_v2(uuid,uuid,smallint)
 TO service_role;
GRANT EXECUTE ON FUNCTION
 public.begin_document_generation_source_archive_v2(uuid,uuid,uuid,smallint),
 public.begin_document_generation_upload_v3(uuid,uuid,text,text,bigint,smallint)
 TO authenticated;

COMMIT;
