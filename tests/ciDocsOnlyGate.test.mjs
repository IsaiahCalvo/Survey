// A pull request that only touches root notes or graphify-out must still
// report "Build the app and gate the run" (main's ruleset requires it), and
// must never skip a test that reads the file it changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideDocsOnly, isDocsPath, MAX_LISTED_FILES } from '../scripts/ci-docs-only.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

test('only root notes and graphify-out count as docs', () => {
  assert.equal(isDocsPath('HANDOFF.md'), true);
  assert.equal(isDocsPath('graphify-out/example.json'), true);
  assert.equal(isDocsPath('docs/MOBILE-RUN.md'), false);
  assert.equal(isDocsPath('src/App.md.js'), false);
  assert.equal(isDocsPath('package.json'), false);
});

test('a docs-only pull request skips the full run', () => {
  const result = decideDocsOnly(['HANDOFF.md', 'graphify-out/example-report.txt', ''], { expectedCount: 2 });
  assert.equal(result.docsOnly, true);
});

test('any other file, a rename out of src, or an empty list runs everything', () => {
  assert.equal(decideDocsOnly(['HANDOFF.md', 'src/App.jsx']).docsOnly, false);
  // A rename lists both names; the old one lived in src.
  assert.equal(decideDocsOnly(['notes.md', 'src/notes.js']).docsOnly, false);
  assert.equal(decideDocsOnly([]).docsOnly, false);
  assert.equal(decideDocsOnly(['HANDOFF.md'], { expectedCount: MAX_LISTED_FILES }).docsOnly, false);
});

test('a note that a test reads still gets that test', () => {
  const sources = [{ path: 'tests/tooltipRule.test.mjs', text: "await read('AGENT-NOTES-EXAMPLE.md')" }];
  const result = decideDocsOnly(['AGENT-NOTES-EXAMPLE.md'], { sources });
  assert.equal(result.docsOnly, false);
  assert.match(result.reason, /tooltipRule/);
  // A longer path ending in the same name is a different file.
  const nested = [{ path: 'tests/x.test.mjs', text: "read('supabase/migrations/NOTES-EXAMPLE.md')" }];
  assert.equal(decideDocsOnly(['NOTES-EXAMPLE.md'], { sources: nested }).docsOnly, true);
});

test('ci.yml runs on docs-only pull requests and lets the gate report', () => {
  const on = /^on:\n([\s\S]*?)\n(?=\S)/m.exec(ci)[1];
  const pullRequest = /^ {2}pull_request:.*\n((?: {4}.*\n?)*)/m.exec(on);
  assert.ok(pullRequest, 'ci.yml must run on pull requests');
  assert.doesNotMatch(
    pullRequest[1] || '',
    /paths-ignore/,
    'pull requests must not use paths-ignore: a skipped workflow never reports '
      + '"Build the app and gate the run", and main requires it, so the PR hangs',
  );
  assert.match(ci, /node scripts\/ci-docs-only\.mjs/);
  assert.match(ci, /DOCS_ONLY: \$\{\{ needs\.changes\.outputs\.docs_only == 'true' \}\}/);
});
