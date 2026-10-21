import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurveyAgentToolbox } from '../src/agent/surveyAgentTools.js';
import { MODULE_MEANING, moduleKind } from '../supabase/functions/_shared/surveyAgentMeaning.js';
import { SURVEY_AGENT_SYSTEM_PROMPT } from '../supabase/functions/_shared/surveyAgentSpec.js';

// Like Isaiah's door template: the same door in an installation module and
// a commissioning module, with lines worded differently.
const TEMPLATE = {
  name: 'Doors',
  answerSet: ['Y', 'N', 'N/A'],
  modules: [
    { id: 'mod-inst', name: 'Installation', categories: [{ id: 'cat-door', name: 'Door', checklist: [
      { id: 'cl-cable', text: 'Cables Pulled' }, { id: 'cl-frame', text: 'Frame Installed & Prepped' },
      { id: 'cl-door', text: 'Door Installed & Prepped' }, { id: 'cl-stub', text: 'Stub-ups Installed' },
    ] }] },
    { id: 'mod-cx', name: 'Commissioning', categories: [{ id: 'cat-door', name: 'Door', checklist: [
      { id: 'cl-reader', text: 'Card reader reads' }, { id: 'cl-rex', text: 'REX releases' }, { id: 'cl-dps', text: 'Door position switch' },
    ] }] },
  ],
};

function bridgeFor({ currentModuleId = 'mod-inst' } = {}) {
  const markers = {
    i117: { name: 'D-1-17', moduleId: 'mod-inst', categoryId: 'cat-door', checklistResponses: { 'cl-cable': { selection: 'N' } }, note: { text: '' } },
    c117: { name: 'D-1-17', moduleId: 'mod-cx', categoryId: 'cat-door', checklistResponses: {}, note: {} },
  };
  return {
    template: TEMPLATE, markers, documentId: 'doc', canEdit: true, selectedMarkerId: null, currentModuleId,
    setAnswers: (id, answers) => {
      const r = { ...markers[id].checklistResponses };
      for (const a of answers) r[a.checklistItemId] = { selection: a.value };
      markers[id] = { ...markers[id], checklistResponses: r };
    },
    updateNote: (id, fn) => { markers[id] = { ...markers[id], note: fn(markers[id].note || {}) }; },
    restoreMarker: (id, snap) => { markers[id] = { ...markers[id], checklistResponses: snap.checklistResponses, note: snap.note }; },
  };
}
const answersOf = (b, id) => Object.fromEntries(Object.entries(b.markers[id].checklistResponses).map(([k, v]) => [k, v.selection]));

test('module kinds come from their names', () => {
  assert.equal(moduleKind('Installation'), 'installation');
  assert.equal(moduleKind('Rough-in'), 'installation');
  assert.equal(moduleKind('Commissioning'), 'commissioning');
  assert.equal(moduleKind('Cx'), 'commissioning');
  assert.equal(moduleKind('Testing'), 'commissioning');
  assert.equal(moduleKind('Existing conditions'), 'inspection');
  assert.equal(moduleKind('Phase 2'), 'other');
  assert.match(MODULE_MEANING.installation, /cable pulled is installed/);
});

test('"installed but no power": every installation line Y and the power in the note, in one step, one Undo', async () => {
  const b = bridgeFor();
  const box = createSurveyAgentToolbox({ getBridge: () => b });
  const res = await box.run('set_answers', { item_name: 'D one seventeen', all_lines: 'Y', note: 'No power.' });
  assert.equal(res.isError, false, res.content);
  // The installation D-1-17 (the module open on screen), not the commissioning one.
  assert.deepEqual(answersOf(b, 'i117'), { 'cl-cable': 'Y', 'cl-frame': 'Y', 'cl-door': 'Y', 'cl-stub': 'Y' });
  assert.deepEqual(answersOf(b, 'c117'), {});
  assert.equal(b.markers.i117.note.text, 'No power.');
  assert.match(res.change.label, /Cables Pulled = Y.*Stub-ups Installed = Y; note "No power\."/);
  assert.equal(res.content, 'Set 4 answers and a note on D-1-17 (item id i117).');
  box.undo([res.change]);
  assert.deepEqual(answersOf(b, 'i117'), { 'cl-cable': 'N' });
  assert.equal(b.markers.i117.note.text, '');
});

