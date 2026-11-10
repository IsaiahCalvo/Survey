// Page changes in two windows (Nightly 'page-op-sync', src/utils/pageOpSync.js):
// the PDF version stamp in the shared document, and when another viewer
// refuses page changes or reloads its PDF.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDLE_REMOTE_PDF_STATE, PAGE_OP_BLOCK_MS, PAGE_OP_BLOCKED_MESSAGE, PAGE_OP_SYNC_FLAG,
  clearedPdfVersion, isPageOpBlocked, normalizePdfVersion, operationRewritesPdf,
  pendingPdfVersion, remotePdfFileDescriptor, remotePdfLoaded, remotePdfVersionStep, savedPdfVersion,
} from '../src/utils/pageOpSync.js';
import { PDF_FILE_VERSION_META_KEY } from '../src/utils/pagePresentation.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import { readFileSync, readdirSync } from 'node:fs';

const ME = 'viewer-me';
const OTHER = 'viewer-other';

test('the flag is a Nightly beta and is seeded off', () => {
  assert.equal(PAGE_OP_SYNC_FLAG, 'page-op-sync');
  assert.equal(FEATURE_FLAGS[PAGE_OP_SYNC_FLAG]?.stage, 'beta');
  assert.equal(PDF_FILE_VERSION_META_KEY, 'pdfFileVersion');
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const seed = readdirSync(dir).find((name) => name.endsWith('_page_op_sync_flag.sql'));
  assert.ok(seed);
  const sql = readFileSync(new URL(seed, dir), 'utf8');
  assert.match(sql, /'page-op-sync',\s*'off'/);
  assert.match(sql, /on conflict \(key\) do nothing/);
});

test('only changes that rewrite the bytes stamp pending', () => {
  for (const type of ['rotate', 'delete', 'insert', 'move', 'reorder', 'duplicate', 'copy', 'restore']) {
    assert.equal(operationRewritesPdf({ type }), true, type);
  }
  assert.equal(operationRewritesPdf({ type: 'presentation', page: 1 }), false);
  assert.equal(operationRewritesPdf({ type: 'rollback' }), false);
  assert.equal(operationRewritesPdf(null), false);
  assert.equal(operationRewritesPdf({ type: 'batch', operations: [{ type: 'presentation' }] }), false);
  assert.equal(operationRewritesPdf({ type: 'batch', operations: [{ type: 'presentation' }, { type: 'rotate' }] }), true);
});

test('each stamp has its own token', () => {
  const a = pendingPdfVersion({ writer: ME });
  const b = pendingPdfVersion({ writer: ME });
  assert.notEqual(a.token, b.token);
  assert.equal(a.pending, true);
  const saved = savedPdfVersion({ writer: ME, filePath: 'u/doc.pdf', contentSha256: 'abc' });
  assert.equal(saved.pending, false);
  assert.equal(saved.filePath, 'u/doc.pdf');
  assert.equal(normalizePdfVersion({ writer: ME }), null);
  assert.equal(normalizePdfVersion('nope'), null);
});

test('this viewer ignores its own stamps', () => {
  const step = remotePdfVersionStep(IDLE_REMOTE_PDF_STATE, pendingPdfVersion({ writer: ME }), { writer: ME, now: 1000 });
  assert.equal(step.action, 'ignore');
  assert.equal(isPageOpBlocked(step.state, 1000), false);
});

test('another window pending blocks page changes, its save reloads, the load unblocks', () => {
  const now = 1_000_000;
  const pending = remotePdfVersionStep(IDLE_REMOTE_PDF_STATE, pendingPdfVersion({ writer: OTHER, at: now }), { writer: ME, currentSha: 'old', now });
  assert.equal(pending.action, 'block');
  assert.equal(isPageOpBlocked(pending.state, now + 1), true);
  assert.equal(PAGE_OP_BLOCKED_MESSAGE, 'Pages are being changed in another window.');

  const saved = remotePdfVersionStep(pending.state, savedPdfVersion({ writer: OTHER, filePath: 'u/doc.pdf', contentSha256: 'new', at: now + 2000 }), { writer: ME, currentSha: 'old', now: now + 2000 });
  assert.equal(saved.action, 'reload');
  assert.equal(saved.version.filePath, 'u/doc.pdf');
  // Still refused until the new bytes are open here.
  assert.equal(isPageOpBlocked(saved.state, now + 2001), true);
  assert.equal(isPageOpBlocked(remotePdfLoaded(saved.state, 'old'), now + 2001), true);
  const loaded = remotePdfLoaded(saved.state, 'new');
  assert.equal(isPageOpBlocked(loaded, now + 2001), false);
});

