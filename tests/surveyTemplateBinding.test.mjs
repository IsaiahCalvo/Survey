import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptTemplateVersion, bindUsedTemplate, needsTemplateVersionChoice, templateFingerprint, templateBindingKey } from '../src/utils/surveyTemplateBinding.js';
const original = { id:'t', name:'Test', modules:[{id:'m', categories:[{id:'c',name:'Wall',checklist:[]}]}], entities:[] };
const revised = { ...original, name: 'Revised' };
test('never used templates do not prompt, meaningful used versions do',()=>{
  assert.equal(needsTemplateVersionChoice(null,revised),false);
  const binding=bindUsedTemplate(original);
  assert.equal(needsTemplateVersionChoice(binding,{...original,updatedAt:'later'}),false);
  assert.equal(needsTemplateVersionChoice(binding,revised),true);
  assert.equal(templateFingerprint({...original,updatedAt:'later'}),templateFingerprint(original));
});
test('keeping a version keeps its definitions; only a later new edit prompts again',()=>{
  const binding=acceptTemplateVersion(bindUsedTemplate(original),revised,false);
  assert.deepEqual(binding.snapshot,original);
  assert.equal(needsTemplateVersionChoice(binding,revised),false);
  assert.equal(needsTemplateVersionChoice(binding,{...revised,name:'Third'}),true);
  assert.strictEqual(bindUsedTemplate(revised,binding),binding);
});
test('using latest replaces the binding without mutating either version; document/user keys differ',()=>{
  const binding=acceptTemplateVersion(bindUsedTemplate(original),revised,true);
  assert.deepEqual(binding.snapshot,revised);
  assert.equal(needsTemplateVersionChoice(binding,revised),false);
  assert.notStrictEqual(binding.snapshot,revised);
  assert.notEqual(templateBindingKey('a','u','t'),templateBindingKey('b','u','t'));
  assert.notEqual(templateBindingKey('a','u','t'),templateBindingKey('a','v','t'));
});

test('an unused active Survey adopts live shared edits without becoming retained', async () => {
  const { isRetainedSurveyTemplate, unusedSurveyTemplateUpdate } = await import('../src/utils/surveyTemplateBinding.js');
  assert.equal(isRetainedSurveyTemplate(null, original, revised), false);
  assert.strictEqual(unusedSurveyTemplateUpdate(null, original, revised), revised);
  assert.equal(unusedSurveyTemplateUpdate(null, original, { ...original, updatedAt: 'later' }), null);
  assert.equal(unusedSurveyTemplateUpdate(null, original, { ...revised, id: 'another' }), null);
  assert.equal(unusedSurveyTemplateUpdate(null, original, revised, true), null);
  const used = bindUsedTemplate(original);
  assert.equal(isRetainedSurveyTemplate(used, original, revised), true);
  assert.equal(unusedSurveyTemplateUpdate(used, original, revised), null);
  const retained = acceptTemplateVersion(used, revised, false);
  assert.equal(unusedSurveyTemplateUpdate(retained, original, revised), null);
  assert.deepEqual(retained.snapshot, original);
  const latest = acceptTemplateVersion(used, revised, true);
  assert.equal(isRetainedSurveyTemplate(latest, revised, revised), false);
});
