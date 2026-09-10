import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ERASER_PREVIEW_HANDOFF_BOUND_MS,
  isEraserPreviewFinishReady,
  nextEraserPreviewHandoffState,
  selectEraserPreviewBaseline,
} from '../src/utils/eraserPreviewHandoff.js';
import { getCoalescedOrCurrentEvents } from '../src/utils/eraserPointerSamples.js';
import { preserveTransientPagePresentationState } from '../src/services/annotationDocStore.js';

const VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const APP_SHELL_SOURCE = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const DEV_TEST_ROUTE_SOURCE = readFileSync(new URL('../src/DevTestRoute.jsx', import.meta.url), 'utf8');
const SUPABASE_CLIENT_SOURCE = readFileSync(
  new URL('../src/supabaseClient.js', import.meta.url),
  'utf8',
);
const ERASER_SOURCE = readFileSync(
  new URL('../src/components/FabricEraserCanvas.jsx', import.meta.url),
  'utf8',
);
const ATOMIC_ERASE_DIAGNOSTICS_SOURCE = readFileSync(
  new URL('../src/utils/atomicEraseDiagnostics.js', import.meta.url),
  'utf8',
);
const LEGACY_LAYER_SOURCE = readFileSync(
  new URL('../src/PageAnnotationLayer.jsx', import.meta.url),
  'utf8',
);
const LIGHTWEIGHT_SOURCE = readFileSync(
  new URL('../src/components/LightweightAnnotationOverlay.jsx', import.meta.url),
  'utf8',
);
const PDFJS_ENGINE_SOURCE = readFileSync(
  new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url),
  'utf8',
);
const ANNOTATION_WORKER_SOURCE = readFileSync(
  new URL('../src/components/annotationCanvasWorker.js', import.meta.url),
  'utf8',
);

test('production eraser cursor renders the selected diameter', () => {
  assert.match(VIEWER_SOURCE, /eraserDiameterToScreenRadius/);
  assert.match(VIEWER_SOURCE, /data-eraser-cursor="true"/);
  assert.match(VIEWER_SOURCE, /boxSizing:\s*'border-box'/);
  assert.match(PDFJS_ENGINE_SOURCE, /surveyPdfjsPanActive/);
  assert.match(PDFJS_ENGINE_SOURCE, /data-survey-pdfjs-pan-active='true'/);
  assert.doesNotMatch(VIEWER_SOURCE, /width:\s*eraserSize \* 2 \* scale/);
  assert.doesNotMatch(VIEWER_SOURCE, /height:\s*eraserSize \* 2 \* scale/);
});

test('pdf.js eraser cursor is page-local and advances on the same pointer stream as erase samples', () => {
  assert.match(ERASER_SOURCE, /const cursorRef = useRef\(null\)/);
  assert.match(ERASER_SOURCE, /function nativeEraserCursor\(diameter\)/);
  assert.match(ERASER_SOURCE, /cursor: eraserCursor \|\| 'crosshair'/);
  assert.doesNotMatch(ERASER_SOURCE, /cursor:\s*'none'/);
  assert.match(ERASER_SOURCE, /const updateEraserCursor = useCallback/);
  assert.match(ERASER_SOURCE, /const handlePointerMove[\s\S]*?updateEraserCursor\(point, true\)[\s\S]*?const pointer = pointerRef\.current/);
  assert.match(ERASER_SOURCE, /data-eraser-cursor="true"/);
  assert.match(VIEWER_SOURCE, /if \(activeTool !== 'eraser' \|\| usePdfjsRenderer\)/);
  assert.match(VIEWER_SOURCE, /!usePdfjsRenderer && activeTool === 'eraser'/);
  assert.match(VIEWER_SOURCE, /viewerScale=\{layerScale\}/);
  assert.doesNotMatch(ERASER_SOURCE, /viewerScaleRef\.current\s*\|\|\s*getInteractionScale/);
});

test('production eraser records exact-contact geometry audits off the page thread', () => {
  assert.match(ERASER_SOURCE, /atomicEraseAuditWorker/);
  assert.match(ERASER_SOURCE, /recordAtomicEraseDiagnostic/);
  assert.match(ERASER_SOURCE, /updateAtomicEraseDiagnostic/);
  assert.match(ERASER_SOURCE, /eraserAuditViolationCount/);
  assert.match(ATOMIC_ERASE_DIAGNOSTICS_SOURCE, /__exportEraserDiagnostics/);
});

test('eraser preview copies the active detail tile without stretching it over the page', () => {
  assert.match(ERASER_SOURCE, /canvas\[data-annotation-detail-active="true"\]/);
  assert.match(ERASER_SOURCE, /preview\.style\.left = source\.style\.left/);
  assert.match(ERASER_SOURCE, /preview\.style\.top = source\.style\.top/);
  assert.match(ERASER_SOURCE, /pageOffsetX/);
  assert.match(ERASER_SOURCE, /pageOffsetY/);
});

test('production keeps eraser mode in the top toolbar and omits the duplicate draw-strip caret', () => {
  assert.match(VIEWER_SOURCE, /const hasSplitMenu = isHighlighterSplitMenu/);
  assert.doesNotMatch(VIEWER_SOURCE, /data-eraser-caret-(?:button|popup)/);
  assert.doesNotMatch(VIEWER_SOURCE, /setEraserCaretPopupOpen/);
  assert.match(APP_SHELL_SOURCE, /label="Eraser type"/);
  assert.match(APP_SHELL_SOURCE, /\{ value: 'partial', label: 'Partial erase' \}/);
  assert.match(APP_SHELL_SOURCE, /\{ value: 'entire', label: 'Full stroke erase' \}/);
});

