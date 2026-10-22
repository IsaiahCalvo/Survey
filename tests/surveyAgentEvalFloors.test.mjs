// The floors bake-off set (tests/fixtures/survey-agent-eval-floors.json)
// with a scripted model that does what a good model should, so a live run
// (scripts/survey-agent-eval.mjs) only tests the model: every case can pass
// with the tools as they are.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSurveyAgentToolbox } from '../src/agent/surveyAgentTools.js';
import { runSurveyAgentTurn } from '../src/agent/surveyAgentClient.js';
import { buildSurveyAgentTools, sanitizeAgentMessages } from '../supabase/functions/_shared/surveyAgentSpec.js';
import { evalProblems, memoryBridge } from '../scripts/surveyAgentEvalShared.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/survey-agent-eval-floors.json', import.meta.url), 'utf8'));
const answerValues = fixture.template.answerSet.map((a) => a.value);
const toolNames = new Set(buildSurveyAgentTools(answerValues).map((t) => t.function.name));

const answers = (map) => Object.entries(map).map(([id, value]) => ({ checklist_item_id: id, value }));
// Per case: what find_described is asked, then the calls on what it found
// (item: the top item's id; plan: the top plan match's id).
const PLANS = {
  'Find camera 6 on the 4th floor': {
    find: { kind: 'camera', number: 6, floor: 4 }, then: ({ item }) => [['show_item', { item_id: item }]],
  },
  "camera six fourth floor, it's 100% installed": {
    find: { kind: 'camera', number: 6, floor: 4 }, then: ({ item }) => [['set_entity', { item_id: item, entity_id: 'ent-done' }]],
  },
  "camera 6 on the 4th floor has an IP, hasn't been aimed and isn't labeled": {
    find: { kind: 'camera', number: 6, floor: 4 },
    then: ({ item }) => [['set_answers', { item_id: item, answers: answers({ 'cx-ip': 'Y', 'cx-aimed': 'N', 'cx-label': 'N' }) }]],
  },
  'Camera six on four is mounted and has power, add a note it got hit by a ladder': {
    find: { kind: 'camera', number: 6, floor: 4 },
    then: ({ item }) => [
      ['set_answers', { item_id: item, answers: answers({ 'cam-mounted': 'Y', 'cam-power': 'Y' }) }],
      ['add_note', { item_id: item, text: 'Hit by a ladder.' }],
    ],
  },
  "the camera on the third floor number six is mounted but the cable isn't terminated": {
    find: { kind: 'camera', number: 6, floor: 3 },
    then: ({ item }) => [['set_answers', { item_id: item, answers: answers({ 'cam-mounted': 'Y', 'cam-cable': 'N' }) }]],
  },
  'camera twelve, fourth floor, not started': {
    find: { kind: 'camera', number: 12, floor: 4 }, then: ({ item }) => [['set_entity', { item_id: item, entity_id: 'ent-none' }]],
  },
  "Add camera 7 on the fourth floor from the plan, it's partially complete": {
    find: { kind: 'camera', number: 7, floor: 4 },
    then: ({ plan }) => [['create_item', { name: 'C-4-07', category_id: 'cat-cam', plan_match_id: plan, entity_id: 'ent-part' }]],
  },
  'door six fourth floor lock is installed': {
    find: { kind: 'door', number: 6, floor: 4 },
    then: ({ item }) => [['set_answers', { item_id: item, answers: answers({ 'door-lock': 'Y' }) }]],
  },
  'find camera 9 on the 4th floor': { find: { kind: 'camera', number: 9, floor: 4 }, then: () => [] },
};

function scriptedModel() {
  return async ({ messages }) => {
    const clean = sanitizeAgentMessages(messages);
    assert.equal(clean.error, undefined, `server would refuse: ${clean.error}`);
    const said = messages.findLast((m) => m.role === 'user').content;
    const plan = PLANS[said];
    const turn = messages.slice(messages.lastIndexOf(messages.findLast((m) => m.role === 'user')) + 1);
    const asked = turn.filter((m) => m.role === 'assistant').length;
    const call = (n, [name, args]) => {
      assert.ok(toolNames.has(name), `not offered: ${name}`);
      return { id: `call_${asked}_${n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
    };
    if (asked === 0) {
      return { message: { content: '', tool_calls: [call(0, ['find_described', { description: said, wing: null, ...plan.find }])] } };
    }
    if (asked === 1) {
      const found = JSON.parse(turn.find((m) => m.role === 'tool').content);
      const calls = plan.then({ item: found.items[0]?.id, plan: found.plan.find((p) => !p.already_item)?.id });
      if (calls.length) return { message: { content: '', tool_calls: calls.map((c, i) => call(i, c)) } };
      return { message: { content: 'I could not find that one.', tool_calls: [] } };
    }
    return { message: { content: 'Done.', tool_calls: [] } };
  };
}

test('every floors case has a scripted plan', () => {
  assert.deepEqual(fixture.cases.map((c) => c.say).sort(), Object.keys(PLANS).sort());
});

for (const c of fixture.cases) {
  test(`floors case, scripted model: "${c.say}"`, async () => {
    const bridge = memoryBridge(fixture);
    const toolbox = createSurveyAgentToolbox({ getBridge: () => bridge });
    const out = await runSurveyAgentTurn({ userText: c.say, call: scriptedModel(), toolbox, answerValues });
    assert.deepEqual(evalProblems(bridge, out.changes, c.expect), []);
    for (const [id, m] of Object.entries(bridge.markers)) {
      if (c.expect[id] || m.created) continue;
      assert.deepEqual(m.checklistResponses, {}, `${m.name} changed`);
      assert.equal(m.note, undefined, `${m.name} note changed`);
      assert.equal(m.entityId, fixture.markers[id]?.entityId, `${m.name} entity changed`);
    }
  });
}
