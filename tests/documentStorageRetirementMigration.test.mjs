import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const migration=new URL('../supabase/migrations/20260908220000_document_storage_retirement.sql',import.meta.url);
const script=fileURLToPath(new URL('../scripts/test-document-storage-retirement-postgres.mjs',import.meta.url));

test('storage retirement uses a prior transaction fence for every final metadata write and keeps provider I/O separate',()=>{
  const sql=readFileSync(migration,'utf8').replace(/--[^\n]*/g,'');
  assert.match(sql,/^\s*BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
  assert.match(sql,/retirement_xid xid8/);assert.match(sql,/retirement_transaction=pg_catalog\.pg_current_xact_id\(\)/);
  assert.match(sql,/DOCUMENT_STORAGE_RETIREMENT_NOT_COMMITTED/);assert.match(sql,/DOCUMENT_STORAGE_PATH_NOT_RETIRED/);
  assert.match(sql,/BEFORE INSERT OR UPDATE OR DELETE ON storage\.objects/);
  assert.match(sql,/BEFORE INSERT OR DELETE OR UPDATE OF file_path ON public\.documents/);
  assert.match(sql,/AFTER DELETE OR UPDATE OF file_path ON public\.documents/);
  assert.match(sql,/pg_try_advisory_xact_lock/);assert.match(sql,/ON CONFLICT\(path_hash\) DO UPDATE SET revision=g\.revision\+1/);
  assert.doesNotMatch(sql,/(?:DELETE FROM|UPDATE|INSERT INTO)\s+storage\.objects|net\.http|REFERENCES/i);
});

test('retirement RPC callers are SQL-role scoped and cleanup queues have bounded reads',()=>{
  const sql=readFileSync(migration,'utf8').replace(/--[^\n]*/g,'');
  assert.match(sql,/r\.rolsuper OR r\.rolbypassrls/);assert.doesNotMatch(sql,/auth\.role\(|request\.jwt\.claim\.role/);
  assert.match(sql,/pg_has_role\(caller_name,'authenticated','MEMBER'\)/);
  assert.match(sql,/cardinality\(p_paths\)>100/);assert.match(sql,/p_limit NOT BETWEEN 1 AND 100/);
  assert.match(sql,/REVOKE TRUNCATE ON public\.documents,storage\.objects FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.list_document_storage_cleanup\(integer\) TO service_role/);
  assert.match(sql,/REVOKE ALL ON survey_private\.document_storage_path_guards,survey_private\.document_storage_cleanup/);
  assert.match(sql,/next_attempt_at<=clock_timestamp\(\)/);assert.match(sql,/FOR UPDATE OF c SKIP LOCKED/);
  assert.match(sql,/next_attempt_at=clock_timestamp\(\)\+interval '1 minute'/);
  assert.match(sql,/CREATE OR REPLACE TRIGGER a_document_storage_retirement_guard/);
  assert.doesNotMatch(sql,/DROP TRIGGER[^;]*ON storage\.objects/);
  assert.match(sql,/has_table_privilege\(role_name,'storage\.objects','TRUNCATE'\)/);
});

test('storage retirement fixture isolates installed PostgreSQL and marks the simulated provider boundary',()=>{
  const source=readFileSync(script,'utf8');
  assert.match(source,/process\.getuid\?\.\(\)===0/);assert.match(source,/filter\(\(\[key\]\)=>!\/\^PG\/i\.test\(key\)\)/);
  assert.match(source,/listen_addresses=''/);assert.match(source,/\['-X','-h',socket,'-p',port,'-U','postgres','-d','postgres'/);
  assert.match(source,/owned local server stopped before cleanup/);assert.match(source,/rmSync\(temp,\{recursive:true,force:true\}\)/);
  assert.match(source,/Explicit provider stub/);assert.match(source,/20260907213935_storage_lookup_and_function_hardening\.sql/);
  assert.doesNotMatch(source,/SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|npm install|brew install/);
});

test('actual PostgreSQL storage retirement preserves references and rejects stale publish/delete races',{
  skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL verification',
},()=>{
  const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:120_000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message||''}`);
  assert.match(result.stdout,/Document storage retirement PostgreSQL checks passed:/);
  assert.match(result.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
