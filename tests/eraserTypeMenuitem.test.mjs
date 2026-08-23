import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for Eraser Type *actions* role=menuitem.
// Live proof: debug/scenarios/e2e-eraser-type-menuitem.spec.mjs
// Distinct from leftover-18 / D-03 type apply / remapped eraser Size /
// Selection Mode menuitem / Manage Team menuitem / hub Account /
// Home-tab / annotation / Pages context.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Eraser Type popup is role=menu with named menuitems; isolated 8448 standing', () => {
  const src = read('src/PDFViewer.jsx');
  const start = src.indexOf('data-eraser-caret-popup={isEraser ? \'true\' : undefined}');
  const end = src.indexOf('{activeCategoryDropdown === \'shape\' && (');
  assert.ok(start > 0 && end > start);
  const slice = src.slice(start, end);
  assert.match(slice, /role="menu"/);
  assert.match(slice, /aria-label=\{isHighlighterSplitMenu \? 'SurveyMarker Type' : 'Eraser Type'\}/);
  assert.match(slice, /Partial erase[\s\S]*role="menuitem"|role="menuitem"[\s\S]*Partial erase/);
  assert.match(slice, /Full stroke erase/);
  assert.match(slice, /type="button"/);
  assert.match(slice, /role="menuitem"/);
  assert.doesNotMatch(slice, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(slice, /pageSize\.width \* .*scale|pageSize \* scale/);

  const app = read('src/AppShell.jsx');
  const selectStart = app.indexOf('data-select-mode-menu="true"');
  const selectEnd = app.indexOf('{/* Draw category */}');
  assert.match(app.slice(selectStart, selectEnd), /role="menuitem"/);

  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('live spec covers named menuitem actions intended + break + edge; skip leftover-18 and Activity name', () => {
  const spec = read('debug/scenarios/e2e-eraser-type-menuitem.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /getByRole\('menuitem', \{ name: 'Partial erase', exact: true \}\)/);
  assert.match(spec, /getByRole\('menuitem', \{ name: 'Full stroke erase', exact: true \}\)/);
  assert.match(spec, /getByRole\('menu', \{ name: 'Eraser Type', exact: true \}\)/);
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
  assert.doesNotMatch(spec, /partial must bite ink/);
});

test('does not replay Selection Mode menuitem or D-03 type apply product', () => {
  const spec = read('debug/scenarios/e2e-eraser-type-menuitem.spec.mjs');
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  const apply = read('debug/scenarios/e2e-eraser-type.spec.mjs');
  assert.match(apply, /data-eraser-caret-popup/);
  assert.match(apply, /getByRole\('menuitem', \{ name: 'Partial erase', exact: true \}\)/);
  assert.doesNotMatch(apply, /getByRole\('menu', \{ name: 'Eraser Type'/);
});
