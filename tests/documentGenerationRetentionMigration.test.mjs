import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('durable generation retention enforces complete source, ownership, cleanup and retry rules in PostgreSQL',{
  skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for local PostgreSQL',
},()=>{
  const script=fileURLToPath(new URL('../scripts/test-document-generation-retention-postgres.mjs',import.meta.url));
  const r=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
  assert.equal(r.status,0,`${r.stdout}\n${r.stderr}\n${r.error?.message||''}`);
  assert.match(r.stdout,/Document generation retention PostgreSQL checks passed: [1-9][0-9]*/);
  assert.match(r.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
