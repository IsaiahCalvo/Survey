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

// Owner 2026-10-01 ("Yes, inline like phone"): the desktop Name and Entity
// placement pop-ups were removed. A placed Survey Marker commits with its
// category-derived default name and opens in the Survey rail with the name
// field focused; the rail's rename commit uses the same BL-22 resolver. These
// tripwires replace the old modal-block ones (value binding, two resolver
// calls, select-on-focus), which pinned the pop-up that no longer exists.
const railSrc = readFileSync(join(root, 'src', 'SurveySpacesRail.jsx'), 'utf8');

test('desktop placement opens no Name / Entity pop-up', () => {
  assert.ok(!src.includes('{/* Name Prompt Modal'), 'the Name pop-up is back');
  assert.ok(!src.includes('{/* Entity Selection Dialog */}'), 'the Entity pop-up is back');
  assert.ok(!src.includes('Name highlight'), '"highlight" wording is back');
});

test('a placed marker commits inline and asks the rail to focus its name', () => {
  const start = src.indexOf('const handleSurveyMarkerCreated = useCallback(');
  const block = src.slice(start, src.indexOf('}, [addHistoryCheckpoint,', start));
  assert.match(block, /commitMobileSurveyMarker\(\{/);
  assert.match(block, /setSurveyMarkerNameFocusRequest\(\{ id: annotationId/);
  assert.ok(!/setPendingEntitySelection\(\{|setPendingSurveyMarkerName\(\{/.test(block), 'placement must not open the old pop-ups');
});

test('the rail rename commit uses the shared BL-22 resolver', () => {
  assert.match(railSrc, /const nextName = resolveSurveyMarkerPromptName\(nextRawName/);
});

test('Escape on a just-placed, untouched name takes the placement back as one Undo step', () => {
  assert.match(railSrc, /justPlacedSurveyMarkerIdRef\.current === String\(annotationId\)\s*&& e\.currentTarget\.value === surveyMarkerName/);
  assert.match(railSrc, /if \(undoSurveyMarkerPlacement\(annotationId\)\) return;/);
  assert.match(src, /topMeta\?\.reason !== 'highlight:create'/, 'the undo is only taken when the newest step is this placement');
});

test('the falsy display fallback never returns (whole file)', () => {
  assert.ok(!src.includes('surveyMarkerNameInput || defaultName'),
    'falsy fallback `surveyMarkerNameInput || defaultName` is back — this reintroduces BL-22');
});

test('input state initializes to the null sentinel', () => {
  assert.match(src, /const \[surveyMarkerNameInput, setSurveyMarkerNameInput\] = useState\(null\)/);
});

test("no reset site uses '' — '' must mean \"user cleared the field\", never \"untouched\"", () => {
  assert.ok(!src.includes("setSurveyMarkerNameInput('')"),
    "a setSurveyMarkerNameInput('') reset is back — '' would display verbatim and leak as user text");
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
