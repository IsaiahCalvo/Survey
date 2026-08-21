/* P2-01 / P2-05 / P2-33 — sharing + invites logic-audit closures.
 *
 * Focused: paid invite send (intended), free-tier Branch A bypass,
 * revoke drops document_collaborators, post-auth /invite/<token> resume.
 */
import test from 'node:test';
import { deepStrictEqual, equal, match, ok } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  handleSendInviteEmail,
  CANONICAL_ORIGIN,
} from '../supabase/functions/send-invite-email/handler.js';
import {
  PENDING_INVITE_TOKEN_KEY,
  clearPendingInviteToken,
  pendingInviteResumePath,
  readPendingInviteToken,
  resumePendingInviteAfterAuth,
  shouldResumePendingInvite,
  writePendingInviteToken,
} from '../src/services/pendingInviteResume.js';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const FUTURE = new Date(Date.now() + 86400000).toISOString();
const TOKEN = 'tok123abcdef';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

function makeDeps(overrides = {}) {
  const calls = { invite: [], fallback: [], budget: [], released: 0 };
  let delivered = false;
  const deps = {
    anonKey: 'anon-key-value',
    getUserFromToken: async () => ({ id: 'user-1', email: 'owner@example.com' }),
    selectInviteRow: async (table) => (
      table === 'document_invites'
        ? {
            token: TOKEN,
            target_email: 'invitee@example.com',
            revoked_at: null,
            accepted_at: null,
            expires_at: FUTURE,
            intended_role: 'editor',
            role: 'editor',
          }
        : null
    ),
    inviteUserByEmail: async (email, redirectTo) => {
      calls.invite.push([email, redirectTo]);
      return { error: null };
    },
    sendFallbackEmail: async (payload) => {
      calls.fallback.push(payload);
      return true;
    },
    newClaimId: () => '00000000-0000-4000-8000-000000000001',
    claimInviteDelivery: async () => (delivered ? 'completed' : 'claimed'),
    claimEmailSend: async (template, recipient, isInvite) => {
      calls.budget.push([template, recipient, isInvite]);
      return 'allowed';
    },
    completeInviteDelivery: async () => {
      delivered = true;
      return true;
    },
    releaseInviteDelivery: async () => {
      calls.released += 1;
      return true;
    },
    ...overrides,
  };
  return { deps, calls };
}

function post(body = {}) {
  return {
    method: 'POST',
    authHeader: 'Bearer real-user-jwt',
    body: { token: TOKEN, displayName: 'Site Plan.pdf', inviterName: 'Isaiah', ...body },
  };
}

test('P2-01 intended: paid Branch A claims claim_email_send then sends auth invite', async () => {
  const { deps, calls } = makeDeps();
  const out = await handleSendInviteEmail(post(), deps);
  equal(out.status, 200);
  deepStrictEqual(out.body, { sent: true });
  deepStrictEqual(calls.budget, [['document-invite', 'invitee@example.com', true]]);
  deepStrictEqual(calls.invite, [['invitee@example.com', `${CANONICAL_ORIGIN}/invite/${TOKEN}`]]);
  equal(calls.fallback.length, 0);
  equal(calls.released, 0);
});

test('P2-01 free-tier bypass: Branch A blocked before inviteUserByEmail', async () => {
  const { deps, calls } = makeDeps({
    claimEmailSend: async (template, recipient, isInvite) => {
      calls.budget.push([template, recipient, isInvite]);
      return 'invite_blocked_free_tier';
    },
  });
  const out = await handleSendInviteEmail(post(), deps);
  equal(out.status, 403);
  equal(out.body.sent, false);
  match(out.body.error, /Pro subscription/);
  equal(calls.invite.length, 0, 'service-role auth mailer must not run for free tier');
  equal(calls.fallback.length, 0);
  equal(calls.released, 1, 'delivery claim released so an upgrade can retry');
});

test('P2-01 rate-limit and missing budget fail closed without sending', async () => {
  const limited = makeDeps({ claimEmailSend: async () => 'rate_limited' });
  const limitedOut = await handleSendInviteEmail(post(), limited.deps);
  equal(limitedOut.status, 429);
  equal(limited.calls.invite.length, 0);

  const missing = makeDeps({ claimEmailSend: undefined });
  const missingOut = await handleSendInviteEmail(post(), missing.deps);
  equal(missingOut.status, 502);
  equal(missing.calls.invite.length, 0);
});

