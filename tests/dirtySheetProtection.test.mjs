// KAL-461 / KAL-464 — nothing typed in a phone sheet is lost to a tap outside,
// a swipe down, leaving the viewer or the app going to the background, and a
// bookmark delete is undoable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commitPanelTyping } from '../src/mobile/keyboardViewport.js';
import { commitTypingIn } from '../src/mobile/useMobileSheetMotion.js';
import { readMobileBookmarkDraft, writeMobileBookmarkDraft } from '../src/sidebar/bookmarkDrafts.js';
import {
  bookmarkDeleteMessage,
  removeBookmarkWithDescendants,
  restoreRemovedBookmarks,
} from '../src/utils/bookmarkDeleteUndo.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// A minimal element: enough of the DOM for the commit helpers.
function field({ tag = 'INPUT', type = 'text', inside = '[data-mobile-sheet]' } = {}) {
  const el = {
    nodeType: 1,
    tagName: tag,
    blurred: 0,
    getAttribute: (name) => (name === 'type' ? type : null),
    closest: (selector) => (inside && selector.includes(inside) ? {} : null),
    blur() { this.blurred += 1; },
  };
  return el;
}

test('commitPanelTyping ends the typing in a sheet or dialog field', () => {
  const sheetField = field();
  assert.equal(commitPanelTyping({ activeElement: sheetField }), true);
  assert.equal(sheetField.blurred, 1);
  const dialogField = field({ tag: 'TEXTAREA', inside: '[role="dialog"]' });
  assert.equal(commitPanelTyping({ activeElement: dialogField }), true);
  assert.equal(dialogField.blurred, 1);
});

test('commitPanelTyping leaves the on-page text box and non-text controls alone', () => {
  const pageEditor = field({ inside: null });
  assert.equal(commitPanelTyping({ activeElement: pageEditor }), false);
  assert.equal(pageEditor.blurred, 0);
  const checkbox = field({ type: 'checkbox' });
  assert.equal(commitPanelTyping({ activeElement: checkbox }), false);
  assert.equal(checkbox.blurred, 0);
  assert.equal(commitPanelTyping({ activeElement: null }), false);
});

test('commitTypingIn blurs only a field inside the closing sheet', () => {
  const inside = field();
  const sheet = { contains: (el) => el === inside };
  globalThis.document = { activeElement: inside, body: {} };
  try {
    assert.equal(commitTypingIn(sheet), true);
    assert.equal(inside.blurred, 1);
    const elsewhere = field();
    globalThis.document.activeElement = elsewhere;
    assert.equal(commitTypingIn(sheet), false);
    assert.equal(elsewhere.blurred, 0);
    assert.equal(commitTypingIn(null), false);
  } finally {
    delete globalThis.document;
  }
});

test('every way a phone sheet closes ends the typing first', () => {
  const src = read('src/mobile/useMobileSheetMotion.js');
  const requestClose = src.slice(src.indexOf('const requestClose = useCallback'), src.indexOf('requestCloseRef.current = requestClose;'));
  assert.match(requestClose, /commitTypingIn\(sheetElRef\.current\)/, 'tap outside / swipe / Done');
  const finishNow = src.slice(src.indexOf('const finishCloseNow = () => {'), src.indexOf('const finishCloseNow = () => {') + 200);
  assert.match(finishNow, /commitTypingIn\(sheetElRef\.current\)/, 'a panel taking over');
  assert.match(src, /useSheetLayoutEffect\(\(\) => \(\) => \{ commitTypingIn\(sheetElRef\.current\); \}, \[\]\)/, 'unmounted by its owner');
});

test('the app going to the background and Back to documents save panel typing', () => {
  const kb = read('src/mobile/keyboardViewport.js');
  assert.match(kb, /addEventListener\?\.\('visibilitychange', onAppHidden\)/);
  assert.match(kb, /addEventListener\?\.\('pagehide', onAppHidden\)/);
  assert.match(kb, /removeEventListener\?\.\('visibilitychange', onAppHidden\)/);
  const chrome = read('src/mobile/MobilePdfViewerChrome.jsx');
  const back = chrome.slice(chrome.indexOf('aria-label="Back to documents"'), chrome.indexOf('aria-label="Back to documents"') + 300);
  assert.match(back, /commitPanelTyping\(\);\s*onBack\?\.\(event\)/);
});

