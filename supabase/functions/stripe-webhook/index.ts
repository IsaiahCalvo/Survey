import Stripe from 'npm:stripe@20.4.1';
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
    apiVersion: '2026-02-25.clover',
    httpClient: Stripe.createFetchHttpClient(),
});

const cryptoProvider = Stripe.createSubtleCryptoProvider();

type LegacySubscriptionPeriod = {
    current_period_start?: number | null;
    current_period_end?: number | null;
};

type LegacyInvoiceSubscription = {
    subscription?: string | Stripe.Subscription | null;
};

function subscriptionPeriod(subscription: Stripe.Subscription) {
    const legacy = subscription as Stripe.Subscription & LegacySubscriptionPeriod;
    const firstItem = subscription.items.data[0];
    return {
        start: legacy.current_period_start ?? firstItem?.current_period_start ?? null,
        end: legacy.current_period_end ?? firstItem?.current_period_end ?? null,
    };
}

function stripeResourceId(value: string | { id: string } | null | undefined) {
    return typeof value === 'string' ? value : value?.id ?? null;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice) {
    const current = invoice.parent?.subscription_details?.subscription;
    const legacy = (invoice as Stripe.Invoice & LegacyInvoiceSubscription).subscription;
    return stripeResourceId(current ?? legacy);
}

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

    try {
        const body = await req.text();
        console.log('Request body length:', body.length);

        const event = await stripe.webhooks.constructEventAsync(
            body,
            signature,
            webhookSecret,
            undefined,
            cryptoProvider
        );

        console.log(`✅ Successfully verified webhook event: ${event.type}`);

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
                await handleSubscriptionUpdate(supabase, subscription, event.data.previous_attributes);
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
        const parsedError = error instanceof Error ? error : new Error(String(error));
        console.error('❌ WEBHOOK ERROR:', error);
        console.error('Error type:', parsedError.constructor.name);
        console.error('Error message:', parsedError.message);
        console.error('Error stack:', parsedError.stack);
        return new Response(
            JSON.stringify({ error: parsedError.message }),
            {
                headers: { 'Content-Type': 'application/json' },
                status: 400,
            }
        );
    }
});

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
        return;
    }

    // Get subscription details
    const subscriptionId = session.subscription as string;
    const customerId = session.customer as string;

    console.log('Fetching subscription from Stripe...');
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    console.log('Subscription status:', subscription.status);
    console.log('Trial end:', subscription.trial_end);

    // Determine status based on trial
    const status = subscription.status === 'trialing' ? 'trialing' : 'active';

    // SECURITY: grant the tier that matches the ACTUAL price paid, never the
    // client-supplied metadata.tier — a price/tier mismatch must never grant an
    // unpaid tier. (handleSubscriptionUpdate already derives tier this way.)
    const actualPriceId = subscription.items.data[0].price.id;
    const tier = getTierFromPriceId(actualPriceId);
    if (tier === 'free') {
        console.error('WARNING: checkout price', actualPriceId, 'maps to no configured tier (metadata said', session.metadata?.tier, ') — granting free; check STRIPE_*_PRICE_ID secrets');
    }

    const period = subscriptionPeriod(subscription);
    const updateData = {
        tier: tier,
        status: status,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        stripe_price_id: subscription.items.data[0].price.id,
        trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
        current_period_start: period.start ? new Date(period.start * 1000).toISOString() : null,
        current_period_end: period.end ? new Date(period.end * 1000).toISOString() : null,
    };

    console.log('Update data prepared:', updateData);
    console.log('Attempting to update user_subscriptions for user_id:', userId);

    // First, check if a subscription record exists for this user
    console.log('Checking if subscription record exists...');
    const { data: existingRecord, error: checkError } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (checkError) {
        console.error('ERROR checking for existing record:', checkError);
        console.error('Check error details:', JSON.stringify(checkError, null, 2));

        // If no record exists, create one
        if (checkError.code === 'PGRST116') {
            console.log('No existing record found, creating new subscription record...');
            const { data: insertData, error: insertError } = await supabase
                .from('user_subscriptions')
                .insert({
                    user_id: userId,
                    ...updateData
                })
                .select();

            if (insertError) {
                console.error('ERROR inserting new subscription:', insertError);
                console.error('Insert error details:', JSON.stringify(insertError, null, 2));
            } else {
                console.log('SUCCESS: Created new subscription record');
                console.log('Inserted data:', insertData);
            }
            console.log('=== handleCheckoutCompleted END ===');
            return;
        }
    } else {
        console.log('Found existing subscription record:', existingRecord);
    }

    // Try to update by user_id first
    console.log('Updating subscription record...');
    const { data, error } = await supabase
        .from('user_subscriptions')
        .update(updateData)
        .eq('user_id', userId)
        .select();

    if (error) {
        console.error('ERROR updating user subscription:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));

        // Try fallback: update by customer_id if user_id failed
        console.log('Trying fallback: update by customer_id');
        const { data: fallbackData, error: fallbackError } = await supabase
            .from('user_subscriptions')
            .update(updateData)
            .eq('stripe_customer_id', customerId)
            .select();

        if (fallbackError) {
            console.error('FALLBACK ALSO FAILED:', fallbackError);
            console.error('Fallback error details:', JSON.stringify(fallbackError, null, 2));
        } else {
            console.log('Fallback success! Updated via customer_id');
            console.log('Updated rows:', fallbackData);
        }
    } else {
        console.log(`SUCCESS: Updated subscription for user ${userId} to ${tier} (${status})`);
        console.log('Updated rows:', data);
        console.log('Number of rows updated:', data?.length || 0);
    }

    console.log('=== handleCheckoutCompleted END ===');
}

