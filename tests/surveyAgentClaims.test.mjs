// The turn loop around the model: the survey context goes in before the
// first step, and a reply claiming something no tool did gets one check
// (a weak model once said it was showing a camera it never showed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSurveyAgentTurn, unbackedClaim } from '../src/agent/surveyAgentClient.js';
import { sanitizeAgentMessages } from '../supabase/functions/_shared/surveyAgentSpec.js';

function fakeToolbox() {
  const ran = [];
  return {
    ran,
    run: async (name, args) => {
      ran.push(name);
      if (name === 'get_survey_context') return { isError: false, content: '{"categories":[]}' };
      if (name === 'show_item') return { isError: false, content: `Showing ${args.item_id}.` };
      if (name === 'set_entity') return { isError: false, content: 'Set.', change: { itemId: args.item_id, fields: [] } };
      return { isError: true, content: 'unknown' };
    },
  };
}

// Replies in order; each sees the messages the server would get.
function model(replies) {
  const seen = [];
  return {
    seen,
    call: async ({ messages }) => {
      assert.equal(sanitizeAgentMessages(messages).error, undefined);
      seen.push(messages.map((m) => ({ ...m })));
      const next = replies.shift();
      return { message: typeof next === 'string' ? { content: next, tool_calls: [] } : next };
    },
  };
}

const toolCall = (id, name, args) => ({ content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

test('claims: a reply saying it did what no tool did', () => {
  assert.equal(unbackedClaim('Showing camera 12 on page 4.'), 'show');
  assert.equal(unbackedClaim('Showing camera 12 on page 4.', { shown: true }), null);
  assert.equal(unbackedClaim('Set camera 12 to Not Started.'), 'write');
  assert.equal(unbackedClaim('Set camera 12 to Not Started.', { wrote: true }), null);
  assert.equal(unbackedClaim("I couldn't find camera 12, so nothing changed."), null);
  assert.equal(unbackedClaim('Which camera 12, the one on page 3 or page 4?'), null);
  assert.equal(unbackedClaim('Camera 12 is on page 4.'), null);
  assert.equal(unbackedClaim("I've added a note that it was hit by a ladder."), 'write');
  assert.equal(unbackedClaim('Done. Marked the lock as installed.'), 'write');
  assert.equal(unbackedClaim('D-117 has the lock marked N and two lines left.'), null, 'a read-only answer');
});

test('the survey context is in the chat before the first model step, once', async () => {
  const box = fakeToolbox();
  const m = model(['Camera 12 is on page 4.']);
  const out = await runSurveyAgentTurn({ userText: 'where is camera 12', call: m.call, toolbox: box, answerValues: ['Y', 'N'] });
  const first = m.seen[0];
  assert.equal(first[1].tool_calls[0].function.name, 'get_survey_context');
  assert.equal(first[2].role, 'tool');
  const again = model(['Still page 4.']);
  await runSurveyAgentTurn({ history: out.history, userText: 'and again', call: again.call, toolbox: box, answerValues: ['Y', 'N'] });
  assert.equal(box.ran.filter((n) => n === 'get_survey_context').length, 1, 'not fetched again in the same chat');
});

test('a false "showing" gets one check, then the real show; the check is not kept', async () => {
  const box = fakeToolbox();
  const m = model(['Showing camera 12 now.', toolCall('c1', 'show_item', { item_id: 'c412' }), 'Showing camera 12 now.']);
  const out = await runSurveyAgentTurn({ userText: 'show me camera twelve', call: m.call, toolbox: box, answerValues: ['Y', 'N'] });
  assert.ok(box.ran.includes('show_item'));
  assert.match(m.seen[1].at(-1).content, /no show tool ran/);
  assert.equal(out.reply, 'Showing camera 12 now.');
  assert.ok(!out.history.some((msg) => /^Check:/.test(msg.content || '')), 'the check is left out of the history');
  assert.equal(sanitizeAgentMessages([...out.history, { role: 'user', content: 'next' }]).error, undefined);
});

test('a model that keeps claiming is not believed', async () => {
  const box = fakeToolbox();
  const m = model(['Set camera 12 to Not Started.', 'Set camera 12 to Not Started.']);
  const out = await runSurveyAgentTurn({ userText: 'camera twelve not started', call: m.call, toolbox: box, answerValues: ['Y', 'N'] });
  assert.equal(out.reply, 'I did not change anything.');
  assert.equal(out.history.at(-1).content, 'I did not change anything.');
  assert.equal(m.seen.length, 2, 'one check only');
});

test('a write that happened backs the claim', async () => {
  const box = fakeToolbox();
  const m = model([toolCall('c1', 'set_entity', { item_id: 'c412', entity_id: 'ent-none' }), 'Set camera 12 to Not Started.']);
  const out = await runSurveyAgentTurn({ userText: 'camera twelve not started', call: m.call, toolbox: box, answerValues: ['Y', 'N'] });
  assert.equal(out.reply, 'Set camera 12 to Not Started.');
  assert.equal(m.seen.length, 2);
});
