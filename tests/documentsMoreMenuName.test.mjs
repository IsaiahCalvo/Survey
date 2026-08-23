import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for Documents More *menu* name.
// Live proof: debug/scenarios/e2e-documents-more-menu-name.spec.mjs
// Distinct from leftover-18 / X-01 persist / Documents Share Access apply /
// Eraser Type / Selection Mode / Manage Team / hub Account /
// Home-tab / annotation / Pages context item-role leftovers.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Documents More menu is role=menu with aria-label from the document name; isolated 8448 standing', () => {
  const src = read('src/home/DocumentsLedger.jsx');
  const start = src.indexOf('function DocumentActionMenu');
  const end = src.indexOf('/* Two-letter initials from a display name');
  assert.ok(start >= 0 && end > start);
  const slice = src.slice(start, end);
  assert.match(slice, /role="menu"/);
  assert.match(slice, /aria-label=\{ariaLabel\}/);
  assert.match(slice, /ariaLabel = 'Document actions'/);
  assert.match(slice, /role="menuitem"/);
  assert.match(src, /ariaLabel=\{`\$\{doc\.name \|\| 'Document'\} actions`\}/);
  assert.doesNotMatch(slice, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(src, /pageSize\.width \* .*scale|pageSize \* scale/);

  const viewer = read('src/PDFViewer.jsx');
  const eraserStart = viewer.indexOf('data-eraser-caret-popup={isEraser ? \'true\' : undefined}');
  const eraserEnd = viewer.indexOf('{activeCategoryDropdown === \'shape\' && (');
  assert.match(viewer.slice(eraserStart, eraserEnd), /role="menuitem"/);

  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('live spec covers named Documents More menu intended + break + edge; skip leftover-18 and Activity name', () => {
  const spec = read('debug/scenarios/e2e-documents-more-menu-name.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /\$\{OWNER\} actions/);
  assert.match(spec, /getByRole\('menuitem', \{ name: 'Share', exact: true \}\)/);
  assert.match(spec, /getByRole\('dialog', \{ name: 'Document Access', exact: true \}\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /aria-labelledby="activity/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /doDeleteForever|create-checkout-session/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /partial must bite ink/);
});

test('does not replay Eraser Type menuitem or Documents Share Access apply', () => {
  const spec = read('debug/scenarios/e2e-documents-more-menu-name.spec.mjs');
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /getByRole\('menuitem', \{ name: 'Full stroke erase'/);
  const access = read('debug/scenarios/e2e-access-management-dialog-name.spec.mjs');
  assert.match(access, /getByRole\('dialog', \{ name: 'Document Access'/);
});
