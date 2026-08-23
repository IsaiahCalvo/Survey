import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for Archive Show and sort *menu* name.
// Live proof: debug/scenarios/e2e-archive-sort-menu-name.spec.mjs
// Distinct from leftover-18 / X-01 persist / Documents More name /
// Eraser Type / Selection Mode / Manage Team / hub Account /
// Home-tab / annotation / Pages context leftovers /
// archive Search-filter-sort apply catalogs.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Archive sort menu is role=menu with Show and sort name; isolated 8448 standing', () => {
  const src = read('src/home/ArchiveScreen.jsx');
  const start = src.indexOf('const filterMenu = (');
  const end = src.indexOf('const filterButton = (');
  assert.ok(start >= 0 && end > start);
  const slice = src.slice(start, end);
  assert.match(slice, /role="menu"/);
  assert.match(slice, /aria-label="Show and sort"/);
  assert.match(slice, /role="menuitemradio"/);
  assert.match(slice, /ARCHIVE_FILTERS\.map/);
  assert.match(slice, /ARCHIVE_SORT_OPTIONS\.map/);
  assert.doesNotMatch(slice, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(src, /pageSize\.width \* .*scale|pageSize \* scale/);

  const ledger = read('src/home/DocumentsLedger.jsx');
  assert.match(ledger, /aria-label=\{ariaLabel\}/);
  assert.match(ledger, /ariaLabel=\{`\$\{doc\.name \|\| 'Document'\} actions`\}/);

  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('live spec covers named Archive Show and sort intended + break + edge; skip leftover-18 and Activity name', () => {
  const spec = read('debug/scenarios/e2e-archive-sort-menu-name.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /Show and sort/);
  assert.match(spec, /getByRole\('menuitemradio', \{ name: 'Documents', exact: true \}\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'Delete forever'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Restore'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /aria-labelledby="activity/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /partial must bite ink/);
});

test('does not replay Documents More name or archive Search apply catalogs', () => {
  const spec = read('debug/scenarios/e2e-archive-sort-menu-name.spec.mjs');
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /Archive Search \/ filter \/ sort intended/);
  const docs = read('debug/scenarios/e2e-documents-more-menu-name.spec.mjs');
  assert.match(docs, /\$\{OWNER\} actions/);
});
