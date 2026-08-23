import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Official leftover after Pages tab-as-switcher independent hunt.
// Home on `?testPdf=` stacked AppShell + DevTestRoute overlays.
// Distinct from leftover-18 / rail-toggle / dismiss-family / V-09
// viewer overlay / Home click leftover / 8448.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('AppShell skips the Home overlay when DevTestRoute already remounts one', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /isDevTestPdfRoute/);
  assert.match(shell, /has\('testPdf'\)/);
  assert.match(shell, /!isViewerVisible && !isDevTestPdfRoute && <KeyboardShortcutsOverlay/);
  assert.doesNotMatch(shell, /!isViewerVisible && <KeyboardShortcutsOverlay \/>/);

  const official = read('tests/shortcutsOverlay.test.mjs');
  assert.match(official, /!isViewerVisible && !isDevTestPdfRoute && <KeyboardShortcutsOverlay/);
  assert.match(official, /has\\\('testPdf'\\\)/);

  // Leftover official files after `afac0655` still required the pre-gate mount.
  const matrix = read('tests/keyboardShortcutMatrix.test.mjs');
  assert.match(matrix, /!isViewerVisible && !isDevTestPdfRoute && <KeyboardShortcutsOverlay/);
  assert.match(matrix, /doesNotMatch\(shell, \/!isViewerVisible && <KeyboardShortcutsOverlay/);
  const mobile = read('tests/mobileChromeHitTargets.test.mjs');
  assert.match(mobile, /!isViewerVisible && !isDevTestPdfRoute && <KeyboardShortcutsOverlay/);
  assert.match(mobile, /doesNotMatch\(shell, \/!isViewerVisible && <KeyboardShortcutsOverlay/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /<KeyboardShortcutsOverlay \/>/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec proves Home `?` is one modal, not two stacked listeners', () => {
  const spec = read('debug/scenarios/e2e-home-shortcuts-overlay-singleton.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /HOME_SHORTCUTS_OVERLAY_SINGLETON/);
  assert.match(spec, /viewer `\?` stays one overlay/);
  assert.match(spec, /Home `\?` must be one overlay, not two/);
  assert.match(spec, /Esc dismisses the single Home overlay/);
  assert.match(spec, /click-outside dismisses/);
  assert.match(spec, /Close dismisses/);
  assert.match(spec, /second `\?` toggles closed/);
  assert.match(spec, /PDF tab return keeps one overlay/);
  assert.match(spec, /hubPreview must not mount the overlay/);
  assert.match(spec, /390 Home `\?` must stay one overlay/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /Bookmarks → Pages must not jump/);
  assert.doesNotMatch(spec, /click-outside must close Style/);
});
