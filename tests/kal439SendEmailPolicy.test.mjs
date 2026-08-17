/* KAL-439 — send-email hardening tests.
 *
 * The policy is a pure dependency-injected module
 * (supabase/functions/send-email/policy.js, same pattern as
 * send-invite-email/handler.js), so every rejection path runs here in node
 * with no Deno/Supabase. The migration's guard RPC shape is source-asserted
 * alongside (style of kal31LastOwnerCascadeMigration.test.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SERVICE_ONLY_TEMPLATES,
  USER_TEMPLATES,
  INVITE_TEMPLATES,
  normalizeRecipient,
  escapeLikePattern,
  sanitizeSubject,
  authorizeUserSend,
} from '../supabase/functions/send-email/policy.js';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');

function deps(overrides = {}) {
  return {
    findInviteRowForRecipient: async () => null,
    findActiveCollaboratorForRecipient: async () => null,
    claimSendBudget: async () => 'allowed',
    ...overrides,
  };
}

const FRESH_INVITE = {
  revokedAt: null,
  acceptedAt: null,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

test('billing templates are service-role only: every one is rejected for user callers', async () => {
  for (const template of SERVICE_ONLY_TEMPLATES) {
    const out = await authorizeUserSend({ template, to: 'victim@example.com' }, deps({
      findInviteRowForRecipient: async () => FRESH_INVITE,
    }));
    assert.equal(out.ok, false, `${template} must be rejected`);
    assert.equal(out.status, 403);
  }
});

test('unknown templates are rejected for user callers', async () => {
  const out = await authorizeUserSend({ template: 'password-reset', to: 'a@b.co' }, deps());
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
});

test('free-form recipients with no invite/share row are rejected (open relay closed)', async () => {
  for (const template of USER_TEMPLATES) {
    const out = await authorizeUserSend({ template, to: 'stranger@example.com' }, deps());
    assert.equal(out.ok, false, `${template} to an unbound recipient must be rejected`);
    assert.equal(out.status, 403);
    assert.match(out.error, /not tied to an invite or share/);
  }
});

test('malformed recipients are rejected before any lookup', async () => {
  let lookups = 0;
  const spying = deps({
    findInviteRowForRecipient: async () => { lookups += 1; return FRESH_INVITE; },
  });
  for (const bad of ['', '   ', 'not-an-email', 'a@b', `x@${'y'.repeat(320)}.com`, 42, null]) {
    const out = await authorizeUserSend({ template: 'document-invite', to: bad }, spying);
    assert.equal(out.ok, false, `${String(bad)} must be rejected`);
    assert.equal(out.status, 400);
  }
  assert.equal(lookups, 0, 'no binding lookup may run for malformed recipients');
});

test('document-invite requires a FRESH invite row (revoked/accepted/expired all rejected)', async () => {
  const stale = [
    { ...FRESH_INVITE, revokedAt: new Date().toISOString() },
    { ...FRESH_INVITE, acceptedAt: new Date().toISOString() },
    { ...FRESH_INVITE, expiresAt: new Date(Date.now() - 1000).toISOString() },
  ];
  for (const invite of stale) {
    const out = await authorizeUserSend({ template: 'document-invite', to: 'invitee@example.com' }, deps({
      findInviteRowForRecipient: async () => invite,
    }));
    assert.equal(out.ok, false);
    assert.equal(out.status, 403);
  }

  const ok = await authorizeUserSend({ template: 'document-invite', to: 'Invitee@Example.com' }, deps({
    findInviteRowForRecipient: async (email) => {
      assert.equal(email, 'invitee@example.com', 'recipient must be normalized before lookup');
      return FRESH_INVITE;
    },
  }));
  assert.equal(ok.ok, true, 'a legit pending invite must be accepted');
  assert.equal(ok.recipient, 'invitee@example.com');
});

test('document-shared binds via just-accepted invite row OR active collaborator', async () => {
  const viaInvite = await authorizeUserSend({ template: 'document-shared', to: 'peer@example.com' }, deps({
    findInviteRowForRecipient: async () => ({ ...FRESH_INVITE, acceptedAt: new Date().toISOString() }),
  }));
  assert.equal(viaInvite.ok, true);

  const viaCollab = await authorizeUserSend({ template: 'document-shared', to: 'peer@example.com' }, deps({
    findActiveCollaboratorForRecipient: async () => ({ id: 'row' }),
  }));
  assert.equal(viaCollab.ok, true);

  const revoked = await authorizeUserSend({ template: 'document-shared', to: 'peer@example.com' }, deps({
    findInviteRowForRecipient: async () => ({ ...FRESH_INVITE, revokedAt: new Date().toISOString() }),
  }));
  assert.equal(revoked.ok, false, 'a revoked invite alone must not bind document-shared');
});

test('permission-changed and access-removed bind via collaborator or surviving invite row', async () => {
  for (const template of ['permission-changed', 'access-removed']) {
    const viaCollab = await authorizeUserSend({ template, to: 'member@example.com' }, deps({
      findActiveCollaboratorForRecipient: async () => ({ id: 'row' }),
    }));
    assert.equal(viaCollab.ok, true, `${template} via active collaborator`);
  }
  // access-removed fires AFTER the hard delete of the collaborator row — the
  // surviving (even revoked/accepted) invite row must still bind it.
  const afterDelete = await authorizeUserSend({ template: 'access-removed', to: 'member@example.com' }, deps({
    findInviteRowForRecipient: async () => ({ ...FRESH_INVITE, acceptedAt: new Date().toISOString() }),
  }));
  assert.equal(afterDelete.ok, true);
});

test('free-tier invite gate: invite templates blocked, management templates unaffected', async () => {
  const gated = deps({
    findInviteRowForRecipient: async () => FRESH_INVITE,
    findActiveCollaboratorForRecipient: async () => ({ id: 'row' }),
    claimSendBudget: async (_t, _r, isInvite) => (isInvite ? 'invite_blocked_free_tier' : 'allowed'),
  });
  for (const template of INVITE_TEMPLATES) {
    const out = await authorizeUserSend({ template, to: 'invitee@example.com' }, gated);
    assert.equal(out.ok, false, `${template} must hit the free-tier gate`);
    assert.equal(out.status, 403);
    assert.match(out.error, /Pro subscription/);
  }
  const mgmt = await authorizeUserSend({ template: 'permission-changed', to: 'member@example.com' }, gated);
  assert.equal(mgmt.ok, true, 'management emails do not carry the invite tier gate');
});

test('rate limit rejects with 429; budget errors fail closed with 503', async () => {
  const base = {
    findInviteRowForRecipient: async () => FRESH_INVITE,
  };
  const limited = await authorizeUserSend({ template: 'document-invite', to: 'invitee@example.com' }, deps({
    ...base,
    claimSendBudget: async () => 'rate_limited',
  }));
  assert.equal(limited.ok, false);
  assert.equal(limited.status, 429);

  const broken = await authorizeUserSend({ template: 'document-invite', to: 'invitee@example.com' }, deps({
    ...base,
    claimSendBudget: async () => 'error',
  }));
  assert.equal(broken.ok, false);
  assert.equal(broken.status, 503);
});

test('LIKE wildcards in recipients cannot widen binding lookups', () => {
  assert.equal(escapeLikePattern('a%b_c\\d@example.com'), 'a\\%b\\_c\\\\d@example.com');
  assert.equal(escapeLikePattern('plain@example.com'), 'plain@example.com');
});

test('normalizeRecipient and sanitizeSubject harden inputs', () => {
  assert.equal(normalizeRecipient('  User@Example.COM '), 'user@example.com');
  assert.equal(normalizeRecipient('no-at-sign'), null);
  assert.equal(sanitizeSubject('Hi\r\nBcc: evil@x.com', 'fallback'), 'Hi  Bcc: evil@x.com');
  assert.equal(sanitizeSubject('', 'fallback'), 'fallback');
  assert.equal(sanitizeSubject('x'.repeat(500), 'fallback').length, 300);
});

test('guardrail migration: RPC shape, hardening, and no-client-access ledger', () => {
  const sql = fs.readFileSync(
    path.join(repoRoot, 'supabase/migrations/20260817020000_kal439_email_send_guardrails.sql'),
    'utf8',
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.email_send_events/);
  assert.match(sql, /ALTER TABLE public\.email_send_events ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.email_send_events FROM anon, authenticated/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.claim_email_send/);
  assert.match(sql, /SECURITY DEFINER[\s\S]+SET search_path = ''/);
  assert.match(sql, /invite_blocked_free_tier/);
  assert.match(sql, /rate_limited/);
  assert.match(sql, /IF v_recent >= 30 THEN/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.claim_email_send\(TEXT, TEXT, BOOLEAN\) TO authenticated, service_role/);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.claim_email_send\(TEXT, TEXT, BOOLEAN\) FROM anon/);
});

test('index.ts wiring: policy runs for user callers before Brevo, CORS wildcard preserved', () => {
  const src = fs.readFileSync(
    path.join(repoRoot, 'supabase/functions/send-email/index.ts'),
    'utf8',
  );
  assert.match(src, /from '\.\/policy\.js'/);
  assert.match(src, /caller\.type === 'user'/);
  assert.ok(
    src.indexOf('authorizeUserSend(') < src.indexOf('https://api.brevo.com'),
    'policy check must precede the Brevo send',
  );
  assert.match(src, /'Access-Control-Allow-Origin': '\*'/, 'wildcard CORS is intentional — must stay');
  assert.match(src, /to: \[\{ email: recipient \}\]/, 'Brevo payload must use the policy-approved recipient');
  assert.match(src, /subject: safeSubject/);
});
