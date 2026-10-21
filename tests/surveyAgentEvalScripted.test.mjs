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
import { evalProblems, memoryBridge } from '../scripts/surveyAgentEvalShared.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/survey-agent-eval.json', import.meta.url), 'utf8'));
const answerValues = fixture.template.answerSet.map((a) => a.value);

function scriptedModel() {
  return async ({ messages }) => {
    // The edge function runs this same check before every model call.
    const clean = sanitizeAgentMessages(messages);
    assert.equal(clean.error, undefined, `server would refuse: ${clean.error}`);
    return { message: scriptedReply(messages) };
  };
}

test('every live test case has a scripted plan', () => {
  assert.deepEqual(fixture.cases.map((c) => c.say).sort(), Object.keys(PLANS).sort());
});

for (const c of fixture.cases) {
  test(`live test case, scripted model: "${c.say}"`, async () => {
    const bridge = memoryBridge(fixture);
    const toolbox = createSurveyAgentToolbox({ getBridge: () => bridge });
    const out = await runSurveyAgentTurn({ userText: c.say, call: scriptedModel(), toolbox, answerValues });
    assert.deepEqual(evalProblems(bridge, out.changes, c.expect), []);
    // Untouched items stay untouched.
    for (const [id, m] of Object.entries(bridge.markers)) {
      if (c.expect[id] || m.created) continue;
      assert.deepEqual(m.checklistResponses, {}, `${m.name} changed`);
      assert.equal(m.note, undefined, `${m.name} note changed`);
    }
    // The next turn can go on from this history.
    const next = sanitizeAgentMessages([...out.history, { role: 'user', content: 'thanks' }]);
    assert.equal(next.error, undefined);
  });
}
