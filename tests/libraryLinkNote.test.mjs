// KAL-752: the Library banner said template Categories were "not in the
// library yet" when the library already listed them by the same name. It now
// says "link" for those and keeps "add" for names that are really new.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { newLibraryEntry, unlinkedCategorySummary, unlinkedNoteFor } from '../src/library/libraryModel.js';

const ME = 'user-me';
const template = (names) => ({ id: 't1', modules: [{ id: 'm1', categories: names.map((name, i) => ({ id: `c${i}`, name })) }] });
const entry = (name) => newLibraryEntry({ id: `e-${name}`, name, userId: ME, now: '2026-11-17T00:00:00Z' });

test('names already in my library count as in the library', () => {
  const s = unlinkedCategorySummary([template(['Camera', 'Door'])], { entries: [entry('Camera'), entry('Door'), entry('WAP')], userId: ME });
  assert.deepEqual(s, { total: 2, inLibrary: 2 });
  assert.deepEqual(unlinkedNoteFor(s), { text: '2 Categories in your templates are in the library but not linked to it yet.', action: 'Link them' });
});

test('new names say add, and a mix says add and link', () => {
  assert.deepEqual(unlinkedNoteFor(unlinkedCategorySummary([template(['Reader'])], { entries: [entry('Camera')], userId: ME })), { text: '1 Category in your templates is not in the library yet.', action: 'Add it' });
  const mix = unlinkedCategorySummary([template(['Camera', 'Reader', 'Lock'])], { entries: [entry('Camera')], userId: ME });
  assert.deepEqual(mix, { total: 3, inLibrary: 1 });
  assert.equal(unlinkedNoteFor(mix).text, '3 Categories in your templates are not linked to the library yet. 2 of them are new.');
  assert.equal(unlinkedNoteFor(mix).action, 'Add and link');
});

test('linked, shared and placeholder Categories are not counted', () => {
  const t = { id: 't', modules: [{ categories: [{ name: 'Camera', libraryEntryId: 'e1' }, { name: '' }] }] };
  const shared = { ...template(['Door']), sharedFrom: 'someone' };
  assert.deepEqual(unlinkedCategorySummary([t, shared], { entries: [], userId: ME }), { total: 0, inLibrary: 0 });
});

test('the Library screen uses the note, not fixed words', () => {
  const src = readFileSync(new URL('../src/library/LibraryScreen.jsx', import.meta.url), 'utf8');
  assert.match(src, /unlinkedNoteFor\(unlinkedSummary\)/);
  assert.doesNotMatch(src, /are not in the library yet/);
});
