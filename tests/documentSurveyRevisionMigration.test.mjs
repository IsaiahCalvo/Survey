import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const sql=readFileSync(new URL('../supabase/migrations/20260909060000_document_survey_revision.sql',import.meta.url),'utf8');
test('survey SQL counter guards all sessions/items without claiming full-state proof',()=>{
  for(const pattern of [/including inactive/,/FOR SHARE NOWAIT/,/pg_try_advisory_xact_lock/,/READ COMMITTED/,/REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows/,/revision=r\.revision\+1/,/REVOKE TRUNCATE/,/Storage/])assert.match(sql,pattern);
  assert.doesNotMatch(sql,/GRANT .*document_survey_revisions/);
});
test('actual disposable PostgreSQL survey binding/cascade/WAL races',{skip:process.env.SURVEY_RUN_LOCAL_POSTGRES_TESTS!=='1'},()=>{
  const result=spawnSync(process.execPath,[new URL('../scripts/test-document-survey-revision-postgres.mjs',import.meta.url).pathname],{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);assert.match(result.stdout,/"result":"passed"/);
});
