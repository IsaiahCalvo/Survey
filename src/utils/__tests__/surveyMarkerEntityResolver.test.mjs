import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMarkerEntityFromName } from '../surveyMarkerEntityResolver.js';

const entities = [
  { id: 'e-gc', name: 'GC', color: '#800080' },
  { id: 'e-x', name: 'X', color: '#00AA00' },
];

test('survey marker entity resolver updates the coupled id/name/color fields', () => {
  const input = { entityName: 'X', entityId: 'e-gc', entityColor: '#800080' };
  const output = resolveMarkerEntityFromName(input, entities);
  assert.deepEqual(output, { entityName: 'X', entityId: 'e-x', entityColor: '#00AA00' });
  assert.equal(input.entityId, 'e-gc');
});

test('survey marker entity resolver clears an empty entity and preserves unknown names', () => {
  assert.deepEqual(
    resolveMarkerEntityFromName({ entityName: '', entityId: 'e-gc', entityColor: '#800080' }, entities),
    { entityName: null, entityId: null, entityColor: null },
  );
  const unknown = { entityName: 'Unknown', entityId: 'old', entityColor: '#111' };
  assert.equal(resolveMarkerEntityFromName(unknown, entities), unknown);
});

test('survey marker entity resolver is idempotent and defensive', () => {
  const resolved = { entityName: 'GC', entityId: 'e-gc', entityColor: '#800080' };
  assert.equal(resolveMarkerEntityFromName(resolved, entities), resolved);
  assert.equal(resolveMarkerEntityFromName(null, entities), null);
});
