import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const APP_SOURCE = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const CLOUD_SYNC_SOURCE = readFileSync(new URL('../src/hooks/useAnnotationCloudSync.js', import.meta.url), 'utf8');

test('cloud-backed survey highlights are not painted from localStorage before Supabase settles', () => {
  assert.match(APP_SOURCE, /const loadedHighlights = isCloudBackedDoc \? \{\} : loadSurveyMarkers\(id\);/);
  assert.match(APP_SOURCE, /setSurveyMarkers\(remoteAnnotations \|\| \{\}\);/);
  assert.match(APP_SOURCE, /source: 'supabase-highlight'/);
});

test('normal annotation hydration can start before live sync subscription is enabled', () => {
  assert.match(APP_SOURCE, /enabled: cloudSyncActive,\s*hydrateEnabled: cloudSyncEnabled && !!pdfFile\?\.id && !!user\?\.id/s);
  assert.match(CLOUD_SYNC_SOURCE, /hydrateEnabled = enabled/);
  assert.match(CLOUD_SYNC_SOURCE, /if \(!hydrateEnabled \|\| !documentId \|\| !userId \|\| !pdfId\)/);
});

test('cutover-sealed documents mark the first-paint source as Y.Doc authoritative', () => {
  assert.match(CLOUD_SYNC_SOURCE, /source: 'ydoc-snapshot'/);
  assert.match(CLOUD_SYNC_SOURCE, /markInitialHydration\(\{\s*ready: true,\s*source: 'ydoc-snapshot'/s);
});

test('first visible annotation wrappers expose and honor the hydration gate', () => {
  assert.match(APP_SOURCE, /const firstVisibleAnnotationPage = useMemo/);
  assert.match(APP_SOURCE, /data-annotation-hydration-gated=\{annotationHydrationGated \? 'true' : 'false'\}/);
  assert.match(APP_SOURCE, /visibility: annotationHydrationGated \? 'hidden' : undefined/);
});

test('first visible page is visually covered while annotation hydration is gated', () => {
  assert.match(APP_SOURCE, /const renderAnnotationHydrationPageCover = useCallback/);
  assert.match(APP_SOURCE, /data-annotation-hydration-cover="true"/);
  assert.match(APP_SOURCE, /data-annotation-visual-cover-active=\{annotationVisualCoverActive \? 'true' : 'false'\}/);
  assert.match(APP_SOURCE, /renderAnnotationHydrationPageCover\(pageNumber, 'syncfusion', annotationVisualCoverActive\)/);
  assert.match(APP_SOURCE, /renderAnnotationHydrationPageCover\(pageNumber, 'pdfjs-continuous', annotationHydrationGated\)/);
  assert.match(APP_SOURCE, /renderAnnotationHydrationPageCover\(pageNum, 'pdfjs-single', annotationHydrationGated\)/);
  assert.match(APP_SOURCE, /visualCoverActive: !ready/);
  assert.match(APP_SOURCE, /\[AnnotationHydrationGate\]\[visual-cover\]/);
});