test('a saved stamp naming bytes this viewer has, or a rollback, just unblocks', () => {
  const now = 5000;
  const blocked = remotePdfVersionStep(IDLE_REMOTE_PDF_STATE, pendingPdfVersion({ writer: OTHER, at: now }), { writer: ME, now }).state;
  const same = remotePdfVersionStep(blocked, savedPdfVersion({ writer: OTHER, filePath: 'p', contentSha256: 'same' }), { writer: ME, currentSha: 'same', now });
  assert.equal(same.action, 'unblock');
  assert.equal(isPageOpBlocked(same.state, now), false);
  const rolledBack = remotePdfVersionStep(blocked, clearedPdfVersion({ writer: OTHER }), { writer: ME, currentSha: 'x', now });
  assert.equal(rolledBack.action, 'unblock');
  assert.equal(isPageOpBlocked(rolledBack.state, now), false);
});

test('a pending stamp that never resolves stops blocking after the window', () => {
  const now = 10_000;
  const step = remotePdfVersionStep(IDLE_REMOTE_PDF_STATE, pendingPdfVersion({ writer: OTHER, at: now }), { writer: ME, now });
  assert.equal(isPageOpBlocked(step.state, now + PAGE_OP_BLOCK_MS - 1), true);
  assert.equal(isPageOpBlocked(step.state, now + PAGE_OP_BLOCK_MS + 1), false);
  // One read long after it was written (left behind by a closed window).
  const stale = remotePdfVersionStep(IDLE_REMOTE_PDF_STATE, pendingPdfVersion({ writer: OTHER, at: now - PAGE_OP_BLOCK_MS - 5 }), { writer: ME, now });
  assert.equal(stale.action, 'unblock');
  assert.equal(isPageOpBlocked(stale.state, now), false);
  // A reload that never finishes stops blocking too.
  const reload = remotePdfVersionStep(IDLE_REMOTE_PDF_STATE, savedPdfVersion({ writer: OTHER, filePath: 'p', contentSha256: 'n' }), { writer: ME, currentSha: 'o', now });
  assert.equal(isPageOpBlocked(reload.state, now + PAGE_OP_BLOCK_MS + 1), false);
});

test('the reloaded tab file is a cloud file for the saved bytes', () => {
  const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' });
  Object.assign(file, { id: 'doc-1', projectId: 'p1', user_id: 'u1', filePath: 'u1/old.pdf', supabaseFilePath: 'u1/old.pdf', contentSha256: 'old', __pdfLoadFailed: true });
  Object.defineProperty(file, 'name', { value: 'Plan.pdf' });
  const next = remotePdfFileDescriptor(file, { filePath: 'u1/new.pdf', contentSha256: 'new' });
  assert.equal(typeof next.arrayBuffer, 'undefined');
  assert.deepEqual(
    { id: next.id, projectId: next.projectId, user_id: next.user_id, name: next.name, filePath: next.filePath, supabaseFilePath: next.supabaseFilePath, contentSha256: next.contentSha256 },
    { id: 'doc-1', projectId: 'p1', user_id: 'u1', name: 'Plan.pdf', filePath: 'u1/new.pdf', supabaseFilePath: 'u1/new.pdf', contentSha256: 'new' },
  );
  assert.equal('__pdfLoadFailed' in next, false);
  const row = remotePdfFileDescriptor({ id: 'd', name: 'A.pdf', file_path: 'a', content_sha256: 'x', size: 5 }, { filePath: 'b', contentSha256: 'y' });
  assert.equal(row.file_path, 'b');
  assert.equal(row.content_sha256, 'y');
  assert.equal('size' in row, false);
});

