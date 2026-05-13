import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  buildPdfExportAnnotationPlan,
  buildPrintableRegularAnnotationPayload,
  savePDFWithFlattenedRegularAnnotationsForPrint,
  savePDFWithAnnotationsPdfLib,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import {
  PDF_COUNTER_METADATA_KEY,
  PDF_COUNTER_SUBJECT,
  parsePdfCounterMetadata,
} from '../src/utils/pdfCounterMetadata.js';
import {
  PDF_CALLOUT_METADATA_KEY,
  PDF_CALLOUT_SUBJECT,
  parsePdfCalloutMetadata,
} from '../src/utils/pdfCalloutMetadata.js';
import {
  PDF_APP_ANNOTATION_METADATA_KEY,
  PDF_APP_ANNOTATION_SUBJECT,
  parsePdfAppAnnotationMetadata,
} from '../src/utils/pdfAppAnnotationMetadata.js';

const APP_SOURCE = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const ELECTRON_MAIN_SOURCE = readFileSync(new URL('../src/electron-main.js', import.meta.url), 'utf8');
const SPACES_PANEL_SOURCE = readFileSync(new URL('../src/sidebar/SpacesPanel.jsx', import.meta.url), 'utf8');
const PDF_LIB_SOURCE = readFileSync(new URL('../src/utils/pdfAnnotationsPdfLib.js', import.meta.url), 'utf8');

async function makePdfFile(name = 'source.pdf') {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

async function getPdfAnnotationSubtypes(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => doc.context.lookup(ref).get(PDFName.of('Subtype')).decodeText());
}

async function getPdfAnnotationDicts(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => doc.context.lookup(ref));
}

async function pageHasContentStream(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  return Boolean(page.node.lookup(PDFName.of('Contents')));
}

