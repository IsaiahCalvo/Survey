import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const source=readFileSync(new URL('../supabase/migrations/20260909115000_annotation_generation_aggregate_publication.sql',import.meta.url),'utf8');
const script=fileURLToPath(new URL('../scripts/test-annotation-generation-aggregate-publication-postgres.mjs',import.meta.url));

test('aggregate publication uses a private versioned plan and binds its fence atomically',()=>{
  assert.match(source,/document_generation_replacement_request_sha256_v3/);
  assert.match(source,/read_document_generation_replacement_v3/);
  assert.match(source,/prepare_document_generation_replacement_v3/);
  assert.match(source,/publish_document_generation_v3/);
  assert.match(source,/aggregateAdmissionVersion/);
  assert.match(source,/pg_try_advisory_xact_lock\(hashtextextended\(doc::text,0\)\)/);
  assert.match(source,/enable_annotation_generation_aggregate_write_fence_v1/);
  assert.match(source,/FROM PUBLIC,anon,authenticated,service_role/);
  assert.doesNotMatch(source,/GRANT EXECUTE/);
});

test('actual isolated PostgreSQL proves aggregate publication intent, rollback, retry, and visibility',{
  skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL',
},()=>{
  const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:300000,maxBuffer:8*1024*1024});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message||''}`);
  assert.match(result.stdout,/Annotation aggregate publication PostgreSQL checks passed: 11/);
  assert.match(result.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
