import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { walkthruAppUrl } from '../src/suite/suiteApps.js';

test('Open Walkthru goes to the matching copy of Walkthru', () => {
  assert.equal(walkthruAppUrl('nightly'), 'https://walkthu-nightly.vercel.app');
  assert.equal(walkthruAppUrl('stable'), 'https://walkthru.tools');
  assert.equal(walkthruAppUrl('anything-else'), 'https://walkthru.tools');
});

test('Open Walkthru sits behind the suite flag in the account menu', () => {
  const src = readFileSync(new URL('../src/home/HubShell.jsx', import.meta.url), 'utf8');
  assert.match(src, /\{SUITE_LIBRARY_ON && \(\s*<a[\s\S]*?walkthruAppUrl\(releaseChannel\(\)\)[\s\S]*?Open Walkthru/);
});
