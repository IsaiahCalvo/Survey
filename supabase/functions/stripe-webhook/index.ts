import Stripe from 'npm:stripe@20.4.1';
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { BillingReconciliationError, reconcileBillingEvent } from '../_shared/billingReconciliation.ts';

const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') as string;
const stripe = new Stripe(stripeKey, {
    apiVersion: '2026-02-25.clover',
    httpClient: Stripe.createFetchHttpClient(),
    timeout: 15_000,
    maxNetworkRetries: 1,
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    const signature = req.headers.get('Stripe-Signature');
    const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    if (!secret) return json({ error: 'Billing is temporarily unavailable' }, 503);
    if (!signature) return json({ error: 'Missing signature' }, 400);

    let event: Stripe.Event;
    try {
        // Stripe must verify the unmodified raw body, before any database work.
        event = await stripe.webhooks.constructEventAsync(await req.text(), signature, secret, undefined, cryptoProvider);
    } catch {
        return json({ error: 'Invalid webhook signature' }, 400);
    }

    try {
        if (!/^(sk|rk)_(live|test)_/.test(stripeKey || '')) throw new BillingReconciliationError('invalid_billing_configuration');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!supabaseUrl || !serviceKey) throw new BillingReconciliationError('invalid_billing_configuration');
        const db = createClient(supabaseUrl, serviceKey, {
            auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
            global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
        });
        await reconcileBillingEvent(event, {
            db, stripe, liveMode: /^(sk|rk)_live_/.test(stripeKey),
            prices: {
                proMonthly: Deno.env.get('STRIPE_PRO_MONTHLY_PRICE_ID'),
                proAnnual: Deno.env.get('STRIPE_PRO_ANNUAL_PRICE_ID'),
                enterprise: Deno.env.get('STRIPE_ENTERPRISE_PRICE_ID'),
            },
            async send(payload, providerKey, sendBy) {
                // The SQL outbox freezes this request and serializes deliveries.
                // Brevo suppresses key reuse for 30 minutes; SQL stops automatic
                // retry after 25 minutes if the result is still unknown.
                const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
                    method: 'POST', signal: AbortSignal.timeout(35_000),
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
                    body: JSON.stringify({ ...payload, billingDeliveryKey: providerKey, billingSendBefore: sendBy }),
                });
                if (!response.ok) throw new BillingReconciliationError('billing_email_send_failed');
                const result = await response.json();
                if (result?.success !== true || typeof result.id !== 'string' || !result.id) {
                    throw new BillingReconciliationError('billing_email_receipt_missing');
                }
                return result.id;
            },
        });
        return json({ received: true });
    } catch (error) {
        // Do not acknowledge failed writes or expose provider messages, payloads,
        // recipient addresses, credentials or stack traces in the response/log.
        const code = error instanceof BillingReconciliationError ? error.code : 'billing_dependency_failed';
        console.error('[stripe-webhook] reconciliation failed', { eventId: event.id, code });
        return json({ error: 'Billing reconciliation requires retry' }, 503);
    }
});
