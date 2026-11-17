// KAL-596: the side-by-side screen that links a walk's unlinked Categories.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchCategories } from '../src/suite/walkthruHandoff.js';
import {
  canAddToModule, categoryForPicks, entryIdFor, keepPicks, linkRows, linksToSave, moduleCategories,
  saveCategoryLinks, startingPicks, withCategoryAdded,
} from '../src/suite/categoryLinks.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const template = {
  id: 't1',
  modules: [{
    id: 'm1',
    categories: [
      { id: 'c-cam', name: 'Camera', libraryEntryId: 'e-cam' },
      { id: 'c-door', name: 'Door', libraryEntryId: null },
      { id: 'c-reader', name: 'Card reader' },
      { id: 'c-blank', name: '  ' },
    ],
  }],
};
const nodeTypes = [
  { id: 'nt-cam', name: 'Camera', library_entry_id: 'e-cam' }, // linked
  { id: 'nt-door', name: 'Door' }, // same name
  { id: 'nt-ap', name: 'Access point' }, // nothing
  { id: 'nt-rdr', name: 'Reader' }, // nothing (no near guess)
];
const counts = new Map([['nt-cam', 4], ['nt-door', 2], ['nt-ap', 3], ['nt-rdr', 1]]);

test('only unlinked Categories get a row; linked ones never ask', () => {
  const match = matchCategories(nodeTypes, template, 'm1');
  const rows = linkRows(match, counts);
  assert.deepEqual(rows.map((r) => r.nodeTypeId), ['nt-ap', 'nt-door', 'nt-rdr']);
  assert.equal(rows.find((r) => r.nodeTypeId === 'nt-door').count, 2);
});

test('exact-name matches are filled in, nothing else is', () => {
  const rows = linkRows(matchCategories(nodeTypes, template, 'm1'), counts);
  assert.deepEqual(startingPicks(rows), { 'nt-door': 'c-door' });
});

test('the send uses library matches plus the picks; a skip or a stray id is left out', () => {
  const match = matchCategories(nodeTypes, template, 'm1');
  const picks = { 'nt-door': 'c-door', 'nt-rdr': 'c-reader', 'nt-ap': null, 'nt-x': 'not-a-category' };
  assert.deepEqual(categoryForPicks(match, picks, template, 'm1'), {
    'nt-cam': 'c-cam', 'nt-door': 'c-door', 'nt-rdr': 'c-reader',
  });
});

test('linksToSave lists only rows the user linked, with both names', () => {
  const rows = linkRows(matchCategories(nodeTypes, template, 'm1'), counts);
  assert.deepEqual(linksToSave(rows, { 'nt-door': 'c-door', 'nt-ap': null }, template, 'm1'), [
    { nodeTypeId: 'nt-door', nodeTypeName: 'Door', categoryId: 'c-door', categoryName: 'Door' },
  ]);
  assert.deepEqual(moduleCategories(template, 'm1').map((c) => c.id), ['c-cam', 'c-door', 'c-reader']);
});

test('saving: a Category with no entry is linked through the normal template save first', async () => {
  const calls = [];
  const linked = [{
    ...template,
    modules: [{ ...template.modules[0], categories: template.modules[0].categories.map((c) => ({ ...c, libraryEntryId: c.libraryEntryId || `e-${c.id}` })) }],
  }];
  const out = await saveCategoryLinks({
    links: [
      { nodeTypeId: 'nt-door', nodeTypeName: 'Door', categoryId: 'c-door', categoryName: 'Door' },
      { nodeTypeId: 'nt-cam2', nodeTypeName: 'Cam', categoryId: 'c-cam', categoryName: 'Camera' },
    ],
    templates: [template],
    templateId: 't1',
    moduleId: 'm1',
    linkTemplates: async (list) => { calls.push(['link', list.length]); return linked; },
    saveTemplates: async (list) => { calls.push(['save', list === linked]); },
    flushLibrary: async () => { calls.push(['flush']); },
    entryOnServer: () => true,
    setNodeTypeEntry: async (id, entry) => { calls.push(['set', id, entry]); return { data: [{ id }], error: null }; },
  });
  assert.deepEqual(calls, [
    ['link', 1], ['save', true], ['flush'],
    ['set', 'nt-door', 'e-c-door'], ['set', 'nt-cam2', 'e-cam'],
  ]);
  assert.deepEqual(out.saved.map((l) => l.libraryEntryId), ['e-c-door', 'e-cam']);
  assert.deepEqual(out.notSaved, []);
});

test('saving: no template save when every linked Category has its entry', async () => {
  let saved = false;
  const out = await saveCategoryLinks({
    links: [{ nodeTypeId: 'nt-cam2', categoryId: 'c-cam' }],
    templates: [template], templateId: 't1', moduleId: 'm1',
    linkTemplates: async () => { throw new Error('not called'); },
    saveTemplates: async () => { saved = true; },
    flushLibrary: async () => {},
    entryOnServer: () => true,
    setNodeTypeEntry: async (id) => ({ data: [{ id }], error: null }),
  });
  assert.equal(saved, false);
  assert.equal(out.saved.length, 1);
});

