import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildExportableSurveyMarkers,
  buildFlattenedExportMarks,
} from '../src/utils/exportFlattenedMarks.js';
import { applyExportFilter } from '../src/utils/exportFilters.js';
import { addLayer, hiddenLayerIdSet, setLayerVisible } from '../src/utils/layers.js';
import { buildPrintableRegularAnnotationPayload } from '../src/utils/pdfAnnotationsPdfLib.js';
import { isAnnotationVisibleInSurveyMode } from '../src/utils/annotationVisibilityRules.js';

test('#1769: buildFlattenedExportMarks keeps both drawn marks and Survey markers regardless of UI Survey mode', () => {
  const { state: withCustom, layer: pass79 } = addLayer(null, { id: 'layer-pass79', name: 'Pass79 QA Layer' });
  const annotationsByPage = {
    1: {
      objects: [
        { type: 'rect', left: 10, top: 20, width: 80, height: 40, stroke: '#ff0000', layerId: pass79.id, data: { id: 'rect-pass79', type: 'rect' } },
        // Canvas mirror of survey marker m1 should be deduplicated by buildPrintableRegularAnnotationPayload.
        { type: 'rect', left: 120, top: 140, width: 20, height: 20, annotationId: 'm1', moduleId: 'mod-cameras', data: { id: 'm1', type: 'rect' } },
      ],
    },
  };
  const callouts = [
    { id: 'c1', pageNumber: 1, text: 'Note', layerId: pass79.id },
  ];
  const surveyMarkers = {
    m1: {
      id: 'm1',
      pageNumber: 1,
      moduleId: 'mod-cameras',
      categoryName: 'Cameras',
      color: '#ec4899',
      x: 0.4,
      y: 0.5,
      userId: 'u1',
    },
    m2: {
      id: 'm2',
      pageNumber: 1,
      moduleId: 'mod-doors',
      categoryName: 'Doors',
      color: '#3b82f6',
      x: 0.6,
      y: 0.7,
      userId: 'u2',
    },
  };

  const marks = buildFlattenedExportMarks({
    annotationsByPage,
    callouts,
    surveyMarkers,
    hiddenLayerIds: hiddenLayerIdSet(withCustom),
  });
  const payload = buildPrintableRegularAnnotationPayload(marks);

  assert.deepEqual(payload.annotationsByPage[1].objects.map((o) => o.data.id), ['rect-pass79']);
  assert.deepEqual(payload.callouts.map((c) => c.id), ['c1']);
  assert.deepEqual(Object.keys(payload.surveyMarkers).sort(), ['m1', 'm2']);
  assert.equal(payload.surveyMarkers.m1.annotationId, 'm1');
  assert.equal(payload.surveyMarkers.m2.annotationId, 'm2');

  // Hidden custom layer drops its drawn rectangle and callout, keeping Survey markers.
  const hiddenMarks = buildFlattenedExportMarks({
    annotationsByPage,
    callouts,
    surveyMarkers,
    hiddenLayerIds: hiddenLayerIdSet(setLayerVisible(withCustom, pass79.id, false)),
  });
  const hiddenPayload = buildPrintableRegularAnnotationPayload(hiddenMarks);
  assert.equal(hiddenPayload.annotationsByPage[1], undefined);
  assert.deepEqual(hiddenPayload.callouts, []);
  assert.deepEqual(Object.keys(hiddenPayload.surveyMarkers).sort(), ['m1', 'm2']);

  // Applying Export dialog filters composes cleanly with buildFlattenedExportMarks.
  const filtered = applyExportFilter(marks, { authors: ['u1'], layers: null }, withCustom);
  assert.deepEqual(Object.keys(filtered.surveyMarkers), ['m1']);
});

test('#1769: buildExportableSurveyMarkers styles every marker via resolveRenderEntry and skips junk entries', () => {
  const out = buildExportableSurveyMarkers(
    {
      bad: null,
      m1: { id: 'm1', pageNumber: 1, moduleId: 'mod-1', color: '#111111' },
    },
    {
      resolveRenderEntry: () => ({ color: '#ec4899', needsEntity: false }),
    },
  );
  assert.deepEqual(Object.keys(out), ['m1']);
  assert.equal(out.m1.color, '#ec4899');
  assert.equal(out.m1.needsEntity, false);
  assert.equal(out.m1.annotationId, 'm1');
});

