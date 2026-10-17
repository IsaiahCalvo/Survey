import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptTemplateVersion, bindUsedTemplate, needsTemplateVersionChoice, templateFingerprint, templateBindingKey, isRetainedSurveyTemplate, isSurveyTemplateRestorationReady, hasSurveyTemplateMarks, observeUnusedSurveyTemplateUpdate } from '../src/utils/surveyTemplateBinding.js';
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

const observe = (observation, active = original, latest = original, extra = {}) => observeUnusedSurveyTemplateUpdate(observation, { active, latest, restorationReady: true, ...extra });
test('only an observed shared revision updates a known-unused active Survey', () => {
  const initial = observe(null);
  assert.equal(initial.update, null);
  assert.strictEqual(observe(initial.observation, original, revised).update, revised);
  assert.equal(isRetainedSurveyTemplate(null, original, revised), false);
  assert.equal(observe(null, original, revised).update, null, 'an initial mismatch is not an observed shared edit');
  assert.equal(observe(initial.observation, original, { ...original, updatedAt: 'later' }).update, null);
});
test('a delayed restore blocks adoption and retained/late marks keep the old version', () => {
  const initial = observe(null);
  const pending = observe(initial.observation, original, revised, { restorationReady: false });
  assert.equal(pending.update, null);
  assert.strictEqual(observe(pending.observation, original, revised).update, revised, 'a known-empty restore can adopt the queued shared edit');
  const marksArrive = observe(pending.observation, original, revised, { hasMarks: true });
  assert.equal(marksArrive.update, null);
  assert.equal(marksArrive.observation.pendingBase, null);
  const used = bindUsedTemplate(original);
  assert.equal(observe(pending.observation, original, revised, { binding: used }).update, null);
  const kept = acceptTemplateVersion(used, revised, false);
  assert.equal(observe(pending.observation, original, revised, { binding: kept }).update, null);
  assert.equal(isRetainedSurveyTemplate(kept, original, revised), true);
  assert.deepEqual(kept.snapshot, original);
});
test('local drafts and failed/stale shared saves cannot replace the active selection', () => {
  const initial = observe(null);
  const draft = { ...original, modules: [...original.modules, { id: 'local', name: 'Local category module', categories: [] }] };
  assert.equal(observe(initial.observation, draft, original).update, null);
  assert.equal(observe(initial.observation, draft, revised).update, null);
  const pending = observe(initial.observation, original, revised, { restorationReady: false });
  assert.equal(observe(pending.observation, draft, revised).update, null);
  assert.equal(observe(initial.observation, draft, draft).update, null, 'publishing the local draft is not an incoming revision');
});
test('restoration requires PDF data/import and the current cloud document snapshot', () => {
  assert.equal(isSurveyTemplateRestorationReady({ isLoadingPDF: true }), false);
  assert.equal(isSurveyTemplateRestorationReady({ isLoadingPDF: false }), true);
  assert.equal(isSurveyTemplateRestorationReady({ isLoadingPDF: false, loadFailed: true }), false);
  assert.equal(isSurveyTemplateRestorationReady({ isLoadingPDF: false, documentId: 'doc', hydration: { ready: false, documentId: 'doc' } }), false);
  assert.equal(isSurveyTemplateRestorationReady({ isLoadingPDF: false, documentId: 'doc', hydration: { ready: true, documentId: 'old-doc' } }), false);
  assert.equal(isSurveyTemplateRestorationReady({ isLoadingPDF: false, documentId: 'doc', hydration: { ready: true, documentId: 'doc' } }), true);
  const marks = { restored: { moduleId: 'm' } };
  assert.equal(hasSurveyTemplateMarks(original, marks), true);
  assert.equal(hasSurveyTemplateMarks(original, {}, { 1: { objects: [{ moduleId: 'm' }] } }), true);
  assert.equal(hasSurveyTemplateMarks(original, { unrelated: { moduleId: 'other' } }), false);
});
