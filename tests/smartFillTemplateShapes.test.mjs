// Owner 2026-10-22: taught Smart fill tag shapes are saved in the open survey
// template; with no template that can be saved, in this browser.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.window = {
  localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
  dispatchEvent: () => true,
};
globalThis.CustomEvent = class { constructor(type) { this.type = type; } };

const { makeTemplateShape, MAX_TEMPLATE_SHAPES, presetRingInBox, SHAPE_PRESETS } = await import('../src/survey/smartFillTemplates.js');
const shapes = await import('../src/survey/smartFillTemplateShapes.js');

const ring = [[0, 0], [20, 0], [20, 10], [0, 10]];
beforeEach(() => { store.clear(); shapes.resetSmartFillTemplateShapesForTests(); });

test('saves into the open template when it can', async () => {
  let saved = [];
  shapes.setActiveSmartFillTemplate({ templateId: 't1', templateName: 'Schneider', shapes: [], save: async (update) => { saved = update(saved); } });
  const shape = makeTemplateShape(ring, { name: 'Box tag' });
  assert.deepEqual(await shapes.saveSmartFillTemplateShape(shape), { ok: true, where: 'template' });
  assert.equal(saved[0].id, shape.id);
  assert.equal(shapes.getSmartFillTemplateName(), 'Schneider');
});

test('keeps the shape in this browser when the template save fails or there is no template', async () => {
  shapes.setActiveSmartFillTemplate({ templateId: 't1', shapes: [], save: async () => { throw new Error('read-only'); } });
  const a = makeTemplateShape(ring);
  assert.deepEqual(await shapes.saveSmartFillTemplateShape(a), { ok: true, where: 'browser' });
  shapes.setActiveSmartFillTemplate({});
  assert.equal(shapes.getSmartFillTemplateName(), '');
  assert.deepEqual(shapes.getSmartFillTemplateShapes().map((s) => s.id), [a.id]);
});

test('Smart fill sees the template shapes first, then this browser\'s, without repeats', async () => {
  const t = makeTemplateShape(ring, { id: 'tpl' });
  const local = makeTemplateShape(ring, { id: 'loc' });
  await shapes.saveSmartFillTemplateShape(local);
  shapes.setActiveSmartFillTemplate({ templateId: 't1', shapes: [t, { junk: true }], save: null });
  assert.deepEqual(shapes.getSmartFillTemplateShapes().map((s) => s.id), ['tpl', 'loc']);
});

test('a template keeps at most the newest shapes, newest first, no duplicate ids', () => {
  let list = [];
  for (let i = 0; i < MAX_TEMPLATE_SHAPES + 3; i += 1) list = shapes.withTemplateShape(list, makeTemplateShape(ring, { id: `s${i}` }));
  assert.equal(list.length, MAX_TEMPLATE_SHAPES);
  assert.equal(list[0].id, `s${MAX_TEMPLATE_SHAPES + 2}`);
  list = shapes.withTemplateShape(list, makeTemplateShape(ring, { id: 's20' }));
  assert.equal(list.filter((s) => s.id === 's20').length, 1);
});

test('the teach tool is armed and disarmed', () => {
  assert.equal(shapes.getSmartFillTeachArmed(), false);
  shapes.setSmartFillTeachArmed(true);
  assert.equal(shapes.getSmartFillTeachArmed(), true);
  shapes.setSmartFillTeachArmed(false);
  assert.equal(shapes.getSmartFillTeachArmed(), false);
});

// Owner 2026-10-26: "a UI for allowing users to create custom shapes that get
// filled" — the Smart fill shapes menu lists, renames and removes them.
function fakeTemplate(list) {
  const state = { list };
  const save = async (update) => {
    state.list = update(state.list);
    shapes.setActiveSmartFillTemplate({ templateId: 't1', templateName: 'Schneider', shapes: state.list, save });
  };
  shapes.setActiveSmartFillTemplate({ templateId: 't1', templateName: 'Schneider', shapes: state.list, save });
  return state;
}

test('the menu lists template shapes, then this browser\'s, with where each is kept', async () => {
  const local = makeTemplateShape(ring, { id: 'loc' });
  await shapes.saveSmartFillTemplateShape(local);
  fakeTemplate([makeTemplateShape(ring, { id: 'tpl' })]);
  assert.deepEqual(shapes.listSmartFillShapes().map(({ shape, where }) => `${where}:${shape.id}`), ['template:tpl', 'browser:loc']);
});

