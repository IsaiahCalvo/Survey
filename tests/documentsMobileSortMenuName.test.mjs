import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for Documents mobile sort *menu* name.
// Live proof: debug/scenarios/e2e-documents-mobile-sort-menu-name.spec.mjs
// Distinct from leftover-18 / X-01 persist / Documents More name /
// Archive Show and sort / Templates More name / Projects More name /
// Eraser Type / Selection Mode / Manage Team / hub Account /
// Home-tab / annotation / Pages context leftovers /
// Projects file-row More.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Documents mobile sort menu is role=menu with Sort name; isolated 8448 standing', () => {
  const src = read('src/home/DocumentsLedger.jsx');
  const start = src.indexOf('className="documents-mobile-sort-control"');
  const end = src.indexOf('const uploadButtonBody');
  assert.ok(start >= 0 && end > start);
  const slice = src.slice(start, end);
  assert.match(slice, /role="menu"/);
  assert.match(slice, /aria-label="Sort"/);
  assert.match(slice, /role="menuitem"/);
  assert.match(slice, /sortOptions\.map/);
  assert.match(src, /\['name', 'File'\]/);
  assert.match(src, /\['edited', 'Last edited'\]/);
  assert.doesNotMatch(slice, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(src, /pageSize\.width \* .*scale|pageSize \* scale/);

  assert.match(src, /aria-label=\{ariaLabel\}/);
  assert.match(src, /ariaLabel=\{`\$\{doc\.name \|\| 'Document'\} actions`\}/);

  const archive = read('src/home/ArchiveScreen.jsx');
  assert.match(archive, /aria-label="Show and sort"/);

  const projects = read('src/home/ProjectsFolderTree.jsx');
  assert.match(projects, /ariaLabel=\{`\$\{proj\.name \|\| 'Project'\} actions`\}/);

  const templates = read('src/home/TemplatesEditor.jsx');
  assert.match(templates, /ariaLabel=\{`\$\{t\.name \|\| 'Template'\} actions`\}/);

  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('live spec covers named Documents Sort intended + break + edge; skip leftover-18 and Activity name', () => {
  const spec = read('debug/scenarios/e2e-documents-mobile-sort-menu-name.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /name: 'Sort', exact: true/);
  assert.match(spec, /getByRole\('menuitem', \{ name, exact: true \}\)/);
  assert.match(spec, /Last edited/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'Upload'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /aria-labelledby="activity/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /partial must bite ink/);
});

test('does not replay Projects More, Archive Show and sort, or Documents More name', () => {
  const spec = read('debug/scenarios/e2e-documents-mobile-sort-menu-name.spec.mjs');
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /Archive Search \/ filter \/ sort intended/);
  const projects = read('debug/scenarios/e2e-projects-more-menu-name.spec.mjs');
  assert.match(projects, /\$\{PROJECT\} actions/);
  const archive = read('debug/scenarios/e2e-archive-sort-menu-name.spec.mjs');
  assert.match(archive, /Show and sort/);
  const docs = read('debug/scenarios/e2e-documents-more-menu-name.spec.mjs');
  assert.match(docs, /\$\{OWNER\} actions/);
});
