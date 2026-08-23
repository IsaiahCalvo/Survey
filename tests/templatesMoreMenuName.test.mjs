import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for Templates More *menu* name.
// Live proof: debug/scenarios/e2e-templates-more-menu-name.spec.mjs
// Distinct from leftover-18 / X-01 persist / Documents More name /
// Archive Show and sort / Eraser Type / Selection Mode / Manage Team /
// hub Account / Home-tab / annotation / Pages context leftovers /
// Templates More overflow apply / leftover-18 module Move/Copy apply.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Templates More menu is role=menu with name from the template/entity; isolated 8448 standing', () => {
  const src = read('src/home/TemplatesEditor.jsx');
  const start = src.indexOf('function MoreMenu');
  const end = src.indexOf('function CustomSelect');
  assert.ok(start >= 0 && end > start);
  const slice = src.slice(start, end);
  assert.match(slice, /role="menu"/);
  assert.match(slice, /aria-label=\{ariaLabel\}/);
  assert.match(slice, /ariaLabel = 'Template actions'/);
  assert.match(slice, /role="menuitem"/);
  assert.match(src, /ariaLabel=\{`\$\{t\.name \|\| 'Template'\} actions`\}/);
  assert.match(src, /ariaLabel=\{`\$\{ent\.role \|\| 'Entity'\} actions`\}/);
  assert.doesNotMatch(slice, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(src, /pageSize\.width \* .*scale|pageSize \* scale/);

  const ledger = read('src/home/DocumentsLedger.jsx');
  assert.match(ledger, /aria-label=\{ariaLabel\}/);
  assert.match(ledger, /ariaLabel=\{`\$\{doc\.name \|\| 'Document'\} actions`\}/);

  const archive = read('src/home/ArchiveScreen.jsx');
  assert.match(archive, /aria-label="Show and sort"/);

  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('live spec covers named Templates More intended + break + edge; skip leftover-18 and Activity name', () => {
  const spec = read('debug/scenarios/e2e-templates-more-menu-name.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /\$\{TEMPLATE\} actions/);
  assert.match(spec, /\$\{ENTITY\} actions/);
  assert.match(spec, /getByRole\('menuitem', \{ name: 'Share', exact: true \}\)/);
  assert.match(spec, /getByRole\('dialog', \{ name: 'Share template' \}\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'Delete'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Move\/Copy'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /aria-labelledby="activity/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /partial must bite ink/);
});

test('does not replay Archive Show and sort or Documents More name', () => {
  const spec = read('debug/scenarios/e2e-templates-more-menu-name.spec.mjs');
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /Archive Search \/ filter \/ sort intended/);
  const archive = read('debug/scenarios/e2e-archive-sort-menu-name.spec.mjs');
  assert.match(archive, /Show and sort/);
  const docs = read('debug/scenarios/e2e-documents-more-menu-name.spec.mjs');
  assert.match(docs, /\$\{OWNER\} actions/);
});
