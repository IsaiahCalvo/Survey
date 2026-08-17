import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeProjectDocumentOrder,
  orderDocumentsByProject,
} from '../src/home/projectDocumentOrder.js';

test('rehydration reorders within each project without moving cross-project slots', () => {
  const rows = [
    { id: 'a2', project_id: 'a' },
    { id: 'b1', project_id: 'b' },
    { id: 'a1', project_id: 'a' },
  ];
  const restored = orderDocumentsByProject(rows, { a: ['a1', 'a2'] });
  assert.deepEqual(restored.map((row) => row.id), ['a1', 'b1', 'a2']);
});

test('unknown documents retain stable relative order after ranked documents', () => {
  const rows = [
    { id: 'a-new-1', project_id: 'a' },
    { id: 'a2', project_id: 'a' },
    { id: 'a-new-2', project_id: 'a' },
    { id: 'a1', project_id: 'a' },
  ];
  const restored = orderDocumentsByProject(rows, { a: ['a1', 'a2'] });
  assert.deepEqual(restored.map((row) => row.id), ['a1', 'a2', 'a-new-1', 'a-new-2']);
});

test('interleaved project reorder patches merge against the current nested map', () => {
  let preferences = { documentOrderByProject: { untouched: ['u1'] } };
  const patchA = (current) => mergeProjectDocumentOrder(current, 'a', ['a2', 'a1']);
  const patchB = (current) => mergeProjectDocumentOrder(current, 'b', ['b2', 'b1']);
  preferences = patchA(preferences);
  preferences = patchB(preferences);
  assert.deepEqual(preferences.documentOrderByProject, {
    untouched: ['u1'],
    a: ['a2', 'a1'],
    b: ['b2', 'b1'],
  });
});
