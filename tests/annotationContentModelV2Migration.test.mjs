import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const migration=readFileSync(new URL('../supabase/migrations/20260909107000_annotation_content_model_v2.sql',import.meta.url),'utf8');
test('content model v2 migration has a separate immutable model gate and least-privilege v3 RPCs',()=>{
 assert.match(migration,/content_model_version smallint NOT NULL DEFAULT 1/);
 assert.match(migration,/ERRCODE='SG003'/);
 assert.match(migration,/read_annotation_snapshot_v3/);
 assert.match(migration,/read_document_open_mode_v2/);
 assert.doesNotMatch(migration,/GRANT (SELECT|INSERT|UPDATE|DELETE|TRUNCATE).*annotation_generations/i);
});

test('content model v2 passes its disposable PostgreSQL contract',{skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'},()=>{
 const script=fileURLToPath(new URL('../scripts/test-annotation-content-model-v2-postgres.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
 assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message||''}`);
 assert.match(result.stdout,/Annotation content model v2 PostgreSQL checks passed: 9/);
 assert.match(result.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
