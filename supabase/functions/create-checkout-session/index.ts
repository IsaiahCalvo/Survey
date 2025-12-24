
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { Stripe } from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Price ID mapping - Set these in Supabase Dashboard -> Edge Functions -> Secrets
// STRIPE_PRO_MONTHLY_PRICE_ID = price_xxx (for $9.99/month)
// STRIPE_PRO_ANNUAL_PRICE_ID = price_yyy (for $99/year)
// STRIPE_ENTERPRISE_PRICE_ID = price_zzz (for $20/user/month)

serve(async (req) => {
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
            apiVersion: '2025-12-15.clover',
            httpClient: Stripe.createFetchHttpClient(),
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
        const { tier = 'pro', billingPeriod = 'monthly' } = await req.json();

        // Validate tier
        if (!['pro', 'enterprise'].includes(tier)) {
            throw new Error('Invalid tier. Must be "pro" or "enterprise"');
        }

        // Get price ID based on tier and billing period
        let priceId: string;
        if (tier === 'pro') {
            if (billingPeriod === 'annual') {
                priceId = Deno.env.get('STRIPE_PRO_ANNUAL_PRICE_ID') || 'price_1SRsPPJrmRKkLZPfiAwkHYT6';
            } else {
                priceId = Deno.env.get('STRIPE_PRO_MONTHLY_PRICE_ID') || 'price_1SRsPPJrmRKkLZPfiAwkHYT6';
            }
        } else if (tier === 'enterprise') {
            priceId = Deno.env.get('STRIPE_ENTERPRISE_PRICE_ID') || 'price_1SRsPPJrmRKkLZPfiAwkHYT6';
        } else {
            throw new Error('Invalid tier');
        }

        // Check if user already has a Stripe customer ID
        const { data: subscription } = await supabase
            .from('user_subscriptions')
            .select('stripe_customer_id')
            .eq('user_id', user.id)
            .single();

        let customerId = subscription?.stripe_customer_id;

        // Create Stripe customer if doesn't exist
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                metadata: {
                    supabase_user_id: user.id,
                },
            });
            customerId = customer.id;

            // Update user_subscriptions with customer ID
            await supabase
                .from('user_subscriptions')
                .update({ stripe_customer_id: customerId })
                .eq('user_id', user.id);
        }

        // Get origin for redirect URLs
        const origin = req.headers.get('origin') || 'http://localhost:5173';

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
            success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/pricing`,
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

        const session = await stripe.checkout.sessions.create(sessionParams);

        return new Response(
            JSON.stringify({ url: session.url }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        )
    } catch (error) {
        console.error('Error creating checkout session:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        )
    }
})
