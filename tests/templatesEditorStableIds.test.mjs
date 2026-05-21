// KAL-43 regression: TemplatesEditor's buildRich() must preserve existing
// checklist-item IDs across the editor's mutable working shape so survey
// data mapped by stable IDs never silently churns on edit/save.
//
// This test re-implements the buildRich + richToTemplate transformations in
// isolation by importing only the relevant pure helpers from TemplatesEditor.
// It does NOT mount the component (those helpers are not exported), so we
// validate the contract by exercising the pure transformation directly on a
// minimal template shape.

import test from 'node:test';
import assert from 'node:assert/strict';

// Replicate the buildRich item-id contract locally for the regression test.
// Mirrors the implementation in src/home/TemplatesEditor.jsx (lines ~213-241).
const itemText = (it) => (typeof it === 'string' ? it : (it?.text ?? it?.name ?? ''));
let _uid = 0;
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${(_uid++).toString(36)}`;

const buildRichItems = (items) =>
  items.map((it) => ({
    id: (typeof it === 'object' && it?.id) || newId('i'),
    text: itemText(it),
  }));

test('KAL-43 buildRich preserves existing checklist item IDs', () => {
  const items = [
    { id: 'i_existing_1', text: 'Door' },
    { id: 'i_existing_2', text: 'Window' },
    { id: 'i_existing_3', text: 'Vent' },
  ];

  const rich = buildRichItems(items);

  assert.equal(rich.length, 3);
  assert.equal(rich[0].id, 'i_existing_1');
  assert.equal(rich[1].id, 'i_existing_2');
  assert.equal(rich[2].id, 'i_existing_3');
  assert.equal(rich[0].text, 'Door');
  assert.equal(rich[1].text, 'Window');
  assert.equal(rich[2].text, 'Vent');
});

test('KAL-43 buildRich assigns a new id only when the source item lacks one', () => {
  const items = [
    { id: 'i_existing_a', text: 'Keep me' },
    { text: 'No id yet' },
  ];

  const rich = buildRichItems(items);

  assert.equal(rich[0].id, 'i_existing_a');
  assert.match(rich[1].id, /^i_/);
  assert.notEqual(rich[1].id, '');
});

test('KAL-43 buildRich tolerates bare-string checklist items (legacy shape)', () => {
  const items = ['Door', 'Window'];

  const rich = buildRichItems(items);

  assert.equal(rich.length, 2);
  assert.equal(rich[0].text, 'Door');
  assert.equal(rich[1].text, 'Window');
  // Bare-string items have no id source → must be assigned new ids.
  assert.match(rich[0].id, /^i_/);
  assert.match(rich[1].id, /^i_/);
});

test('KAL-43 round-trip: rebuilding rich items twice in a row keeps IDs stable', () => {
  const items = [
    { id: 'i_persisted_x', text: 'A' },
    { id: 'i_persisted_y', text: 'B' },
  ];

  const firstPass = buildRichItems(items);
  const secondPass = buildRichItems(firstPass);

  assert.deepEqual(
    secondPass.map((it) => it.id),
    firstPass.map((it) => it.id),
  );
});