test('PDF export can generate bytes without writing a local file', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const bytes = await savePDFWithAnnotationsPdfLib(
      await makePdfFile(),
      {},
      {},
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-test' },
    );
    assert.ok(bytes instanceof Uint8Array);
    assert.ok(bytes.byteLength > 0);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('PDF save helper refuses original-path overwrite unless explicitly allowed', async () => {
  const originalWindow = globalThis.window;
  let writeCalled = false;
  globalThis.window = {
    electronAPI: {
      writeFileAtomic() {
        writeCalled = true;
      },
      writeFile() {
        writeCalled = true;
      },
    },
  };

  try {
    await assert.rejects(
      savePDFWithAnnotationsPdfLib(
        await makePdfFile(),
        {},
        {},
        '/tmp/original.pdf',
        { actionType: 'app-state-save', documentId: 'doc-test' },
      ),
      /Refusing to overwrite the original PDF path/,
    );
    assert.equal(writeCalled, false);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('normal Save success path does not show a blocking saved alert', () => {
  assert.equal(
    APP_SOURCE.includes("alert('Annotations saved."),
    false,
    'successful app-state Save must not use a blocking alert',
  );
  assert.match(APP_SOURCE, /actionType:\s*'app-state-save'/);
  assert.match(APP_SOURCE, /pdfBytesGenerated:\s*false/);
  assert.match(APP_SOURCE, /localFilesystemWrite:\s*false/);
});

test('Electron File menu labels explicit PDF output as Export', () => {
  assert.match(ELECTRON_MAIN_SOURCE, /label:\s*'Export'/);
  assert.equal(
    ELECTRON_MAIN_SOURCE.includes("label: 'Export Annotated PDF"),
    false,
    'File menu export item should be labeled Export',
  );
  assert.match(ELECTRON_MAIN_SOURCE, /menu:export-annotated-pdf/);
});

test('current print-with-annotations path prints regular app annotations through flattened temporary PDF bytes', () => {
  assert.match(ELECTRON_MAIN_SOURCE, /label:\s*'Print PDF…'/);
  assert.match(ELECTRON_MAIN_SOURCE, /label:\s*'Print PDF with Annotations…'/);
  assert.equal(
    ELECTRON_MAIN_SOURCE.includes("label: 'Print with Markup"),
    false,
    'File menu must not use the old vague markup label',
  );
  assert.match(APP_SOURCE, /buildPrintableRegularAnnotationPayload/);
  assert.match(APP_SOURCE, /savePDFWithFlattenedRegularAnnotationsForPrint\(/);
  assert.match(APP_SOURCE, /actionType:\s*'pdf-print-flattened-regular-annotations'/);
  assert.match(APP_SOURCE, /printPdfBlob\(\s*annotatedBlob,/);
});

test('print PDF helper flattens regular annotations into visible page content instead of PDF annotation objects', async () => {
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    {
      1: {
        objects: [
          { id: 'flat-path', type: 'path', path: [['M', 10, 10], ['L', 50, 30]], stroke: '#ff0000', strokeWidth: 3 },
          { id: 'flat-rect', type: 'rect', left: 20, top: 40, width: 30, height: 20, stroke: '#00ff00', strokeWidth: 2 },
          { id: 'flat-text', type: 'textbox', left: 20, top: 80, width: 80, height: 20, text: 'Flattened', fill: '#0000ff' },
          { id: 'flat-counter', type: 'circle', left: 100, top: 40, radius: 10, fill: '#ef4444', data: { type: 'counter', id: 'flat-counter', displayNumber: 3 } },
          {
            id: 'flat-combined',
            type: 'group',
            left: 120,
            top: 90,
            objects: [
              { id: 'flat-combined-line', type: 'line', x1: 0, y1: 0, x2: 30, y2: 15, stroke: '#111111' },
              { id: 'flat-combined-text', type: 'textbox', left: 5, top: 18, width: 60, height: 14, text: 'Combo', fill: '#111111' },
            ],
          },
        ],
      },
    },
    { 1: { width: 200, height: 200 } },
    {
      actionType: 'pdf-print-flattened-regular-annotations',
      callouts: [{
        id: 'flat-callout',
        pageNumber: 1,
        arrowTip: { x: 0.1, y: 0.1 },
        knee: { x: 0.2, y: 0.2 },
        textBoxPosition: { x: 0.3, y: 0.2 },
        textBoxWidth: 0.25,
        textBoxHeight: 0.12,
        text: 'Callout',
      }],
    },
  );

  assert.ok(bytes instanceof Uint8Array);
  assert.equal(await pageHasContentStream(bytes), true);
  assert.deepEqual(await getPdfAnnotationSubtypes(bytes), []);
});

test('print PDF helper draws counters with the counter pin path before the generic circle path', () => {
  const counterHelperIndex = PDF_LIB_SOURCE.indexOf('const drawFlattenedCounterPin =');
  const counterBranchIndex = PDF_LIB_SOURCE.indexOf("shifted?.data?.type === 'counter'", counterHelperIndex);
  const ellipseBranchIndex = PDF_LIB_SOURCE.indexOf("if (type === 'circle' || type === 'ellipse')", counterBranchIndex);

  assert.ok(counterHelperIndex > 0, 'expected print-specific counter pin helper');
  assert.ok(counterBranchIndex > counterHelperIndex, 'expected counter branch to call the pin helper');
  assert.ok(ellipseBranchIndex > counterBranchIndex, 'expected generic circle/ellipse branch after counter branch');
  assert.match(PDF_LIB_SOURCE, /drawFlattenedCounterPin\(page, shifted, pageHeight, fonts\.bold\)/);
  assert.match(PDF_LIB_SOURCE, /A \$\{radius\} \$\{radius\} 0 1 0/);
  assert.match(PDF_LIB_SOURCE, /counter pin path flattened/);
});

test('print PDF helper keeps regular circles and ellipses on the generic ellipse path', () => {
  const counterBranchIndex = PDF_LIB_SOURCE.indexOf("shifted?.data?.type === 'counter'");
  const ellipseBranchIndex = PDF_LIB_SOURCE.indexOf("if (type === 'circle' || type === 'ellipse')", counterBranchIndex);
  const drawEllipseIndex = PDF_LIB_SOURCE.indexOf('page.drawEllipse({', ellipseBranchIndex);

  assert.ok(ellipseBranchIndex > counterBranchIndex, 'expected regular circle/ellipse branch after counter branch');
  assert.ok(drawEllipseIndex > ellipseBranchIndex, 'expected regular circles and ellipses to still draw with drawEllipse');
});

test('print PDF helper flattens regular combined annotations', async () => {
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    {
      1: {
        objects: [{
          id: 'combined-only',
          type: 'group',
          left: 40,
          top: 40,
          objects: [
            { id: 'combined-line', type: 'line', x1: 0, y1: 0, x2: 30, y2: 20, stroke: '#111111' },
            { id: 'combined-text', type: 'textbox', left: 5, top: 24, width: 70, height: 16, text: 'Combo', fill: '#111111' },
          ],
        }],
      },
    },
    { 1: { width: 200, height: 200 } },
    { actionType: 'pdf-print-flattened-regular-annotations' },
  );

  assert.equal(await pageHasContentStream(bytes), true);
  assert.deepEqual(await getPdfAnnotationSubtypes(bytes), []);
});

test('printable regular annotation filter includes normal annotations and excludes scoped annotations', () => {
  const payload = buildPrintableRegularAnnotationPayload({
    spaces: [{ id: 'space-a', assignedPages: [{ pageId: 1, regions: [{ regionId: 'region-a' }] }] }],
    annotationsByPage: {
      1: {
        version: '5.3.0',
        objects: [
          { id: 'regular-path', type: 'path', path: [['M', 10, 10], ['L', 20, 20]] },
          { id: 'regular-rect', type: 'rect', left: 10, top: 10, width: 20, height: 20 },
          { id: 'survey-circle', type: 'circle', left: 40, top: 10, radius: 8, moduleId: 'module-a' },
          { id: 'region-line', type: 'line', x1: 10, y1: 60, x2: 50, y2: 60, regionId: 'region-a' },
          { id: 'space-polyline', type: 'polyline', points: [{ x: 0, y: 0 }, { x: 20, y: 20 }], spaceId: 'space-a' },
          { id: 'survey-region-text', type: 'textbox', left: 10, top: 80, width: 60, height: 20, text: 'SR', moduleId: 'module-a', regionId: 'region-a' },
        ],
      },
    },
  });

  assert.deepEqual(
    payload.annotationsByPage[1].objects.map((obj) => obj.id),
    ['regular-path', 'regular-rect'],
  );
  assert.equal(payload.diagnostics.included.fabric, 2);
  assert.equal(payload.diagnostics.excludedByScope.survey, 1);
  assert.equal(payload.diagnostics.excludedByScope.region, 1);
  assert.equal(payload.diagnostics.excludedByScope.space, 1);
  assert.equal(payload.diagnostics.excludedByScope['survey-region'], 1);
});

test('printable regular annotation filter excludes survey highlights', () => {
  const payload = buildPrintableRegularAnnotationPayload({
    highlightAnnotations: {
      'survey-highlight': { pageNumber: 1, bounds: { x: 10, y: 10, width: 20, height: 10 }, moduleId: 'module-a' },
      'region-highlight': { pageNumber: 1, bounds: { x: 20, y: 20, width: 20, height: 10 }, regionId: 'region-a' },
      'space-highlight': { pageNumber: 1, bounds: { x: 30, y: 30, width: 20, height: 10 }, spaceId: 'space-a' },
      'survey-region-highlight': { pageNumber: 1, bounds: { x: 40, y: 40, width: 20, height: 10 }, moduleId: 'module-a', regionId: 'region-a' },
    },
  });

  assert.deepEqual(payload.highlightAnnotations, {});
  assert.equal(payload.diagnostics.excluded.surveyHighlights, 4);
});

test('printable regular annotation filter includes regular counters and excludes scoped counters', () => {
  const payload = buildPrintableRegularAnnotationPayload({
    annotationsByPage: {
      1: {
        objects: [
          { id: 'regular-counter', type: 'circle', left: 10, top: 10, radius: 8, data: { type: 'counter', id: 'regular-counter' } },
          { id: 'survey-counter', type: 'circle', left: 40, top: 10, radius: 8, moduleId: 'module-a', data: { type: 'counter', id: 'survey-counter' } },
          { id: 'region-counter', type: 'circle', left: 70, top: 10, radius: 8, regionId: 'region-a', data: { type: 'counter', id: 'region-counter' } },
        ],
      },
    },
  });

  assert.deepEqual(
    payload.annotationsByPage[1].objects.map((obj) => obj.id),
    ['regular-counter'],
  );
  assert.equal(payload.diagnostics.included.counters, 1);
  assert.equal(payload.diagnostics.excluded.counters, 2);
});

test('printable regular annotation filter includes regular callouts as ordinary annotations', () => {
  const payload = buildPrintableRegularAnnotationPayload({
    callouts: [
      { id: 'regular-callout', pageNumber: 1, arrowTip: { x: 0.1, y: 0.1 }, knee: { x: 0.2, y: 0.2 }, textBoxPosition: { x: 0.3, y: 0.2 }, text: 'Regular' },
      { id: 'survey-callout', pageNumber: 1, moduleId: 'module-a', arrowTip: { x: 0.1, y: 0.1 }, knee: { x: 0.2, y: 0.2 }, textBoxPosition: { x: 0.3, y: 0.2 }, text: 'Survey' },
      { id: 'region-callout', pageNumber: 1, regionId: 'region-a', arrowTip: { x: 0.1, y: 0.1 }, knee: { x: 0.2, y: 0.2 }, textBoxPosition: { x: 0.3, y: 0.2 }, text: 'Region' },
    ],
  });

  assert.deepEqual(payload.callouts.map((callout) => callout.id), ['regular-callout']);
  assert.equal(payload.diagnostics.included.callouts, 1);
  assert.equal(payload.diagnostics.excluded.callouts, 2);
});

test('normal Print remains base PDF print and Command+S remains app-state only', () => {
  assert.match(APP_SOURCE, /window\.electronAPI\.onPrintPdf\(\(\) => openPanel\('electron menu:print-pdf'\)\)/);
  assert.match(APP_SOURCE, /printPdfBlob\(pdfFile,/);
  assert.match(APP_SOURCE, /actionType:\s*'app-state-save'/);
  assert.match(APP_SOURCE, /pdfBytesGenerated:\s*false/);
});

test('PDF export success path does not show a blocking exported alert', () => {
  assert.equal(
    APP_SOURCE.includes('alert(`Exported to '),
    false,
    'successful explicit Export should not use a blocking success alert',
  );
  assert.match(APP_SOURCE, /actionType:\s*'pdf-export'/);
  assert.match(APP_SOURCE, /outputPath:\s*result\?\.filePath \|\| null/);
});

test('Space CSV region filtering uses stored page coordinates, not viewer scale', () => {
  assert.match(
    APP_SOURCE,
    /regionContainsPoint\(centerX,\s*centerY,\s*region,\s*1\)/,
    'Space CSV region membership must not depend on current zoom scale',
  );
});

test('Space PDF menu label states it exports base PDF pages, not annotated PDF output', () => {
  assert.match(SPACES_PANEL_SOURCE, />\s*PDF Pages\s*</);
  assert.match(
    SPACES_PANEL_SOURCE,
    /Exports base PDF pages only; app annotations are not embedded\./,
  );
});

test('PDF export embeds explicit counter metadata on app-created counter pins', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const bytes = await savePDFWithAnnotationsPdfLib(
      await makePdfFile(),
      {
        1: {
          objects: [{
            type: 'circle',
            left: 24,
            top: 36,
            radius: 12,
            fill: '#ef4444',
            stroke: '#ffffff',
            strokeWidth: 1.5,
            data: {
              type: 'counter',
              id: 'counter-1',
              displayNumber: 7,
              pointerAngle: 225,
              seriesId: 'series-a',
              seriesName: 'Deficiency',
              seriesColor: '#ef4444',
              seriesStart: 4,
            },
          }],
        },
      },
      { 1: { width: 200, height: 200 } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-test' },
    );

    const doc = await PDFDocument.load(bytes);
    const page = doc.getPage(0);
    const annots = page.node.lookup(PDFName.of('Annots'));
    assert.ok(annots);
    const annotDict = doc.context.lookup(annots.asArray()[0]);
    const subject = annotDict.get(PDFName.of('Subj')).decodeText();
    const metadataText = annotDict.get(PDFName.of(PDF_COUNTER_METADATA_KEY)).decodeText();
    const metadata = parsePdfCounterMetadata(metadataText);

    assert.equal(subject, PDF_COUNTER_SUBJECT);
    assert.equal(metadata.kind, PDF_COUNTER_SUBJECT);
    assert.equal(metadata.id, 'counter-1');
    assert.equal(metadata.displayNumber, 7);
    assert.equal(metadata.color, '#ef4444');
    assert.equal(metadata.series.id, 'series-a');
    assert.equal(metadata.pageNumber, 1);
    assert.equal(metadata.position.left, 24);
    assert.equal(metadata.position.top, 36);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('PDF export contract includes regular, survey, region, and survey-region app annotations', () => {
  const plan = buildPdfExportAnnotationPlan({
    pageSizes: { 1: { width: 200, height: 200 } },
    spaces: [{
      id: 'space-a',
      assignedPages: [{ pageId: 1, regions: [{ regionId: 'region-a' }] }],
    }],
    annotationsByPage: {
      1: {
        objects: [
          { id: 'regular', type: 'rect', left: 10, top: 10, width: 20, height: 20 },
          { id: 'survey', type: 'circle', left: 40, top: 10, radius: 8, moduleId: 'module-a' },
          { id: 'region', type: 'line', x1: 10, y1: 60, x2: 50, y2: 60, regionId: 'region-a' },
          { id: 'survey-region', type: 'textbox', left: 10, top: 80, width: 60, height: 20, text: 'SR', moduleId: 'module-a', regionId: 'region-a' },
        ],
      },
    },
  });

  assert.equal(plan.diagnostics.totalObjectsConsidered, 4);
  assert.equal(plan.diagnostics.objectsExported, 4);
  assert.equal(plan.diagnostics.objectsSkipped, 0);
  assert.deepEqual(plan.diagnostics.byScope, {
    canvas: 1,
    survey: 1,
    region: 1,
    'survey-region': 1,
  });
});

test('PDF export skips imported PDF-native app copies to avoid duplicate annotations', () => {
  const plan = buildPdfExportAnnotationPlan({
    pageSizes: { 1: { width: 200, height: 200 } },
    annotationsByPage: {
      1: {
        objects: [
          { id: 'external-circle-copy', type: 'circle', left: 20, top: 20, radius: 8, isPdfImported: true, pdfAnnotationId: 'pdf-native-1' },
          { id: 'app-circle', type: 'circle', left: 50, top: 20, radius: 8 },
        ],
      },
    },
  });

  assert.equal(plan.diagnostics.totalObjectsConsidered, 2);
  assert.equal(plan.diagnostics.objectsExported, 1);
  assert.equal(plan.diagnostics.objectsSkipped, 1);
  assert.equal(plan.diagnostics.skippedByReason['imported-pdf-native-preserved'], 1);
});

test('PDF export writes all supported app annotation scopes into the PDF', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const bytes = await savePDFWithAnnotationsPdfLib(
      await makePdfFile(),
      {
        1: {
          objects: [
            { id: 'regular', type: 'rect', left: 10, top: 10, width: 20, height: 20, stroke: '#111111' },
            { id: 'survey', type: 'circle', left: 40, top: 10, radius: 8, moduleId: 'module-a', stroke: '#111111' },
            { id: 'region', type: 'line', x1: 10, y1: 60, x2: 50, y2: 60, regionId: 'region-a', stroke: '#111111' },
            { id: 'survey-region', type: 'textbox', left: 10, top: 80, width: 60, height: 20, text: 'SR', moduleId: 'module-a', regionId: 'region-a' },
          ],
        },
      },
      { 1: { width: 200, height: 200 } },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'doc-test',
        spaces: [{ id: 'space-a', assignedPages: [{ pageId: 1, regions: [{ regionId: 'region-a' }] }] }],
      },
    );

    assert.deepEqual(await getPdfAnnotationSubtypes(bytes), ['Square', 'Circle', 'Line', 'FreeText']);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('PDF export includes survey highlights, region highlights, survey-region highlights, and callouts', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const bytes = await savePDFWithAnnotationsPdfLib(
      await makePdfFile(),
      {},
      { 1: { width: 200, height: 200 } },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'doc-test',
        spaces: [{ id: 'space-a', assignedPages: [{ pageId: 1, regions: [{ regionId: 'region-a' }] }] }],
        highlightAnnotations: {
          'survey-highlight': { pageNumber: 1, bounds: { x: 10, y: 10, width: 20, height: 10 }, moduleId: 'module-a', color: '#ffff00' },
          'region-highlight': { pageNumber: 1, bounds: { x: 10, y: 30, width: 20, height: 10 }, regionId: 'region-a', color: '#ffff00' },
          'survey-region-highlight': { pageNumber: 1, bounds: { x: 10, y: 50, width: 20, height: 10 }, moduleId: 'module-a', regionId: 'region-a', color: '#ffff00' },
        },
        callouts: [{
          id: 'callout-1',
          pageNumber: 1,
          moduleId: 'module-a',
          regionId: 'region-a',
          arrowTip: { x: 0.1, y: 0.1 },
          knee: { x: 0.2, y: 0.2 },
          textBoxPosition: { x: 0.3, y: 0.2 },
          textBoxWidth: 0.2,
          textBoxHeight: 0.1,
          text: 'Callout',
          style: { borderColor: '#111111', fontColor: '#111111', lineThickness: 2 },
        }],
      },
    );

    assert.deepEqual(await getPdfAnnotationSubtypes(bytes), [
      'Highlight',
      'Highlight',
      'Highlight',
      'Line',
      'Line',
      'FreeText',
    ]);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('PDF export embeds app callout metadata on every exported callout piece', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const bytes = await savePDFWithAnnotationsPdfLib(
      await makePdfFile(),
      {},
      { 1: { width: 200, height: 200 } },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'doc-test',
        callouts: [{
          id: 'callout-metadata-1',
          pageNumber: 1,
          moduleId: 'module-a',
          regionId: 'region-a',
          spaceId: 'space-a',
          arrowTip: { x: 0.1, y: 0.2 },
          knee: { x: 0.2, y: 0.3 },
          textBoxPosition: { x: 0.4, y: 0.35 },
          textBoxWidth: 0.25,
          textBoxHeight: 0.12,
          text: 'Metadata callout',
          style: { borderColor: '#0f172a', fontColor: '#dc2626', lineThickness: 3, fontSize: 16 },
        }],
      },
    );

    const calloutDicts = (await getPdfAnnotationDicts(bytes)).filter((dict) => (
      dict.get(PDFName.of('Subj'))?.decodeText?.() === PDF_CALLOUT_SUBJECT
    ));
    assert.equal(calloutDicts.length, 3);

    const parts = calloutDicts.map((dict) => {
      const raw = dict.get(PDFName.of(PDF_CALLOUT_METADATA_KEY)).decodeText();
      const metadata = parsePdfCalloutMetadata(raw);
      assert.equal(metadata.id, 'callout-metadata-1');
      assert.equal(metadata.text, 'Metadata callout');
      assert.equal(metadata.moduleId, 'module-a');
      assert.equal(metadata.regionId, 'region-a');
      assert.equal(metadata.spaceId, 'space-a');
      assert.equal(metadata.style.fontColor, '#dc2626');
      assert.deepEqual(metadata.arrowTip, { x: 0.1, y: 0.2 });
      assert.deepEqual(metadata.knee, { x: 0.2, y: 0.3 });
      assert.deepEqual(metadata.textBoxPosition, { x: 0.4, y: 0.35 });
      assert.equal(metadata.textBoxWidth, 0.25);
      assert.equal(metadata.textBoxHeight, 0.12);
      return metadata.part;
    }).sort();

    assert.deepEqual(parts, ['line1', 'line2', 'text']);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('PDF export embeds app annotation metadata on ordinary app-created annotations', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const bytes = await savePDFWithAnnotationsPdfLib(
      await makePdfFile(),
      {
        1: {
          objects: [
            { id: 'meta-path', type: 'path', left: 0, top: 0, path: [['M', 10, 10], ['L', 20, 20]], stroke: '#111111', strokeWidth: 2, moduleId: 'module-a', regionId: 'region-a', spaceId: 'space-a', layer: 'survey' },
            { id: 'meta-rect', type: 'rect', left: 30, top: 10, width: 20, height: 12, stroke: '#111111' },
            { id: 'meta-circle', type: 'circle', left: 60, top: 10, radius: 8, stroke: '#111111' },
            { id: 'meta-line', type: 'line', x1: 10, y1: 50, x2: 40, y2: 55, stroke: '#111111' },
            { id: 'meta-polygon', type: 'polygon', left: 80, top: 20, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 20 }], stroke: '#111111' },
            { id: 'meta-polyline', type: 'polyline', left: 110, top: 20, points: [{ x: 0, y: 0 }, { x: 20, y: 10 }], stroke: '#111111' },
            { id: 'meta-text', type: 'textbox', left: 20, top: 90, width: 60, height: 18, text: 'Meta', fill: '#111111' },
          ],
        },
      },
      { 1: { width: 200, height: 200 } },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'doc-test',
        highlightAnnotations: {
          'meta-highlight': {
            pageNumber: 1,
            bounds: { x: 100, y: 90, width: 30, height: 12 },
            moduleId: 'module-a',
            regionId: 'region-a',
            spaceId: 'space-a',
            color: '#ffff00',
          },
        },
      },
    );

    const metadata = (await getPdfAnnotationDicts(bytes)).map((dict) => {
      assert.equal(dict.get(PDFName.of('Subj'))?.decodeText?.(), PDF_APP_ANNOTATION_SUBJECT);
      return parsePdfAppAnnotationMetadata(
        dict.get(PDFName.of(PDF_APP_ANNOTATION_METADATA_KEY))?.decodeText?.(),
      );
    });

    assert.deepEqual(metadata.map((entry) => entry.id).sort(), [
      'meta-circle',
      'meta-highlight',
      'meta-line',
      'meta-path',
      'meta-polygon',
      'meta-polyline',
      'meta-rect',
      'meta-text',
    ]);
    assert.equal(metadata.find((entry) => entry.id === 'meta-path').moduleId, 'module-a');
    assert.equal(metadata.find((entry) => entry.id === 'meta-path').regionId, 'region-a');
    assert.equal(metadata.find((entry) => entry.id === 'meta-path').spaceId, 'space-a');
    assert.equal(metadata.find((entry) => entry.id === 'meta-highlight').appType, 'highlight');
    assert.equal(metadata.find((entry) => entry.id === 'meta-highlight').moduleId, 'module-a');
    assert.equal(metadata.find((entry) => entry.id === 'meta-highlight').regionId, 'region-a');
    assert.equal(metadata.find((entry) => entry.id === 'meta-highlight').spaceId, 'space-a');
    assert.equal(metadata.find((entry) => entry.id === 'meta-text').geometry.text, 'Meta');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('PDF export preserves existing native annotations and does not duplicate imported copies', async () => {
  const sourceDoc = await PDFDocument.create();
  const page = sourceDoc.addPage([200, 200]);
  const nativeAnnot = sourceDoc.context.register(sourceDoc.context.obj({
    Type: 'Annot',
    Subtype: 'Circle',
    Rect: [20, 160, 40, 180],
    Border: [0, 0, 1],
    Contents: '',
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), sourceDoc.context.obj([nativeAnnot]));
  const sourceBytes = await sourceDoc.save();
  const pdfFile = {
    name: 'native-source.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
    },
  };

  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const bytes = await savePDFWithAnnotationsPdfLib(
      pdfFile,
      { 1: { objects: [{ type: 'circle', left: 20, top: 20, radius: 10, isPdfImported: true, pdfAnnotationId: 'native-1' }] } },
      { 1: { width: 200, height: 200 } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-test' },
    );

    assert.deepEqual(await getPdfAnnotationSubtypes(bytes), ['Circle']);
  } finally {
    globalThis.window = originalWindow;
  }
});
