
import Stripe from "npm:stripe@20.4.1";
import { createClient } from 'npm:@supabase/supabase-js@2.110.8'
import { resolveBillingReturnUrl, withBillingResult } from '../_shared/billingReturn.ts';
import { BILLING_API_VERSION, BillingPendingError, BillingClosedError, resolveBillingProviderScope,
    recoverBillingOperations, recoveredBillingSession, executeBillingOperation, rotateBillingCustomer } from '../_shared/billingLifecycle.ts';

const corsHeaders = {
    // ⚠️ INTENTIONAL — do NOT tighten to an origin allowlist (false positive if an
    // audit flags it). Same bundle ships to web + Electron prod (file:// → Origin:
    // null) + Capacitor iOS/Android; an allowlist CORS-breaks email/Excel/payments
    // on desktop+mobile, and Electron would then need Origin:null allowed — the very
    // hole tightening tries to close. Bearer-token auth (not cookies) ⇒ '*' is
    // non-exploitable. Why: CLAUDE.md "DO NOT BREAK" + HANDOFF-post-launch-hardening.md
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Price ID mapping - Set these in Supabase Dashboard -> Edge Functions -> Secrets
// STRIPE_PRO_MONTHLY_PRICE_ID = price_xxx (for $9.99/month)
// STRIPE_PRO_ANNUAL_PRICE_ID = price_yyy (for $99/year)
// STRIPE_ENTERPRISE_PRICE_ID = price_zzz (for $20/user/month)

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Initialize Stripe
        const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
        if (!secretKey) {
            throw new Error('STRIPE_SECRET_KEY is not set in environment variables.');
        }

        const stripe = new Stripe(secretKey, {
            apiVersion: BILLING_API_VERSION,
            httpClient: Stripe.createFetchHttpClient(),
        maxNetworkRetries: 0,
        timeout: 15000,
        })

        // Initialize Supabase client
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Get user from JWT
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            throw new Error('No authorization header');
        }

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError || !user) {
            throw new Error('Invalid user token');
        }

        // Parse request body
        const { tier = 'pro', billingPeriod = 'monthly', returnUrl } = await req.json();

        // Validate tier
        if (!['pro', 'enterprise'].includes(tier)) {
            throw new Error('Invalid tier. Must be "pro" or "enterprise"');
        }

        // Get price ID based on tier and billing period. Fail loudly if the
        // required price secret is unset — never silently fall back to a shared
        // placeholder price, which would charge the pro-monthly amount for an
        // annual/enterprise checkout while still granting the higher tier.
        const requirePrice = (name: string): string => {
            const v = Deno.env.get(name);
            if (!v) throw new Error(`Billing is not fully configured (missing ${name})`);
            return v;
        };
        let priceId: string;
        if (tier === 'pro') {
            priceId = requirePrice(billingPeriod === 'annual' ? 'STRIPE_PRO_ANNUAL_PRICE_ID' : 'STRIPE_PRO_MONTHLY_PRICE_ID');
        } else if (tier === 'enterprise') {
            priceId = requirePrice('STRIPE_ENTERPRISE_PRICE_ID');
        } else {
            throw new Error('Invalid tier');
        }

        const scope = await resolveBillingProviderScope(stripe, secretKey);
        const recovery = await recoverBillingOperations({ db: supabase, stripe, scope, userId: user.id });
        if (recovery.closing) throw new BillingClosedError();
        if (recovery.pending || recovery.errors) throw new BillingPendingError();

        // The scope is verified against the actual Stripe account. A generic
        // missing-customer response cannot prove a legacy customer was canceled
        // in a different mode/account, so it must not silently create new billing.
        const { data: subscription, error: subscriptionError } = await supabase
            .from('user_subscriptions')
            .select('stripe_customer_id')
            .eq('user_id', user.id)
            .maybeSingle();
        if (subscriptionError) throw subscriptionError;

        let storedCustomerId = subscription?.stripe_customer_id ?? null;
        if (storedCustomerId) {
            let existing;
            try {
                existing = await stripe.customers.retrieve(storedCustomerId);
            } catch {
                throw new BillingPendingError('The saved billing customer needs review before starting new billing.');
            }
            if (existing.object !== 'customer' || existing.id !== storedCustomerId) throw new BillingPendingError();
            if (existing.deleted) {
                storedCustomerId = await rotateBillingCustomer({ db: supabase, scope, userId: user.id,
                    expectedCustomerId: storedCustomerId });
            } else if (existing.livemode !== (scope.mode === 'live')) {
                throw new BillingPendingError();
            }
        }
        if (!storedCustomerId) {
            const recovered = recovery.recoveredCustomers[0];
            const created = recovered || await executeBillingOperation({ db: supabase, stripe, scope,
                userId: user.id, kind: 'customer_create', spec: { email: user.email } });
            storedCustomerId = await rotateBillingCustomer({ db: supabase, scope, userId: user.id,
                expectedCustomerId: null, operationId: created.operationId });
        }
        if (!storedCustomerId) throw new BillingPendingError();
        const customerId = storedCustomerId;

        const billingReturnUrl = resolveBillingReturnUrl(returnUrl, req.headers.get('origin'));

        // Create checkout session
        const sessionParams: Stripe.Checkout.SessionCreateParams = {
            customer: customerId,
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: withBillingResult(billingReturnUrl, 'success'),
            cancel_url: withBillingResult(billingReturnUrl, 'cancelled'),
            metadata: {
                user_id: user.id,
                tier: tier,
                billing_period: billingPeriod,
            },
            subscription_data: {
                metadata: {
                    user_id: user.id,
                    tier: tier,
                },
            },
        };

        // Add 7-day trial for Pro tier
        if (tier === 'pro') {
            sessionParams.subscription_data = {
                ...sessionParams.subscription_data,
                trial_period_days: 7,
            };
        }

        const checkout = recoveredBillingSession(recovery, 'checkout_create', sessionParams)
            ?? (await executeBillingOperation({ db: supabase, stripe, scope, userId: user.id,
                kind: 'checkout_create', customerId, spec: sessionParams })).result;
        if (!checkout.data.url) throw new BillingPendingError();

        return new Response(
            JSON.stringify({ url: checkout.data.url }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        )
    } catch (error) {
        console.error('Error creating checkout session:', error);
        const message = error instanceof Error ? error.message : 'Billing could not finish.';
        return new Response(
            JSON.stringify({ error: message, pending: error instanceof BillingPendingError,
                code: error instanceof BillingPendingError || error instanceof BillingClosedError ? error.code : 'billing-error' }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        )
    }
})
