import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('document open mode uses actual authority and generation fences in disposable PostgreSQL', {
  skip: process.env.SURVEY_POSTGRES_INTEGRATION !== '1' && 'set SURVEY_POSTGRES_INTEGRATION=1 for local PostgreSQL',
}, () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/test-document-open-mode-postgres.mjs', import.meta.url))],
    { encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error?.message || ''}`);
  assert.match(result.stdout, /Document open mode PostgreSQL groups passed: 14\b/);
  assert.match(result.stdout, /Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
