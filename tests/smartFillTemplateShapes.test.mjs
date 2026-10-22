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

const { makeTemplateShape, MAX_TEMPLATE_SHAPES } = await import('../src/survey/smartFillTemplates.js');
const shapes = await import('../src/survey/smartFillTemplateShapes.js');

const ring = [[0, 0], [20, 0], [20, 10], [0, 10]];
beforeEach(() => { store.clear(); shapes.resetSmartFillTemplateShapesForTests(); });

test('saves into the open template when it can', async () => {
  const saved = [];
  shapes.setActiveSmartFillTemplate({ templateId: 't1', templateName: 'Schneider', shapes: [], save: async (s) => { saved.push(s); } });
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
