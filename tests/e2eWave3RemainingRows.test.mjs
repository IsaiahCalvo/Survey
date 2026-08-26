// Wave 3: picker fixes + callout create/edit + remaining-row Node contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  applyColorPickerSelection,
  COLOR_PICKER_PRESETS,
} from '../src/utils/annotationStyleCatalog.js';
import {
  toFabricGroup,
  fromFabricGroup,
  buildCalloutRenderSpec,
  sanitizeFontFamily,
} from '../src/utils/calloutEditAdapter.js';
import {
  shouldDeleteBlankCalloutOnCommit,
  resolveCommittedCalloutText,
  setCalloutEditDraft,
  clearCalloutEditDraft,
} from '../src/utils/calloutBlankCommit.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { getWheelZoomScale, getDocumentMinimumScale } from '../src/utils/pdfZoomMath.js';
import { constrainToPage } from '../src/utils/svgTransformMath.js';
import { normalizeAnnotationSize, sanitizeAnnotationSizeDraft } from '../src/utils/annotationSize.js';
const WIDTH_PRESETS = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 32, 50];
import { getEraserOperation, isPartialEraseEligible } from '../src/utils/eraserPolicy.js';
import { collectFormFieldValues, isFormFieldObject } from '../src/utils/pdfFormFieldExport.js';
import { archiveChecklistItem, isArchivedChecklistItem } from '../src/services/checklistOrphanCleanup.js';

