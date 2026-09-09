import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('actual SQL source capture transforms all representations without rewriting the captured payload',{
 skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for local PostgreSQL',
},()=>{
 const script=fileURLToPath(new URL('../scripts/test-document-generation-transform-postgres.mjs',import.meta.url));
 const r=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
 assert.equal(r.status,0,`${r.stdout}\n${r.stderr}\n${r.error?.message||''}`);
 assert.match(r.stdout,/Document generation transform PostgreSQL checks passed: 18/);
 assert.match(r.stdout,/Document generation transform service-read PostgreSQL checks passed: 10/);
 assert.match(r.stdout,/Document generation transform SQL-writeback PostgreSQL checks passed: 3/);
 assert.match(r.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
