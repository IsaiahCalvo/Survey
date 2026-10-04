import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readVisibleViewportBox } from '../src/home/useVisibleViewportBox.js';

// Polish round 6: on a 375x667 phone with the keyboard up, the Share dialog's
// Send button sat under the keyboard (measured 520..548 with only 367px
// visible) and could not be scrolled to. The overlay now takes the visible
// part of the screen, the dialog is capped to it, and its body scrolls.

test('nothing hidden -> null (plain full-window layout at rest)', () => {
  assert.equal(readVisibleViewportBox({ innerHeight: 667, visualViewport: { height: 667, offsetTop: 0 } }), null);
  assert.equal(readVisibleViewportBox({ innerHeight: 667 }), null);
});

test('keyboard up -> the visible box', () => {
  assert.deepEqual(
    readVisibleViewportBox({ innerHeight: 667, visualViewport: { height: 367, offsetTop: 0 } }),
    { top: 0, height: 367 },
  );
  assert.deepEqual(
    readVisibleViewportBox({ innerHeight: 844, visualViewport: { height: 500.4, offsetTop: 40.2 } }),
    { top: 40, height: 500 },
  );
});

test('Share dialog follows the visible box and scrolls its body', () => {
  const src = readFileSync(new URL('../src/home/ShareModal.jsx', import.meta.url), 'utf8');
  assert.match(src, /const visibleBox = useVisibleViewportBox\(\);/);
  assert.match(src, /visibleBox \? \{ bottom: 'auto', top: visibleBox\.top, height: visibleBox\.height \}/);
  assert.match(src, /maxHeight: 'calc\(100% - 16px\)', display: 'flex', flexDirection: 'column'/);
  assert.match(src, /ref=\{bodyRef\}[^>]*minHeight: 0, overflowY: 'auto'/);
});
