import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMarkerEntityFromName } from '../surveyMarkerEntityResolver.js';

const ENTITIES = [
  { id: 'e-gc', name: 'GC', color: '#800080' },
  { id: 'e-x', name: 'X', color: '#00AA00' },
];

test('resolveMarkerEntityFromName: resolves id + color from a known entity name', () => {
  const out = resolveMarkerEntityFromName({ entityName: 'X', entityId: 'e-gc', entityColor: '#800080' }, ENTITIES);
  assert.equal(out.entityId, 'e-x');
  assert.equal(out.entityName, 'X');
  assert.equal(out.entityColor, '#00AA00');
});

test('resolveMarkerEntityFromName: idempotent when already resolved (returns same ref)', () => {
  const marker = { entityName: 'GC', entityId: 'e-gc', entityColor: '#800080' };
  const out = resolveMarkerEntityFromName(marker, ENTITIES);
  assert.equal(out, marker, 'no change → returns the same object');
});

test('resolveMarkerEntityFromName: empty name clears the entity triple', () => {
  const out = resolveMarkerEntityFromName({ entityName: '', entityId: 'e-gc', entityColor: '#800080' }, ENTITIES);
  assert.equal(out.entityId, null);
  assert.equal(out.entityName, null);
  assert.equal(out.entityColor, null);
});

test('resolveMarkerEntityFromName: already-empty triple with empty name is untouched (same ref)', () => {
  const marker = { entityName: null, entityId: null, entityColor: null };
  const out = resolveMarkerEntityFromName(marker, ENTITIES);
  assert.equal(out, marker);
});

test('resolveMarkerEntityFromName: unknown name is left as-is (same ref)', () => {
  const marker = { entityName: 'Zzz', entityId: 'e-gc', entityColor: '#800080' };
  const out = resolveMarkerEntityFromName(marker, ENTITIES);
  assert.equal(out, marker);
});

test('resolveMarkerEntityFromName: marker without entityName field passes through', () => {
  const marker = { foo: 'bar' };
  assert.equal(resolveMarkerEntityFromName(marker, ENTITIES), marker);
});

test('resolveMarkerEntityFromName: nullish / non-object marker passes through', () => {
  assert.equal(resolveMarkerEntityFromName(null, ENTITIES), null);
  assert.equal(resolveMarkerEntityFromName(undefined, ENTITIES), undefined);
});

test('resolveMarkerEntityFromName: missing/empty entities list → unknown name left as-is', () => {
  const marker = { entityName: 'X', entityId: 'old', entityColor: '#111' };
  assert.equal(resolveMarkerEntityFromName(marker, []), marker);
  assert.equal(resolveMarkerEntityFromName(marker, undefined), marker);
});

test('resolveMarkerEntityFromName: does not mutate the input marker', () => {
  const marker = { entityName: 'X', entityId: 'e-gc', entityColor: '#800080' };
  resolveMarkerEntityFromName(marker, ENTITIES);
  assert.equal(marker.entityId, 'e-gc', 'original untouched');
});
