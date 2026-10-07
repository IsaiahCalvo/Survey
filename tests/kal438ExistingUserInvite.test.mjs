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
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
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
  let delivered = false;
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
      newClaimId: () => '00000000-0000-4000-8000-000000000001',
      claimInviteDelivery: async () => (delivered ? 'completed' : 'claimed'),
      completeInviteDelivery: async () => {
        delivered = true;
        return true;
      },
      releaseInviteDelivery: async () => true,
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

async function loadDocumentInviteService({ supabase, sendInviteEmailSmart }) {
  const supabaseKey = `__kal438_supabase_${Date.now()}_${Math.random()}`;
  const senderKey = `__kal438_sender_${Date.now()}_${Math.random()}`;
  globalThis[supabaseKey] = supabase;
  globalThis[senderKey] = sendInviteEmailSmart;

  const source = read('src/services/documentInviteService.js')
    .replace(
      "import { supabase } from '../supabaseClient';",
      `const supabase = globalThis[${JSON.stringify(supabaseKey)}];`,
    )
    .replace(
      /import \{\s*inviteEmailFailureMessage,\s*sendInviteEmailSmart,\s*\} from '\.\/shareEmailService';/,
      `const sendInviteEmailSmart = globalThis[${JSON.stringify(senderKey)}];
const inviteEmailFailureMessage = (result, { completedAction, retryInstruction }) =>
  result?.deliveryUncertain || result?.retryable === false
    ? \`\${completedAction}, but we couldn't confirm the email was sent.\`
    : \`\${completedAction}, but the email didn't send. \${retryInstruction}\`;`,
    );

  try {
    return await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  } finally {
    delete globalThis[supabaseKey];
    delete globalThis[senderKey];
  }
}

async function loadShareEmailService(invoke) {
  const supabaseKey = `__kal438_share_supabase_${Date.now()}_${Math.random()}`;
  globalThis[supabaseKey] = { functions: { invoke } };
  const source = read('src/services/shareEmailService.js').replace(
    "import { supabase } from '../supabaseClient';",
    `const supabase = globalThis[${JSON.stringify(supabaseKey)}];`,
  );
  try {
    return await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  } finally {
    delete globalThis[supabaseKey];
  }
}

function makeDocumentServiceHarness({
  existingGrant = true,
  markerFailures = 0,
  lostResponses = 0,
} = {}) {
  const row = { ...BASE_ROW };
  let deliveryGeneration = 'initial-delivery-generation';
  let refreshes = 0;
  let rotations = 0;
  let markerAttempts = 0;
  let transports = 0;
  let sendCalls = 0;
  const completedGenerations = new Set();

  const supabase = {
    rpc: async (name) => {
      if (name === 'check_collaborator_by_email') {
        return {
          data: existingGrant
            ? [{ user_id: 'existing-user-id', email: row.target_email }]
            : [],
          error: null,
        };
      }
      if (name === 'kal31_resend_document_invite') {
        refreshes += 1;
        row.expires_at = new Date(Date.now() + (refreshes + 2) * 86400000).toISOString();
        return { data: row.expires_at, error: null };
      }
      if (name === 'rotate_invite_email_delivery') {
        rotations += 1;
        deliveryGeneration = `delivery-generation-${rotations}`;
        row.expires_at = new Date(Date.now() + (rotations + 10) * 86400000).toISOString();
        return {
          data: {
            deliveryVersion: deliveryGeneration,
            expiresAt: row.expires_at,
          },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from: (table) => {
      if (table === 'document_collaborators') {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({
            data: existingGrant ? { role: 'editor' } : null,
            error: null,
          }),
        };
        return query;
      }
      if (table !== 'document_invites') throw new Error(`Unexpected table ${table}`);

      let updating = false;
      let updatePayload = null;
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({ data: { ...row }, error: null }),
        update: (payload) => {
          updating = true;
          updatePayload = payload;
          return query;
        },
        maybeSingle: async () => {
          if (!updating) return { data: { ...row }, error: null };
          markerAttempts += 1;
          if (markerAttempts <= markerFailures) {
            return { data: null, error: { message: 'simulated marker failure' } };
          }
          Object.assign(row, updatePayload);
          return {
            data: {
              accepted_at: row.accepted_at,
              accepted_by: row.accepted_by,
              accepted_role: row.accepted_role,
            },
            error: null,
          };
        },
      };
      return query;
    },
  };

  const sendInviteEmailSmart = async () => {
    sendCalls += 1;
    const deduplicated = completedGenerations.has(deliveryGeneration);
    if (!completedGenerations.has(deliveryGeneration)) {
      completedGenerations.add(deliveryGeneration);
      transports += 1;
    }
    if (sendCalls <= lostResponses) throw new Error('simulated lost HTTP response');
    return { success: true, response: { deduplicated } };
  };

  return {
    supabase,
    sendInviteEmailSmart,
    counts: () => ({ refreshes, rotations, markerAttempts, transports }),
  };
}

test('KAL-438: existing paid user gets a server-derived direct document notification without the consumed token', async () => {
  const { deps, calls } = makeDeps();
  const out = await handleSendInviteEmail(post(), deps);

  deepStrictEqual(out, { status: 200, body: { sent: true } });
  equal(calls.fallback.length, 1);
  const payload = calls.fallback[0];
  equal(payload.to, BASE_ROW.target_email);
  equal(payload.template, 'document-shared');
  equal(payload.data.role, 'Editor');
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
  equal(calls.fallback[0].data.role, 'Viewer (Editor activates after upgrade)');
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
    body: { sent: false, retryable: true, error: 'Send failed' },
  });
});

