import Stripe from 'npm:stripe@20.4.1';
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { resolveBillingReturnUrl } from '../_shared/billingReturn.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
    apiVersion: '2026-02-25.clover',
    httpClient: Stripe.createFetchHttpClient(),
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
        const session = await stripe.billingPortal.sessions.create({
            customer: subscription.stripe_customer_id,
            return_url: returnUrl,
        });

        console.log('Portal session created:', session.id);

        return new Response(
            JSON.stringify({ url: session.url }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        );
    } catch (error) {
        console.error('Error creating portal session:', error);
        const message = error instanceof Error ? error.message : String(error);
        return new Response(
            JSON.stringify({ error: message }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500,
            }
        );
    }
});
