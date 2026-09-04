import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const SOURCE = readFileSync(
  new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url),
  'utf8',
);
const APP_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('base and detail PDF raster tasks yield between operator chunks', () => {
  const yieldCount = SOURCE.match(/task\.onContinue = \(resume\) => requestAnimationFrame\(resume\);/g)?.length || 0;
  assert.ok(yieldCount >= 2, `expected both raster paths to yield, found ${yieldCount}`);
});

test('Space pan is capture-level and has complete lost-focus cleanup', () => {
  assert.match(SOURCE, /const isSpaceKey =/);
  assert.match(SOURCE, /const isEditableTarget =/);
  assert.match(SOURCE, /window\.addEventListener\('keydown', activateSpacePan, true\)/);
  assert.match(SOURCE, /window\.addEventListener\('keyup', releaseSpacePan, true\)/);
  assert.match(SOURCE, /window\.addEventListener\('blur', releaseSpacePan\)/);
  assert.match(SOURCE, /window\.addEventListener\('pagehide', releaseSpacePan\)/);
  assert.match(SOURCE, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/);
});

test('drag pan batches pointer deltas into one scroll write per animation frame', () => {
  assert.match(SOURCE, /const panDeltaRef = useRef\(\{ x: 0, y: 0 \}\)/);
  assert.match(SOURCE, /const panRafRef = useRef\(0\)/);
  assert.match(SOURCE, /const schedulePan = useCallback/);
  assert.match(SOURCE, /panRafRef\.current = requestAnimationFrame/);
  assert.match(SOURCE, /schedulePan\(dx, dy\)/);
});

test('custom scrollbar drag keeps the thumb on the pointer without animation lag', () => {
  const scrollbarStart = SOURCE.indexOf('function ViewportScrollbars');
  const scrollbarEnd = SOURCE.indexOf('let pdfjsContainerSeq', scrollbarStart);
  const scrollbarSource = SOURCE.slice(scrollbarStart, scrollbarEnd);

  assert.match(scrollbarSource, /horizontalThumbRef\.current\.style\.left/);
  assert.match(scrollbarSource, /verticalThumbRef\.current\.style\.top/);
  assert.match(scrollbarSource, /transition: 'width 120ms ease-out, height 120ms ease-out'/);
  assert.doesNotMatch(scrollbarSource, /left 120ms|top 120ms/);

  const pointerMoveStart = scrollbarSource.indexOf('const onPointerMove');
  const pointerMoveEnd = scrollbarSource.indexOf('const finishDrag', pointerMoveStart);
  assert.doesNotMatch(scrollbarSource.slice(pointerMoveStart, pointerMoveEnd), /showThenFade\(\)/);
});

