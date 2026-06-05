import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePreservingImportedMarks } from '../src/utils/safeSnapshot.js';

const imported = (id) => ({ id, isPdfImported: true, type: 'path' });
const userMark = (id) => ({ id, type: 'rect' });

test('empty cloud does not wipe imported marks', () => {
  const prev = { 6: { objects: [imported('a'), imported('b')] }, 7: { objects: [imported('c')] } };
  const out = mergePreservingImportedMarks(prev, {});
  assert.equal(out[6].objects.length, 2);
  assert.equal(out[7].objects.length, 1);
});

test('partial cloud preserves imported marks the cloud lacks', () => {
  const prev = { 6: { objects: [imported('a')] }, 8: { objects: [imported('z')] } };
  const incoming = { 6: { objects: [userMark('u1')] } }; // cloud only has page 6, user mark
  const out = mergePreservingImportedMarks(prev, incoming);
  assert.equal(out[6].objects.length, 2, 'keeps cloud user mark + preserved imported');
  assert.equal(out[8].objects.length, 1, 'page 8 imported mark survives');
});

test('no duplication when cloud already has the imported mark by id', () => {
  const prev = { 6: { objects: [imported('a')] } };
  const incoming = { 6: { objects: [imported('a')] } };
  const out = mergePreservingImportedMarks(prev, incoming);
  assert.equal(out[6].objects.length, 1);
});

test('returns incoming identity unchanged when nothing to preserve', () => {
  const prev = { 6: { objects: [userMark('u')] } }; // no imported marks
  const incoming = { 6: { objects: [userMark('v')] } };
  const out = mergePreservingImportedMarks(prev, incoming);
  assert.equal(out, incoming, 'same reference — no churn in the common case');
});

test('null/empty prev is safe', () => {
  const incoming = { 1: { objects: [] } };
  assert.equal(mergePreservingImportedMarks(null, incoming), incoming);
  assert.equal(mergePreservingImportedMarks({}, incoming), incoming);
});
