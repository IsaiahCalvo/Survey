import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// PDFViewer was extracted from App.jsx into src/PDFViewer.jsx; read both so the
// source guards find the code wherever it now lives.
const APP_SOURCE = readFileSync(new URL('../src/viewerShared.js', import.meta.url), 'utf8')
  + '\n' + readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8')
  // the hydration page-cover render helper was lifted into its own module
  // (2026-05-29); scan it too so the guard still finds the relocated markup.
  + '\n' + readFileSync(new URL('../src/components/annotationHydrationCover.jsx', import.meta.url), 'utf8');
const CLOUD_SYNC_SOURCE = readFileSync(new URL('../src/hooks/useAnnotationCloudSync.js', import.meta.url), 'utf8');

test('cloud-backed survey highlights are not painted from localStorage before Supabase settles', () => {
  assert.match(APP_SOURCE, /const loadedSurveyMarkers = isCloudBackedDoc\s*\?\s*\(isSamePdfReload \? previousSurveyMarkersForSamePdf : \{\}\)\s*:\s*loadSurveyMarkers\(id\);/);
  assert.match(APP_SOURCE, /context: 'survey-marker-hydrate'/);
  assert.match(APP_SOURCE, /setSurveyMarkers\(safeSurveySnapshot\.value\);/);
  assert.match(APP_SOURCE, /source: 'supabase-highlight'/);
});

test('survey marker hydration cannot stay pending after a cancelled same-document load', () => {
  assert.match(APP_SOURCE, /const activeCloudDocumentIdRef = useRef\(null\);/);
  assert.match(APP_SOURCE, /const surveyHydrationRequestSeqRef = useRef\(0\);/);
  assert.match(APP_SOURCE, /activeCloudDocumentIdRef\.current !== documentId/);
  assert.match(APP_SOURCE, /wasCancelledSameDocument: !!cancelled/);
  assert.match(APP_SOURCE, /source: 'supabase-highlight-error'/);
  assert.match(APP_SOURCE, /\[AnnotationHydrationGate\]\[survey\] supabase surveyMarkers start/);
  assert.match(APP_SOURCE, /\[AnnotationHydrationGate\]\[survey\] supabase surveyMarkers complete/);
});

test('same-document reload preserves cloud-owned layers instead of blanking them', () => {
  assert.match(APP_SOURCE, /const previousSurveyMarkersForSamePdf = surveyMarkersRef\.current \|\| \{\};/);
  assert.match(APP_SOURCE, /const previousCalloutsForSamePdf = calloutsRef\.current \|\| \[\];/);
  assert.match(APP_SOURCE, /const previousSpacesForSamePdf = spacesRef\.current \|\| \[\];/);
  assert.match(APP_SOURCE, /spacesRef\.current = isSamePdfReload \? previousSpacesForSamePdf : \[\];/);
  assert.match(APP_SOURCE, /setSpaces\(isSamePdfReload \? previousSpacesForSamePdf : \[\]\);/);
  assert.match(APP_SOURCE, /const loadedCallouts = isCloudBackedDoc\s*\?\s*\(isSamePdfReload \? previousCalloutsForSamePdf : \[\]\)\s*:\s*loadCallouts\(id\);/);
});

