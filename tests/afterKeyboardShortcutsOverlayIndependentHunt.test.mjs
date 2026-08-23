import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('official leftover files besides isolated 8448 match live source after CreateCategory labelledby', () => {
  const settings = read('src/components/AccountSettings.jsx');
  assert.match(settings, /aria-labelledby="account-settings-title"/);
  assert.match(settings, /<h2 id="account-settings-title">Settings<\/h2>/);

  const confirm = read('src/home/BulkModals.jsx');
  const start = confirm.indexOf('export function ConfirmModal');
  const end = confirm.indexOf('export function RenameModal');
  assert.match(confirm.slice(start, end), /aria-labelledby="confirm-modal-title"/);

  const create = read('src/components/CreateCategoryModal.jsx');
  assert.match(create, /aria-labelledby="create-category-modal-title"/);
  assert.match(create, /id="create-category-modal-title"/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /aria-labelledby="keyboard-shortcuts-title"/);
  assert.match(overlay, /id="keyboard-shortcuts-title"/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /data-hub-keep-mount=""/);
  assert.match(shell, /\.\.\.\(isViewerVisible \? \{ inert: '', 'aria-hidden': 'true' \} : \{\}\)/);
  assert.match(shell, /!isViewerVisible && !isDevTestPdfRoute && <KeyboardShortcutsOverlay/);

  const overlayOfficial = [
    'tests/keyboardShortcutMatrix.test.mjs',
    'tests/mobileChromeHitTargets.test.mjs',
    'tests/shortcutsOverlay.test.mjs',
  ];
  for (const rel of overlayOfficial) {
    const src = read(rel);
    assert.match(src, /!isViewerVisible && !isDevTestPdfRoute && <KeyboardShortcutsOverlay/);
  }

  assert.match(read('src/PDFSidebar.jsx'), /openPanel\(tab\.id\)/);
  assert.match(read('src/AppShell.jsx'), /document\.addEventListener\('pointerdown', onDown, true\)/);
  assert.doesNotMatch(read('src/DevTestRoute.jsx'), /cloudSync: true/);

  const hubNav = read('src/home/HubShell.jsx');
  const navStart = hubNav.indexOf('const navBtn =');
  assert.ok(navStart > 0);
  assert.match(hubNav.slice(navStart, navStart + 400), /type="button"/);

  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('hunt after KeyboardShortcuts overlay name looks past CreateCategory name and leftover-18', () => {
  const spec = read('debug/scenarios/e2e-after-keyboard-shortcuts-overlay-independent-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /keyboard-shortcuts-title/);
  assert.match(spec, /unnamedDialogs/);
  assert.match(spec, /AFTER_KEYBOARD_SHORTCUTS_OVERLAY_INDEPENDENT_HUNT/);
  assert.match(spec, /Lock this document/);
  assert.doesNotMatch(spec, /create-category-modal-title/);
  assert.doesNotMatch(spec, /Delete 2 categories\?/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
});
