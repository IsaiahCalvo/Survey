import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const viewerSource = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const confirmDeleteModalSource = await readFile(
  new URL('../src/components/collab/ConfirmDeleteModal.jsx', import.meta.url),
  'utf8',
);

// Actual desktop and touch actions are exercised in counter-series-menu.spec.mjs.

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
