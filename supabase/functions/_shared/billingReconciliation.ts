// Provider reads stay outside SQL. Each retry reads the database BEFORE Stripe,
// then commits that exact snapshot, archives and notification in one transaction.
export class BillingReconciliationError extends Error {
    code: string;
    constructor(code: string) { super(code); this.name = 'BillingReconciliationError'; this.code = code; }
}

const EVENT_TYPES = new Set([
    'checkout.session.completed', 'customer.subscription.created',
    'customer.subscription.updated', 'customer.subscription.deleted',
    'customer.subscription.trial_will_end', 'invoice.payment_succeeded', 'invoice.payment_failed',
]);
const RETRY_CODES = new Set(['55P03', '40P01', '40001']);
const PORTAL_URL = 'https://surveytool.app'; // Email links must not use expiring portal sessions.

export function stripeResourceId(value: any): string | null {
    return typeof value === 'string' ? value : typeof value?.id === 'string' ? value.id : null;
}

function requireId(value: any, prefix: string): string {
    const id = stripeResourceId(value);
    if (!id || id.length > 255 || !new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(id)) {
        throw new BillingReconciliationError('invalid_event_binding');
    }
    return id;
}

function canonical(value: any): any {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(
        Object.keys(value).sort().map(key => [key, canonical(value[key])]),
    );
    return value;
}

export async function billingEventDigest(event: any): Promise<string> {
    // pending_webhooks and delivery headers change between retries. Event data
    // does not. Never include the newly fetched subscription in this digest.
    const immutable = Object.fromEntries(
        ['id', 'object', 'type', 'api_version', 'created', 'livemode', 'account', 'context', 'request', 'data']
            .filter(key => event[key] !== undefined).map(key => [key, event[key]]),
    );
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(immutable))));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function invoiceSubscriptionId(invoice: any): string | null {
    return stripeResourceId(invoice.parent?.subscription_details?.subscription ?? invoice.subscription);
}

function date(value: any): string | null {
    if (value === null || value === undefined) return null;
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isFinite(new Date(value * 1000).getTime())) {
        throw new BillingReconciliationError('invalid_provider_timestamp');
    }
    return new Date(value * 1000).toISOString();
}

