import Stripe from 'https://esm.sh/stripe@11.1.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10?target=deno';
import {
    CANONICAL_APP_ORIGIN,
    assertRowsAffected,
    assertSupabaseSuccess,
    isTerminalStripeSubscriptionStatus,
    reconcileSubscriptionEntitlement,
    runBestEffort,
} from '../_shared/stripeReliability.js';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
});

const cryptoProvider = Stripe.createSubtleCryptoProvider();

// Helper function to send email notifications
async function sendEmail(template: string, to: string, subject: string, data: any) {
    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({ to, subject, template, data }),
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('Failed to send email:', error);
        } else {
            console.log(`Email sent: ${template} to ${to}`);
        }
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

Deno.serve(async (req) => {
    console.log('=== WEBHOOK REQUEST RECEIVED ===');
    const signature = req.headers.get('Stripe-Signature');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

    console.log('Signature present:', !!signature);
    console.log('Webhook secret present:', !!webhookSecret);

    if (!signature || !webhookSecret) {
        console.error('Missing signature or webhook secret');
        return new Response('Missing signature or webhook secret', { status: 400 });
    }

    let event: Stripe.Event;
    try {
        const body = await req.text();
        console.log('Request body length:', body.length);
        event = await stripe.webhooks.constructEventAsync(
            body,
            signature,
            webhookSecret,
            undefined,
            cryptoProvider
        );

        console.log(`✅ Successfully verified webhook event: ${event.type}`);
    } catch (error) {
        console.error('❌ WEBHOOK VERIFICATION ERROR:', error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid webhook' }),
            {
                headers: { 'Content-Type': 'application/json' },
                status: 400,
            }
        );
    }

    try {
        // Initialize Supabase client with service role (bypasses RLS)
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        console.log('Initializing Supabase client...');
        console.log('Supabase URL:', supabaseUrl);
        console.log('Service key present:', !!supabaseServiceKey);

        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
                detectSessionInUrl: false
            }
        });

        // Handle different event types
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                await handleCheckoutCompleted(supabase, session);
                break;
            }

            case 'customer.subscription.created':
            case 'customer.subscription.updated': {
                const subscription = event.data.object as Stripe.Subscription;
                await handleSubscriptionUpdate(supabase, subscription);
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object as Stripe.Subscription;
                await handleSubscriptionDeleted(supabase, subscription);
                break;
            }

            case 'customer.subscription.trial_will_end': {
                const subscription = event.data.object as Stripe.Subscription;
                await handleTrialWillEnd(supabase, subscription);
                break;
            }

            case 'invoice.payment_succeeded': {
                const invoice = event.data.object as Stripe.Invoice;
                await handlePaymentSucceeded(supabase, invoice);
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object as Stripe.Invoice;
                await handlePaymentFailed(supabase, invoice);
                break;
            }

            default:
                console.log(`Unhandled event type: ${event.type}`);
        }

        return new Response(JSON.stringify({ received: true }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error) {
        console.error('❌ WEBHOOK PROCESSING ERROR:', error);
        const message = error instanceof Error ? error.message : 'Webhook processing failed';
        return new Response(
            JSON.stringify({ error: message }),
            {
                headers: { 'Content-Type': 'application/json' },
                status: 500,
            }
        );
    }
});

function stripeRelationId(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (value && typeof (value as { id?: unknown }).id === 'string') {
        return (value as { id: string }).id;
    }
    return null;
}

async function reconcileCurrentSubscriptionState(
    supabase: any,
    subscriptionId: string,
    hintedUserId: string | null,
    operation: string,
) {
    return reconcileSubscriptionEntitlement({
        subscriptionId,
        hintedUserId,
        retrieveCurrent: (id: string) => stripe.subscriptions.retrieve(id),
        findBySubscriptionId: async (id: string) => {
            const { data, error } = await supabase
                .from('user_subscriptions')
                .select('id, user_id, stripe_subscription_id, stripe_customer_id, tier, status')
                .eq('stripe_subscription_id', id)
                .maybeSingle();
            assertSupabaseSuccess(error, `look up ${operation} by subscription`);
            return data;
        },
        findByUserId: async (userId: string) => {
            const { data, error } = await supabase
                .from('user_subscriptions')
                .select('id, user_id, stripe_subscription_id, stripe_customer_id, tier, status')
                .eq('user_id', userId)
                .maybeSingle();
            assertSupabaseSuccess(error, `look up ${operation} by user`);
            return data;
        },
        findByCustomerId: async (customerId: string) => {
            const { data, error } = await supabase
                .from('user_subscriptions')
                .select('id, user_id, stripe_subscription_id, stripe_customer_id, tier, status')
                .eq('stripe_customer_id', customerId)
                .maybeSingle();
            assertSupabaseSuccess(error, `look up ${operation} by customer`);
            return data;
        },
        updateExisting: async (row: any, state: Record<string, unknown>, expectedSubscriptionId: string | null) => {
            let query = supabase
                .from('user_subscriptions')
                .update(state)
                .eq('id', row.id);
            query = expectedSubscriptionId == null
                ? query.is('stripe_subscription_id', null)
                : query.eq('stripe_subscription_id', expectedSubscriptionId);
            const { data, error } = await query.select('user_id');
            assertSupabaseSuccess(error, `update ${operation}`);
            assertRowsAffected(data, `update ${operation}`);
        },
        insertMissing: async (userId: string | null, state: Record<string, unknown>) => {
            if (!userId) throw new Error(`insert ${operation}: missing user_id`);
            const { data, error } = await supabase
                .from('user_subscriptions')
                .insert({ user_id: userId, ...state })
                .select('user_id');
            assertSupabaseSuccess(error, `insert ${operation}`);
            assertRowsAffected(data, `insert ${operation}`);
        },
        tierFromPriceId: getTierFromPriceId,
    });
}

