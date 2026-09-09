import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('metadata catalog uses real access policies and indexed pages in disposable PostgreSQL', {
  skip: process.env.SURVEY_POSTGRES_INTEGRATION !== '1' && 'set SURVEY_POSTGRES_INTEGRATION=1 for local PostgreSQL',
}, () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/test-document-catalog-postgres.mjs', import.meta.url))],
    { encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024 });
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message||''}`);
  assert.match(result.stdout,/PASS 10 document catalog PostgreSQL checks/);
  assert.match(result.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
