import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SURVEY_AGENT_FALLBACK_MODELS,
  createModelRest,
  modelChain,
  parseWait,
  restAfterRefusal,
  restWhenNearCap,
} from '../supabase/functions/_shared/surveyAgentModels.js';

test('model chain: free Groq fallbacks only on the default Groq provider', () => {
  assert.deepEqual(modelChain('openai/gpt-oss-120b', { groqDefault: true }), ['openai/gpt-oss-120b', ...SURVEY_AGENT_FALLBACK_MODELS]);
  assert.deepEqual(modelChain('my-model', { groqDefault: false }), ['my-model']);
  assert.deepEqual(modelChain('a', { fallbackEnv: ' b, a ,c', groqDefault: true }), ['a', 'b', 'c']);
  assert.deepEqual(modelChain('a', { fallbackEnv: '', groqDefault: true }), ['a']);
});

test('parseWait reads Groq wait times', () => {
  assert.equal(parseWait('1m26.4s'), 86_400);
  assert.equal(parseWait('2h3m'), 7_380_000);
  assert.equal(parseWait('120ms'), 120);
  assert.equal(parseWait('7'), 7000);
  assert.equal(parseWait(''), null);
  assert.equal(parseWait('soon'), null);
});

test('a daily cap rests the model at least 15 minutes; a per-minute one only as long as asked', () => {
  const daily = restAfterRefusal({
    retryAfter: null,
    message: '{"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` on requests per day (RPD): Limit 1000, Used 1000, Requested 1. Please try again in 1m26.4s."}}',
  });
  assert.equal(daily.daily, true);
  assert.equal(daily.ms, 15 * 60 * 1000);
  const tokens = restAfterRefusal({ retryAfter: null, message: 'on tokens per day (TPD): Limit 200000. Please try again in 2h3m.' });
  assert.deepEqual(tokens, { daily: true, ms: 7_380_000 });
  const minute = restAfterRefusal({ retryAfter: '9', message: 'on tokens per minute (TPM): Limit 8000' });
  assert.deepEqual(minute, { daily: false, ms: 9000 });
  assert.equal(restAfterRefusal({}).ms, 20_000);
});

test('near the daily cap a model rests before it runs out', () => {
  assert.equal(restWhenNearCap({ remaining: '500', resetIn: '1m' }), null);
  assert.equal(restWhenNearCap({ remaining: null, resetIn: null }), null);
  assert.equal(restWhenNearCap({ remaining: '10', resetIn: '30s' }), 15 * 60 * 1000);
  assert.equal(restWhenNearCap({ remaining: '3', resetIn: '3h' }), 3 * 3_600_000);
});

test('resting models are skipped until their time is up', () => {
  let now = 1000;
  const rest = createModelRest(() => now);
  const chain = ['main', 'small', 'llama'];
  rest.rest('main', 60_000);
  assert.deepEqual(rest.available(chain), ['small', 'llama']);
  rest.rest('small', 5000);
  rest.rest('llama', 30_000);
  assert.deepEqual(rest.available(chain), []);
  assert.equal(rest.soonest(chain), 5);
  now += 6000;
  assert.deepEqual(rest.available(chain), ['small']);
  rest.rest('main', 1000); // a shorter rest never cuts a longer one
  now += 60_000;
  assert.deepEqual(rest.available(chain), ['main', 'small', 'llama']);
});