// Handle checkout session completion
async function handleCheckoutCompleted(supabase: any, session: Stripe.Checkout.Session) {
    console.log('=== handleCheckoutCompleted START ===');
    console.log('Session ID:', session.id);
    console.log('Customer ID:', session.customer);
    console.log('Subscription ID:', session.subscription);
    console.log('Metadata:', session.metadata);

    const userId = session.metadata?.user_id;

    if (!userId) {
        console.error('CRITICAL: No user_id in checkout session metadata');
        throw new Error('checkout session is missing user_id metadata');
    }

    const subscriptionId = stripeRelationId(session.subscription);
    if (!subscriptionId) throw new Error('checkout session is missing subscription metadata');

    const result = await reconcileCurrentSubscriptionState(
        supabase,
        subscriptionId,
        userId,
        'checkout subscription record',
    );
    console.log('Checkout reconciliation:', result.applied ? result.state : result.reason);

    console.log('=== handleCheckoutCompleted END ===');
}

// Handle subscription updates
async function handleSubscriptionUpdate(supabase: any, subscription: Stripe.Subscription) {
    const result = await reconcileCurrentSubscriptionState(
        supabase,
        subscription.id,
        subscription.metadata?.user_id || null,
        'subscription event',
    );
    console.log('Subscription reconciliation:', result.applied ? result.state : result.reason);
}

// Handle subscription deletion (cancellation)
async function handleSubscriptionDeleted(supabase: any, subscription: Stripe.Subscription) {
    console.log('=== handleSubscriptionDeleted START ===');
    console.log('Stripe subscription ID:', subscription.id);

    const reconciliation = await reconcileCurrentSubscriptionState(
        supabase,
        subscription.id,
        subscription.metadata?.user_id || null,
        'deleted subscription',
    );
    if (reconciliation.current
        && !isTerminalStripeSubscriptionStatus(reconciliation.current.status)) {
        console.log('Ignoring stale deletion; Stripe subscription is currently non-terminal:', subscription.id);
        return;
    }

    // Get user email before deleting subscription info
    const { data: userSubscription, error: fetchError } = await supabase
        .from('user_subscriptions')
        .select('user_id, stripe_subscription_id, tier, status')
        .eq('stripe_subscription_id', subscription.id)
        .maybeSingle();

    console.log('Found user subscription:', userSubscription);
    console.log('Fetch error:', fetchError);

    assertSupabaseSuccess(fetchError, 'look up deleted subscription');

    if (!userSubscription) {
        // A repeated delivery after a successful cancellation no longer has a
        // stripe_subscription_id to match. Treat that as an idempotent success.
        console.log('No active subscription row found; deletion was already applied:', subscription.id);
        console.log('=== handleSubscriptionDeleted END (no subscription found) ===');
        return;
    }

    // Archive first. If this RPC fails, throwing leaves the Stripe ID intact so
    // the retry can find the same row and attempt the complete downgrade again.
    console.log('Archiving excess projects/documents for downgrade to Free tier...');
    const { data: archiveResult, error: archiveError } = await supabase.rpc('handle_downgrade_to_free', {
        p_user_id: userSubscription.user_id
    });
    assertSupabaseSuccess(archiveError, 'archive downgraded account');
    console.log('Archive result:', archiveResult);
    console.log(`Archived ${archiveResult?.projects_archived_count || 0} projects and ${archiveResult?.documents_archived_count || 0} documents`);

    const { data: updatedData, error } = await supabase
        .from('user_subscriptions')
        .update({
            tier: 'free',
            status: 'canceled',
            stripe_subscription_id: null,
            stripe_price_id: null,
            trial_ends_at: null,
        })
        .eq('stripe_subscription_id', subscription.id)
        .select();

    assertSupabaseSuccess(error, 'downgrade deleted subscription');
    assertRowsAffected(updatedData, 'downgrade deleted subscription');
    console.log('Update result:', updatedData);
    console.log(`Subscription canceled, downgraded to free tier`);

    await runBestEffort('subscription cancellation email', async () => {
        const { data: user, error: userError } = await supabase.auth.admin.getUserById(userSubscription.user_id);
        if (userError) throw userError;
        if (user?.user?.email) {
            await sendEmail(
                'subscription-canceled',
                user.user.email,
                'Subscription Canceled',
                {
                    firstName: user.user.user_metadata?.firstName || user.user.user_metadata?.first_name
                }
            );
        }
    });
    console.log('=== handleSubscriptionDeleted END ===');
}

