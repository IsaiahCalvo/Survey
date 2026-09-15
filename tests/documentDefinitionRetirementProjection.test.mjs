import test from 'node:test';
import assert from 'node:assert/strict';
import { projectDocumentDefinitionForNewUse } from '../src/services/documentDefinitionRetirement.js';

const deepFreeze = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const makeReceipt = ({ modules, entities, archives = [] }) => deepFreeze({
  status: 'accepted',
  surveyDefinition: { modules },
  entityCatalog: { entities },
  archivedSemanticIds: archives,
});

const fullReceipt = () => makeReceipt({
  modules: [
    { id: 'shared:id', name: 'First active module', categories: [
      { id: 'shared:id', name: 'Retired category', checklist: [
        { id: 'under:retired-category', text: 'Must not be offered' },
      ] },
      { id: 'active:category', name: 'Active category', checklist: [
        { id: 'active:item', text: 'First active item' },
        { id: 'retired:item', text: 'Retired item' },
        { id: 'active:item:two', text: 'Second active item' },
      ] },
    ] },
    { id: 'retired:module', name: 'Retired module', categories: [
      { id: 'under:retired-module', name: 'Hidden child category', checklist: [
        { id: 'under:retired-module:item', text: 'Hidden child item' },
      ] },
    ] },
    { id: 'last:module', name: 'Last active module', categories: [] },
  ],
  entities: [
    { id: 'active:entity', name: 'First active entity', color: '#112233', opacity: 0.35,
      borderColor: null, borderOpacity: null, matchFill: false },
    { id: 'shared:id', name: 'Retired entity', color: '#445566', opacity: 0.5,
      borderColor: '#778899', borderOpacity: 0.75, matchFill: true },
    { id: 'active:entity:two', name: 'Second active entity', color: '#abcdef', opacity: 1,
      borderColor: null, borderOpacity: null, matchFill: false },
  ],
  archives: [
    { kind: 'module', id: 'retired:module' },
    { kind: 'category', id: 'shared:id' },
    { kind: 'checklistItem', id: 'retired:item' },
    { kind: 'entity', id: 'shared:id' },
  ],
});

test('projection excludes all retired kinds and descendants while keeping active order and labels', () => {
  const canonical = fullReceipt();
  const before = JSON.stringify(canonical);
  const projected = projectDocumentDefinitionForNewUse(canonical);

  assert.deepEqual(projected.modules, [
    { id: 'shared:id', name: 'First active module', categories: [
      { id: 'active:category', name: 'Active category', checklist: [
        { id: 'active:item', text: 'First active item' },
        { id: 'active:item:two', text: 'Second active item' },
      ] },
    ] },
    { id: 'last:module', name: 'Last active module', categories: [] },
  ]);
  assert.deepEqual(projected.entities, [
    { id: 'active:entity', name: 'First active entity', color: '#112233', opacity: 0.35,
      borderColor: null, borderOpacity: null, matchFill: false },
    { id: 'active:entity:two', name: 'Second active entity', color: '#abcdef', opacity: 1,
      borderColor: null, borderOpacity: null, matchFill: false },
  ]);

  for (const [kind, id, available] of [
    ['module', 'shared:id', true],
    ['module', 'retired:module', false],
    ['category', 'shared:id', false],
    ['category', 'active:category', true],
    ['category', 'under:retired-module', false],
    ['checklistItem', 'active:item', true],
    ['checklistItem', 'retired:item', false],
    ['checklistItem', 'under:retired-category', false],
    ['checklistItem', 'under:retired-module:item', false],
    ['entity', 'active:entity', true],
    ['entity', 'shared:id', false],
    ['entity', 'active:entity:two', true],
    ['space', 'shared:id', false],
    ['module', 'unknown:id', false],
    ['module', '', false],
  ]) assert.equal(projected.isAvailable(kind, id), available, `${kind}:${id}`);

  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.modules), true);
  assert.equal(Object.isFrozen(projected.entities), true);
  assert.equal(JSON.stringify(canonical), before, 'the canonical receipt stays byte-for-byte unchanged');
  assert.equal(Object.isFrozen(canonical.surveyDefinition.modules[0]), true);
  assert.equal('archived' in canonical.surveyDefinition.modules[0], false);
  assert.equal('archived' in canonical.surveyDefinition.modules[0].categories[1], false);
  assert.equal('archived' in canonical.surveyDefinition.modules[0].categories[1].checklist[0], false);
});

test('retiring only roots removes their full new-use subtree', () => {
  const projected = projectDocumentDefinitionForNewUse(makeReceipt({
    modules: [{ id: 'module', name: 'Module', categories: [
      { id: 'category', name: 'Category', checklist: [{ id: 'item', text: 'Item' }] },
    ] }],
    entities: [{ id: 'entity', name: 'Entity', color: '#112233', opacity: 0.35,
      borderColor: null, borderOpacity: null, matchFill: false }],
    archives: [{ kind: 'module', id: 'module' }, { kind: 'entity', id: 'entity' }],
  }));
  assert.deepEqual(projected.modules, []);
  assert.deepEqual(projected.entities, []);
  for (const [kind, id] of [
    ['module', 'module'], ['category', 'category'],
    ['checklistItem', 'item'], ['entity', 'entity'],
  ]) assert.equal(projected.isAvailable(kind, id), false);
});

