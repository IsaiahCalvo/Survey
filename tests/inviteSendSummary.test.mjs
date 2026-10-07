// inviteFix (2026-10-07): the Share / Invite dialogs used to say
// "Sent 0 of 1. First failure: Access was granted. The email may already have
// been delivered. Use Resend only if you intentionally want to send another
// copy.." in a red box. One builder now words every outcome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  asSentence,
  describeInviteSendResult,
  mergeRetryResult,
  summarizeInviteSend,
} from '../src/home/inviteSendSummary.js';

const invite = (id = 'inv-1') => ({ id, token: `tok-${id}` });
const B = 'b@example.com';
const C = 'c@example.com';
const D = 'd@example.com';

// What createDocumentInvite returns in each branch.
const sent = () => ({ success: true, invite: invite(), emailSent: true, accessGranted: true });
const grantedEmailFailed = () => ({ success: false, invite: invite(), accessGranted: true, emailSent: false, retryable: true, error: 'Access was granted, but the email didn\'t send. Retry it from Manage Access.' });
const grantedEmailUnsure = () => ({ success: false, invite: invite(), accessGranted: true, emailSent: false, retryable: false, error: 'Access was granted, but we couldn\'t confirm the email was sent.' });
const pendingEmailFailed = () => ({ success: false, invite: invite('inv-2'), accessGranted: false, emailSent: false, retryable: true, error: 'x' });
const pendingEmailUnsure = () => ({ success: false, invite: invite('inv-3'), accessGranted: false, emailSent: false, retryable: false, error: 'x' });
const nothingCreated = () => ({ success: false, error: 'An invite for this email is already pending on this document. Resend or revoke the existing invite instead.' });

function noJunk(text) {
  assert.doesNotMatch(text, /\.\./, `double full stop in: ${text}`);
  assert.doesNotMatch(text, /First failure|Sent 0 of 1|Use Resend only/, `old wording in: ${text}`);
}

test('asSentence ends with exactly one full stop', () => {
  assert.equal(asSentence('Done.'), 'Done.');
  assert.equal(asSentence('Done.. '), 'Done.');
  assert.equal(asSentence('Done'), 'Done.');
  assert.equal(asSentence(''), '');
  assert.equal(asSentence(null), '');
});

test('access granted + email failed: plain warning, copy link and try again', () => {
  const s = summarizeInviteSend([{ email: B, result: grantedEmailFailed() }]);
  assert.equal(s.tone, 'warning');
  assert.equal(s.message, `${B} now has access, but the invite email didn't send. Copy the invite link to share it yourself, or try again.`);
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].state, 'access-no-email');
  assert.equal(s.items[0].canCopyLink, true);
  assert.equal(s.items[0].canRetry, true);
  noJunk(s.message);
});

test('access granted + email outcome unknown (the real-backend case): warning, copy link, no try again', () => {
  const s = summarizeInviteSend([{ email: B, result: grantedEmailUnsure() }]);
  assert.equal(s.tone, 'warning');
  assert.equal(s.message, `${B} now has access, but we couldn't confirm the invite email was sent. Copy the invite link to share it yourself.`);
  assert.equal(s.items[0].canCopyLink, true);
  assert.equal(s.items[0].canRetry, false, 'a retry could send a second copy');
  noJunk(s.message);
});

test('nothing granted + email failed: says they do not have access yet', () => {
  const s = summarizeInviteSend([{ email: C, result: pendingEmailFailed() }]);
  assert.equal(s.tone, 'warning');
  assert.equal(s.message, `The invite email to ${C} didn't send, so they don't have access yet. Copy the invite link to share it yourself, or try again.`);
  assert.equal(s.items[0].state, 'invite-no-email');
  assert.equal(s.items[0].canRetry, true);
  noJunk(s.message);

  const unsure = summarizeInviteSend([{ email: C, result: pendingEmailUnsure() }]);
  assert.equal(unsure.items[0].state, 'invite-unsure');
  assert.equal(unsure.items[0].canRetry, false);
  assert.match(unsure.message, /They get access when they open the invite\./);
  noJunk(unsure.message);
});

