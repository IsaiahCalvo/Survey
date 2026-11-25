// Tester reports batch J: #1649 (drag a signature or stamp tile onto the
// page) and #1657 (an eraser drag across a comment pin moved the pin).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('#1649: a mouse press that moves on a tile becomes a library drag; a still press stays a pick', async () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const prevWindow = globalThis.window;
  globalThis.window = dom.window;
  try {
    const placement = await import('../src/markLibrary/markLibraryPlacement.js');
    const item = { id: 'signature:a', payload: {} };
    placement.armLibraryItem(item, { keep: true });

    const press = placement.watchLibraryPressDrag({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 10, clientY: 10 }, item);
    const move = (x, y, id = 1) => {
      const ev = new dom.window.Event('pointermove');
      Object.assign(ev, { pointerId: id, clientX: x, clientY: y });
      dom.window.dispatchEvent(ev);
    };
    move(12, 11); // under the start distance
    assert.equal(press.dragging, false);
    assert.equal(placement.getLibraryDrag(), null);
    move(40, 40, 2); // another pointer
    assert.equal(press.dragging, false);
    move(30, 30);
    assert.equal(press.dragging, true);
    assert.equal(placement.getLibraryDrag()?.item, item);
    assert.equal(placement.getArmedLibraryItem(), null, 'a drag lets go of the picked item');
    placement.endLibraryDrag();

    assert.equal(placement.watchLibraryPressDrag({ button: 0, pointerType: 'touch', pointerId: 3 }, item), null, 'a finger only pans');
    assert.equal(placement.watchLibraryPressDrag({ button: 2, pointerType: 'mouse', pointerId: 4 }, item), null);
  } finally {
    globalThis.window = prevWindow;
  }
});

test('#1649: the Signature and Stamp cards and the Library panel start the drag from a tile press', () => {
  for (const file of ['src/components/SignatureCard.jsx', 'src/components/StampPickerCard.jsx']) {
    const src = read(file);
    assert.match(src, /dragPressRef\.current = phone \? null : watchLibraryPressDrag\(event, item\);/, file);
    assert.match(src, /if \(!dragged\) pick\(item\);/, file);
  }
  assert.match(read('src/markLibrary/MarkLibraryPanel.jsx'), /press\.current = watchLibraryPressDrag\(event, item\);/);
});

test('#1657: a pin takes the press only with select, pan, text select or the Pin tool', async () => {
  const src = read('src/components/pins/PagePinsLayer.jsx');
  assert.match(src, /const PIN_PRESS_TOOLS = new Set\(\['select', 'pan', 'text-select', PIN_TOOL_ID\]\);/);
  assert.match(src, /pointerEvents: passThrough \? 'none' : 'auto',/);
  assert.match(src, /const passThrough = !pinTakesPress\(activeTool\);/);
  assert.match(src, /passThrough=\{passThrough\}\n\s*onPress=\{pressPin\(pin\)\}/);
});