test('custom scrollbars restart fading when edge hover ends or leaves the scroller', () => {
  const scrollbarStart = SOURCE.indexOf('function ViewportScrollbars');
  const scrollbarEnd = SOURCE.indexOf('let pdfjsContainerSeq', scrollbarStart);
  const scrollbarSource = SOURCE.slice(scrollbarStart, scrollbarEnd);

  assert.match(scrollbarSource, /hoveredAxisRef\.current = axis;[\s\S]{0,120}showThenFade\(\)/);
  assert.match(scrollbarSource, /const onScrollbarProximityLeave[\s\S]{0,240}hoveredAxisRef\.current = null[\s\S]{0,160}showThenFade\(\)/);
  assert.match(scrollbarSource, /scroller\.addEventListener\('pointerleave', onScrollbarProximityLeave/);
});

test('Text Select annotation hits sit above the native text layer', () => {
  assert.match(SOURCE, /zIndex: textSelectionLayerActive \? 41 : 30/);
});

test('deep zoom detail work pauses during pan and resumes afterward', () => {
  assert.match(SOURCE, /function DetailTile\([^)]*interactionRef/);
  assert.match(SOURCE, /if \(interactionRef\?\.current\) return;/);
  assert.match(SOURCE, /window\.addEventListener\(PAN_START_EVENT, onPanStart\)/);
  assert.match(SOURCE, /window\.addEventListener\(PAN_END_EVENT, onPanEnd\)/);
  assert.match(SOURCE, /interactionRef=\{panInteractionRef\}/);
});

test('owned viewer keeps viewport movement inside the compositor-owned page stack', () => {
  assert.doesNotMatch(SOURCE, /cb\.current\.onViewportInteraction/);
  assert.doesNotMatch(SOURCE, /onViewportInteraction,/);
});

test('wheel zoom commits like the reference demo without a second settle animation', () => {
  assert.doesNotMatch(SOURCE, /SETTLE_ANIM_MS/);
  assert.doesNotMatch(SOURCE, /settleTweenFromRef/);
  assert.doesNotMatch(SOURCE, /DRIFT CLAMP/);
  assert.match(SOURCE, /el\.scrollLeft = Math\.min\(Math\.max\(0, p\.left\), maxLeft\)/);
  assert.match(SOURCE, /el\.scrollTop = Math\.min\(Math\.max\(0, p\.top\), maxTop\)/);
});

test('app consumes committed zoom and page hosts directly from the owned engine', () => {
  assert.match(APP_SOURCE, /onZoomChanged=\{handlePdfjsEngineZoomCommitted\}/);
  assert.match(APP_SOURCE, /onPageContainersChange=\{handlePdfjsPageContainersChange\}/);
  assert.doesNotMatch(APP_SOURCE, /onZoomChanged=\{undefined\}/);
  assert.doesNotMatch(APP_SOURCE, /onPageContainersChange=\{undefined\}/);
  assert.doesNotMatch(APP_SOURCE, /onPanStateChange=\{setPdfjsPanActive\}/);
});

test('annotation portals live inside their own page instead of a shared positioned overlay', () => {
  assert.match(SOURCE, /data-pdfjs-page-overlay-host="true"/);
  assert.doesNotMatch(SOURCE, /const overlayHostRef = useRef/);

  const attachStart = APP_SOURCE.indexOf('const attachOverlayToPageDiv = useCallback');
  const attachEnd = APP_SOURCE.indexOf('const sanitizePdfjsPageContainerMap', attachStart);
  const attachSource = APP_SOURCE.slice(attachStart, attachEnd);
  assert.match(attachSource, /pageDiv\.querySelector\?\.\('\[data-pdfjs-page-overlay-host="true"\]'\)/);
  assert.doesNotMatch(attachSource, /getOverlayHost/);
  assert.doesNotMatch(attachSource, /offsetLeft|offsetTop|getBoundingClientRect/);
  assert.doesNotMatch(attachSource, /style\.(left|top|width|height)/);
  assert.doesNotMatch(APP_SOURCE, /scheduleOverlayPositionSync/);
});

test('zoom commit uses the engine raw scale without app-side rounding or a lower ceiling', () => {
  const handlerStart = APP_SOURCE.indexOf('const handlePdfjsEngineZoomCommitted = useCallback');
  const handlerEnd = APP_SOURCE.indexOf('const handlePdfjsPageRenderComplete', handlerStart);
  const handlerSource = APP_SOURCE.slice(handlerStart, handlerEnd);
  assert.match(handlerSource, /payload\?\.raw\?\.scale/);
  assert.match(handlerSource, /0\.0001/);
  assert.doesNotMatch(handlerSource, /0\.0005/);
  assert.match(SOURCE, /useLayoutEffect\(\(\) => \{\s*if \(prevScaleRef\.current == null\)/);
  const controllerStart = APP_SOURCE.indexOf('zoomControllerRef.current = createZoomController');
  const controllerEnd = APP_SOURCE.indexOf('\n  }', controllerStart);
  const controllerSource = APP_SOURCE.slice(controllerStart, controllerEnd);
  assert.match(controllerSource, /mode: context\?\.mode \|\| ZOOM_MODES\.MANUAL/);
});

test('owned pdf.js zoom bypasses the removed legacy snapshot and 1.4 second handoff', () => {
  const zoomStart = APP_SOURCE.indexOf('const setScaleWithViewportPreservation = useCallback');
  const zoomEnd = APP_SOURCE.indexOf('\n    if (!container)', zoomStart);
  const ownedZoomSource = APP_SOURCE.slice(zoomStart, zoomEnd);
  assert.match(ownedZoomSource, /viewer\.magnificationModule/);
  assert.doesNotMatch(ownedZoomSource, /capturePdfjsZoomSnapshots/);
  assert.doesNotMatch(ownedZoomSource, /setPdfjsZoomPreviewActive/);
  assert.doesNotMatch(ownedZoomSource, /zoomOverlaySettleTimerRef/);
  assert.doesNotMatch(ownedZoomSource, /pdfjsPendingZoomScaleRef/);
});

test('ordinary pdf.js interaction settling cannot impersonate a zoom start', () => {
  const finalizeStart = APP_SOURCE.indexOf('const finalizePdfjsInteractionIdle = useCallback');
  const finalizeEnd = APP_SOURCE.indexOf('const isPdfjsPageViewportVisible', finalizeStart);
  const finalizeSource = APP_SOURCE.slice(finalizeStart, finalizeEnd);
  assert.match(finalizeSource, /if \(!overlayZoomInProgress && !usePdfjsRenderer\)/);
  assert.doesNotMatch(finalizeSource, /if \(!overlayZoomInProgress && usePdfjsRenderer\)/);
});

test('annotation overlay recovery redraw cannot impersonate a zoom start', () => {
  const watchdogStart = APP_SOURCE.indexOf('const intervalId = window.setInterval(() => {');
  const watchdogEnd = APP_SOURCE.indexOf('return () => window.clearInterval(intervalId);', watchdogStart);
  const watchdogSource = APP_SOURCE.slice(watchdogStart, watchdogEnd);
  assert.match(watchdogSource, /setAnnotationOverlayRecoveryTick/);
  assert.doesNotMatch(watchdogSource, /setZoomGeneration/);
});

test('zoom hotkeys preserve the active pen or eraser tool like the demo', () => {
  const keyZoomStart = APP_SOURCE.indexOf('// Pre-activate zoom overlay protection');
  const keyZoomEnd = APP_SOURCE.indexOf('// Optimized pan handling', keyZoomStart);
  const keyZoomSource = APP_SOURCE.slice(keyZoomStart, keyZoomEnd);
  assert.doesNotMatch(keyZoomSource, /setActiveTool\('pan'\)/);
  assert.doesNotMatch(keyZoomSource, /capturePdfjsZoomSnapshots/);
});

test('owned zoom publishes gesture gates for annotation detail painting', () => {
  assert.match(SOURCE, /survey-pdfjs-zoom-start/);
  assert.match(SOURCE, /survey-pdfjs-zoom-end/);
});

test('manual zoom entered before PDF load wins over delayed initial Fit Page', () => {
  assert.match(APP_SOURCE, /const pdfjsDocumentReadyRef = useRef\(false\)/);
  assert.match(APP_SOURCE, /const pendingManualZoomBeforeLoadRef = useRef\(null\)/);
  assert.match(APP_SOURCE, /if \(usePdfjsRenderer && !pdfjsDocumentReadyRef\.current\)/);

  const loadStart = APP_SOURCE.indexOf('const handlePdfjsDocumentLoad = useCallback');
  const loadEnd = APP_SOURCE.indexOf('const handlePdfjsDocumentLoadFailed', loadStart);
  const loadSource = APP_SOURCE.slice(loadStart, loadEnd);
  assert.match(loadSource, /const hasPendingManualZoom =/);
  assert.match(loadSource, /const isFreshOpen = !hasPendingManualZoom/);
  assert.match(loadSource, /if \(!hasPendingManualZoom\)/);
  assert.match(loadSource, /if \(hasPendingManualZoom\) \{/);
  assert.match(loadSource, /applyPendingManualZoom\(\)/);
});

test('owned engine is the sole Space-pan owner and panning does not switch annotation renderers', () => {
  const spaceEffectStart = APP_SOURCE.indexOf('// Spacebar Pan feature');
  const spaceEffectEnd = APP_SOURCE.indexOf('const [pendingLocationItem', spaceEffectStart);
  const spaceEffectSource = APP_SOURCE.slice(spaceEffectStart, spaceEffectEnd);
  assert.match(spaceEffectSource, /if \(usePdfjsRenderer\) return undefined;/);
  assert.doesNotMatch(APP_SOURCE, /const useCanvasPresentation = pdfjsPanActive \|\|/);
});

test('every visible page stays mounted while only offscreen overscan is bounded', () => {
  assert.doesNotMatch(SOURCE, /MAX_MOUNTED/);
  assert.match(SOURCE, /MAX_OVERSCAN_PAGES/);
  assert.match(SOURCE, /visibleFirst/);
  assert.match(SOURCE, /visibleLast/);
  assert.match(SOURCE, /const visibleCount = visibleLast - visibleFirst \+ 1/);
});

test('owned engine reports its mounted page window for annotation virtualization', () => {
  assert.match(SOURCE, /onMountedPagesChange/);
  assert.match(SOURCE, /data-page-mounted=\{mounted \? 'true' : 'false'\}/);
  assert.match(APP_SOURCE, /onMountedPagesChange=\{handlePdfjsMountedPagesChange\}/);
  assert.match(APP_SOURCE, /pdfjsMountedPages\.has\(pageNumber\)/);
});

test('the production stress harness dispatches gestures to the owned PDF scroller', () => {
  const stressStart = APP_SOURCE.indexOf('const trackpadStressTestApi');
  const stressEnd = APP_SOURCE.indexOf('window.__pdfOverlayRecorderOwner', stressStart);
  const stressSource = APP_SOURCE.slice(stressStart, stressEnd);
  assert.match(stressSource, /pdfjsViewerRef\.current\?\.getViewerContainer\?\.\(\)/);
  assert.match(stressSource, /document\.querySelector\('\.survey-pdfjs-viewer'\)/);
  assert.doesNotMatch(stressSource, /survey-pdfjs-viewer-container/);
});
