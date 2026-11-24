import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chatBodyFor,
  chatHoldMicros,
  creditProviderFor,
  holdCredit,
  refusesTemperature,
} from '../supabase/functions/_shared/aiCredit.js';

test('credit provider: paid hosts spend a budget, Groq and local fakes are free', () => {
  assert.equal(creditProviderFor('https://api.openai.com/v1'), 'openai');
  assert.equal(creditProviderFor('https://api.anthropic.com/v1/'), 'anthropic');
  assert.equal(creditProviderFor('https://api.groq.com/openai/v1'), null);
  assert.equal(creditProviderFor('http://host.docker.internal:9999'), null);
  assert.equal(creditProviderFor('https://openrouter.ai/api/v1'), 'other');
  assert.equal(creditProviderFor(''), null);
});

test('chat hold covers every prompt token and the full output allowance', () => {
  // 3500 chars is about 1000 tokens: 1000 * 0.4 + 2048 * 1.6 micros.
  assert.equal(chatHoldMicros({ promptChars: 3500, maxOutputTokens: 2048, prices: { input: 0.4, output: 1.6 } }), Math.ceil(400 + 2048 * 1.6));
  assert.equal(chatHoldMicros({ promptChars: 3500, maxOutputTokens: 2048, prices: {} }), 0);
});

test('OpenAI bodies use max_completion_tokens; others keep max_tokens', () => {
  assert.deepEqual(chatBodyFor('openai', { model: 'm', max_tokens: 10 }), { model: 'm', max_completion_tokens: 10 });
  assert.deepEqual(chatBodyFor('anthropic', { model: 'm', max_tokens: 10 }), { model: 'm', max_tokens: 10 });
  assert.deepEqual(chatBodyFor(null, { model: 'm', max_tokens: 10 }), { model: 'm', max_tokens: 10 });
});

test('a temperature refusal is told apart from other 400s', () => {
  assert.equal(refusesTemperature(400, "Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported."), true);
  assert.equal(refusesTemperature(400, 'Invalid tool schema'), false);
  assert.equal(refusesTemperature(429, 'temperature unsupported'), false);
});

function fakeAdmin(reply) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => { calls.push([name, args]); return reply(name, args); },
  };
}

test('hold: a free call never touches the ledger', async () => {
  const admin = fakeAdmin(() => ({ data: true, error: null }));
  const settle = await holdCredit(admin, { provider: null, micros: 50, app: 'x' });
  assert.equal(typeof settle, 'function');
  await settle(10);
  assert.equal(admin.calls.length, 0);
});

test('hold: refused or unreadable budget stops the paid call', async () => {
  assert.equal(await holdCredit(fakeAdmin(() => ({ data: false, error: null })), { provider: 'openai', micros: 5, app: 'x' }), null);
  assert.equal(await holdCredit(fakeAdmin(() => ({ data: null, error: { message: 'down' } })), { provider: 'openai', micros: 5, app: 'x' }), null);
});

test('hold then settle swaps the hold for the real cost once', async () => {
  const admin = fakeAdmin(() => ({ data: true, error: null }));
  const settle = await holdCredit(admin, { provider: 'openai', micros: 99.2, app: 'survey-agent' });
  await settle(40);
  await settle(40);
  assert.deepEqual(admin.calls, [
    ['reserve_ai_credit', { p_provider: 'openai', p_micros: 100, p_app: 'survey-agent' }],
    ['settle_ai_credit', { p_provider: 'openai', p_held_micros: 100, p_actual_micros: 40, p_app: 'survey-agent' }],
  ]);
});
