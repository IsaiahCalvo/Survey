import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = new URL('../scripts/test-document-generation-download-http.mjs', import.meta.url);
test('download HTTP proof runs the actual Deno index with cached SDK and loopback-only fixtures', () => {
  const source = readFileSync(script, 'utf8');
  for (const value of ['document-generation-download/index.ts', 'document-generation-download/deno.json',
    '--node-modules-dir=none', '--cached-only', '--no-lock', 'SURVEY_HTTP_INTEGRATION',
    'SURVEY_GENERATION_DOWNLOAD', 'SURVEY_GENERATION_STORAGE_CONTRACT', "fake.listen(0, '127.0.0.1'",
    'Non-local fixture fetch denied', 'All local Deno children exited', 'p_include_snapshot',
    'revoke-final', 'redirect-target', 'clickable-link-test.pdf']) assert.ok(source.includes(value), value);
  assert.doesNotMatch(source, /dotenv|readFile.*\.env|npm install|--allow-scripts|\.\.\.process\.env/);
});
test('actual download SDK uses viewer-scoped reads and returns complete PDF only after final proof', {
  skip: process.env.SURVEY_HTTP_INTEGRATION !== '1' && 'set SURVEY_HTTP_INTEGRATION=1 for local Deno/SDK proof',
}, () => {
  const result = spawnSync(process.execPath, [fileURLToPath(script)], { encoding: 'utf8', timeout: 90000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error?.message || ''}`);
  assert.match(result.stdout, /local HTTP checks passed: 20/);
  assert.match(result.stdout, /All local Deno children exited and fake HTTP server closed/);
});
