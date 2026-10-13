// A Shapes / Text tool's click on the grey area around the page drops the
// tool's pick on release (PDFViewer, "Owner 2026-10-04"). The window pointerup
// listener added at pointerdown used to be removed only by a pointerup of the
// same pointer, so a press that ended in pointercancel (a touch that became a
// scroll) or a window blur left it behind, and a later unrelated release near
// the old spot dropped the pick. This runs that exact source block against a
// fake window.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const head = "if (event.type === 'pointerdown' && !isSelectFamilyTool(activeTool)) {";
const start = source.indexOf(head);
assert.ok(start > 0, 'grey-area pick-drop block found in PDFViewer.jsx');
const end = source.indexOf('        return;\n      }', start);
assert.ok(end > start);
const body = source.slice(start + head.length, end);

function fakeWindow() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    fire(type, event = {}) { [...(listeners.get(type) || [])].forEach((fn) => fn(event)); },
    count() { let n = 0; listeners.forEach((set) => { n += set.size; }); return n; },
  };
}

function press(win, event, cleared) {
  // eslint-disable-next-line no-new-func
  new Function('event', 'window', 'clearAnnotationSelectionForContextChange', body)(
    event, win, (reason) => cleared.push(reason),
  );
}

const down = { pointerId: 1, clientX: 100, clientY: 100, pointerType: 'mouse' };

test('a click on the grey area drops the pick and removes every listener', () => {
  const win = fakeWindow();
  const cleared = [];
  press(win, down, cleared);
  win.fire('pointerup', { pointerId: 1, clientX: 102, clientY: 101 });
  assert.deepEqual(cleared, ['backdrop-click']);
  assert.equal(win.count(), 0);
});

test('a pointercancel ends the press: nothing is left to drop a pick later', () => {
  const win = fakeWindow();
  const cleared = [];
  press(win, { ...down, pointerType: 'touch' }, cleared);
  win.fire('pointercancel', { pointerId: 2 });
  assert.notEqual(win.count(), 0, 'another pointer\'s cancel does not end this press');
  win.fire('pointercancel', { pointerId: 1 });
  assert.equal(win.count(), 0);
  // Later, an unrelated release of the same pointer id near the old spot.
  win.fire('pointerup', { pointerId: 1, clientX: 100, clientY: 100 });
  assert.deepEqual(cleared, []);
});

test('a window blur ends the press too', () => {
  const win = fakeWindow();
  const cleared = [];
  press(win, down, cleared);
  win.fire('blur');
  assert.equal(win.count(), 0);
  win.fire('pointerup', { pointerId: 1, clientX: 100, clientY: 100 });
  assert.deepEqual(cleared, []);
});

test('a drag on the grey area keeps the pick', () => {
  const win = fakeWindow();
  const cleared = [];
  press(win, down, cleared);
  win.fire('pointerup', { pointerId: 1, clientX: 140, clientY: 100 });
  assert.deepEqual(cleared, []);
  assert.equal(win.count(), 0);
});
