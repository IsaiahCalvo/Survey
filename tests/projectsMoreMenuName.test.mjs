import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for Projects More *menu* name.
// Live proof: debug/scenarios/e2e-projects-more-menu-name.spec.mjs
// Distinct from leftover-18 / X-01 persist / Documents More name /
// Archive Show and sort / Templates More name / Eraser Type /
// Selection Mode / Manage Team / hub Account / Home-tab /
// annotation / Pages context leftovers / Documents mobile sort.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Projects More menu is role=menu with name from the project; isolated 8448 standing', () => {
  const src = read('src/home/ProjectsFolderTree.jsx');
  const start = src.indexOf('function PopupMenu');
  const end = src.indexOf('export default function ProjectsFolderTree');
  assert.ok(start >= 0 && end > start);
  const slice = src.slice(start, end);
  assert.match(slice, /role="menu"/);
  assert.match(slice, /aria-label=\{ariaLabel\}/);
  assert.match(slice, /role="menuitem"/);
  assert.match(src, /ariaLabel=\{`\$\{proj\.name \|\| 'Project'\} actions`\}/);
  assert.doesNotMatch(slice, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(src, /pageSize\.width \* .*scale|pageSize \* scale/);

  const ledger = read('src/home/DocumentsLedger.jsx');
  assert.match(ledger, /aria-label=\{ariaLabel\}/);
  assert.match(ledger, /ariaLabel=\{`\$\{doc\.name \|\| 'Document'\} actions`\}/);

  const archive = read('src/home/ArchiveScreen.jsx');
  assert.match(archive, /aria-label="Show and sort"/);

  const templates = read('src/home/TemplatesEditor.jsx');
  assert.match(templates, /ariaLabel=\{`\$\{t\.name \|\| 'Template'\} actions`\}/);
  assert.match(templates, /ariaLabel=\{`\$\{ent\.role \|\| 'Entity'\} actions`\}/);

  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('live spec covers named Projects More intended + break + edge; skip leftover-18 and Activity name', () => {
  const spec = read('debug/scenarios/e2e-projects-more-menu-name.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /\$\{PROJECT\} actions/);
  assert.match(spec, /\$\{OTHER\} actions/);
  assert.match(spec, /getByRole\('menuitem', \{ name: 'Get link to project', exact: true \}\)/);
  assert.match(spec, /getByRole\('dialog', \{ name: 'Share project' \}\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'Upload files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Pin project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /aria-labelledby="activity/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /partial must bite ink/);
});

test('does not replay Templates More, Archive Show and sort, or Documents More name', () => {
  const spec = read('debug/scenarios/e2e-projects-more-menu-name.spec.mjs');
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /Archive Search \/ filter \/ sort intended/);
  const templates = read('debug/scenarios/e2e-templates-more-menu-name.spec.mjs');
  assert.match(templates, /\$\{TEMPLATE\} actions/);
  const archive = read('debug/scenarios/e2e-archive-sort-menu-name.spec.mjs');
  assert.match(archive, /Show and sort/);
  const docs = read('debug/scenarios/e2e-documents-more-menu-name.spec.mjs');
  assert.match(docs, /\$\{OWNER\} actions/);
});
