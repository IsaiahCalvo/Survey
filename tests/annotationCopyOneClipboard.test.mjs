// Every annotation Copy path writes the family clipboard - the one the page
// menu's "Paste" and "Paste in place" read - so Paste in place is live after
// any Copy (toolbar / mobile / right-click / Cmd+C, mark or callout).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url), 'utf8');

const body = (src, start) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `missing ${start}`);
  return src.slice(i, src.indexOf('}, [', i));
};

test('Paste in place reads the family clipboard', () => {
  assert.match(viewer, /pasteInPlace: \(page\) => \{\s*const clip = familyClipboardRef\.current;/);
  assert.match(menu, /canPasteInPlace: Boolean\(familyClipboard\)/);
});

test('single-mark Copy (Cmd+C, toolbar) goes through copyFamilySelection', () => {
  const fn = body(viewer, 'const handleCopyAnnotation = useCallback(');
  assert.match(fn, /copyFamilySelectionRef\.current\?\.\(pageNumber, \{ indices: \[annotationIndex\] \}, 'copy'\)/);
  assert.ok(fn.indexOf('copyFamilySelectionRef') < fn.indexOf('setClipboardAnnotation('));
  assert.match(viewer, /copyFamilySelectionRef\.current = copyFamilySelection;/);
});

test('callout Copy goes through copyFamilySelection', () => {
  const fn = body(viewer, 'const handleCopyCallout = useCallback(');
  assert.match(fn, /copyFamilySelectionRef\.current\?\.\(calloutPage, \{ calloutIds: \[calloutId\] \}, 'copy'\)/);
  assert.ok(fn.indexOf('copyFamilySelectionRef') < fn.indexOf('setClipboardCallout('));
});

test('every right-click / mobile menu Copy item calls the one copy helper', () => {
  const copyItems = [...menu.matchAll(/item\('Copy', 'copy',/g)];
  assert.ok(copyItems.length >= 4, `found ${copyItems.length} Copy items`);
  const start = (m) => menu.slice(m.index, m.index + 400);
  for (const m of copyItems) {
    const head = start(m);
    assert.ok(/copyFamilySelection|handleCopyCallout/.test(head), `Copy item bypasses the family clipboard:\n${head}`);
    const fam = head.indexOf('copyFamilySelection');
    const legacy = head.indexOf('setClipboardAnnotation(');
    if (legacy >= 0) assert.ok(fam >= 0 && fam < legacy, `legacy clipboard written first:\n${head}`);
  }
});
