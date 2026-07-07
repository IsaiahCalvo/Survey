/* GOAL-1 — executable tests for the send-invite-email edge-function handler.
 *
 * The handler is a pure dependency-injected function (handler.js has no Deno
 * APIs), so these run it for real with mocked deps — covering the auth,
 * ownership, invite-state, branch-A/branch-B, and generic-response
 * invariants the adversarial plan review demanded (PLAN-GOAL1-REVIEW-LOG.md
 * round-1 #10, round-2 #4).
 */
import test from 'node:test';
import { equal, deepStrictEqual, ok } from 'node:assert/strict';

import {
  handleSendInviteEmail,
  CORS_HEADERS,
  CANONICAL_ORIGIN,
  KIND_TABLES,
} from '../supabase/functions/send-invite-email/handler.js';

const ANON = 'anon-key-value';
const USER = { id: 'user-1', email: 'owner@example.com' };

const FUTURE = new Date(Date.now() + 86400000).toISOString();
const PAST = new Date(Date.now() - 1000).toISOString();

function baseRow(overrides = {}) {
  return {
    token: 'tok123',
    target_email: 'invitee@example.com',
    revoked_at: null,
    accepted_at: null,
    expires_at: FUTURE,
    intended_role: 'editor',
    role: 'editor',
    ...overrides,
  };
}

function makeDeps(overrides = {}) {
  const calls = { invite: [], fallback: [], selects: [] };
  const deps = {
    anonKey: ANON,
    getUserFromToken: async () => USER,
    selectInviteRow: async (table, token) => {
      calls.selects.push([table, token]);
      return table === 'document_invites' ? baseRow() : null;
    },
    inviteUserByEmail: async (email, redirectTo) => {
      calls.invite.push([email, redirectTo]);
      return { error: null };
    },
    sendFallbackEmail: async (payload) => {
      calls.fallback.push(payload);
      return true;
    },
    ...overrides,
  };
  return { deps, calls };
}

function post(body, authHeader = 'Bearer real-user-jwt') {
  return { method: 'POST', authHeader, body };
}

test('GOAL-1 fn: OPTIONS preflight returns 200 with no body; CORS headers are wildcard', async () => {
  const { deps } = makeDeps();
  const out = await handleSendInviteEmail({ method: 'OPTIONS', authHeader: null, body: null }, deps);
  equal(out.status, 200);
  equal(out.body, null);
  equal(CORS_HEADERS['Access-Control-Allow-Origin'], '*');
  ok(CORS_HEADERS['Access-Control-Allow-Headers'].includes('authorization'));
});

test('GOAL-1 fn: non-POST rejected 405', async () => {
  const { deps } = makeDeps();
  const out = await handleSendInviteEmail({ method: 'GET', authHeader: 'Bearer x', body: null }, deps);
  equal(out.status, 405);
});

test('GOAL-1 fn: missing auth header → 401, no lookups', async () => {
  const { deps, calls } = makeDeps();
  const out = await handleSendInviteEmail(post({ token: 'tok123' }, null), deps);
  equal(out.status, 401);
  equal(calls.selects.length, 0);
});

test('GOAL-1 fn: anon public key as bearer → 401 without calling getUser', async () => {
  let getUserCalled = false;
  const { deps } = makeDeps({ getUserFromToken: async () => { getUserCalled = true; return USER; } });
  const out = await handleSendInviteEmail(post({ token: 'tok123' }, `Bearer ${ANON}`), deps);
  equal(out.status, 401);
  equal(getUserCalled, false);
});

test('GOAL-1 fn: JWT that resolves to no user → 401', async () => {
  const { deps } = makeDeps({ getUserFromToken: async () => null });
  const out = await handleSendInviteEmail(post({ token: 'tok123' }), deps);
  equal(out.status, 401);
});

test('GOAL-1 fn: missing/blank token → 400', async () => {
  const { deps } = makeDeps();
  equal((await handleSendInviteEmail(post({}), deps)).status, 400);
  equal((await handleSendInviteEmail(post({ token: '   ' }), deps)).status, 400);
  equal((await handleSendInviteEmail(post(null), deps)).status, 400);
});

test('GOAL-1 fn: token not visible to caller (all tables miss) → 404, tables tried in document→project→template order', async () => {
  const { deps, calls } = makeDeps({ selectInviteRow: async (table, token) => { calls.selects.push([table, token]); return null; } });
  const { calls: c } = { calls };
  const out = await handleSendInviteEmail(post({ token: 'nope' }), deps);
  equal(out.status, 404);
  deepStrictEqual(c.selects.map(([t]) => t), KIND_TABLES.map((k) => k.table));
});

for (const [label, overrides, expectStatus] of [
  ['link-only (no target_email)', { target_email: null }, 409],
  ['revoked', { revoked_at: PAST }, 409],
  ['already accepted', { accepted_at: PAST }, 409],
  ['expired', { expires_at: PAST }, 409],
]) {
  test(`GOAL-1 fn: ${label} invite → ${expectStatus}, nothing sent`, async () => {
    const { deps, calls } = makeDeps({
      selectInviteRow: async (table) => (table === 'document_invites' ? baseRow(overrides) : null),
    });
    const out = await handleSendInviteEmail(post({ token: 'tok123' }), deps);
    equal(out.status, expectStatus);
    equal(out.body.sent, false);
    equal(calls.invite.length, 0);
    equal(calls.fallback.length, 0);
  });
}

