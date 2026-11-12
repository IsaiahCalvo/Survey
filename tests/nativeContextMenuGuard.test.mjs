/*
 * nativeContextMenuGuard.test.mjs — owner 2026-11-12: "When I right-click on
 * the title, I see Google Chrome's native ... context menu ... I don't want
 * that really ever showing up ... either disable it or make a proper context
 * menu show up ... If it's just empty space, no right-click menu should show
 * up."
 *
 * Pins the last-resort rules (src/utils/nativeContextMenuGuard.js), the text
 * field / selection / link menus (src/utils/appContextMenuItems.js), and the
 * wiring (main.jsx installs it; Comments and Markups rows got menus).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  APP_CONTEXT_MENU_EVENT,
  installNativeContextMenuGuard,
  isContextMenuPress,
  linkOf,
  nativeMenuPlan,
} from '../src/utils/nativeContextMenuGuard.js';
import { forgetContextMenuPress, isTextEntryField, isTypingTarget, noteContextMenuPress, pointInsideSelection, listMenuPointFrom } from '../src/utils/listContextMenu.js';
import { textFieldMenuItems, selectionMenuItems, linkMenuItems, spellingMenuItems } from '../src/utils/appContextMenuItems.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function el({ tagName = 'DIV', type, readOnly = false, disabled = false, contentEditable = false, href = null, parent = null } = {}) {
  const node = {
    tagName, type, readOnly, disabled, isContentEditable: contentEditable, parent,
    getAttribute: (name) => (name === 'href' ? href : name === 'type' ? type ?? null : null),
    contains: (other) => { for (let n = other; n; n = n.parent) if (n === node) return true; return false; },
    closest: (selector) => {
      for (let n = node; n; n = n.parent) {
        if (selector === 'a[href]' && n.tagName === 'A' && n.getAttribute('href') != null) return n;
        if (selector.startsWith('[contenteditable]') && n.isContentEditable && n.isHost) return n;
      }
      return null;
    },
  };
  if (href != null) node.href = href.startsWith('http') ? href : `https://surveytool.app/${href.replace(/^\//, '')}`;
  return node;
}

function ctx(target, { x = 50, y = 50, pointerType = 'mouse', defaultPrevented = false } = {}) {
  return { target, clientX: x, clientY: y, pointerType, defaultPrevented };
}

const noSelection = { isCollapsed: true, rangeCount: 0, toString: () => '' };
function selectionAt(text, rect = { left: 0, right: 100, top: 0, bottom: 20 }) {
  return { isCollapsed: false, rangeCount: 1, toString: () => text, getRangeAt: () => ({ getClientRects: () => [rect] }) };
}

test('empty space, a toolbar or a label: the browser menu is blocked and nothing opens', () => {
  assert.deepEqual(nativeMenuPlan(ctx(el()), { touch: false, selection: noSelection }), { block: true, menu: null });
  assert.deepEqual(nativeMenuPlan(ctx(el({ tagName: 'BUTTON' })), { touch: false, selection: noSelection }), { block: true, menu: null });
});

test('a surface that answered already (row, mark, tab menus) is left alone', () => {
  assert.deepEqual(nativeMenuPlan(ctx(el(), { defaultPrevented: true }), { touch: false, selection: noSelection }), { block: false, menu: null });
});

test('a text field keeps its spelling fixes: the browser menu on the web, Survey menu with fixes in the desktop app', () => {
  const input = el({ tagName: 'INPUT', type: 'text' });
  // Web: only the browser knows the misspelled word, so its menu shows here.
  const web = nativeMenuPlan(ctx(input), { touch: false, selection: noSelection, desktopSpelling: false });
  assert.equal(web.block, false);
  assert.equal(web.menu, null);
  assert.equal(web.nativeField, input);
  // Desktop app: left alone so Chromium looks the word up, then Survey's menu opens.
  const desktop = nativeMenuPlan(ctx(input), { touch: false, selection: noSelection, desktopSpelling: true });
  assert.equal(desktop.block, false);
  assert.deepEqual(desktop.awaitSpelling, { kind: 'field', field: input });
  for (const tagName of ['TEXTAREA']) assert.equal(isTextEntryField(el({ tagName })), true);
  assert.equal(isTextEntryField(el({ contentEditable: true })), true);
  // Not text fields: a checkbox, a slider, a read-only or disabled field.
  assert.equal(isTextEntryField(el({ tagName: 'INPUT', type: 'checkbox' })), false);
  assert.equal(isTextEntryField(el({ tagName: 'INPUT', type: 'range' })), false);
  assert.equal(isTextEntryField(el({ tagName: 'INPUT', type: 'text', readOnly: true })), false);
  assert.equal(isTextEntryField(el({ tagName: 'INPUT', type: 'text', disabled: true })), false);
});

test('selected text gets Copy; a link gets Open link / Copy link', () => {
  const plan = nativeMenuPlan(ctx(el(), { x: 40, y: 10 }), { touch: false, selection: selectionAt('Room 101') });
  assert.deepEqual(plan, { block: true, menu: { kind: 'selection', text: 'Room 101' } });
  // A selection elsewhere on the screen is not under the pointer.
  assert.equal(pointInsideSelection(ctx(el(), { x: 400, y: 300 }), selectionAt('Room 101')), false);

  const link = el({ tagName: 'A', href: 'https://example.com/terms' });
  const linkPlan = nativeMenuPlan(ctx(el({ tagName: 'SPAN', parent: link })), { touch: false, selection: noSelection });
  assert.deepEqual(linkPlan, { block: true, menu: { kind: 'link', href: 'https://example.com/terms' } });
  // A "#" or javascript: link is a button: no link menu.
  assert.equal(linkOf(el({ tagName: 'A', href: '#' })), null);
  assert.equal(linkOf(el({ tagName: 'A', href: 'javascript:void(0)' })), null);
});

test('a held finger: no menu over the app, but text stays with the system selection bar', () => {
  assert.deepEqual(nativeMenuPlan(ctx(el(), { pointerType: 'touch' }), { touch: true, selection: noSelection }), { block: true, menu: null });
  assert.deepEqual(nativeMenuPlan(ctx(el({ tagName: 'INPUT', type: 'text' }), { pointerType: 'touch' }), { touch: true, selection: noSelection }), { block: false, menu: null });
});

test('the right-press (or Control-click on a Mac) is the menu press', () => {
  assert.equal(isContextMenuPress({ button: 2 }, false), true);
  assert.equal(isContextMenuPress({ button: 0, ctrlKey: true }, true), true);
  assert.equal(isContextMenuPress({ button: 0, ctrlKey: true }, false), false);
  assert.equal(isContextMenuPress({ button: 0 }, true), false);
});

test('a list row does not take a right-click on text the person selected (the Copy menu does)', () => {
  const saved = globalThis.window;
  globalThis.window = { getSelection: () => selectionAt('Kitchen') };
  try {
    const event = { ...ctx(el(), { x: 10, y: 10 }), preventDefault() {}, stopPropagation() {} };
    assert.equal(listMenuPointFrom(event, { activeElement: null }), null);
  } finally {
    globalThis.window = saved;
  }
});

function fakeWindow({ electronAPI } = {}) {
  const listeners = {};
  const events = [];
  const timers = [];
  const win = {
    document: { activeElement: null },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type) => { delete listeners[type]; },
    dispatchEvent: (event) => events.push(event),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    getSelection: () => noSelection,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    electronAPI,
  };
  return { win, listeners, events, timers };
}

test('installed guard (web): empty space blocked, a text field gets focus and the browser menu', () => {
  const { win, listeners, events } = fakeWindow();
  const input = el({ tagName: 'INPUT', type: 'text' });
  input.focus = () => { win.document.activeElement = input; };
  const savedWindow = globalThis.window;
  globalThis.window = win;
  try {
    const teardown = installNativeContextMenuGuard(win);
    let prevented = false;
    listeners.contextmenu({ ...ctx(el()), preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(events.length, 0);
    // The right-press is left alone (it picks the word the fixes are for).
    let pressPrevented = false;
    listeners.mousedown({ button: 2, target: input, preventDefault: () => { pressPrevented = true; } });
    assert.equal(pressPrevented, false);
    prevented = false;
    listeners.contextmenu({ ...ctx(input), preventDefault: () => { prevented = true; } });
    assert.equal(prevented, false);
    assert.equal(win.document.activeElement, input);
    assert.equal(events.length, 0);
    teardown();
    assert.equal(listeners.contextmenu, undefined);
  } finally {
    globalThis.window = savedWindow;
    forgetContextMenuPress();
  }
});

test('installed guard (desktop app): the text menu opens with Chromium\'s spelling fixes, or without after a wait', () => {
  let spellingListener = null;
  let unsubscribed = false;
  const electronAPI = { onEditableContextMenu: (fn) => { spellingListener = fn; return () => { unsubscribed = true; }; } };
  const { win, listeners, events, timers } = fakeWindow({ electronAPI });
  const input = el({ tagName: 'INPUT', type: 'text' });
  input.focus = () => { win.document.activeElement = input; };
  const savedWindow = globalThis.window;
  globalThis.window = win;
  try {
    const teardown = installNativeContextMenuGuard(win);
    let prevented = false;
    listeners.contextmenu({ ...ctx(input, { x: 70, y: 80 }), preventDefault: () => { prevented = true; } });
    assert.equal(prevented, false); // Chromium must see it to look the word up.
    assert.equal(events.length, 0);
    spellingListener({ misspelledWord: 'recieve', suggestions: ['receive'] });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, APP_CONTEXT_MENU_EVENT);
    assert.equal(events[0].detail.kind, 'field');
    assert.equal(events[0].detail.x, 70);
    assert.deepEqual(events[0].detail.spelling, { misspelledWord: 'recieve', suggestions: ['receive'] });
    // No answer: it opens anyway once the wait runs out.
    listeners.contextmenu({ ...ctx(input), preventDefault() {} });
    timers.at(-1)();
    assert.equal(events.length, 2);
    assert.equal(events[1].detail.spelling, undefined);
    teardown();
    assert.equal(unsubscribed, true);
  } finally {
    globalThis.window = savedWindow;
  }
});

test('a name field focused only by the right-press is not "being typed in" (Spaces title opens the row menu)', () => {
  const input = el({ tagName: 'INPUT', type: 'text' });
  const event = ctx(input);
  noteContextMenuPress(null, 1000);
  assert.equal(isTypingTarget(event, input, 1100), false);
  noteContextMenuPress(input, 2000);
  assert.equal(isTypingTarget(event, input, 2100), true);
  // An old press is forgotten: then focus now decides (the keyboard's menu key).
  assert.equal(isTypingTarget(event, input, 9000), true);
  forgetContextMenuPress();
});

test('spelling rows: fixes first, then Add to dictionary; nothing without a misspelled word', () => {
  const calls = [];
  const api = { replaceMisspelling: (w) => calls.push(['replace', w]), addWordToDictionary: (w) => calls.push(['add', w]) };
  const rows = spellingMenuItems(null, { misspelledWord: 'recieve', suggestions: ['receive', 'relieve'] }, api);
  assert.deepEqual(rows.filter((r) => !r.separator).map((r) => r.label), ['receive', 'relieve', 'Add to dictionary']);
  rows[0].onClick();
  rows[2].onClick();
  assert.deepEqual(calls, [['replace', 'receive'], ['add', 'recieve']]);
  const none = spellingMenuItems(null, { misspelledWord: 'zzqx', suggestions: [] }, api);
  assert.equal(none[0].label, 'No spelling suggestions');
  assert.equal(none[0].disabled, true);
  assert.deepEqual(spellingMenuItems(null, { misspelledWord: '' }, api), []);
  assert.deepEqual(spellingMenuItems(null, null, api), []);
});

test('spelling is on in the desktop app, in text marks and Survey Marker names; the page menu leaves a typed-in box alone', () => {
  const main = read('src/electron-main.js');
  assert.match(main, /spellcheck: true/);
  assert.match(main, /webContents\.on\('context-menu'/);
  assert.match(main, /replaceMisspelling\(word\)/);
  assert.match(main, /addWordToSpellCheckerDictionary/);
  const preload = read('src/preload.js');
  assert.match(preload, /onEditableContextMenu/);
  assert.doesNotMatch(read('src/components/TextEditOverlay.jsx'), /spellCheck=\{false\}/);
  assert.doesNotMatch(read('src/components/SurveyMarkerPlacementDialog.jsx'), /spellCheck=\{false\}/);
  assert.match(read('src/utils/contextMenuDiagnostics.js'), /if \(isTypingTarget\(e\)\)/);
});

test('menu rows: Cut and Copy need a selection, password never copies, links open and copy', () => {
  const field = { type: 'text', value: 'Kitchen', selectionStart: 0, selectionEnd: 0 };
  const rows = textFieldMenuItems(field);
  assert.deepEqual(rows.map((r) => r.label), ['Cut', 'Copy', 'Paste', 'Select all']);
  assert.equal(rows[0].disabled, true);
  assert.equal(rows[1].disabled, true);
  assert.equal(rows[2].disabled, undefined);
  const picked = textFieldMenuItems({ ...field, selectionEnd: 3 });
  assert.equal(picked[0].disabled, false);
  const secret = textFieldMenuItems({ ...field, type: 'password', selectionEnd: 3 });
  assert.equal(secret[0].disabled, true);
  assert.equal(secret[1].disabled, true);
  assert.deepEqual(selectionMenuItems('Kitchen').map((r) => r.label), ['Copy']);
  assert.deepEqual(selectionMenuItems('   '), []);
  assert.deepEqual(linkMenuItems('https://example.com').map((r) => r.label), ['Open link', 'Copy link']);
});

test('wiring: main.jsx installs the guard and mounts the host; Comments and Markups rows have menus', () => {
  const main = read('src/main.jsx');
  assert.match(main, /installNativeContextMenuGuard\(window\)/);
  assert.match(main, /createRoot\(contextMenuRoot\)\.render\(<AppContextMenuHost \/>\)/);
  const comments = read('src/sidebar/CommentsPanel.jsx');
  assert.match(comments, /listMenuPointFrom\(event\)/);
  assert.match(comments, /label: 'Copy link'/);
  const markups = read('src/sidebar/MarkupsPanel.jsx');
  assert.match(markups, /label: 'Go to mark'/);
  // The host keeps focus in the field (no focus trap): a blur would save and
  // close a rename field before Paste could reach it.
  const host = read('src/components/AppContextMenuHost.jsx');
  assert.doesNotMatch(host, /useFocusTrap/);
  assert.match(host, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/);
});