test('saving: offline, refused or unlinkable links are kept for this walk only, with a reason', async () => {
  const base = {
    templates: [template], templateId: 't1', moduleId: 'm1',
    linkTemplates: async (list) => list, saveTemplates: async () => {}, flushLibrary: async () => {},
  };
  const offline = await saveCategoryLinks({
    ...base, links: [{ nodeTypeId: 'a', categoryId: 'c-cam' }],
    entryOnServer: () => false, setNodeTypeEntry: async () => { throw new Error('not called'); },
  });
  assert.match(offline.notSaved[0].reason, /offline/);
  const refused = await saveCategoryLinks({
    ...base, links: [{ nodeTypeId: 'a', categoryId: 'c-cam' }],
    entryOnServer: () => true, setNodeTypeEntry: async () => ({ data: [], error: null }),
  });
  assert.match(refused.notSaved[0].reason, /can’t change/);
  const noEntry = await saveCategoryLinks({
    ...base, links: [{ nodeTypeId: 'a', categoryId: 'c-reader' }],
    entryOnServer: () => true, setNodeTypeEntry: async () => ({ data: [{ id: 'a' }] }),
  });
  assert.match(noEntry.notSaved[0].reason, /not in the library/);
  const saveRefused = await saveCategoryLinks({
    ...base, links: [{ nodeTypeId: 'a', categoryId: 'c-reader' }],
    linkTemplates: async () => [{ ...template }],
    saveTemplates: async () => { throw new Error('Template row does not belong to the signed-in user'); },
    entryOnServer: () => true, setNodeTypeEntry: async () => { throw new Error('not called'); },
  });
  assert.match(saveRefused.notSaved[0].reason, /template could not be saved/);
  assert.equal(entryIdFor([template], 't1', 'm1', 'c-cam'), 'e-cam');
});

test('after saving, the next hand-off matches by library id and does not ask', () => {
  const next = [{ id: 'nt-door', name: 'Door', library_entry_id: 'e-door' }];
  const withEntry = { ...template, modules: [{ ...template.modules[0], categories: [{ id: 'c-door', name: 'Door', libraryEntryId: 'e-door' }] }] };
  const match = matchCategories(next, withEntry, 'm1');
  assert.deepEqual(match.linked, { 'nt-door': 'c-door' });
  assert.deepEqual(linkRows(match, counts), []);
});

test('wired in: the dialog shows the side-by-side rows and Dashboard saves the links', () => {
  const dialog = read('src/home/WalkthruHandoffDialog.jsx');
  const dash = read('src/Dashboard.jsx');
  assert.match(dialog, /data-walkthru-link-table/);
  assert.match(dialog, /fresh \? startingPicks\(rows\) : keepPicks\(prev, rows, template, moduleId\)/);
  assert.match(dialog, /data-walkthru-add-category/);
  assert.match(dash, /onAddCategory=\{addWalkCategoryToModule\}/);
  assert.match(dialog, /onSend\(\{ walk, template, moduleId, categoryFor, links \}\)/);
  assert.match(dash, /saveCategoryLinks\(\{/);
  assert.match(dash, /from\('node_types'\)\s+\.update\(\{ library_entry_id: entryId \}\)\.eq\('id', nodeTypeId\)\.select\('id'\)/);
});

test('"Add Intercom to this Module": one new empty Category, in modules and spaces alike', () => {
  const both = { id: 't2', modules: [{ id: 'm', categories: [{ id: 'c1', name: 'Camera' }] }], spaces: [{ id: 'm', categories: [{ id: 'c1', name: 'Camera' }] }] };
  assert.equal(canAddToModule('Intercom', both, 'm'), true);
  assert.equal(canAddToModule('Camera', both, 'm'), false);
  assert.equal(canAddToModule('Intercom', both, 'nope'), false);
  const out = withCategoryAdded([template, both], 't2', 'm', ' Intercom ', 'c-new');
  assert.equal(out.categoryId, 'c-new');
  assert.deepEqual(out.templates[1].modules[0].categories.at(-1), { id: 'c-new', name: 'Intercom', checklist: [] });
  assert.deepEqual(out.templates[1].spaces[0].categories.at(-1), { id: 'c-new', name: 'Intercom', checklist: [] });
  assert.equal(out.templates[0], template);
  assert.equal(withCategoryAdded([both], 't2', 'm', 'Camera', 'x'), null);
});

test('after a Category is added, choices already made are kept and the new row is linked', () => {
  const rows = [{ nodeTypeId: 'a', suggested: 'c-door' }, { nodeTypeId: 'b', suggested: null }, { nodeTypeId: 'c', suggested: 'c-cam' }];
  const prev = { a: null, b: null, c: 'gone' };
  assert.deepEqual(keepPicks(prev, rows, template, 'm1'), { a: null, b: null, c: 'c-cam' });
  assert.deepEqual(keepPicks({}, rows, template, 'm1'), { a: 'c-door', c: 'c-cam' });
});
