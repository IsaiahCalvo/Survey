import Stripe from 'npm:stripe@20.4.1';
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { deleteStripeCustomer, runAccountDeletionStages } from '../_shared/accountDeletion.ts';
import { isAgentSession, AGENT_REFUSED_MESSAGE } from '../_shared/agentSession.ts';
import { parseBody, s } from '../_shared/inputSchema.js';

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

type StoredObject = { bucket_id: string; name: string };

async function listOwnedStorage(admin: AdminClient, userId: string): Promise<StoredObject[]> {
  // Names PDFs, avatars, survey media and thumbnails. Media is keyed by
  // document id, so this must run while the document rows still exist.
  const { data, error } = await admin.rpc('account_deletion_storage_objects', { target_user_id: userId });
  if (error) throw new Error(`Could not inspect stored files: ${error.message}`);
  return (data || []) as StoredObject[];
}

async function removeOwnedStorage(admin: AdminClient, objects: StoredObject[]) {
  const byBucket = new Map<string, string[]>();
  for (const { bucket_id, name } of objects) {
    byBucket.set(bucket_id, [...(byBucket.get(bucket_id) || []), name]);
  }
  for (const [bucket, paths] of byBucket) {
    for (let offset = 0; offset < paths.length; offset += 100) {
      const { error } = await admin.storage.from(bucket).remove(paths.slice(offset, offset + 100));
      if (error) throw new Error(`Could not remove stored files: ${error.message}`);
    }
  }
}

async function deleteOwnedRows(admin: AdminClient, userId: string) {
  // One RPC means all owned database rows commit or roll back together.
  const { error } = await admin.rpc('delete_account_owned_rows', { target_user_id: userId });
  if (error) throw new Error(`Could not remove account data: ${error.message}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'Missing authorization header' });
    const parsed = parseBody({ confirmation: s.enum(['DELETE']) }, await req.json().catch(() => ({})));
    const body = parsed.ok ? parsed.value : null;
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
    if (isAgentSession(authHeader)) return json(403, { error: AGENT_REFUSED_MESSAGE });

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

    let storedObjects: StoredObject[] = [];
    await runAccountDeletionStages({
      // Billing remains first so no account can be removed while still billable.
      // Missing Stripe customers are accepted for safe retries.
      cancelBilling: async () => {
        if (stripe) await deleteStripeCustomer(stripe, subscription?.stripe_customer_id);
      },
      deleteDatabaseRows: async () => {
        storedObjects = await listOwnedStorage(admin, user.id);
        await deleteOwnedRows(admin, user.id);
      },
      removeStorage: () => removeOwnedStorage(admin, storedObjects),
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
