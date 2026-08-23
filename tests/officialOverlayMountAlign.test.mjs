import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Official leftover after Home `?` singleton (`afac0655` / `8373deda`).
// Dedicated overlay contracts already required the `?testPdf=` gate.
// keyboardShortcutMatrix + mobileChromeHitTargets still required the
// pre-gate mount and official-failed 2 / 38. Distinct from leftover-18 /
// rail-toggle / dismiss-family / Home `?` product replay / isolated 8448.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const LIVE_MOUNT = '!isViewerVisible && !isDevTestPdfRoute && <KeyboardShortcutsOverlay';
const STALE_MOUNT = '!isViewerVisible && <KeyboardShortcutsOverlay />';

test('live AppShell skips Home overlay on ?testPdf=; DevTestRoute remounts one', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /isDevTestPdfRoute/);
  assert.match(shell, /has\('testPdf'\)/);
  assert.match(shell, new RegExp(LIVE_MOUNT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(shell, new RegExp(STALE_MOUNT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /<KeyboardShortcutsOverlay \/>/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('leftover official files no longer require the pre-gate Home overlay mount', () => {
  for (const rel of [
    'tests/keyboardShortcutMatrix.test.mjs',
    'tests/mobileChromeHitTargets.test.mjs',
    'tests/shortcutsOverlay.test.mjs',
    'tests/homeShortcutsOverlaySingleton.test.mjs',
  ]) {
    const src = read(rel);
    assert.match(src, new RegExp(LIVE_MOUNT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), rel);
    assert.match(src, /doesNotMatch\(shell, \/!isViewerVisible && <KeyboardShortcutsOverlay/);
  }
});
