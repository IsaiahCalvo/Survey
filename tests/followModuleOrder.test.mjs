import test from 'node:test';
import assert from 'node:assert/strict';
import { followModuleOrder, needsTemplateVersionChoice, bindUsedTemplate, templateFingerprint } from '../src/utils/surveyTemplateBinding.js';

const a = { id: 'm1', name: 'Installation', categories: [{ id: 'c1', name: 'Door' }] };
const b = { id: 'm2', name: 'Trim out', categories: [] };
const tpl = { id: 't', name: 'Doors', modules: [a, b], entities: [] };

test('a template that only moved its modules is followed in the new order', () => {
  const latest = { ...tpl, modules: [b, a] };
  assert.equal(needsTemplateVersionChoice(bindUsedTemplate(tpl), latest), true);
  const next = followModuleOrder(tpl, latest);
  assert.deepEqual(next.modules.map((m) => m.id), ['m2', 'm1']);
  assert.equal(templateFingerprint(next), templateFingerprint(latest));
});

test('any other change still asks', () => {
  assert.equal(followModuleOrder(tpl, { ...tpl, modules: [b, { ...a, name: 'Install' }] }), null);
  assert.equal(followModuleOrder(tpl, { ...tpl, modules: [a] }), null);
  assert.equal(followModuleOrder(tpl, { ...tpl, name: 'Other', modules: [b, a] }), null);
  assert.equal(followModuleOrder(tpl, tpl), null);
});
