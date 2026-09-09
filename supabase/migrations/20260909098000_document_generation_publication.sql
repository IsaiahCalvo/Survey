-- Internal SQL publication only. No client/service entry point or activation.
-- The caller must be the trusted complete-source transformer: SQL can check
-- exact bindings and atomic writes, not the meaning of opaque Yjs/PDF bytes.
-- Sources with sidecars remain unsupported until immutable transformed-sidecar
-- binding and download/read adoption are complete. Existing committed-object
-- quota guards still apply; retention policy and provider-byte reconciliation
-- need separate proof.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS survey_private.document_generation_publications (
 operation_id uuid PRIMARY KEY REFERENCES survey_private.document_generation_bundles(candidate_operation_id),
 document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL, owner_user_id uuid NOT NULL, source_id uuid NOT NULL,
 generation_id uuid NOT NULL UNIQUE, previous_generation_id uuid,
 archive_operation_ids uuid[] NOT NULL, plan_sha256 text NOT NULL CHECK(plan_sha256 ~ '^[0-9a-f]{64}$'),
 wal_head bigint NOT NULL CHECK(wal_head>=0), published_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS generation_publications_document_idx ON survey_private.document_generation_publications(document_id);
-- These rows never survive a successful publisher call. There is intentionally
-- no independently callable issuer. A ticket is not a publication receipt.
CREATE TABLE IF NOT EXISTS survey_private.generation_publication_context (
 transaction_id xid8 NOT NULL, operation_id uuid NOT NULL, document_id uuid NOT NULL,
 actor_user_id uuid NOT NULL, owner_user_id uuid NOT NULL,
 expected_generation_id uuid, target_generation_id uuid NOT NULL,
 PRIMARY KEY(transaction_id,document_id), UNIQUE(transaction_id,operation_id)
);
CREATE TABLE IF NOT EXISTS survey_private.generation_publication_tickets (
 transaction_id xid8 NOT NULL, operation_id uuid NOT NULL, relation_id oid NOT NULL,
 row_id uuid NOT NULL, action text NOT NULL CHECK(action IN('INSERT','UPDATE','DELETE')),
 old_row jsonb, new_row jsonb,
 PRIMARY KEY(transaction_id,operation_id,relation_id,row_id),
 FOREIGN KEY(transaction_id,operation_id) REFERENCES survey_private.generation_publication_context(transaction_id,operation_id),
 CHECK((action='INSERT' AND old_row IS NULL AND new_row IS NOT NULL)
    OR (action='DELETE' AND old_row IS NOT NULL AND new_row IS NULL)
    OR (action='UPDATE' AND old_row IS NOT NULL AND new_row IS NOT NULL))
);
ALTER TABLE survey_private.document_generation_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_private.generation_publication_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_private.generation_publication_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_private.document_generation_publications OWNER TO postgres;
ALTER TABLE survey_private.generation_publication_context OWNER TO postgres;
ALTER TABLE survey_private.generation_publication_tickets OWNER TO postgres;
REVOKE ALL ON survey_private.document_generation_publications,survey_private.generation_publication_context,
 survey_private.generation_publication_tickets FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS generation_publication_immutable ON survey_private.document_generation_publications;
CREATE TRIGGER generation_publication_immutable BEFORE UPDATE OR DELETE ON survey_private.document_generation_publications
 FOR EACH ROW EXECUTE FUNCTION survey_private.guard_retained_generation_rows();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['document_generation_publications','generation_publication_context','generation_publication_tickets'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS generation_publication_no_truncate ON survey_private.%I',t);
  EXECUTE format('CREATE TRIGGER generation_publication_no_truncate BEFORE TRUNCATE ON survey_private.%I FOR EACH STATEMENT EXECUTE FUNCTION survey_private.reject_retained_generation_truncate()',t);
 END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION survey_private.consume_generation_publication_row(p_document uuid,p_relation oid,p_action text,p_old jsonb,p_new jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET bytea_output='hex' AS $$
DECLARE c survey_private.generation_publication_context%ROWTYPE; row_key uuid; current_generation uuid;
BEGIN
 SELECT * INTO c FROM survey_private.generation_publication_context
  WHERE transaction_id=pg_current_xact_id() AND document_id=p_document;
 IF NOT FOUND THEN RETURN false;END IF;
 IF p_relation NOT IN('public.document_annotations'::regclass::oid,'public.doc_yjs_state'::regclass::oid,'public.survey_items'::regclass::oid)
  OR p_action NOT IN('INSERT','UPDATE','DELETE') THEN RAISE EXCEPTION 'Publication row lane is not permitted' USING ERRCODE='42501';END IF;
 -- Only the private publisher creates this context, after checking authority
 -- and holding document/project/account locks until transaction end. Repeating
 -- that whole authorization query per row adds no concurrency protection.
 SELECT generation_id INTO current_generation FROM survey_private.annotation_generation_heads WHERE document_id=p_document;
 IF current_generation IS DISTINCT FROM c.expected_generation_id THEN RAISE EXCEPTION 'Publication generation changed' USING ERRCODE='40001';END IF;
 row_key:=coalesce(p_new,p_old)->>CASE WHEN p_relation='public.doc_yjs_state'::regclass::oid THEN 'document_id' ELSE 'id' END;
 DELETE FROM survey_private.generation_publication_tickets
  WHERE transaction_id=c.transaction_id AND operation_id=c.operation_id AND relation_id=p_relation AND row_id=row_key
   AND action=p_action AND old_row IS NOT DISTINCT FROM p_old AND new_row IS NOT DISTINCT FROM p_new;
 IF NOT FOUND THEN RAISE EXCEPTION 'Exact publication row permission is missing' USING ERRCODE='42501';END IF;
 RETURN true;
END; $$;

-- Keep all existing parent locks and exact FK-cascade exceptions. A context
-- also gates first adoption, rather than permitting extra writes while legacy.
DO $$ DECLARE definition text; needle text; replacement text; BEGIN
 definition:=pg_get_functiondef('survey_private.guard_legacy_annotation_generation()'::regprocedure);
 IF position('consume_generation_publication_row' IN definition)=0 THEN
  needle:='IF EXISTS(SELECT 1 FROM survey_private.annotation_generation_heads h WHERE h.document_id=doc) THEN';
  replacement:='IF survey_private.consume_generation_publication_row(doc,TG_RELID,TG_OP,old_row,new_row) THEN CONTINUE;END IF;'||E'\n    '||needle;
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected generation fence definition';END IF;
  EXECUTE replace(definition,needle,replacement);
 END IF;
END; $$;
ALTER FUNCTION survey_private.guard_legacy_annotation_generation() SET TimeZone='UTC';
ALTER FUNCTION survey_private.guard_legacy_annotation_generation() SET bytea_output='hex';

CREATE OR REPLACE FUNCTION survey_private.generation_publication_base64(p_value text)
RETURNS bytea LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE b bytea;
BEGIN
 IF p_value IS NULL OR length(p_value)=0 OR length(p_value)>22369624
  OR p_value !~ '^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' THEN
  RAISE EXCEPTION 'Invalid publication bytes' USING ERRCODE='22023';END IF;
 b:=decode(p_value,'base64');
 IF replace(encode(b,'base64'),E'\n','')<>p_value THEN RAISE EXCEPTION 'Noncanonical publication bytes' USING ERRCODE='22023';END IF;
 RETURN b;
END; $$;

CREATE OR REPLACE FUNCTION survey_private.publish_document_generation(p_actor uuid,p_source uuid,p_candidate uuid,p_archives uuid[],p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET bytea_output='hex' SET lock_timeout='2s' AS $$
DECLARE r survey_private.document_generation_publications%ROWTYPE; frozen jsonb; semantic jsonb; fresh jsonb; bundle jsonb;
 projection jsonb; source_plan jsonb; desired_doc jsonb; actual_doc jsonb; receipt jsonb; digest text; archives uuid[];
 doc uuid; owner_id uuid; expected_generation uuid; target_generation uuid; frontier bigint; actual_generation uuid; actual_frontier bigint;
 baseline bytea; legacy_state bytea; legacy_vector bytea; legacy_floor bigint; expected_legacy_floor bigint;
 candidate survey_private.document_generation_assets%ROWTYPE; relation text; relation_oid oid; pk text;
 old_rows jsonb; new_rows jsonb; input_rows jsonb; temporary_rows jsonb; expected_sets jsonb:='{}'; actual_rows jsonb;
 columns_sql text; update_sql text; where_sql text; document_updates text; changed_count bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Publication requires READ COMMITTED' USING ERRCODE='25001';END IF;
 IF p_actor IS NULL OR p_source IS NULL OR p_candidate IS NULL OR p_archives IS NULL OR array_ndims(p_archives) IS DISTINCT FROM 1
  OR cardinality(p_archives) NOT BETWEEN 1 AND 10000 OR array_position(p_archives,NULL) IS NOT NULL OR p_candidate=ANY(p_archives)
  OR (SELECT count(DISTINCT x) FROM unnest(p_archives) x)<>cardinality(p_archives)
  OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object' OR octet_length(p_plan::text)>67108864 THEN
  RAISE EXCEPTION 'Invalid publication request' USING ERRCODE='22023';END IF;
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_plan) k) IS DISTINCT FROM
  ARRAY['baseline_base64','legacy','operation','operationId','projection','source','version']::text[]
  OR p_plan->'version' IS DISTINCT FROM '1'::jsonb OR p_plan->>'operationId' IS DISTINCT FROM p_candidate::text THEN
  RAISE EXCEPTION 'Invalid publication plan' USING ERRCODE='22023';END IF;
 digest:=encode(sha256(convert_to(p_plan::text,'UTF8')),'hex');
 SELECT array_agg(x ORDER BY x) INTO archives FROM unnest(p_archives) x;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('survey:generation-upload:'||p_candidate::text,0)) THEN
  RAISE EXCEPTION 'Publication operation contention' USING ERRCODE='55P03';END IF;
 SELECT * INTO r FROM survey_private.document_generation_publications WHERE operation_id=p_candidate FOR SHARE NOWAIT;
 IF FOUND THEN
  IF r.actor_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Publication is not yours' USING ERRCODE='42501';END IF;
  IF r.source_id IS DISTINCT FROM p_source OR r.archive_operation_ids IS DISTINCT FROM archives OR r.plan_sha256 IS DISTINCT FROM digest THEN
   RAISE EXCEPTION 'Publication retry identity differs' USING ERRCODE='23505';END IF;
  PERFORM survey_private.assert_document_generation_upload_authority(p_actor,r.document_id,r.owner_user_id);
  RETURN (to_jsonb(r)-'owner_user_id'-'archive_operation_ids')||jsonb_build_object('version',1,'wal_head',r.wal_head::text);
 END IF;
 frozen:=public.read_document_generation_transform_source(p_actor,p_source);
 semantic:=frozen->'payload'->'semantic'; doc:=(frozen->>'document_id')::uuid;
 owner_id:=(semantic->'document'->>'user_id')::uuid;expected_generation:=(frozen->>'generation_id')::uuid;frontier:=(frozen->>'wal_head')::bigint;
 PERFORM survey_private.assert_document_generation_upload_authority(p_actor,doc,owner_id);
 -- Reserve the lock needed by row timestamp triggers and the final PDF pointer
 -- before taking any child tuple locks. All reverse edges use NOWAIT/TRY.
 PERFORM id FROM public.documents WHERE id=doc FOR NO KEY UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Publication document is unavailable' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM survey_private.generation_publication_context WHERE transaction_id=pg_current_xact_id() AND document_id=doc) THEN
  RAISE EXCEPTION 'Publication is already in progress' USING ERRCODE='55000';END IF;
 source_plan:=p_plan->'source'; projection:=p_plan->'projection'; desired_doc:=projection->'document';
 IF source_plan IS DISTINCT FROM jsonb_build_object('documentId',doc,'generationId',expected_generation,'walHead',frontier::text,'sourceObject',semantic->'source_object')
  OR jsonb_typeof(projection) IS DISTINCT FROM 'object'
  OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(projection) k) IS DISTINCT FROM
   ARRAY['document','documentAnnotations','legacyYjs','modern','sidecars','surveyItems','surveySessions']::text[]
  OR jsonb_typeof(p_plan->'operation') IS DISTINCT FROM 'object'
  OR coalesce(p_plan->'operation'->>'type','') NOT IN('move','reorder','insert','delete','rotate','copy','duplicate')
  OR jsonb_typeof(projection->'modern') IS DISTINCT FROM 'object'
  OR projection->'modern'->'version' IS DISTINCT FROM '1'::jsonb
  OR jsonb_typeof(projection->'legacyYjs') IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Publication source or projection differs' USING ERRCODE='23514';END IF;
 IF semantic->'sidecar_objects' IS DISTINCT FROM '[]'::jsonb OR projection->'sidecars' IS DISTINCT FROM '[]'::jsonb THEN
  RAISE EXCEPTION 'Publication of transformed sidecars is not supported' USING ERRCODE='0A000';END IF;
 IF semantic->'document'->'annotations' IS DISTINCT FROM '{}'::jsonb OR desired_doc->'annotations' IS DISTINCT FROM '{}'::jsonb
  OR (desired_doc-'page_count'-'pagecount'-'current_page') IS DISTINCT FROM ((semantic->'document')-'page_count'-'pagecount'-'current_page') THEN
  RAISE EXCEPTION 'Publication document fields differ' USING ERRCODE='23514';END IF;
 IF jsonb_typeof(projection->'surveySessions') IS DISTINCT FROM 'array'
  OR (SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'),'[]') FROM jsonb_array_elements(projection->'surveySessions') x)
   IS DISTINCT FROM semantic->'sources'->'survey_sessions' THEN
  RAISE EXCEPTION 'Publication must preserve every survey session' USING ERRCODE='23514';END IF;
 baseline:=survey_private.generation_publication_base64(p_plan->>'baseline_base64');
 legacy_state:=survey_private.generation_publication_base64(p_plan->'legacy'->>'state_base64');
 legacy_vector:=survey_private.generation_publication_base64(p_plan->'legacy'->>'state_vector_base64');
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_plan->'legacy') k) IS DISTINCT FROM
   ARRAY['documentId','encodingVersion','state_base64','state_vector_base64','throughSeq']::text[]
  OR p_plan->'legacy'->>'documentId' IS DISTINCT FROM doc::text OR p_plan->'legacy'->'encodingVersion' IS DISTINCT FROM '1'::jsonb
  OR coalesce(p_plan->'legacy'->>'throughSeq','') !~ '^(0|[1-9][0-9]*)$'
  OR octet_length(baseline)::bigint+octet_length(legacy_state)+octet_length(legacy_vector)>16777216 THEN
  RAISE EXCEPTION 'Publication legacy checkpoint differs' USING ERRCODE='23514';END IF;
 legacy_floor:=(p_plan->'legacy'->>'throughSeq')::bigint;
 SELECT greatest(coalesce((semantic->'sources'->'doc_yjs_state'->>'through_seq')::bigint,0),
  coalesce((SELECT max((x->>'seq')::bigint) FROM jsonb_array_elements(semantic->'sources'->'doc_yjs_updates') x),0)) INTO expected_legacy_floor;
 IF legacy_floor IS DISTINCT FROM expected_legacy_floor THEN RAISE EXCEPTION 'Publication legacy coverage differs' USING ERRCODE='23514';END IF;
 bundle:=survey_private.retain_document_generation_bundle(p_actor,p_source,p_candidate,archives);
 SELECT * INTO candidate FROM survey_private.document_generation_assets WHERE operation_id=p_candidate AND candidate_operation_id=p_candidate FOR SHARE NOWAIT;
 IF NOT FOUND OR candidate.document_id IS DISTINCT FROM doc OR candidate.purpose<>'candidate-pdf' THEN
  RAISE EXCEPTION 'Publication candidate differs' USING ERRCODE='23514';END IF;
 target_generation:=candidate.generation_id;
 IF target_generation IS NOT DISTINCT FROM expected_generation OR bundle->>'source_id' IS DISTINCT FROM p_source::text
  OR bundle->>'actor_user_id' IS DISTINCT FROM p_actor::text OR bundle->>'source_generation_id' IS DISTINCT FROM expected_generation::text THEN
  RAISE EXCEPTION 'Publication retained binding differs' USING ERRCODE='23514';END IF;
 -- Retention receipt replay intentionally skips this compare; publication must
 -- independently compare even when the asset bundle was already retained.
 fresh:=survey_private.capture_document_generation_source(p_actor,doc,expected_generation);
 IF fresh->>'source_sql_sha256' IS DISTINCT FROM frozen->>'source_sql_sha256'
  OR fresh->'payload'->'semantic' IS DISTINCT FROM semantic THEN RAISE EXCEPTION 'Publication source changed' USING ERRCODE='40001';END IF;
 INSERT INTO survey_private.generation_publication_context VALUES(pg_current_xact_id(),p_candidate,doc,p_actor,owner_id,expected_generation,target_generation);
 FOREACH relation IN ARRAY ARRAY['document_annotations','doc_yjs_state','survey_items'] LOOP
  relation_oid:=('public.'||relation)::regclass::oid;pk:=CASE WHEN relation='doc_yjs_state' THEN 'document_id' ELSE 'id' END;
  where_sql:=CASE WHEN relation='survey_items' THEN 't.session_id IN(SELECT id FROM public.survey_sessions WHERE document_id=$1)' ELSE 't.document_id=$1' END;
  EXECUTE format('WITH locked AS MATERIALIZED(SELECT t.* FROM public.%I t WHERE %s ORDER BY t.%I FOR UPDATE NOWAIT)
   SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.%I),''[]'') FROM locked t',relation,where_sql,pk,pk) INTO old_rows USING doc;
  IF relation='document_annotations' THEN input_rows:=projection->'documentAnnotations';
  ELSIF relation='survey_items' THEN input_rows:=projection->'surveyItems';
  ELSE input_rows:=jsonb_build_array(jsonb_build_object('document_id',doc,'state','\x'||encode(legacy_state,'hex'),
    'state_vector','\x'||encode(legacy_vector,'hex'),'through_seq',legacy_floor,'encoding_version',1,'updated_at',transaction_timestamp()));END IF;
  IF jsonb_typeof(input_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(input_rows)>20000
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(input_rows) x WHERE jsonb_typeof(x)<>'object') THEN
   RAISE EXCEPTION 'Invalid publication row set' USING ERRCODE='22023';END IF;
  -- Round-trip through the real composite type. Do not ignore missing/extra
  -- columns; all SQL source rows and copies carry a complete typed image.
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.%I),''[]'') FROM jsonb_populate_recordset(NULL::public.%I,$1) t',pk,relation)
   INTO new_rows USING input_rows;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(input_rows) x WHERE
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(x) k) IS DISTINCT FROM
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(coalesce(new_rows->0,'{}')) k))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(new_rows) x WHERE x->>pk IS NULL)
   OR (SELECT count(DISTINCT x->>pk) FROM jsonb_array_elements(new_rows) x)<>jsonb_array_length(new_rows) THEN
   RAISE EXCEPTION 'Publication row identity or columns differ' USING ERRCODE='23514';END IF;
  IF relation='survey_items' THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(new_rows) x WHERE NOT EXISTS(SELECT 1 FROM public.survey_sessions s WHERE s.id=(x->>'session_id')::uuid AND s.document_id=doc))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(old_rows) o JOIN jsonb_array_elements(new_rows) n ON o->>pk=n->>pk WHERE o->'session_id' IS DISTINCT FROM n->'session_id') THEN
    RAISE EXCEPTION 'Publication survey binding differs' USING ERRCODE='23514';END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(new_rows) x WHERE x->>'document_id' IS DISTINCT FROM doc::text) THEN
    RAISE EXCEPTION 'Publication document binding differs' USING ERRCODE='23514';END IF;
   IF relation='document_annotations' AND (
    EXISTS(SELECT 1 FROM jsonb_array_elements(old_rows) o JOIN jsonb_array_elements(new_rows) n ON o->>pk=n->>pk WHERE o->'user_id' IS DISTINCT FROM n->'user_id')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(new_rows) n WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old_rows) o WHERE o->'user_id'=n->'user_id'))) THEN
    RAISE EXCEPTION 'Publication annotation author differs' USING ERRCODE='23514';END IF;
  END IF;
  IF relation IN('document_annotations','survey_items') THEN
   SELECT coalesce(jsonb_agg(CASE WHEN o IS NOT NULL AND o IS DISTINCT FROM n THEN n||jsonb_build_object('updated_at',transaction_timestamp()) ELSE n END ORDER BY n->>pk),'[]')
    INTO new_rows FROM jsonb_array_elements(new_rows) n LEFT JOIN jsonb_array_elements(old_rows) o ON o->>pk=n->>pk;
   -- Immediate unique constraints cannot swap two surviving annotation keys in
   -- one UPDATE. Move only the rekeyed rows through private temporary keys;
   -- never delete/reinsert their PKs (survey_sync_log retains item FK history).
   SELECT coalesce(jsonb_agg(o||jsonb_build_object('annotation_id','__survey_publication__:'||p_candidate::text||':'||(o->>'id'),
     'updated_at',transaction_timestamp()) ORDER BY o->>'id'),'[]') INTO temporary_rows
    FROM jsonb_array_elements(old_rows) o JOIN jsonb_array_elements(new_rows) n ON o->>'id'=n->>'id'
    WHERE o->'annotation_id' IS DISTINCT FROM n->'annotation_id';
   IF temporary_rows<>'[]'::jsonb THEN
    -- Refuse even a deliberately prechosen temporary-key collision, including
    -- final target keys and rows scheduled for deletion. No guessed overwrite.
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(temporary_rows) t JOIN
      jsonb_array_elements(old_rows||new_rows) x ON x->'annotation_id'=t->'annotation_id'
      AND (relation='document_annotations' OR x->'session_id'=t->'session_id')) THEN
     RAISE EXCEPTION 'Publication temporary key collides' USING ERRCODE='23505';END IF;
    INSERT INTO survey_private.generation_publication_tickets(transaction_id,operation_id,relation_id,row_id,action,old_row,new_row)
     SELECT pg_current_xact_id(),p_candidate,relation_oid,(o->>'id')::uuid,'UPDATE',o,t
      FROM jsonb_array_elements(old_rows) o JOIN jsonb_array_elements(temporary_rows) t ON o->>'id'=t->>'id';
    EXECUTE format('UPDATE public.%I t SET annotation_id=n.annotation_id,updated_at=n.updated_at FROM jsonb_populate_recordset(NULL::public.%I,$2) n WHERE %s AND t.id=n.id',relation,relation,where_sql)
     USING doc,temporary_rows;
    IF EXISTS(SELECT 1 FROM survey_private.generation_publication_tickets WHERE transaction_id=pg_current_xact_id()
      AND operation_id=p_candidate AND relation_id=relation_oid) THEN
     RAISE EXCEPTION 'Publication temporary row writes are incomplete' USING ERRCODE='23514';END IF;
    SELECT jsonb_agg(coalesce(t,o) ORDER BY o->>'id') INTO old_rows
     FROM jsonb_array_elements(old_rows) o LEFT JOIN jsonb_array_elements(temporary_rows) t ON o->>'id'=t->>'id';
   END IF;
  END IF;
  expected_sets:=expected_sets||jsonb_build_object(relation,new_rows);
  INSERT INTO survey_private.generation_publication_tickets(transaction_id,operation_id,relation_id,row_id,action,old_row,new_row)
   SELECT pg_current_xact_id(),p_candidate,relation_oid,coalesce(n->>pk,o->>pk)::uuid,
    CASE WHEN o IS NULL THEN 'INSERT' WHEN n IS NULL THEN 'DELETE' ELSE 'UPDATE' END,o,n
   FROM jsonb_array_elements(old_rows) o FULL JOIN jsonb_array_elements(new_rows) n ON o->>pk=n->>pk WHERE o IS DISTINCT FROM n;
  -- Explicit statement types: an attempted ON CONFLICT insert must not consume
  -- a permission for a row that was never inserted.
  EXECUTE format('DELETE FROM public.%I t WHERE %s AND NOT EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::public.%I,$2) n WHERE n.%I=t.%I)',relation,where_sql,relation,pk,pk) USING doc,new_rows;
  SELECT string_agg(format('%I',a.attname),',' ORDER BY a.attnum),
   string_agg(format('%1$I=n.%1$I',a.attname),',' ORDER BY a.attnum) FILTER(WHERE a.attname<>pk)
   INTO columns_sql,update_sql FROM pg_attribute a WHERE a.attrelid=relation_oid AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='';
  EXECUTE format('UPDATE public.%I t SET %s FROM jsonb_populate_recordset(NULL::public.%I,$2) n WHERE %s AND t.%I=n.%I AND to_jsonb(t) IS DISTINCT FROM to_jsonb(n)',relation,update_sql,relation,where_sql,pk,pk) USING doc,new_rows;
  EXECUTE format('INSERT INTO public.%I(%s) SELECT %s FROM jsonb_populate_recordset(NULL::public.%I,$1) n WHERE NOT EXISTS(SELECT 1 FROM public.%I t WHERE t.%I=n.%I)',relation,columns_sql,columns_sql,relation,relation,pk,pk) USING new_rows;
 END LOOP;
 IF EXISTS(SELECT 1 FROM survey_private.generation_publication_tickets WHERE transaction_id=pg_current_xact_id() AND operation_id=p_candidate) THEN
  RAISE EXCEPTION 'Publication row writes are incomplete' USING ERRCODE='23514';END IF;
 INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version)
  VALUES(doc,target_generation,frontier,baseline,1);
 -- Only known page fields present in the tracked composite type are updated.
 -- Every other document field was checked unchanged above; owner/project and
 -- annotation JSON are never assigned through this path.
 document_updates:='file_path=$2,file_size=$3';
 FOR relation IN SELECT a.attname FROM pg_attribute a WHERE a.attrelid='public.documents'::regclass AND a.attnum>0 AND NOT a.attisdropped
   AND a.attname IN('page_count','pagecount','current_page') ORDER BY a.attname LOOP
  document_updates:=document_updates||format(',%1$I=(jsonb_populate_record(NULL::public.documents,$4)).%1$I',relation);
 END LOOP;
 EXECUTE 'UPDATE public.documents SET '||document_updates||' WHERE id=$1' USING doc,candidate.path,candidate.byte_length,desired_doc;
 GET DIAGNOSTICS changed_count=ROW_COUNT;
 IF changed_count<>1 THEN RAISE EXCEPTION 'Publication document write failed' USING ERRCODE='40001';END IF;
 PERFORM survey_private.assert_document_generation_upload_authority(p_actor,doc,owner_id);
 SELECT generation_id,last_seq INTO actual_generation,actual_frontier FROM survey_private.annotation_generation_heads WHERE document_id=doc;
 IF actual_generation IS DISTINCT FROM expected_generation OR (expected_generation IS NOT NULL AND actual_frontier IS DISTINCT FROM frontier) THEN
  RAISE EXCEPTION 'Publication head changed' USING ERRCODE='40001';END IF;
 IF expected_generation IS NULL THEN
  INSERT INTO survey_private.annotation_generation_heads(document_id,generation_id,last_seq) VALUES(doc,target_generation,frontier);
 ELSE
  UPDATE survey_private.annotation_generation_heads SET generation_id=target_generation,last_seq=frontier
   WHERE document_id=doc AND generation_id=expected_generation AND last_seq=frontier;
  GET DIAGNOSTICS changed_count=ROW_COUNT;
  IF changed_count<>1 THEN RAISE EXCEPTION 'Publication head compare failed' USING ERRCODE='40001';END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM survey_private.annotation_generation_heads WHERE document_id=doc AND generation_id=target_generation AND last_seq=frontier)
  OR NOT EXISTS(SELECT 1 FROM survey_private.annotation_generations WHERE document_id=doc AND generation_id=target_generation
   AND base_seq=frontier AND baseline_snapshot=baseline AND baseline_encoding_version=1)
  OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=doc AND user_id=owner_id AND file_path=candidate.path AND file_size=candidate.byte_length) THEN
  RAISE EXCEPTION 'Publication final binding differs' USING ERRCODE='23514';END IF;
 PERFORM survey_private.document_generation_active_pdf(doc,target_generation,owner_id);
 SELECT to_jsonb(d)||jsonb_build_object('file_size',d.file_size::text) INTO actual_doc FROM public.documents d WHERE id=doc;
 -- The tracked annotation AFTER STATEMENT trigger may change only this
 -- document stamp. All supplied page metadata and every other document field
 -- must still match; a later trigger cannot silently rewrite the projection.
 IF (actual_doc-'file_path'-'file_size'-'annotations_changed_at') IS DISTINCT FROM
   (desired_doc-'file_path'-'file_size'-'annotations_changed_at') THEN
  RAISE EXCEPTION 'Publication final document fields differ' USING ERRCODE='23514';END IF;
 FOREACH relation IN ARRAY ARRAY['document_annotations','doc_yjs_state','survey_items'] LOOP
  pk:=CASE WHEN relation='doc_yjs_state' THEN 'document_id' ELSE 'id' END;
  where_sql:=CASE WHEN relation='survey_items' THEN 't.session_id IN(SELECT id FROM public.survey_sessions WHERE document_id=$1)' ELSE 't.document_id=$1' END;
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.%I),''[]'') FROM public.%I t WHERE %s',pk,relation,where_sql) INTO actual_rows USING doc;
  IF actual_rows IS DISTINCT FROM expected_sets->relation THEN RAISE EXCEPTION 'Publication final row set differs' USING ERRCODE='23514';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') INTO actual_rows FROM public.survey_sessions s WHERE s.document_id=doc;
 IF actual_rows IS DISTINCT FROM semantic->'sources'->'survey_sessions' THEN RAISE EXCEPTION 'Publication survey sessions changed' USING ERRCODE='40001';END IF;
 -- A copy can expand a valid source past the combined source/history row or
 -- byte cap. Prove the real next generation remains capturable, including its
 -- new baseline and every unchanged legacy/history lane, before success. This
 -- is a checked read, not a new receipt or a claim about opaque Yjs semantics.
 PERFORM survey_private.capture_document_generation_source(p_actor,doc,target_generation);
 DELETE FROM survey_private.generation_publication_context WHERE transaction_id=pg_current_xact_id() AND operation_id=p_candidate;
 INSERT INTO survey_private.document_generation_publications(operation_id,document_id,actor_user_id,owner_user_id,source_id,generation_id,
  previous_generation_id,archive_operation_ids,plan_sha256,wal_head)
  VALUES(p_candidate,doc,p_actor,owner_id,p_source,target_generation,expected_generation,archives,digest,frontier) RETURNING * INTO r;
 RETURN (to_jsonb(r)-'owner_user_id'-'archive_operation_ids')||jsonb_build_object('version',1,'wal_head',r.wal_head::text);
END; $$;

DO $$ DECLARE signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'survey_private.consume_generation_publication_row(uuid,oid,text,jsonb,jsonb)',
  'survey_private.generation_publication_base64(text)',
  'survey_private.publish_document_generation(uuid,uuid,uuid,uuid[],jsonb)'] LOOP
  EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC,anon,authenticated,service_role';
 END LOOP;
END; $$;
COMMENT ON FUNCTION survey_private.publish_document_generation(uuid,uuid,uuid,uuid[],jsonb) IS
 'Internal trusted-transform transaction only. No service/client grant. Sidecars unsupported. Existing object quota guards apply. Does not activate browser downloads/readers or settle retention policy and provider-byte reconciliation.';
COMMIT;
