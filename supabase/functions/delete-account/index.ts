import Stripe from 'npm:stripe@20.4.1';
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { deleteStripeCustomer, runAccountDeletionStages } from '../_shared/accountDeletion.ts';
import { cleanupAccountStorage } from '../_shared/accountStorageCleanup.js';

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

class AccountCleanupPending extends Error {}

async function removeOwnedStorage(admin: AdminClient, userId: string) {
  const cleanup = await cleanupAccountStorage(admin, userId);
  if (!cleanup.complete) {
    // The closing fence and cursor persist. Never proceed to auth deletion
    // merely because the current request ran out of time or work budget.
    throw new AccountCleanupPending('Account cleanup is not finished. Retry deletion to continue; shared files may need review.');
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
    if (error instanceof AccountCleanupPending) {
      return json(202, { deleted: false, pending: true, code: 'account-cleanup-pending', error: error.message });
    }
    console.error('delete-account failed', error instanceof Error ? error.message : String(error));
    return json(500, { error: 'Account deletion could not finish. Please try again or contact support.' });
  }
});