// Handle trial ending soon
async function handleTrialWillEnd(supabase: any, subscription: Stripe.Subscription) {
    await runBestEffort('trial-ending email', async () => {
        const { data: userSubscription, error: subscriptionError } = await supabase
            .from('user_subscriptions')
            .select('user_id, stripe_customer_id')
            .eq('stripe_subscription_id', subscription.id)
            .single();
        if (subscriptionError) throw subscriptionError;

        if (userSubscription) {
            console.log(`Trial ending soon for user ${userSubscription.user_id}`);

            const { data: user, error: userError } = await supabase.auth.admin.getUserById(userSubscription.user_id);
            if (userError) throw userError;

            if (user?.user?.email && subscription.trial_end) {
                const trialEndDate = new Date(subscription.trial_end * 1000);
                const daysLeft = Math.ceil((trialEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                const portalSession = await stripe.billingPortal.sessions.create({
                    customer: userSubscription.stripe_customer_id || subscription.customer as string,
                    return_url: CANONICAL_APP_ORIGIN,
                });

                await sendEmail(
                    'trial-ending',
                    user.user.email,
                    `Your Pro trial ends in ${daysLeft} days`,
                    {
                        firstName: user.user.user_metadata?.firstName || user.user.user_metadata?.first_name,
                        daysLeft: daysLeft,
                        trialEndDate: trialEndDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
                        portalUrl: portalSession.url
                    }
                );
            }
        }
    });
}

// Handle successful payment
async function handlePaymentSucceeded(supabase: any, invoice: Stripe.Invoice) {
    const subscriptionId = stripeRelationId(invoice.subscription);
    if (!subscriptionId) return;

    const reconciliation = await reconcileCurrentSubscriptionState(
        supabase,
        subscriptionId,
        null,
        'payment-succeeded subscription',
    );
    if (!reconciliation.applied) {
        console.log('Ignoring stale payment-succeeded delivery:', reconciliation.reason);
        return;
    }
    console.log(`Payment succeeded for subscription ${subscriptionId}`);

    await runBestEffort('payment-succeeded email', async () => {
        if (invoice.customer_email && invoice.customer) {
            const portalSession = await stripe.billingPortal.sessions.create({
                customer: invoice.customer as string,
                return_url: CANONICAL_APP_ORIGIN,
            });

            await sendEmail(
                'payment-succeeded',
                invoice.customer_email,
                'Payment Received - Thank You!',
                {
                    amount: (invoice.amount_paid / 100).toFixed(2),
                    planName: 'Pro Monthly',
                    nextBillingDate: invoice.period_end ? new Date(invoice.period_end * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '',
                    portalUrl: portalSession.url
                }
            );
        }
    });
}

// Handle failed payment
async function handlePaymentFailed(supabase: any, invoice: Stripe.Invoice) {
    const subscriptionId = stripeRelationId(invoice.subscription);
    if (!subscriptionId) return;

    const reconciliation = await reconcileCurrentSubscriptionState(
        supabase,
        subscriptionId,
        null,
        'payment-failed subscription',
    );
    if (!reconciliation.applied) {
        console.log('Ignoring stale payment-failed delivery:', reconciliation.reason);
        return;
    }
    console.log(`Payment failed for subscription ${subscriptionId}`);

    await runBestEffort('payment-failed email', async () => {
        if (invoice.customer_email && invoice.customer) {
            const portalSession = await stripe.billingPortal.sessions.create({
                customer: invoice.customer as string,
                return_url: CANONICAL_APP_ORIGIN,
            });

            await sendEmail(
                'payment-failed',
                invoice.customer_email,
                'Payment Failed - Action Required',
                {
                    portalUrl: portalSession.url
                }
            );
        }
    });
}

// Helper function to determine tier from price ID
function getTierFromPriceId(priceId: string): string {
    const proMonthlyPriceId = Deno.env.get('STRIPE_PRO_MONTHLY_PRICE_ID');
    const proAnnualPriceId = Deno.env.get('STRIPE_PRO_ANNUAL_PRICE_ID');
    const enterprisePriceId = Deno.env.get('STRIPE_ENTERPRISE_PRICE_ID');

    if (priceId === proMonthlyPriceId || priceId === proAnnualPriceId) {
        return 'pro';
    } else if (priceId === enterprisePriceId) {
        return 'enterprise';
    } else {
        return 'free';
    }
}