test('marks drawn on the old pages move the way the page change moved the rest (R4-C N6b)', async () => {
  const { reframeMarks, stampableOperation } = await import('../src/utils/pageOpSync.js');
  const { transformPageState } = await import('../src/utils/pageAnnotationReindex.js');
  const rect = (id, left, top) => ({ type: 'rect', left, top, width: 50, height: 30, data: { id } });
  const byPage = { 1: { objects: [rect('a-theirs', 10, 10), rect('b-mine', 100, 100)] }, 2: { objects: [rect('c', 5, 5)] } };
  // A blank page above page 1: my rectangle goes to page 2 with its sheet.
  const insert = reframeMarks(byPage, new Set(['b-mine']), [stampableOperation({ type: 'insert', afterPage: 0 })], transformPageState);
  assert.deepEqual(insert[1].map((o) => o.data.id), ['a-theirs']);
  assert.deepEqual(insert[2].map((o) => o.data.id), ['c', 'b-mine']);
  // A turn of page 1: my rectangle turns with it, the others stay as they are.
  const turned = reframeMarks(byPage, new Set(['b-mine']), [{ type: 'rotate', page: 1, delta: 90, pageSize: { width: 612, height: 792 } }], transformPageState);
  assert.deepEqual(Object.keys(turned), ['1']);
  const mine = turned[1].find((o) => o.data.id === 'b-mine');
  assert.notDeepEqual([mine.left, mine.top], [100, 100]);
  assert.equal(turned[1].find((o) => o.data.id === 'a-theirs').left, 10);
  // Nothing to move, or no page changes known: nothing changes.
  assert.equal(reframeMarks(byPage, new Set(), [{ type: 'insert', afterPage: 0 }], transformPageState), null);
  assert.equal(reframeMarks(byPage, new Set(['b-mine']), null, transformPageState), null);
  // Only small plain steps travel on the stamp.
  assert.equal(stampableOperation({ type: 'presentation', page: 1 }), null);
  assert.equal(stampableOperation({ type: 'batch', operations: [{ type: 'rotate', page: 1, delta: 90 }, { type: 'restore' }] }), null);
  assert.deepEqual(stampableOperation({ type: 'move', from: 1, to: 3 }), { type: 'move', from: 1, to: 3 });
});

test('the viewer stamps its page changes and moves old-page marks after the reload', () => {
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(src, /pendingPdfVersion\(\{ writer: pageOpSync\.writer, operations: pageOpSync\.pendingOps, batch: pageOpSync\.pendingBatch \}\)/);
  assert.match(src, /savedPdfVersion\(\{ writer: sync\.writer, filePath: [^)]*, operations, batch \}\)/);
  // A remote page change starts this window's Undo over (R5 N6c).
  assert.match(src, /if \(!sync\.frame\) dropHistoryAfterPageChange\(\);\n        sync\.frame = noteFramePageChanges\(sync\.frame, step\.version\);/);
  assert.match(src, /if \(frame\) dropHistoryAfterPageChange\(\);\n    const ops = framePageChanges\(frame\);/);
  assert.match(src, /const handleSaveAnnotations = useCallback\(\(pageNumber, json, saveContext = null\) => \{\n    noteMarksOnOldPages\(pageNumber, json\);/);
  assert.match(src, /reframeMarks\(byPage, frame\.made, ops, transformPageState\)/);
  assert.match(src, /if \(draftOpen\) showToast\(/);
});

test('every run of page changes before the reload counts, in order; an Undo of a delete moves marks too (R5 N6d, N6e)', async () => {
  const { framePageChanges, noteFramePageChanges, normalizePdfVersion, pendingPdfVersion, savedPdfVersion, stampableOperation, reframeMarks } = await import('../src/utils/pageOpSync.js');
  const { transformPageState } = await import('../src/utils/pageAnnotationReindex.js');
  const turn = { type: 'rotate', page: 1, delta: 90, pageSize: { width: 792, height: 612 } };
  const blank = { type: 'insert', afterPage: 0 };
  let frame = null;
  frame = noteFramePageChanges(frame, normalizePdfVersion(pendingPdfVersion({ writer: 'A', operations: [turn], batch: 'run1' })));
  frame = noteFramePageChanges(frame, normalizePdfVersion(savedPdfVersion({ writer: 'A', filePath: 'p', contentSha256: 's', operations: [turn], batch: 'run1' })));
  frame = noteFramePageChanges(frame, normalizePdfVersion(pendingPdfVersion({ writer: 'A', operations: [blank], batch: 'run2' })));
  assert.deepEqual(framePageChanges(frame), [turn, blank]);
  // My box drawn on old page 1: turned, then onto page 2.
  const byPage = { 1: { objects: [{ type: 'rect', left: 300, top: 200, width: 200, height: 200, data: { id: 'mine' } }] } };
  const moved = reframeMarks(byPage, new Set(['mine']), framePageChanges(frame), transformPageState);
  assert.deepEqual(moved[1], []);
  assert.equal(moved[2].length, 1);
  assert.notEqual(moved[2][0].left, 300);
  // A run that cannot travel stops all moving.
  frame = noteFramePageChanges(frame, normalizePdfVersion(pendingPdfVersion({ writer: 'A', operations: null, batch: 'run3' })));
  assert.equal(framePageChanges(frame), null);
  // Undo of a delete travels as a page put back after afterPage.
  assert.deepEqual(stampableOperation({ type: 'restore', afterPage: 0, fromPage: 1, from: { annotationsByPage: {} } }), { type: 'insert', afterPage: 0 });
});
