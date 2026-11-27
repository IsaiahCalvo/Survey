import test from 'node:test';
import assert from 'node:assert/strict';

import { historyActorName } from '../src/utils/historyFeed.js';
import { buildSurveyMarkerUpdateHistoryRow } from '../src/services/surveyMarkerHistory.js';
import { getDocumentOpenKey, isSameDocumentTab } from '../src/utils/documentTabIdentity.js';

test('#1800: historyActorName extracts actor name for set/updated/cleared verbs and structured payload.actorName', () => {
  const statusRow = buildSurveyMarkerUpdateHistoryRow({
    markerId: 'm-1',
    marker: { name: 'Node 2', pageNumber: 1 },
    documentId: 'doc-1',
    userId: 'u-1',
    actorName: 'Grok Tester',
    change: 'set status to done',
  });
  assert.equal(statusRow.payload.actorName, 'Grok Tester');
  assert.equal(historyActorName(statusRow), 'Grok Tester');

  // Legacy rows without payload.actorName must still parse all marker update verbs.
  assert.equal(
    historyActorName({ summary: 'Grok Tester set status to done on Survey Marker "Node 2"' }),
    'Grok Tester',
  );
  assert.equal(
    historyActorName({ summary: 'Grok Tester updated note on Survey Marker "Node 2"' }),
    'Grok Tester',
  );
  assert.equal(
    historyActorName({ summary: 'Grok Tester cleared note on Survey Marker "Node 2"' }),
    'Grok Tester',
  );
  assert.equal(
    historyActorName({ summary: 'Grok Tester updated assignee on Survey Marker "Node 2"' }),
    'Grok Tester',
  );
  assert.equal(
    historyActorName({ summary: 'Grok Tester cleared due date on Survey Marker "Node 2"' }),
    'Grok Tester',
  );
});

test('#1802: same-named PDFs in different projects never reuse each other\'s open tab', () => {
  const restoredTabMissingFileId = {
    id: 'tab-1',
    documentId: 'doc-proj-a',
    projectId: 'proj-a',
    file: { name: 'Pass222 Camden Academy QA.pdf', size: 12345, lastModified: 1000 },
  };
  const incomingSameNameOtherProject = {
    id: 'doc-proj-b',
    projectId: 'proj-b',
    name: 'Pass222 Camden Academy QA.pdf',
    size: 12345,
    lastModified: 1000,
  };
  const incomingNoIdOtherProject = {
    project_id: 'proj-b',
    name: 'Pass222 Camden Academy QA.pdf',
    size: 12345,
    lastModified: 1000,
  };
  const incomingSameDocId = {
    id: 'doc-proj-a',
    projectId: 'proj-a',
    name: 'Pass222 Camden Academy QA.pdf',
    size: 12345,
    lastModified: 1000,
  };

  assert.equal(isSameDocumentTab(restoredTabMissingFileId, incomingSameNameOtherProject), false);
  assert.equal(isSameDocumentTab(restoredTabMissingFileId, incomingNoIdOtherProject), false);
  assert.equal(isSameDocumentTab(restoredTabMissingFileId, incomingSameDocId), true);

  // Even with no document IDs on either side, different projectIds must not collide.
  const tabNoIdProjA = {
    id: 'tab-2',
    file: { name: 'Plan.pdf', size: 500, lastModified: 1000, projectId: 'proj-a' },
  };
  const fileNoIdProjB = { name: 'Plan.pdf', size: 500, lastModified: 1000, projectId: 'proj-b' };
  assert.equal(isSameDocumentTab(tabNoIdProjA, fileNoIdProjB), false);
  assert.notEqual(getDocumentOpenKey(tabNoIdProjA.file), getDocumentOpenKey(fileNoIdProjB));
});
