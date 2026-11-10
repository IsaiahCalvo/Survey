// A tablet gets the desktop Documents list but has no double-click and the
// "Double-click a row" hint is hidden on touch. A finger or pen tap on a row
// must open the file (a mouse click still only previews it).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/home/DocumentsLedger.jsx', import.meta.url), 'utf8');

test('a touch or pen tap on a desktop Documents row opens the file', () => {
  const click = src.slice(src.indexOf('const onDesktopRowClick'), src.indexOf('const clearDesktopSelection'));
  assert.match(click, /pointerType === 'touch' \|\| pointerType === 'pen'/);
  assert.match(click, /onOpenDocument\(d\.raw\)/);
  assert.match(src, /onPointerDown=\{onRowPointerDown\}\s*\n\s*onClick=\{\(event\) => onDesktopRowClick\(event, d\)\}/);
});
