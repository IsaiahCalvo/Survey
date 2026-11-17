// KAL-618: a template Category carries Category Types, linked to the library.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LIBRARY_KIND,
  LIBRARY_SCOPE,
  categoryTypesOf,
  linkTemplateCategories,
  newCategoryTypeProblem,
  newLibraryEntry,
} from '../src/library/libraryModel.js';

const ME = 'user-me';
const minter = () => { let n = 0; return () => `new-${++n}`; };
const tpl = (category) => [{ id: 't1', modules: [{ id: 'm1', categories: [category] }] }];

test('types: a new Category and its Types all get library entries, Types under the Category', () => {
  const { templates, created } = linkTemplateCategories(
    tpl({ id: 'c1', name: 'Camera', types: [{ id: 'a', name: 'PTZ' }, { id: 'b', name: 'Fisheye' }] }),
    { userId: ME, mintId: minter() },
  );
  const category = templates[0].modules[0].categories[0];
  assert.equal(created.length, 3);
  const [camera, ptz, fisheye] = created;
  assert.equal(camera.kind, LIBRARY_KIND.CATEGORY);
  assert.equal(category.libraryEntryId, camera.id);
  for (const [type, entry] of [[category.types[0], ptz], [category.types[1], fisheye]]) {
    assert.equal(entry.kind, LIBRARY_KIND.CATEGORY_TYPE);
    assert.equal(entry.parentId, camera.id);
    assert.equal(entry.scope, LIBRARY_SCOPE.MINE);
    assert.equal(type.libraryEntryId, entry.id);
  }
});

test('types: a Type links to the entry with exactly its name under the same Category, never a near one', () => {
  const camera = newLibraryEntry({ id: 'cam', name: 'Camera', userId: ME });
  const door = newLibraryEntry({ id: 'door', name: 'Door', userId: ME });
  const ptz = newLibraryEntry({ id: 'ptz', kind: LIBRARY_KIND.CATEGORY_TYPE, parentId: 'cam', name: 'PTZ', userId: ME });
  const doorPtz = newLibraryEntry({ id: 'door-ptz', kind: LIBRARY_KIND.CATEGORY_TYPE, parentId: 'door', name: 'PTZ 2', userId: ME });
  const { templates, created } = linkTemplateCategories(
    tpl({ id: 'c1', name: 'Camera', libraryEntryId: 'cam', types: [{ id: 'a', name: ' PTZ ' }, { id: 'b', name: 'PTZ 2' }] }),
    { entries: [camera, door, ptz, doorPtz], userId: ME, mintId: minter() },
  );
  const [a, b] = templates[0].modules[0].categories[0].types;
  assert.equal(a.libraryEntryId, 'ptz');
  assert.equal(created.length, 1);
  assert.equal(created[0].parentId, 'cam');
  assert.equal(b.libraryEntryId, created[0].id);
});

test('types: in a Company library Category, new Types go to that company library', () => {
  const camera = newLibraryEntry({ id: 'cam', name: 'Camera', scope: LIBRARY_SCOPE.COMPANY, companyId: 'org-1', userId: 'someone' });
  const { created } = linkTemplateCategories(
    tpl({ id: 'c1', name: 'Camera', libraryEntryId: 'cam', types: [{ id: 'a', name: 'PTZ' }] }),
    { entries: [camera], userId: ME, company: { id: 'org-1', role: 'member' }, mintId: minter() },
  );
  assert.equal(created[0].scope, LIBRARY_SCOPE.COMPANY);
  assert.equal(created[0].companyId, 'org-1');
});

test('types: a Category whose entry is not loaded waits, and linked Types are left alone', () => {
  const start = tpl({ id: 'c1', name: 'Camera', libraryEntryId: 'not-here', types: [{ id: 'a', name: 'PTZ' }] });
  const waiting = linkTemplateCategories(start, { userId: ME, mintId: minter() });
  assert.equal(waiting.templates[0], start[0]);
  assert.equal(waiting.created.length, 0);

  const camera = newLibraryEntry({ id: 'cam', name: 'Camera', userId: ME });
  const linked = tpl({ id: 'c1', name: 'Camera', libraryEntryId: 'cam', types: [{ id: 'a', name: 'PTZ', libraryEntryId: 'kept' }] });
  const again = linkTemplateCategories(linked, { entries: [camera], userId: ME, mintId: minter() });
  assert.equal(again.templates[0], linked[0]);
});

test('types: the list a Category holds is clean, and a repeat or blank name is refused in words', () => {
  const category = { types: [{ id: 'a', name: '  PTZ ' }, { id: 'b', name: 'ptz' }, { id: 'c', name: '' }, null, { name: 'No id' }, { id: 'd', name: 'Dome', libraryEntryId: 'x' }] };
  assert.deepEqual(categoryTypesOf(category), [{ id: 'a', name: 'PTZ' }, { id: 'd', name: 'Dome', libraryEntryId: 'x' }]);
  assert.deepEqual(categoryTypesOf({}), []);
  assert.equal(newCategoryTypeProblem(category, 'Fisheye'), '');
  assert.match(newCategoryTypeProblem(category, ' dome '), /already a Type/);
  assert.equal(newCategoryTypeProblem(category, '   '), 'Give it a name.');
});
