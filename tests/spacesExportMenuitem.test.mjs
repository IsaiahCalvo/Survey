import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for Spaces export *actions* role=menuitem + named menu.
// Live proof: debug/scenarios/e2e-spaces-export-menuitem.spec.mjs
// Distinct from leftover-18 Space CSV / PDF Pages apply / X-01 persist /
// Survey/Spaces menu dismiss / Spaces rail toggle / Projects file-row
// More name / Documents More / Archive Show and sort / Templates More /
// Projects More / Documents mobile Sort / Eraser Type / Selection Mode /
// Manage Team / hub Account leftovers.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Spaces export menu is role=menu with name from the space; items are menuitems; isolated 8448 standing', () => {
  const src = read('src/sidebar/SpacesPanel.jsx');
  const start = src.indexOf('className={`spaces-header-export-button');
  const end = src.indexOf('{/* Spaces List */}');
  assert.ok(start >= 0 && end > start);
  const slice = src.slice(start, end);
  assert.match(slice, /aria-haspopup="menu"/);
  assert.match(slice, /role="menu"/);
  assert.match(slice, /aria-label=\{`Export \$\{spacesExportTarget\.name \|\| 'space'\}`\}/);
  assert.match(slice, /role="menuitem"/);
  assert.match(slice, />\s*CSV\s*</);
  assert.match(slice, />\s*PDF Pages\s*</);
  assert.equal((slice.match(/role="menuitem"/g) || []).length, 2);
  assert.doesNotMatch(slice, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(src, /pageSize\.width \* .*scale|pageSize \* scale/);

  assert.match(read('src/home/ProjectsFolderTree.jsx'), /ariaLabel=\{`\$\{f\.name \|\| 'Document'\} actions`\}/);
  assert.match(read('src/home/DocumentsLedger.jsx'), /ariaLabel=\{`\$\{doc\.name \|\| 'Document'\} actions`\}/);
  assert.match(read('src/home/ArchiveScreen.jsx'), /aria-label="Show and sort"/);

  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('live spec covers named Spaces export menuitem intended + break + edge; skip leftover-18 apply', () => {
  const spec = read('debug/scenarios/e2e-spaces-export-menuitem.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /Export Space 1/);
  assert.match(spec, /getByRole\('menuitem', \{ name: 'CSV', exact: true \}\)/);
  assert.match(spec, /getByRole\('menuitem', \{ name: 'PDF Pages', exact: true \}\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'CSV'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'PDF Pages'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Lock document'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Pin project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /partial must bite ink/);
});

test('does not replay Projects file-row More, Spaces rail toggle, or CSV apply', () => {
  const spec = read('debug/scenarios/e2e-spaces-export-menuitem.spec.mjs');
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /click-outside must close Spaces export/);
  const projects = read('debug/scenarios/e2e-projects-file-row-more-menu-name.spec.mjs');
  assert.match(projects, /\$\{OWNER\} actions/);
  const dismiss = read('debug/scenarios/e2e-survey-spaces-menu-dismiss.spec.mjs');
  assert.match(dismiss, /click-outside must close Spaces export/);
  assert.match(dismiss, /getByRole\('menuitem', \{ name: 'CSV', exact: true \}\)/);
});
