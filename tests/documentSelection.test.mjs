// Home > Documents desktop list, Drawboard style (shell audit 2026-10-13,
// Chunk B): selection rules, rename preselection, drag payload, toast words,
// and the wiring that must not drift (no confirm before Archive, Undo uses
// the Archive screen's restore, the phone keeps its Select mode).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DOCUMENT_DRAG_TYPE,
  archivedMessage,
  isDocumentDrag,
  movedToProjectMessage,
  nextDocumentSelection,
  pruneSelection,
  readDocumentDragIds,
  renameSelectionRange,
  selectAllCheckState,
  selectionModeFromEvent,
} from '../src/home/documentSelection.js';
import { isFileDrag } from '../src/utils/fileDrop.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ORDER = ['a', 'b', 'c', 'd', 'e'];
const ids = (set) => [...set].sort();

test('selectionModeFromEvent: plain = single, Shift = range, Ctrl or Cmd = toggle', () => {
  assert.equal(selectionModeFromEvent({}), 'single');
  assert.equal(selectionModeFromEvent(null), 'single');
  assert.equal(selectionModeFromEvent({ shiftKey: true }), 'range');
  assert.equal(selectionModeFromEvent({ ctrlKey: true }), 'toggle');
  assert.equal(selectionModeFromEvent({ metaKey: true }), 'toggle');
  assert.equal(selectionModeFromEvent({ shiftKey: true, ctrlKey: true }), 'range');
});

test('a plain click selects just that row and makes it the anchor', () => {
  const r = nextDocumentSelection({ order: ORDER, selected: ['a', 'c'], anchor: 'a', id: 'd', mode: 'single' });
  assert.deepEqual(ids(r.selected), ['d']);
  assert.equal(r.anchor, 'd');
});

test('Shift-click selects the range from the anchor, either direction, replacing the selection', () => {
  let r = nextDocumentSelection({ order: ORDER, selected: ['b', 'e'], anchor: 'b', id: 'd', mode: 'range' });
  assert.deepEqual(ids(r.selected), ['b', 'c', 'd']);
  assert.equal(r.anchor, 'b', 'the anchor stays put so a second Shift-click re-ranges');
  r = nextDocumentSelection({ order: ORDER, selected: r.selected, anchor: r.anchor, id: 'a', mode: 'range' });
  assert.deepEqual(ids(r.selected), ['a', 'b']);
});

test('Shift-click with no anchor (or one no longer shown) acts like a plain click', () => {
  assert.deepEqual(ids(nextDocumentSelection({ order: ORDER, anchor: null, id: 'c', mode: 'range' }).selected), ['c']);
  const r = nextDocumentSelection({ order: ORDER, anchor: 'gone', id: 'c', mode: 'range' });
  assert.deepEqual(ids(r.selected), ['c']);
  assert.equal(r.anchor, 'c');
});

test('Ctrl-click adds or removes one row and moves the anchor there', () => {
  let r = nextDocumentSelection({ order: ORDER, selected: ['a'], anchor: 'a', id: 'c', mode: 'toggle' });
  assert.deepEqual(ids(r.selected), ['a', 'c']);
  assert.equal(r.anchor, 'c');
  r = nextDocumentSelection({ order: ORDER, selected: r.selected, anchor: r.anchor, id: 'a', mode: 'toggle' });
  assert.deepEqual(ids(r.selected), ['c']);
  // Then Shift ranges from the last Ctrl-click.
  r = nextDocumentSelection({ order: ORDER, selected: ['c', 'a'], anchor: 'a', id: 'c', mode: 'range' });
  assert.deepEqual(ids(r.selected), ['a', 'b', 'c']);
});

test('the input set is never mutated', () => {
  const before = new Set(['a']);
  nextDocumentSelection({ order: ORDER, selected: before, anchor: 'a', id: 'b', mode: 'toggle' });
  assert.deepEqual([...before], ['a']);
});

test('pruneSelection drops rows that left the list and keeps identity when nothing changed', () => {
  const sel = new Set(['a', 'x']);
  assert.deepEqual([...pruneSelection(sel, ORDER)], ['a']);
  const same = new Set(['a', 'b']);
  assert.equal(pruneSelection(same, ORDER), same);
});

test('selectAllCheckState is the header box: none / some / all', () => {
  assert.equal(selectAllCheckState(0, 5), 'false');
  assert.equal(selectAllCheckState(2, 5), 'mixed');
  assert.equal(selectAllCheckState(5, 5), 'true');
  assert.equal(selectAllCheckState(0, 0), 'false');
});

test('renameSelectionRange preselects the name without ".pdf" (any case)', () => {
  assert.deepEqual(renameSelectionRange('Sheet A-103.pdf'), [0, 11]);
  assert.deepEqual(renameSelectionRange('PLAN.PDF'), [0, 4]);
  assert.deepEqual(renameSelectionRange('Roof Survey'), [0, 11], 'no extension: all of it');
  assert.deepEqual(renameSelectionRange('notes.pdf.bak'), [0, 13]);
  assert.deepEqual(renameSelectionRange('.pdf'), [0, 4], 'a bare extension is the whole name');
  assert.deepEqual(renameSelectionRange(''), [0, 0]);
});