test('renaming changes the name where the shape is kept', async () => {
  await shapes.saveSmartFillTemplateShape(makeTemplateShape(ring, { id: 'loc', name: 'Old' }));
  const tpl = fakeTemplate([makeTemplateShape(ring, { id: 'tpl', name: 'Old' })]);
  assert.equal(await shapes.renameSmartFillShape('tpl', '  Panel tag '), true);
  assert.equal(tpl.list[0].name, 'Panel tag');
  assert.equal(await shapes.renameSmartFillShape('loc', 'Door tag'), true);
  assert.equal(shapes.listSmartFillShapes().find(({ shape }) => shape.id === 'loc').shape.name, 'Door tag');
  assert.equal(await shapes.renameSmartFillShape('tpl', '   '), false);
  assert.equal(await shapes.renameSmartFillShape('nope', 'X'), false);
});

test('removing a shape can be undone, back in its place', async () => {
  const tpl = fakeTemplate(['a', 'b', 'c'].map((id) => makeTemplateShape(ring, { id })));
  const { ok, undo } = await shapes.removeSmartFillShape('b');
  assert.equal(ok, true);
  assert.deepEqual(tpl.list.map((s) => s.id), ['a', 'c']);
  assert.deepEqual(shapes.getSmartFillTemplateShapes().map((s) => s.id), ['a', 'c']);
  await undo();
  assert.deepEqual(tpl.list.map((s) => s.id), ['a', 'b', 'c']);
  assert.deepEqual(await shapes.removeSmartFillShape('nope'), { ok: false, undo: null });
});

test('undo puts a browser shape back in this browser, even with a template open', async () => {
  const local = makeTemplateShape(ring, { id: 'loc' });
  await shapes.saveSmartFillTemplateShape(local);
  const { ok, undo } = await shapes.removeSmartFillShape('loc');
  assert.equal(ok, true);
  const tpl = fakeTemplate([makeTemplateShape(ring, { id: 'a' })]);
  assert.equal(await undo(), true);
  assert.deepEqual(tpl.list.map((s) => s.id), ['a']);
  assert.deepEqual(shapes.listSmartFillShapes().map(({ shape, where }) => `${where}:${shape.id}`), ['template:a', 'browser:loc']);
});

test('undo never moves a template shape into a different template', async () => {
  const first = fakeTemplate(['a', 'b'].map((id) => makeTemplateShape(ring, { id })));
  const { undo } = await shapes.removeSmartFillShape('b');
  let other = [];
  shapes.setActiveSmartFillTemplate({ templateId: 't2', templateName: 'Other', shapes: other, save: async (update) => { other = update(other); } });
  assert.equal(await undo(), false);
  assert.deepEqual(other, []);
  assert.deepEqual(first.list.map((s) => s.id), ['a']);
  assert.equal(shapes.listSmartFillShapes().length, 0);
});

test('a picked outline arms the box tool with it, and disarming clears it', () => {
  shapes.setSmartFillTeachArmed(true, { preset: 'hexagon' });
  assert.equal(shapes.getSmartFillTeachPreset(), 'hexagon');
  shapes.setSmartFillTeachArmed(true);
  assert.equal(shapes.getSmartFillTeachPreset(), null);
  shapes.setSmartFillTeachArmed(true, { preset: 'circle' });
  shapes.setSmartFillTeachArmed(false);
  assert.equal(shapes.getSmartFillTeachPreset(), null);
});

test('every picked outline fills the box it is dragged over', () => {
  for (const preset of SHAPE_PRESETS) {
    const ringIn = presetRingInBox(preset.id, { x: 10, y: 20, width: 30, height: 15 });
    const xs = ringIn.map(([x]) => x); const ys = ringIn.map(([, y]) => y);
    assert.ok(Math.abs(Math.min(...xs) - 10) < 1e-9 && Math.abs(Math.max(...xs) - 40) < 1e-9, preset.id);
    assert.ok(Math.abs(Math.min(...ys) - 20) < 1e-9 && Math.abs(Math.max(...ys) - 35) < 1e-9, preset.id);
    const shape = makeTemplateShape(ringIn, { name: preset.label, source: 'picked' });
    assert.ok(shape && shape.width === 30 && shape.height === 15, preset.id);
  }
  assert.equal(presetRingInBox('blob', { x: 0, y: 0, width: 5, height: 5 }), null);
});
