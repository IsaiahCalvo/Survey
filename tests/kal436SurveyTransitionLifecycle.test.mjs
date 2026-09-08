import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTransportProviderCoordinator,
  hasRemoteDocumentCollaborator,
  isTransportChannelJoined,
  recreateTransportProvider,
} from '../src/lib/collab/transportStatus.js';

const PDF_VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const SURVEY_RAIL_SOURCE = readFileSync(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');
const YDOC_PROVIDER_SOURCE = readFileSync(
  new URL('../src/components/collab/YDocProvider.jsx', import.meta.url),
  'utf8',
);
const YDOC_SESSION_SOURCE = readFileSync(
  new URL('../src/lib/collab/legacyYDocSession.js', import.meta.url),
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
    /restartTransportProviderRef\.current = installTransportProvider/,
  );
  assert.match(
    YDOC_PROVIDER_SOURCE,
    /attachLegacyYDocSession\(\{\s*ydoc, documentId: docId, actorUserId, supabase,/,
  );
  assert.match(
    YDOC_PROVIDER_SOURCE,
    /const installTransportProvider = \(\) => handle\.restartTransport\(\);/,
  );
  // Retry still uses the same provider coordinator; ownership moved into the
  // actor-bound session so an old account cannot restart a channel.
  assert.match(
    YDOC_SESSION_SOURCE,
    /createTransportProviderCoordinator\(\{\s*getCurrentProvider: \(\) => provider,\s*setCurrentProvider: \(next\) => \{ provider = next; \},\s*createProvider:/,
  );
  assert.match(
    YDOC_SESSION_SOURCE,
    /restartTransport: \(\) => isCurrent\(\) \? coordinator\.restart\(\) : Promise\.resolve\(null\)/,
  );
  assert.match(
    YDOC_PROVIDER_SOURCE,
    /if \(transportRetryInFlightRef\.current\) \{[\s\S]*?return transportRetryInFlightRef\.current/,
  );
  assert.match(
    YDOC_PROVIDER_SOURCE,
    /statusDetail=\{[\s\S]*?transportRetryError[\s\S]*?\}/,
  );
});

test('KAL-436: Retry replaces a hard-closed provider with a newly subscribed provider', async () => {
  const calls = [];
  const closedProvider = {
    getChannel: () => ({ state: 'closed' }),
    disconnect: () => calls.push('disconnect-closed'),
  };
  const joinedProvider = {
    getChannel: () => ({ state: 'joined' }),
    disconnect: () => calls.push('disconnect-joined'),
  };

  const replacement = await recreateTransportProvider({
    currentProvider: closedProvider,
    createProvider: async () => {
      calls.push('create-and-subscribe');
      return joinedProvider;
    },
  });

  assert.equal(replacement, joinedProvider);
  assert.equal(isTransportChannelJoined(replacement), true);
  assert.deepEqual(calls, ['disconnect-closed', 'create-and-subscribe']);
});

test('KAL-436: failed provider recreation leaves no dead provider presented as healthy', async () => {
  let disconnected = false;
  await assert.rejects(
    recreateTransportProvider({
      currentProvider: {
        disconnect: () => { disconnected = true; },
      },
      createProvider: async () => {
        throw new Error('subscribe failed');
      },
    }),
    /subscribe failed/,
  );
  assert.equal(disconnected, true);
});

test('KAL-436: rapid Retry clicks share one provider restart', async () => {
  let resolveProvider;
  let createCount = 0;
  const current = {
    value: {
      disconnect() {},
    },
  };
  const coordinator = createTransportProviderCoordinator({
    getCurrentProvider: () => current.value,
    setCurrentProvider: (provider) => { current.value = provider; },
    createProvider: () => {
      createCount += 1;
      return new Promise((resolve) => { resolveProvider = resolve; });
    },
  });

  const firstRetry = coordinator.restart();
  const secondRetry = coordinator.restart();
  assert.equal(createCount, 1, 'a second click must not create another realtime channel');

  const joinedProvider = {
    getChannel: () => ({ state: 'joined' }),
    disconnect() {},
  };
  resolveProvider(joinedProvider);

  assert.equal(await firstRetry, joinedProvider);
  assert.equal(await secondRetry, joinedProvider);
  assert.equal(current.value, joinedProvider);
});

test('KAL-436: reordered provider attempts disconnect the stale candidate and keep the newest', async () => {
  const deferred = [];
  const disconnected = [];
  const originalProvider = {
    name: 'original',
    disconnect: () => disconnected.push('original'),
  };
  const current = { value: originalProvider };
  const coordinator = createTransportProviderCoordinator({
    getCurrentProvider: () => current.value,
    setCurrentProvider: (provider) => { current.value = provider; },
    createProvider: ({ attempt }) => new Promise((resolve) => {
      deferred.push({ attempt, resolve });
    }),
  });

  const olderAttempt = coordinator.replace();
  const newerAttempt = coordinator.replace();
  assert.equal(deferred.length, 2);

  const newerProvider = {
    name: 'newer',
    disconnect: () => disconnected.push('newer'),
  };
  deferred[1].resolve(newerProvider);
  assert.equal(await newerAttempt, newerProvider);
  assert.equal(current.value, newerProvider);

  const staleProvider = {
    name: 'stale',
    disconnect: () => disconnected.push('stale'),
  };
  deferred[0].resolve(staleProvider);
  assert.equal(await olderAttempt, null);
  assert.equal(current.value, newerProvider);
  assert.deepEqual(disconnected, ['original', 'original', 'stale']);
});

test('KAL-436: owner plus exactly one collaborator is recognized as shared', () => {
  assert.equal(hasRemoteDocumentCollaborator({
    activeCollaboratorUserIds: ['editor-id'],
    currentUserId: 'owner-id',
    currentRole: 'owner',
  }), true);
});

test('KAL-436: the sole collaborator still recognizes the row-less owner as remote', () => {
  assert.equal(hasRemoteDocumentCollaborator({
    activeCollaboratorUserIds: ['editor-id'],
    currentUserId: 'editor-id',
    currentRole: 'editor',
  }), true);
  assert.equal(hasRemoteDocumentCollaborator({
    activeCollaboratorUserIds: ['owner-id'],
    currentUserId: 'owner-id',
    currentRole: 'owner',
  }), false);
});