test('named lines win over all_lines; a note alone works; nothing at all is refused', async () => {
  const b = bridgeFor();
  const box = createSurveyAgentToolbox({ getBridge: () => b });
  // "Everything's in except the stub-ups."
  await box.run('set_answers', { item_id: 'i117', answers: [{ checklist_item_id: 'cl-stub', value: 'N' }], all_lines: 'Y' });
  assert.deepEqual(answersOf(b, 'i117'), { 'cl-cable': 'Y', 'cl-frame': 'Y', 'cl-door': 'Y', 'cl-stub': 'N' });
  const noted = await box.run('set_answers', { item_id: 'i117', note: 'Hinge squeaks.' });
  assert.equal(noted.content, 'Set a note on D-1-17.');
  assert.match((await box.run('set_answers', { item_id: 'i117' })).content, /No answers given/);
  assert.match((await box.run('set_answers', { item_id: 'i117', all_lines: 'Maybe' })).content, /not an allowed answer/);
});

test('in commissioning, the commissioning item is the one meant', async () => {
  const b = bridgeFor({ currentModuleId: 'mod-cx' });
  const box = createSurveyAgentToolbox({ getBridge: () => b });
  await box.run('set_answers', { item_name: 'D-1-17', all_lines: 'Y' });
  assert.deepEqual(answersOf(b, 'c117'), { 'cl-reader': 'Y', 'cl-rex': 'Y', 'cl-dps': 'Y' });
  // With no module open, two items match: ask.
  const unsure = createSurveyAgentToolbox({ getBridge: () => bridgeFor({ currentModuleId: null }) });
  assert.match((await unsure.run('set_answers', { item_name: 'D-1-17', all_lines: 'Y' })).content, /Several items match/);
});

test('context and get_item say which module is open and what talk means there', async () => {
  const b = bridgeFor();
  const box = createSurveyAgentToolbox({ getBridge: () => b });
  const ctx = JSON.parse((await box.run('get_survey_context', {})).content);
  assert.equal(ctx.current_module, 'Installation');
  assert.deepEqual(ctx.modules.map((m) => m.kind), ['installation', 'commissioning']);
  const item = JSON.parse((await box.run('get_item', { item_id: 'c117' })).content);
  assert.equal(item.module, 'Commissioning');
  assert.match(item.meaning, /works/);
});

test('the prompt tells the model to set lines and the note together', () => {
  assert.match(SURVEY_AGENT_SYSTEM_PROMPT, /installed but has no power" sets the installation lines Y and adds the note/);
  assert.match(SURVEY_AGENT_SYSTEM_PROMPT, /ask one short question/);
});

test('find_items lists only the open module\'s D-1-17, so the agent does not ask which one', async () => {
  const b = bridgeFor({ currentModuleId: 'mod-cx' });
  const box = createSurveyAgentToolbox({ getBridge: () => b });
  const res = await box.run('find_items', { query: 'D-1-17' });
  const found = JSON.parse(res.content);
  assert.deepEqual(found.matches.map((m) => m.id), ['c117']);
  assert.equal(found.matches[0].module, 'Commissioning');
  assert.match(found.open_module_only, /Installation/);
  // No module open: every match, with its module named.
  const all = JSON.parse((await createSurveyAgentToolbox({ getBridge: () => ({ ...bridgeFor(), currentModuleId: null }) }).run('find_items', { query: 'D-1-17' })).content);
  assert.deepEqual(all.matches.map((m) => m.module).sort(), ['Commissioning', 'Installation']);
});

test('find_items: a fuzzy match in the open module never hides an exact match in another', async () => {
  const b = bridgeFor({ currentModuleId: 'mod-inst' });
  b.markers.cam = { name: 'CAM-117', moduleId: 'mod-inst', categoryId: 'cat-door', checklistResponses: {}, note: {} };
  b.markers.c117 = { ...b.markers.c117, name: 'D-117' };
  delete b.markers.i117;
  const found = JSON.parse((await createSurveyAgentToolbox({ getBridge: () => b }).run('find_items', { query: 'D-117' })).content);
  assert.equal(found.matches[0].id, 'c117');
  assert.equal(found.open_module_only, undefined);
});
