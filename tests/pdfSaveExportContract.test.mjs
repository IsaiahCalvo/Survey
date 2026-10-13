import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFString, decodePDFRawStream, degrees } from 'pdf-lib';
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
  PDF_APP_LAYER_STATE_KEY,
  applyPdfAppAnnotationMetadata,
  parsePdfAppLayerStateMetadata,
  parsePdfAppAnnotationMetadata,
} from '../src/utils/pdfAppAnnotationMetadata.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import { getCounterLabelLayout } from '../src/utils/counterGeometry.js';
import { createTextMarkupAnnotation } from '../src/utils/pdfTextMarkup.js';
import { buildTextMarkupPaintEditTransaction } from '../src/utils/textMarkupGroupTransactions.js';

const APP_SOURCE = readFileSync(new URL('../src/viewerShared.js', import.meta.url), 'utf8')
  + '\n' + readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8')
  + '\n' + readFileSync(new URL('../src/utils/spaceCSVExporter.js', import.meta.url), 'utf8');
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

async function makeRotatedPdfFile(name = 'rotated-source.pdf') {
  const doc = await PDFDocument.create();
  for (const rotation of [0, 90, 180, 270]) {
    const page = doc.addPage([200, 100]);
    page.setRotation(degrees(rotation));
  }
  const bytes = await doc.save();
  return {
    name,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

async function makePdfFileWithUnsafeImportedRedaction({ includeRect = true } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const opaqueAppearance = doc.context.register(doc.context.flateStream(
    'q\n0 0 0 rg\n0 0 120 18 re f\nQ\n',
    {
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: [0, 0, 120, 18],
      Resources: {},
    },
  ));
  const unsafeRedactionDict = {
    Type: 'Annot',
    Subtype: 'Redact',
    C: [0, 0, 0],
    Contents: PDFString.of('Selectable line one on page 1.'),
    OverlayText: PDFString.of('Selectable line one on page 1.'),
    AP: { N: opaqueAppearance },
    P: page.ref,
  };
  if (includeRect) unsafeRedactionDict.Rect = [20, 120, 140, 138];
  const unsafeRedaction = doc.context.register(doc.context.obj(unsafeRedactionDict));
  page.node.set(PDFName.of('Annots'), doc.context.obj([unsafeRedaction]));
  const bytes = await doc.save();
  return {
    name: 'unsafe-imported-redaction.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function makeUnsafeImportedRedactionFixtureFile() {
  const bytes = readFileSync(new URL('../debug/fixtures/unapplied-redaction-leak.pdf', import.meta.url));
  return {
    name: 'unapplied-redaction-leak.pdf',
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

async function getPdfAnnotationDictsByPage(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const annots = page.node.lookup(PDFName.of('Annots'));
    return annots ? annots.asArray().map((ref) => doc.context.lookup(ref)) : [];
  });
}

async function getPdfPageContentStrings(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.lookup(PDFName.of('Contents'));
    const entries = contents?.asArray?.() || (contents ? [contents] : []);
    return entries.map((entry) => {
      const stream = doc.context.lookup(entry);
      return new TextDecoder().decode(decodePDFRawStream(stream).decode());
    }).join('\n');
  });
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

test('normal export makes imported unapplied redactions non-concealing and removes cleartext notes', async () => {
  const fixture = makeUnsafeImportedRedactionFixtureFile();
  const sourceBytes = new Uint8Array(await fixture.arrayBuffer());
  const [unsafeSourceRedact] = await getPdfAnnotationDicts(sourceBytes);
  assert.equal(unsafeSourceRedact.get(PDFName.of('Contents')).decodeText(), 'Selectable line one on page 1.');
  const unsafeAppearance = unsafeSourceRedact.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
  const unsafeAppearanceSource = new TextDecoder().decode(decodePDFRawStream(unsafeAppearance).decode());
  assert.match(unsafeAppearanceSource, /\bre\s+f\b/, 'the fixture must carry an opaque appearance');

  const bytes = await savePDFWithAnnotationsPdfLib(
    fixture,
    {},
    {},
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-imported-redact' },
  );
  const [redact] = await getPdfAnnotationDicts(bytes);
  assert.equal(redact.get(PDFName.of('Contents')), undefined);
  assert.equal(redact.get(PDFName.of('OverlayText')), undefined);
  const appearance = redact.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
  const appearanceSource = new TextDecoder().decode(decodePDFRawStream(appearance).decode());
  assert.match(appearanceSource, /\bre\s+S\b/, 'the mark should have a hollow outline');
  assert.match(appearanceSource, /0\.81569 0\.00784 0\.10588 RG/, 'the outline should use the pending-redaction red');
  assert.match(appearanceSource, /\b1 w\b/, 'the outline should use a thin one-point stroke');
  assert.doesNotMatch(appearanceSource, /\bre\s+f\b/, 'the mark must not have an opaque fill');
  // Safety: the pending mark is stroked only — no fill operator may paint
  // over (or conceal) the page content beneath it.
  assert.doesNotMatch(appearanceSource, /\b(f|f\*|B|B\*|b|b\*)\b/);
});

test('normal export drops an unsafe appearance when an imported redaction has no usable rectangle', async () => {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFileWithUnsafeImportedRedaction({ includeRect: false }),
    {},
    {},
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-malformed-redact' },
  );
  const [redact] = await getPdfAnnotationDicts(bytes);
  assert.equal(redact.get(PDFName.of('Contents')), undefined);
  assert.equal(redact.get(PDFName.of('OverlayText')), undefined);
  assert.equal(redact.get(PDFName.of('AP')), undefined);
});

test('live PDF export keeps all four saved text markup colors, opacities, and quads', async () => {
  const types = ['highlight', 'underline', 'squiggly', 'strikeout'];
  const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
  const opacities = [0.3, 0.45, 0.6, 0.75];
  const objects = types.map((markupType, index) => createTextMarkupAnnotation({
    id: `text-mark-${markupType}`,
    pageNumber: 1,
    selectionGroupId: 'text-group',
    markupType,
    selectedText: `selected ${markupType}`,
    color: colors[index],
    opacity: opacities[index],
    quads: [{
      x1: 10, y1: 10 + index * 25,
      x2: 90, y2: 10 + index * 25,
      x3: 10, y3: 24 + index * 25,
      x4: 90, y4: 24 + index * 25,
    }],
  }));
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-text-markup' },
  );

  assert.deepEqual(await getPdfAnnotationSubtypes(bytes), ['Highlight', 'Underline', 'Squiggly', 'StrikeOut']);
  const dicts = await getPdfAnnotationDicts(bytes);
  dicts.forEach((dict, index) => {
    assert.equal(dict.get(PDFName.of('Contents')).decodeText(), `selected ${types[index]}`);
    assert.equal(dict.lookup(PDFName.of('QuadPoints')).asArray().length, 8);
    assert.equal(dict.lookup(PDFName.of('CA')).asNumber(), opacities[index]);
    assert.deepEqual(
      dict.lookup(PDFName.of('C')).asArray().map((entry) => entry.asNumber()),
      index === 0 ? [1, 0, 0]
        : index === 1 ? [0, 1, 0]
          : index === 2 ? [0, 0, 1] : [1, 1, 0],
    );
  });
});

