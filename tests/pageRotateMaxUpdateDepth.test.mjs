import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for the chrome-publish identity-churn guard that stopped
// Maximum update depth after page-2 rotate on spike-120-pages.
// Live proof: debug/scenarios/e2e-page-rotate-max-update-depth.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('top toolbar publish compares next vs prev and treats function identity as unchanged', () => {
  const src = read('src/PDFViewer.jsx');
  assert.match(src, /const nextTopToolbarApi = \{/);
  assert.match(src, /onTopToolbarApiChange\(\(prev\) => \{/);
  assert.match(src, /typeof previousValue === 'function' && typeof nextValue === 'function'/);
  assert.match(src, /Function-only identity[\s\S]{0,80}handleUndo/);
});

test('bottom toolbar publish compares next vs prev before setState', () => {
  const src = read('src/PDFViewer.jsx');
  assert.match(src, /const nextBottomToolbarApi = \{/);
  assert.match(src, /onBottomToolbarApiChange\(\(prev\) => \{/);
  assert.match(src, /120-page rotate loop/);
  assert.doesNotMatch(src, /onBottomToolbarApiChange\(\{\s*\/\/ Identifies which PDFViewer/);
});

test('right-rail collapse no-ops when the value is already current', () => {
  const src = read('src/PDFViewer.jsx');
  assert.match(
    src,
    /setRightRailCollapsed\(\(prev\) => \(prev === isCollapsed \? prev : isCollapsed\)\)/,
  );
});

test('live spec traps max-update-depth on 120-page rotate + single-page break + 390', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-max-update-depth.spec.mjs');
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /Maximum update depth exceeded/);
  assert.match(spec, /empty rotate invents 0/);
  assert.match(spec, /390/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
