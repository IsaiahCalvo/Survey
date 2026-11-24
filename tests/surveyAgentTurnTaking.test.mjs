// One thought, one turn (Isaiah, Nov 24: "I was still talking, and it took
// it as two inputs"). A spoken turn the person talks over, while it has
// changed nothing, stops so its words can join what comes next, the way a
// live voice agent drops a reply it is talked over on. A reply of "…" (or an
// empty one) means the words stopped mid-thought: no fake "I did not change
// anything", and the history stays as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isUnfinishedReply, runSurveyAgentTurn } from '../src/agent/surveyAgentClient.js';

const toolCall = (id, name, args) => ({ content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

function fakeToolbox() {
  const ran = [];
  return {
    ran,
    run: async (name, args) => {
      ran.push(name);
      if (name === 'get_survey_context') return { isError: false, content: '{"categories":[]}' };
      if (name === 'find_described') return { isError: false, content: '{"items":[],"plan":[]}' };
      if (name === 'set_entity') return { isError: false, content: 'Set.', change: { itemId: args.item_id, fields: [] } };
      return { isError: true, content: 'unknown' };
    },
  };
}

function model(replies, { onCall } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    call: async () => {
      calls += 1;
      onCall?.(calls);
      const next = replies.shift();
      return { message: typeof next === 'string' ? { content: next, tool_calls: [] } : next };
    },
  };
}

test('"…" or nothing is a stop mid-thought, anything else is a reply', () => {
  assert.equal(isUnfinishedReply('…'), true);
  assert.equal(isUnfinishedReply(' ... '), true);
  assert.equal(isUnfinishedReply(''), true);
  assert.equal(isUnfinishedReply('Which camera?'), false);
});

test('talked over before anything changed: the turn stops as superseded', async () => {
  let talking = false;
  const m = model([toolCall('a', 'find_described', { description: 'camera 80' }), 'Which page?'], { onCall: () => { talking = true; } });
  const box = fakeToolbox();
  await assert.rejects(
    runSurveyAgentTurn({ userText: 'I need you to camera 80 on floor three', call: m.call, toolbox: box, answerValues: ['Y'], shouldStop: () => talking }),
    (err) => err.code === 'superseded' && Array.isArray(err.changes) && err.changes.length === 0,
  );
  assert.equal(m.calls, 1, 'no second model call once talked over');
});

test('once something changed, talking over does not stop the turn', async () => {
  let talking = false;
  const m = model([toolCall('a', 'set_entity', { item_id: 'm1', entity_id: 'e1' }), 'Set it.'], { onCall: (n) => { if (n === 1) talking = true; } });
  const out = await runSurveyAgentTurn({ userText: 'camera 80 is not started', call: m.call, toolbox: fakeToolbox(), answerValues: ['Y'], shouldStop: () => talking });
  assert.equal(out.reply, 'Set it.');
  assert.equal(out.changes.length, 1);
});

test('a stop mid-thought keeps the history as it was and claims nothing', async () => {
  const history = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello.' }];
  for (const said of ['…', '']) {
    const out = await runSurveyAgentTurn({ history, userText: 'I need you to camera 80 on floor three um', call: model([said]).call, toolbox: fakeToolbox(), answerValues: ['Y'] });
    assert.equal(out.unfinished, true);
    assert.equal(out.reply, '');
    assert.equal(out.history, history);
  }
});

test('an empty reply after a change is still Done, not a stop', async () => {
  const out = await runSurveyAgentTurn({
    userText: 'camera 80 not started',
    call: model([toolCall('a', 'set_entity', { item_id: 'm1', entity_id: 'e1' }), '']).call,
    toolbox: fakeToolbox(),
    answerValues: ['Y'],
  });
  assert.equal(out.unfinished, undefined);
  assert.equal(out.reply, 'Done.');
});
