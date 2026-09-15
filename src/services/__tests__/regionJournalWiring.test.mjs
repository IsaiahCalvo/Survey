// KAL-313 follow-up — wiring-level guards for region-delete journaling and the
// standalone space restore dispatch.
//
// These are static source assertions: PDFViewer.jsx cannot be mounted in a
// node test, and this exact class of wiring has regressed before.
//
// 2026-06-11 (history-system audit P0): region journaling moved from RST
// delete-key press to COMMIT time inside PDFViewer.handleRegionComplete,
// gated on the removedRegionIds diff. The chain pinned here is now:
//
//   RST handleConfirm → onRegionComplete(payload)
//     → PDFViewer handleRegionComplete → removedRegionIds diff
//     → buildRegionDeleteHistoryRow → recordDocumentHistoryEvent
//     → window.dispatchEvent('document-history:event-recorded')
//
// and the inverse invariant: RST handleDeleteSelected / handleCancel must NOT
// journal — Cancel must never produce trash rows (phantom-delete bug).
//
// plus the declaration-order invariant for handleRestoreSpace (read by
// handleRestoreHistoryActivity's dep array — TDZ crash if reordered).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRegionDeleteHistoryRow } from '../annotationTrashHistory.js';

const pdfViewerSrc = readFileSync(new URL('../../PDFViewer.jsx', import.meta.url), 'utf8');
const trashMigrationSrc = readFileSync(
  new URL('../../../supabase/migrations/20260611130000_kal313_annotation_trash_events.sql', import.meta.url),
  'utf8',
);
const rstSrc = readFileSync(new URL('../../RegionSelectionTool.jsx', import.meta.url), 'utf8');
const panelSrc = readFileSync(
  new URL('../../components/revisions/RevisionsPanel.jsx', import.meta.url),
  'utf8',
);

