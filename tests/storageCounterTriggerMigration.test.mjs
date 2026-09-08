import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script=fileURLToPath(new URL('../scripts/test-storage-counter-triggers-postgres.mjs',import.meta.url));
const migration=new URL('../supabase/migrations/20260908170000_remove_duplicate_storage_counter_trigger.sql',import.meta.url);

test('duplicate counter migration only drops the guarded combined trigger, without changing data or function behavior',()=>{
  const sql=readFileSync(migration,'utf8').replace(/--[^\n]*/g,'');
  assert.match(sql,/BEGIN;/);
  assert.match(sql,/COMMIT;/);
  assert.match(sql,/pg_catalog\.md5\(p\.prosrc\)/);
  assert.match(sql,/update_storage_on_insert/);
  assert.match(sql,/update_storage_on_delete/);
  assert.match(sql,/t\.tgnargs\s*=\s*0/);
  assert.match(sql,/t\.tgqual\s+IS\s+NULL/i);
  assert.match(sql,/t\.tgenabled\s*=\s*'O'/);
  assert.match(sql,/t\.tgfoid\s*=\s*'public\.update_user_storage\(\)'::regprocedure/);
  const dropped=sql.match(/DROP\s+TRIGGER[^;]+;/gi)||[];
  assert.equal(dropped.length,1);
  assert.match(dropped[0],/^DROP TRIGGER trigger_update_storage_on_document_change ON public\.documents;/i);
  assert.doesNotMatch(sql,/(?:INSERT\s+INTO|UPDATE\s+(?:public\.)?user_subscriptions|DELETE\s+FROM|TRUNCATE|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|ALTER\s+FUNCTION|(?:CREATE|ALTER|DROP)\s+POLICY)/i);
  assert.doesNotMatch(sql,/DISABLE\s+ROW\s+LEVEL\s+SECURITY|DROP\s+TABLE|storage\.objects/i);
});

test('counter regression test uses installed non-root local PostgreSQL with isolated UNIX socket and no inherited connection settings',()=>{
  const source=readFileSync(script,'utf8');
  assert.match(source,/process\.getuid\?\.\(\) === 0/);
  assert.match(source,/filter\(\(\[key\]\) => !\/\^PG\/i\.test\(key\)\)/);
  assert.match(source,/listen_addresses=''/);
  assert.match(source,/\['-X', '-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres'/);
  assert.match(source,/for\(let pass=0;pass<2;pass\+\+\)/);
  assert.match(source,/functionSnapshot\(\),functionsBefore/);
  assert.match(source,/subscriptionSnapshot\(\),subscriptionsBefore/);
  assert.match(source,/pg_stat_user_functions/);
  assert.match(source,/function body drift/);
  assert.match(source,/missing dedicated INSERT/);
  assert.match(source,/dedicated WHEN clause/);
  assert.match(source,/exact temporary cluster removed/);
  assert.doesNotMatch(source,/SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|npx|npm install|brew install/);
});

test('counter trigger migration passes local PostgreSQL duplicate-write, permissions, rollback, and drift checks',{
  skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1' && 'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL verification',
},()=>{
  const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:90_000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message||''}`);
  assert.match(result.stdout,/Storage counter PostgreSQL checks passed:/);
  assert.match(result.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
