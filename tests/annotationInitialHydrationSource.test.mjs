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
const ANNOTATION_DOC_HOOK_SOURCE = readFileSync(new URL('../src/hooks/useAnnotationDoc.js', import.meta.url), 'utf8');

test('cloud-backed survey highlights hydrate from the durable Y.Doc, not the legacy table', () => {
  // Cloud docs start highlights empty (or the same-pdf-reload snapshot); the
  // durable Y.Doc (useAnnotationDoc) then paints them. They are NO LONGER read
  // from the legacy document_annotations table on open.
  assert.match(APP_SOURCE, /const hasCheckedHydratedState = checkedBundle !== null[\s\S]*?normalAnnotationHydration\.documentId === pdfFile\?\.id;/);
  assert.match(APP_SOURCE, /annotationsByPageRef\.current = checkedBundle !== null\s*\? previouslyVisibleAnnotationsByPage : \{\};/);
  assert.match(APP_SOURCE, /let initialAnnotationsByPage = hasCheckedHydratedState\s*\? previouslyVisibleAnnotationsByPage : migratedAnnotationsByPage;/);
  assert.match(APP_SOURCE, /const loadedSurveyMarkers = isCloudBackedDoc\s*\?\s*\(isSamePdfReload \|\| hasCheckedHydratedState \? previousSurveyMarkersForSamePdf : \{\}\)\s*:\s*managedLocalStateReader\s*\?\s*JSON\.parse\(managedLocalStateReader\.getItem\(`surveyMarkers_\$\{id\}`\) \|\| '\{\}'\)\s*:\s*loadSurveyMarkers\(id\);/);
  assert.match(APP_SOURCE, /if \(checkedBundle === null\) setSurveyMarkersState\(loadedSurveyMarkers\);/);
  assert.match(APP_SOURCE, /if \(checkedBundle === null\) \{\s*setAnnotationsByPage\(initialAnnotationsByPage\);[\s\S]*?setCallouts\(loadedCallouts\);\s*\}/);
  // useAnnotationDoc owns highlight hydrate + capture + realtime. Hydration
  // receives the raw React setter; user intents go through the model-aware,
  // scope-fenced bridge so a hydrate read can never become a remote write.
  assert.match(APP_SOURCE, /useAnnotationDoc\(\{[\s\S]*?surveyMarkers,\s*setSurveyMarkers: setSurveyMarkersState,/);
  assert.match(APP_SOURCE, /const setSurveyMarkers = useCallback\(\(updater\) => \{[\s\S]*?bridge\.updateMarkers\(updater\)/);
  assert.match(APP_SOURCE, /surveyV2MutationScopeRef\.current !== surveyV2MutationScope/);
  // The legacy survey-marker SELECT is retired (no document_annotations read).
  assert.doesNotMatch(APP_SOURCE, /loadAnnotationsFromSupabase\(documentId\)/);
  // The hydration-ready signal is now sourced from the annotation doc.
  assert.match(APP_SOURCE, /source: 'annotation-doc'/);
  // Model 2 survey markers live outside annotationsByPage. The legacy orphan
  // cleanup uses a broad translucent-rectangle heuristic and must not erase
  // ordinary model-2 rectangles after the checked hook hydrates them.
  assert.match(
    APP_SOURCE,
    /Cleanup orphaned canvas surveyMarkers[\s\S]*?if \(checkedBundle\?\.contentModelVersion === 2\) return;[\s\S]*?Clean up orphaned surveyMarkers from annotationsByPage/,
  );
});

test('survey marker hydration cannot stay pending after a cancelled same-document load', () => {
  assert.match(APP_SOURCE, /const activeCloudDocumentIdRef = useRef\(null\);/);
  assert.match(APP_SOURCE, /const surveyHydrationRequestSeqRef = useRef\(0\);/);
  assert.match(APP_SOURCE, /activeCloudDocumentIdRef\.current !== documentId/);
  assert.match(APP_SOURCE, /wasCancelledSameDocument: !!cancelled/);
  // The presence/permission chain still runs; its error path now reports the
  // annotation-doc source (the legacy 'supabase-highlight-error' is retired).
  assert.match(APP_SOURCE, /source: 'annotation-doc-error'/);
  assert.match(APP_SOURCE, /\[AnnotationHydrationGate\]\[survey\] supabase surveyMarkers start/);
});

test('same-document reload preserves cloud-owned layers instead of blanking them', () => {
  assert.match(APP_SOURCE, /const previousSurveyMarkersForSamePdf = surveyMarkersRef\.current \|\| \{\};/);
  assert.match(APP_SOURCE, /const previousCalloutsForSamePdf = calloutsRef\.current \|\| \[\];/);
  assert.match(APP_SOURCE, /const previousSpacesForSamePdf = spacesRef\.current \|\| \[\];/);
  assert.match(APP_SOURCE, /spacesRef\.current = checkedBundle !== null \|\| isSamePdfReload \? previousSpacesForSamePdf : \[\];/);
  assert.match(APP_SOURCE, /if \(checkedBundle === null\) \{\s*setSpacesState\(isSamePdfReload \? previousSpacesForSamePdf : \[\]\);\s*\}/);
  assert.match(APP_SOURCE, /const loadedCallouts = isCloudBackedDoc\s*\?\s*\(isSamePdfReload \? previousCalloutsForSamePdf : \[\]\)\s*:\s*managedLocalStateReader\s*\?\s*JSON\.parse\(managedLocalStateReader\.getItem\(`callouts_\$\{id\}`\) \|\| '\[\]'\)\s*:\s*loadCallouts\(id\);/);
});

test('annotation persistence is owned by the durable Yjs store, not the legacy hook', () => {
  // Rebuild contract: the legacy cloud-sync hook is no longer mounted, and the
  // durable Yjs store owns persistence plus the user-facing sync status.
  assert.match(APP_SOURCE, /useAnnotationDoc\(\{/);
  assert.match(
    APP_SOURCE,
    /useAnnotationDoc\(\{[\s\S]*?enabled: isActive && cloudSyncEnabled && !!pdfFile\?\.id && !!user\?\.id/
  );
  // The retired legacy hook module (src/hooks/useAnnotationCloudSync.js) was
  // DELETED 2026-07-17. This guard is now the tombstone: the hook must never
  // be re-mounted (and any resurrected call would fail this pin immediately).
  assert.doesNotMatch(APP_SOURCE, /useAnnotationCloudSync\(\{/);
  assert.match(APP_SOURCE, /status: cloudSyncStatus,\s*queueSize: cloudSyncQueueSize/);
});

test('cloud callouts hydrate from the annotations map inside byPage, never the calloutsList meta blob (Slice 6)', () => {
  // useAnnotationDoc is STILL the one live cloud hydrate seam (pinned by the
  // 'annotation persistence is owned by the durable Yjs store' test below), but
  // as of Slice 6 (2026-07-17) callouts ride the flat `annotations` Y.Map
  // per-id like every other type. The hook must never read or write the
  // retired coarse meta blob again:
  assert.doesNotMatch(ANNOTATION_DOC_HOOK_SOURCE, /setMeta\(\s*['"]calloutsList['"]/);
  assert.doesNotMatch(ANNOTATION_DOC_HOOK_SOURCE, /getMeta\(\s*['"]calloutsList['"]/);
  assert.doesNotMatch(ANNOTATION_DOC_HOOK_SOURCE, /CALLOUTS_KEY/);
  // Legacy docs are converted exactly once per document (map write + meta
  // tombstone in one atomic transaction) — the migration call is the only
  // sanctioned touch of the old key, and it lives in calloutMetaMigration.js,
  // not this hook.
  assert.match(ANNOTATION_DOC_HOOK_SOURCE, /migrateCalloutsMetaToAnnotationsMap\(handle\.doc/);
  // The hydrate read delivers callout groups INSIDE the byPage shape (with
  // geometry normalization against the locally measured page dims).
  assert.match(ANNOTATION_DOC_HOOK_SOURCE, /deriveCalloutsFromByPage\(storeByPage\)/);
  // Viewer-safe migration (2026-07-17 hardening): the migration WRITES, and
  // annotation_updates INSERT is RLS-gated to editors — so it must be gated on
  // a confirmed-writable resolved role, both at open and when the role
  // resolves late…
  assert.match(ANNOTATION_DOC_HOOK_SOURCE, /isWritableDocRole\(docRoleRef\.current\)/);
  assert.match(ANNOTATION_DOC_HOOK_SOURCE, /isWritableDocRole\(docRole\)/);
  // …while viewer/unresolved roles take the ZERO-op read-only fallback (legacy
  // meta callouts projected locally so they still render)…
  assert.match(ANNOTATION_DOC_HOOK_SOURCE, /getUnmigratedMetaCallouts\(handle\.doc\)/);
  // …and the capture path strips those local projections back out, so the
  // fallback can never become the first diff a viewer-tier client pushes
  // (there is NO role gate in the capture path — server RLS is the only
  // write enforcement).
  assert.match(
    ANNOTATION_DOC_HOOK_SOURCE,
    /capturedByPage\s*=\s*stripMetaFallbackCallouts\(\s*annotationsByPage/,
  );
  assert.match(ANNOTATION_DOC_HOOK_SOURCE, /applyByPage\(capturedByPage\)/);
  // PDFViewer's seam no longer feeds the legacy callouts/setCallouts pair (or
  // the retired BLOCKER-2 pageSizesReady signal) into the hook — callouts
  // arrive via annotationsByPage alone.
  const seamMatch = APP_SOURCE.match(/useAnnotationDoc\(\{[\s\S]*?\}\);/);
  assert.ok(seamMatch, 'the useAnnotationDoc mount survives');
  // Compare CODE lines only (the explanatory comments may name the retired
  // props while describing why they are gone).
  const seamCode = seamMatch[0]
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.ok(seamCode.includes('annotationsByPage'), 'byPage is the annotation payload');
  assert.ok(!seamCode.includes('setCallouts'), 'no separate callout channel into the hook');
  assert.ok(!seamCode.includes('pageSizesReady'), 'BLOCKER-2 re-projection signal retired');
  // The seam threads the resolved document role in so the hook can gate the
  // migration writes (viewer opens must be zero-op).
  assert.ok(seamCode.includes('docRole'), 'the resolved document role reaches the hook');
});

test('stacked ink repair runs after hydration/listener wiring, before first paint, and only for writers', () => {
  const listenerIndex = ANNOTATION_DOC_HOOK_SOURCE.indexOf('handle.onChange((byPage) =>');
  const firstRepairIndex = ANNOTATION_DOC_HOOK_SOURCE.indexOf(
    'runDurableStackedInkRepair(handle, documentId)',
    listenerIndex,
  );
  const firstReadIndex = ANNOTATION_DOC_HOOK_SOURCE.indexOf('const storeByPage = handle.getByPage()');

  assert.ok(listenerIndex >= 0, 'React change listener is registered');
  assert.ok(firstRepairIndex > listenerIndex, 'repair publishes through an already-wired listener');
  assert.ok(firstReadIndex > firstRepairIndex, 'initial paint reads the repaired document');
  assert.match(
    ANNOTATION_DOC_HOOK_SOURCE,
    /if \(isWritableDocRole\(docRoleRef\.current\)\) \{[\s\S]*?runDurableStackedInkRepair\(handle, documentId\)/,
  );
  assert.match(
    ANNOTATION_DOC_HOOK_SOURCE,
    /if \(!isWritableDocRole\(docRole\)\) return;[\s\S]*?runDurableStackedInkRepair\(h, documentId\)/,
    'late owner/editor role resolution retries the repair; viewers stay zero-write',
  );
  assert.match(
    ANNOTATION_DOC_HOOK_SOURCE,
    /if \(isWritableDocRole\(docRoleRef\.current\)\) \{[\s\S]*?runDurableStackedInkRepair\([\s\S]*?\{ notify: false \}/,
    'duplicates arriving in the hydrate-to-realtime gap are repaired on remote materialization',
  );
});

// The 'cutover-sealed first-paint' and 'cutover reconnect/focus recovery'
// tests were deleted 2026-07-17: they pinned internals of the retired
// useAnnotationCloudSync hook, which was unmounted (see the tombstone guard
// above) and whose module is now deleted. The live first-paint contract
// (source: 'annotation-doc') is pinned in the first test of this file.

test('cloud snapshots use the shared safe-snapshot rule before replacing visible state', () => {
  // Highlights no longer use resolveSafeSnapshot on hydrate — the durable Y.Doc
  // is their source of truth now. The local-only spaces sidecar guard remains.
  // (The retired hook's fabric-context wraps were deleted with its module
  // 2026-07-17; the survey-marker sidecar wrap is pinned by
  // tests/annotationIdleRecoveryContracts.test.mjs.)
  assert.match(APP_SOURCE, /context: 'supabase-storage-spaces'/);
});

test('first visible annotation wrappers expose and honor the hydration gate', () => {
  assert.match(APP_SOURCE, /const firstVisibleAnnotationPage = useMemo/);
  assert.match(APP_SOURCE, /data-annotation-hydration-gated=\{annotationHydrationGated \? 'true' : 'false'\}/);
  assert.match(
    APP_SOURCE,
    /visibility:\s*\(annotationHydrationGated \|\| useCanvasPresentation\)\s*\?\s*'hidden'\s*:\s*undefined/,
  );
});

test('first visible page is visually covered while annotation hydration is gated', () => {
  assert.match(APP_SOURCE, /function renderAnnotationHydrationPageCover\(/);
  assert.match(APP_SOURCE, /data-annotation-hydration-cover="true"/);
  assert.match(APP_SOURCE, /data-annotation-visual-cover-active=\{annotationVisualCoverActive \? 'true' : 'false'\}/);
  assert.match(APP_SOURCE, /renderAnnotationHydrationPageCover\(pageNumber, 'pdfjs', annotationVisualCoverActive\)/);
  // The 'pdfjs-continuous' and 'pdfjs-single' covers lived in the legacy (!usePdfjsRenderer)
  // render arm, which was removed once usePdfjsRenderer became permanently true. The live
  // pdf.js path renders pages through PdfjsViewerContainer with the single 'pdfjs' cover above.
  assert.match(APP_SOURCE, /visualCoverActive: !ready/);
  assert.match(APP_SOURCE, /\[AnnotationHydrationGate\]\[visual-cover\]/);
});