test('region journaling lives at COMMIT time inside handleRegionComplete', () => {
  const start = pdfViewerSrc.indexOf('const handleRegionComplete');
  assert.notEqual(start, -1, 'handleRegionComplete not found in PDFViewer.jsx');
  // Slice up to the next top-level useCallback/useEffect after the function.
  const endMarker = pdfViewerSrc.indexOf('// Templates are loaded from Supabase', start);
  const body = pdfViewerSrc.slice(start, endMarker === -1 ? start + 8000 : endMarker);
  assert.match(body, /removedRegionIds/, 'removedRegionIds diff missing');
  assert.match(body, /buildRegionDeleteHistoryRow\(/, 'commit-time row builder call missing');
  assert.match(
    body,
    /recordScopedHistoryEvent\(/,
    'commit-time journaling must use the scoped record+notify wrapper',
  );
  // Journaling must be INSIDE the removedRegionIds guard (only fires when
  // regions were actually removed by this commit).
  const guardIdx = body.indexOf('if (removedRegionIds.length > 0)');
  const builderIdx = body.indexOf('buildRegionDeleteHistoryRow(');
  assert.ok(guardIdx !== -1 && builderIdx > guardIdx,
    'journaling must be gated on the removedRegionIds diff');
});

test('RST delete/cancel paths do NOT journal (cancel must produce no trash rows)', () => {
  const deleteStart = rstSrc.indexOf('const handleDeleteSelected');
  assert.notEqual(deleteStart, -1, 'handleDeleteSelected not found');
  const deleteBody = rstSrc.slice(deleteStart, deleteStart + 1200);
  assert.doesNotMatch(
    deleteBody,
    /onRegionsDeleted\(/,
    'RST handleDeleteSelected must not journal at delete-key press — journaling is commit-time only',
  );
  const cancelStart = rstSrc.indexOf('const handleCancel');
  assert.notEqual(cancelStart, -1, 'handleCancel not found');
  const cancelBody = rstSrc.slice(cancelStart, cancelStart + 1200);
  assert.doesNotMatch(cancelBody, /onRegionsDeleted|HistoryRow|recordDocumentHistoryEvent/,
    'RST handleCancel must not journal');
  // The dead delete-press prop must not silently return.
  assert.doesNotMatch(rstSrc, /onRegionsDeleted\s*=/, 'onRegionsDeleted prop must stay removed');
  const mountMatch = pdfViewerSrc.match(/<RegionSelectionTool[\s\S]{0,3000}?\/>/);
  assert.ok(mountMatch, 'RegionSelectionTool mount site not found in PDFViewer.jsx');
  assert.doesNotMatch(
    mountMatch[0],
    /onRegionsDeleted=/,
    'onRegionsDeleted mount prop must stay removed (delete-press journaling was the phantom-row bug)',
  );
});

test('commit-time trash row preserves rotation and createdBy on the region', () => {
  // The commit-time path journals from previousPage.regions (the persisted
  // region objects) — rotation (KAL-301) and createdBy (ownership chain)
  // must ride along into restoreAction.region.
  const region = {
    regionId: 'rg-rot',
    pageId: 3,
    shapeType: 'polygon',
    coordinates: [0, 0, 10, 0, 10, 10],
    rotation: 30,
    createdBy: 'user-abc',
  };
  const row = buildRegionDeleteHistoryRow({
    region,
    spaceId: 'sp-1',
    spaceName: 'Kitchen',
    documentId: 'doc-1',
    userId: 'user-abc',
    actorName: 'Isaiah',
    deletedAt: '2026-06-11T00:00:00.000Z',
  });
  assert.ok(row, 'row builder returned null for a valid region');
  assert.equal(row.event_type, 'region_deleted');
  assert.equal(row.payload.restoreAction.region.rotation, 30, 'rotation lost');
  assert.equal(row.payload.restoreAction.region.createdBy, 'user-abc', 'createdBy lost');
  assert.equal(row.page_number, 3);
});

test('handleSpaceDelete journals a space_deleted row with a restore record', () => {
  const start = pdfViewerSrc.indexOf('const handleSpaceDelete');
  assert.notEqual(start, -1, 'handleSpaceDelete not found in PDFViewer.jsx');
  const body = pdfViewerSrc.slice(start, start + 2500);
  assert.match(body, /buildSpaceDeleteHistoryRow\(/, 'space row builder call missing');
  assert.match(
    body,
    /recordScopedHistoryEvent\(/,
    'space delete must use the scoped record+notify wrapper',
  );
});

test('immutability trigger + retention sweep cover space_deleted rows', () => {
  // S6 security gap: without space_deleted in the trigger, a document owner
  // could DELETE space rows via owner RLS and permanently break cascade
  // region restores. All three sections of the migration must list it.
  const triggerStart = trashMigrationSrc.indexOf(
    'CREATE OR REPLACE FUNCTION public.prevent_delete_annotation_trash_events',
  );
  const sweepStart = trashMigrationSrc.indexOf(
    'CREATE OR REPLACE FUNCTION public.sweep_annotation_trash_events',
  );
  assert.ok(triggerStart !== -1 && sweepStart !== -1 && triggerStart < sweepStart,
    'migration structure changed — update this test');
  const triggerBody = trashMigrationSrc.slice(triggerStart, sweepStart);
  assert.match(triggerBody, /'space_deleted'/, 'space_deleted missing from immutability trigger');
  const sweepBody = trashMigrationSrc.slice(sweepStart);
  assert.match(sweepBody, /'space_deleted'/, 'space_deleted missing from retention sweep');
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

test('standard annotation restore guard treats page 0 as a valid page (== null, not falsy)', () => {
  const start = pdfViewerSrc.indexOf('const handleRestoreHistoryActivity');
  const end = pdfViewerSrc.indexOf('const handleCascadeRestoreRegion');
  const body = pdfViewerSrc.slice(start, end);
  assert.match(
    body,
    /restoreAction\.pageNumber == null/,
    'page guard must be == null — page 0 must not read as "restore unavailable"',
  );
  assert.doesNotMatch(
    body,
    /if \(!restoreAction\.pageNumber\)/,
    'falsy page-number guard must not come back (blocked page-0 restores)',
  );
});

test('direct trash writes route through the admitted scoped record-and-notify wrapper', () => {
  // History-audit P2: every direct (non-debug-pipeline) history write must use
  // the wrapper so the panel live-updates without waiting for the 10s poll.
  // The debug pipeline must use the same admitted path. It cannot emit a live
  // event before the scoped store commits the row.
  const bareCalls = pdfViewerSrc.match(/[^A-Za-z]recordDocumentHistoryEvent\(/g) || [];
  assert.equal(
    bareCalls.length,
    0,
    `expected no bare recordDocumentHistoryEvent calls, found ${bareCalls.length}`,
  );
  const wrapped = pdfViewerSrc.match(/recordAndNotifyDocumentHistoryEvent\(/g) || [];
  assert.equal(wrapped.length, 1, 'only the scoped wrapper may call the service wrapper');
  const scoped = pdfViewerSrc.match(/recordScopedHistoryEvent\(/g) || [];
  assert.ok(scoped.length >= 10,
    'space/region/callout/single-annotation/bulk/survey-marker/debug sites must use the scoped wrapper');
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

// ─── History F1 (2026-06-11): owner's live finding — region delete wrote no row ──

const spacesPanelSrc = readFileSync(
  new URL('../../sidebar/SpacesPanel.jsx', import.meta.url),
  'utf8',
);

test('SpacesPanel keeps a region-edit entry point (onRequestRegionEdit is CALLED, not just destructured)', () => {
  // The 2026-06-11 "Polish spaces sidebar controls" rewrite destructured
  // onRequestRegionEdit but never called it — the Region Selection Tool became
  // unreachable from the UI, so the commit-time region journaling could never
  // fire. Pin the call site so a future rewrite can't silently drop it again.
  assert.match(
    spacesPanelSrc,
    /onRequestRegionEdit\?\.\(/,
    'SpacesPanel must call onRequestRegionEdit(space.id, page.pageId) somewhere — region edit is otherwise unreachable',
  );
  assert.match(
    spacesPanelSrc,
    /onCancelRegionEdit\?\.\(/,
    'SpacesPanel must offer a cancel path for an active region edit',
  );
});

test('handleSpaceRemovePage journals restorable region_deleted rows (sidebar trash button commits immediately)', () => {
  const start = pdfViewerSrc.indexOf('const handleSpaceRemovePage');
  assert.notEqual(start, -1, 'handleSpaceRemovePage not found in PDFViewer.jsx');
  const end = pdfViewerSrc.indexOf('const handleSpaceRenamePage', start);
  const body = pdfViewerSrc.slice(start, end === -1 ? start + 4000 : end);
  assert.match(body, /buildRegionDeleteHistoryRow\(/, 'sidebar region delete must journal region_deleted rows');
  assert.match(
    body,
    /recordScopedHistoryEvent\(/,
    'sidebar region delete must use the scoped record+notify wrapper',
  );
});

// ─── History F2 (2026-06-11): one restorable row per delete ─────────────────

test('single-annotation delete journals exactly one durable row (bulk path dedupe wiring)', () => {
  // (a) the bulk path pre-registers candidate ids before runDelete…
  const bulkStart = pdfViewerSrc.indexOf('const handleRequestBulkDelete');
  assert.notEqual(bulkStart, -1);
  const bulkBody = pdfViewerSrc.slice(bulkStart, bulkStart + 9000);
  assert.match(
    bulkBody,
    /registerBulkJournaledAnnotationIds\(candidateIds\)[\s\S]{0,400}?runDelete\(\)/,
    'bulk path must register candidate ids BEFORE runDelete so the single-annotation emitter can skip them',
  );
  // (b) …and a one-object bulk delete emits a single annotation_deleted row.
  assert.match(
    bulkBody,
    /deletedObjects\.length === 1/,
    'single-object bulk delete must emit one annotation_deleted row instead of a bulk row',
  );
  // (c) the single-annotation emitter skips bulk-journaled ids and suppresses
  // the activity-pipeline twin row.
  const pushStart = pdfViewerSrc.indexOf('const pushLocalAnnotationHistoryAction');
  assert.notEqual(pushStart, -1);
  const pushBody = pdfViewerSrc.slice(pushStart, pushStart + 8000);
  assert.match(pushBody, /journaledByBulkPath/, 'bulk dedupe check missing from pushLocalAnnotationHistoryAction');
  assert.match(pushBody, /suppressHistoryRow:\s*suppressActivityHistoryRow/, 'delete activity twin suppression flag missing');
  assert.match(
    pushBody,
    /scopedAction\.type === 'fabric:delete' && !journaledByBulkPath/,
    'single trash row must be skipped when the bulk path already journaled the id',
  );
});
