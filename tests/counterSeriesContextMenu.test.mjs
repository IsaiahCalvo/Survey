import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appShellSource = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const viewerSource = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const contextMenuDiagnosticsSource = await readFile(
  new URL('../src/utils/contextMenuDiagnostics.js', import.meta.url),
  'utf8',
);
const confirmDeleteModalSource = await readFile(
  new URL('../src/components/collab/ConfirmDeleteModal.jsx', import.meta.url),
  'utf8',
);

test('counter series rows expose right-click Continue and Delete actions', () => {
  assert.match(appShellSource, /onPointerDown=\{\(e\) => \{\s*if \(e\.button !== 2\) return;/);
  assert.match(appShellSource, /onContextMenu=\{\(e\) => \{\s*e\.preventDefault\(\);/);
  assert.match(appShellSource, /e\.key !== 'ContextMenu'.*e\.shiftKey && e\.key === 'F10'/);
  assert.match(appShellSource, /data-counter-series-context-menu/);
  assert.match(appShellSource, />\s*Continue\s*</);
  assert.match(appShellSource, />\s*Delete\s*</);
  assert.match(appShellSource, /bottomToolbarApi\.onDeleteCounterSeries\?\.\(seriesId\)/);
  assert.match(appShellSource, /bottomToolbarApi\.setActiveTool\?\.\('counter'\)/);
  assert.match(appShellSource, /width: '112px'/);
  assert.match(contextMenuDiagnosticsSource, /suppressed — inside counter series menu/);
  assert.match(contextMenuDiagnosticsSource, /\[data-counter-series-menu\], \[data-counter-series-context-menu\]/);
});

test('viewer publishes atomic whole-series deletion through the toolbar API', () => {
  assert.match(viewerSource, /onDeleteCounterSeries: handleDeleteCounterSeriesFromToolbar/);
  assert.match(viewerSource, /buildCounterSeriesDeletionUpdates\(liveByPage, seriesId\)/);
  assert.match(viewerSource, /type: 'fabric:document-batch'/);
  assert.match(viewerSource, /mode: 'counter-series'/);
  assert.match(viewerSource, /This count changed while confirmation was open/);
  assert.match(viewerSource, /const liveSeriesList = getCounterSeriesList\(liveByPage\)/);
  assert.match(viewerSource, /const remaining = liveSeriesList\.filter/);
  assert.match(viewerSource, /source: 'counter:series-delete'/);
  assert.match(viewerSource, /pushLocalAnnotationHistoryAction\(scopedDocumentAction\)/);
  assert.match(viewerSource, /buildBulkAnnotationDeleteHistoryRows\(\{/);
  assert.match(confirmDeleteModalSource, /Delete \$\{plan\.seriesLabel \|\| 'this count'\}\?/);
  assert.match(confirmDeleteModalSource, /Delete count/);
});