test('annotation persistence is owned by the durable Yjs store, not the legacy hook', () => {
  // Rebuild contract: the legacy cloud-sync hook's annotation hydrate + push are
  // retired (called inert), and the durable Yjs store (useAnnotationDoc) owns
  // annotation + callout persistence, gated on the document id + user being
  // present (no live-subscription prerequisite).
  assert.match(APP_SOURCE, /useAnnotationDoc\(\{/);
  assert.match(
    APP_SOURCE,
    /useAnnotationDoc\(\{[\s\S]*?enabled: isActive && cloudSyncEnabled && !!pdfFile\?\.id && !!user\?\.id/
  );
  // The legacy hook is neutralized for persistence.
  assert.match(APP_SOURCE, /enabled: false,\s*hydrateEnabled: false/);
  // The legacy hook still has its hydrate guard (kept until full removal).
  assert.match(CLOUD_SYNC_SOURCE, /if \(!hydrateEnabled \|\| !documentId \|\| !userId \|\| !pdfId\)/);
});

test('cutover-sealed documents mark the first-paint source as Y.Doc authoritative', () => {
  assert.match(CLOUD_SYNC_SOURCE, /source: 'ydoc-snapshot'/);
  assert.match(CLOUD_SYNC_SOURCE, /markInitialHydration\(\{\s*ready: true,\s*source: 'ydoc-snapshot'/s);
});

test('cutover reconnect/focus cannot leave a blank local view when Supabase still has annotations', () => {
  assert.match(CLOUD_SYNC_SOURCE, /const restoreCutoverSnapshotIfLocalEmpty = async/);
  assert.match(CLOUD_SYNC_SOURCE, /local cutover view is empty — probing Supabase durable snapshot/);
  assert.match(CLOUD_SYNC_SOURCE, /source: 'cutover-durable-snapshot-recovery'/);
  assert.match(CLOUD_SYNC_SOURCE, /restoreCutoverSnapshotIfLocalEmpty\('cutover-post-subscribe-empty-view-recovery'\)/);
  assert.match(CLOUD_SYNC_SOURCE, /restoreCutoverSnapshotIfLocalEmpty\('cutover-focus-empty-view-recovery'\)/);
});

test('cloud snapshots use the shared safe-snapshot rule before replacing visible state', () => {
  assert.match(APP_SOURCE, /resolveSafeSnapshot\(\{\s*current: surveyMarkersRef\.current \|\| \{\},\s*incoming: remoteAnnotations \|\| \{\},\s*cloudBacked: true,\s*kind: 'object-map',\s*context: 'survey-marker-hydrate'/s);
  assert.match(APP_SOURCE, /context: 'supabase-storage-spaces'/);
  assert.match(CLOUD_SYNC_SOURCE, /context: 'initial-hydrate-fabric'/);
  assert.match(CLOUD_SYNC_SOURCE, /context: 'post-subscribe-fabric'/);
  assert.match(CLOUD_SYNC_SOURCE, /context: 'focus-rehydrate-fabric'/);
  assert.match(CLOUD_SYNC_SOURCE, /preserved visible state instead of applying empty Y\.Doc snapshot/);
});

test('first visible annotation wrappers expose and honor the hydration gate', () => {
  assert.match(APP_SOURCE, /const firstVisibleAnnotationPage = useMemo/);
  assert.match(APP_SOURCE, /data-annotation-hydration-gated=\{annotationHydrationGated \? 'true' : 'false'\}/);
  assert.match(APP_SOURCE, /visibility: annotationHydrationGated \? 'hidden' : undefined/);
});

test('first visible page is visually covered while annotation hydration is gated', () => {
  assert.match(APP_SOURCE, /function renderAnnotationHydrationPageCover\(/);
  assert.match(APP_SOURCE, /data-annotation-hydration-cover="true"/);
  assert.match(APP_SOURCE, /data-annotation-visual-cover-active=\{annotationVisualCoverActive \? 'true' : 'false'\}/);
  assert.match(APP_SOURCE, /renderAnnotationHydrationPageCover\(pageNumber, 'syncfusion', annotationVisualCoverActive\)/);
  assert.match(APP_SOURCE, /renderAnnotationHydrationPageCover\(pageNumber, 'pdfjs-continuous', annotationHydrationGated\)/);
  assert.match(APP_SOURCE, /renderAnnotationHydrationPageCover\(pageNum, 'pdfjs-single', annotationHydrationGated\)/);
  assert.match(APP_SOURCE, /visualCoverActive: !ready/);
  assert.match(APP_SOURCE, /\[AnnotationHydrationGate\]\[visual-cover\]/);
});
