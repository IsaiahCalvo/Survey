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
  assert.match(src, /reframeMarks\(byPage, made, ops, transformPageState, slices\);\n      sync\.deletedSlices = slices\.size \? slices : null;/);
  // Its own page change, or a run that cannot travel, drops the held slices.
  assert.match(src, /pageOpSync\.deletedSlices = null;/);
  assert.match(src, /if \(frame && !ops\) sync\.deletedSlices = null;/);
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
  // Undo of a delete travels without its page state.
  assert.deepEqual(stampableOperation({ type: 'restore', afterPage: 0, fromPage: 1, from: { annotationsByPage: {} } }), { type: 'restore', afterPage: 0, fromPage: 1 });
});

test('a delete then its Undo leaves a mark drawn in the other window where it was', async () => {
  const { reframeMarks, stampableOperation } = await import('../src/utils/pageOpSync.js');
  const { transformPageState } = await import('../src/utils/pageAnnotationReindex.js');
  const byPage = {
    2: { objects: [{ type: 'rect', left: 20, top: 20, width: 5, height: 5, data: { id: 'mine' } }] },
    3: { objects: [{ type: 'rect', left: 30, top: 30, width: 5, height: 5, data: { id: 'later' } }] },
  };
  const del = stampableOperation({ type: 'delete', page: 2 });
  const back = stampableOperation({ type: 'restore', afterPage: 1, fromPage: 2, from: { annotationsByPage: {} } });
  const kept = reframeMarks(byPage, new Set(['mine', 'later']), [del, back], transformPageState);
  assert.deepEqual(kept[2].map((o) => o.data.id), ['mine']);
  assert.deepEqual(kept[3].map((o) => o.data.id), ['later']);
  // In one batch too.
  const batched = reframeMarks(byPage, new Set(['mine']), [stampableOperation({ type: 'batch', operations: [del] }), back], transformPageState);
  assert.deepEqual(batched[2].map((o) => o.data.id), ['mine']);
  // The Undo of a several-page delete is a batch of restores: it travels
  // slimmed, without its page state.
  const many = { type: 'batch', operations: [
    { type: 'restore', afterPage: 1, fromPage: 2, from: { annotationsByPage: {} } },
    { type: 'restore', afterPage: 2, fromPage: 3, from: { annotationsByPage: {} } },
  ] };
  assert.deepEqual(stampableOperation(many), { type: 'batch', operations: [
    { type: 'restore', afterPage: 1, fromPage: 2 }, { type: 'restore', afterPage: 2, fromPage: 3 },
  ] });
  assert.equal(stampableOperation({ type: 'batch', operations: [many.operations[0], { type: 'presentation', page: 1 }] }), null);
  // No delete seen here: the page comes back as a new page after afterPage.
  const shifted = reframeMarks(byPage, new Set(['mine']), [{ type: 'restore', afterPage: 1, fromPage: 2 }], transformPageState);
  assert.deepEqual(shifted[3].map((o) => o.data.id), ['later', 'mine']);
});

test('two deletes of the same page number and their Undo put each mark back on its own page', async () => {
  const { reframeMarks } = await import('../src/utils/pageOpSync.js');
  const { transformPageState } = await import('../src/utils/pageAnnotationReindex.js');
  const byPage = {
    2: { objects: [{ type: 'rect', left: 20, top: 20, width: 5, height: 5, data: { id: 'a' } }] },
    3: { objects: [{ type: 'rect', left: 30, top: 30, width: 5, height: 5, data: { id: 'b' } }] },
  };
  // Delete page 2, then the page that slid into 2; Undo puts the newer one back first.
  const steps = [
    { type: 'delete', page: 2 }, { type: 'delete', page: 2 },
    { type: 'restore', afterPage: 1, fromPage: 2 }, { type: 'restore', afterPage: 1, fromPage: 2 },
  ];
  const kept = reframeMarks(byPage, new Set(['a', 'b']), steps, transformPageState);
  assert.deepEqual(kept[2].map((o) => o.data.id), ['a']);
  assert.deepEqual(kept[3].map((o) => o.data.id), ['b']);
});

