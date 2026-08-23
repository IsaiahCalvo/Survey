import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';
import { buildAnnotationRestoreAction } from '../src/services/annotationTrashHistory.js';
import {
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source contracts for local History restore AFTER page CW for ellipse /
// cloud-rect / highlighter. Named cloud Restore stays leftover-18 X-01.
// Live proof: debug/scenarios/e2e-page-rotate-history-restore-shapes.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function emptyModel(objects = [], width = 612, height = 792) {
  return {
    annotationsByPage: { 1: { width, height, objects } },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  };
}

function deleteAction(annotation) {
  return {
    type: 'fabric:delete',
    pageNumber: 1,
    annotationId: annotation.data?.id || annotation.id,
    storageKey: annotation.data?.id || annotation.id,
    annotation,
    index: 0,
  };
}

test('CW remapper + History Restore keeps ellipse / cloud-rect / highlighter placement', () => {
  const ellipse = {
    type: 'ellipse',
    left: 110.16,
    top: 174.24,
    width: 146.88,
    height: 110.88,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    id: 'xf-hist-ell',
    data: { id: 'xf-hist-ell', type: 'ellipse', tool: 'ellipse' },
  };
  const cloud = {
    type: 'rect',
    left: 293.76,
    top: 190.08,
    width: 146.88,
    height: 110.88,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    id: 'xf-hist-cloud',
    data: { id: 'xf-hist-cloud', type: 'rect', pdfCloudIntensity: 2 },
  };
  const ink = {
    type: 'path',
    left: 0,
    top: 0,
    paperCenterline: [{ x: 134.64, y: 396.00 }],
    globalCompositeOperation: 'multiply',
    id: 'xf-hist-hi',
    data: { id: 'xf-hist-hi', type: 'path', tool: 'highlighter' },
  };

  const cw = transformPageState(emptyModel([ellipse, cloud, ink]), {
    type: 'rotate',
    page: 1,
    delta: 90,
    pageWidth: 612,
    pageHeight: 792,
  });
  const remapped = cw.annotationsByPage[1].objects;
  const ellExpected = rotateDisplayedPoint(110.16 + 146.88 / 2, 174.24 + 110.88 / 2, 612, 792, 90);
  assert.ok(Math.abs((remapped[0].left + remapped[0].width / 2) - ellExpected.x) < 1e-6);
  assert.equal(remapped[1].data.pdfCloudIntensity, 2);
  assert.equal(remapped[2].left, 0);

  const restore = buildAnnotationRestoreAction(deleteAction(remapped[0]));
  const restored = applyAnnotationHistoryAction(
    { 1: { width: 792, height: 612, objects: [] } },
    restore,
  );
  assert.equal(restored[1].objects[0].data.id, 'xf-hist-ell');
  assert.ok(Math.abs((restored[1].objects[0].left
    + restored[1].objects[0].width / 2) - ellExpected.x) < 1e-6);
});

test('history-restore shapes spec covers ellipse / cloud-rect / highlighter; no file.id stamp', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-history-restore-shapes.spec.mjs');
  const interaction = read('src/hooks/useSVGInteraction.js');
  const menu = read('src/hooks/useAnnotationContextMenu.jsx');
  const commit = read('src/utils/annotationCreationCommit.js');
  const ink = read('src/utils/productionPaperInk.js');
  const viewer = read('src/PDFViewer.jsx');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /leftover-18 \/ X-01/);
  assert.match(spec, /desktop History restore after CW — \$\{kind\}/);
  assert.match(spec, /\['ellipse', createEllipse\]/);
  assert.match(spec, /\['cloud-rect', createCloudRect\]/);
  assert.match(spec, /\['highlighter', createHighlighter\]/);
  assert.match(spec, /390 History restore shapes edge/);
  assert.match(spec, /data\.id \|\| id/);
  assert.match(spec, /0 0 792 612/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);

  assert.match(interaction, /o\?\.data\?\.id \|\| o\?\.id/);
  assert.match(menu, /obj\?\.data\?\.id \|\| obj\?\.id/);
  assert.match(commit, /id,\s*\n\s*data: \{ id \}/);
  assert.match(ink, /id,\s*\n\s*tool: normalizedTool,\s*\n\s*data: \{ \.\.\.\(data \|\| \{\}\), id/);
  assert.match(viewer, /counter\.data\.id = crypto\.randomUUID\(\)/);
  assert.doesNotMatch(viewer.slice(viewer.indexOf('counter.data.id = crypto.randomUUID()'), viewer.indexOf('counter.data.id = crypto.randomUUID()') + 400), /counter\.id\s*=/);
  assert.match(dev, /Do NOT set file\.id/);
});