const overlay = readFileSync(new URL('../src/components/KeyboardShortcutsOverlay.jsx', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const svgLayer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
const picker = readFileSync(new URL('../src/components/CompactColorPicker.jsx', import.meta.url), 'utf8');
const appShell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');

test('font-color picker is opaque: no transparent cell, no opacity slider', () => {
  assert.match(picker, /firstPreset === 'none'/);
  assert.match(appShell, /firstPreset="none"/);
  assert.match(appShell, /showOpacity=\{false\}/);
  const solids = COLOR_PICKER_PRESETS.filter((c) => c !== 'transparent');
  assert.equal(solids.length, 15);
  const none = applyColorPickerSelection({ input: 'transparent', currentHex: '#1E293B' });
  assert.equal(none.kind, 'transparent');
});

test('stroke pickers pass minOpacity=0 and Match Fill', () => {
  assert.match(appShell, /minOpacity=\{0\}/);
  const mobile = readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
  assert.match(mobile, /minOpacity: 0/);
  assert.match(mobile, /kind: 'match'/);
  const locked = applyColorPickerSelection({
    input: '#000000',
    rememberedOpacityPct: 0,
    minOpacity: 1,
  });
  assert.equal(locked.opacity, 1);
});

const pageSize = { width: 1000, height: 800 };
const callout = {
  id: 'co-wave3',
  pageNumber: 1,
  arrowTip: { x: 0.2, y: 0.2 },
  knee: { x: 0.35, y: 0.35 },
  textBoxPosition: { x: 0.5, y: 0.4 },
  textBoxWidth: 0.25,
  textBoxHeight: 0.08,
  text: 'Leader note',
  style: {
    borderColor: '#FF0000',
    fillColor: '#FFFF00',
    lineThickness: 2,
    fontSize: 14,
    fontFamily: 'Georgia, serif',
    fontColor: '#0000FF',
    bold: true,
    italic: true,
    underline: true,
    strikethrough: true,
    lineStyle: 'dashed',
  },
};

test('callout create/edit: blank discard, style patch, leader geometry, export', async () => {
  assert.equal(shouldDeleteBlankCalloutOnCommit({ isNewCallout: true, committedText: '  ' }), true);
  assert.equal(shouldDeleteBlankCalloutOnCommit({ isNewCallout: false, committedText: '' }), false);
  assert.equal(resolveCommittedCalloutText({
    isNewCallout: false,
    editedText: '',
    synthesizedText: '',
    originalText: 'Keep me',
  }), 'Keep me');
  assert.equal(resolveCommittedCalloutText({
    isNewCallout: true,
    editedText: 'adversarial callout Q',
    synthesizedText: '',
    originalText: '',
  }), 'adversarial callout Q');
  assert.equal(resolveCommittedCalloutText({
    isNewCallout: true,
    editedText: '  ',
    synthesizedText: '',
    originalText: '',
  }), '');
  setCalloutEditDraft('co-adv-01', 'draft from overlay');
  assert.equal(resolveCommittedCalloutText({
    isNewCallout: true,
    editedText: '',
    synthesizedText: '',
    originalText: '',
    calloutId: 'co-adv-01',
  }), 'draft from overlay');
  clearCalloutEditDraft('co-adv-01');

  assert.equal(sanitizeFontFamily(callout.style.fontFamily), 'Georgia');
  const group = toFabricGroup(callout, pageSize);
  const textbox = group.objects.find((o) => o.type === 'textbox');
  assert.equal(textbox.fontFamily, 'Georgia');
  assert.equal(textbox.fontWeight, 'bold');
  assert.equal(textbox.fontStyle, 'italic');
  assert.equal(textbox.underline, true);
  assert.equal(textbox.linethrough, true);
  assert.equal(textbox.fill, '#0000FF');
  const leader = group.objects.find((o) => o.data?.calloutPart === 'line2');
  assert.deepEqual(leader.strokeDashArray, [6, 4]);

  const back = fromFabricGroup(group, pageSize, callout);
  assert.ok(Math.abs(back.arrowTip.x - 0.2) < 1e-6);
  assert.ok(Math.abs(back.knee.x - 0.35) < 1e-6);

  const stubConnection = (_tbX, _tbY, _tbW, _tbH, knee) => ({
    line1Start: { x: 500, y: 400 },
    effectiveKnee: { x: knee.x, y: knee.y },
    line2Start: { x: knee.x, y: knee.y },
    shouldHideLine1: false,
  });
  const spec = buildCalloutRenderSpec(callout, 0, pageSize, stubConnection);
  assert.ok(spec);
  assert.equal(buildCalloutRenderSpec({ id: 'broken' }, 0, pageSize, stubConnection), null);

  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  const bytes = await pdf.save();
  const pdfFile = {
    name: 'source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
  const exported = await savePDFWithAnnotationsPdfLib(pdfFile, {}, { 1: { width: 200, height: 200 } }, null, {
    returnBytes: true,
    actionType: 'pdf-export',
    documentId: 'wave3-callout',
    callouts: [{
      ...callout,
      arrowTip: { x: 0.1, y: 0.1 },
      knee: { x: 0.2, y: 0.2 },
      textBoxPosition: { x: 0.3, y: 0.2 },
    }],
  });
  const doc = await PDFDocument.load(exported);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'exported callout must write PDF annotations');
  assert.ok(annots.asArray().length >= 1);
});

test('zoom math honors a 10% floor and PDFViewer still bumps zoomGeneration', () => {
  assert.equal(getWheelZoomScale(0.05, { deltaY: 400, minimumScale: 0.1 }), 0.1);
  assert.ok(getWheelZoomScale(1, { deltaY: -100 }) > 1);
  assert.ok(getDocumentMinimumScale({
    viewportHeight: 100,
    pageHeights: [2000],
    pageGap: 0,
    absoluteMinimumScale: 0.1,
  }) >= 0.1);
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.match(viewer, /if \(phase === 'gesture-start'\) setZoomGeneration/);
  assert.match(svgLayer, /FREEHAND_CREATION_TOOLS\.includes\(state\.tool\)/);
  assert.match(svgLayer, /commitShapeCreationRef\.current\(null\)/);
});

test('Q-create flags pendingAutoEdit so TextEditOverlay mounts via the text path', () => {
  assert.match(viewer, /pendingAutoEditCalloutRef\.current = \{/);
  assert.match(viewer, /handleRequestCalloutEditMode\(pending\.calloutId/);
  assert.match(viewer, /reactCalloutId: calloutId/);
  assert.match(viewer, /editType: 'text'/);
});

test('E2E-ADV-01: callout chrome commit does not cancel-delete on minted textbox id', () => {
  const overlay = readFileSync(new URL('../src/components/TextEditOverlay.jsx', import.meta.url), 'utf8');
  assert.match(overlay, /isCallout && updated\.objects\.length > 0/);
  assert.match(overlay, /setCalloutEditDraft/);
  assert.match(viewer, /calloutId: editingAnnotation\.reactCalloutId/);
});

test('stroke / eraser / counter size presets clamp; draft rejects junk', () => {
  const sizeControl = readFileSync(new URL('../src/components/AnnotationSizeControl.jsx', import.meta.url), 'utf8');
  assert.match(sizeControl, /width: \[1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 32, 50\]/);
  for (const n of WIDTH_PRESETS) {
    assert.equal(normalizeAnnotationSize(n, 1, 100), n);
  }
  assert.equal(normalizeAnnotationSize(0, 1, 100), 1);
  assert.equal(normalizeAnnotationSize(999, 1, 100), 100);
  assert.equal(normalizeAnnotationSize('nope', 1, 100), 1);
  assert.equal(sanitizeAnnotationSizeDraft('12'), '12');
  assert.equal(sanitizeAnnotationSizeDraft('12.5'), null);
  assert.equal(sanitizeAnnotationSizeDraft('-1'), null);
});

test('eraser: ink is partial-eligible; shapes skip partial and stay entire', () => {
  const ink = {
    type: 'path',
    tool: 'pen',
    path: [['M', 0, 0], ['Q', 1, 1, 2, 2], ['L', 3, 3]],
    stroke: '#000',
    strokeWidth: 2,
  };
  assert.equal(isPartialEraseEligible(ink), true);
  assert.equal(getEraserOperation(ink, 'partial'), 'partial');
  assert.equal(getEraserOperation(ink, 'entire'), 'entire');
  const rect = { type: 'rect', width: 40, height: 20 };
  assert.equal(isPartialEraseEligible(rect), false);
  assert.equal(getEraserOperation(rect, 'partial'), 'skip');
  assert.equal(getEraserOperation(rect, 'entire'), 'entire');
});

test('shortcuts overlay lists every tool key, page nav, search, and Escape', () => {
  for (const key of ["['V']", "['Shift', 'V']", "['P']", "['H']", "['E']", "['T']", "['Q']", "['L']", "['A']", "['C']"]) {
    assert.match(overlay, new RegExp(key.replace(/[[\]]/g, '\\$&')));
  }
  assert.match(overlay, /Previous\/Next page/);
  assert.match(overlay, /First page/);
  assert.match(overlay, /Last page/);
  assert.match(overlay, /Search text/);
  assert.match(overlay, /Toggle shortcuts/);
  assert.match(overlay, /Close dialogs\/cancel/);
  assert.match(overlay, /useFocusTrap/);
});

test('move clamp, form-field collect, checklist archive helpers', () => {
  assert.deepEqual(constrainToPage(-5, 10, 20, 20, 100, 100), { left: 0, top: 10 });
  const fields = collectFormFieldValues({
    1: {
      objects: [
        { type: 'rect' },
        { type: 'form-field', data: { type: 'form-field', fieldId: '12R', fieldName: 'Name', fieldType: 'Tx', value: 'Ada' } },
      ],
    },
  });
  assert.equal(isFormFieldObject(fields[0] ? { data: { type: 'form-field' } } : null), true);
  assert.equal(fields[0].value, 'Ada');
  const archived = archiveChecklistItem({ id: 'i1', text: 'Check valve' }, { archivedAt: '2026-08-20T00:00:00.000Z' });
  assert.equal(isArchivedChecklistItem(archived), true);
});
