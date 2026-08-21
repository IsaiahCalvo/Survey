import test from 'node:test';
import assert from 'node:assert/strict';

import { collectEraseDeleteCandidateIds } from '../src/utils/eraseApprovalCandidates.js';

test('collectEraseDeleteCandidateIds includes page-object and text-markup', () => {
  const ids = collectEraseDeleteCandidateIds({
    targets: [
      { domain: 'callout', operation: 'delete', before: { data: { id: 'c1' } } },
      { domain: 'page-object', operation: 'delete', before: { id: 'p1' } },
      { domain: 'text-markup', operation: 'delete', before: { annotationId: 't1' } },
      { domain: 'page-object', operation: 'replace', before: { id: 'keep' } },
      { domain: 'survey-marker', operation: 'delete', before: { id: 's1' } },
    ],
  });
  assert.deepEqual(ids, ['c1', 'p1', 't1']);
});

test('collectEraseDeleteCandidateIds is empty when there are no deletes', () => {
  assert.deepEqual(collectEraseDeleteCandidateIds({ targets: [] }), []);
  assert.deepEqual(collectEraseDeleteCandidateIds(null), []);
});
