// Runs every case of the live test set (tests/fixtures/survey-agent-eval.json)
// with a scripted model that does what a good model should. A live run then
// only tests the model: item finding, the tools, the answer checks and the
// server's conversation rules are all covered here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSurveyAgentToolbox } from '../src/agent/surveyAgentTools.js';
import { runSurveyAgentTurn } from '../src/agent/surveyAgentClient.js';
import { sanitizeAgentMessages } from '../supabase/functions/_shared/surveyAgentSpec.js';
import { PLANS, scriptedReply } from './helpers/surveyAgentScriptedModel.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/survey-agent-eval.json', import.meta.url), 'utf8'));
const answerValues = fixture.template.answerSet.map((a) => a.value);

function memoryBridge() {
  const markers = JSON.parse(JSON.stringify(fixture.markers));
  for (const m of Object.values(markers)) m.checklistResponses = {};
  return {
    template: fixture.template,
    markers,
    canEdit: true,
    setAnswers: (id, list) => { for (const a of list) markers[id].checklistResponses[a.checklistItemId] = { selection: a.value }; },
    setEntity: (id, entityId) => { markers[id].entityId = entityId; },
    updateNote: (id, updater) => { markers[id].note = updater(markers[id].note || {}); },
    uploadMedia: async () => { throw new Error('no media in the test set'); },
    addMediaRefs: () => {},
    restoreMarker: () => {},
    showMarker: () => {},
  };
}

function scriptedModel() {
  return async ({ messages }) => {
    // The edge function runs this same check before every model call.
    const clean = sanitizeAgentMessages(messages);
    assert.equal(clean.error, undefined, `server would refuse: ${clean.error}`);
    return { message: scriptedReply(messages) };
  };
}

function problemsFor(bridge, changes, expect) {
  const problems = [];
  if (expect.noChanges && changes.length) problems.push(`expected no changes, got: ${changes.map((c) => c.label).join(' | ')}`);
  for (const [id, want] of Object.entries(expect)) {
    if (id === 'noChanges') continue;
    const m = bridge.markers[id];
    for (const [item, value] of Object.entries(want.answers || {})) {
      const got = m.checklistResponses[item]?.selection || null;
      if (got !== value) problems.push(`${m.name} ${item}: want ${value}, got ${got}`);
    }
    for (const text of want.noteIncludes || []) {
      if (!String(m.note?.text || '').toLowerCase().includes(text.toLowerCase())) problems.push(`${m.name} note missing "${text}"`);
    }
    if (want.entity && m.entityId !== want.entity) problems.push(`${m.name} entity: want ${want.entity}, got ${m.entityId || null}`);
  }
  return problems;
}

test('every live test case has a scripted plan', () => {
  assert.deepEqual(fixture.cases.map((c) => c.say).sort(), Object.keys(PLANS).sort());
});

for (const c of fixture.cases) {
  test(`live test case, scripted model: "${c.say}"`, async () => {
    const bridge = memoryBridge();
    const toolbox = createSurveyAgentToolbox({ getBridge: () => bridge });
    const out = await runSurveyAgentTurn({ userText: c.say, call: scriptedModel(), toolbox, answerValues });
    assert.deepEqual(problemsFor(bridge, out.changes, c.expect), []);
    // Untouched items stay untouched.
    for (const [id, m] of Object.entries(bridge.markers)) {
      if (c.expect[id]) continue;
      assert.deepEqual(m.checklistResponses, {}, `${m.name} changed`);
      assert.equal(m.note, undefined, `${m.name} note changed`);
    }
    // The next turn can go on from this history.
    const next = sanitizeAgentMessages([...out.history, { role: 'user', content: 'thanks' }]);
    assert.equal(next.error, undefined);
  });
}
