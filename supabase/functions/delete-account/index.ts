import Stripe from 'npm:stripe@20.4.1';
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { deleteStripeCustomer, runAccountDeletionStages } from '../_shared/accountDeletion.ts';
import { cleanupDocumentStorage } from '../_shared/documentStorageCleanup.js';

type AdminClient = ReturnType<typeof createClient<any>>;

const corsHeaders = {
  // INTENTIONAL: this Bearer-authenticated function is called from web,
  // Electron file://, Expo, and Capacitor. See CLAUDE.md CORS invariant.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

async function listOwnedStorage(
  admin: AdminClient,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.storage.from('documents').list(prefix, { limit: 100, offset });
    if (error) throw new Error(`Could not inspect stored documents: ${error.message}`);
    // A missing/malformed page is not proof that the account has no files.
    // Fail before final auth deletion; a later request can safely retry.
    if (!Array.isArray(data) || data.length > 100) {
      throw new Error('Could not verify stored document inventory');
    }
    const entries = data;
    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string' || !entry.name
        || entry.name === '.' || entry.name === '..' || /[\/\u0000-\u001f\u007f]/.test(entry.name)
        || !(entry.id === null || (typeof entry.id === 'string' && entry.id.length > 0))) {
        throw new Error('Could not verify a stored document entry');
      }
      const path = `${prefix}/${entry.name}`;
      if (entry.id) paths.push(path);
      else paths.push(...await listOwnedStorage(admin, path));
    }
    if (entries.length < 100) break;
  }
  return paths;
}

async function removeOwnedStorage(admin: AdminClient, userId: string) {
  // Files normally live directly below documents/<user-id>, but recursively
  // walk the prefix so a legacy/nested upload cannot survive account deletion.
  const paths = await listOwnedStorage(admin, userId);
  for (let offset = 0; offset < paths.length; offset += 100) {
    const cleanup = await cleanupDocumentStorage(admin, paths.slice(offset, offset + 100));
    if (cleanup.pendingPaths.length || cleanup.retainedPaths.length) {
      throw new Error('Stored documents are still pending safe cleanup. Account deletion can be retried.');
    }
  }
}

async function deleteOwnedRows(admin: AdminClient, userId: string) {
  // One RPC commits the closing fence and owned-row removal together, while
  // detaching collaborator-owned children. A lost reply stops this request;
  // repeating the RPC is safe and does not reopen publication.
  const { error } = await admin.rpc('delete_account_owned_rows', { target_user_id: userId });
  if (error) throw new Error(`Could not remove account data: ${error.message}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'Missing authorization header' });
    const body = await req.json().catch(() => ({}));
    if (body?.confirmation !== 'DELETE') return json(400, { error: 'Deletion confirmation is required' });

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json(503, { error: 'Account deletion is temporarily unavailable' });
    }

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await caller.auth.getUser();
    if (userError || !user) return json(401, { error: 'Unauthorized' });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: subscription, error: subscriptionError } = await admin
      .from('user_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (subscriptionError) throw subscriptionError;

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (subscription?.stripe_customer_id && !stripeKey) {
      return json(503, { error: 'Account deletion cannot safely cancel billing right now. Please try again later.' });
    }
    const stripe = stripeKey ? new Stripe(stripeKey, {
      apiVersion: '2026-02-25.clover',
      httpClient: Stripe.createFetchHttpClient(),
    }) : null;

    await runAccountDeletionStages({
      // Billing remains first so no account can be removed while still billable.
      // Missing Stripe customers are accepted for safe retries.
      cancelBilling: async () => {
        if (stripe) await deleteStripeCustomer(stripe, subscription?.stripe_customer_id);
      },
      deleteDatabaseRows: () => deleteOwnedRows(admin, user.id),
      removeStorage: () => removeOwnedStorage(admin, user.id),
      deleteAuthUser: async () => {
        const { error } = await admin.auth.admin.deleteUser(user.id);
        if (error) throw error;
      },
    });

    return json(200, { deleted: true });
  } catch (error) {
    console.error('delete-account failed', error instanceof Error ? error.message : String(error));
    return json(500, { error: 'Account deletion could not finish. Please try again or contact support.' });
  }
});
