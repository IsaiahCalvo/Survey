// BL-22 — Survey Marker Name Prompt Modal: the category-derived default name
// ("camera 1") must be deletable. Root cause was a falsy render fallback
// (`surveyMarkerNameInput || defaultName`): the keystroke that emptied the
// field re-rendered the full default back, so the word could never be removed.
// Fix: null sentinel (null = untouched → show default; any string, '' included,
// is the user's text) + one pure commit resolver.
//
// Layer 1 tests the resolver's behavior directly. Layer 2 is source-contract
// tripwires (pattern: excelStaleGuardContracts.test.mjs) — the modal lives in
// PDFViewer.jsx and can't be unit-mounted, so these assert the load-bearing
// expressions stay wired. If one fails, the regression is back (or the
// contract needs a deliberate update).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { resolveSurveyMarkerPromptName } from '../src/utils/surveyMarkerNamePrompt.js';
import {
  capturePendingSurveyMarkerUi,
  deletePendingSurveyMarkerUi,
} from '../src/utils/pendingSurveyMarkerHistory.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'PDFViewer.jsx'), 'utf8');

// ---- Layer 1: commit resolver behavior ----

test('untouched input (null) commits the category-derived default', () => {
  assert.equal(resolveSurveyMarkerPromptName(null, 'camera 1'), 'camera 1');
});

test('cleared input ("") falls back to the default — markers must keep a name', () => {
  assert.equal(resolveSurveyMarkerPromptName('', 'camera 1'), 'camera 1');
});

test('whitespace-only input falls back to the default', () => {
  assert.equal(resolveSurveyMarkerPromptName('   ', 'camera 1'), 'camera 1');
});

test('custom name commits verbatim — the BL-22 user intent (camera 1 → C-1)', () => {
  assert.equal(resolveSurveyMarkerPromptName('C-1', 'camera 1'), 'C-1');
});

test('custom name is trimmed on commit', () => {
  assert.equal(resolveSurveyMarkerPromptName('  C-1  ', 'camera 1'), 'C-1');
});

// ---- Layer 2: source-contract tripwires ----

const modalStart = src.indexOf('{/* Name Prompt Modal');
// The block ends where the next modal starts. (It was the Note Dialog until
// that dialog was replaced by the inline Notes block in the Survey rail,
// 2026-10-01.)
const modalEnd = src.indexOf('{/* Item Transfer - Destination Selection Modal */}', modalStart);
const modalBlock = src.slice(modalStart, modalEnd);

test('the Name Prompt Modal block exists and is delimited', () => {
  assert.ok(modalStart !== -1, 'Name Prompt Modal comment marker missing');
  assert.ok(modalEnd > modalStart, 'Item Transfer end marker missing after the modal');
});

test('modal input displays via the null-coalescing sentinel, exactly once', () => {
  const uses = modalBlock.match(/value=\{surveyMarkerNameInput \?\? defaultName\}/g) || [];
  assert.equal(uses.length, 1, `expected exactly 1 ?? display binding, found ${uses.length}`);
});

test('the falsy display fallback never returns (whole file)', () => {
  assert.ok(!src.includes('surveyMarkerNameInput || defaultName'),
    'falsy fallback `surveyMarkerNameInput || defaultName` is back — this reintroduces BL-22');
});

test('both live commit paths (Enter + Save) use the shared resolver, exactly twice', () => {
  const calls = modalBlock.match(/resolveSurveyMarkerPromptName\(surveyMarkerNameInput, defaultName\)/g) || [];
  assert.equal(calls.length, 2, `expected exactly 2 resolver calls in the modal block, found ${calls.length}`);
});

test('input state initializes to the null sentinel', () => {
  assert.match(src, /const \[surveyMarkerNameInput, setSurveyMarkerNameInput\] = useState\(null\)/);
});

test("no reset site uses '' — '' must mean \"user cleared the field\", never \"untouched\"", () => {
  assert.ok(!src.includes("setSurveyMarkerNameInput('')"),
    "a setSurveyMarkerNameInput('') reset is back — '' would display verbatim and leak as user text");
});

test('untouched default is selected on focus so typing replaces it in one stroke', () => {
  assert.match(modalBlock, /onFocus=\{\(e\) => \{ if \(surveyMarkerNameInput === null\) e\.target\.select\(\); \}\}/);
});

test('deleting a pending-name marker clears the stale input (guard + clear pair)', () => {
  assert.match(
    src,
    /deletePendingSurveyMarkerUi\([\s\S]*?annotationId,[\s\S]*?setSurveyMarkerNameInput\(nextPendingUi\.surveyMarkerNameInput\)/,
    'the deletion path no longer clears surveyMarkerNameInput — stale text would resurface on the next modal open');
});

test('pending marker delete Undo/Redo snapshots and restores its complete transient UI slice', () => {
  assert.match(
    src,
    /pendingSurveyMarkerUiRef\.current = capturePendingSurveyMarkerUi\(\{\s*newSurveyMarkersByPage,\s*pendingSurveyMarker,\s*pendingSurveyMarkerSelection,\s*pendingEntitySelection,\s*pendingSurveyMarkerName,\s*surveyMarkerNameInput,\s*\}\)/,
  );
  assert.match(
    src,
    /pendingSurveyMarkerUi: capturePendingSurveyMarkerUi\(pendingSurveyMarkerUiRef\.current\)/,
  );
  for (const setter of [
    'setNewSurveyMarkersByPage',
    'setPendingSurveyMarker',
    'setPendingSurveyMarkerSelection',
    'setPendingEntitySelection',
    'setPendingSurveyMarkerName',
    'setSurveyMarkerNameInput',
  ]) {
    assert.match(
      src,
      new RegExp(`${setter}\\([\\s\\S]{0,100}?restoredPendingSurveyMarkerUi\\.`),
      `${setter} must restore the pending-marker snapshot`,
    );
  }
});

test('pending marker delete, Undo, and Redo round-trip all transient marker UI exactly', () => {
  const target = { id: 'pending-1', annotationId: 'pending-1', pageNumber: 1 };
  const other = { id: 'pending-2', annotationId: 'pending-2', pageNumber: 2 };
  const initial = {
    newSurveyMarkersByPage: {
      1: [target],
      2: [other],
    },
    pendingSurveyMarker: target,
    pendingSurveyMarkerSelection: {
      pageNumber: 1,
      annotationId: 'pending-1',
      tick: 123,
    },
    pendingEntitySelection: {
      surveyMarker: target,
      categoryId: 'category-1',
    },
    pendingSurveyMarkerName: {
      surveyMarker: target,
      categoryId: 'category-1',
    },
    surveyMarkerNameInput: 'Camera A',
  };
  const undoSnapshot = capturePendingSurveyMarkerUi(initial);
  const deleted = deletePendingSurveyMarkerUi(initial, 'pending-1');
  assert.deepEqual(deleted, {
    newSurveyMarkersByPage: { 2: [other] },
    pendingSurveyMarker: null,
    pendingSurveyMarkerSelection: null,
    pendingEntitySelection: null,
    pendingSurveyMarkerName: null,
    surveyMarkerNameInput: null,
  });
  const undone = capturePendingSurveyMarkerUi(undoSnapshot);
  assert.deepEqual(undone, initial);
  assert.notEqual(undone, initial, 'Undo snapshot is detached from live state');
  const redone = deletePendingSurveyMarkerUi(undone, 'pending-1');
  assert.deepEqual(redone, deleted);
  assert.deepEqual(initial.newSurveyMarkersByPage, { 1: [target], 2: [other] });
});
