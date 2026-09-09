import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// KAL-81 (2026-07-17): the "PDF changed" reset/reload effect in PDFViewer.jsx
// must be keyed on DOCUMENT IDENTITY, not on callback identities. When its dep
// array carried finishPdfjsInteractionWindow / clearExcelSyncCheckpoint /
// pushHistoryDebugEvent, zoom/scroll bursts re-ran the whole effect ~24x per
// session for the SAME open document — wiping undo history, resetting
// hydration to pending, clearing the Excel sync checkpoint, and snapping the
// tool back to pan. These are source-text guards (the effect lives inside the
// 34k-line component and is not unit-mountable here).
const VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('pdf-change effect is keyed on document identity, not callback identities', () => {
  // Checked documents add actor + document + generation so a published
  // generation resets page-addressed history. Other documents retain the
  // cloud id first, name+size (getPDFId) fallback.
  assert.match(
    VIEWER_SOURCE,
    /const activePdfChangeIdentity = pdfFile\s*\? \(checkedBundle !== null\s*\? checkedPageStructureScopeKey\s*:\s*\(pdfFile\.id \|\| getPDFId\(pdfFile\)\)\)\s*:\s*null;/
  );
  assert.match(
    VIEWER_SOURCE,
    /const nextPdfIdentity = activePdfChangeIdentity;\s*\n\s*const isSamePdfReload = activePdfIdentityRef\.current === nextPdfIdentity;/
  );
  // The dep array is the identity alone.
  assert.match(VIEWER_SOURCE, /\}, \[activePdfChangeIdentity\]\);/);
  // The old churn-prone dep array must never come back.
  assert.doesNotMatch(
    VIEWER_SOURCE,
    /\}, \[clearExcelSyncCheckpoint, finishPdfjsInteractionWindow, pdfFile, pushHistoryDebugEvent\]\);/
  );
});

test('document change clears BOTH undo lanes (legacy stacks + local delta refs)', () => {
  // The gated history wipe must reset the local delta lane alongside the
  // legacy stacks — otherwise document A's local undo entries survive into
  // document B and undo can apply A's page deltas to B's pages.
  const wipeBlock = VIEWER_SOURCE.match(
    /if \(!isSamePdfReload\) \{[\s\S]*?isUndoingRef\.current = false;[\s\S]*?\}/
  );
  assert.ok(wipeBlock, 'history wipe gate block not found');
  assert.match(wipeBlock[0], /localAnnotationUndoRef\.current = \[\];/);
  assert.match(wipeBlock[0], /localAnnotationRedoRef\.current = \[\];/);
  assert.match(wipeBlock[0], /setLocalAnnotationHistoryVersion\(\(prev\) => prev \+ 1\);/);
});

test('same-pdf preservation branches survive inside the identity-keyed effect', () => {
  // With identity keying these branches guard remounts / StrictMode
  // double-fires; they must not be deleted as "dead".
  assert.match(VIEWER_SOURCE, /if \(!isSamePdfReload\) \{\s*\n\s*setUndoHistory\(\[\]\);/);
  assert.match(VIEWER_SOURCE, /if \(!isSamePdfReload\) \{\s*\n\s*setActiveTool\('pan'\);/);
});
