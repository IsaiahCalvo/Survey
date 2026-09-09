import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source=readFileSync(new URL('../supabase/migrations/20260909080000_document_generation_upload_staging.sql',import.meta.url),'utf8');
const sql=source.replace(/--[^\n]*/g,'');
const script=fileURLToPath(new URL('../scripts/test-document-generation-upload-staging-postgres.mjs',import.meta.url));
test('generation upload staging stays private and adds no document pointer capability',()=>{
  assert.match(sql,/^\s*BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
  assert.match(sql,/REVOKE ALL ON survey_private.document_generation_uploads FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(sql,/capture_document_publication_sources\(p_document_id\)/);
  assert.match(sql,/INSERT INTO survey_private.document_generation_storage_references/);
  assert.match(sql,/interval '2 hours'/);assert.match(sql,/byte_length',u.byte_length::text/);
  assert.doesNotMatch(sql,/UPDATE public.documents|REFERENCES auth.users|ALTER FUNCTION public.enforce_documents_file_path_immutable/);
});
test('final Storage admission and verified receipts enforce authority, exact identity and fenced claims',()=>{
  assert.match(sql,/AS RESTRICTIVE FOR INSERT TO anon,authenticated/);
  assert.match(sql,/NEW.version IS DISTINCT FROM OLD.version/);
  assert.match(sql,/assert_document_generation_upload_authority\(u.actor_user_id,u.document_id,u.owner_user_id\)/);
  assert.match(sql,/rolsuper OR rolbypassrls/);assert.doesNotMatch(sql,/auth.role\(\)/);
  assert.match(sql,/verification_claim_id IS DISTINCT FROM p_claim_id/);
  assert.match(sql,/interval '120 seconds'/);assert.match(sql,/FOR UPDATE SKIP LOCKED/);
  assert.match(sql,/retirement_xid=pg_current_xact_id\(\)/);
});
test('staging harness uses safe local PostgreSQL and actual preceding guard/capture migrations',()=>{
  const text=readFileSync(script,'utf8');assert.match(text,/withDisposablePostgres/);assert.match(text,/assert.equal\(process.argv.length,2/);
  assert.match(text,/20260909070000_document_generation_storage_references.sql/);
  assert.match(text,/20260909072000_document_publication_source_capture.sql/);
  assert.doesNotMatch(text,/DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|npm install|brew install/);
});
test('negative full-stream verification is durable, service-only, and cannot accept incomplete size',()=>{
  assert.match(sql,/state IN \('reserved','verified','rejected','canceled'\)/);
  assert.match(sql,/FUNCTION public.reject_document_generation_upload_verification/);
  assert.match(sql,/p_content_sha256=u.content_sha256[\s\S]*?p_byte_length IS DISTINCT FROM u.byte_length/);
  assert.match(sql,/state='rejected',rejected_at=clock_timestamp\(\)/);
  assert.match(sql,/'reason',u.rejection_reason,'observed_sha256',u.observed_sha256/);
  assert.match(sql,/u.state IN \('verified','rejected'\) THEN RETURN/);
});
test('actual PostgreSQL staging reserves, fences uploads, verifies exact claims and cancels safely',{
  skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL',
},()=>{
  const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message||''}`);
  assert.match(result.stdout,/Document generation upload staging PostgreSQL checks passed:/);
  assert.match(result.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