test('native export uses the edited active mark color and opacity', async () => {
  const types = ['highlight', 'underline', 'squiggly', 'strikeout'];
  const objects = types.map((markupType) => createTextMarkupAnnotation({
    id: `edit-export-${markupType}`,
    pageNumber: 1,
    selectionGroupId: `edit-export-${markupType}-group`,
    markupType,
    selectedText: 'stacked export edit',
    color: markupType === 'strikeout' ? '#3d63dc' : '#f5c229',
    opacity: 0.3,
    quads: [{ x1: 10, y1: 20, x2: 100, y2: 20, x3: 10, y3: 35, x4: 100, y4: 35 }],
  }));
  const transaction = buildTextMarkupPaintEditTransaction({
    annotationsByPage: { 1: { objects } },
    annotation: objects[3],
    color: '#0000FF',
    opacity: 0.65,
  });
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    transaction.nextByPage,
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'edited-active-mark-export' },
  );

  const dicts = await getPdfAnnotationDicts(bytes);
  assert.equal(dicts[3].lookup(PDFName.of('CA')).asNumber(), 0.65);
  assert.deepEqual(
    dicts[3].lookup(PDFName.of('C')).asArray().map((entry) => entry.asNumber()),
    [0, 0, 1],
  );
});

test('live PDF export writes links and non-concealing redaction marks without selected text', async () => {
  const quad = { x1: 10, y1: 20, x2: 90, y2: 20, x3: 10, y3: 34, x4: 90, y4: 34 };
  const objects = [
    createTextMarkupAnnotation({
      id: 'text-link', pageNumber: 1, selectionGroupId: 'link-group', markupType: 'link',
      selectedText: 'Open docs', linkUrl: 'https://example.com/docs', quads: [quad],
    }),
    createTextMarkupAnnotation({
      id: 'text-redact', pageNumber: 1, selectionGroupId: 'redact-group', markupType: 'redact',
      selectedText: 'Private text', quads: [{ ...quad, y1: 50, y2: 50, y3: 64, y4: 64 }],
    }),
  ];
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-link-redact' },
  );
  assert.deepEqual(await getPdfAnnotationSubtypes(bytes), ['Link', 'Redact']);
  const [link, redact] = await getPdfAnnotationDicts(bytes);
  assert.equal(link.lookup(PDFName.of('A')).lookup(PDFName.of('URI')).decodeText(), 'https://example.com/docs');
  assert.equal(redact.lookup(PDFName.of('QuadPoints')).asArray().length, 8);
  assert.equal(redact.get(PDFName.of('Contents')), undefined);
  const appearance = redact.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
  const appearanceSource = new TextDecoder().decode(decodePDFRawStream(appearance).decode());
  // Hollow outline: a rect (`re S`) for legacy marks, a closed path per
  // source run (`h S`) when the mark carries QuadPoints.
  assert.match(appearanceSource, /\b(re|h)\s+S\b/);
  assert.match(appearanceSource, /0\.81569 0\.00784 0\.10588 RG/);
  assert.match(appearanceSource, /\b1 w\b/);
  assert.doesNotMatch(appearanceSource, /\bre\s+f\b/);
  // Safety: stroked only — no fill operator may paint over the page content.
  assert.doesNotMatch(appearanceSource, /\b(f|f\*|B|B\*|b|b\*)\b/);
});

