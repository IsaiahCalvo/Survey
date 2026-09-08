import Stripe from 'npm:stripe@20.4.1';
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { resolveBillingReturnUrl } from '../_shared/billingReturn.ts';
import { BILLING_API_VERSION, BillingPendingError, BillingClosedError, resolveBillingProviderScope,
    recoverBillingOperations, recoveredBillingSession, executeBillingOperation, rotateBillingCustomer } from '../_shared/billingLifecycle.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
    apiVersion: BILLING_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 0,
    timeout: 15000,
});

const corsHeaders = {
    // ⚠️ INTENTIONAL — do NOT tighten to an origin allowlist (false positive if an
    // audit flags it). Same bundle ships to web + Electron prod (file:// → Origin:
    // null) + Capacitor iOS/Android; an allowlist CORS-breaks email/Excel/payments
    // on desktop+mobile, and Electron would then need Origin:null allowed — the very
    // hole tightening tries to close. Bearer-token auth (not cookies) ⇒ '*' is
    // non-exploitable. Why: CLAUDE.md "DO NOT BREAK" + HANDOFF-post-launch-hardening.md
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        // Get the user from the request
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Missing authorization header' }),
                {
                    status: 401,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            );
        }

        // Initialize Supabase client
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: {
                headers: { Authorization: authHeader },
            },
        });

        // Get the authenticated user
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                {
                    status: 401,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            );
        }

        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
        if (!serviceKey || !stripeKey) throw new BillingPendingError('Billing is not fully configured.');
        const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const scope = await resolveBillingProviderScope(stripe, stripeKey);
        const recovery = await recoverBillingOperations({ db: admin, stripe, scope, userId: user.id });
        if (recovery.closing) throw new BillingClosedError();
        if (recovery.pending || recovery.errors) throw new BillingPendingError();

        console.log('Creating portal session for user:', user.id);

        // Get user's Stripe customer ID
        const { data: subscription, error: subError } = await supabase
            .from('user_subscriptions')
            .select('stripe_customer_id')
            .eq('user_id', user.id)
            .single();

        if (subError || !subscription?.stripe_customer_id) {
            return new Response(
                JSON.stringify({ error: 'No Stripe customer found. Please start a subscription first.' }),
                {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            );
        }

        console.log('Customer ID:', subscription.stripe_customer_id);

        const body = await req.json().catch(() => ({}));
        const returnUrl = resolveBillingReturnUrl(body?.returnUrl, req.headers.get('origin'));
        const existing = await stripe.customers.retrieve(subscription.stripe_customer_id);
        if (existing.object !== 'customer' || existing.id !== subscription.stripe_customer_id) throw new BillingPendingError();
        const deletionMarker: unknown = Reflect.get(existing, 'deleted');
        if (existing.deleted === true) {
            await rotateBillingCustomer({ db: admin, scope, userId: user.id,
                expectedCustomerId: subscription.stripe_customer_id });
            return new Response(JSON.stringify({ error: 'No active billing customer found. Please start a subscription first.' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if ((deletionMarker !== undefined && deletionMarker !== false) || existing.livemode !== (scope.mode === 'live')) throw new BillingPendingError();
        const sessionParams = {
                customer: subscription.stripe_customer_id,
                return_url: returnUrl,
            };
        const operation = recoveredBillingSession(recovery, 'portal_create', sessionParams)
            ?? (await executeBillingOperation({ db: admin, stripe, scope, userId: user.id,
                kind: 'portal_create', customerId: subscription.stripe_customer_id, spec: sessionParams })).result;
        if (!operation.data.url) throw new BillingPendingError();

        return new Response(
            JSON.stringify({ url: operation.data.url }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        );
    } catch (error) {
        console.error('Error creating portal session:', error);
        const message = error instanceof Error ? error.message : String(error);
        return new Response(
            JSON.stringify({ error: message, pending: error instanceof BillingPendingError,
                code: error instanceof BillingPendingError || error instanceof BillingClosedError ? error.code : 'billing-error' }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500,
            }
        );
    }
});
