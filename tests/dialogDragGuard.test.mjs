import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installDialogDragGuard, isDragOutOfDialog } from '../src/utils/dialogDragGuard.js';

// 2026-11-16: dragging to select the text in a Settings field and letting go
// outside the dialog closed it. The browser gives that click to the overlay
// (the nearest element holding both ends of the drag), and the overlay closes
// on click. The guard drops such a click; a plain click outside still closes.

function page() {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="overlay"><div id="dialog" role="dialog"><input id="field"><button id="ok">OK</button></div></div>
    <button id="outside">Outside</button>
  </body>`);
  const { document } = dom.window;
  const closes = [];
  document.getElementById('overlay').addEventListener('click', () => closes.push('overlay'));
  const byId = (id) => document.getElementById(id);
  const press = (el) => el.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  const click = (el, detail = 1) => {
    const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail });
    el.dispatchEvent(event);
    return event;
  };
  return { document, closes, byId, press, click };
}

test('a drag from inside a dialog that ends on its overlay does not close it', () => {
  const { document, closes, byId, press, click } = page();
  installDialogDragGuard(document);
  press(byId('field'));
  const event = click(byId('overlay'));
  assert.deepEqual(closes, []);
  assert.equal(event.defaultPrevented, true);
});

test('a plain click on the overlay still closes the dialog', () => {
  const { document, closes, byId, press, click } = page();
  installDialogDragGuard(document);
  press(byId('overlay'));
  click(byId('overlay'));
  assert.deepEqual(closes, ['overlay']);
});

test('a click that starts and ends inside the dialog goes through', () => {
  const { document, byId, press, click } = page();
  installDialogDragGuard(document);
  let ok = 0;
  byId('ok').addEventListener('click', () => { ok += 1; });
  press(byId('field'));
  click(byId('ok'));
  assert.equal(ok, 1);
});

test('one swallowed click does not eat the next one', () => {
  const { document, closes, byId, press, click } = page();
  installDialogDragGuard(document);
  press(byId('field'));
  click(byId('overlay'));
  click(byId('overlay'));
  assert.deepEqual(closes, ['overlay']);
});

test('keyboard and code clicks (detail 0) are never dropped', () => {
  const { document, closes, byId, press, click } = page();
  installDialogDragGuard(document);
  press(byId('field'));
  click(byId('overlay'), 0);
  assert.deepEqual(closes, ['overlay']);
});

test('the returned function removes the guard', () => {
  const { document, closes, byId, press, click } = page();
  const remove = installDialogDragGuard(document);
  remove();
  press(byId('field'));
  click(byId('overlay'));
  assert.deepEqual(closes, ['overlay']);
});

test('isDragOutOfDialog: only a press inside a dialog that lands outside it', () => {
  const { byId } = page();
  assert.equal(isDragOutOfDialog(byId('field'), byId('overlay')), true);
  assert.equal(isDragOutOfDialog(byId('field'), byId('ok')), false);
  assert.equal(isDragOutOfDialog(byId('outside'), byId('overlay')), false);
  assert.equal(isDragOutOfDialog(null, byId('overlay')), false);
});