function displayDate(value: string): string {
    return new Date(value).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function currentSubscriptionPatch(subscription: any, prices: Record<string, string | undefined>) {
    const item = subscription.items?.data?.[0];
    const start = date(subscription.current_period_start ?? item?.current_period_start);
    const end = date(subscription.current_period_end ?? item?.current_period_end);
    if (start && end && start > end) throw new BillingReconciliationError('invalid_provider_period');
    if (subscription.status === 'canceled') return {
        tier: 'free', status: 'canceled', stripe_subscription_id: null, stripe_price_id: null,
        trial_ends_at: null, current_period_start: start, current_period_end: end, cancel_at: null,
    };
    // Do not coerce unpaid/paused/unknown states to active. The current database
    // enum cannot represent them; fail visibly until the entitlement policy and
    // every consumer support them, instead of silently granting access.
    if (!['active', 'trialing', 'past_due', 'incomplete'].includes(subscription.status)) {
        throw new BillingReconciliationError('unsupported_subscription_status');
    }
    if (subscription.items?.has_more || subscription.items?.data?.length !== 1) {
        throw new BillingReconciliationError('unsupported_subscription_items');
    }
    const priceId = requireId(item.price, 'price');
    const matches = Object.entries(prices).filter(([, id]) => id && id === priceId).map(([plan]) => plan);
    const tiers = new Set(matches.map(plan => plan === 'enterprise' ? 'enterprise' : 'pro'));
    if (tiers.size !== 1) throw new BillingReconciliationError('unknown_or_ambiguous_subscription_price');
    const cancelAt = date(subscription.cancel_at ?? (subscription.cancel_at_period_end ?
        subscription.current_period_end ?? item?.current_period_end : null));
    if (subscription.cancel_at_period_end && !cancelAt) throw new BillingReconciliationError('missing_cancellation_period');
    return {
        tier: [...tiers][0], status: subscription.status, stripe_subscription_id: subscription.id,
        stripe_price_id: priceId, trial_ends_at: date(subscription.trial_end),
        current_period_start: start, current_period_end: end, cancel_at: cancelAt,
    };
}

async function checkedRpc(db: any, name: string, args: any) {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new BillingReconciliationError(error.code || 'database_rpc_failed');
    return data;
}

function assertOwner(resource: any, customerId: string, actorId: string, liveMode: boolean) {
    if (stripeResourceId(resource.customer) !== customerId || resource.livemode !== liveMode ||
        (resource.metadata?.user_id && resource.metadata.user_id !== actorId) ||
        (resource.metadata?.supabase_user_id && resource.metadata.supabase_user_id !== actorId)) {
        throw new BillingReconciliationError('provider_owner_mismatch');
    }
}

async function notificationFor(event: any, snapshot: any, subscription: any, patch: any, invoice: any, db: any, now: number) {
    const drafts: any[] = [];
    if (patch.status === 'canceled' && snapshot.stripe_subscription_id === subscription.id) {
        drafts.push({ key: `canceled:${subscription.id}`, template: 'subscription-canceled', subject: 'Subscription Canceled', data: {} });
    } else if (event.type === 'customer.subscription.updated' && patch.cancel_at &&
        Date.parse(snapshot.metadata?.cancel_at || '') !== Date.parse(patch.cancel_at)) {
        const endDate = displayDate(patch.cancel_at);
        drafts.push({ key: `scheduled:${event.id}:${patch.cancel_at}`, template: 'subscription-cancel-scheduled',
            subject: `Cancellation confirmed — ${patch.tier === 'enterprise' ? 'Enterprise' : 'Pro'} until ${endDate}`,
            data: { endDate, portalUrl: PORTAL_URL } });
    } else if (event.type === 'customer.subscription.trial_will_end' && subscription.status === 'trialing' &&
        subscription.trial_end === event.data.object.trial_end && patch.trial_ends_at) {
        const daysLeft = Math.ceil((Date.parse(patch.trial_ends_at) - now) / 86_400_000);
        if (daysLeft > 0 && daysLeft <= 3) drafts.push({
            key: `trial:${subscription.id}:${patch.trial_ends_at}`, template: 'trial-ending',
            subject: `Your Pro trial ends in ${daysLeft} days`,
            data: { daysLeft, trialEndDate: displayDate(patch.trial_ends_at), portalUrl: PORTAL_URL },
        });
    }
    if (invoice && event.type === 'invoice.payment_succeeded' && invoice.status === 'paid') {
        // Existing email template displays dollars. Reject rather than send an
        // incorrect receipt if a different currency is introduced later.
        if (invoice.currency !== 'usd' || !Number.isSafeInteger(invoice.amount_paid) || invoice.amount_paid < 0) {
            throw new BillingReconciliationError('unsupported_receipt_amount');
        }
        const periodEnd = date(invoice.period_end);
        drafts.push({ key: `paid:${invoice.id}`, template: 'payment-succeeded', subject: 'Payment Received - Thank You!',
            data: { amount: (invoice.amount_paid / 100).toFixed(2),
                planName: 'Survey subscription',
                periodEnd: periodEnd ? displayDate(periodEnd) : '', portalUrl: PORTAL_URL } });
    } else if (invoice && event.type === 'invoice.payment_failed' && invoice.status === 'open' &&
        !invoice.paid && invoice.amount_remaining > 0 && ['past_due', 'incomplete'].includes(subscription.status)) {
        if (!Number.isSafeInteger(invoice.attempt_count) || invoice.attempt_count < 1) {
            throw new BillingReconciliationError('invalid_invoice_attempt');
        }
        drafts.push({ key: `failed:${invoice.id}:${invoice.attempt_count}`, template: 'payment-failed',
            subject: 'Payment Failed - Action Required', data: { portalUrl: PORTAL_URL } });
    }
    if (!drafts.length) return null;
    // Preserve billing's invoice recipient (which may differ from the account
    // email), but only after validating the freshly retrieved invoice binding.
    if (drafts.some(draft => draft.template.startsWith('payment-'))) {
        if (typeof invoice?.customer_email !== 'string' || !invoice.customer_email) {
            throw new BillingReconciliationError('billing_recipient_unavailable');
        }
    }
    // Account notices use the saved customer's Auth identity, never event metadata.
    let user: any = null;
    if (drafts.some(draft => !draft.template.startsWith('payment-'))) {
        const { data, error } = await db.auth.admin.getUserById(snapshot.user_id);
        if (error || !data?.user?.email || data.user.id !== snapshot.user_id) {
            throw new BillingReconciliationError('billing_recipient_unavailable');
        }
        user = data.user;
    }
    const recordedAt = new Date(now).toISOString();
    return drafts.map(draft => draft.template.startsWith('payment-') ?
        { ...draft, to: invoice.customer_email, data: { ...draft.data, recordedAt } } :
        { ...draft, to: user.email, data: { ...draft.data, recordedAt,
            firstName: user.user_metadata?.firstName || user.user_metadata?.first_name || '' } });
}

export async function dispatchBillingNotification(db: any, eventId: string, send: (payload: any, key: string, sendBy: string) => Promise<string>) {
    for (let index = 0; index < 4; index++) {
        const token = crypto.randomUUID();
        const claim = await checkedRpc(db, 'claim_billing_notification', { p_event_id: eventId, p_claim_token: token });
        if (claim?.outcome === 'none' || claim?.outcome === 'sent') return;
        if (claim?.outcome !== 'claimed') throw new BillingReconciliationError(`notification_${claim?.outcome || 'invalid_claim'}`);
        if (typeof claim.send_by !== 'string' || !Number.isFinite(Date.parse(claim.send_by)) ||
            Date.now() + 35_000 >= Date.parse(claim.send_by)) {
            throw new BillingReconciliationError('notification_claim_expired');
        }
        const messageId = await send(claim.payload, claim.provider_key, claim.send_by);
        if (typeof messageId !== 'string' || !messageId) throw new BillingReconciliationError('notification_missing_receipt');
        const completed = await checkedRpc(db, 'complete_billing_notification', {
            p_event_id: eventId, p_claim_token: token, p_provider_message_id: messageId,
        });
        if (completed?.outcome !== 'sent') throw new BillingReconciliationError('notification_acknowledgement_failed');
    }
    throw new BillingReconciliationError('notification_batch_limit');
}

export async function reconcileBillingEvent(event: any, deps: {
    db: any; stripe: any; prices: Record<string, string | undefined>; liveMode: boolean;
    send: (payload: any, key: string, sendBy: string) => Promise<string>;
    sleep?: (ms: number) => Promise<void>; now?: () => number;
}) {
    if (!EVENT_TYPES.has(event.type)) return { outcome: 'ignored', reason: 'unhandled_event' };
    requireId(event.id, 'evt');
    if (event.livemode !== deps.liveMode || event.account || event.context) {
        throw new BillingReconciliationError('event_environment_mismatch');
    }
    const object = event.data?.object;
    if (!object || typeof object !== 'object') throw new BillingReconciliationError('invalid_event_object');
    if (event.type === 'checkout.session.completed' && object.mode !== 'subscription') {
        return { outcome: 'ignored', reason: 'non_subscription_checkout' };
    }
    const sub = event.type.startsWith('invoice.') ? invoiceSubscriptionId(object) :
        event.type === 'checkout.session.completed' ? stripeResourceId(object.subscription) : object.id;
    if (event.type.startsWith('invoice.') && !sub) return { outcome: 'ignored', reason: 'non_subscription_invoice' };
    const subscriptionId = requireId(sub, 'sub');
    const customerId = requireId(object.customer, 'cus');
    const binding = { p_event_id: event.id, p_customer_id: customerId, p_subscription_id: subscriptionId,
        p_event_type: event.type, p_event_digest: await billingEventDigest(event) };
    const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const saved = await checkedRpc(deps.db, 'lookup_billing_event', binding);
            if (saved) {
                await dispatchBillingNotification(deps.db, event.id, deps.send);
                return saved;
            }
            const observation = await checkedRpc(deps.db, 'read_billing_subscription_snapshot', { p_customer_id: customerId });
            const snapshot = observation?.subscription;
            // Normal checkout persists the customer before creating the session.
            // Removed accounts/other customers must never be provisioned by a webhook.
            if (observation === null) return { outcome: 'ignored', reason: 'customer_not_bound' };
            if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
                throw new BillingReconciliationError('invalid_billing_snapshot');
            }
            if (typeof observation.revision !== 'string' || !/^\d+$/.test(observation.revision)) {
                throw new BillingReconciliationError('invalid_billing_revision');
            }
            if (snapshot.stripe_customer_id !== customerId || !snapshot.user_id) {
                throw new BillingReconciliationError('database_owner_mismatch');
            }
            assertOwner(object, customerId, snapshot.user_id, deps.liveMode);
            // On any CAS or lock retry both this database read and provider read
            // run again. Reusing the old patch would reintroduce event reordering.
            const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId);
            if (subscription.id !== subscriptionId) throw new BillingReconciliationError('provider_subscription_mismatch');
            assertOwner(subscription, customerId, snapshot.user_id, deps.liveMode);
            let patch: any = null;
            let notification: any = null;
            const terminal = subscription.status === 'canceled';
            const linked = snapshot.stripe_subscription_id;
            // Quota/feature checks use tier, not just status. A newly created
            // incomplete subscription must not grant paid access before payment.
            if (!linked && !terminal && !['active', 'trialing'].includes(subscription.status)) {
                throw new BillingReconciliationError('initial_subscription_not_ready');
            }
            if (linked && linked !== subscriptionId && !terminal) {
                throw new BillingReconciliationError('multiple_subscription_conflict');
            }
            if ((!linked && !terminal) || linked === subscriptionId) {
                patch = currentSubscriptionPatch(subscription, deps.prices);
                let invoice: any = null;
                if (event.type.startsWith('invoice.')) {
                    invoice = await deps.stripe.invoices.retrieve(requireId(object.id, 'in'));
                    if (invoice.id !== object.id || invoiceSubscriptionId(invoice) !== subscriptionId) {
                        throw new BillingReconciliationError('provider_invoice_mismatch');
                    }
                    assertOwner(invoice, customerId, snapshot.user_id, deps.liveMode);
                }
                notification = await notificationFor(event, snapshot, subscription, patch, invoice, deps.db, (deps.now ?? Date.now)());
            }
            const result = await checkedRpc(deps.db, 'reconcile_billing_subscription_event', {
                ...binding, p_user_id: snapshot.user_id, p_expected: snapshot, p_patch: patch, p_notification: notification,
                p_expected_revision: observation.revision,
            });
            if (result?.outcome === 'stale') throw new BillingReconciliationError('40001');
            if (!['applied', 'duplicate', 'ignored'].includes(result?.outcome)) {
                throw new BillingReconciliationError('invalid_billing_commit_result');
            }
            await dispatchBillingNotification(deps.db, event.id, deps.send);
            return result;
        } catch (error) {
            if (!(error instanceof BillingReconciliationError) || !RETRY_CODES.has(error.code) || attempt === 2) throw error;
            await sleep(50 * (2 ** attempt) + Math.floor(Math.random() * 50));
        }
    }
    throw new BillingReconciliationError('billing_retry_exhausted');
}