test('embedded checklist retirement is honored and active checklist metadata is preserved', () => {
  const canonical = makeReceipt({
    modules: [{ id: 'module', name: 'Module', categories: [
      { id: 'category', name: 'Category', checklist: [
        { id: 'embedded-retired', text: 'Old item', archived: true,
          archivedAt: '2026-09-15T12:00:00Z', lastKnownLabel: 'Old item' },
        { id: 'active-with-metadata', text: 'Current item', archived: false,
          lastKnownLabel: 'Prior item label' },
      ] },
    ] }],
    entities: [],
  });
  const before = JSON.stringify(canonical);
  const projected = projectDocumentDefinitionForNewUse(canonical);

  assert.deepEqual(projected.modules, [{ id: 'module', name: 'Module', categories: [
    { id: 'category', name: 'Category', checklist: [
      { id: 'active-with-metadata', text: 'Current item', archived: false,
        lastKnownLabel: 'Prior item label' },
    ] },
  ] }]);
  assert.equal(projected.isAvailable('checklistItem', 'embedded-retired'), false);
  assert.equal(projected.isAvailable('checklistItem', 'active-with-metadata'), true);
  assert.equal(JSON.stringify(canonical), before);
});

test('same-kind duplicate IDs and unknown typed archive references fail closed', () => {
  const entity = id => ({ id, name: id, color: '#112233', opacity: 0.35,
    borderColor: null, borderOpacity: null, matchFill: false });
  const invalidReceipts = [
    makeReceipt({ modules: [
      { id: 'duplicate', name: 'First', categories: [] },
      { id: 'duplicate', name: 'Second', categories: [] },
    ], entities: [] }),
    makeReceipt({ modules: [
      { id: 'first', name: 'First', categories: [{ id: 'duplicate', name: 'First category', checklist: [] }] },
      { id: 'second', name: 'Second', categories: [{ id: 'duplicate', name: 'Second category', checklist: [] }] },
    ], entities: [] }),
    makeReceipt({ modules: [{ id: 'module', name: 'Module', categories: [
      { id: 'first', name: 'First', checklist: [{ id: 'duplicate', text: 'First item' }] },
      { id: 'second', name: 'Second', checklist: [{ id: 'duplicate', text: 'Second item' }] },
    ] }], entities: [] }),
    makeReceipt({ modules: [], entities: [entity('duplicate'), entity('duplicate')] }),
    makeReceipt({ modules: [{ id: 'known', name: 'Known', categories: [] }], entities: [],
      archives: [{ kind: 'module', id: 'missing' }] }),
    makeReceipt({ modules: [{ id: 'shared', name: 'Known module', categories: [] }],
      entities: [entity('shared')], archives: [{ kind: 'category', id: 'shared' }] }),
  ];

  for (const canonical of invalidReceipts) {
    const projected = projectDocumentDefinitionForNewUse(canonical);
    assert.deepEqual(projected.modules, []);
    assert.deepEqual(projected.entities, []);
    assert.equal(projected.isAvailable('module', 'known'), false);
    assert.equal(projected.isAvailable('entity', 'shared'), false);
  }
});

test('null and malformed accepted inputs fail closed without throwing', () => {
  for (const value of [
    null,
    undefined,
    {},
    { status: 'preview', surveyDefinition: { modules: [] }, entityCatalog: { entities: [] } },
    { status: 'accepted', surveyDefinition: null, entityCatalog: { entities: [] } },
    { status: 'accepted', surveyDefinition: { modules: 'bad' }, entityCatalog: { entities: [] } },
    { status: 'accepted', surveyDefinition: { modules: [] }, entityCatalog: { entities: 'bad' } },
    { status: 'accepted', surveyDefinition: { modules: [null] },
      entityCatalog: { entities: [{ id: null }] }, archivedSemanticIds: [null] },
  ]) {
    let projected;
    assert.doesNotThrow(() => { projected = projectDocumentDefinitionForNewUse(value); });
    assert.deepEqual(projected.modules, []);
    assert.deepEqual(projected.entities, []);
    assert.equal(projected.isAvailable('module', 'anything'), false);
  }
});

test('empty and repeated projections stay bounded and deterministic', () => {
  const empty = projectDocumentDefinitionForNewUse(makeReceipt({ modules: [], entities: [] }));
  assert.deepEqual(empty.modules, []);
  assert.deepEqual(empty.entities, []);
  assert.equal(empty.isAvailable('entity', 'missing'), false);

  const canonical = fullReceipt();
  const first = projectDocumentDefinitionForNewUse(canonical);
  const second = projectDocumentDefinitionForNewUse(canonical);
  assert.deepEqual(second.modules, first.modules);
  assert.deepEqual(second.entities, first.entities);
  assert.equal(JSON.stringify(second.modules), JSON.stringify(first.modules));
  assert.equal(JSON.stringify(second.entities), JSON.stringify(first.entities));
  assert.ok(first.modules.length <= 64);
  assert.ok(first.entities.length <= 256);
});
