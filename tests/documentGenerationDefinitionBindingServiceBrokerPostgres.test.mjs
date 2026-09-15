import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {withDisposablePostgres} from '../scripts/helpers/disposablePostgres.mjs';

const migration=fileURLToPath(new URL('../supabase/migrations/20260915104000_document_generation_definition_binding_service_broker.sql',import.meta.url));
const actor='10400000-0000-4000-8000-000000000001';
const documentId='10400000-0000-4000-8000-000000000002';
const sourceId='10400000-0000-4000-8000-000000000003';
const candidateId='10400000-0000-4000-8000-000000000004';
const archiveId='10400000-0000-4000-8000-000000000005';
const generationId='10400000-0000-4000-8000-000000000006';
const currentGenerationId='10400000-0000-4000-8000-000000000007';
const missingGenerationId='10400000-0000-4000-8000-000000000008';
const unknownGenerationId='10400000-0000-4000-8000-000000000009';
const nullModelGenerationId='10400000-0000-4000-8000-000000000010';
const digest='a'.repeat(64);

test('V5 generation brokers are service-only and route each exact receipt', async () => {
  await withDisposablePostgres(async ({sql,scalar,asRole,errorState,applyMigration,quote}) => {
    sql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE SCHEMA survey_private;
      CREATE FUNCTION survey_private.require_generation_source_service() RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
      BEGIN
        IF coalesce(nullif(nullif(current_setting('role',true),'none'),''),session_user) IS DISTINCT FROM 'service_role' THEN
          RAISE EXCEPTION 'Trusted generation source service required' USING ERRCODE='42501';
        END IF;
      END $$;
      CREATE FUNCTION survey_private.read_document_generation_replacement_v5(
        uuid,uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,bigint,text) RETURNS jsonb
      LANGUAGE sql AS $$ SELECT jsonb_build_object('route','read-v5','actor',$1,'document',$2,'source',$3,'candidate',$4,'archives',$5,'generation',$6,'wal',$7,'operation',$8,'revision',$9,'digest',$10) $$;
      CREATE FUNCTION survey_private.prepare_document_generation_replacement_v5(
        uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb,bigint,text) RETURNS jsonb
      LANGUAGE sql AS $$ SELECT jsonb_build_object('route','prepare-v5','actor',$1,'source',$2,'candidate',$3,'archives',$4,'generation',$5,'wal',$6,'operation',$7,'plan',$8,'revision',$9,'digest',$10) $$;
      CREATE FUNCTION survey_private.publish_document_generation_v5(
        uuid,uuid,uuid,uuid[],jsonb,bigint,text) RETURNS jsonb
      LANGUAGE sql AS $$ SELECT jsonb_build_object('route','publish-v5','actor',$1,'source',$2,'candidate',$3,'archives',$4,'plan',$5,'revision',$6,'digest',$7) $$;
      CREATE FUNCTION public.read_document_generation_transform_source_v2(uuid,uuid,smallint) RETURNS jsonb
      LANGUAGE sql AS $$ SELECT jsonb_build_object('route','transform-v2','actor',$1,'source',$2,'model',$3) $$;
      CREATE FUNCTION survey_private.check_document_generation_source_bytes_v2(uuid,uuid,smallint) RETURNS jsonb
      LANGUAGE sql AS $$ SELECT jsonb_build_object('route','source-bytes-v2','actor',$1,'source',$2,'model',$3,
        'state','unverified','verified_at',NULL,'objects','[]'::jsonb) $$;
      CREATE TABLE public.generation_authorized_actors(actor_user_id uuid,document_id uuid,
        PRIMARY KEY(actor_user_id,document_id));
      CREATE FUNCTION survey_private.assert_document_generation_upload_authority(uuid,uuid) RETURNS void
      LANGUAGE plpgsql AS $$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM public.generation_authorized_actors
          WHERE actor_user_id=$1 AND document_id=$2) THEN
          RAISE EXCEPTION 'Generation upload is not permitted' USING ERRCODE='42501';
        END IF;
      END $$;
      CREATE TABLE survey_private.document_generation_replacement_requests(
        candidate_operation_id uuid PRIMARY KEY,actor_user_id uuid NOT NULL,document_id uuid NOT NULL,
        source_id uuid NOT NULL,expected_generation_id uuid NOT NULL);
      CREATE TABLE survey_private.annotation_generations(
        document_id uuid NOT NULL,generation_id uuid NOT NULL,content_model_version smallint,
        PRIMARY KEY(document_id,generation_id));
      INSERT INTO public.generation_authorized_actors VALUES('${actor}','${documentId}');
      INSERT INTO survey_private.annotation_generations VALUES
        ('${documentId}','${generationId}',1),('${documentId}','${currentGenerationId}',2),
        ('${documentId}','${unknownGenerationId}',3),('${documentId}','${nullModelGenerationId}',NULL);
      INSERT INTO survey_private.document_generation_replacement_requests VALUES
        ('${candidateId}','${actor}','${documentId}','${sourceId}','${generationId}');`);
    applyMigration(migration);
    const signatures=[
      'public.read_document_generation_replacement_service_v5(uuid,uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,bigint,text)',
      'public.prepare_document_generation_replacement_service_v5(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb,bigint,text)',
      'public.publish_document_generation_service_v5(uuid,uuid,uuid,uuid[],jsonb,bigint,text)',
      'public.read_document_generation_transform_source_service_v2(uuid,uuid,smallint)',
      'public.get_document_generation_source_bytes_service_v2(uuid,uuid,smallint)',
      'public.resolve_document_generation_replacement_source_model_service_v1(uuid,uuid,uuid,uuid,uuid)',
    ];
    for (const signature of signatures) {
      assert.equal(scalar(`SELECT has_function_privilege('service_role',${quote(signature)},'EXECUTE')`),'t');
      assert.equal(scalar(`SELECT has_function_privilege('anon',${quote(signature)},'EXECUTE')`),'f');
      assert.equal(scalar(`SELECT has_function_privilege('authenticated',${quote(signature)},'EXECUTE')`),'f');
    }
    for (const signature of [
      'survey_private.read_document_generation_replacement_v5(uuid,uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,bigint,text)',
      'survey_private.prepare_document_generation_replacement_v5(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb,bigint,text)',
      'survey_private.publish_document_generation_v5(uuid,uuid,uuid,uuid[],jsonb,bigint,text)',
      'survey_private.check_document_generation_source_bytes_v2(uuid,uuid,smallint)',
      'survey_private.resolve_document_generation_replacement_source_model_v1(uuid,uuid,uuid,uuid,uuid)',
    ]) assert.equal(scalar(`SELECT has_function_privilege('service_role',${quote(signature)},'EXECUTE')`),'f');
    const read=`SELECT public.read_document_generation_replacement_service_v5('${actor}','${documentId}','${sourceId}','${candidateId}',ARRAY['${archiveId}']::uuid[],'${generationId}',7,'{"op":"read"}',2,'${digest}')`;
    const denied=asRole(actor,read,'authenticated',false);
    assert.match(denied.stderr,/permission denied|Trusted generation source service required/);
    const receipt=JSON.parse(asRole(null,read,'service_role').stdout);
    assert.deepEqual(receipt,{route:'read-v5',actor,document:documentId,source:sourceId,candidate:candidateId,archives:[archiveId],generation:generationId,wal:7,operation:{op:'read'},revision:2,digest});
    const prepared=JSON.parse(asRole(null,`SELECT public.prepare_document_generation_replacement_service_v5('${actor}','${sourceId}','${candidateId}',ARRAY['${archiveId}']::uuid[],'${generationId}',7,'{"op":"prepare"}','{"plan":"exact"}',2,'${digest}')`,'service_role').stdout);
    assert.equal(prepared.route,'prepare-v5'); assert.deepEqual(prepared.plan,{plan:'exact'});
    const published=JSON.parse(asRole(null,`SELECT public.publish_document_generation_service_v5('${actor}','${sourceId}','${candidateId}',ARRAY['${archiveId}']::uuid[],'{"plan":"exact"}',2,'${digest}')`,'service_role').stdout);
    assert.equal(published.route,'publish-v5'); assert.equal(published.digest,digest);
    const transform=JSON.parse(asRole(null,`SELECT public.read_document_generation_transform_source_service_v2('${actor}','${sourceId}',2::smallint)`,'service_role').stdout);
    assert.deepEqual(transform,{route:'transform-v2',actor,source:sourceId,model:2});
    const sourceBytes=JSON.parse(asRole(null,`SELECT public.get_document_generation_source_bytes_service_v2('${actor}','${sourceId}',2::smallint)`,'service_role').stdout);
    assert.deepEqual(sourceBytes,{route:'source-bytes-v2',actor,source:sourceId,model:2,
      state:'unverified',verified_at:null,objects:[]});
    const resolve=`SELECT public.resolve_document_generation_replacement_source_model_service_v1(
      '${actor}','${documentId}','${sourceId}','${candidateId}','${generationId}')`;
    assert.equal(asRole(null,resolve,'service_role').stdout,'1',
      'a retained old source generation resolves after a newer generation exists');
    errorState(asRole(null,`SELECT public.resolve_document_generation_replacement_source_model_service_v1(
      '${actor}','${documentId}','${archiveId}','${candidateId}','${generationId}')`,'service_role',false),'23505');
    errorState(asRole(null,`SELECT public.resolve_document_generation_replacement_source_model_service_v1(
      '${archiveId}','${documentId}','${sourceId}','${candidateId}','${generationId}')`,'service_role',false),'42501');
    errorState(asRole(null,`SELECT public.resolve_document_generation_replacement_source_model_service_v1(
      '${actor}','${documentId}','${sourceId}','${candidateId}','${missingGenerationId}')`,'service_role',false),'23505');
    errorState(asRole(null,`SELECT public.resolve_document_generation_replacement_source_model_service_v1(
      '${actor}','${documentId}','${sourceId}','${missingGenerationId}','${missingGenerationId}')`,'service_role',false),'SG002');
    errorState(asRole(null,`SELECT public.resolve_document_generation_replacement_source_model_service_v1(
      '${actor}','${documentId}','${sourceId}','${missingGenerationId}','${unknownGenerationId}')`,'service_role',false),'SG003');
    errorState(asRole(null,`SELECT public.resolve_document_generation_replacement_source_model_service_v1(
      '${actor}','${documentId}','${sourceId}','${missingGenerationId}','${nullModelGenerationId}')`,'service_role',false),'SG003');
  });
});