test('the drag payload round-trips and is never a file drag (no upload overlay)', () => {
  const store = new Map();
  const dt = {
    types: [DOCUMENT_DRAG_TYPE, 'text/plain'],
    setData: (k, v) => store.set(k, v),
    getData: (k) => store.get(k) || '',
  };
  dt.setData(DOCUMENT_DRAG_TYPE, JSON.stringify(['a', 'b', 7, '']));
  assert.deepEqual(readDocumentDragIds(dt), ['a', 'b']);
  assert.equal(isDocumentDrag(dt), true);
  assert.equal(isFileDrag(dt), false);
  assert.equal(isDocumentDrag({ types: ['Files'] }), false);
  assert.deepEqual(readDocumentDragIds({ getData: () => 'not json' }), []);
  assert.deepEqual(readDocumentDragIds(null), []);
});

test('toast words', () => {
  assert.equal(movedToProjectMessage(1, 'Roof Survey'), 'Moved 1 document to Roof Survey');
  assert.equal(movedToProjectMessage(3, 'Lobby'), 'Moved 3 documents to Lobby');
  assert.equal(movedToProjectMessage(0, 'Lobby'), null);
  assert.equal(archivedMessage(1), 'Moved to Archive');
  assert.equal(archivedMessage(4), 'Moved 4 documents to Archive');
});

test('Dashboard: document Delete archives without a confirm and offers Undo through restoreArchiveItems', () => {
  const src = read('src/Dashboard.jsx');
  const start = src.indexOf('const hubDeleteDocuments = async');
  const end = src.indexOf('const hubDeleteProjects = async');
  const body = src.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(body, /askConfirm\(/, 'no confirm dialog before Archive');
  assert.match(body, /archiveItems\(/);
  assert.match(body, /enqueueArchiveUndo\(\{[\s\S]*onUndo:/);
  assert.match(body, /restoreArchiveItems\(succeeded\)/);
  assert.match(src, /<UndoToast toast=\{archiveUndoToast\} onDismiss=\{dismissArchiveUndo\} className="hub-undo-toast" \/>/);
  // The toast is portalled to <body> (KAL-461), so a wrapper class never
  // reaches it: the home's placement rules must target the toast itself
  // (batch-6 verify: it sat on the phone tab bar at half width).
  const hub = read('src/home/hub.css');
  assert.doesNotMatch(hub, /\.hub-undo-toast \.undo-toast/);
  assert.match(hub, /\.undo-toast\.hub-undo-toast \{\s*width: max-content;/);
  assert.match(hub, /\.undo-toast\.hub-undo-toast \{\s*bottom: calc\(/);
  // The host's class lands on the toast itself (it is portalled to <body>).
  assert.match(read('src/components/collab/UndoToast.jsx'), /className=\{`undo-toast\$\{className \? ` \$\{className\}` : ''\}/);
  // Projects still confirm (a project archives with all its documents).
  const projects = src.slice(end, src.indexOf('const hubRenameProject'));
  assert.match(projects, /askConfirm\(/);
});

test('DocumentsLedger: desktop rows are checkable, draggable and right-clickable; the phone keeps Select mode', () => {
  const src = read('src/home/DocumentsLedger.jsx');
  assert.match(src, /role="checkbox"[\s\S]*aria-checked=\{isChecked\}/);
  assert.match(src, /onContextMenu=\{\(event\) => onDesktopRowContextMenu\(event, d\)\}/);
  assert.match(src, /draggable=\{Boolean\(onMoveCopy\) && !docSelectMode\}/);
  assert.match(src, /projectDrop=\{docDrag \?/);
  // Phone Select mode is untouched.
  assert.match(src, /<SectionIconButton\s+action="select"/);
  assert.match(src, /<SelectModeButtons\s+phone/);
  const css = read('src/home/hub.css');
  const desktop = css.split('@media screen and (min-device-width: 600px) and (min-device-height: 600px) {').slice(1).map((b) => b.split('\n}\n')[0]).join('\n');
  assert.match(desktop, /\.survey-hub\.hub-tab-documents \.documents-mobile-select-main > \.mobile-header-select-button \{\s*display: none;/, 'hidden on the desktop layout only');
});

test('Dashboard bulk project upload: a failed row create removes the object it just stored (Bugbot #831)', () => {
  const src = read('src/Dashboard.jsx');
  assert.match(src, /doc = await createSupabaseDocument\(\{[\s\S]*?\}\);\s*\} catch \(createErr\) \{[\s\S]{0,240}deleteFromStorage\(filePath\)[\s\S]{0,160}throw createErr;/);
});