test('production eraser uses only the exact SVG clone for live carving', () => {
  assert.match(ERASER_SOURCE, /data-eraser-live-preview/);
  assert.match(ERASER_SOURCE, /getCoalescedOrCurrentEvents/);
  const previewStart = ERASER_SOURCE.indexOf('const previewEraserGesture = useCallback');
  const previewEnd = ERASER_SOURCE.indexOf('\n  const applyEraserAndCommit', previewStart);
  const previewSource = ERASER_SOURCE.slice(previewStart, previewEnd);
  assert.match(previewSource, /beginMaskClonePreview/);
  assert.doesNotMatch(previewSource, /beginLiveErasePreview/);
  assert.match(ERASER_SOURCE, /finishLiveErasePreview/);
});

test('release handoff keeps the final SVG mounted and swaps presentations in one frame', () => {
  // The committed SVG must keep receiving React updates behind the live
  // preview. Unmounting it makes release depend on a later remount and forces
  // either a blank frame or an old-preview/new-final overlap frame.
  assert.doesNotMatch(
    VIEWER_SOURCE,
    /\{!useCanvasPresentation && !suspendFullSvgForProxy && \(/,
  );
  assert.match(
    VIEWER_SOURCE,
    /\{!suspendFullSvgForProxy && \([\s\S]*?data-diag-svg-wrapper/,
  );
  assert.match(
    VIEWER_SOURCE,
    /visibility:\s*\(annotationHydrationGated \|\| useCanvasPresentation\)\s*\?\s*'hidden'\s*:\s*undefined/,
  );
  assert.match(
    VIEWER_SOURCE,
    /data-svg-annotation-revision=\{pageAnnotations\?\.eraserPresentationRevision \|\| ''\}/,
  );

  const finishStart = ERASER_SOURCE.indexOf('const finishLiveErasePreview = useCallback');
  const finishEnd = ERASER_SOURCE.indexOf('\n  const beginLiveErasePreview', finishStart);
  const finishSource = ERASER_SOURCE.slice(finishStart, finishEnd);

  // One requestAnimationFrame is the before-paint boundary. Both sides of the
  // swap happen inside it; a nested/two-frame hold visibly double-paints
  // translucent annotations and briefly resurrects the old erased stroke.
  assert.equal(
    finishSource.match(/requestAnimationFrame\(/g)?.length,
    1,
  );
  assert.match(finishSource, /requestAnimationFrame\(completeHandoff\)/);
  const handoffStart = finishSource.indexOf('const completeHandoff = () =>');
  const handoffEnd = finishSource.indexOf('\n    };', handoffStart);
  const isInsideHandoff = (needle) => {
    const index = finishSource.indexOf(needle, handoffStart);
    return index > handoffStart && index < handoffEnd;
  };
  assert.ok(isInsideHandoff(
    "svgWrapper.style.visibility = sourceState?.previousSvgVisibility ?? ''",
  ));
  assert.ok(isInsideHandoff('closingClone.root.remove()'));
  assert.ok(isInsideHandoff(
    'onErasePreviewPresentationRef.current?.(pageNumber, false)',
  ));

  const scheduleStart = ERASER_SOURCE.indexOf('const scheduleLiveErasePreviewFinish = useCallback');
  const scheduleEnd = ERASER_SOURCE.indexOf('\n  const getSpaceIdForRegion', scheduleStart);
  const scheduleSource = ERASER_SOURCE.slice(scheduleStart, scheduleEnd);
  assert.match(scheduleSource, /isEraserPreviewFinishReady/);
  assert.match(scheduleSource, /hadSourceAtRelease/);
  assert.match(
    scheduleSource,
    /sourceState\.paintGeneration = sourceAtRelease\.dataset\.canvasPaintGeneration/,
  );
});

test('production uses the demo Canvas2D compositing contract during zoom and erase', () => {
  assert.doesNotMatch(LIGHTWEIGHT_SOURCE, /desynchronized/);
  assert.doesNotMatch(ANNOTATION_WORKER_SOURCE, /desynchronized/);
  assert.doesNotMatch(ERASER_SOURCE, /desynchronized/);
  assert.doesNotMatch(LIGHTWEIGHT_SOURCE, /getContext\('2d',/);
  assert.doesNotMatch(ANNOTATION_WORKER_SOURCE, /getContext\('2d',/);
  assert.doesNotMatch(ERASER_SOURCE, /getContext\('2d',/);
  assert.doesNotMatch(LIGHTWEIGHT_SOURCE, /translateZ\(0\)/);
  assert.doesNotMatch(LIGHTWEIGHT_SOURCE, /contain:\s*'strict'/);
});

test('live preview is gated by the same geometry and permission transaction as commit', () => {
  assert.match(ERASER_SOURCE, /planPageEraserPreview/);
  assert.match(ERASER_SOURCE, /getEraseBlockReason/);
  const start = ERASER_SOURCE.indexOf('const handlePointerDown = useCallback');
  const end = ERASER_SOURCE.indexOf('const handlePointerMove = useCallback', start);
  const pointerDownSource = ERASER_SOURCE.slice(start, end);
  assert.match(pointerDownSource, /previewEraserGesture/);
  assert.doesNotMatch(pointerDownSource, /beginLiveErasePreview\(\)\) drawLiveErasePreviewSegment/);
});

test('pdf.js survey markers use one visible, permitted whole-delete lane in both eraser modes', () => {
  assert.match(VIEWER_SOURCE, /surveyMarkers=\{newSurveyMarkersByPage\[pageNumber\]\}/);
  assert.match(
    VIEWER_SOURCE,
    /onEraseIntent=\{pdfFile\?\.id \? handleEraseIntent : undefined\}/,
  );
  assert.match(VIEWER_SOURCE, /onEraseSurveyMarker=\{handleDeleteSurveyMarker\}/);
  assert.match(VIEWER_SOURCE, /canEraseSurveyMarker=\{canEraseSurveyMarker\}/);
  assert.match(VIEWER_SOURCE, /if \(\(savedSurveyMarker \|\| pendingSurveyMarker\)\?\.locked === true\) return false;/);
  assert.match(ERASER_SOURCE, /const getPermittedSurveyMarkerHitIds = useCallback/);
  assert.match(ERASER_SOURCE, /data-survey-marker-id/);
  assert.match(ERASER_SOURCE, /previewSurveyMarkerIds: new Set\(\)/);
  assert.match(ERASER_SOURCE, /pendingSurveyMarkerIds: new Set\(\)/);
  // Legacy page-JSON proxy rects are hidden by SVGAnnotationLayer and must not
  // bypass the dedicated source-owned permission/visibility lane.
  assert.match(ERASER_SOURCE, /if \(object\?\.annotationId\) return 'survey-marker-source'/);

  const commitStart = ERASER_SOURCE.indexOf('const applyEraserAndCommit = useCallback');
  const commitEnd = ERASER_SOURCE.indexOf('\n  const cancelPointer = useCallback', commitStart);
  const commitSource = ERASER_SOURCE.slice(commitStart, commitEnd);
  assert.match(
    commitSource,
    /getPermittedSurveyMarkerHitIds\(eraserPoints, undefined, radius\)/,
  );
  assert.match(commitSource, /await onEraseIntentRef\.current\?\.\(intent\)/);
  assert.match(commitSource, /onEraseSurveyMarkerRef\.current\?\.\(annotationId\)/);
  assert.doesNotMatch(commitSource, /domain: 'survey-marker'/);
});

test('callout preview and commit share the same permitted hit list', () => {
  const commitStart = ERASER_SOURCE.indexOf('const applyEraserAndCommit = useCallback');
  const commitEnd = ERASER_SOURCE.indexOf('\n  const cancelPointer = useCallback', commitStart);
  const commitSource = ERASER_SOURCE.slice(commitStart, commitEnd);

  assert.match(
    commitSource,
    /getPermittedCalloutHitIds\(eraserPoints, undefined, radius\)/,
  );
  assert.doesNotMatch(commitSource, /getCalloutHitIds\(\{/);
});

test('projected callouts cannot enter the generic object eraser through their double-offset ghost bounds', () => {
  const blockStart = ERASER_SOURCE.indexOf('const getEraseBlockReason');
  const blockEnd = ERASER_SOURCE.indexOf('\n  const ghostAtomicHits', blockStart);
  const blockSource = ERASER_SOURCE.slice(blockStart, blockEnd);

  assert.match(blockSource, /object\?\.data\?\.type === 'callout'/);
  assert.match(blockSource, /return 'callout-source'/);
});

test('legacy canvas eraser enforces locked and ownership gates before any mutation', () => {
  assert.match(LEGACY_LAYER_SOURCE, /canEraseCanvasAnnotation/);
  assert.match(LEGACY_LAYER_SOURCE, /viewerId = null/);
  assert.match(LEGACY_LAYER_SOURCE, /documentOwnerId = null/);

  const eraseStart = LEGACY_LAYER_SOURCE.indexOf('// Handle erasing end');
  const eraseEnd = LEGACY_LAYER_SOURCE.indexOf('// Remove visual eraser stroke overlay', eraseStart);
  const eraseSource = LEGACY_LAYER_SOURCE.slice(eraseStart, eraseEnd);
  const gateIndex = eraseSource.indexOf('canEraseCanvasAnnotation({');
  const lockedIndex = eraseSource.indexOf('obj.locked === true');
  const mutationIndex = eraseSource.indexOf('erasePathSegment(');

  assert.ok(gateIndex > -1, 'legacy eraser must check annotation ownership');
  assert.ok(lockedIndex > -1, 'legacy eraser must skip locked annotations');
  assert.ok(mutationIndex > gateIndex, 'ownership gate must run before path carving');
  assert.ok(mutationIndex > lockedIndex, 'locked gate must run before path carving');
  assert.match(eraseSource, /if \(obj\.data\?\.type === 'callout'\) continue;/);
  assert.match(eraseSource, /onDeleteSelectedCalloutsRef\.current\?\.\(calloutsToDelete\)/);
  assert.doesNotMatch(eraseSource, /setCalloutsRef\.current\(prev =>/);
});

test('legacy canvas eraser materializes canonical ids and commits one precise history action', () => {
  assert.match(
    LEGACY_LAYER_SOURCE,
    /import \{ materializeCanvasObjectIdentities \} from '\.\/utils\/annotationStorageIdentity\.js';/,
  );
  assert.match(
    LEGACY_LAYER_SOURCE,
    /materializeCanvasObjectIdentities\(fabricRef\.current\);[\s\S]{0,300}fabricRef\.current\.toObject/,
  );

  const eraseStart = LEGACY_LAYER_SOURCE.indexOf('// Handle erasing end');
  const eraseEnd = LEGACY_LAYER_SOURCE.indexOf('// Remove visual eraser stroke overlay', eraseStart);
  const eraseSource = LEGACY_LAYER_SOURCE.slice(eraseStart, eraseEnd);
  assert.ok(
    eraseSource.indexOf('materializeCanvasObjectIdentities(canvas);')
      < eraseSource.indexOf('const objects = [...canvas.getObjects()]'),
    'loaded id-less objects must be materialized before permission checks',
  );
  assert.match(eraseSource, /saveCanvas\('eraser:commit',\s*\{/);
  assert.match(eraseSource, /tool:\s*'eraser'/);
  assert.match(eraseSource, /finalDeletedAnnotationIds:\s*\[\.\.\.deletedAnnotationIds\]/);
  assert.match(eraseSource, /finalChangedAnnotationIds:\s*\[\.\.\.changedAnnotationIds\]/);
  assert.match(eraseSource, /objectMutations:\s*\[\.\.\.objectMutationById\.values\(\)\]/);
});

test('legacy canvas does not classify an ordinary annotationId object as a survey marker', () => {
  const eraseStart = LEGACY_LAYER_SOURCE.indexOf('// Handle erasing end');
  const eraseEnd = LEGACY_LAYER_SOURCE.indexOf('// Remove visual eraser stroke overlay', eraseStart);
  const eraseSource = LEGACY_LAYER_SOURCE.slice(eraseStart, eraseEnd);

  assert.match(eraseSource, /knownSurveyMarkerIdsRef\.current/);
  assert.match(eraseSource, /canEraseCanvasAnnotation\(\{/);
  assert.doesNotMatch(
    eraseSource,
    /if \(obj\.annotationId\) \{[\s\S]{0,500}canEraseSurveyMarkerRef\.current/,
  );
  assert.match(VIEWER_SOURCE, /if \(!savedSurveyMarker && !pendingSurveyMarker\) return false;/);
});

test('legacy and default erasers never bypass ownership when permission context is incomplete', () => {
  const legacyStart = LEGACY_LAYER_SOURCE.indexOf('// Handle erasing end');
  const legacyEnd = LEGACY_LAYER_SOURCE.indexOf('// Remove visual eraser stroke overlay', legacyStart);
  const legacySource = LEGACY_LAYER_SOURCE.slice(legacyStart, legacyEnd);
  assert.doesNotMatch(legacySource, /!hasResolvedPermissionContext && !isKnownSurveyMarker/);
  assert.match(legacySource, /const canEraseObject = canEraseCanvasAnnotation\(\{/);

  const blockStart = ERASER_SOURCE.indexOf('const getEraseBlockReason');
  const blockEnd = ERASER_SOURCE.indexOf('\n  const ghostAtomicHits', blockStart);
  const blockSource = ERASER_SOURCE.slice(blockStart, blockEnd);
  assert.doesNotMatch(
    blockSource,
    /currentViewerId\s*&&\s*currentOwnerId\s*&&\s*!canModify/,
  );
  assert.match(blockSource, /if \(!canModify\(\{/);

  const calloutStart = ERASER_SOURCE.indexOf('const getPermittedCalloutHitIds');
  const calloutEnd = ERASER_SOURCE.indexOf('\n  // Survey markers live outside', calloutStart);
  const calloutSource = ERASER_SOURCE.slice(calloutStart, calloutEnd);
  assert.doesNotMatch(calloutSource, /if \(!viewerId \|\| !ownerId\) return true/);
  assert.match(calloutSource, /return canModify\(\{ annotation: callout/);
});

test('document load and commit callbacks fail closed when cloud ownership is unresolved', () => {
  assert.match(
    VIEWER_SOURCE,
    /resolveDocumentOwnerId\(\{\s*documentId:\s*pdfFile\?\.id,\s*documentOwnerId:\s*pdfFile\?\.user_id,\s*viewerId:\s*user\?\.id,/,
  );
  assert.doesNotMatch(VIEWER_SOURCE, /return pdfFile\?\.user_id \|\| user\?\.id \|\| null/);

  const calloutStart = VIEWER_SOURCE.indexOf('const handleDeleteSelectedCallouts');
  const calloutEnd = VIEWER_SOURCE.indexOf('\n  const handleBeginBatchDelete', calloutStart);
  const calloutCommitSource = VIEWER_SOURCE.slice(calloutStart, calloutEnd);
  assert.match(
    calloutCommitSource,
    /eraseRequest\s*\?\s*filterEraserCommitIds\(\{/,
  );
  assert.doesNotMatch(calloutCommitSource, /if \(!viewerId \|\| !documentOwnerId\) return true/);

  const markerCommitStart = VIEWER_SOURCE.indexOf('const handleSurveyMarkerDeleted');
  const markerCommitEnd = VIEWER_SOURCE.indexOf('\n  // After a Survey Marker delete', markerCommitStart);
  const markerCommitSource = VIEWER_SOURCE.slice(markerCommitStart, markerCommitEnd);
  assert.match(markerCommitSource, /canCommitSurveyMarkerErase\(\{/);
  assert.doesNotMatch(markerCommitSource, /if \(!viewerId \|\| !documentOwnerId\) return true/);

  const markerPreviewStart = VIEWER_SOURCE.indexOf('const canEraseSurveyMarker');
  const markerPreviewEnd = VIEWER_SOURCE.indexOf('\n  const handleDeleteSurveyMarker', markerPreviewStart);
  const markerPreviewSource = VIEWER_SOURCE.slice(markerPreviewStart, markerPreviewEnd);
  assert.match(markerPreviewSource, /canCommitSurveyMarkerErase\(\{/);
  assert.doesNotMatch(markerPreviewSource, /if \(!viewerId \|\| !documentOwnerId\) return true/);
});

test('dev test route supplies a stable mock user while cloud consumers stay offline', () => {
  assert.match(DEV_TEST_ROUTE_SOURCE, /const mockUser = \{\s*id:\s*['"]dev-test-user['"]/);
  assert.match(DEV_TEST_ROUTE_SOURCE, /user:\s*mockUser/);
  assert.match(DEV_TEST_ROUTE_SOURCE, /isAuthenticated:\s*false/);
  assert.match(
    SUPABASE_CLIENT_SOURCE,
    /import\.meta\.env\.DEV[\s\S]*?new URLSearchParams\(window\.location\.search\)\.has\('testPdf'\)/,
  );
  assert.match(
    SUPABASE_CLIENT_SOURCE,
    /isSupabaseAvailable = \(\) => supabase !== null && !isDevTestPdfRoute\(\)/,
  );
});

test('production eraser commits the latest page model and waits for its exact repaint', () => {
  assert.match(ERASER_SOURCE, /annotationsRef\.current/);
  assert.match(ERASER_SOURCE, /spaceHeldRef\.current/);
  assert.match(ERASER_SOURCE, /window\.addEventListener\('keydown', activateSpacePan, true\)/);
  assert.match(ERASER_SOURCE, /canvasAnnotationRevision/);
  assert.match(ERASER_SOURCE, /closest\('\[data-annotation-real-surface\]'\)/);
  assert.doesNotMatch(ERASER_SOURCE, /canvas\.getObjects\(\)/);
  assert.doesNotMatch(ERASER_SOURCE, /document\.querySelector/);
  assert.doesNotMatch(ERASER_SOURCE, /performance\.now\(\) - started >= 750/);
  assert.match(LIGHTWEIGHT_SOURCE, /canvas\.dataset\.canvasAnnotationRevision/);
  assert.match(LIGHTWEIGHT_SOURCE, /annotations\?\.eraserPresentationRevision/);
  assert.doesNotMatch(ERASER_SOURCE, /flushSync/);
});

test('a failed page-model commit reports no paint so the queue restores the preview immediately', () => {
  const commitStart = ERASER_SOURCE.indexOf('const applyEraserAndCommit = useCallback');
  const commitEnd = ERASER_SOURCE.indexOf('\n  const cancelPointer = useCallback', commitStart);
  const commitSource = ERASER_SOURCE.slice(commitStart, commitEnd);

  assert.match(
    commitSource,
    /commitResult\?\.status !== 'committed'[\s\S]*?return \{ didPaint: false, expectedRevision: null \}/,
  );
  assert.match(
    commitSource,
    /catch \(error\) \{[\s\S]*?return \{ didPaint: false, expectedRevision: null \}/,
  );
  assert.match(
    commitSource,
    /return \{\s*didPaint: true,\s*expectedRevision,\s*\}/,
  );
  assert.match(
    commitSource,
    /scheduleLiveErasePreviewFinish\(\{\s*expectedRevision: outcome\.expectedRevision,\s*waitForNextPaint: outcome\.didPaint,\s*requireMutationAck: outcome\.requireMutationAck,\s*\}\)/,
  );
  assert.match(
    commitSource,
    /\.catch\(\(error\) => \{[\s\S]*?finishLiveErasePreview\(\);[\s\S]*?return \{ didPaint: false, expectedRevision: null \}/,
  );
});

test('legacy fallback treats the configured eraser size as a diameter too', () => {
  assert.match(LEGACY_LAYER_SOURCE, /Eraser diameter in page pixels/);
  assert.equal(
    LEGACY_LAYER_SOURCE.match(/\(eraserSizeRef\.current \|\| 20\) \/ 2/g)?.length,
    2,
  );
  assert.equal(
    LEGACY_LAYER_SOURCE.match(/canvas\.bringObjectToFront\(eraserStroke/g)?.length,
    2,
  );
  assert.doesNotMatch(LEGACY_LAYER_SOURCE, /canvas\.bringToFront\(/);
});

test('rapid erase reuses the latest preview while the worker canvas is stale', () => {
  assert.equal(selectEraserPreviewBaseline({
    expectedRevision: 'eraser:2',
    sourceRevision: 'eraser:1',
    previewRevision: 'eraser:2',
    previewVisible: true,
  }), 'preview');
});

test('a settled worker canvas becomes the next gesture baseline', () => {
  assert.equal(selectEraserPreviewBaseline({
    expectedRevision: 'eraser:2',
    sourceRevision: 'eraser:2',
    previewRevision: '',
    previewVisible: false,
  }), 'source');
});

test('last-item erase does not treat worker-source removal as an exact empty SVG paint', () => {
  assert.equal(isEraserPreviewFinishReady({
    expectedRevision: 'eraser:empty',
    waitForNextPaint: true,
    finalSvgRevision: 'baseline',
    maskClone: true,
    hadSourceAtRelease: true,
    hasCurrentSource: false,
    canvasRevision: '',
    baselinePaintGeneration: '7',
    currentPaintGeneration: '',
  }), false);
});

test('SVG-clone handoff releases on the exact hidden SVG without waiting for a stale worker', () => {
  assert.equal(isEraserPreviewFinishReady({
    expectedRevision: 'eraser:2',
    waitForNextPaint: true,
    finalSvgRevision: 'eraser:2',
    maskClone: true,
    hadSourceAtRelease: true,
    hasCurrentSource: true,
    canvasRevision: 'eraser:1',
    baselinePaintGeneration: '7',
    currentPaintGeneration: '7',
  }), true);
  assert.equal(isEraserPreviewFinishReady({
    expectedRevision: 'eraser:2',
    waitForNextPaint: true,
    finalSvgRevision: 'eraser:1',
    maskClone: true,
    hadSourceAtRelease: true,
    hasCurrentSource: true,
    canvasRevision: 'eraser:1',
    baselinePaintGeneration: '7',
    currentPaintGeneration: '7',
  }), false);
});

test('remote materialization preserves the local eraser presentation epoch', () => {
  const previous = {
    1: {
      objects: [{ id: 'locally-erased' }],
      eraserPresentationRevision: 'eraser:local',
    },
  };
  const remote = {
    1: {
      objects: [{ id: 'locally-erased' }, { id: 'remote-addition' }],
    },
  };
  const merged = preserveTransientPagePresentationState(previous, remote);

  assert.deepEqual(merged[1].objects, remote[1].objects);
  assert.equal(merged[1].eraserPresentationRevision, 'eraser:local');
  assert.equal(remote[1].eraserPresentationRevision, undefined, 'remote input stays immutable');
});

test('remote materialization preserves an emptied page until its eraser handoff can finish', () => {
  const previous = {
    1: {
      objects: [],
      eraserPresentationRevision: 'eraser:empty-page',
    },
  };
  const remote = {
    2: {
      objects: [{ id: 'remote-other-page' }],
    },
  };

  const merged = preserveTransientPagePresentationState(previous, remote);

  assert.deepEqual(merged[1], {
    objects: [],
    eraserPresentationRevision: 'eraser:empty-page',
  });
  assert.equal(merged[2], remote[2]);
  assert.equal(remote[1], undefined, 'incoming Y.Doc materialization stays immutable');
});

test('callout erase is part of the same atomic intent and failure restores its preview', () => {
  const commitStart = ERASER_SOURCE.indexOf('const applyEraserAndCommit = useCallback');
  const commitEnd = ERASER_SOURCE.indexOf('\n  const cancelPointer = useCallback', commitStart);
  const commitSource = ERASER_SOURCE.slice(commitStart, commitEnd);

  assert.match(
    commitSource,
    /for \(const calloutId of calloutHitIds\)[\s\S]*?domain: 'callout'[\s\S]*?operation: 'delete'/,
  );
  assert.match(
    commitSource,
    /await onEraseIntentRef\.current\?\.\(intent\)[\s\S]*?finishLiveErasePreview\(\)/,
  );
  assert.doesNotMatch(ERASER_SOURCE, /onSettled:/);
  assert.doesNotMatch(VIEWER_SOURCE, /pendingDeleteSettlementRef/);
});

test('an empty coalesced-event list falls back to the current pointer event', () => {
  const nativeEvent = { getCoalescedEvents: () => [] };
  assert.deepEqual(getCoalescedOrCurrentEvents(nativeEvent), [nativeEvent]);
});

test('pointer-up samples and previews its endpoint before committing geometry', () => {
  const start = ERASER_SOURCE.indexOf('const finishPointer = useCallback');
  const end = ERASER_SOURCE.indexOf('\n  useEffect(() => {', start);
  const finishPointerSource = ERASER_SOURCE.slice(start, end);

  assert.match(finishPointerSource, /const releasePoint = pagePoint\(event\.nativeEvent\)/);
  assert.match(finishPointerSource, /pointer\.points\.push\(releasePoint\)/);
  assert.match(finishPointerSource, /previewEraserGesture/);
  assert.match(
    finishPointerSource,
    /queueEraserCommit\(pointer\)/,
  );
});

test('rapid gestures serialize commits and only the newest session may close the shared preview', () => {
  assert.match(ERASER_SOURCE, /const eraseCommitTailRef = useRef\(Promise\.resolve\(\)\)/);
  assert.match(
    ERASER_SOURCE,
    /const queued = eraseCommitTailRef\.current\.then\(run, run\)/,
  );
  assert.match(
    ERASER_SOURCE,
    /latestEraseGestureRef\.current !== sessionId[\s\S]*?scheduleLiveErasePreviewFinish/,
  );
  assert.match(
    ERASER_SOURCE,
    /latestEraseGestureRef\.current = sessionId[\s\S]*?pointerRef\.current = \{\s*sessionId/,
  );
});

test('authoritative interruptions commit once while stray button-state moves are ignored', () => {
  // pointercancel / lost capture commit the accumulated points. A transient
  // buttons=0 move is not authoritative while pointer capture is still owned;
  // Chromium can emit one during a long drag and the gesture must continue.
  // A second/non-primary pointer is input noise and cannot replace the gesture.
  assert.match(ERASER_SOURCE, /const handleLostPointerCapture = useCallback/);
  assert.match(ERASER_SOURCE, /onLostPointerCapture=\{handleLostPointerCapture\}/);
  assert.match(ERASER_SOURCE, /const handleLostPointerCapture[\s\S]*?commitPointerNow\(\)/);
  assert.match(
    ERASER_SOURCE,
    /const handlePointerDown[\s\S]*?if \(event\.isPrimary === false \|\| pointerRef\.current\) return;/,
  );
  assert.doesNotMatch(ERASER_SOURCE, /if \(pointerRef\.current\) cancelPointer\(\)/);
  assert.doesNotMatch(ERASER_SOURCE, /const handlePointerMove[\s\S]*?event\.buttons === 0/);
  assert.match(ERASER_SOURCE, /if \(cancelled\) \{[\s\S]*?commitInterruptedPointer\(pointer\)/);
});

test('preview handoff never reveals a known-stale presentation on a timer', () => {
  const start = ERASER_SOURCE.indexOf('const scheduleLiveErasePreviewFinish = useCallback');
  const end = ERASER_SOURCE.indexOf('\n  const getSpaceIdForRegion', start);
  const handoffSource = ERASER_SOURCE.slice(start, end);

  assert.doesNotMatch(handoffSource, /ERASER_PREVIEW_HANDOFF_TIMEOUT_MS/);
  assert.doesNotMatch(handoffSource, /now - startedAt/);
  assert.match(handoffSource, /canvasRevision:\s*canvasAnnotationRevision/);
  assert.match(handoffSource, /ERASER_PREVIEW_HANDOFF_BOUND_MS/);
  assert.match(handoffSource, /eraserHandoffState = state\.handoffState/);
});

test('preview handoff state machine reaches a bounded safe terminal presentation', () => {
  assert.ok(ERASER_PREVIEW_HANDOFF_BOUND_MS > 0);
  assert.equal(nextEraserPreviewHandoffState('active', 'commit'), 'waiting');
  assert.equal(nextEraserPreviewHandoffState('waiting', 'bound'), 'safe-hold');
  assert.equal(nextEraserPreviewHandoffState('safe-hold', 'zoom'), 'safe-hold');
  assert.equal(nextEraserPreviewHandoffState('safe-hold', 'exact-paint'), 'ready');
  assert.equal(nextEraserPreviewHandoffState('safe-hold', 'unmount'), 'idle');
});

test('benchmark rendering and eraser interaction never use different page models', () => {
  assert.match(
    VIEWER_SOURCE,
    /annotations=\{isEraserTool \? pageAnnotations : benchmarkPageAnnotations\}/,
  );
});

test('eraser undo uses its precise local action instead of cloning the full document checkpoint', () => {
  const start = VIEWER_SOURCE.indexOf('const handleSaveAnnotations = useCallback');
  const end = VIEWER_SOURCE.indexOf('// KAL-313: Space restore', start);
  const saveSource = VIEWER_SOURCE.slice(start, end);
  const preciseSkip = saveSource.indexOf('else if (isEraserCommit)');
  const legacyCheckpoint = saveSource.indexOf("addHistoryCheckpoint('annotations:save'");

  assert.ok(preciseSkip >= 0, 'expected a precise eraser-history branch');
  assert.ok(legacyCheckpoint > preciseSkip, 'eraser branch must precede full-document checkpointing');
  assert.match(saveSource, /pushLocalAnnotationHistoryAction\(finalLocalHistoryAction\)/);
});

test('atomic erase restores only captured mutation lane transitions for Cmd+Z, Redo, and toast', () => {
  const undoStart = VIEWER_SOURCE.indexOf('const handleUndo = useCallback');
  const undoEnd = VIEWER_SOURCE.indexOf('const handleRedo = useCallback', undoStart);
  const undoSource = VIEWER_SOURCE.slice(undoStart, undoEnd);
  assert.match(undoSource, /legacyUndoMeta\?\.context\?\.eraseHistoryTransition/);
  assert.match(
    undoSource,
    /applyDurableEraseHistoryTransitionRef\.current\([\s\S]*?eraseHistoryTransition,[\s\S]*?'undo'/,
  );

  const redoStart = VIEWER_SOURCE.indexOf('const handleRedo = useCallback');
  const redoEnd = VIEWER_SOURCE.indexOf('// Mechanism: Y.UndoManager', redoStart);
  const redoSource = VIEWER_SOURCE.slice(redoStart, redoEnd);
  assert.match(redoSource, /legacyRedoMeta\?\.context\?\.eraseHistoryTransition/);
  assert.match(
    redoSource,
    /applyDurableEraseHistoryTransitionRef\.current\([\s\S]*?eraseHistoryTransition,[\s\S]*?'redo'/,
  );

  const commitStart = VIEWER_SOURCE.indexOf('const handleEraseIntent = useCallback');
  const commitEnd = VIEWER_SOURCE.indexOf('\n  const getPageSurveyRegionId', commitStart);
  const commitSource = VIEWER_SOURCE.slice(commitStart, commitEnd);
  assert.match(commitSource, /eraseHistoryTransition:\s*result\.historyTransition/);
  assert.match(
    commitSource,
    /onUndo:\s*\(\) => \{[\s\S]*?applyEraseHistoryTransitionFromToast\(result\.historyTransition\)/,
  );
  const toastStart = VIEWER_SOURCE.indexOf(
    'const applyEraseHistoryTransitionFromToast = useCallback',
  );
  const toastEnd = VIEWER_SOURCE.indexOf('\n  const handleEraseIntent', toastStart);
  const toastSource = VIEWER_SOURCE.slice(toastStart, toastEnd);
  const toastApply = toastSource.indexOf(
    "applyDurableEraseHistoryTransition(transition, 'undo')",
  );
  const toastMove = toastSource.indexOf(
    'const moved = moveEraseTransitionHistoryCheckpointByMutationId',
    toastApply,
  );
  assert.ok(toastApply >= 0, 'toast must apply the exact durable transition');
  assert.ok(
    toastMove > toastApply,
    'toast must recompute its exact history move after the transition returns',
  );
  assert.match(toastSource, /if \(!moved\) return result/);
  assert.doesNotMatch(commitSource, /onUndo:\s*handleUndo/);
});

test('atomic erase preserves old save-pipeline side effects without re-entering that pipeline', () => {
  const commitStart = VIEWER_SOURCE.indexOf('const handleEraseIntent = useCallback');
  const commitEnd = VIEWER_SOURCE.indexOf('\n  const getPageSurveyRegionId', commitStart);
  const commitSource = VIEWER_SOURCE.slice(commitStart, commitEnd);
  assert.match(commitSource, /prepareEraseIntentForCommit/);
  assert.match(commitSource, /requestAtomicEraseApproval/);
  assert.match(commitSource, /annotations:fabric-save-action/);
  assert.match(commitSource, /suppressHistoryRow/);
  assert.match(VIEWER_SOURCE, /annotation-delete-history/);
  assert.match(
    VIEWER_SOURCE,
    /if \(pdfFile\?\.id && user\?\.id && effectActorUserId && effectActorUserId !== user\.id\)/,
  );
  assert.match(
    VIEWER_SOURCE,
    /const eraseDocumentOwnerId = useMemo\(\(\) => \{[\s\S]*?return documentOwnerId;/,
  );
  assert.doesNotMatch(
    VIEWER_SOURCE,
    /return pdfFile\?\.user_id \|\| documentOwnerId \|\| null/,
  );
});

test('pending and model-1 survey markers keep the whole-delete path while model 2 commits exact ids', () => {
  const canEraseStart = VIEWER_SOURCE.indexOf('const canEraseSurveyMarker = useCallback');
  const canEraseEnd = VIEWER_SOURCE.indexOf('const handleDeleteSurveyMarker', canEraseStart);
  const canEraseSource = VIEWER_SOURCE.slice(canEraseStart, canEraseEnd);
  assert.match(canEraseSource, /if \(!savedSurveyMarker\) return true/);

  const commitStart = ERASER_SOURCE.indexOf('const applyEraserAndCommit = useCallback');
  const commitEnd = ERASER_SOURCE.indexOf('\n  const queueEraserCommit', commitStart);
  const commitSource = ERASER_SOURCE.slice(commitStart, commitEnd);
  assert.match(
    commitSource,
    /if \(targets\.length === 0 && \([\s\S]*?surveyMarkerHitIds\.length === 0[\s\S]*?onEraseSurveyMarkerRef\.current\?\.\(annotationId\)/,
  );
  assert.doesNotMatch(commitSource, /durableMarkerIds/);
  assert.doesNotMatch(commitSource, /transientSurveyMarkerIds/);
  assert.match(commitSource, /surveyMarkerIds: surveyMarkerHitIds/);
  assert.match(commitSource, /committedSurveyMarkerIds\.has\(String\(annotationId\)\)/);

  const viewerCommitStart = VIEWER_SOURCE.indexOf('const handleEraseIntent = useCallback');
  const viewerCommitEnd = VIEWER_SOURCE.indexOf('\n  const getPageSurveyRegionId', viewerCommitStart);
  const viewerCommitSource = VIEWER_SOURCE.slice(viewerCommitStart, viewerCommitEnd);
  assert.match(
    viewerCommitSource,
    /some\(\(target\) => target\?\.domain === 'survey-marker'\)[\s\S]*?reason: 'unsupported-domain'/,
  );
});

test('rapid follow-up gestures rebase on the durable derived commit result', () => {
  const commitStart = ERASER_SOURCE.indexOf('const applyEraserAndCommit = useCallback');
  const commitEnd = ERASER_SOURCE.indexOf('\n  const queueEraserCommit', commitStart);
  const commitSource = ERASER_SOURCE.slice(commitStart, commitEnd);
  assert.match(commitSource, /const committedPage = commitResult\?\.byPage/);
  assert.match(commitSource, /annotationsRef\.current = \{\s*\.\.\.committedPage/);

  const hookSource = readFileSync(
    new URL('../src/hooks/useAnnotationDoc.js', import.meta.url),
    'utf8',
  );
  assert.match(
    hookSource,
    /return \{\s*\.\.\.result,\s*byPage: nextByPage,\s*surveyMarkers: nextSurveyMarkers/,
  );
});