test('a reload takes only the runs its bytes carry; later runs and the noted marks stay for the next load', async () => {
  const { noteFramePageChanges, normalizePdfVersion, pendingPdfVersion, savedPdfVersion, splitFramePageChanges, framePageChanges } = await import('../src/utils/pageOpSync.js');
  const turn = { type: 'rotate', page: 1, delta: 90 };
  const blank = { type: 'insert', afterPage: 0 };
  let frame = noteFramePageChanges(null, normalizePdfVersion(savedPdfVersion({ writer: 'A', filePath: 'p', contentSha256: 's1', operations: [turn], batch: 'run1' })));
  const keys = [...frame.batches.keys()];
  frame.made.add('mine');
  // While run1's bytes load, the other window starts run2 and a mark is drawn here.
  frame = noteFramePageChanges(frame, normalizePdfVersion(pendingPdfVersion({ writer: 'A', operations: [blank], batch: 'run2' })));
  frame.made.add('mine2');
  const { taken, rest } = splitFramePageChanges(frame, keys);
  assert.deepEqual(framePageChanges(taken), [turn]);
  assert.deepEqual(framePageChanges(rest), [blank]);
  assert.deepEqual([...taken.made], ['mine', 'mine2']);
  assert.deepEqual([...rest.made], ['mine', 'mine2']);
  // Nothing after it: the frame ends with the load.
  assert.equal(splitFramePageChanges(taken, keys).rest, null);
  assert.deepEqual(splitFramePageChanges(null, keys), { taken: null, rest: null });
  // A loaded run that could not travel moved none of the marks, so the later
  // runs start with none (marks drawn from now on sit on the loaded pages).
  let stuck = noteFramePageChanges(null, normalizePdfVersion(savedPdfVersion({ writer: 'A', filePath: 'p', contentSha256: 's1', operations: null, batch: 'run1' })));
  stuck.made.add('old');
  stuck = noteFramePageChanges(stuck, normalizePdfVersion(pendingPdfVersion({ writer: 'A', operations: [blank], batch: 'run2' })));
  const split = splitFramePageChanges(stuck, ['run1']);
  assert.equal(framePageChanges(split.taken), null);
  assert.deepEqual(framePageChanges(split.rest), [blank]);
  assert.equal(split.rest.made.size, 0);
});