test('live PDF export writes selected-text page links as GoTo actions', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.addPage([200, 200]);
  const sourceBytes = await doc.save();
  const file = { name: 'page-link.pdf', async arrayBuffer() { return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength); } };
  const link = createTextMarkupAnnotation({
    id: 'text-page-link', pageNumber: 1, selectionGroupId: 'page-link-group', markupType: 'link',
    selectedText: 'Next page', linkPageNumber: 2,
    quads: [{ x1: 10, y1: 20, x2: 90, y2: 20, x3: 10, y3: 34, x4: 90, y4: 34 }],
  });
  const bytes = await savePDFWithAnnotationsPdfLib(
    file,
    { 1: { objects: [link] } },
    { 1: { width: 200, height: 200 }, 2: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-page-link' },
  );
  const [dict] = await getPdfAnnotationDicts(bytes);
  const action = dict.lookup(PDFName.of('A'));
  assert.equal(action.lookup(PDFName.of('S')), PDFName.of('GoTo'));
  assert.equal(action.lookup(PDFName.of('D')).asArray()[1], PDFName.of('Fit'));
});

test('native text markup export converts rotated PDF.js viewport quads into base PDF coordinates', async () => {
  const viewportSizes = [
    { width: 200, height: 100 },
    { width: 100, height: 200 },
    { width: 200, height: 100 },
    { width: 100, height: 200 },
  ];
  const annotationsByPage = Object.fromEntries(viewportSizes.map((_size, index) => [index + 1, {
    objects: [createTextMarkupAnnotation({
      id: `rotated-${index}`,
      pageNumber: index + 1,
      selectionGroupId: 'rotated-group',
      markupType: 'highlight',
      selectedText: `rotation ${index * 90}`,
      color: '#ffd400',
      opacity: 0.4,
      quads: [{ x1: 10, y1: 20, x2: 30, y2: 20, x3: 10, y3: 40, x4: 30, y4: 40 }],
    })],
  }]));
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makeRotatedPdfFile(),
    annotationsByPage,
    Object.fromEntries(viewportSizes.map((size, index) => [index + 1, size])),
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'rotated-native-export' },
  );
  const dicts = await getPdfAnnotationDictsByPage(bytes);
  const quadValues = dicts.map(([dict]) => (
    dict.lookup(PDFName.of('QuadPoints')).asArray().map((value) => value.asNumber())
  ));
  assert.deepEqual(quadValues, [
    [10, 80, 30, 80, 10, 60, 30, 60],
    [20, 10, 20, 30, 40, 10, 40, 30],
    [190, 20, 170, 20, 190, 40, 170, 40],
    [180, 90, 180, 70, 160, 90, 160, 70],
  ]);
});

test('Uniform export flattens rotated PDF.js viewport quads under each page transform', async () => {
  const viewportSizes = [
    { width: 200, height: 100 },
    { width: 100, height: 200 },
    { width: 200, height: 100 },
    { width: 100, height: 200 },
  ];
  const annotationsByPage = Object.fromEntries(viewportSizes.map((_size, index) => [index + 1, {
    objects: [createTextMarkupAnnotation({
      id: `uniform-rotated-${index}`,
      pageNumber: index + 1,
      selectionGroupId: `uniform-rotated-group-${index}`,
      markupType: 'highlight',
      selectedText: `rotation ${index * 90}`,
      color: '#ffd400',
      opacity: 0.4,
      overlapMode: 'uniform',
      quads: [{ x1: 10, y1: 20, x2: 30, y2: 20, x3: 10, y3: 40, x4: 30, y4: 40 }],
    })],
  }]));
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makeRotatedPdfFile(),
    annotationsByPage,
    Object.fromEntries(viewportSizes.map((size, index) => [index + 1, size])),
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'rotated-uniform-export' },
  );
  assert.deepEqual(await getPdfAnnotationSubtypes(bytes), []);
  const contents = await getPdfPageContentStrings(bytes);
  for (const content of contents) {
    assert.match(content, /10 20 m\s+30 20 l\s+30 40 l\s+10 40 l/);
  }
});

