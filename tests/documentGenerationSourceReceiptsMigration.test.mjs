import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const source=readFileSync(new URL('../supabase/migrations/20260909092000_document_generation_source_receipts.sql',import.meta.url),'utf8');
const script=fileURLToPath(new URL('../scripts/test-document-generation-source-receipts-postgres.mjs',import.meta.url));
test('pre-transform receipts are private service-only metadata and never publication',()=>{
  assert.match(source,/source_byte_state','unverified'/);assert.match(source,/FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(source,/generation_id IS DISTINCT FROM p_generation_id/);assert.match(source,/interval '2 hours'/);
  assert.match(source,/connector_history/);assert.match(source,/source_sql_sha256/);assert.match(source,/body_sha256/);
  assert.doesNotMatch(source,/UPDATE public.documents|INSERT INTO survey_private.annotation_generation_heads|GRANT EXECUTE[^;]*TO authenticated/);
});
test('source body lifecycle and semantic connector fences remain bounded',()=>{
  assert.match(source,/LIMIT p_limit FOR UPDATE SKIP LOCKED/);assert.match(source,/body_id=NULL/);assert.match(source,/67108864/);
  assert.match(source,/generation_source_connector_projection\(TG_TABLE_NAME,before_row\)/);
  assert.match(source,/x->>'user_id'=r.actor_user_id::text/);assert.match(source,/scope','sql-metadata-only'/);
  assert.match(source,/greatest\(expires_at,next_expiry_attempt_at\)<=cutoff/);
  assert.match(source,/next_expiry_attempt_at=clock_timestamp\(\)\+interval '30 seconds'/);
});
test('actual PostgreSQL source capture preserves private state, scopes receipts and bounds cleanup',{
  skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL',
},()=>{
  const r=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});assert.equal(r.status,0,`${r.stdout}\n${r.stderr}\n${r.error?.message||''}`);
  assert.match(r.stdout,/Document generation source receipt PostgreSQL checks passed:/);assert.match(r.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
