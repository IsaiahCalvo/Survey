import test from 'node:test';
import {
  deepStrictEqual,
  equal,
} from 'node:assert/strict';

import {
  handleSendInviteEmail,
} from '../supabase/functions/send-invite-email/handler.js';

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const ROW = {
  token: 'shared-token',
  document_id: '11111111-2222-3333-4444-555555555555',
  target_email: 'invitee@example.com',
  revoked_at: null,
  accepted_at: null,
  expires_at: FUTURE,
  intended_role: 'editor',
  role: 'editor',
};

function post() {
  return {
    method: 'POST',
    authHeader: 'Bearer owner-jwt',
    body: { token: ROW.token, displayName: 'Site Plan.pdf', inviterName: 'Isaiah' },
  };
}

function deliveryStore() {
  let state = null;
  return {
    claimInviteDelivery: async (_kind, _token, claimId) => {
      if (state?.status === 'completed') return 'completed';
      if (state?.status === 'claimed') return 'busy';
      state = { status: 'claimed', claimId };
      return 'claimed';
    },
    completeInviteDelivery: async (claimId) => {
      if (state?.status !== 'claimed' || state.claimId !== claimId) return false;
      state = { status: 'completed', claimId };
      return true;
    },
    releaseInviteDelivery: async (claimId) => {
      if (state?.status !== 'claimed' || state.claimId !== claimId) return false;
      state = null;
      return true;
    },
    getState: () => state,
  };
}

function depsWith(store, inviteUserByEmail) {
  return {
    anonKey: 'anon',
    getUserFromToken: async () => ({ id: 'owner-id' }),
    selectInviteRow: async (table) => (table === 'document_invites' ? ROW : null),
    selectActiveDocumentAccess: async () => null,
    inviteUserByEmail,
    sendFallbackEmail: async () => true,
    newClaimId: (() => {
      let n = 0;
      return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    })(),
    ...store,
  };
}

test('simultaneous requests atomically permit one transport send and completed retries do not resend', async () => {
  const store = deliveryStore();
  let releaseTransport;
  let transportStarted;
  const started = new Promise((resolve) => { transportStarted = resolve; });
  const blocked = new Promise((resolve) => { releaseTransport = resolve; });
  let sends = 0;
  const deps = depsWith(store, async () => {
    sends += 1;
    transportStarted();
    await blocked;
    return { error: null };
  });

  const first = handleSendInviteEmail(post(), deps);
  await started;
  const second = await handleSendInviteEmail(post(), deps);

  deepStrictEqual(second, {
    status: 202,
    body: { sent: false, retryable: true, error: 'Delivery in progress' },
  });
  equal(sends, 1);

  releaseTransport();
  deepStrictEqual(await first, { status: 200, body: { sent: true } });
  equal(store.getState()?.status, 'completed');

  deepStrictEqual(
    await handleSendInviteEmail(post(), deps),
    { status: 200, body: { sent: true } },
  );
  equal(sends, 1, 'completed delivery must be an idempotent no-op');
});

test('failed transport releases its claim so a later retry can deliver', async () => {
  const store = deliveryStore();
  let sends = 0;
  const deps = depsWith(store, async () => {
    sends += 1;
    return sends === 1
      ? { error: { code: 'transport_down', status: 503, message: 'down' } }
      : { error: null };
  });

  deepStrictEqual(await handleSendInviteEmail(post(), deps), {
    status: 502,
    body: { sent: false, retryable: true, error: 'Send failed' },
  });
  equal(store.getState(), null, 'a confirmed failure must not strand the claim');

  deepStrictEqual(
    await handleSendInviteEmail(post(), deps),
    { status: 200, body: { sent: true } },
  );
  equal(sends, 2);
  equal(store.getState()?.status, 'completed');
});

test('uncertain auth-mailer outcome retains its claim and cannot duplicate on retry', async () => {
  const store = deliveryStore();
  let sends = 0;
  const deps = depsWith(store, async () => {
    sends += 1;
    return {
      error: { code: 'invite_threw', message: 'response lost' },
      outcome: 'uncertain',
    };
  });

  deepStrictEqual(await handleSendInviteEmail(post(), deps), {
    status: 502,
    body: { sent: false, retryable: false, error: 'Delivery outcome unknown' },
  });
  equal(store.getState()?.status, 'claimed');

  deepStrictEqual(await handleSendInviteEmail(post(), deps), {
    status: 202,
    body: { sent: false, retryable: true, error: 'Delivery in progress' },
  });
  equal(sends, 1, 'uncertain mailer outcome must never resend the same generation');
});

test('uncertain fallback outcome retains its claim and cannot duplicate on retry', async () => {
  const store = deliveryStore();
  let fallbackSends = 0;
  const deps = depsWith(
    store,
    async () => ({ error: { code: 'email_exists', status: 422 } }),
  );
  deps.sendFallbackEmail = async () => {
    fallbackSends += 1;
    return { outcome: 'uncertain' };
  };

  deepStrictEqual(await handleSendInviteEmail(post(), deps), {
    status: 502,
    body: { sent: false, retryable: false, error: 'Delivery outcome unknown' },
  });
  equal(store.getState()?.status, 'claimed');

  deepStrictEqual(await handleSendInviteEmail(post(), deps), {
    status: 202,
    body: { sent: false, retryable: true, error: 'Delivery in progress' },
  });
  equal(fallbackSends, 1, 'uncertain fallback outcome must never resend the same generation');
});

test('new-user and existing-user successful delivery responses remain identical', async () => {
  const newUser = depsWith(deliveryStore(), async () => ({ error: null }));
  const existing = depsWith(
    deliveryStore(),
    async () => ({ error: { code: 'email_exists', status: 422 } }),
  );

  deepStrictEqual(
    await handleSendInviteEmail(post(), newUser),
    { status: 200, body: { sent: true } },
  );
  deepStrictEqual(
    await handleSendInviteEmail(post(), existing),
    { status: 200, body: { sent: true } },
  );
});

test('new-user and existing-user delivery failures remain the same generic retryable response', async () => {
  const newUser = depsWith(
    deliveryStore(),
    async () => ({ error: { code: 'transport_down', status: 503 } }),
  );
  const existingStore = deliveryStore();
  const existing = depsWith(
    existingStore,
    async () => ({ error: { code: 'email_exists', status: 422 } }),
  );
  existing.sendFallbackEmail = async () => false;

  const expected = {
    status: 502,
    body: { sent: false, retryable: true, error: 'Send failed' },
  };
  deepStrictEqual(await handleSendInviteEmail(post(), newUser), expected);
  deepStrictEqual(await handleSendInviteEmail(post(), existing), expected);
});
