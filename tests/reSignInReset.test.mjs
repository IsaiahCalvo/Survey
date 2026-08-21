import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  describeReSignInResetOutcome,
  planReSignInPasswordReset,
} from '../src/components/collab/reSignInAccount.js';

const modal = readFileSync(new URL('../src/components/collab/ReSignInModal.jsx', import.meta.url), 'utf8');

test('intended: email + captcha plans AuthContext.resetPassword', () => {
  assert.deepEqual(planReSignInPasswordReset({
    email: ' a@b.com ',
    captchaToken: 'tok',
    captchaBroken: false,
    turnstileEnabled: true,
  }), { ok: true, email: 'a@b.com', captchaToken: 'tok' });
  assert.match(modal, /resetPassword\(plan\.email, plan\.captchaToken\)/);
  assert.match(modal, /A password reset link has been sent to/);
  assert.doesNotMatch(modal, /not wired up yet/);
});

test('break: empty email does not claim a send', () => {
  const plan = planReSignInPasswordReset({
    email: '   ',
    captchaToken: 'tok',
    captchaBroken: false,
    turnstileEnabled: true,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.errorCode, 'reset_email');
  assert.match(modal, /Enter your email first, then try Forgot password again/);
});

test('edge: missing Turnstile fails closed; broken widget fail-opens; preview block is not success', () => {
  assert.equal(planReSignInPasswordReset({
    email: 'a@b.com',
    captchaToken: '',
    captchaBroken: false,
    turnstileEnabled: true,
  }).errorCode, 'captcha');
  assert.deepEqual(planReSignInPasswordReset({
    email: 'a@b.com',
    captchaToken: '',
    captchaBroken: true,
    turnstileEnabled: true,
  }), { ok: true, email: 'a@b.com', captchaToken: '' });
  assert.equal(
    describeReSignInResetOutcome(new Error('Test PDF cannot send password reset emails.')),
    'reset_failed',
  );
  assert.equal(describeReSignInResetOutcome(new Error('captcha_failed')), 'captcha');
});
