/* GOAL-1 — send-invite-email: thin Deno wrapper.
 *
 * All decision logic lives in ./handler.js (pure, dependency-injected,
 * covered by tests/goal1SendInviteEmailFn.test.mjs in the node suite).
 * This file only wires real dependencies:
 *   - caller-scoped client (ANON key + the caller's own Authorization
 *     header) for the invite-row lookup, so RLS owner-select policies
 *     decide visibility — NEVER the service role;
 *   - service-role client ONLY for auth.admin.inviteUserByEmail;
 *   - caller-JWT fetch to the deployed send-email function for the
 *     existing-account branch. The payload remains fully server-derived.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { handleSendInviteEmail, CORS_HEADERS } from './handler.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const COMMON_INVITE_COLUMNS = 'token,target_email,revoked_at,accepted_at,expires_at,intended_role,role';
const inviteColumns = (table: string) => table === 'document_invites'
  ? `document_id,${COMMON_INVITE_COLUMNS}`
  : COMMON_INVITE_COLUMNS;

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') || '';

  let body: unknown = null;
  try { body = await req.json(); } catch { /* handler 400s on missing token */ }

  // Caller-scoped client: RLS runs as the calling user.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const deps = {
    anonKey: ANON_KEY,
    getUserFromToken: async (jwt: string) => {
      try {
        const { data, error } = await createClient(SUPABASE_URL, ANON_KEY).auth.getUser(jwt);
        return error ? null : (data?.user ?? null);
      } catch {
        return null;
      }
    },
    selectInviteRow: async (table: string, token: string) => {
      const { data, error } = await callerClient
        .from(table)
        .select(inviteColumns(table))
        .eq('token', token)
        .maybeSingle();
      if (error) return null;
      return data ?? null;
    },
    selectActiveDocumentAccess: async (documentId: string, email: string) => {
      const { data, error } = await callerClient
        .from('document_collaborators')
        .select('role')
        .eq('document_id', documentId)
        .ilike('email', email)
        .eq('status', 'active')
        .maybeSingle();
      if (error) return null;
      return data ?? null;
    },
    newClaimId: () => crypto.randomUUID(),
    claimInviteDelivery: async (kind: string, token: string, claimId: string) => {
      const { data, error } = await callerClient.rpc('claim_invite_email_delivery', {
        p_kind: kind,
        p_token: token,
        p_claim_id: claimId,
        p_stale_after_seconds: 300,
      });
      if (error) {
        console.error('[send-invite-email] claim RPC failed:', error.message);
        return 'error';
      }
      return data;
    },
    claimEmailSend: async (template: string, recipient: string, isInvite: boolean) => {
      const { data, error } = await callerClient.rpc('claim_email_send', {
        p_template: template,
        p_recipient: recipient,
        p_is_invite: isInvite,
      });
      if (error) {
        console.error('[send-invite-email] claim_email_send RPC failed:', error.message);
        return 'error';
      }
      return data;
    },
    completeInviteDelivery: async (claimId: string) => {
      const { data, error } = await callerClient.rpc('complete_invite_email_delivery', {
        p_claim_id: claimId,
      });
      if (error) {
        console.error('[send-invite-email] completion RPC failed:', error.message);
        return false;
      }
      return data === true;
    },
    releaseInviteDelivery: async (claimId: string) => {
      const { data, error } = await callerClient.rpc('release_invite_email_delivery', {
        p_claim_id: claimId,
      });
      if (error) {
        console.error('[send-invite-email] release RPC failed:', error.message);
        return false;
      }
      return data === true;
    },
    inviteUserByEmail: async (email: string, redirectTo: string) => {
      try {
        const { error } = await adminClient.auth.admin.inviteUserByEmail(email, { redirectTo });
        if (!error) return { error: null, outcome: 'confirmed' as const };
        const status = Number(error.status) || 0;
        // A received 4xx is an authoritative pre-send rejection. A 5xx (or an
        // error without a status) may have happened after the mailer accepted
        // the request, so fail closed and retain the delivery claim.
        return {
          error,
          outcome: status >= 400 && status < 500
            ? 'definite-failure' as const
            : 'uncertain' as const,
        };
      } catch (e) {
        // Network/transport exceptions can occur after the provider accepted
        // the request. Preserve that uncertainty so the handler never unlocks
        // this delivery generation for an automatic duplicate.
        return {
          error: { code: 'invite_threw', message: String(e) },
          outcome: 'uncertain' as const,
        };
      }
    },
    sendFallbackEmail: async (payload: { to: string; subject: string; template: string; data: object }) => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Modern Supabase service keys use the sb_secret_ format, not a
            // JWT, so the Edge gateway rejects them in Authorization before
            // send-email can authenticate the request. Forward the already
            // validated caller JWT; recipient/template/links are still
            // derived above and never accepted from the browser.
            apikey: ANON_KEY,
            Authorization: authHeader,
          },
          body: JSON.stringify(payload),
        });
        let responseBody: { success?: boolean } | null = null;
        try { responseBody = await res.json(); } catch { /* invalid body is failure */ }
        if (res.ok && responseBody?.success === true) {
          return { outcome: 'confirmed' as const };
        }
        if (res.status >= 400 && res.status < 500) {
          return { outcome: 'definite-failure' as const };
        }
        // A 2xx with an invalid body or any 5xx can be a lost confirmation
        // after the inner send-email function/provider accepted the message.
        return { outcome: 'uncertain' as const };
      } catch {
        return { outcome: 'uncertain' as const };
      }
    },
  };

  const out = await handleSendInviteEmail({ method: req.method, authHeader, body }, deps);
  return new Response(out.body == null ? null : JSON.stringify(out.body), {
    status: out.status,
    headers: out.body == null
      ? { ...CORS_HEADERS }
      : { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
