import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for Pages thumbnail context *actions* role=menuitem.
// Live proof: debug/scenarios/e2e-pages-context-menuitem.spec.mjs
// Distinct from leftover-18 / dismiss-family / annotation context
// menuitem / Pages apply catalogs.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Pages context items are role=menuitem; menu has role=menu + Page N actions', () => {
  const panel = read('src/sidebar/PagesPanel.jsx');
  const start = panel.indexOf('{/* Context Menu */}');
  assert.ok(start > 0);
  const slice = panel.slice(start);
  assert.match(slice, /role="menu"/);
  assert.match(slice, /aria-label=\{`Page \$\{contextMenu\.pageNumber\} actions`\}/);
  assert.match(slice, /role="menuitem"/);
  assert.equal((slice.match(/role="menuitem"/g) || []).length, 13);
  for (const label of [
    'Move up',
    'Move down',
    'Cut',
    'Copy',
    'Paste',
    'Duplicate',
    'Insert blank page',
    'Rotate',
    'Rotate counter-clockwise',
    'Mirror horizontally',
    'Mirror vertically',
    'Reset',
    'Delete',
  ]) {
    assert.match(slice, new RegExp(`>\\s*${label}\\s*<`));
  }
  assert.doesNotMatch(slice, /Extract Pages|Extract pages/);
});

test('live spec covers named menuitem actions intended + break + edge; skip leftover-18 and dismiss replay', () => {
  const spec = read('debug/scenarios/e2e-pages-context-menuitem.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /getByRole\('menuitem', \{ name, exact: true \}\)/);
  assert.match(spec, /Page 1 actions/);
  assert.match(spec, /keyboard\.press\('Enter'\)/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /click-outside must close Pages context/);
  assert.doesNotMatch(spec, /data-annotation-context-menu/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
});
