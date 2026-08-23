import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Independent hunt after official Spaces rail openPanel align (`4a10a417`).
// Axis: leftover official files besides spacesRailToggle / overlay-mount /
// isolated 8448, plus compile-visible chrome that is NOT rail-toggle,
// dismiss, Home `?`, or remapped-after-CW.
// Live proof: debug/scenarios/e2e-after-spaces-openpanel-independent-hunt.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('hunt spec covers live context actions + leftover-18 hosts and skips spaces/overlay replay', () => {
  const spec = read('debug/scenarios/e2e-after-spaces-openpanel-independent-hunt.spec.mjs');
  assert.match(spec, /independent hunt after official Spaces rail openPanel align/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /Bring to front/);
  assert.match(spec, /data-annotation-context-menu/);
  assert.match(spec, /Save version|Close version history|Mirror horizontally/);
  assert.match(spec, /More document options/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /!isViewerVisible && <KeyboardShortcutsOverlay/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay/);
  assert.doesNotMatch(spec, /click-outside must close Style/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
});

test('leftover official files besides spacesRailToggle / overlay-mount do not still require stale clicks', () => {
  const leftover = read('tests/spacesRailToggle.test.mjs');
  assert.match(leftover, /openPanel/);
  assert.doesNotMatch(leftover, /assert\.match\(collapsed, \/setIsCollapsed\\\(false\\\)\/\)/);

  const overlay = read('tests/keyboardShortcutMatrix.test.mjs');
  assert.match(overlay, /!isViewerVisible && !isDevTestPdfRoute && <KeyboardShortcutsOverlay/);
  assert.doesNotMatch(overlay, /assert\.match\(shell, \/!isViewerVisible && <KeyboardShortcutsOverlay/);

  const unlisted = read('tests/e2eUnlistedControls.test.mjs');
  assert.match(unlisted, /item\('Continue pin', 'continuePin'/);
  assert.doesNotMatch(unlisted, /setIsCollapsed\(false\);\s*setActiveTab\(tab\.id\)/);
});
