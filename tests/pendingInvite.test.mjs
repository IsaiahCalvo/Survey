import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PENDING_INVITE_KEY, pendingInviteRedirect, readPendingInviteToken } from '../src/utils/pendingInvite.js';

const TOKEN = '7fb955cfb223ad87ed4ced47f32347ae';
const at = (href) => new URL(href);
const store = (value) => ({ getItem: (key) => (key === PENDING_INVITE_KEY ? value : null) });

test('the sign-in bounce query sends a signed-in person back to the invite page', () => {
  assert.equal(pendingInviteRedirect(at(`https://surveytool.app/?signIn=1&invite=${TOKEN}`), store(null)), `/invite/${TOKEN}`);
});

test('the stored token covers a confirmation link that dropped the query', () => {
  assert.equal(pendingInviteRedirect(at('https://surveytool.app/'), store(TOKEN)), `/invite/${TOKEN}`);
});

test('no token, no redirect', () => {
  assert.equal(pendingInviteRedirect(at('https://surveytool.app/?docId=abc'), store(null)), null);
});

test('never redirects from the invite page itself (no loop)', () => {
  assert.equal(pendingInviteRedirect(at(`https://surveytool.app/invite/${TOKEN}`), store(TOKEN)), null);
});

test('Electron file:// has no /invite page, so it is left alone', () => {
  assert.equal(pendingInviteRedirect(at('file:///app/dist/index.html'), store(TOKEN)), null);
});

test('rejects tokens that are not a plain token', () => {
  assert.equal(readPendingInviteToken(at('https://surveytool.app/?invite=..%2F..%2Fx'), store(null)), null);
  assert.equal(readPendingInviteToken(at('https://surveytool.app/'), store('a/b')), null);
});

test('storage that throws (private mode) is treated as empty', () => {
  const throwing = { getItem() { throw new Error('denied'); } };
  assert.equal(readPendingInviteToken(at('https://surveytool.app/'), throwing), null);
  assert.equal(readPendingInviteToken(at(`https://surveytool.app/?invite=${TOKEN}`), throwing), TOKEN);
});
