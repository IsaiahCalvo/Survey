import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { applyWalkFloorPageOrder } from '../src/suite/walkthruHandoffRun.js';
import { dimensionCaptionPt } from '../src/utils/measure/dimensionLine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

test('applyWalkFloorPageOrder preserves Walkthru blank pages and remaps node page_index (#1755)', async () => {
  const src = await PDFDocument.create();
  src.addPage([612, 792]);
  const bytes = await src.save();
  const blob = new Blob([bytes], { type: 'application/pdf' });

  const floorId = '11111111-1111-4111-8111-111111111111';
  const assetId = '22222222-2222-4222-8222-222222222222';
  const pageOrder = [
    { floorId, assetId, pageIndex: 0 },
    { floorId, assetId, pageIndex: 1000001, sourcePageIndex: 0, blank: true },
  ];
  const nodes = [
    { id: 'n1', floor_id: floorId, page_index: 0, x_pct: 0.2, y_pct: 0.3 },
    { id: 'n2', floor_id: floorId, page_index: 1000001, x_pct: 0.5, y_pct: 0.5 },
  ];

  const result = await applyWalkFloorPageOrder({
    blob,
    floorId,
    assetId,
    pageOrder,
    nodes,
  });

  const outPdf = await PDFDocument.load(new Uint8Array(await result.blob.arrayBuffer()));
  assert.equal(outPdf.getPageCount(), 2);
  const p2Size = outPdf.getPage(1).getSize();
  assert.equal(Math.round(p2Size.width), 612);
  assert.equal(Math.round(p2Size.height), 792);
  assert.equal(result.nodes[0].page_index, 0);
  assert.equal(result.nodes[1].page_index, 1);
});

test('dimensionCaptionPt scales readability on thick 16pt lines while keeping 9pt on thin lines (#1733)', () => {
  assert.equal(dimensionCaptionPt({ strokeWidth: 1, data: { measure: { kind: 'length', dim: {} } } }), 9);
  assert.equal(dimensionCaptionPt({ strokeWidth: 2, data: { measure: { kind: 'length', dim: {} } } }), 9);
  assert.equal(dimensionCaptionPt({ strokeWidth: 16, data: { measure: { kind: 'length', dim: {} } } }), 20);
  assert.equal(dimensionCaptionPt({ strokeWidth: 16, data: { measure: { kind: 'length', dim: { size: 12 } } } }), 12);
});

test('StickyNoteHost traps focus and PDFViewer blocks shortcuts for any open non-closing modal (#1730)', () => {
  const stickySrc = fs.readFileSync(path.join(repoRoot, 'src/components/StickyNoteHost.jsx'), 'utf8');
  assert.match(stickySrc, /data-autofocus=""/);
  assert.match(stickySrc, /addEventListener\('focusin', onFocusIn, true\)/);
  assert.match(stickySrc, /if \(e\.key !== 'Escape'\) e\.stopPropagation\(\)/);

  const viewerSrc = fs.readFileSync(path.join(repoRoot, 'src/PDFViewer.jsx'), 'utf8');
  assert.match(viewerSrc, /!d\.closest\('\[data-motion-state="closing"\], \[aria-hidden="true"\], \[inert\]'\)/);
});