test('nothing created at all: red, the reason in one sentence, nothing to copy', () => {
  const s = summarizeInviteSend([{ email: D, result: nothingCreated() }]);
  assert.equal(s.tone, 'danger');
  assert.equal(s.message, `Couldn't invite ${D}. An invite for this email is already pending on this document. Resend or revoke the existing invite instead.`);
  assert.equal(s.items[0].canCopyLink, false);
  assert.equal(s.items[0].canRetry, false);
  noJunk(s.message);
  const noReason = summarizeInviteSend([{ email: D, result: { success: false } }]);
  assert.equal(noReason.message, `Couldn't invite ${D}. Try again.`);
});

test('partial (n of m): a count line plus one line per address that needs a follow-up', () => {
  const s = summarizeInviteSend([
    { email: 'a@example.com', result: sent() },
    { email: B, result: grantedEmailFailed() },
    { email: C, result: pendingEmailFailed() },
  ]);
  assert.equal(s.tone, 'warning');
  assert.equal(s.message, '1 of 3 invite emails sent.');
  assert.equal(s.sent, 1);
  assert.equal(s.total, 3);
  assert.deepEqual(s.items.map((i) => i.email), [B, C]);
  s.items.forEach((i) => noJunk(i.text));

  const withHardFail = summarizeInviteSend([
    { email: B, result: grantedEmailFailed() },
    { email: D, result: nothingCreated() },
  ]);
  assert.equal(withHardFail.tone, 'danger');
  assert.equal(withHardFail.message, '0 of 2 invite emails sent.');
});

test('every email sent: success line, single and plural', () => {
  assert.deepEqual(
    summarizeInviteSend([{ email: B, result: sent() }], { roleLabel: 'Editor' }),
    { tone: 'success', message: `Sent editor invite to ${B}.`, items: [], sent: 1, total: 1 },
  );
  const two = summarizeInviteSend([{ email: B, result: sent() }, { email: C, result: sent() }], { roleLabel: 'Viewer' });
  assert.equal(two.message, 'Sent 2 viewer invites.');
});

test('email delivered but the pending invite could not be closed counts as sent', () => {
  const d = describeInviteSendResult(B, { success: false, invite: invite(), accessGranted: true, emailSent: true, retryable: true, error: 'x' });
  assert.equal(d.state, 'sent');
});

test('Try again: success becomes sent; a failed retry keeps access and invite', () => {
  const entry = { email: B, result: grantedEmailFailed() };
  const ok = mergeRetryResult(entry, { success: true, emailSent: true });
  assert.equal(summarizeInviteSend([ok]).tone, 'success');

  const failedAgain = mergeRetryResult(entry, { success: false, emailSent: false, retryable: true, error: 'nope' });
  const s = summarizeInviteSend([failedAgain]);
  assert.equal(s.items[0].state, 'access-no-email');
  assert.equal(s.items[0].invite.id, 'inv-1');

  const unsure = mergeRetryResult(entry, { success: false, emailSent: false, retryable: false });
  assert.equal(summarizeInviteSend([unsure]).items[0].state, 'access-unsure');
});

test('both invite dialogs use the builder, not the old "First failure" string', () => {
  for (const f of ['src/home/ShareModal.jsx', 'src/home/ManageTeamModal.jsx']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /First failure/, f);
    assert.match(src, /summarizeInviteSend\(/, f);
    assert.match(src, /<InviteSendNotice/, f);
  }
  const notice = readFileSync(new URL('../src/home/InviteSendNotice.jsx', import.meta.url), 'utf8');
  assert.match(notice, /--alert-warning-bg/);
  assert.match(notice, /--alert-warning-border/);
});
