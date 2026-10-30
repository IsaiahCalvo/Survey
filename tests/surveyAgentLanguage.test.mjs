import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_LANG, CANCEL_WORDS, SHUTTER_WORDS, agentLocale, agentSays } from '../src/agent/agentLanguage.js';
import { SURVEY_AGENT_SYSTEM_PROMPT, surveyAgentSystemMessages } from '../supabase/functions/_shared/surveyAgentSpec.js';

test('the agent is English only (owner 2026-10-26)', () => {
  assert.equal(AGENT_LANG, 'en');
  assert.deepEqual(surveyAgentSystemMessages(AGENT_LANG), [{ role: 'system', content: SURVEY_AGENT_SYSTEM_PROMPT }]);
});

test('hearing and voice use the device English locale, else en-US', () => {
  assert.equal(agentLocale({ language: 'en-GB' }), 'en-GB');
  assert.equal(agentLocale({ language: 'en-AU' }), 'en-AU');
  assert.equal(agentLocale({ language: 'es-MX' }), 'en-US');
  assert.equal(agentLocale(null), 'en-US');
});

test('what the app says itself', () => {
  assert.match(agentSays('savedFirst'), /No signal/);
  assert.equal(agentSays('saved'), 'Saved.');
  assert.equal(agentSays('nope'), '');
});

test('camera words', () => {
  for (const said of ['take it', 'snap it', 'take the photo']) assert.ok(SHUTTER_WORDS.test(said), said);
  for (const said of ['cancel', 'never mind', 'no photo']) assert.ok(CANCEL_WORDS.test(said), said);
  assert.equal(SHUTTER_WORDS.test('the door has a reader'), false);
});
