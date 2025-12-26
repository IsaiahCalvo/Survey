import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
    apiVersion: '2024-06-20',
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
    const signature = req.headers.get('Stripe-Signature');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

    if (!signature || !webhookSecret) {
        return new Response('Missing signature or webhook secret', { status: 400 });
    }

    try {
        const body = await req.text();
        const event = await stripe.webhooks.constructEventAsync(
            body,
            signature,
            webhookSecret,
            undefined,
            cryptoProvider
        );

        console.log(`Processing webhook event: ${event.type}`);

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
        console.error('Webhook error:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
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
    const tier = session.metadata?.tier || 'pro';

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

    const updateData = {
        tier: tier,
        status: status,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        stripe_price_id: subscription.items.data[0].price.id,
        trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
        current_period_start: subscription.current_period_start ? new Date(subscription.current_period_start * 1000).toISOString() : null,
        current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
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
async function handleSubscriptionUpdate(supabase: any, subscription: Stripe.Subscription) {
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
        .select('tier, user_id')
        .eq('stripe_subscription_id', subscription.id)
        .single();

    if (currentSubscription) {
        const oldTier = currentSubscription.tier;
        const actualUserId = userId || currentSubscription.user_id;

        // Handle downgrade from Pro to Free
        if (oldTier === 'pro' && tier === 'free') {
            console.log(`Detected downgrade for user ${actualUserId}`);
            // Note: Actual archival will be handled by frontend when user logs in
            // We just update the tier here
        }

        // Update subscription with null-safe date handling
        const { error } = await supabase
            .from('user_subscriptions')
            .update({
                tier: tier,
                status: subscription.status,
                stripe_price_id: priceId,
                trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
                current_period_start: subscription.current_period_start ? new Date(subscription.current_period_start * 1000).toISOString() : null,
                current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
            })
            .eq('stripe_subscription_id', subscription.id);

        if (error) {
            console.error('Error updating subscription:', error);
        } else {
            console.log(`Subscription updated for user ${actualUserId}: ${oldTier} → ${tier}`);
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

            // Create billing portal session
            // Note: return_url should be updated to your actual landing page URL
            const portalSession = await stripe.billingPortal.sessions.create({
                customer: userSubscription.stripe_customer_id || subscription.customer as string,
                return_url: 'https://www.google.com', // Placeholder - update with your landing page
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
}

// Handle successful payment
async function handlePaymentSucceeded(supabase: any, invoice: Stripe.Invoice) {
    if (!invoice.subscription) return;

    const { error } = await supabase
        .from('user_subscriptions')
        .update({
            status: 'active',
        })
        .eq('stripe_subscription_id', invoice.subscription);

    if (!error) {
        console.log(`Payment succeeded for subscription ${invoice.subscription}`);

        // Get user for email notification
        const { data: userSubscription } = await supabase
            .from('user_subscriptions')
            .select('user_id')
            .eq('stripe_subscription_id', invoice.subscription)
            .single();

        if (userSubscription && invoice.customer_email && invoice.customer) {
            // Create billing portal session
            const portalSession = await stripe.billingPortal.sessions.create({
                customer: invoice.customer as string,
                return_url: 'https://www.google.com', // Placeholder
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
    }
}

// Handle failed payment
async function handlePaymentFailed(supabase: any, invoice: Stripe.Invoice) {
    if (!invoice.subscription) return;

    const { error } = await supabase
        .from('user_subscriptions')
        .update({
            status: 'past_due',
        })
        .eq('stripe_subscription_id', invoice.subscription);

    if (!error) {
        console.log(`Payment failed for subscription ${invoice.subscription}`);

        // Send email notification
        if (invoice.customer_email && invoice.customer) {
            // Create billing portal session
            const portalSession = await stripe.billingPortal.sessions.create({
                customer: invoice.customer as string,
                return_url: 'https://www.google.com', // Placeholder
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
