// Checkout for the Kal Voe suite (KAL-856): Survey Pro, Walkthru Pro or the
// Kal Voe Suite, monthly or yearly, from kalvoe.com/buy or from inside an app.
//
// No sign-in: the plan belongs to the email the buyer pays with, and each app
// turns it on for the account with that confirmed email (see the migration
// 20261128030000_suite_entitlements.sql and stripe-webhook). When an app knows
// the person's email it passes it, and Stripe shows it fixed on the page so the
// plan lands on that account.
import Stripe from 'npm:stripe@20.4.1';
import { parseBody, s } from '../_shared/inputSchema.js';
import {
    LOOKUP_KEYS, PENDING_PLANS, PLAN_NAMES, SELLABLE_PLANS, cleanEmail, suiteReturnUrl,
} from '../_shared/suitePlans.js';

const corsHeaders = {
    // Public, cookie-less endpoint called from kalvoe.com and the apps.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const TRIAL_DAYS = 7;

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

    try {
        const parsed = parseBody({
            plan: s.enum(['survey', 'walkthru', 'plot', 'suite']),
            cycle: s.enum(['monthly', 'yearly'], { optional: true }),
            email: s.string({ max: 254, optional: true }),
            returnUrl: s.string({ max: 2048, optional: true }),
        }, await req.json().catch(() => ({})));
        if (!parsed.ok) return json({ error: parsed.error }, 400);
        const { plan, cycle = 'monthly', email: rawEmail, returnUrl } = parsed.value as {
            plan: keyof typeof LOOKUP_KEYS, cycle?: 'monthly' | 'yearly', email?: string, returnUrl?: string,
        };

        if (PENDING_PLANS.includes(plan)) {
            return json({ error: 'Checkout for this plan opens soon. Email us and we will set it up for you.' }, 409);
        }
        if (!SELLABLE_PLANS.includes(plan)) {
            return json({ error: 'Plot is free while it is in early access, and it comes with the Kal Voe Suite.' }, 409);
        }
        let email: string | null = null;
        if (rawEmail && rawEmail.trim()) {
            email = cleanEmail(rawEmail);
            if (!email) return json({ error: 'That email address does not look right.' }, 400);
        }

        const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
        if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not set');
        const stripe = new Stripe(secretKey, {
            apiVersion: '2026-02-25.clover',
            httpClient: Stripe.createFetchHttpClient(),
        });

        const lookupKey = LOOKUP_KEYS[plan][cycle];
        const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
        const price = prices.data[0];
        if (!price) throw new Error(`No active Stripe price for ${lookupKey}`);

        const back = suiteReturnUrl(returnUrl);
        const success = new URL(back);
        success.searchParams.set('billing', 'success');
        success.searchParams.set('plan', plan);
        const cancel = new URL(back);
        cancel.searchParams.set('billing', 'cancelled');

        const metadata = { kalvoe_plan: plan, kalvoe_cycle: cycle };
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card', 'link'],
            line_items: [{ price: price.id, quantity: 1 }],
            ...(email ? { customer_email: email } : {}),
            billing_address_collection: 'auto',
            success_url: success.toString(),
            cancel_url: cancel.toString(),
            metadata,
            subscription_data: { metadata, trial_period_days: TRIAL_DAYS },
            custom_text: {
                submit: {
                    message: `Your ${TRIAL_DAYS}-day free trial of ${PLAN_NAMES[plan]} starts today. Unless you cancel before it ends, it becomes a paid subscription at the price shown and renews automatically each billing period until you cancel. Sign in to the apps with the email you use here and your plan turns on. Cancel any time from the billing link in the app or in your receipt email.`,
                },
            },
        });

        if (!session.url) throw new Error('Stripe returned no checkout address');
        return json({ url: session.url });
    } catch (error) {
        console.error('suite-checkout failed:', error);
        return json({ error: 'Could not start checkout.' }, 500);
    }
});
