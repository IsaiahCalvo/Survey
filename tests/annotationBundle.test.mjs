// KAL-410 (F14): review bundle ZIP = annotations.xfdf + audit-log.json +
// page thumbnails + manifest. Checks the ZIP with Node's own CRC-32 (not the
// writer's), the XFDF against the KAL-393 export, the audit log against the
// History rows, and the thumbnails as real pictures with the marks on them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { crc32 as nodeCrc32 } from 'node:zlib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildAnnotationBundle, bundleFileNameForPdf } from '../src/utils/annotationBundle/index.js';
import { createStoredZip } from '../src/utils/annotationBundle/zipStore.js';
import { exportAnnotationsAsXfdf } from '../src/utils/xfdfExport/index.js';
import { renderBundleThumbnails } from '../src/utils/annotationBundle/thumbnails.js';
import { PAGE_SIZES, fileFrom, makeAnnotationsByPage, makeSourcePdf, sha256 } from './helpers/xfdfFixtures.mjs';
import { readZip } from './helpers/readStoredZip.mjs';

let napiCanvas = null;
try { napiCanvas = await import('@napi-rs/canvas'); } catch { napiCanvas = null; }

const NOW = new Date(Date.UTC(2026, 9, 13, 15, 30, 0));
const at = (min) => new Date(NOW.getTime() - min * 60000).toISOString();
const HISTORY = [
  { id: 'h2', client_event_id: 'h2', user_id: 'u-ana', event_type: 'local_annotation_history_added', page_number: 1, annotation_id: 'rect-1', summary: 'Ana Ruiz moved a rectangle on page 1', payload: { actionType: 'move', annotationType: 'rect' }, occurred_at: at(5) },
  { id: 'h1', client_event_id: 'h1', user_id: 'u-ana', event_type: 'local_annotation_history_added', page_number: 1, annotation_id: 'rect-1', summary: 'Ana Ruiz drew a rectangle on page 1', payload: { actionType: 'create', annotationType: 'rect' }, occurred_at: at(30) },
  { id: 'h3', client_event_id: 'h3', user_id: 'u-bo', event_type: 'annotation_deleted', page_number: 2, annotation_id: 'old-1', summary: 'Bo Li deleted an ellipse on page 2', payload: { restoreAction: { type: 'fabric:create', annotation: { type: 'ellipse' } } }, occurred_at: at(2) },
];

const thumbs = napiCanvas
  ? (args) => renderBundleThumbnails({
    ...args,
    pdfjs: pdfjsLib,
    createCanvas: (w, h) => napiCanvas.createCanvas(w, h),
    toPng: async (canvas) => new Uint8Array(await canvas.encode('png')),
  })
  : async () => ({ files: [], pages: [], truncated: false });

test('the stored ZIP opens with an independent reader and is the same bytes every time', () => {
  const entries = [{ name: 'a.txt', data: 'hello' }, { name: 'dir/été.json', data: '{"x":1}' }, { name: 'empty.bin', data: new Uint8Array(0) }];
  const one = createStoredZip(entries, { date: NOW });
  const two = createStoredZip(entries, { date: NOW });
  assert.deepEqual(one, two);
  const files = readZip(one, nodeCrc32);
  assert.deepEqual(files.map((f) => f.name), ['a.txt', 'dir/été.json', 'empty.bin']);
  assert.equal(Buffer.from(files[1].data).toString('utf8'), '{"x":1}');
  assert.throws(() => createStoredZip([{ name: 'a', data: '' }, { name: 'a', data: '' }]), /repeated/);
});

test('the bundle holds the XFDF, the audit log, page pictures and a manifest that fingerprints them', { skip: napiCanvas ? false : '@napi-rs/canvas not installed' }, async () => {
  const sourceBytes = await makeSourcePdf();
  const hashBefore = sha256(sourceBytes);
  const model = makeAnnotationsByPage();
  const bundle = await buildAnnotationBundle({
    sourcePdf: fileFrom(sourceBytes), pdfName: 'Level 2 plan.pdf', annotationsByPage: model, pageSizes: PAGE_SIZES,
    historyRows: HISTORY, documentId: 'doc-1', now: NOW, renderThumbnails: thumbs,
  });
  assert.equal(sha256(sourceBytes), hashBefore, 'source PDF bytes must not change');
  const files = readZip(bundle.zip, nodeCrc32);
  const byName = new Map(files.map((f) => [f.name, f.data]));
  assert.deepEqual(files.map((f) => f.name), [
    'manifest.json', 'annotations.xfdf', 'audit-log.json',
    'thumbnails/page-001.png', 'thumbnails/page-002.png', 'thumbnails/contact-sheet.png',
  ]);

  const manifest = JSON.parse(Buffer.from(byName.get('manifest.json')).toString('utf8'));
  assert.equal(manifest.source.sha256, hashBefore);
  assert.equal(manifest.marks.total, 11);
  assert.deepEqual(manifest.thumbnails.pages, [1, 2]);
  for (const entry of manifest.files) {
    assert.equal(createHash('sha256').update(byName.get(entry.name)).digest('hex'), entry.sha256, `${entry.name} fingerprint`);
  }

  const { xfdf } = await exportAnnotationsAsXfdf(fileFrom(sourceBytes), model, PAGE_SIZES, { pdfFileName: 'Level 2 plan.pdf' });
  assert.equal(Buffer.from(byName.get('annotations.xfdf')).toString('utf8'), xfdf, 'the bundle XFDF is the XFDF export');

  const log = JSON.parse(Buffer.from(byName.get('audit-log.json')).toString('utf8'));
  assert.equal(log.document.sourceSha256, hashBefore);
  assert.deepEqual(log.events.map((e) => [e.id, e.action, e.actor.name, e.page]), [
    ['h1', 'created', 'Ana Ruiz', 1],
    ['h2', 'moved', 'Ana Ruiz', 1],
    ['h3', 'deleted', 'Bo Li', 2],
  ]);
  assert.deepEqual(log.events[0].markIds, ['rect-1']);
  assert.equal(log.coverage.from, at(30));

  // The page-1 picture shows the red rectangle (#e11d48) at its place.
  const img = await napiCanvas.loadImage(Buffer.from(byName.get('thumbnails/page-001.png')));
  assert.equal(img.width, 320);
  const canvas = napiCanvas.createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const scale = 320 / 300;
  const px = ctx.getImageData(Math.round(20 * scale), Math.round(40 * scale), 1, 1).data; // left edge of rect-1
  assert.ok(px[0] > 180 && px[1] < 90, `rectangle edge is red, got ${[...px]}`);
  const sheet = await napiCanvas.loadImage(Buffer.from(byName.get('thumbnails/contact-sheet.png')));
  assert.ok(sheet.width > 2 * 320, 'two pages side by side');
});

