// KAL-503: with a document open, Space never pressed a focused button, tab,
// switch or menu item (Settings, menus, other dialogs). The viewer's
// hold-Space-to-pan listener (window, capture) took every Space outside text
// fields. Space now goes to such a control; on the page it still pans.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createPointerFocusTracker, spaceBelongsToFocusedControl } from '../src/utils/spaceKeyControls.js';

const CONTAINER = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');

const { document } = new JSDOM(`<!doctype html><body>
  <div id="toolbar"><button id="tool"><span id="tool-glyph">*</span></button>
    <div id="row" role="button" tabindex="0">Pages card</div>
    <div id="side-switch" role="switch" tabindex="0"></div></div>
  <div role="dialog" aria-modal="true">
    <button id="close">Close</button>
    <button id="tab" role="tab">Connected services</button>
    <span id="toggle" role="switch" tabindex="0"></span>
    <div id="box" role="checkbox" tabindex="0"></div>
    <div id="dialog-body" tabindex="-1">text</div>
  </div>
  <div role="menu"><button id="item" role="menuitem">Close tab</button><div id="div-item" role="menuitemradio" tabindex="-1"></div></div>
  <details><summary id="sum">More</summary></details>
  <div id="page" tabindex="-1"></div>
</body>`).window;
const $ = (id) => document.getElementById(id);

test('Space goes to controls in a dialog or menu, however they got focus', () => {
  for (const id of ['close', 'tab', 'toggle', 'box', 'item', 'div-item']) {
    assert.equal(spaceBelongsToFocusedControl($(id)), true, id);
    assert.equal(spaceBelongsToFocusedControl($(id), { pointerFocused: true }), true, `${id} clicked`);
  }
});

test('a real button or summary the keyboard moved to gets Space; one just clicked does not', () => {
  assert.equal(spaceBelongsToFocusedControl($('tool')), true);
  assert.equal(spaceBelongsToFocusedControl($('sum')), true);
  assert.equal(spaceBelongsToFocusedControl($('tool'), { pointerFocused: true }), false, 'clicked tool: Space pans');
});

test('the page, plain containers and role-only rows beside the page keep Space for panning', () => {
  for (const el of [$('page'), $('dialog-body'), $('row'), $('side-switch'), document.body, null, undefined]) {
    assert.equal(spaceBelongsToFocusedControl(el), false, el?.id || String(el));
  }
});

test('the tracker knows a button was focused by a click until focus moves elsewhere', () => {
  const t = createPointerFocusTracker();
  t.onPointerDown({ target: $('tool-glyph') });
  t.onFocusIn({ target: $('tool') });
  assert.equal(t.isPointerFocused($('tool')), true, 'press on the glyph inside the button');
  t.onFocusIn({ target: $('close') });
  assert.equal(t.isPointerFocused($('tool')), false, 'Tab away forgets the click');
  assert.equal(t.isPointerFocused($('close')), false);
  assert.equal(t.isPointerFocused(null), false);
});

test('the viewer lets those presses through and keeps the rest for panning', () => {
  const start = CONTAINER.indexOf('const activateSpacePan = (event) => {');
  const keydown = CONTAINER.slice(start, CONTAINER.indexOf('const releaseSpacePan', start));
  const gate = keydown.indexOf('spaceBelongsToFocusedControl(');
  assert.ok(gate > 0, 'keydown asks spaceBelongsToFocusedControl');
  assert.ok(gate < keydown.indexOf('event.preventDefault()'), 'and returns before preventDefault');
  const keyup = CONTAINER.slice(CONTAINER.indexOf('const releaseSpacePan', start), CONTAINER.indexOf('const onVisibilityChange', start));
  assert.match(keyup, /if \(event\?\.type === 'keyup' && !passedToControl\) \{\s*event\.preventDefault\(\);/,
    'the key-up of a press that went to a control is not cancelled (a button clicks on key-up)');
  for (const type of ['pointerdown', 'focusin']) {
    assert.match(CONTAINER, new RegExp(`window\\.addEventListener\\('${type}', pointerFocus\\.\\w+, true\\)`));
    assert.match(CONTAINER, new RegExp(`window\\.removeEventListener\\('${type}', pointerFocus\\.\\w+, true\\)`));
  }
  // Text fields were already left alone, and still are.
  assert.match(keydown, /if \(isEditableTarget\(event\.target\) \|\| isEditableTarget\(document\.activeElement\)\) return;/);
});
