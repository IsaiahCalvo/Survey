// KAL-313 follow-up — wiring-level guards for region-delete journaling and the
// standalone space restore dispatch.
//
// These are static source assertions: PDFViewer.jsx cannot be mounted in a
// node test, and this exact class of wiring (a callback prop silently dropped
// at a mount site) has regressed before. Each test pins one link of the chain:
//
//   RST handleDeleteSelected → onRegionsDeleted(deletedRegions)
//     → PDFViewer <RegionSelectionTool onRegionsDeleted={handleRegionsDeleted}>
//     → buildRegionDeleteHistoryRow → recordDocumentHistoryEvent
//
// plus the declaration-order invariant for handleRestoreSpace (read by
// handleRestoreHistoryActivity's dep array — TDZ crash if reordered).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pdfViewerSrc = readFileSync(new URL('../../PDFViewer.jsx', import.meta.url), 'utf8');
const rstSrc = readFileSync(new URL('../../RegionSelectionTool.jsx', import.meta.url), 'utf8');
const panelSrc = readFileSync(
  new URL('../../components/revisions/RevisionsPanel.jsx', import.meta.url),
  'utf8',
);

test('RST mount site passes onRegionsDeleted={handleRegionsDeleted}', () => {
  const mountMatch = pdfViewerSrc.match(/<RegionSelectionTool[\s\S]{0,3000}?\/>/);
  assert.ok(mountMatch, 'RegionSelectionTool mount site not found in PDFViewer.jsx');
  assert.match(
    mountMatch[0],
    /onRegionsDeleted=\{handleRegionsDeleted\}/,
    'onRegionsDeleted prop dropped from the RegionSelectionTool mount site',
  );
});

test('RST delete path fires the regions-deleted callback with full region objects', () => {
  const deleteFn = rstSrc.slice(rstSrc.indexOf('const handleDeleteSelected'));
  assert.notEqual(deleteFn.length, rstSrc.length === 0, 'handleDeleteSelected not found');
  const body = deleteFn.slice(0, 1200);
  assert.match(body, /onRegionsDeleted\(deletedRegions\)/, 'RST no longer invokes onRegionsDeleted');
  assert.match(
    body,
    /regionsRef\.current\.filter/,
    'deleted regions must be captured from live regions BEFORE the filter removes them',
  );
});

test('handleRegionsDeleted builds a region_deleted row and records it', () => {
  const start = pdfViewerSrc.indexOf('const handleRegionsDeleted');
  assert.notEqual(start, -1, 'handleRegionsDeleted not found in PDFViewer.jsx');
  const body = pdfViewerSrc.slice(start, start + 2000);
  assert.match(body, /buildRegionDeleteHistoryRow\(/, 'row builder call missing');
  assert.match(body, /recordDocumentHistoryEvent\(/, 'recordDocumentHistoryEvent call missing');
});

test('handleSpaceDelete journals a space_deleted row with a restore record', () => {
  const start = pdfViewerSrc.indexOf('const handleSpaceDelete');
  assert.notEqual(start, -1, 'handleSpaceDelete not found in PDFViewer.jsx');
  const body = pdfViewerSrc.slice(start, start + 2500);
  assert.match(body, /buildSpaceDeleteHistoryRow\(/, 'space row builder call missing');
  assert.match(body, /recordDocumentHistoryEvent\(/, 'recordDocumentHistoryEvent call missing');
});

test('restore dispatch handles standalone space_deleted entries', () => {
  const start = pdfViewerSrc.indexOf('const handleRestoreHistoryActivity');
  assert.notEqual(start, -1);
  const end = pdfViewerSrc.indexOf('const handleCascadeRestoreRegion');
  const body = pdfViewerSrc.slice(start, end);
  assert.match(
    body,
    /isSpaceRestoreAction\(restoreAction\)/,
    'standalone space restore branch missing from handleRestoreHistoryActivity',
  );
  assert.match(body, /handleRestoreSpace\(restoreAction\)/, 'space branch must route to handleRestoreSpace');
  assert.match(
    body,
    /alreadyPresent[\s\S]{0,80}?restore-noop/,
    'already-present space must map to restore-noop (panel "already present" message)',
  );
});

test('declaration order: handleRestoreSpace is declared before handleRestoreHistoryActivity', () => {
  const restoreSpaceIdx = pdfViewerSrc.indexOf('const handleRestoreSpace');
  const dispatchIdx = pdfViewerSrc.indexOf('const handleRestoreHistoryActivity');
  assert.notEqual(restoreSpaceIdx, -1);
  assert.notEqual(dispatchIdx, -1);
  assert.ok(
    restoreSpaceIdx < dispatchIdx,
    'handleRestoreSpace must be declared BEFORE handleRestoreHistoryActivity — its dep array reads it (TDZ crash)',
  );
});

test('RevisionsPanel labels event subjects by type instead of raw "Annotation: <id>"', () => {
  assert.match(
    panelSrc,
    /describeHistoryEventSubject/,
    'RevisionsPanel must use describeHistoryEventSubject for the detail line',
  );
  assert.doesNotMatch(
    panelSrc,
    /Annotation: \{event\.annotation_id\}/,
    'unconditional "Annotation: <id>" detail line must not come back',
  );
});