test('the viewer keeps noting marks until the new pages load, and a reload waits for the newest bytes', () => {
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const reload = src.slice(src.indexOf('const reload = (since) => {'), src.indexOf('const unsubscribe = subscribeDocumentMeta(PDF_FILE_VERSION_META_KEY'));
  assert.ok(reload.includes('sync.reframe = { sha: latest.contentSha256, keys: latestKeys };'));
  assert.ok(!reload.includes('sync.frame = null'), 'the frame keeps recording while the old pages are up');
    assert.ok(src.includes('const { taken: frame, rest } = splitFramePageChanges(sync.frame, target.keys);'));
  // An unblock while the reload waits for a pointer keeps the frame too.
  assert.ok(src.includes('const loadingKeys = sync.reframe?.keys || (timer ? latestKeys : null);'));
  // The marks move only once the document opened from the newest bytes is on
  // screen, and a move that fails leaves later runs no marks to move.
  assert.ok(src.includes("pageOpSyncRef.current.docSha = { doc: pdf, sha: pdfFile?.contentSha256 || null };"));
  assert.ok(src.includes('if (!target || shown?.doc !== pdfDoc || shown.sha !== target.sha) return;'));
  assert.ok(/catch \(err\) \{\s*forgetNotedMarks\(\);/.test(src));
});

test('stamps from an older client without a run name count once per run', async () => {
  const { framePageChanges, noteFramePageChanges, normalizePdfVersion, pendingPdfVersion, savedPdfVersion } = await import('../src/utils/pageOpSync.js');
  const turn = { type: 'rotate', page: 1, delta: 90 };
  let frame = null;
  frame = noteFramePageChanges(frame, normalizePdfVersion(pendingPdfVersion({ writer: 'A', operations: [turn] })));
  frame = noteFramePageChanges(frame, normalizePdfVersion(pendingPdfVersion({ writer: 'A', operations: [turn, turn] })));
  frame = noteFramePageChanges(frame, normalizePdfVersion(savedPdfVersion({ writer: 'A', filePath: 'p', contentSha256: 's', operations: [turn, turn] })));
  assert.equal(framePageChanges(frame).length, 2);
  // The writer's next run adds to it.
  frame = noteFramePageChanges(frame, normalizePdfVersion(pendingPdfVersion({ writer: 'A', operations: [turn] })));
  frame = noteFramePageChanges(frame, normalizePdfVersion(savedPdfVersion({ writer: 'A', filePath: 'q', contentSha256: 't', operations: [turn] })));
  assert.equal(framePageChanges(frame).length, 3);
});

test('noted marks missing from the pages are dropped before later runs', async () => {
  const { notedMarksOnPages } = await import('../src/utils/pageOpSync.js');
  const byPage = { 1: { objects: [{ data: { id: 'here' } }, { data: { id: 'other' } }] }, 2: { objects: [] } };
  assert.deepEqual([...notedMarksOnPages(byPage, new Set(['here', 'gone']))], ['here']);
  assert.equal(notedMarksOnPages(byPage, new Set()).size, 0);
  assert.equal(notedMarksOnPages(null, new Set(['here'])).size, 0);
  // The viewer trims the leftover frame before the no-op return.
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  // A mark an earlier load's delete took stays noted for that delete's Undo.
  assert.match(src, /const found = notedMarksOnPages\(byPage, made\);\n\s+const held = marksInDeletedSlices\(deleted\);\n\s+if \(sync\.frame && found\.size < made\.size\)/);
  assert.match(src, /found\.has\(id\) \|\| held\.has\(id\) \|\| !made\.has\(id\)/);
  assert.ok(src.indexOf('notedMarksOnPages(byPage, made)') < src.indexOf('if (!changed) return;'));
});

test('a delete and its Undo in different loads still leave a mark drawn here where it was', async () => {
  const { reframeMarks, marksInDeletedSlices, stampableOperation } = await import('../src/utils/pageOpSync.js');
  const { transformPageState } = await import('../src/utils/pageAnnotationReindex.js');
  const mine = { type: 'rect', left: 20, top: 20, width: 5, height: 5, data: { id: 'mine' } };
  const later = { type: 'rect', left: 30, top: 30, width: 5, height: 5, data: { id: 'later' } };
  const del = stampableOperation({ type: 'delete', page: 2 });
  const back = stampableOperation({ type: 'restore', afterPage: 1, fromPage: 2, from: { annotationsByPage: {} } });
  const deleted = new Map();
  // First load: page 2 goes, and the mark with it.
  const first = reframeMarks({ 2: { objects: [mine] }, 3: { objects: [later] } }, new Set(['mine', 'later']), [del], transformPageState, deleted);
  assert.deepEqual(first[2].map((o) => o.data.id), ['later']);
  assert.ok(!first[3]?.length);
  assert.deepEqual([...marksInDeletedSlices(deleted)], ['mine']);
  // Second load: the Undo puts page 2 back, the mark with it, even with no
  // noted mark left on the pages.
  const second = reframeMarks({ 2: { objects: [later] } }, new Set(['later']), [back], transformPageState, deleted);
  assert.deepEqual(second[2].map((o) => o.data.id), ['mine']);
  assert.deepEqual(second[3].map((o) => o.data.id), ['later']);
  assert.equal(deleted.size, 0);
  const alone = new Map();
  reframeMarks({ 2: { objects: [mine] } }, new Set(['mine']), [del], transformPageState, alone);
  const none = reframeMarks({}, new Set(), [back], transformPageState, alone);
  assert.deepEqual(none[2].map((o) => o.data.id), ['mine']);
  // A second delete of page 2 and its Undo in between take their own slice.
  const stacked = new Map();
  reframeMarks({ 2: { objects: [mine] }, 3: { objects: [later] } }, new Set(['mine', 'later']), [del], transformPageState, stacked);
  const again = reframeMarks({ 2: { objects: [later] } }, new Set(['later']), [del, back], transformPageState, stacked);
  assert.deepEqual(again[2].map((o) => o.data.id), ['later']);
  assert.deepEqual([...marksInDeletedSlices(stacked)], ['mine']);
  // Slices holding no mark are not kept.
  const empty = new Map();
  reframeMarks({ 3: { objects: [later] } }, new Set(['later']), [del], transformPageState, empty);
  assert.equal(empty.size, 0);
});

test('a Survey Marker placed in the other window before its reload moves with the pages', async () => {
  const { reframeSurveyMarkers } = await import('../src/utils/pageOpSync.js');
  const { transformPageState } = await import('../src/utils/pageAnnotationReindex.js');
  const markers = {
    mine: { pageNumber: 1, bounds: { x: 10, y: 20, width: 30, height: 40 }, name: 'Door 1' },
    doomed: { pageNumber: 2, bounds: { x: 1, y: 1, width: 5, height: 5 } },
    theirs: { pageNumber: 1, bounds: { x: 50, y: 50, width: 5, height: 5 } },
  };
  const ops = [
    { type: 'rotate', page: 1, delta: 90, pageSize: { width: 792, height: 612 } },
    { type: 'insert', afterPage: 0 },
    { type: 'delete', page: 3 },
  ];
  const out = reframeSurveyMarkers(markers, new Set(['mine', 'doomed']), ops, transformPageState);
  assert.deepEqual(Object.keys(out.moved), ['mine']);
  assert.equal(out.moved.mine.pageNumber, 2);
  assert.equal(out.moved.mine.name, 'Door 1');
  assert.notDeepEqual(out.moved.mine.bounds, markers.mine.bounds);
  assert.deepEqual(out.gone, ['doomed']);
  assert.equal(reframeSurveyMarkers(markers, new Set(['nope']), ops, transformPageState), null);
  assert.equal(reframeSurveyMarkers(markers, new Set(['mine']), [], transformPageState), null);
});

test('the viewer notes Survey Markers placed during another window\'s page change and moves them after the reload', () => {
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.equal((src.match(/if \(frame\) \(frame\.madeMarkers \|\|= new Set\(\)\)\.add\(/g) || []).length, 2);
  assert.match(src, /const markers = reframeSurveyMarkers\(surveyMarkersRef\.current \|\| \{\}, frame\.madeMarkers, ops, transformPageState\);/);
  assert.match(src, /for \(const id of markers\.gone\) delete next\[id\];/);
});