test('print helper flattens all four saved text mark paints into visible page content', async () => {
  const types = ['highlight', 'underline', 'squiggly', 'strikeout'];
  const marks = types.map((markupType, index) => createTextMarkupAnnotation({
    id: `print-${markupType}`,
    pageNumber: 1,
    markupType,
    selectedText: `printed ${markupType}`,
    color: ['#ffcc00', '#ff0000', '#0000ff', '#00aa00'][index],
    opacity: [0.3, 0.45, 0.6, 0.75][index],
    quads: [{
      x1: 20, y1: 20 + index * 30,
      x2: 100, y2: 20 + index * 30,
      x3: 20, y3: 35 + index * 30,
      x4: 100, y4: 35 + index * 30,
    }],
  }));
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: marks } },
    { 1: { width: 200, height: 200 } },
  );
  assert.equal(await pageHasContentStream(bytes), true);
  assert.deepEqual(await getPdfAnnotationSubtypes(bytes), []);
});

test('Uniform highlight export flattens one visual mask while Layered stays native', async () => {
  const makeMarks = (overlapMode) => [0, 1].map((index) => createTextMarkupAnnotation({
    id: `${overlapMode}-${index}`,
    pageNumber: 1,
    selectionGroupId: `${overlapMode}-group-${index}`,
    markupType: 'highlight',
    selectedText: 'overlap',
    color: '#ffd400',
    opacity: 0.4,
    overlapMode,
    quads: [{
      x1: 20 + index * 20, y1: 30,
      x2: 100 + index * 20, y2: 30,
      x3: 20 + index * 20, y3: 50,
      x4: 100 + index * 20, y4: 50,
    }],
  }));
  const uniformBytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: makeMarks('uniform') } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'uniform-export' },
  );
  assert.deepEqual(await getPdfAnnotationSubtypes(uniformBytes), []);
  assert.equal(await pageHasContentStream(uniformBytes), true);

  const layeredBytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: makeMarks('layered') } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'layered-export' },
  );
  assert.deepEqual(await getPdfAnnotationSubtypes(layeredBytes), ['Highlight', 'Highlight']);
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