// Handle subscription updates
async function handleSubscriptionUpdate(supabase: any, subscription: Stripe.Subscription, previousAttributes?: Record<string, unknown>) {
    const userId = subscription.metadata?.user_id;

    if (!userId) {
        // Try to find user by customer ID
        const { data: existingSubscription } = await supabase
            .from('user_subscriptions')
            .select('user_id')
            .eq('stripe_customer_id', subscription.customer)
            .single();

        if (!existingSubscription) {
            console.error('No user found for subscription');
            return;
        }
    }

    // Determine tier from price ID
    const priceId = subscription.items.data[0].price.id;
    const tier = getTierFromPriceId(priceId);

    // Check for downgrade
    const { data: currentSubscription } = await supabase
        .from('user_subscriptions')
        .select('tier, user_id, metadata')
        .eq('stripe_subscription_id', subscription.id)
        .single();

    if (currentSubscription) {
        const oldTier = currentSubscription.tier;
        const actualUserId = userId || currentSubscription.user_id;

        // Handle downgrade from Pro to Free (KAL-404: archived server-side
        // below, mirroring handleSubscriptionDeleted — no frontend/login-time
        // hook exists to do it).
        const isDowngradeToFree = oldTier === 'pro' && tier === 'free';
        if (isDowngradeToFree) {
            console.log(`Detected downgrade for user ${actualUserId}`);
        }

        // Update subscription with null-safe date handling
        const period = subscriptionPeriod(subscription);
        // A portal cancellation does NOT end the subscription — it schedules the
        // end (cancel_at / cancel_at_period_end) while status stays 'active'.
        // Persist that schedule in metadata so the app can say "ends on X, won't
        // renew" instead of the false "renews on X" (owner-hit 2026-08-30).
        const cancelAtTs = (subscription as any).cancel_at
            ?? (subscription.cancel_at_period_end ? period.end : null);
        const mergedMetadata = { ...(currentSubscription.metadata || {}) } as Record<string, unknown>;
        if (cancelAtTs) mergedMetadata.cancel_at = new Date(cancelAtTs * 1000).toISOString();
        else delete mergedMetadata.cancel_at;
        const { error } = await supabase
            .from('user_subscriptions')
            .update({
                tier: tier,
                status: subscription.status,
                stripe_price_id: priceId,
                trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
                current_period_start: period.start ? new Date(period.start * 1000).toISOString() : null,
                current_period_end: period.end ? new Date(period.end * 1000).toISOString() : null,
                metadata: mergedMetadata,
            })
            .eq('stripe_subscription_id', subscription.id);

        // Confirmation email the moment cancellation is SCHEDULED. Stripe's
        // previous_attributes lists only fields this event changed, so keying
        // on it fires exactly once per scheduling and never on the other
        // subscription.updated chatter (owner-reported gap 2026-08-30: the only
        // cancellation email used to arrive when the plan lapsed weeks later).
        const becameScheduled = Boolean(cancelAtTs) && Boolean(previousAttributes) && (
            'cancel_at' in (previousAttributes as object) || 'cancel_at_period_end' in (previousAttributes as object)
        );
        if (becameScheduled) {
            const actorId = userId || currentSubscription.user_id;
            const { data: user } = await supabase.auth.admin.getUserById(actorId);
            if (user?.user?.email) {
                const endDate = new Date(cancelAtTs * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                await sendEmail(
                    'subscription-cancel-scheduled',
                    user.user.email,
                    `Cancellation confirmed — Pro until ${endDate}`,
                    {
                        firstName: user.user.user_metadata?.firstName || user.user.user_metadata?.first_name,
                        endDate,
                        portalUrl: 'https://surveytool.app',
                    }
                );
            }
        }

        if (error) {
            console.error('Error updating subscription:', error);
        } else {
            console.log(`Subscription updated for user ${actualUserId}: ${oldTier} → ${tier}`);

            // KAL-404: a tier change without a full cancellation must archive
            // overage too, same as the customer.subscription.deleted path.
            if (isDowngradeToFree && actualUserId) {
                console.log('Archiving excess projects/documents for downgrade to Free tier...');
                const { data: archiveResult, error: archiveError } = await supabase.rpc('handle_downgrade_to_free', {
                    p_user_id: actualUserId
                });

                if (archiveError) {
                    console.error('Error archiving excess items:', archiveError);
                } else {
                    console.log('Archive result:', archiveResult);
                    console.log(`Archived ${archiveResult?.projects_archived_count || 0} projects and ${archiveResult?.documents_archived_count || 0} documents`);
                }
            }
        }
    }
}

// Handle subscription deletion (cancellation)
async function handleSubscriptionDeleted(supabase: any, subscription: Stripe.Subscription) {
    console.log('=== handleSubscriptionDeleted START ===');
    console.log('Stripe subscription ID:', subscription.id);

    // Get user email before deleting subscription info
    const { data: userSubscription, error: fetchError } = await supabase
        .from('user_subscriptions')
        .select('user_id, stripe_subscription_id, tier, status')
        .eq('stripe_subscription_id', subscription.id)
        .single();

    console.log('Found user subscription:', userSubscription);
    console.log('Fetch error:', fetchError);

    if (!userSubscription) {
        console.error('ERROR: No subscription found with stripe_subscription_id:', subscription.id);
        console.log('=== handleSubscriptionDeleted END (no subscription found) ===');
        return;
    }

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

    if (error) {
        console.error('Error handling subscription deletion:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
    } else {
        console.log('Update result:', updatedData);
        console.log('Number of rows updated:', updatedData?.length || 0);
        console.log(`Subscription canceled, downgraded to free tier`);

        // Archive excess projects and documents for Free tier
        console.log('Archiving excess projects/documents for downgrade to Free tier...');
        const { data: archiveResult, error: archiveError } = await supabase.rpc('handle_downgrade_to_free', {
            p_user_id: userSubscription.user_id
        });

        if (archiveError) {
            console.error('Error archiving excess items:', archiveError);
        } else {
            console.log('Archive result:', archiveResult);
            console.log(`Archived ${archiveResult?.projects_archived_count || 0} projects and ${archiveResult?.documents_archived_count || 0} documents`);
        }

        // Send cancellation confirmation email
        if (userSubscription) {
            const { data: user } = await supabase.auth.admin.getUserById(userSubscription.user_id);

            if (user) {
                await sendEmail(
                    'subscription-canceled',
                    user.user.email,
                    'Subscription Canceled',
                    {
                        firstName: user.user.user_metadata?.firstName || user.user.user_metadata?.first_name
                    }
                );
            }
        }
    }
    console.log('=== handleSubscriptionDeleted END ===');
}

// Handle trial ending soon
async function handleTrialWillEnd(supabase: any, subscription: Stripe.Subscription) {
    const { data: userSubscription } = await supabase
        .from('user_subscriptions')
        .select('user_id, stripe_customer_id')
        .eq('stripe_subscription_id', subscription.id)
        .single();

    if (userSubscription) {
        console.log(`Trial ending soon for user ${userSubscription.user_id}`);

        // Get user email
        const { data: user } = await supabase.auth.admin.getUserById(userSubscription.user_id);

        if (user && subscription.trial_end) {
            const trialEndDate = new Date(subscription.trial_end * 1000);
            const daysLeft = Math.ceil((trialEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

            // EMAIL LINK RULE (owner-reported 2026-08-20): never put a billing-portal
        // session URL in an email. Portal sessions are single-use and expire within
        // minutes, so every emailed link died before it was clicked ('For security
        // reasons, this page has expired'). Emails link to the app instead; the app
        // mints a fresh portal session at click time via create-portal-session.

            await sendEmail(
                'trial-ending',
                user.user.email,
                `Your Pro trial ends in ${daysLeft} days`,
                {
                    firstName: user.user.user_metadata?.firstName || user.user.user_metadata?.first_name,
                    daysLeft: daysLeft,
                    trialEndDate: trialEndDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
                    portalUrl: 'https://surveytool.app'
                }
            );
        }
    }
}

// Handle successful payment
async function handlePaymentSucceeded(supabase: any, invoice: Stripe.Invoice) {
    const subscriptionId = invoiceSubscriptionId(invoice);
    if (!subscriptionId) return;

    const { error } = await supabase
        .from('user_subscriptions')
        .update({
            status: 'active',
        })
        .eq('stripe_subscription_id', subscriptionId);

    if (!error) {
        console.log(`Payment succeeded for subscription ${subscriptionId}`);

        // Get user for email notification
        const { data: userSubscription } = await supabase
            .from('user_subscriptions')
            .select('user_id')
            .eq('stripe_subscription_id', subscriptionId)
            .single();

        if (userSubscription && invoice.customer_email && invoice.customer) {
            // EMAIL LINK RULE (owner-reported 2026-08-20): never put a billing-portal
        // session URL in an email. Portal sessions are single-use and expire within
        // minutes, so every emailed link died before it was clicked ('For security
        // reasons, this page has expired'). Emails link to the app instead; the app
        // mints a fresh portal session at click time via create-portal-session.

            await sendEmail(
                'payment-succeeded',
                invoice.customer_email,
                'Payment Received - Thank You!',
                {
                    amount: (invoice.amount_paid / 100).toFixed(2),
                    planName: 'Pro Monthly',
                    nextBillingDate: invoice.period_end ? new Date(invoice.period_end * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '',
                    portalUrl: 'https://surveytool.app'
                }
            );
        }
    }
}

// Handle failed payment
async function handlePaymentFailed(supabase: any, invoice: Stripe.Invoice) {
    const subscriptionId = invoiceSubscriptionId(invoice);
    if (!subscriptionId) return;

    const { error } = await supabase
        .from('user_subscriptions')
        .update({
            status: 'past_due',
        })
        .eq('stripe_subscription_id', subscriptionId);

    if (!error) {
        console.log(`Payment failed for subscription ${subscriptionId}`);

        // Send email notification
        if (invoice.customer_email && invoice.customer) {
            // EMAIL LINK RULE (owner-reported 2026-08-20): never put a billing-portal
        // session URL in an email. Portal sessions are single-use and expire within
        // minutes, so every emailed link died before it was clicked ('For security
        // reasons, this page has expired'). Emails link to the app instead; the app
        // mints a fresh portal session at click time via create-portal-session.

            await sendEmail(
                'payment-failed',
                invoice.customer_email,
                'Payment Failed - Action Required',
                {
                    portalUrl: 'https://surveytool.app'
                }
            );
        }
    }
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