test('a half-typed bookmark line is kept per document until created or cancelled', () => {
  writeMobileBookmarkDraft('doc-a', { showCreateMenu: true, newBookmarkName: 'Stair core', newBookmarkPages: '' });
  assert.equal(readMobileBookmarkDraft('doc-a')?.newBookmarkName, 'Stair core');
  assert.equal(readMobileBookmarkDraft('doc-b'), null, 'another document starts clean');
  // An open but empty line is not worth keeping (no keyboard springing up).
  writeMobileBookmarkDraft('doc-a', { showCreateMenu: true, newBookmarkName: '', newBookmarkPages: '' });
  assert.equal(readMobileBookmarkDraft('doc-a'), null);
  writeMobileBookmarkDraft('doc-a', { showMobileFolderEditor: true, newFolderName: 'Level 2' });
  assert.equal(readMobileBookmarkDraft('doc-a')?.newFolderName, 'Level 2');
  writeMobileBookmarkDraft('doc-a', { mobileEditingBookmarkId: 'b1', mobileEditName: 'Lobby', mobileEditPage: '3' });
  assert.equal(readMobileBookmarkDraft('doc-a')?.mobileEditingBookmarkId, 'b1');
  // Created / saved / cancelled: the panel writes a closed line, the draft goes.
  writeMobileBookmarkDraft('doc-a', { showCreateMenu: false, newBookmarkName: '', mobileEditingBookmarkId: null });
  assert.equal(readMobileBookmarkDraft('doc-a'), null);
});

test('BookmarksPanel seeds its phone line from the draft and does not autofocus a restored one', () => {
  const src = read('src/sidebar/BookmarksPanel.jsx');
  assert.match(src, /readMobileBookmarkDraft\(draftKey\)/);
  assert.match(src, /writeMobileBookmarkDraft\(draftKey, \{/);
  assert.equal((src.match(/autoFocus=\{!restoringDraftRef\.current\}/g) || []).length, 2);
  assert.doesNotMatch(src, /window\.confirm\(`Delete \$\{isFolder/, 'bookmark delete is undoable, not confirmed');
  assert.match(read('src/PDFSidebar.jsx'), /draftKey=\{pdfDocumentKey\}/);
});

test('deleting a folder removes everything in it and Undo puts every row back in place', () => {
  const list = [
    { id: 'a', name: 'A', type: 'bookmark' },
    { id: 'f', name: 'Level 2', type: 'folder' },
    { id: 'b', name: 'B', type: 'bookmark', parentId: 'f' },
    { id: 'c', name: 'C', type: 'bookmark' },
    { id: 'g', name: 'Sub', type: 'folder', parentId: 'f' },
    { id: 'd', name: 'D', type: 'bookmark', parentId: 'g' },
  ];
  const { next, removed } = removeBookmarkWithDescendants(list, 'f');
  assert.deepEqual(next.map((row) => row.id), ['a', 'c']);
  assert.deepEqual(removed.map((row) => row.bookmark.id), ['f', 'b', 'g', 'd']);
  assert.equal(bookmarkDeleteMessage(removed), 'Deleted “Level 2”');
  // Something else changed meanwhile: a new row at the end stays.
  const later = [...next, { id: 'e', name: 'E', type: 'bookmark' }];
  const restored = restoreRemovedBookmarks(later, removed);
  assert.deepEqual(restored.map((row) => row.id), ['a', 'f', 'b', 'c', 'g', 'd', 'e']);
  // Undo twice never doubles a row.
  assert.deepEqual(restoreRemovedBookmarks(restored, removed).map((row) => row.id), restored.map((row) => row.id));
  // Unknown id: nothing removed, the same list back.
  const none = removeBookmarkWithDescendants(list, 'zzz');
  assert.equal(none.next, list);
  assert.equal(none.removed.length, 0);
  assert.equal(bookmarkDeleteMessage([]), '');
});

test('PDFViewer offers Undo for a bookmark delete; the Undo toast is never under a sheet', () => {
  const viewer = read('src/PDFViewer.jsx');
  const del = viewer.slice(viewer.indexOf('const handleBookmarkDelete = useCallback'), viewer.indexOf('const handleBookmarkDelete = useCallback') + 700);
  assert.match(del, /removeBookmarkWithDescendants\(bookmarks, id\)/);
  assert.match(del, /bookmarkUndoToastRef\.current\?\.\(\{/);
  assert.match(del, /restoreRemovedBookmarks\(prev, removed\)/);
  assert.match(viewer, /bookmarkUndoToastRef\.current = enqueueUndoToast;/);
  assert.match(read('src/components/collab/UndoToast.jsx'), /createPortal\(node, document\.body\)/);
  // Portalled to <body>, the toast must clear the viewer tab wrapper (z 5000)
  // and the chrome hosts (5400-5600) by itself, or it paints behind the page
  // on desktop; dialogs (6750+) still cover it.
  const css = read('src/components/collab/UndoToast.css');
  const z = Number(css.match(/\.undo-toast \{[^}]*?z-index: (\d+);/)[1]);
  assert.ok(z > 5600 && z < 6750, `desktop toast z-index ${z}`);
});

test('Templates: leaving with unsaved edits saves them; a typed prompt survives a scrim tap', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  assert.match(editor, /saveOnLeaveRef\.current = saveRowVisible \? handleSaveAll : null;/);
  assert.match(editor, /document\.visibilityState === 'hidden'\) saveOnLeaveRef\.current\?\.\(\)/);
  const prompts = read('src/components/dialogPrompts.jsx');
  assert.match(prompts, /const onScrim = \(\) => \{ if \(value === defaultValue\) onCancel\?\.\(\); \};/);
  assert.match(prompts, /<div onClick=\{onScrim\} style=\{overlay\}>/);
});