test('Electron File menu wires the annotated PDF export path with the documented accelerator', () => {
  // KAL-51: lock the export PATH (IPC channel + accelerator), not the literal label
  // string. The label was renamed from "Export" to "Export Annotated PDF…" to
  // disambiguate it from "Print PDF…" and "Print PDF with Annotations…". The
  // contract that matters is that Cmd/Ctrl+Shift+E still dispatches the
  // menu:export-annotated-pdf IPC channel that App.jsx listens on.
  assert.match(ELECTRON_MAIN_SOURCE, /menu:export-annotated-pdf/);
  assert.match(ELECTRON_MAIN_SOURCE, /accelerator:\s*'CmdOrCtrl\+Shift\+E'/);
  // The export menu item's click handler must send the export-annotated-pdf
  // channel; assert the accelerator and channel co-occur in a single submenu item.
  assert.match(
    ELECTRON_MAIN_SOURCE,
    /accelerator:\s*'CmdOrCtrl\+Shift\+E'[\s\S]{0,400}menu:export-annotated-pdf/,
    'Cmd+Shift+E must dispatch menu:export-annotated-pdf',
  );
  // The label must not regress to the bare ambiguous "Export" word that the
  // KAL-8 audit flagged. It must clearly mark annotated PDF output.
  assert.equal(
    /label:\s*'Export'\s*,/.test(ELECTRON_MAIN_SOURCE),
    false,
    'File menu export item must not use the bare ambiguous "Export" label (KAL-51)',
  );
  assert.match(ELECTRON_MAIN_SOURCE, /label:\s*'Export annotated PDF/);
});

test('current print-with-annotations path prints regular app annotations through flattened temporary PDF bytes', () => {
  assert.match(ELECTRON_MAIN_SOURCE, /label:\s*'Print PDF…'/);
  assert.match(ELECTRON_MAIN_SOURCE, /label:\s*'Print PDF with annotations…'/);
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
  // Sweep flag is 1 since the 2026-07-17 drawSvgPath origin fix: the pin path
  // now uses raw app-space (y-down) coordinates with origin {x:0, y:pageHeight},
  // the same frame as the on-screen pin in counterGeometry.js (sweep 1). The
  // old sweep 0 belonged to the pre-flipped getPdfY frame that drew off-page.
  // On-page + orientation proof: tests/printFlattenOnPage.test.mjs.
  assert.match(PDF_LIB_SOURCE, /A \$\{radius\} \$\{radius\} 0 1 1/);
  assert.match(PDF_LIB_SOURCE, /counter pin path flattened/);
  assert.match(PDF_LIB_SOURCE, /getCounterLabelLayout\(radius, text\)/);
  assert.match(PDF_LIB_SOURCE, /fontSize \*= labelLayout\.maxWidth \/ textWidth/);
});

test('native counter appearance stream caps its label using shared layout', () => {
  assert.match(PDF_LIB_SOURCE, /getCounterLabelLayout\(radius, label\)/);
  assert.match(PDF_LIB_SOURCE, /fontSize \*= labelLayout\.maxWidth \/ approximateTextWidth/);
  assert.doesNotMatch(PDF_LIB_SOURCE, /Math\.max\(6, radius \* 0\.95\)/);
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

test('print payload includes canvas, survey, space, and region annotations', () => {
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
    ['regular-path', 'regular-rect', 'survey-circle', 'region-line', 'space-polyline', 'survey-region-text'],
  );
  assert.equal(payload.diagnostics.included.fabric, 6);
  assert.equal(Object.values(payload.diagnostics.excludedByScope).reduce((sum, value) => sum + value, 0), 0);
});

test('print payload carries survey highlights into the flattener', () => {
  const payload = buildPrintableRegularAnnotationPayload({
    annotationsByPage: {
      1: {
        objects: [
          { id: 'survey-highlight-screen-copy', annotationId: 'survey-highlight', type: 'rect', left: 10, top: 10, width: 20, height: 10 },
          { id: 'regular-rect', type: 'rect', left: 70, top: 10, width: 20, height: 10 },
        ],
      },
    },
    surveyMarkers: {
      'survey-highlight': { pageNumber: 1, bounds: { x: 10, y: 10, width: 20, height: 10 }, moduleId: 'module-a' },
      'region-highlight': { pageNumber: 1, bounds: { x: 20, y: 20, width: 20, height: 10 }, regionId: 'region-a' },
      'space-highlight': { pageNumber: 1, bounds: { x: 30, y: 30, width: 20, height: 10 }, spaceId: 'space-a' },
      'survey-region-highlight': { pageNumber: 1, bounds: { x: 40, y: 40, width: 20, height: 10 }, moduleId: 'module-a', regionId: 'region-a' },
    },
  });

  assert.equal(Object.keys(payload.surveyMarkers).length, 4);
  assert.equal(payload.diagnostics.included.surveyMarkers, 4);
  assert.deepEqual(payload.annotationsByPage[1].objects.map((obj) => obj.id), ['regular-rect']);
});

test('print payload includes regular and scoped counters', () => {
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
    ['regular-counter', 'survey-counter', 'region-counter'],
  );
  assert.equal(payload.diagnostics.included.counters, 3);
  assert.equal(payload.diagnostics.excluded.counters, 0);
});

test('printable regular annotation filter includes regular callouts as ordinary annotations', () => {
  const payload = buildPrintableRegularAnnotationPayload({
    callouts: [
      { id: 'regular-callout', pageNumber: 1, arrowTip: { x: 0.1, y: 0.1 }, knee: { x: 0.2, y: 0.2 }, textBoxPosition: { x: 0.3, y: 0.2 }, text: 'Regular' },
      { id: 'survey-callout', pageNumber: 1, moduleId: 'module-a', arrowTip: { x: 0.1, y: 0.1 }, knee: { x: 0.2, y: 0.2 }, textBoxPosition: { x: 0.3, y: 0.2 }, text: 'Survey' },
      { id: 'region-callout', pageNumber: 1, regionId: 'region-a', arrowTip: { x: 0.1, y: 0.1 }, knee: { x: 0.2, y: 0.2 }, textBoxPosition: { x: 0.3, y: 0.2 }, text: 'Region' },
    ],
  });

  assert.deepEqual(payload.callouts.map((callout) => callout.id), ['regular-callout', 'survey-callout', 'region-callout']);
  assert.equal(payload.diagnostics.included.callouts, 3);
  assert.equal(payload.diagnostics.excluded.callouts, 0);
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

test('PDF export uses original PDF bytes as the source to avoid baked viewer annotation artifacts', () => {
  // Original bytes — after any background page-operation save has landed
  // (instant page operations, 2026-10-01), so the bytes match the pages.
  assert.match(APP_SOURCE, /const sourcePdfForExport = \(await flushPageOperations\(\)\) \|\| pdfFile/);
  assert.equal(
    /sourcePdfForExport\s*=\s*blob/.test(APP_SOURCE),
    false,
    'explicit PDF export must not replace the source PDF with Pdfjs saveAsBlob output',
  );
  assert.match(APP_SOURCE, /skippedViewerSaveAsBlob:\s*true/);
  assert.match(APP_SOURCE, /prevents baked page artifacts plus duplicate editable app annotations/);
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

    const appearance = doc.context.lookup(annotDict.get(PDFName.of('AP')));
    const normal = appearance && doc.context.lookup(appearance.get(PDFName.of('N')));
    assert.ok(normal, 'counter export must carry a visible appearance stream');
    const appearanceText = new TextDecoder().decode(decodePDFRawStream(normal).decode());
    assert.match(appearanceText, /\(7\)\s+Tj/, 'appearance must paint the counter number');
    const rect = annotDict.get(PDFName.of('Rect')).asArray().map((n) => n.asNumber());
    assert.ok(rect[0] < 24 || rect[1] < 140, 'counter /Rect must include the pin nub outside the circle body');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('PDF counter appearance keeps a three-digit label inside a radius-4 pin', async () => {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    {
      1: {
        objects: [{
          type: 'circle',
          left: 24,
          top: 36,
          radius: 4,
          fill: '#ef4444',
          data: {
            type: 'counter',
            id: 'counter-small',
            displayNumber: 100,
            pointerAngle: 225,
            seriesId: 'series-small',
            seriesStart: 100,
          },
        }],
      },
    },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-test' },
  );

  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  const annotDict = doc.context.lookup(annots.asArray()[0]);
  const appearance = doc.context.lookup(annotDict.get(PDFName.of('AP')));
  const normal = doc.context.lookup(appearance.get(PDFName.of('N')));
  const appearanceText = new TextDecoder().decode(decodePDFRawStream(normal).decode());
  const fontMatch = appearanceText.match(/\/F1\s+([0-9.]+)\s+Tf/);
  assert.ok(fontMatch, 'appearance must set the counter label font');

  const fontSize = Number(fontMatch[1]);
  const layout = getCounterLabelLayout(4, 100);
  assert.ok(fontSize <= layout.fontSize + 1e-6);
  assert.ok(3 * fontSize * 0.556 <= layout.maxWidth + 1e-6);
  assert.match(appearanceText, /\(100\)\s+Tj/);
});

test('PDF export contract includes only regular viewer annotations and excludes survey, space, and region scope', () => {
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
  assert.equal(plan.diagnostics.objectsExported, 1);
  assert.equal(plan.diagnostics.objectsSkipped, 3);
  assert.deepEqual(plan.diagnostics.byScope, {
    canvas: 1,
    survey: 1,
    region: 1,
    'survey-region': 1,
  });
  assert.equal(plan.diagnostics.skippedByReason['scoped-annotation-export-excluded'], 3);
  assert.deepEqual(plan.items.map((item) => item.id), ['regular']);
  assert.deepEqual(plan.contract.includedScopes, ['canvas']);
  assert.deepEqual(plan.contract.excludedScopes, ['survey', 'region', 'survey-region']);
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

test('PDF export includes edited imported PDF-native app copies', () => {
  const plan = buildPdfExportAnnotationPlan({
    pageSizes: { 1: { width: 200, height: 200 } },
    annotationsByPage: {
      1: {
        objects: [
          {
            id: 'edited-imported-circle',
            type: 'circle',
            left: 50,
            top: 20,
            radius: 8,
            isPdfImported: true,
            pdfAnnotationId: 'pdf-native-1',
            pdfImportedEditState: 'edited',
          },
          { id: 'unedited-imported-circle', type: 'circle', left: 20, top: 20, radius: 8, isPdfImported: true, pdfAnnotationId: 'pdf-native-2' },
        ],
      },
    },
  });

  assert.equal(plan.diagnostics.totalObjectsConsidered, 2);
  assert.equal(plan.diagnostics.objectsExported, 1);
  assert.equal(plan.diagnostics.objectsSkipped, 1);
  assert.equal(plan.diagnostics.editedImportedCopiesExported, 1);
  assert.equal(plan.diagnostics.importedNativeCopiesSkipped, 1);
  assert.equal(plan.items[0].id, 'edited-imported-circle');
});

test('PDF export replaces identifiable native annotation when imported copy was edited', async () => {
  const sourceDoc = await PDFDocument.create();
  const page = sourceDoc.addPage([200, 200]);
  const nativeAnnot = sourceDoc.context.register(sourceDoc.context.obj({
    Type: 'Annot',
    Subtype: 'Circle',
    Rect: [20, 160, 40, 180],
    Border: [0, 0, 1],
    Contents: 'old native',
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
      {
        1: {
          objects: [{
            id: 'edited-native-copy',
            type: 'rect',
            left: 60,
            top: 60,
            width: 20,
            height: 20,
            isPdfImported: true,
            pdfAnnotationId: `${nativeAnnot.objectNumber}R`,
            pdfImportedEditState: 'edited',
          }],
        },
      },
      { 1: { width: 200, height: 200 } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-test' },
    );

    assert.deepEqual(await getPdfAnnotationSubtypes(bytes), ['Square']);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('PDF export writes only regular viewer annotations into the PDF', async () => {
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
        spaces: [{ id: 'space-a', assignedPages: [{ pageId: 1, regions: [null, { regionId: 'region-a' }] }] }],
      },
    );

    assert.deepEqual(await getPdfAnnotationSubtypes(bytes), ['Square']);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('PDF export excludes survey highlights and scoped callouts', async () => {
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
        surveyMarkers: {
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

    assert.deepEqual(await getPdfAnnotationSubtypes(bytes), []);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('PDF export stores survey, space, and region layers as hidden app metadata', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const bytes = await savePDFWithAnnotationsPdfLib(
      await makePdfFile(),
      {
        1: {
          objects: [
            { id: 'regular-path', type: 'path', left: 0, top: 0, path: [['M', 10, 10], ['L', 20, 20]], stroke: '#ff0000', strokeWidth: 2 },
            { id: 'survey-circle', type: 'circle', left: 40, top: 10, radius: 8, moduleId: 'module-a', stroke: '#111111' },
          ],
        },
      },
      { 1: { width: 200, height: 200 } },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'doc-layer-state',
        spaces: [{ id: 'space-a', assignedPages: [{ pageId: 1, regions: [{ regionId: 'region-a' }] }] }],
        surveyMarkers: {
          'survey-highlight': { pageNumber: 1, bounds: { x: 10, y: 10, width: 20, height: 10 }, moduleId: 'module-a', color: '#ffff00' },
        },
        callouts: [{
          id: 'region-callout',
          pageNumber: 1,
          regionId: 'region-a',
          arrowTip: { x: 0.1, y: 0.1 },
          knee: { x: 0.2, y: 0.2 },
          textBoxPosition: { x: 0.3, y: 0.2 },
          text: 'Region callout',
        }],
      },
    );

    assert.deepEqual(await getPdfAnnotationSubtypes(bytes), ['Ink']);

    const doc = await PDFDocument.load(bytes);
    const raw = doc.catalog.get(PDFName.of(PDF_APP_LAYER_STATE_KEY)).decodeText();
    const metadata = parsePdfAppLayerStateMetadata(raw);
    assert.equal(metadata.documentId, 'doc-layer-state');
    assert.deepEqual(Object.keys(metadata.layers.scopedAnnotationsByPage), ['1']);
    assert.equal(metadata.layers.scopedAnnotationsByPage[1].objects[0].id, 'survey-circle');
    assert.equal(metadata.layers.surveyMarkers['survey-highlight'].moduleId, 'module-a');
    assert.equal(metadata.layers.spaces[0].id, 'space-a');
    assert.deepEqual(metadata.layers.spaces[0].assignedPages[0].regions.map((region) => region.regionId), ['region-a']);
    assert.equal(metadata.layers.callouts[0].id, 'region-callout');
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
      assert.equal(metadata.moduleId, null);
      assert.equal(metadata.regionId, null);
      assert.equal(metadata.spaceId, null);
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
            { id: 'meta-path', type: 'path', left: 0, top: 0, path: [['M', 10, 10], ['L', 20, 20]], stroke: '#111111', strokeWidth: 2 },
            { id: 'meta-rect', type: 'rect', left: 30, top: 10, width: 20, height: 12, stroke: '#111111' },
            { id: 'meta-circle', type: 'circle', left: 60, top: 10, radius: 8, stroke: '#111111' },
            { id: 'meta-line', type: 'line', x1: 10, y1: 50, x2: 40, y2: 55, stroke: '#111111' },
            { id: 'meta-arrow', type: 'line', tool: 'arrow', x1: 70, y1: 50, x2: 110, y2: 55, stroke: '#111111', lineEnding2: 'ClosedArrow', data: { type: 'arrow', arrowheadStyle: 'solid-triangle' } },
            { id: 'meta-polygon', type: 'polygon', left: 80, top: 20, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 20 }], stroke: '#111111' },
            { id: 'meta-polyline', type: 'polyline', left: 110, top: 20, points: [{ x: 0, y: 0 }, { x: 20, y: 10 }], stroke: '#111111' },
            { id: 'meta-text', type: 'textbox', left: 20, top: 90, width: 60, height: 18, text: 'Meta', fill: '#111111' },
            { id: 'meta-highlight', type: 'rect', exportType: 'highlight', left: 90, top: 90, width: 50, height: 16, fill: '#facc15', opacity: 0.35 },
          ],
        },
      },
      { 1: { width: 200, height: 200 } },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'doc-test',
        surveyMarkers: {},
      },
    );

    const metadata = (await getPdfAnnotationDicts(bytes)).map((dict) => {
      assert.equal(dict.get(PDFName.of('Subj'))?.decodeText?.(), PDF_APP_ANNOTATION_SUBJECT);
      return parsePdfAppAnnotationMetadata(
        dict.get(PDFName.of(PDF_APP_ANNOTATION_METADATA_KEY))?.decodeText?.(),
      );
    });

    assert.deepEqual(metadata.map((entry) => entry.id).sort(), [
      'meta-arrow',
      'meta-circle',
      'meta-highlight',
      'meta-line',
      'meta-path',
      'meta-polygon',
      'meta-polyline',
      'meta-rect',
      'meta-text',
    ]);
    assert.equal(metadata.find((entry) => entry.id === 'meta-path').moduleId, null);
    assert.equal(metadata.find((entry) => entry.id === 'meta-path').regionId, null);
    assert.equal(metadata.find((entry) => entry.id === 'meta-path').spaceId, null);
    assert.equal(metadata.find((entry) => entry.id === 'meta-text').geometry.text, 'Meta');
    const arrowMetadata = metadata.find((entry) => entry.id === 'meta-arrow');
    assert.equal(arrowMetadata.appType, 'arrow');
    assert.equal(arrowMetadata.flags.tool, 'arrow');
    assert.equal(arrowMetadata.flags.lineEnding2, 'ClosedArrow');
    assert.equal(arrowMetadata.geometry.lineEnding2, 'ClosedArrow');
    const highlightMetadata = metadata.find((entry) => entry.id === 'meta-highlight');
    // New saves write 'survey-marker'; old PDFs carry 'highlight' (both accepted on read).
    assert.equal(highlightMetadata.appType, 'survey-marker');
    assert.equal(highlightMetadata.style.fill, '#facc15');
    assert.equal(highlightMetadata.style.opacity, 0.35);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('PDF export preserves partially erased filled ink with an even-odd appearance stream', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const original = createProductionPaperInk({
      id: 'paper-ink-export',
      tool: 'pen',
      points: [{ x: 20, y: 70 }, { x: 180, y: 70 }],
      color: 'rgba(255, 0, 0, 0.5)',
      width: 20,
    });
    const erased = erasePageAnnotations({
      pageAnnotations: { objects: [original] },
      eraserPoints: [{ x: 90, y: 58 }],
      eraserRadius: 7,
      mode: 'partial',
    }).pageAnnotations.objects[0];
    const bytes = await savePDFWithAnnotationsPdfLib(
      await makePdfFile(),
      { 1: { objects: [erased] } },
      { 1: { width: 200, height: 200 } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-paper-ink' },
    );

    const doc = await PDFDocument.load(bytes);
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
    const annotation = doc.context.lookup(annots.asArray()[0]);
    const appearance = doc.context.lookup(annotation.get(PDFName.of('AP')));
    const normal = appearance && doc.context.lookup(appearance.get(PDFName.of('N')));
    const content = normal
      ? new TextDecoder().decode(decodePDFRawStream(normal).decode())
      : '';
    const metadata = parsePdfAppAnnotationMetadata(
      annotation.get(PDFName.of(PDF_APP_ANNOTATION_METADATA_KEY))?.decodeText?.(),
    );

    assert.equal(annotation.get(PDFName.of('Subtype')).decodeText(), 'Ink');
    assert.ok(appearance, 'filled ink must have an AP dictionary');
    assert.ok(normal, 'filled ink must have a normal appearance stream');
    assert.match(content, /f\*/);
    assert.match(content, /1 0 0 rg/);
    assert.deepEqual(metadata.geometry.polygons, erased.polygons);
    assert.equal(metadata.geometry.paperEraserGeometry, 'v1');
    assert.equal(metadata.style.fillRule, 'evenodd');
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

test('app annotation metadata restore keeps arrow interaction fields', () => {
  const restored = applyPdfAppAnnotationMetadata(
    { type: 'line', x1: 1, y1: 2, x2: 3, y2: 4, data: {} },
    {
      kind: PDF_APP_ANNOTATION_SUBJECT,
      id: 'arrow-restore',
      appType: 'arrow',
      flags: {
        tool: 'arrow',
        lineEnding2: 'ClosedArrow',
        arrowheadStyle: 'solid-triangle',
      },
      geometry: {
        x1: 10,
        y1: 20,
        x2: 30,
        y2: 40,
        lineEnding2: 'ClosedArrow',
      },
    },
  );

  assert.equal(restored.id, 'arrow-restore');
  assert.equal(restored.tool, 'arrow');
  assert.equal(restored.data.type, 'arrow');
  assert.equal(restored.lineEnding2, 'ClosedArrow');
  assert.equal(restored.arrowheadStyle, 'solid-triangle');
});


test('PDF export carries the active module\'s Survey Markers (owner ruling 2026-09-02) and no other module\'s', () => {
  const pageSizes = { 1: { width: 200, height: 200 } };
  const surveyMarkers = {
    'marker-a': { pageNumber: 1, bounds: { x: 10, y: 10, width: 40, height: 20 }, moduleId: 'module-a', color: 'rgba(216,168,78,0.55)' },
    'marker-b': { pageNumber: 1, bounds: { x: 60, y: 10, width: 40, height: 20 }, moduleId: 'module-b', needsEntity: true },
  };
  const withoutModule = buildPdfExportAnnotationPlan({ pageSizes, surveyMarkers });
  assert.deepEqual(withoutModule.items.map((item) => item.id), []);
  assert.equal(withoutModule.diagnostics.skippedByReason['survey-marker-export-excluded'], 2);
  assert.deepEqual(withoutModule.contract.includedScopes, ['canvas']);

  const withModule = buildPdfExportAnnotationPlan({ pageSizes, surveyMarkers, activeModuleId: 'module-a' });
  assert.deepEqual(withModule.items.map((item) => item.id), ['marker-a']);
  assert.equal(withModule.diagnostics.skippedByReason['survey-marker-export-excluded'], 1);
  assert.deepEqual(withModule.contract.includedScopes, ['canvas', 'survey']);
  assert.equal(withModule.contract.activeModuleId, 'module-a');
});