test('GOAL-1 fn: Branch A (new user) — invite sent to ROW email with canonical redirect; generic response', async () => {
  const { deps, calls } = makeDeps();
  const out = await handleSendInviteEmail(
    post({ token: 'tok123', displayName: 'Site Plan.pdf', inviterName: 'Isaiah' }),
    deps,
  );
  equal(out.status, 200);
  deepStrictEqual(out.body, { sent: true });
  ok(!('exists' in out.body), 'response must not leak account existence');
  deepStrictEqual(calls.invite, [['invitee@example.com', `${CANONICAL_ORIGIN}/invite/tok123`]]);
  equal(calls.fallback.length, 0);
});

test('GOAL-1 fn: Branch B (email_exists code) — fallback send with canonical URL; response identical to Branch A', async () => {
  const { deps, calls } = makeDeps({
    inviteUserByEmail: async () => ({ error: { code: 'email_exists', status: 422, message: 'x' } }),
  });
  const out = await handleSendInviteEmail(
    post({ token: 'tok123', displayName: 'the project "Docks"', inviterName: 'Isaiah' }),
    deps,
  );
  equal(out.status, 200);
  deepStrictEqual(out.body, { sent: true });
  equal(calls.fallback.length, 1);
  const p = calls.fallback[0];
  equal(p.to, 'invitee@example.com');
  equal(p.template, 'document-invite');
  equal(p.data.inviteUrl, `${CANONICAL_ORIGIN}/invite/tok123`);
  equal(p.data.role, 'Editor');
  equal(p.subject, 'Isaiah invited you to the project "Docks" on Survey');
});

test('GOAL-1 fn: Branch B detected via 422 + already-registered message (older error shape)', async () => {
  const { deps, calls } = makeDeps({
    inviteUserByEmail: async () => ({ error: { status: 422, message: 'A user with this email address has already been registered' } }),
  });
  const out = await handleSendInviteEmail(post({ token: 'tok123' }), deps);
  equal(out.status, 200);
  equal(calls.fallback.length, 1);
});

test('GOAL-1 fn: non-exists, non-rate-limit invite error → 502 generic, NO fallback send', async () => {
  const { deps, calls } = makeDeps({
    inviteUserByEmail: async () => ({ error: { code: 'unexpected_failure', status: 500, message: 'boom' } }),
  });
  const out = await handleSendInviteEmail(post({ token: 'tok123' }), deps);
  equal(out.status, 502);
  deepStrictEqual(out.body, { sent: false, error: 'Send failed' });
  equal(calls.fallback.length, 0);
});

test('GOAL-1 fn: auth-mailer rate limit (bulk invites) → falls through to fallback send, still {sent:true}', async () => {
  const { deps, calls } = makeDeps({
    inviteUserByEmail: async () => ({ error: { code: 'over_email_send_rate_limit', status: 429, message: 'rate limited' } }),
  });
  const out = await handleSendInviteEmail(post({ token: 'tok123' }), deps);
  equal(out.status, 200);
  deepStrictEqual(out.body, { sent: true });
  equal(calls.fallback.length, 1);
  equal(calls.fallback[0].to, 'invitee@example.com');
});

test('GOAL-1 fn: control chars in copy fields are stripped from the email subject', async () => {
  const { deps, calls } = makeDeps({
    inviteUserByEmail: async () => ({ error: { code: 'email_exists' } }),
  });
  const out = await handleSendInviteEmail(
    post({ token: 'tok123', displayName: 'Plan\r\nBcc: victim@x.com', inviterName: 'Eve\x00\x1f' }),
    deps,
  );
  equal(out.status, 200);
  const p = calls.fallback[0];
  ok(!/[\r\n\x00-\x1f]/.test(p.subject), 'subject must contain no control chars');
  equal(p.data.inviterName, 'Eve');
});

test('GOAL-1 fn: fallback send failure → 502 generic', async () => {
  const { deps } = makeDeps({
    inviteUserByEmail: async () => ({ error: { code: 'email_exists' } }),
    sendFallbackEmail: async () => false,
  });
  const out = await handleSendInviteEmail(post({ token: 'tok123' }), deps);
  equal(out.status, 502);
  deepStrictEqual(out.body, { sent: false, error: 'Send failed' });
});

test('GOAL-1 fn: copy fields are length-capped and defaulted; token from row is URL-encoded', async () => {
  const { deps, calls } = makeDeps({
    selectInviteRow: async (table) => (table === 'document_invites' ? baseRow({ token: 'tok/../123' }) : null),
    inviteUserByEmail: async (email, redirectTo) => { calls.invite.push([email, redirectTo]); return { error: { code: 'email_exists' } }; },
  });
  const out = await handleSendInviteEmail(
    post({ token: 'tok/../123', displayName: 'x'.repeat(1000), inviterName: '' }),
    deps,
  );
  equal(out.status, 200);
  ok(calls.invite[0][1].includes(encodeURIComponent('tok/../123')));
  equal(calls.fallback[0].data.documentName.length, 300);
  equal(calls.fallback[0].data.inviterName, 'A Survey user');
});
