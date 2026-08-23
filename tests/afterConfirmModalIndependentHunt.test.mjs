import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('official leftover files besides isolated 8448 match live source after Settings labelledby', () => {
  const settings = read('src/components/AccountSettings.jsx');
  assert.match(settings, /aria-labelledby="account-settings-title"/);
  assert.match(settings, /<h2 id="account-settings-title">Settings<\/h2>/);

  const confirm = read('src/home/BulkModals.jsx');
  const start = confirm.indexOf('export function ConfirmModal');
  const end = confirm.indexOf('export function RenameModal');
  assert.match(confirm.slice(start, end), /aria-labelledby="confirm-modal-title"/);

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

test('hunt after ConfirmModal name looks past Settings dialog name and leftover-18', () => {
  const spec = read('debug/scenarios/e2e-after-confirm-modal-independent-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /confirm-modal-title/);
  assert.match(spec, /unnamedDialogs/);
  assert.match(spec, /AFTER_CONFIRM_MODAL_INDEPENDENT_HUNT/);
  assert.doesNotMatch(spec, /account-settings-title/);
  assert.doesNotMatch(spec, /data-pages-context-menu/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
});