test('no marks and no history: nothing to export', async () => {
  const sourceBytes = await makeSourcePdf();
  const bundle = await buildAnnotationBundle({ sourcePdf: fileFrom(sourceBytes), pdfName: 'a.pdf', annotationsByPage: {}, pageSizes: PAGE_SIZES, now: NOW, renderThumbnails: thumbs });
  assert.equal(bundle.empty, true);
});

test('history but no marks: a bundle with the log and no pictures', async () => {
  const sourceBytes = await makeSourcePdf();
  const bundle = await buildAnnotationBundle({ sourcePdf: fileFrom(sourceBytes), pdfName: 'a.pdf', annotationsByPage: {}, pageSizes: PAGE_SIZES, historyRows: HISTORY, now: NOW, renderThumbnails: thumbs });
  const names = readZip(bundle.zip, nodeCrc32).map((f) => f.name);
  assert.deepEqual(names, ['manifest.json', 'annotations.xfdf', 'audit-log.json']);
  assert.equal(bundle.manifest.history.events, 3);
});

test('file name', () => {
  assert.equal(bundleFileNameForPdf('Level 2 plan.pdf'), 'Level 2 plan review.zip');
  assert.equal(bundleFileNameForPdf(''), 'document review.zip');
});

test('History is read page by page, without repeats, and a failed read is reported, not hidden', async () => {
  const { loadAllHistoryRows, bundleResultMessage } = await import('../src/utils/annotationBundle/runAnnotationBundleExport.js');
  const server = Array.from({ length: 503 }, (_, i) => ({ id: `s${i}`, client_event_id: `s${i}`, occurred_at: at(i) }));
  const local = { id: 'l1', client_event_id: 'l1', occurred_at: at(0), __local: true };
  const calls = [];
  const list = async (documentId, { limit, beforeId }) => {
    calls.push(beforeId);
    const start = beforeId ? server.findIndex((r) => r.id === beforeId) + 1 : 0;
    return [local, ...server.slice(start, start + limit)];
  };
  const { rows, available } = await loadAllHistoryRows('doc-1', list);
  assert.equal(available, true);
  assert.equal(rows.length, 504, 'every server row once, plus the device row once');
  assert.deepEqual(calls, [null, 's499']);
  assert.deepEqual(await loadAllHistoryRows(null, list), { rows: [], available: true });
  const failed = await loadAllHistoryRows('doc-1', async () => { throw new Error('offline'); });
  assert.equal(failed.available, false);

  const ok = bundleResultMessage({ status: 'saved', fileName: 'a review.zip', manifest: { marks: { total: 1 }, history: { events: 2, historyAvailable: true }, thumbnails: { pages: [1], truncated: false } } });
  assert.deepEqual(ok, { text: 'Saved a review.zip: 1 mark, 2 changes, 1 page picture.', kind: 'success' });
  const warn = bundleResultMessage({ status: 'saved', fileName: 'a review.zip', manifest: { marks: { total: 3 }, history: { events: 0, historyAvailable: false }, thumbnails: { pages: [], truncated: false } } });
  assert.match(warn.text, /History could not be read/);
  assert.equal(bundleResultMessage({ status: 'empty' }).text, 'No markup or history to export yet.');
});

test('the review package is reachable from the desktop export list, the phone More menu and the File menu', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  assert.match(read('src/AppShell.jsx'), /label: 'Review package \(ZIP\)'[\s\S]{0,250}onSelect: bottomToolbarApi\.exportReviewBundle/);
  assert.match(read('src/mobile/MobilePdfViewerChrome.jsx'), /bottomToolbarApi\?\.exportReviewBundle\?\.\(\);[\s\S]{0,250}Export review package/);
  assert.match(read('src/electron-main.js'), /label: 'Export review package \(ZIP\)…'[\s\S]{0,250}menu:export-review-bundle/);
  assert.match(read('src/preload.js'), /onExportReviewBundleMenu[\s\S]{0,150}menu:export-review-bundle/);
  assert.match(read('src/PDFViewer.jsx'), /exportReviewBundle: handleExportReviewBundle/);
});

test('same document, same moment: byte-for-byte the same ZIP', async () => {
  const sourceBytes = await makeSourcePdf();
  const make = () => buildAnnotationBundle({
    sourcePdf: fileFrom(sourceBytes), pdfName: 'a.pdf', annotationsByPage: makeAnnotationsByPage(), pageSizes: PAGE_SIZES,
    historyRows: HISTORY, now: NOW, renderThumbnails: thumbs,
  });
  const [one, two] = [await make(), await make()];
  assert.equal(Buffer.compare(Buffer.from(one.zip), Buffer.from(two.zip)), 0);
});