test('KAL-438: client treats {sent:false} honestly and warns on uncertain delivery', () => {
  const documentService = read('src/services/documentInviteService.js');
  const shareService = read('src/services/shareEmailService.js');

  match(shareService, /if \(data\?\.sent !== true\)/);
  match(shareService, /success:\s*false/);
  match(documentService, /if \(!emailResult\?\.success\)/);
  match(documentService, /accessGranted:\s*!!pendingAcceptanceMarker/);
  match(documentService, /emailSent:\s*false/);
  match(documentService, /inviteEmailFailureMessage/);
  match(shareService, /deliveryUncertain/);
  match(shareService, /couldn't confirm the email was sent/);
  match(shareService, /retryable:\s*false/);

  const createStart = documentService.indexOf('export async function createDocumentInvite');
  const createEnd = documentService.indexOf('export async function listDocumentInvites');
  const createSource = documentService.slice(createStart, createEnd);
  const failureReturn = createSource.indexOf('if (!emailResult?.success)');
  const acceptedMarker = createSource.indexOf('markExistingUserInviteAccepted(');
  ok(
    failureReturn >= 0 && acceptedMarker > failureReturn,
    'failed delivery must return before marking the existing-user invite accepted',
  );
});

test('KAL-438: a structured retryable 502 remains a definite unsent failure', async () => {
  const service = await loadShareEmailService(async () => ({
    data: { sent: false, retryable: true, error: 'Send failed' },
    error: {
      message: 'Edge Function returned a non-2xx status code',
      context: { status: 502 },
    },
  }));

  const result = await service.sendInviteEmailSmart({
    token: BASE_ROW.token,
    kind: 'document',
    name: 'Site Plan.pdf',
    inviterName: 'Isaiah',
  });

  equal(result.success, false);
  equal(result.retryable, true);
  equal(result.deliveryUncertain, false);
  equal(result.error, 'Send failed');
});

test('KAL-438: failed existing-user close is honest and retry closes without a second transport', async () => {
  const harness = makeDocumentServiceHarness({ markerFailures: 1 });
  const service = await loadDocumentInviteService(harness);

  const first = await service.resendDocumentInvite(BASE_ROW.id);
  equal(first.success, false);
  equal(first.emailSent, true);
  equal(first.retryable, true);
  match(first.error, /delivered.*could not be closed/i);
  deepStrictEqual(harness.counts(), {
    refreshes: 0,
    rotations: 0,
    markerAttempts: 1,
    transports: 1,
  });

  const second = await service.resendDocumentInvite(BASE_ROW.id);
  equal(second.success, true);
  equal(second.emailSent, true);
  deepStrictEqual(harness.counts(), {
    refreshes: 0,
    rotations: 0,
    markerAttempts: 2,
    transports: 1,
  });
});

test('KAL-438: lost new-user response retries the same generation without a second transport', async () => {
  const harness = makeDocumentServiceHarness({
    existingGrant: false,
    lostResponses: 1,
  });
  const service = await loadDocumentInviteService(harness);

  const lost = await service.resendDocumentInvite(BASE_ROW.id);
  equal(lost.success, false);
  equal(lost.emailSent, false);

  const retried = await service.resendDocumentInvite(BASE_ROW.id);
  equal(retried.success, true);
  equal(retried.emailSent, true);
  deepStrictEqual(harness.counts(), {
    refreshes: 2,
    rotations: 0,
    markerAttempts: 0,
    transports: 1,
  });
});

test('KAL-438: explicit new-delivery intent rotates once and sends a legitimate new copy', async () => {
  const harness = makeDocumentServiceHarness({ existingGrant: false });
  const service = await loadDocumentInviteService(harness);

  equal((await service.resendDocumentInvite(BASE_ROW.id)).success, true);
  const intentional = await service.resendDocumentInvite(BASE_ROW.id, {
    forceNewDelivery: true,
  });
  equal(intentional.success, true);
  deepStrictEqual(harness.counts(), {
    refreshes: 1,
    rotations: 1,
    markerAttempts: 0,
    transports: 2,
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
  equal(calls.fallback[0].template, 'document-shared');
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

test('KAL-438: direct-share email copy describes a first share, not a permission change', () => {
  const emailFunction = read('supabase/functions/send-email/index.ts');
  const templateStart = emailFunction.indexOf("'document-shared':");
  const templateEnd = emailFunction.indexOf("'permission-changed':", templateStart);
  ok(templateStart >= 0 && templateEnd > templateStart);
  const directShareTemplate = emailFunction.slice(templateStart, templateEnd);
  match(directShareTemplate, /shared .* with you/i);
  match(directShareTemplate, /Access is already active/);
  equal(/changed your access|Permission changes/i.test(directShareTemplate), false);
});

test('KAL-438: AppShell consumes the server-built document deep link', () => {
  const appShell = read('src/AppShell.jsx');
  match(appShell, /new URLSearchParams\(window\.location\.search\)\.get\('docId'\)/);
  match(appShell, /documents\.find\(/);
  match(appShell, /handleDocumentSelect\(\s*fileToOpen/);
  match(appShell, /url\.searchParams\.delete\('docId'\)/);
});
