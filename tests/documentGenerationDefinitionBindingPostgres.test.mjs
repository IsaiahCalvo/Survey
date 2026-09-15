import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { withDisposablePostgres } from '../scripts/helpers/disposablePostgres.mjs';

const migration = fileURLToPath(new URL(
  '../supabase/migrations/20260915103000_document_generation_definition_binding.sql', import.meta.url));
const source = readFileSync(migration, 'utf8');

test('V5 generation publication binds the immutable accepted definition head', () => {
  assert.match(source, /^BEGIN;/m);
  assert.match(source, /COMMIT;\s*$/);
  assert.match(source, /document_generation_replacement_definition_bindings/);
  assert.match(source, /candidate_operation_id uuid PRIMARY KEY/);
  assert.match(source, /FOREIGN KEY \(document_id, definition_revision, definition_digest\)/);
  assert.match(source, /REFERENCES survey_private\.document_definition_revisions/);
  assert.match(source, /document_generation_replacement_definition_binding_document_idx/);
  assert.match(source, /Replacement definition binding is immutable/);
  assert.match(source, /assert_document_generation_definition_head_v5/);
  assert.match(source, /document_definition_revision_heads[\s\S]*FOR SHARE NOWAIT/);
  assert.match(source, /Document definition head is stale[\s\S]*ERRCODE='40001'/);
});

test('V5 wrappers retain V4 authorization and reject tuple drift before publish', () => {
  for (const name of [
    'read_document_generation_replacement_v5',
    'prepare_document_generation_replacement_v5',
    'publish_document_generation_v5',
  ]) assert.match(source, new RegExp(`CREATE OR REPLACE FUNCTION survey_private\\.${name}\\(`));
  assert.match(source, /read_document_generation_replacement_v5\(\n\s*p_actor uuid,p_document uuid,p_source uuid/);
  assert.match(source, /assert_document_generation_upload_authority\(p_actor,p_document\)/,
    'cold V5 reads authorize their bound document before definition preflight');
  assert.match(source, /base:=survey_private\.read_document_generation_replacement_v4/,
    'completed replay first goes through V4 actor/source authorization');
  assert.match(source, /V5 replacement binding differs[\s\S]*ERRCODE='23505'/);
  assert.match(source, /V5 replacement retry identity differs[\s\S]*ERRCODE='23505'/);
  assert.match(source, /V5 publication binding differs[\s\S]*ERRCODE='23505'/);
  const publishStart = source.indexOf('CREATE OR REPLACE FUNCTION survey_private.publish_document_generation_v5');
  const publish = source.slice(publishStart, source.indexOf('\nDO $$', publishStart));
  const headCheck = publish.lastIndexOf('assert_document_generation_definition_head_v5');
  const v4Publish = publish.lastIndexOf('publish_document_generation_v4');
  assert.ok(headCheck >= 0 && headCheck < v4Publish,
    'a stale definition head rejects before V4 can publish a new generation');
  assert.match(source, /'definition_revision',binding\.definition_revision::text/);
  assert.match(source, /'definition_digest',binding\.definition_digest/);
  assert.match(source, /base->'publication'[\s\S]*\|\|jsonb_build_object\('version',5/,
    'a V4 nested publication is upgraded to the V5 tuple for handler replay validation');
  assert.match(source, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC,anon,authenticated,service_role/);
});

test('migration applies and its real head assertion rejects a stale tuple', async () => {
  await withDisposablePostgres(async ({ sql, scalar, applyMigration }) => {
    const documentId = '10300000-0000-4000-8000-000000000001';
    const candidateId = '10300000-0000-4000-8000-000000000002';
    const digest = 'a'.repeat(64);
    sql(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN; CREATE SCHEMA survey_private;
      CREATE TABLE public.documents(id uuid PRIMARY KEY);
      CREATE TABLE survey_private.document_generation_replacement_requests(
        candidate_operation_id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE);
      CREATE TABLE survey_private.document_generation_publications(
        operation_id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES public.documents(id),
        generation_id uuid NOT NULL);
      CREATE TABLE survey_private.document_definition_revisions(
        document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE, definition_revision bigint NOT NULL,
        definition_digest text NOT NULL, PRIMARY KEY(document_id,definition_revision),
        UNIQUE(document_id,definition_revision,definition_digest));
      CREATE TABLE survey_private.document_definition_revision_heads(
        document_id uuid PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE, current_revision bigint NOT NULL,
        current_digest text NOT NULL,
        FOREIGN KEY(document_id,current_revision,current_digest)
          REFERENCES survey_private.document_definition_revisions(document_id,definition_revision,definition_digest));
      CREATE FUNCTION survey_private.reject_document_generation_replacement_truncate()
      RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'no truncate'; END $$;
      INSERT INTO public.documents VALUES('${documentId}');
      INSERT INTO survey_private.document_definition_revisions VALUES('${documentId}',1,'${digest}');
      INSERT INTO survey_private.document_definition_revision_heads VALUES('${documentId}',1,'${digest}');
    `);
    applyMigration(migration);
    assert.equal(sql(`SELECT survey_private.assert_document_generation_definition_head_v5(
      '${documentId}',1,'${digest}')`).status, 0);
    const stale = sql(`SELECT survey_private.assert_document_generation_definition_head_v5(
      '${documentId}',2,'${digest}')`, false);
    assert.match(stale.stderr, /Document definition head is stale/);
    assert.match(stale.stderr, /40001/);
    sql(`INSERT INTO survey_private.document_generation_replacement_requests VALUES('${candidateId}','${documentId}');
      INSERT INTO survey_private.document_generation_replacement_definition_bindings
        VALUES('${candidateId}','${documentId}',1,'${digest}')`);
    sql(`CREATE TABLE public.binding_delete_probe(id bigint PRIMARY KEY);
      CREATE FUNCTION public.try_nested_binding_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        DELETE FROM survey_private.document_generation_replacement_definition_bindings
          WHERE candidate_operation_id='${candidateId}';
        RETURN OLD;
      END $$;
      CREATE TRIGGER binding_delete_probe_trigger BEFORE DELETE ON public.binding_delete_probe
        FOR EACH ROW EXECUTE FUNCTION public.try_nested_binding_delete();
      INSERT INTO public.binding_delete_probe VALUES(1)`);
    const nestedDelete = sql(`DELETE FROM public.binding_delete_probe WHERE id=1`, false);
    assert.match(nestedDelete.stderr, /Replacement definition binding is immutable/,
      'a nested application trigger cannot use cascade-only cleanup authority');
    const directDelete = sql(`DELETE FROM survey_private.document_generation_replacement_definition_bindings
      WHERE candidate_operation_id='${candidateId}'`, false);
    assert.match(directDelete.stderr, /Replacement definition binding is immutable/);
    assert.equal(sql(`DELETE FROM public.documents WHERE id='${documentId}'`).status, 0,
      'the document FK cascade may remove its retained binding');
  });
});
