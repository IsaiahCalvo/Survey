import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('official leftover files besides isolated 8448 match live source after keep-mount inert', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /data-hub-keep-mount=""/);
  assert.match(shell, /\.\.\.\(isViewerVisible \? \{ inert: '', 'aria-hidden': 'true' \} : \{\}\)/);
  assert.match(shell, /!isViewerVisible && !isDevTestPdfRoute && <KeyboardShortcutsOverlay/);
  assert.doesNotMatch(shell, /!isViewerVisible && <KeyboardShortcutsOverlay \/>/);

  const overlayOfficial = [
    'tests/keyboardShortcutMatrix.test.mjs',
    'tests/mobileChromeHitTargets.test.mjs',
    'tests/officialOverlayMountAlign.test.mjs',
    'tests/shortcutsOverlay.test.mjs',
  ];
  for (const rel of overlayOfficial) {
    const src = read(rel);
    assert.match(src, /!isViewerVisible && !isDevTestPdfRoute && <KeyboardShortcutsOverlay/);
    assert.match(src, /doesNotMatch\(shell, \/!isViewerVisible && <KeyboardShortcutsOverlay/);
  }

  const spaces = read('tests/spacesRailToggle.test.mjs');
  assert.match(spaces, /openPanel\(tab\.id\)/);

  const popover = read('tests/annotationFormattingPopoverContract.test.mjs');
  assert.match(popover, /pointerdown/);

  const sync = read('src/DevTestRoute.jsx');
  assert.doesNotMatch(sync, /cloudSync: true/);

  const hubNav = read('src/home/HubShell.jsx');
  const start = hubNav.indexOf('const navBtn =');
  assert.ok(start > 0);
  assert.match(hubNav.slice(start, start + 400), /type="button"/);

  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('hunt after Settings dialog name looks past keep-mount inert and leftover-18', () => {
  const spec = read('debug/scenarios/e2e-after-settings-dialog-independent-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /account-settings-title/);
  assert.match(spec, /unnamedDialogs/);
  assert.match(spec, /AFTER_SETTINGS_DIALOG_INDEPENDENT_HUNT/);
  assert.doesNotMatch(spec, /data-pages-context-menu/);
  assert.doesNotMatch(spec, /data-annotation-context-menu/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
});
