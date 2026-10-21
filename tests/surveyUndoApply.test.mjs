// The shared surgical undo-apply (supabase/functions/_shared/surveyUndoApply.js)
// is the ONE copy that both survey-mcp's undo_change tool and the person-side
// survey-undo function run, so these cover the reversal semantics for both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyUndoDescriptor, noteObjectOf, UNDO_KINDS } from '../supabase/functions/_shared/surveyUndoApply.js';

const D = 'e2e00000-0000-4000-8000-000000000abc';

test('answers: restores only the keys the change set, leaving others', () => {
  const markers = {
    m1: { id: 'm1', checklistResponses: {
      a: { selection: 'N' }, // this change set a: was unset before (null)
      b: { selection: 'Y' }, // untouched by the change
      c: { selection: 'N' }, // this change set c: was 'Y' before
    } },
  };
  applyUndoDescriptor(markers, { v: 1, d: D, m: 'm1', kind: 'answers', keys: { a: null, c: { selection: 'Y' } } });
  assert.equal(markers.m1.checklistResponses.a, undefined, 'a was unset before → removed');
  assert.deepEqual(markers.m1.checklistResponses.b, { selection: 'Y' }, 'b untouched');
  assert.deepEqual(markers.m1.checklistResponses.c, { selection: 'Y' }, 'c restored to prior');
});

test('answers: a later edit to a DIFFERENT answer survives the undo', () => {
  // The change set only `a`; afterwards the person set `z`. Undo must keep z.
  const markers = { m1: { id: 'm1', checklistResponses: { a: { selection: 'N' }, z: { selection: 'Y' } } } };
  applyUndoDescriptor(markers, { v: 1, d: D, m: 'm1', kind: 'answers', keys: { a: null } });
  assert.equal(markers.m1.checklistResponses.a, undefined);
  assert.deepEqual(markers.m1.checklistResponses.z, { selection: 'Y' }, 'the later, unrelated edit stays');
});

test('note_append: strips just the appended segment when the note still ends with it', () => {
  const markers = { m1: { id: 'm1', note: { text: 'Original line\nAgent added this', media: [{ u: 1 }] } } };
  applyUndoDescriptor(markers, { v: 1, d: D, m: 'm1', kind: 'note_append', seg: '\nAgent added this' });
  assert.equal(markers.m1.note.text, 'Original line', 'appended segment removed');
  assert.deepEqual(markers.m1.note.media, [{ u: 1 }], 'media kept');
});

test('note_append: a note edited since (no longer ending with the segment) is left alone', () => {
  const markers = { m1: { id: 'm1', note: { text: 'Original\nAgent added this\nthen I typed more' } } };
  applyUndoDescriptor(markers, { v: 1, d: D, m: 'm1', kind: 'note_append', seg: '\nAgent added this' });
  assert.equal(markers.m1.note.text, 'Original\nAgent added this\nthen I typed more', 'untouched');
});

test('entity: restores id, name and colour together; null means it was unset', () => {
  const was = { v: 1, d: D, m: 'm1', kind: 'entity', b: { entityId: null, entityName: null, entityColor: null } };
  const markers = { m1: { id: 'm1', entityId: 'e9', entityName: 'Installed', entityColor: '#0a0' } };
  applyUndoDescriptor(markers, was);
  assert.equal(markers.m1.entityId, undefined);
  assert.equal(markers.m1.entityName, undefined);
  assert.equal(markers.m1.entityColor, undefined);
});

test('entity: restores a prior non-null status', () => {
  const markers = { m1: { id: 'm1', entityId: 'e9', entityName: 'New', entityColor: '#0a0' } };
  applyUndoDescriptor(markers, { v: 1, d: D, m: 'm1', kind: 'entity', b: { entityId: 'e1', entityName: 'Old', entityColor: '#a00' } });
  assert.equal(markers.m1.entityId, 'e1');
  assert.equal(markers.m1.entityName, 'Old');
  assert.equal(markers.m1.entityColor, '#a00');
});

test('create: undo deletes the marker the change added', () => {
  const markers = { m1: { id: 'm1' }, made: { id: 'made' } };
  applyUndoDescriptor(markers, { v: 1, d: D, m: 'made', kind: 'create' });
  assert.equal(markers.made, undefined);
  assert.ok(markers.m1, 'other markers untouched');
});

test('a marker already gone is a no-op (not a throw)', () => {
  const markers = {};
  assert.doesNotThrow(() => applyUndoDescriptor(markers, { v: 1, d: D, m: 'gone', kind: 'answers', keys: { a: null } }));
  assert.deepEqual(markers, {});
});

test('an unknown kind throws (a malformed descriptor is a loud failure)', () => {
  assert.throws(() => applyUndoDescriptor({ m1: { id: 'm1' } }, { v: 1, d: D, m: 'm1', kind: 'nonsense' }), /Unknown undo kind/);
});

test('UNDO_KINDS names exactly the four reversible kinds', () => {
  assert.deepEqual([...UNDO_KINDS].sort(), ['answers', 'create', 'entity', 'note_append']);
});

test('noteObjectOf normalises string, JSON-string and object notes', () => {
  assert.deepEqual(noteObjectOf('plain'), { text: 'plain' });
  assert.deepEqual(noteObjectOf('{"text":"hi","media":[1]}'), { text: 'hi', media: [1] });
  assert.deepEqual(noteObjectOf({ text: 'o', x: 1 }), { text: 'o', x: 1 });
  assert.deepEqual(noteObjectOf(null), {});
});
