// Nightly 'paste-in-place-key' (Drawboard PDF Pro push 2026-11-12): Ctrl+Shift+V
// pastes the marks clipboard at its original spot, like the page menu's
// Paste in place row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import { isPasteInPlaceKey, pageNumberAtPoint } from '../src/utils/pasteInPlaceKey.js';

test('isPasteInPlaceKey takes Ctrl/Cmd+Shift+V only', () => {
  assert.equal(isPasteInPlaceKey({ ctrlKey: true, shiftKey: true, key: 'V', code: 'KeyV' }), true);
  assert.equal(isPasteInPlaceKey({ metaKey: true, shiftKey: true, key: 'v' }), true);
  // A layout where the V place types another letter still counts.
  assert.equal(isPasteInPlaceKey({ ctrlKey: true, shiftKey: true, key: 'Ü', code: 'KeyV' }), true);
  assert.equal(isPasteInPlaceKey({ ctrlKey: true, key: 'v' }), false);
  assert.equal(isPasteInPlaceKey({ shiftKey: true, key: 'V' }), false);
  assert.equal(isPasteInPlaceKey({ ctrlKey: true, shiftKey: true, altKey: true, key: 'V' }), false);
  assert.equal(isPasteInPlaceKey(null), false);
});

test('pageNumberAtPoint reads the overlay page first, then the page div', () => {
  const node = (attrs, parent = null) => ({
    getAttribute: (k) => attrs[k] ?? null,
    closest(sel) {
      for (let n = this; n; n = n.parent) {
        if (sel.split(',').some((s) => n.matches(s.trim()))) return n;
      }
      return null;
    },
    matches(s) {
      if (s === '.survey-pdfjs-page-div') return attrs.class === 'survey-pdfjs-page-div';
      const m = s.match(/^\[([\w-]+)\]$/);
      return m ? attrs[m[1]] != null : false;
    },
    parent,
  });
  const overlay = node({ 'data-diag-svg-wrapper': '3' });
  assert.equal(pageNumberAtPoint(0, 0, { elementFromPoint: () => node({}, overlay) }), 3);
  const pageDiv = node({ class: 'survey-pdfjs-page-div', 'data-page-number': '2' });
  assert.equal(pageNumberAtPoint(0, 0, { elementFromPoint: () => node({}, pageDiv) }), 2);
  assert.equal(pageNumberAtPoint(0, 0, { elementFromPoint: () => node({}) }), null);
  assert.equal(pageNumberAtPoint(0, 0, { elementFromPoint: () => null }), null);
});

test('the viewer arms its own steady listener behind the beta flag', () => {
  assert.equal(FEATURE_FLAGS['paste-in-place-key']?.stage, 'beta');
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(src, /const \[pasteInPlaceKeyOn\] = useState\(\(\) => isFeatureOn\('paste-in-place-key'\)\);/);
  assert.match(src, /if \(!isPasteInPlaceKey\(e\) \|\| e\.defaultPrevented\) return;/);
  assert.match(src, /\}, \[pasteInPlaceKeyOn\]\);/);
  // Same rule as the menu row: offset 0, 0, and a cut clipboard empties.
  assert.match(src, /commitFamilyPaste\(pageNumber, clip, 0, 0\)\);\s*if \(done && clip\.mode === 'cut'\) setFamilyClipboard\(null\);/);
  const mig = readFileSync(new URL('../supabase/migrations/20261112098000_paste_in_place_key_flag.sql', import.meta.url), 'utf8');
  assert.match(mig, /'paste-in-place-key', 'off'/);
});

test('the dev-only renderer toggle yields Ctrl+Shift+V while the flag is on', () => {
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(src, /if \(!import\.meta\.env\.DEV \|\| isFeatureOn\('paste-in-place-key'\)\) return undefined;\s*const handleRendererToggle/);
});
