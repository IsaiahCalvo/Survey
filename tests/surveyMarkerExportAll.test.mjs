import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  buildPdfExportAnnotationPlan,
  savePDFWithAnnotationsPdfLib,
} from '../src/utils/pdfAnnotationsPdfLib.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('buildPdfExportAnnotationPlan exports all Survey markers when activeModuleId is "*" (#1745)', () => {
  const pageSizes = { 1: { width: 400, height: 300 } };
  const surveyMarkers = {
    'marker-1': { pageNumber: 1, bounds: { x: 20, y: 20, width: 30, height: 30 }, moduleId: 'mod-a', name: 'Node 1' },
    'marker-2': { pageNumber: 1, bounds: { x: 80, y: 40, width: 30, height: 30 }, moduleId: 'mod-b', name: 'Node 2' },
  };
  const all = buildPdfExportAnnotationPlan({ pageSizes, surveyMarkers, activeModuleId: '*' });
  assert.deepEqual(all.items.map((item) => item.id).sort(), ['marker-1', 'marker-2']);
  assert.deepEqual(all.contract.includedScopes, ['canvas', 'survey']);
});

test('savePDFWithAnnotationsPdfLib embeds Survey markers and SurveyAppLayerState with activeModuleId "*" (#1745)', async () => {
  const blank = await PDFDocument.create();
  blank.addPage([400, 300]);
  const srcBytes = await blank.save();

  const surveyMarkers = {
    'marker-node-2': {
      annotationId: 'marker-node-2',
      pageNumber: 1,
      bounds: { x: 100, y: 120, width: 24, height: 24 },
      moduleId: 'mod-cameras',
      categoryId: 'cat-cameras',
      name: 'Node 2',
      color: 'rgba(216, 168, 78, 0.55)',
      needsEntity: false,
    },
  };

  const outBytes = await savePDFWithAnnotationsPdfLib(
    new Blob([srcBytes], { type: 'application/pdf' }),
    {},
    { 1: { width: 400, height: 300 } },
    null,
    {
      returnBytes: true,
      actionType: 'pdf-export',
      documentId: 'doc-1745',
      surveyMarkers,
      activeModuleId: '*',
      spaces: [],
    },
  );

  assert.ok(outBytes && outBytes.byteLength > 0);
  const outDoc = await PDFDocument.load(outBytes);
  const annots = outDoc.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.ok(annots && annots.size() >= 1, 'exported PDF should contain /SurveyMarker annotation');

  const layerStateObj = outDoc.catalog.lookup(PDFName.of('SurveyAppLayerState'));
  assert.ok(layerStateObj, 'SurveyAppLayerState should be embedded');
  const parsed = JSON.parse(layerStateObj.decodeText());
  const markers = parsed.surveyMarkers || parsed.layers?.surveyMarkers || {};
  assert.ok(markers['marker-node-2'], 'SurveyAppLayerState should retain marker-node-2');
});

test('projectExportRun and PDFViewer export paths carry Survey markers even when Survey panel is closed (#1745)', () => {
  const runSrc = read('src/home/projectExportRun.js');
  assert.match(runSrc, /store\.docToSurveyMarkers\(doc\)/);
  assert.match(runSrc, /activeModuleId:\s*markerCount > 0 \? '\*' : null/);

  const viewerSrc = read('src/PDFViewer.jsx');
  assert.match(viewerSrc, /const exportableSurveyMarkers = useMemo/);
  assert.match(viewerSrc, /const exportActiveModuleId = isSurveyVisibilityContext/);
});
