import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Desktop rail Previous page / Next page click.
// Live proof: debug/scenarios/e2e-page-nav-toolbar.spec.mjs
// Distinct from leftover-18 / remapped-after-CW / Ctrl+2 / Ctrl+M /
// V-05 keyboard / UL-07 page field / V-06 thumbnails.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('AppShell rail Previous/Next calls goToPreviousPage/goToNextPage and disables at ends', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /const atFirstPage = api\.pageNum <= 1/);
  assert.match(shell, /const atLastPage = api\.pageNum >= api\.numPages/);
  assert.match(shell, /onClick=\{api\.goToPreviousPage\}/);
  assert.match(shell, /onClick=\{api\.goToNextPage\}/);
  assert.match(shell, /disabled=\{atFirstPage\}/);
  assert.match(shell, /disabled=\{atLastPage\}/);
  assert.match(shell, /aria-label="Previous page"/);
  assert.match(shell, /aria-label="Next page"/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const goToPreviousPage = useCallback\(\(\) => \{/);
  assert.match(viewer, /goToPage\(pageNum - 1, \{ fallback: 'previous' \}\)/);
  assert.match(viewer, /const goToNextPage = useCallback\(\(\) => \{/);
  assert.match(viewer, /goToPage\(pageNum \+ 1, \{ fallback: 'next' \}\)/);
  assert.match(viewer, /goToPreviousPage,/);
  assert.match(viewer, /goToNextPage,/);
});

test('keyboard leftover stays Arrow/Home/End; overlay omits rail labels', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /Previous\/Next page/);
  assert.doesNotMatch(overlay, /aria-label="Previous page"/);
  assert.doesNotMatch(overlay, /description: 'Previous page'/);
  assert.doesNotMatch(overlay, /description: 'Next page'/);

  const keyboard = read('debug/scenarios/e2e-page-nav-keyboard.spec.mjs');
  assert.match(keyboard, /ArrowRight must move a page/);
  assert.doesNotMatch(keyboard, /Next page click must move a page/);
  assert.doesNotMatch(keyboard, /Previous page click must move a page/);
});

test('live spec covers rail click intended + break + edge; skip leftover-18 and zoom/CW replay', () => {
  const spec = read('debug/scenarios/e2e-page-nav-toolbar.spec.mjs');
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop rail Previous\/Next page click intended \+ break \+ edge/);
  assert.match(spec, /390 rail Previous\/Next page click edge/);
  assert.match(spec, /Next page click must move a page/);
  assert.match(spec, /Previous page click must move a page/);
  assert.match(spec, /Previous must be disabled on page 1/);
  assert.match(spec, /Next must be disabled on last page/);
  assert.match(spec, /1-page Next disabled/);
  assert.match(spec, /page-1 rect must survive Next\/Previous/);
  assert.match(spec, /Pen-armed Next click must still move a page/);
  assert.match(spec, /hubPreview Previous page 0/);
  assert.match(spec, /Search Match case compile-hidden/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /Control\+2/);
  assert.doesNotMatch(spec, /Control\+m/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|page-rotate-remap/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
