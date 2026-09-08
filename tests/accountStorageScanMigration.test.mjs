import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const migration=new URL('../supabase/migrations/20260909000000_account_storage_cleanup_scan.sql',import.meta.url);
const script=fileURLToPath(new URL('../scripts/test-account-storage-scan-postgres.mjs',import.meta.url));
const migrationSql=()=>readFileSync(migration,'utf8').replace(/--[^\n]*/g,'');

test('account scan bounds each raw source before checking references and preserves cleanup sources',()=>{
  const sql=migrationSql();
  assert.equal((sql.match(/WITH raw_page AS MATERIALIZED/g)||[]).length,2);
  assert.equal((sql.match(/LIMIT p_limit/g)||[]).length,2);
  assert.equal((sql.match(/d\.file_path=r\.path COLLATE "default"/g)||[]).length,2);
  assert.match(sql,/\(\(left\(path,36\) COLLATE "C"\),path_hash\)/);
  assert.match(sql,/WHERE substr\(path,37,1\)='\/'/);
  assert.match(sql,/cursor_row\.storage_cycle_done AND cursor_row\.queue_cycle_done/);
  assert.match(sql,/IF NOT remaining THEN\s+paths := ARRAY\[\]::text\[\];\s+finished_cycle := true/);
  assert.doesNotMatch(sql,/(?:DELETE FROM|UPDATE|INSERT INTO) (?:public\.documents|storage\.objects|survey_private\.document_storage_cleanup)\b/);
  assert.doesNotMatch(sql,/CREATE INDEX[^;]*ON storage\.objects|retire_document_storage_paths|ack_document_storage_cleanup/);
});

test('account scan needs trusted SQL role, committed closure receipt and durable cursor update',()=>{
  const sql=migrationSql();
  assert.match(sql,/r\.rolsuper OR r\.rolbypassrls/);assert.doesNotMatch(sql,/auth\.role\(|request\.jwt\.claim\.role/);
  assert.match(sql,/transaction_isolation'\)<>'read committed'/);assert.match(sql,/ERRCODE='25001'/);
  assert.match(sql,/p_limit NOT BETWEEN 1 AND 100/);
  assert.match(sql,/LOCK TABLE survey_private\.account_write_guards IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(sql,/VALUES\(NEW\.user_id,pg_catalog\.pg_current_xact_id\(\)\)/);
  assert.match(sql,/cursor_row\.closing_xid=pg_catalog\.pg_current_xact_id\(\)/);
  assert.match(sql,/WHERE user_id=target_user_id FOR UPDATE/);
  assert.match(sql,/IF NOT FOUND THEN RAISE EXCEPTION 'Account cleanup claim did not persist' USING ERRCODE='40001'/);
  assert.ok(sql.indexOf('UPDATE survey_private.account_storage_cleanup_scans')<sql.indexOf("RETURN jsonb_build_object('paths'"));
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.claim_account_storage_cleanup\(uuid,integer\) TO service_role/);
  assert.match(sql,/REVOKE ALL ON survey_private\.account_storage_cleanup_scans FROM PUBLIC,anon,authenticated,service_role/);
});

test('account scan fixture uses installed isolated PostgreSQL and real prior guards without provider I/O',()=>{
  const source=readFileSync(script,'utf8');
  for(const name of ['20260908160000_document_quota_guard.sql','20260908200000_document_identity_tombstones.sql','20260908201000_document_publication_authorization.sql','20260908220000_document_storage_retirement.sql','20260908230000_account_storage_closing.sql','20260909000000_account_storage_cleanup_scan.sql'])assert.ok(source.includes(name),name);
  assert.match(source,/process\.getuid\?\.\(\)===0/);assert.match(source,/filter\(\(\[key\]\)=>!\/\^PG\/i\.test\(key\)\)/);
  assert.match(source,/listen_addresses=''/);assert.match(source,/\['-X','-h',socket,'-p',port,'-U','postgres','-d','postgres'/);
  assert.match(source,/owned local server stopped before cleanup/);assert.match(source,/rmSync\(temp,\{recursive:true,force:true\}\)/);
  assert.match(source,/EXPLAIN \(ANALYZE,BUFFERS,FORMAT JSON\)/);assert.match(source,/idx_documents_file_path/);
  assert.match(source,/provider index prerequisite/);assert.match(source,/generate_series\(1,100000\)/);
  assert.doesNotMatch(source,/SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|npm install|brew install/);
});

test('actual PostgreSQL account scan advances bounded durable pages without losing pending keys',{
  skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL verification',
},()=>{
  const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:120_000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message||''}`);
  assert.match(result.stdout,/Account storage scan PostgreSQL checks passed: 20/);
  assert.match(result.stdout,/PLAN references: Index Only Scan idx_documents_file_path/);
  assert.match(result.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
