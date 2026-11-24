import test from 'node:test';
import assert from 'node:assert/strict';
import { profileNameParts } from '../src/components/profileNameParts.js';

test('first and last name win when saved', () => {
  assert.deepEqual(profileNameParts({ first_name: 'Ava', last_name: 'Tester', full_name: 'Someone Else' }), { first: 'Ava', last: 'Tester' });
});

test('a Google-style full name is split: first word, then the rest', () => {
  assert.deepEqual(profileNameParts({ full_name: 'Mary Ann  van Dyke' }), { first: 'Mary', last: 'Ann van Dyke' });
  assert.deepEqual(profileNameParts({ name: 'Dee Tester' }), { first: 'Dee', last: 'Tester' });
});

test('a single name fills only the first name; nothing gives blanks', () => {
  assert.deepEqual(profileNameParts({ full_name: 'Cher' }), { first: 'Cher', last: '' });
  assert.deepEqual(profileNameParts({}), { first: '', last: '' });
  assert.deepEqual(profileNameParts(null), { first: '', last: '' });
});
