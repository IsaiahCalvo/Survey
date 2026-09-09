import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source=readFileSync(new URL('../supabase/migrations/20260909090000_annotation_generation_transport.sql',import.meta.url),'utf8');
const script=fileURLToPath(new URL('../scripts/test-annotation-generation-transport-postgres.mjs',import.meta.url));
test('generation transport stays private, explicit and has no publication API',()=>{
  assert.match(source,/BEGIN;/);assert.match(source,/COMMIT;\s*$/);
  for(const table of ['annotation_generations','annotation_generation_heads','annotation_generation_updates','annotation_generation_snapshots']) assert.match(source,new RegExp(`CREATE TABLE IF NOT EXISTS survey_private.${table}`));
  assert.match(source,/FROM PUBLIC,anon,authenticated,service_role/);
  assert.doesNotMatch(source,/CREATE OR REPLACE FUNCTION public\.(activate|publish)|set_config\(/);
});
test('generation RPCs carry exact receipts and bounded complete pages',()=>{
  assert.match(source,/'current_generation_id',current_generation,'is_current'/);
  assert.match(source,/data_sha256.*sha256\(p_data\)/);
  assert.match(source,/snapshot_sha256.*sha256\(p_snapshot\)/);
  assert.match(source,/ordinal=1 OR running_bytes<=16777216/);assert.match(source,/bounded AS MATERIALIZED/);
  assert.match(source,/SG001/);assert.match(source,/SG002/);
  assert.match(source,/PERFORM survey_private.assert_legacy_annotation_document\(p_document_id\)/);
  assert.match(source,/snapshot_writer_epoch bigint NOT NULL DEFAULT 0 CHECK\(snapshot_writer_epoch>=0\)/);
  assert.match(source,/coalesce\(s.writer_epoch,0\)/);
  assert.match(source,/s.generation_id=h.generation_id/);
});
test('actual isolated PostgreSQL checks generation receipts, races, legacy and cascades',{
  skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL',
},()=>{
  const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message||''}`);
  assert.match(result.stdout,/Annotation generation transport PostgreSQL checks passed:/);
  assert.match(result.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
