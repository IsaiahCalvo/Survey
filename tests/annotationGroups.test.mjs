import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateGroupId,
  getAnnotationGroupId,
  getCalloutGroupId,
  findGroupMembers,
  applyAnnotationGroupId,
} from '../src/utils/annotationGroups.js';

test('group id helpers read annotation and callout ids', () => {
  assert.match(generateGroupId(), /^grp-/);
  assert.equal(getAnnotationGroupId({ data: { groupId: 'g1' } }), 'g1');
  assert.equal(getAnnotationGroupId({ data: { groupId: '' } }), null);
  assert.equal(getCalloutGroupId({ groupId: 'g2' }), 'g2');
  assert.equal(getCalloutGroupId({}), null);
});

test('findGroupMembers collects matching annotation indices and callout ids', () => {
  const page = {
    objects: [
      { data: { groupId: 'g1' } },
      { data: {} },
      { data: { groupId: 'g1' } },
    ],
  };
  const callouts = [
    { id: 'c1', groupId: 'g1' },
    { id: 'c2', groupId: 'g2' },
  ];
  assert.deepEqual(findGroupMembers(page, callouts, ['g1']), {
    annotationIndices: [0, 2],
    calloutIds: ['c1'],
  });
  assert.deepEqual(findGroupMembers(page, callouts, []), {
    annotationIndices: [],
    calloutIds: [],
  });
});

test('applyAnnotationGroupId clones and sets/clears group ids', () => {
  const page = { objects: [{ data: { groupId: 'old' } }, { id: 'bare' }] };
  const grouped = applyAnnotationGroupId(page, [0, 1], 'g9');
  assert.notEqual(grouped, page);
  assert.equal(grouped.objects[0].data.groupId, 'g9');
  assert.equal(grouped.objects[1].data.groupId, 'g9');
  const cleared = applyAnnotationGroupId(grouped, [0], null);
  assert.equal('groupId' in cleared.objects[0].data, false);
  assert.equal(applyAnnotationGroupId(null, [0], 'g'), null);
});
