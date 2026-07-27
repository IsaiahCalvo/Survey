import test from 'node:test';
import {
  deepStrictEqual,
  equal,
  match,
  ok,
} from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  CANONICAL_ORIGIN,
  handleSendInviteEmail,
} from '../supabase/functions/send-invite-email/handler.js';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const FUTURE = new Date(Date.now() + 86400000).toISOString();
const PAST = new Date(Date.now() - 1000).toISOString();
const BASE_ROW = {
  token: 'secret-invite-token',
  document_id: '11111111-2222-3333-4444-555555555555',
  target_email: 'existing@example.com',
  revoked_at: null,
  accepted_at: null,
  expires_at: FUTURE,
  intended_role: 'editor',
  role: 'editor',
};

function makeDeps({
  row = BASE_ROW,
  authError = { code: 'email_exists', status: 422 },
  activeAccess = { role: 'editor' },
  fallbackResult = true,
} = {}) {
  const calls = { invite: [], fallback: [], access: [] };
  return {
    calls,
    deps: {
      anonKey: 'anon',
      getUserFromToken: async () => ({ id: 'owner-id' }),
      selectInviteRow: async (table) => (table === 'document_invites' ? row : null),
      selectActiveDocumentAccess: async (documentId, email) => {
        calls.access.push([documentId, email]);
        return activeAccess;
      },
      inviteUserByEmail: async (email, redirectTo) => {
        calls.invite.push([email, redirectTo]);
        return { error: authError };
      },
      sendFallbackEmail: async (payload) => {
        calls.fallback.push(payload);
        return fallbackResult;
      },
    },
  };
}

function post(body = {}) {
  return {
    method: 'POST',
    authHeader: 'Bearer owner-jwt',
    body: {
      token: BASE_ROW.token,
      displayName: 'E2E-KAL-438-Site Plan.pdf',
      inviterName: 'Isaiah',
      ...body,
    },
  };
}

test('KAL-438: existing paid user gets a server-derived direct document notification without the consumed token', async () => {
  const { deps, calls } = makeDeps();
  const out = await handleSendInviteEmail(post(), deps);

  deepStrictEqual(out, { status: 200, body: { sent: true } });
  equal(calls.fallback.length, 1);
  const payload = calls.fallback[0];
  equal(payload.to, BASE_ROW.target_email);
  equal(payload.template, 'permission-changed');
  equal(payload.data.newRole, 'Editor');
  equal(
    payload.data.documentUrl,
    `${CANONICAL_ORIGIN}/?docId=${encodeURIComponent(BASE_ROW.document_id)}`,
  );
  equal('inviteUrl' in payload.data, false);
  equal(JSON.stringify(payload).includes(BASE_ROW.token), false);
});

test('KAL-438: existing free editor invite clearly says Viewer until upgrade', async () => {
  const { deps, calls } = makeDeps({ activeAccess: { role: 'viewer' } });
  const out = await handleSendInviteEmail(post(), deps);

  equal(out.status, 200);
  equal(calls.fallback[0].data.newRole, 'Viewer (Editor activates after upgrade)');
  equal(calls.fallback[0].data.documentUrl.includes('/invite/'), false);
});

test('KAL-438: existing account without a verified grant keeps the valid token flow', async () => {
  const { deps, calls } = makeDeps({ activeAccess: null });
  const out = await handleSendInviteEmail(post(), deps);

  equal(out.status, 200);
  equal(calls.fallback[0].template, 'document-invite');
  equal(calls.fallback[0].data.inviteUrl, `${CANONICAL_ORIGIN}/invite/${BASE_ROW.token}`);
});

test('KAL-438: new/unregistered user keeps the auth-mailer acceptance-token flow', async () => {
  const { deps, calls } = makeDeps({ authError: null, activeAccess: null });
  const out = await handleSendInviteEmail(post(), deps);

  equal(out.status, 200);
  deepStrictEqual(calls.invite, [[
    BASE_ROW.target_email,
    `${CANONICAL_ORIGIN}/invite/${BASE_ROW.token}`,
  ]]);
  equal(calls.access.length, 0);
  equal(calls.fallback.length, 0);
});

test('KAL-438: wrong caller cannot select the invite; reused and expired tokens send nothing', async () => {
  const wrong = makeDeps();
  wrong.deps.selectInviteRow = async () => null;
  equal((await handleSendInviteEmail(post(), wrong.deps)).status, 404);

  for (const row of [
    { ...BASE_ROW, accepted_at: PAST },
    { ...BASE_ROW, expires_at: PAST },
  ]) {
    const current = makeDeps({ row });
    equal((await handleSendInviteEmail(post(), current.deps)).status, 409);
    equal(current.calls.invite.length, 0);
    equal(current.calls.fallback.length, 0);
  }
});

test('KAL-438: direct notification delivery failure is generic and does not expose account state', async () => {
  const { deps } = makeDeps({ fallbackResult: false });
  const out = await handleSendInviteEmail(post(), deps);

  deepStrictEqual(out, {
    status: 502,
    body: { sent: false, error: 'Send failed' },
  });
});

test('KAL-438: accepted marker makes a repeated send request an idempotent no-op', async () => {
  const row = { ...BASE_ROW };
  const current = makeDeps({ row });
  equal((await handleSendInviteEmail(post(), current.deps)).status, 200);
  equal(current.calls.fallback.length, 1);

  row.accepted_at = PAST;
  equal((await handleSendInviteEmail(post(), current.deps)).status, 409);
  equal(current.calls.fallback.length, 1);
});

test('KAL-438: client-injected recipient/template/link fields are ignored', async () => {
  const { deps, calls } = makeDeps();
  const out = await handleSendInviteEmail(post({
    to: 'attacker@example.com',
    template: 'payment-failed',
    inviteUrl: 'https://evil.example/phish',
    documentUrl: 'https://evil.example/doc',
  }), deps);

  equal(out.status, 200);
  equal(calls.fallback[0].to, BASE_ROW.target_email);
  equal(calls.fallback[0].template, 'permission-changed');
  equal(JSON.stringify(calls.fallback[0]).includes('evil.example'), false);
  equal(JSON.stringify(calls.fallback[0]).includes('attacker@example.com'), false);
});

test('KAL-438: client still calls only send-invite-email and server verifies active document access', () => {
  const documentService = read('src/services/documentInviteService.js');
  const shareService = read('src/services/shareEmailService.js');
  const edgeWrapper = read('supabase/functions/send-invite-email/index.ts');

  match(documentService, /sendInviteEmailSmart\(\{/);
  equal(documentService.includes('sendDocumentAccessGrantedEmail'), false);
  equal(shareService.includes('sendDocumentAccessGrantedEmail'), false);
  match(edgeWrapper, /selectActiveDocumentAccess/);
  match(edgeWrapper, /\.from\('document_collaborators'\)/);
  match(edgeWrapper, /\.eq\('status', 'active'\)/);
  ok(edgeWrapper.includes('document_id'));
});
