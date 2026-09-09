import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('private publication and checked generation open preserve exact state in disposable PostgreSQL', {
  skip: process.env.SURVEY_POSTGRES_INTEGRATION !== '1' && 'set SURVEY_POSTGRES_INTEGRATION=1 for local PostgreSQL',
}, () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/test-document-generation-publication-postgres.mjs', import.meta.url))],
    { encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}\n${r.error?.message || ''}`);
  assert.match(r.stdout, /Document generation publication PostgreSQL groups passed: 26/);
  assert.match(r.stdout, /Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
