// Highlighter first-stroke must stamp next-draw Width as-is.
// Live Width catalog already offers 1/2/3/4/6 plus custom 7. First-stroke
// used Math.max(strokeWidth, 8) so a next-draw Width below 8 never reached
// persist / reimport / export until Width was touched again. Distinct from
// leftover-18, Pen as-is sourceWidth, highlighter Width catalog above 8,
// and highlighter highlightColor compose. Do not invent a floor of 8.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { buildFreehandCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { parsePdfAppAnnotationMetadata } from '../src/utils/pdfAppAnnotationMetadata.js';
import { normalizeAnnotationSize } from '../src/utils/annotationSize.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeFirstStroke(patch = {}) {
  return buildFreehandCommitJSON({
    tool: 'highlighter',
    id: `hl-first-stroke-width-${patch.idSuffix || 'default'}`,
    points: [{ x: 20, y: 40 }, { x: 80, y: 48 }, { x: 140, y: 36 }],
    strokeColor: '#ffff00',
    highlightColor: 'rgba(255, 255, 0, 0.5)',
    strokeWidth: 4,
    ...patch,
  });
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'highlighter-first-stroke-width-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function dictMetadata(dict) {
  const value = dict.get(PDFName.of('SurveyAppAnnotation'));
  const raw = value?.decodeText ? value.decodeText() : null;
  return parsePdfAppAnnotationMetadata(raw);
}

async function exportFirstStroke(patch = {}) {
  const ink = makeFirstStroke(patch);
  assert.ok(ink, 'first-stroke commit must produce highlighter ink');
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [ink] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'highlighter-first-stroke-width' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { dict, ink, metadata: dictMetadata(dict) };
}

test('first-stroke commit / preview / PAL no longer floor Width at 8', () => {
  const commit = read('src/utils/annotationCreationCommit.js');
  assert.match(
    commit,
    /Next-draw Width below 8 must ride the first highlighter stroke/,
    'first-stroke must name the leftover',
  );
  assert.match(commit, /width: strokeWidth,/);
  assert.doesNotMatch(commit, /Math\.max\(strokeWidth, 8\)/);

  const preview = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(preview, /strokeWidth=\{Number\(strokeWidth\) \|\| 3\}/);
  assert.doesNotMatch(preview, /Math\.max\(Number\(strokeWidth\) \|\| 3, 8\)/);

  const pal = read('src/PageAnnotationLayer.jsx');
  assert.match(pal, /const w = strokeWidth;/);
  assert.doesNotMatch(pal, /Math\.max\(strokeWidth, 8\)/);
});

test('first-stroke commit stamps user-set Width below 8; catalog above 8 stays as-is', () => {
  const thin = makeFirstStroke();
  assert.equal(thin.tool, 'highlighter');
  assert.equal(thin.sourceWidth, 4);
  assert.equal(thin.strokeWidth, 0);
  assert.equal(thin.globalCompositeOperation, 'multiply');

  const custom7 = makeFirstStroke({ idSuffix: '7', strokeWidth: 7 });
  assert.equal(custom7.sourceWidth, 7);

  const preset1 = makeFirstStroke({ idSuffix: '1', strokeWidth: 1 });
  assert.equal(preset1.sourceWidth, 1);

  const wide = makeFirstStroke({ idSuffix: '20', strokeWidth: 20 });
  assert.equal(wide.sourceWidth, 20);

  const empty = makeFirstStroke({ idSuffix: 'empty', points: [] });
  assert.equal(empty, null);
});

test('first-stroke-shaped export writes sourceWidth 4; field clamp stays 1–50', async () => {
  const exported = await exportFirstStroke();
  assert.equal(exported.ink.sourceWidth, 4);
  assert.equal(exported.metadata?.geometry?.sourceWidth, 4);

  assert.equal(normalizeAnnotationSize(0, 1, 50), 1);
  assert.equal(normalizeAnnotationSize(7, 1, 50), 7);
  assert.equal(normalizeAnnotationSize(999, 1, 50), 50);
});

test('Pen first-stroke Width stays as-is and is not rewritten by highlighter', () => {
  const pen = buildFreehandCommitJSON({
    tool: 'pen',
    id: 'pen-width-1',
    points: [{ x: 10, y: 20 }, { x: 80, y: 20 }],
    strokeColor: '#ff0000',
    strokeWidth: 1,
  });
  assert.equal(pen.tool, 'pen');
  assert.equal(pen.sourceWidth, 1);
  assert.notEqual(pen.globalCompositeOperation, 'multiply');
});
