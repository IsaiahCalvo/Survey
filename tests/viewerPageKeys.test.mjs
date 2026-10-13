import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { viewerPageKeyAction, insideScrollBox } from '../src/utils/viewerPageKeys.js';

// KAL-444: the sheet lists Home / End / PgUp / PgDn, and they only worked after
// a click on the page. They now turn pages from anywhere a key is not owned.
const body = { tagName: 'BODY', parentElement: { tagName: 'HTML', parentElement: null } };
const noScroll = () => ({ overflowY: 'visible' });
const k = (key, over = {}) => ({ key, ...over });

test('each key maps to its page move when focus rests on the body', () => {
  assert.equal(viewerPageKeyAction(k('Home'), body, noScroll), 'first');
  assert.equal(viewerPageKeyAction(k('End'), body, noScroll), 'last');
  assert.equal(viewerPageKeyAction(k('PageUp'), body, noScroll), 'previous');
  assert.equal(viewerPageKeyAction(k('PageDown'), body, noScroll), 'next');
  assert.equal(viewerPageKeyAction(k('PageDown'), null, noScroll), 'next');
});

test('a toolbar button with focus does not stop the keys', () => {
  const button = { tagName: 'BUTTON', parentElement: { tagName: 'DIV', parentElement: body } };
  assert.equal(viewerPageKeyAction(k('End'), button, noScroll), 'last');
});

test('other keys and any modifier are left alone', () => {
  assert.equal(viewerPageKeyAction(k('ArrowDown'), body, noScroll), null);
  for (const mod of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(viewerPageKeyAction(k('End', { [mod]: true }), body, noScroll), null, mod);
  }
  assert.equal(viewerPageKeyAction(k('End', { defaultPrevented: true }), body, noScroll), null);
});

test('text fields, editors, menus and dialogs keep Home and End', () => {
  assert.equal(viewerPageKeyAction(k('Home'), { tagName: 'INPUT', type: 'text' }, noScroll), null);
  assert.equal(viewerPageKeyAction(k('End'), { tagName: 'TEXTAREA' }, noScroll), null);
  assert.equal(viewerPageKeyAction(k('End'), { tagName: 'DIV', isContentEditable: true }, noScroll), null);
  const inMenu = { tagName: 'BUTTON', closest: (sel) => (sel.includes('[role="menu"]') ? {} : null) };
  assert.equal(viewerPageKeyAction(k('End'), inMenu, noScroll), null);
});

test('focus inside a box that scrolls lets the browser scroll that box', () => {
  const list = { tagName: 'DIV', scrollHeight: 900, clientHeight: 300, parentElement: body };
  const row = { tagName: 'DIV', parentElement: list };
  const style = (el) => ({ overflowY: el === list ? 'auto' : 'visible' });
  assert.equal(insideScrollBox(row, style), true);
  assert.equal(viewerPageKeyAction(k('End'), row, style), null);
  const shortList = { ...list, scrollHeight: 300 };
  assert.equal(insideScrollBox({ tagName: 'DIV', parentElement: shortList }, style), false);
});

test('the viewer acts only while its tab is on screen', () => {
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /const pageKeyAction = isActive !== false \? viewerPageKeyAction\(e, activeElement\) : null;/);
});
