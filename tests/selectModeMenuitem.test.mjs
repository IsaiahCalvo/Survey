import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for Selection Mode *actions* role=menuitem.
// Live proof: debug/scenarios/e2e-select-mode-menuitem.spec.mjs
// Distinct from leftover-18 / Select Mode create-tool dismiss / Manage Team
// menuitem / hub Account / Home-tab / annotation / Pages context.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Selection Mode popup is role=menu with named menuitems; high-risk files untouched', () => {
  const src = read('src/AppShell.jsx');
  const start = src.indexOf('data-select-mode-menu="true"');
  const end = src.indexOf('{/* Draw category */}');
  assert.ok(start > 0 && end > start);
  const slice = src.slice(start, end);
  assert.match(slice, /role="menu"/);
  assert.match(slice, /aria-label="Selection Mode"/);
  assert.match(slice, /Select annotations[\s\S]*role="menuitem"|role="menuitem"[\s\S]*Select annotations/);
  assert.match(slice, /type="button"/);
  assert.match(slice, /role="menuitem"/);
  assert.doesNotMatch(slice, /create-checkout-session|Turnstile|msalInstance/);

  assert.doesNotMatch(read('src/PDFViewer.jsx').slice(0, 80), /Selection Mode menuitem this pass/);
  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('live spec covers named menuitem actions intended + break + edge; skip leftover-18 and Activity name', () => {
  const spec = read('debug/scenarios/e2e-select-mode-menuitem.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /getByRole\('menuitem', \{ name: 'Select text', exact: true \}\)/);
  assert.match(spec, /getByRole\('menuitem', \{ name: 'Select annotations', exact: true \}\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /aria-labelledby="activity/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
});

test('does not replay Manage Team menuitem or Select caret dismiss product', () => {
  const spec = read('debug/scenarios/e2e-select-mode-menuitem.spec.mjs');
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  const dismiss = read('debug/scenarios/e2e-select-caret-create-tool-dismiss.spec.mjs');
  assert.match(dismiss, /data-select-mode-menu="true"/);
  assert.doesNotMatch(dismiss, /getByRole\('menuitem', \{ name: 'Select text'/);
});
