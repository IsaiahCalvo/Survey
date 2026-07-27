import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { isTransportChannelJoined } from '../src/lib/collab/transportStatus.js';

const PDF_VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const SURVEY_RAIL_SOURCE = readFileSync(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');
const YDOC_PROVIDER_SOURCE = readFileSync(
  new URL('../src/components/collab/YDocProvider.jsx', import.meta.url),
  'utf8',
);

test('KAL-436: mode, template, and category transitions do not reset the open PDF', () => {
  const templateHandler = PDF_VIEWER_SOURCE.match(
    /const handleSelectSurveyTemplate = useCallback\(\(template\) => \{([\s\S]*?)\n  \}, \[\]\);/,
  )?.[1] || '';
  assert.match(templateHandler, /setSelectedTemplate\(template\)/);
  assert.match(templateHandler, /setSelectedModuleId\(firstModuleId\)/);
  assert.match(templateHandler, /setSelectedCategoryId\(null\)/);
  assert.match(templateHandler, /setActiveTool\('survey-marker'\)/);
  assert.doesNotMatch(templateHandler, /setPdfDoc|setAnnotationsByPage|clearExcelSyncCheckpoint/);

  const resetEffect = PDF_VIEWER_SOURCE.match(
    /const activePdfChangeIdentity[\s\S]*?useEffect\(\(\) => \{[\s\S]*?\n  \}, \[(.*?)\]\);/,
  )?.[1] || '';
  assert.equal(resetEffect.trim(), 'activePdfChangeIdentity');

  const categoryHandler = SURVEY_RAIL_SOURCE.match(
    /\/\/ Set selected category([\s\S]*?)setActiveTool\('survey-marker'\);/,
  )?.[1] || '';
  assert.match(categoryHandler, /setSelectedCategoryId\(category\.id\)/);
  assert.match(categoryHandler, /setIsSurveyPanelCollapsed\(true\)/);
  assert.doesNotMatch(categoryHandler, /\bawait\b|setPdfDoc|window\.location/);

  const excelHintEffect = PDF_VIEWER_SOURCE.match(
    /\/\/ Live: a content-free post-commit hint[\s\S]*?\n  \}, \[(.*?)\]\);/,
  )?.[1] || '';
  assert.equal(excelHintEffect.trim(), 'pdfFile?.id, user?.id, cloudSyncEnabled');
  assert.match(PDF_VIEWER_SOURCE, /await reconcileExcelSyncRef\.current\?\.\(\)/);
  assert.match(
    PDF_VIEWER_SOURCE,
    /selectedTemplate\?\.supabaseId,[\s\S]*?selectedTemplate\?\.id,[\s\S]*?\]\);/,
  );
});

test('KAL-436: joined-channel reconciliation rejects stale offline status', () => {
  assert.equal(isTransportChannelJoined({ getChannel: () => ({ state: 'joined' }) }), true);
  assert.equal(isTransportChannelJoined({ getChannel: () => ({ state: 'joining' }) }), false);
  assert.equal(isTransportChannelJoined({ getChannel: () => ({ state: 'closed' }) }), false);
  assert.equal(isTransportChannelJoined({ getChannel: () => { throw new Error('gone'); } }), false);

  assert.match(
    YDOC_PROVIDER_SOURCE,
    /if \(isTransportChannelJoined\(providerRef\.current\)\) \{[\s\S]*?markTransportOnline\(\);/,
  );

  const retryBranch = YDOC_PROVIDER_SOURCE.match(
    /if \(storageState\.code === 'transport_offline'\) \{([\s\S]*?)\n            \} else if/,
  )?.[1] || '';
  assert.match(retryBranch, /handleTransportRetry\(\)/);
  assert.doesNotMatch(retryBranch, /window\.location\.reload|disconnect/);
  assert.match(YDOC_PROVIDER_SOURCE, /TRANSPORT_RETRY_RESULT_TIMEOUT_MS = 5000/);
  assert.match(YDOC_PROVIDER_SOURCE, /setTransportRetryError\(TRANSPORT_RETRY_ERROR\)/);
  assert.match(
    YDOC_PROVIDER_SOURCE,
    /statusDetail=\{[\s\S]*?transportRetryError[\s\S]*?\}/,
  );
});
