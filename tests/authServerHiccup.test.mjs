import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AUTH_SERVER_HICCUP_MESSAGE,
  authErrorMessage,
  isAuthServerHiccup,
  retryAuthServerHiccups,
} from '../src/components/authFlow.js';

// 2026-10-30: the iPhone app walk's sign-in showed "{}" as the whole error:
// auth-js turns a 502/503 from the gateway into AuthRetryableFetchError whose
// message is the response body.

const hiccup = Object.assign(new Error('{}'), { name: 'AuthRetryableFetchError', status: 503 });
const wrongPassword = Object.assign(new Error('Invalid login credentials'), { name: 'AuthApiError', status: 400 });
const noSleep = async () => {};

test('a server hiccup reads as plain words, other errors keep their message', () => {
  assert.equal(isAuthServerHiccup(hiccup), true);
  assert.equal(isAuthServerHiccup(wrongPassword), false);
  assert.equal(authErrorMessage(hiccup), AUTH_SERVER_HICCUP_MESSAGE);
  assert.doesNotMatch(AUTH_SERVER_HICCUP_MESSAGE, /captcha|verification|human/i);
  assert.equal(authErrorMessage(wrongPassword), 'Invalid login credentials');
  assert.equal(authErrorMessage({}), 'An error occurred');
});

test('sign-in retries a hiccup and stops on success or a real answer', async () => {
  const answers = [{ error: hiccup }, { error: hiccup }, { data: { session: 's' }, error: null }];
  let calls = 0;
  const ok = await retryAuthServerHiccups(async () => answers[calls++], { sleep: noSleep });
  assert.equal(ok.data.session, 's');
  assert.equal(calls, 3);

  calls = 0;
  const denied = await retryAuthServerHiccups(async () => { calls += 1; return { error: wrongPassword }; }, { sleep: noSleep });
  assert.equal(denied.error, wrongPassword);
  assert.equal(calls, 1);
});

test('a lasting outage gives up after the last delay; a captcha sign-in never retries', async () => {
  let calls = 0;
  const waits = [];
  const down = await retryAuthServerHiccups(async () => { calls += 1; return { error: hiccup }; }, { sleep: async (ms) => { waits.push(ms); } });
  assert.equal(down.error, hiccup);
  assert.equal(calls, 4);
  assert.deepEqual(waits, [1000, 3000, 6000]);

  calls = 0;
  await retryAuthServerHiccups(async () => { calls += 1; return { error: hiccup }; }, { canRetry: false, sleep: noSleep });
  assert.equal(calls, 1);
});

test('the sign-in form and AuthContext use them', () => {
  const modal = readFileSync(new URL('../src/components/AuthModal.jsx', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('../src/contexts/AuthContext.jsx', import.meta.url), 'utf8');
  assert.match(modal, /const msg = authErrorMessage\(err\);/);
  assert.match(auth, /retryAuthServerHiccups\(\(\) => supabase\.auth\.signInWithPassword\(/);
  assert.match(auth, /\{ canRetry: !captchaToken \}/);
});
