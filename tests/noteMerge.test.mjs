import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeNoteEdit } from '../src/utils/noteMerge.js';

test('two notes typed at once are both kept, theirs first', () => {
  assert.deepEqual(mergeNoteEdit({ base: '', theirs: 'Guest: bracket loose', mine: 'Owner: lens dirty' }),
    { text: 'Guest: bracket loose\nOwner: lens dirty', merged: true });
  // Both added to an existing note: the old text once, then each addition.
  assert.deepEqual(mergeNoteEdit({ base: 'Old', theirs: 'Old\nGuest', mine: 'Old owner' }),
    { text: 'Old\nGuest\nowner', merged: true });
});

test('no other change: what was typed is saved; nothing typed: theirs stands', () => {
  assert.deepEqual(mergeNoteEdit({ base: 'a', theirs: 'a', mine: 'ab' }), { text: 'ab', merged: false });
  assert.equal(mergeNoteEdit({ base: 'a', theirs: 'a b', mine: 'a' }), null);
  assert.equal(mergeNoteEdit({ base: '', theirs: 'same', mine: 'same' }), null);
  assert.deepEqual(mergeNoteEdit({ base: '', theirs: 'x', mine: 'x y' }), { text: 'x y', merged: false });
});