test('P2-01 migration: insert trigger + RLS consult get_user_tier; CORS wildcard stays', () => {
  const sql = read('supabase/migrations/20260820010000_invite_tier_gate_and_revoke_access.sql');
  match(sql, /kal31_guard_invite_creator_tier/);
  match(sql, /BEFORE INSERT ON public\.document_invites/);
  match(sql, /BEFORE INSERT ON public\.project_invites/);
  match(sql, /BEFORE INSERT ON public\.template_invites/);
  match(sql, /get_user_tier\(auth\.uid\(\)\)::text/);
  match(sql, /Sharing invites require a Pro subscription/);
  match(sql, /COALESCE\(public\.get_user_tier\(auth\.uid\(\)\)::text, 'free'\) <> 'free'/);

  const handler = read('supabase/functions/send-invite-email/handler.js');
  match(handler, /'Access-Control-Allow-Origin': '\*'/);
  match(handler, /claimEmailSend/);
  const wrapper = read('supabase/functions/send-invite-email/index.ts');
  match(wrapper, /claim_email_send/);
});

test('P2-05 revoke RPC deletes matching document_collaborators (not the creator)', () => {
  const sql = read('supabase/migrations/20260820010000_invite_tier_gate_and_revoke_access.sql');
  match(sql, /CREATE OR REPLACE FUNCTION public\.kal31_revoke_document_invite/);
  match(sql, /DELETE FROM public\.document_collaborators/);
  match(sql, /LOWER\(dc\.email\) = LOWER\(invite_row\.target_email\)/);
  match(sql, /dc\.user_id IS DISTINCT FROM owner_id/);
  match(sql, /SET revoked_at = now\(\)/);

  const service = read('src/services/documentInviteService.js');
  match(service, /kal31_revoke_document_invite/);
});

test('P2-33 intended: post-auth resume navigates to /invite/<token>', () => {
  const storage = memoryStorage();
  ok(writePendingInviteToken('aabbccddeeff00112233445566778899', storage));
  equal(readPendingInviteToken(storage), 'aabbccddeeff00112233445566778899');

  let assigned = null;
  const href = resumePendingInviteAfterAuth({
    user: { id: 'user-1' },
    location: { pathname: '/' },
    assign: (next) => { assigned = next; },
    storage,
  });
  equal(href, '/invite/aabbccddeeff00112233445566778899');
  equal(assigned, href);
});

test('P2-33 edges: no resume pre-auth, already-on-invite, garbage token', () => {
  const storage = memoryStorage({ [PENDING_INVITE_TOKEN_KEY]: 'aabbccddeeff00112233445566778899' });

  equal(
    resumePendingInviteAfterAuth({
      user: null,
      location: { pathname: '/' },
      assign: () => { throw new Error('must not navigate pre-auth'); },
      storage,
    }),
    null,
    'pre-auth must not steal the ?signIn=1 bounce',
  );

  equal(
    shouldResumePendingInvite({
      token: 'aabbccddeeff00112233445566778899',
      pathname: '/invite/aabbccddeeff00112233445566778899',
      userId: 'user-1',
    }),
    false,
  );

  equal(writePendingInviteToken('bad token', storage), false);
  equal(readPendingInviteToken(memoryStorage({ [PENDING_INVITE_TOKEN_KEY]: 'zzzz' })), null);
  equal(pendingInviteResumePath('not valid'), null);

  clearPendingInviteToken(storage);
  equal(readPendingInviteToken(storage), null);
});

test('P2-33 boot gate: main.jsx resumes from kal31_pending_invite_token after auth', () => {
  const main = read('src/main.jsx');
  match(main, /PendingInviteResumeGate/);
  match(main, /resumePendingInviteAfterAuth/);
  match(main, /kal31_pending_invite_token|InviteAcceptPage/);

  const page = read('src/home/InviteAcceptPage.jsx');
  match(page, /writePendingInviteToken/);
  match(page, /clearPendingInviteToken/);
  match(page, /r\.status !== 'wrong_account'/);
  const resume = read('src/services/pendingInviteResume.js');
  match(resume, /PENDING_INVITE_TOKEN_KEY = 'kal31_pending_invite_token'/);
  match(resume, /export function resumePendingInviteAfterAuth/);
});
