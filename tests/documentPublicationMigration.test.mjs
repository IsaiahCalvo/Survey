import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const identity=new URL('../supabase/migrations/20260908200000_document_identity_tombstones.sql',import.meta.url);
const authorization=new URL('../supabase/migrations/20260908201000_document_publication_authorization.sql',import.meta.url);
const script=fileURLToPath(new URL('../scripts/test-document-publication-postgres.mjs',import.meta.url));

test('identity migration retires opaque IDs on every delete without lifecycle cascade or client grants',()=>{
  const sql=readFileSync(identity,'utf8').replace(/--[^\n]*/g,'');
  assert.match(sql,/^\s*BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
  assert.match(sql,/BEFORE INSERT OR DELETE OR UPDATE OF id ON public\.documents/);
  assert.match(sql,/pg_try_advisory_xact_lock/);assert.match(sql,/ON CONFLICT \(document_id\) DO UPDATE/);
  assert.match(sql,/deleted = g\.deleted OR EXCLUDED\.deleted/);
  assert.match(sql,/DOCUMENT_ID_RETIRED/);assert.match(sql,/DOCUMENT_ID_IMMUTABLE/);
  assert.doesNotMatch(sql,/REFERENCES|auth\.role\(|request\.jwt\.claim\.role/);
  assert.match(sql,/REVOKE ALL ON survey_private\.document_identity_guards FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql,/REVOKE TRUNCATE ON (?:TABLE )?public\.documents FROM PUBLIC,\s*anon,\s*authenticated,\s*service_role/);
});

test('publication guard checks writes at SQL boundary while preserving existing RLS policies',()=>{
  const sql=readFileSync(authorization,'utf8').replace(/--[^\n]*/g,'');
  assert.match(sql,/^\s*BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
  assert.match(sql,/BEFORE INSERT OR UPDATE OF user_id,project_id,file_path ON public\.documents/);
  assert.match(sql,/r\.rolsuper OR r\.rolbypassrls/);assert.doesNotMatch(sql,/auth\.role\(|request\.jwt\.claim\.role/);
  assert.match(sql,/FOR SHARE NOWAIT/g);assert.match(sql,/NEW\.project_id IS NULL THEN RETURN NEW/);
  assert.doesNotMatch(sql,/(?:CREATE|DROP|ALTER)\s+POLICY|DELETE FROM|TRUNCATE/i);
});

test('publication fixture uses installed isolated PostgreSQL and actual tracked guards/helpers',()=>{
  const source=readFileSync(script,'utf8');
  for(const name of ['20260908200000_document_identity_tombstones.sql','20260908201000_document_publication_authorization.sql',
    '20260802000000_kal426_user_archive_foundation.sql','20260701120000_project_template_sharing.sql',
    '20260908160000_document_quota_guard.sql','20260513003000_allow_collaborators_to_read_document_storage.sql'])assert.ok(source.includes(name),name);
  assert.match(source,/process\.getuid\?\.\(\)===0/);assert.match(source,/filter\(\(\[key\]\)=>!\/\^PG\/i\.test\(key\)\)/);
  assert.match(source,/listen_addresses=''/);assert.match(source,/\['-X','-h',socket,'-p',port,'-U','postgres','-d','postgres'/);
  assert.match(source,/owned local server stopped before cleanup/);assert.match(source,/rmSync\(temp,\{recursive:true,force:true\}\)/);
  assert.doesNotMatch(source,/SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|npm install|brew install/);
});

test('document publication passes actual PostgreSQL authorization, delete/retry and concurrency cases',{
  skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL verification',
},()=>{
  const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:120_000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message||''}`);
  assert.match(result.stdout,/Document publication PostgreSQL checks passed:/);
  assert.match(result.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
