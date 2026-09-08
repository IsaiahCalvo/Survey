import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const migration=new URL('../supabase/migrations/20260908230000_account_storage_closing.sql',import.meta.url);
const script=fileURLToPath(new URL('../scripts/test-account-storage-closing-postgres.mjs',import.meta.url));

test('account closing shares healthy admission and persists a permanent fence before core deletion',()=>{
  const sql=readFileSync(migration,'utf8').replace(/--[^\n]*/g,'');
  assert.match(sql,/^\s*BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS survey_private\.account_write_guards/);
  assert.doesNotMatch(sql,/REFERENCES|DELETE FROM auth\.|(?:DELETE FROM|UPDATE) storage\.objects/);
  const admission=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION survey_private.assert_account_open'),sql.indexOf('CREATE OR REPLACE FUNCTION survey_private.guard_account_core_publication'));
  assert.match(admission,/ON CONFLICT\(user_id\) DO NOTHING/);assert.match(admission,/WHERE user_id=p_user_id FOR SHARE/);
  assert.match(admission,/IF NOT FOUND THEN RAISE EXCEPTION[^;]*ERRCODE='40001'/);assert.doesNotMatch(admission,/DO UPDATE|FOR KEY SHARE/);
  assert.ok(sql.indexOf('SET closing=true')<sql.indexOf('DELETE FROM public.documents'));
  assert.match(sql,/transaction_isolation'\)<>'read committed'/);assert.match(sql,/ERRCODE='25001'/);
});

test('account closure protects foreign children and guards final storage metadata writes without trusting JWT roles',()=>{
  const sql=readFileSync(migration,'utf8').replace(/--[^\n]*/g,'');
  assert.match(sql,/r\.rolsuper OR r\.rolbypassrls/);assert.doesNotMatch(sql,/auth\.role\(|request\.jwt\.claim\.role/);
  assert.match(sql,/FOR UPDATE OF d NOWAIT/);assert.match(sql,/UPDATE public\.documents d SET project_id=NULL/);
  assert.match(sql,/d\.user_id IS DISTINCT FROM target_user_id/);
  assert.match(sql,/split_part\(NEW\.name,'\/',1\)::uuid/);
  assert.match(sql,/CREATE OR REPLACE TRIGGER a_account_storage_publication BEFORE INSERT OR UPDATE ON storage\.objects/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.delete_account_owned_rows\(uuid\) TO service_role/);
  assert.match(sql,/REVOKE ALL ON survey_private\.account_write_guards FROM PUBLIC,anon,authenticated,service_role/);
});

test('account closing fixture uses installed isolated PostgreSQL and the earlier tracked guards',()=>{
  const source=readFileSync(script,'utf8');
  for(const name of ['20260908160000_document_quota_guard.sql','20260908200000_document_identity_tombstones.sql','20260908201000_document_publication_authorization.sql','20260908220000_document_storage_retirement.sql','20260908230000_account_storage_closing.sql'])assert.ok(source.includes(name),name);
  assert.match(source,/process\.getuid\?\.\(\)===0/);assert.match(source,/filter\(\(\[key\]\)=>!\/\^PG\/i\.test\(key\)\)/);
  assert.match(source,/listen_addresses=''/);assert.match(source,/\['-X','-h',socket,'-p',port,'-U','postgres','-d','postgres'/);
  assert.match(source,/owned local server stopped before cleanup/);assert.match(source,/rmSync\(temp,\{recursive:true,force:true\}\)/);
  assert.match(source,/Synthetic ample entitlement/);assert.doesNotMatch(source,/SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|npm install|brew install/);
});

test('actual PostgreSQL closure fences late writes while preserving shared documents and cleanup',{
  skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL verification',
},()=>{
  const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:120_000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message||''}`);
  assert.match(result.stdout,/Account storage closing PostgreSQL checks passed:/);
  assert.match(result.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
