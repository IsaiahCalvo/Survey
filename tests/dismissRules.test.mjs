// Behavioural tests for the owner's dismiss rules R1–R6 (2026-09-23):
// src/components/dismissRules.js, docs/DISMISS-RULES.md.
//
// One jsdom window for the whole file: the rules install their two
// window/capture guards once, at module load, exactly as in the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!doctype html><body>
  <div id="toolbar">
    <button id="width-trigger" aria-haspopup="dialog">2 pt</button>
    <button id="line-tool">Line</button>
    <button id="picker-trigger">Colour</button>
  </div>
  <div id="picker"><input id="hex" /><button id="swatch">Red</button></div>
  <div id="scroller" data-mobile-pdf-surface="false" data-interaction-mode="TextSelection">
    <div class="survey-pdfjs-page-div" id="v_pageDiv_0">
      <canvas id="page-canvas"></canvas>
      <svg id="layer"><g data-annotation-index="3"><rect id="anno" width="10" height="10"></rect></g></svg>
    </div>
  </div>
  <div id="editor" data-text-edit-overlay><div id="editable" contenteditable="true" tabindex="0">abc</div></div>
  <div data-rich-text-toolbar><button id="bold">B</button></div>
</body>`, { pretendToBeVisual: true, url: 'http://localhost/' });

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;

const {
  swallowRestOfPress,
  isBarePagePress,
  recentPressedControl,
  registerLightPopover,
  watchLightPopover,
} = await import('../src/components/dismissRules.js');

const $ = (id) => document.getElementById(id);

/** A full press: pointerdown then click, like a mouse or a tap. */
function pointer(type, el, { button = 0, pointerType = 'mouse', isPrimary = true } = {}) {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button, clientX: 5, clientY: 5 });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  Object.defineProperty(event, 'isPrimary', { value: isPrimary });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  el.dispatchEvent(event);
  return event;
}

/** A full press: pointerdown, pointerup, click — like a mouse click or a tap. */
function press(el, options = {}) {
  const down = pointer('pointerdown', el, options);
  const up = pointer('pointerup', el, options);
  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true, button: options.button ?? 0 });
  el.dispatchEvent(click);
  return { down, up, click };
}

function escape() {
  const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event;
}

/** Counts what reaches the "canvas" and the buttons. */
function spies() {
  const seen = { canvasDown: 0, clicks: [] };
  const onCanvas = () => { seen.canvasDown += 1; };
  const onClick = (event) => { seen.clicks.push(event.target.id); };
  $('layer').addEventListener('pointerdown', onCanvas);
  document.body.addEventListener('click', onClick);
  return {
    seen,
    stop: () => {
      $('layer').removeEventListener('pointerdown', onCanvas);
      document.body.removeEventListener('click', onClick);
    },
  };
}

const openPicker = () => {
  const closed = [];
  const stop = watchLightPopover({
    contains: (target) => $('picker').contains(target),
    close: (_event, reason) => closed.push(reason),
  });
  return { closed, stop };
};

test('R1: picker open, press the Line tool -> picker closes AND the tool button still gets its press', () => {
  const s = spies();
  const picker = openPicker();
  try {
    const { down, click } = press($('line-tool'));
    assert.deepEqual(picker.closed, ['outside']);
    assert.equal(down.defaultPrevented, false);
    assert.equal(click.defaultPrevented, false);
    assert.deepEqual(s.seen.clicks, ['line-tool']);
  } finally { picker.stop(); s.stop(); }
});

test('R1/R6: picker open, press the width trigger -> picker closes and the trigger opens in the same press', () => {
  const s = spies();
  const picker = openPicker();
  try {
    press($('width-trigger'));
    assert.deepEqual(picker.closed, ['outside']);
    assert.deepEqual(s.seen.clicks, ['width-trigger']);
  } finally { picker.stop(); s.stop(); }
});

test('R1: picker open, press an annotation -> the press reaches the canvas (it selects), picker closes', () => {
  const s = spies();
  const picker = openPicker();
  try {
    const { down } = press($('anno'));
    assert.equal(down.defaultPrevented, false);
    assert.equal(s.seen.canvasDown, 1);
    assert.deepEqual(picker.closed, ['outside']);
  } finally { picker.stop(); s.stop(); }
});

test('R2: picker open, press the bare page -> only closes; no pointerdown and no click reach the page', () => {
  const s = spies();
  const picker = openPicker();
  try {
    const { down, click } = press($('layer'));
    assert.equal(down.defaultPrevented, true);
    assert.equal(s.seen.canvasDown, 0, 'no stroke / shape / text box can start');
    assert.equal(click.defaultPrevented, true);
    assert.deepEqual(s.seen.clicks, []);
    assert.deepEqual(picker.closed, ['bare-page']);
  } finally { picker.stop(); s.stop(); }
});

test('R2 control: nothing open -> a bare-page press is the page\'s as always', () => {
  const s = spies();
  try {
    const { down } = press($('layer'));
    assert.equal(down.defaultPrevented, false);
    assert.equal(s.seen.canvasDown, 1);
  } finally { s.stop(); }
});

test('R2: Pan keeps panning, right-click keeps its menu, a second finger keeps its pinch', () => {
  const s = spies();
  const picker = openPicker();
  try {
    $('scroller').setAttribute('data-interaction-mode', 'Pan');
    assert.equal(press($('layer')).down.defaultPrevented, false);
    $('scroller').setAttribute('data-interaction-mode', 'TextSelection');
    picker.closed.length = 0;
    assert.equal(press($('layer'), { button: 2 }).down.defaultPrevented, false);
    assert.equal(press($('layer'), { pointerType: 'touch', isPrimary: false }).down.defaultPrevented, false);
  } finally {
    $('scroller').setAttribute('data-interaction-mode', 'TextSelection');
    picker.stop(); s.stop();
  }
});

test('isBarePagePress: page canvas and SVG root are bare; annotations, form fields and outside the viewer are not', () => {
  const at = (el) => ({ target: el, clientX: 1, clientY: 1 });
  assert.equal(isBarePagePress(at($('page-canvas'))), true);
  assert.equal(isBarePagePress(at($('layer'))), true);
  assert.equal(isBarePagePress(at($('anno'))), false);
  assert.equal(isBarePagePress(at($('line-tool'))), false);
});

test('R3: typing in the text editor, press a tool button -> only ends the typing (commit), nothing else', () => {
  const s = spies();
  const ended = [];
  $('editable').focus();
  const stop = registerLightPopover({
    kind: 'typing',
    close: () => ended.push('close'),
    contains: (target) => Boolean(target.closest('[data-text-edit-overlay]')),
    typingField: () => $('editable'),
    endTyping: () => ended.push('commit'),
    passes: (target) => Boolean(target.closest('[data-rich-text-toolbar]')),
    escape: false,
  });
  try {
    const tool = press($('line-tool'));
    assert.equal(tool.down.defaultPrevented, true);
    assert.equal(tool.click.defaultPrevented, true);
    assert.deepEqual(ended, ['commit']);
    assert.deepEqual(s.seen.clicks, []);

    // Pressing the page while typing: commit only, no new mark.
    ended.length = 0;
    press($('layer'));
    assert.deepEqual(ended, ['commit']);
    assert.equal(s.seen.canvasDown, 0);

    // Exceptions work at once: formatting control, another popover opener,
    // another text field, and the editor itself.
    ended.length = 0;
    for (const id of ['bold', 'width-trigger', 'hex', 'editable']) {
      assert.equal(press($(id)).down.defaultPrevented, false, id);
    }
    assert.deepEqual(ended, []);
  } finally { stop(); s.stop(); }
});

test('R5: Escape closes only the topmost popover; a surface that owns Escape keeps it', () => {
  const closed = [];
  const stopA = registerLightPopover({ close: () => closed.push('A') });
  const stopB = registerLightPopover({ close: () => closed.push('B') });
  try {
    const event = escape();
    assert.deepEqual(closed, ['B']);
    assert.equal(event.defaultPrevented, true);
    stopB();
    const stopC = registerLightPopover({ close: () => closed.push('C'), escape: false });
    closed.length = 0;
    const second = escape();
    assert.deepEqual(closed, [], 'the owner of Escape on top handles it itself');
    assert.equal(second.defaultPrevented, false);
    stopC();
  } finally { stopA(); stopB(); }
});

test('toggle: the control whose press opened a popover is remembered as its opener', () => {
  press($('picker-trigger'));
  assert.equal(recentPressedControl(), $('picker-trigger'));
});

test('R2 is for open popovers only: a typing surface that is no longer typing never swallows the page', () => {
  const s = spies();
  const stop = registerLightPopover({ kind: 'typing', close: () => {}, typingField: () => null });
  try {
    const { down } = press($('layer'));
    assert.equal(down.defaultPrevented, false);
    assert.equal(s.seen.canvasDown, 1);
  } finally { stop(); s.stop(); }
});

test('swallowRestOfPress: a press held a long time still has its click swallowed (no timer while held)', async () => {
  const down = pointer('pointerdown', $('line-tool'));
  swallowRestOfPress(down);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const up = pointer('pointerup', $('line-tool'));
  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  $('line-tool').dispatchEvent(click);
  assert.equal(up.defaultPrevented, true);
  assert.equal(click.defaultPrevented, true);
});

test('swallowRestOfPress: a drag that never clicks leaves no blocker for the next tap', async () => {
  const down = pointer('pointerdown', $('line-tool'));
  swallowRestOfPress(down);
  pointer('pointermove', $('line-tool'));
  pointer('pointerup', $('line-tool'));
  await new Promise((resolve) => setTimeout(resolve, 350));
  const next = press($('line-tool'));
  assert.equal(next.down.defaultPrevented, false);
  assert.equal(next.click.defaultPrevented, false);
});

test('R3 ends the typing AND closes a popover left open beside it (its own close never sees the consumed press)', () => {
  const log = [];
  $('editable').focus();
  const picker = registerLightPopover({ close: (_e, reason) => log.push(`picker:${reason}`), contains: (t) => $('picker').contains(t) });
  const editor = registerLightPopover({
    kind: 'typing',
    close: () => log.push('editor:close'),
    contains: (t) => Boolean(t.closest('[data-text-edit-overlay]')),
    typingField: () => $('editable'),
    endTyping: () => log.push('editor:commit'),
    escape: false,
  });
  try {
    press($('layer'));
    assert.deepEqual(log, ['editor:commit', 'picker:typing-ended']);
  } finally { editor(); picker(); }
});

test('R2: a Space-held temporary pan is exempt like the Pan tool', () => {
  const picker = openPicker();
  try {
    $('scroller').setAttribute('data-space-pan', 'armed');
    assert.equal(press($('layer')).down.defaultPrevented, false);
    $('scroller').setAttribute('data-space-pan', 'off');
    assert.equal(press($('layer')).down.defaultPrevented, true);
  } finally { $('scroller').removeAttribute('data-space-pan'); picker.stop(); }
});

test('toggle: a right-click forgets the last pressed control, so a context menu has no opener', () => {
  press($('picker-trigger'));
  press($('line-tool'), { button: 2 });
  assert.equal(recentPressedControl(), null);
});