test('#1769: PDFViewer Flattened export is mode-independent while on-screen Survey isolation and Print stay untouched', () => {
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const flattenedBranch = viewer.match(/else if \(mode === 'flattened'\) \{[\s\S]*?actionType: 'pdf-export-flattened',/);
  assert.ok(flattenedBranch, 'flattened export branch exists');
  assert.match(flattenedBranch[0], /buildFlattenedExportMarks\(\{\s*annotationsByPage,\s*callouts,\s*surveyMarkers,\s*hiddenLayerIds,\s*normalizeSurveyMarkerColor,\s*\}\)/);
  assert.doesNotMatch(flattenedBranch[0], /printableAnnotationsByPageRef|printableSurveyMarkers|isAnnotationVisibleInSurveyMode/);

  // Plain PDF remains untouched.
  assert.match(viewer, /if \(mode === 'plain'\) \{\s*bytes = await bytesKit\.stripMarkupAnnotations\(source, \{ pageTransformations \}\);/);

  // Browser Print still uses printableAnnotationsByPageRef & printableSurveyMarkersRef (mirrors screen).
  assert.match(viewer, /actionType: 'pdf-print-flattened-regular-annotations'/);
  assert.match(viewer, /annotationsByPage: withoutHiddenLayers\(printableAnnotationsByPageRef\.current \|\| \{\}, hiddenLayerIdsRef\.current\)/);

  // On-screen Survey mode isolation (#1613) stays intact.
  assert.equal(isAnnotationVisibleInSurveyMode({ moduleId: null, showSurveyPanel: true, selectedModuleId: 'mod-1' }), false);
  assert.equal(isAnnotationVisibleInSurveyMode({ moduleId: 'mod-1', showSurveyPanel: true, selectedModuleId: 'mod-1' }), true);
  assert.equal(isAnnotationVisibleInSurveyMode({ moduleId: 'mod-1', showSurveyPanel: false, selectedModuleId: null }), false);
  assert.equal(isAnnotationVisibleInSurveyMode({ moduleId: null, showSurveyPanel: false, selectedModuleId: null }), true);
});

test('#1770: phone CommentsPanel isolates comment body taps from Resolve and gives Undo toasts a 6s window', () => {
  const panel = readFileSync(new URL('../src/sidebar/CommentsPanel.jsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/sidebar/CommentsPanel.css', import.meta.url), 'utf8');
  const pins = readFileSync(new URL('../src/components/pins/PagePinsHost.jsx', import.meta.url), 'utf8');

  // Direct DOM click listener on .comments-item__body makes Blink Touch Adjustment treat body text as its own tap target.
  assert.match(panel, /const bodyRef = useRef\(null\);/);
  assert.match(panel, /el\.addEventListener\('click', noop\);/);
  assert.match(panel, /<div ref=\{bodyRef\} className="comments-item__body" data-comment-body="true">/);

  // Vertical clearance and breathing room between comment body and Reply/Resolve on phone.
  assert.match(css, /\.mobile-pdf-sheet \.comments-item__body \{[^}]*padding: 6px 0 8px;/);
  assert.match(css, /\.mobile-pdf-sheet \.comments-thread__actions \{[^}]*margin-top: 8px;[^}]*gap: 12px;/);

  // Undo toasts stay up for 6s instead of expiring after 3s over the phone sheet backdrop.
  assert.match(panel, /showToast\(resolved \? 'Thread resolved' : 'Thread reopened', 'success', \{\s*duration: 6000,\s*action: \{ label: 'Undo'/);
  assert.match(pins, /showToast\(next \? 'Comment resolved' : 'Comment reopened', 'success', \{\s*duration: 6000,\s*action: \{ label: 'Undo'/);
});

test('#1770: ToastHost pauses auto-dismiss on pointerdown and stops propagation so Undo taps never fall through to sheet backdrops', () => {
  const host = readFileSync(new URL('../src/components/ToastHost.jsx', import.meta.url), 'utf8');
  assert.match(host, /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*store\.dismiss\(t\.id\);/);
  assert.match(host, /onPointerDown: \(event\) => \{\s*event\.stopPropagation\(\);\s*store\.pause\(t\.id\);\s*\},/);
});
