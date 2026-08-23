import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for Projects file-row More *menu* name.
// Live proof: debug/scenarios/e2e-projects-file-row-more-menu-name.spec.mjs
// Distinct from leftover-18 / X-01 persist / Documents More name /
// Archive Show and sort / Templates More name / Projects More name /
// Documents mobile Sort / Eraser Type / Selection Mode / Manage Team /
// hub Account / Home-tab / annotation / Pages context leftovers.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Projects file-row More menu is role=menu with name from the document; isolated 8448 standing', () => {
  const src = read('src/home/ProjectsFolderTree.jsx');
  const start = src.indexOf('File-row "more" menu');
  const end = src.indexOf('Manage Team modal');
  assert.ok(start >= 0 && end > start);
  const slice = src.slice(start, end);
  assert.match(slice, /ariaLabel=\{`\$\{f\.name \|\| 'Document'\} actions`\}/);
  assert.match(slice, /label: 'Copy'/);
  assert.match(slice, /label: 'Paste'/);
  assert.match(slice, /label: 'Delete'/);
  assert.match(slice, /label: 'Share'/);
  assert.match(slice, /Lock document/);
  assert.doesNotMatch(slice, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(src, /pageSize\.width \* .*scale|pageSize \* scale/);

  const popupStart = src.indexOf('function PopupMenu');
  const popupEnd = src.indexOf('export default function ProjectsFolderTree');
  assert.match(src.slice(popupStart, popupEnd), /role="menu"/);
  assert.match(src.slice(popupStart, popupEnd), /aria-label=\{ariaLabel\}/);
  assert.match(src.slice(popupStart, popupEnd), /role="menuitem"/);
  assert.match(src, /ariaLabel=\{`\$\{proj\.name \|\| 'Project'\} actions`\}/);

  const ledger = read('src/home/DocumentsLedger.jsx');
  assert.match(ledger, /ariaLabel=\{`\$\{doc\.name \|\| 'Document'\} actions`\}/);
  const sortStart = ledger.indexOf('className="documents-mobile-sort-control"');
  const sortEnd = ledger.indexOf('const uploadButtonBody');
  assert.match(ledger.slice(sortStart, sortEnd), /aria-label="Sort"/);

  const archive = read('src/home/ArchiveScreen.jsx');
  assert.match(archive, /aria-label="Show and sort"/);

  const templates = read('src/home/TemplatesEditor.jsx');
  assert.match(templates, /ariaLabel=\{`\$\{t\.name \|\| 'Template'\} actions`\}/);

  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('live spec covers named Projects file-row More intended + break + edge; skip leftover-18 and Activity name', () => {
  const spec = read('debug/scenarios/e2e-projects-file-row-more-menu-name.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /\$\{OWNER\} actions/);
  assert.match(spec, /\$\{RFI\} actions/);
  assert.match(spec, /\$\{DOOR\} actions/);
  assert.match(spec, /getByRole\('menuitem', \{ name: 'Share', exact: true \}\)/);
  assert.match(spec, /getByRole\('dialog', \{ name: 'Document Access', exact: true \}\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'Lock document'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Pin project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /aria-labelledby="activity/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /partial must bite ink/);
});

test('does not replay Projects More, Documents Sort, or Documents More name', () => {
  const spec = read('debug/scenarios/e2e-projects-file-row-more-menu-name.spec.mjs');
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /Archive Search \/ filter \/ sort intended/);
  const projects = read('debug/scenarios/e2e-projects-more-menu-name.spec.mjs');
  assert.match(projects, /\$\{PROJECT\} actions/);
  const sort = read('debug/scenarios/e2e-documents-mobile-sort-menu-name.spec.mjs');
  assert.match(sort, /name: 'Sort', exact: true/);
  const docs = read('debug/scenarios/e2e-documents-more-menu-name.spec.mjs');
  assert.match(docs, /\$\{OWNER\} actions/);
});
