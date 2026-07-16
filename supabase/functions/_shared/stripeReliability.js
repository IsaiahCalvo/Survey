export const CANONICAL_APP_ORIGIN = 'https://surveytool.app';

const STORED_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'canceled',
  'incomplete',
]);

/** Keep the database enum compatible and fail closed for new Stripe statuses. */
export function normalizeSubscriptionStatus(status) {
  return STORED_SUBSCRIPTION_STATUSES.has(status) ? status : 'incomplete';
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error.message === 'string') return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Promote a Supabase returned error into a rejected webhook request. */
export function assertSupabaseSuccess(error, operation) {
  if (!error) return;
  throw new Error(`${operation}: ${errorMessage(error)}`);
}

/** A mutation that succeeds but changes no row did not apply the entitlement. */
export function assertRowsAffected(rows, operation) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${operation}: no rows affected`);
  }
}

/** Email and email-link creation must never make Stripe retry a persisted event. */
export async function runBestEffort(label, work, logger = console) {
  try {
    return await work();
  } catch (error) {
    logger.error(`${label} failed:`, errorMessage(error));
    return undefined;
  }
}

function relationId(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.id === 'string') return value.id;
  return null;
}

function toIso(seconds) {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

export function isTerminalStripeSubscriptionStatus(status) {
  return status === 'canceled' || status === 'incomplete_expired';
}

/** Apply Stripe's current subscription object instead of trusting event order. */
/** @param {any} options */
export async function reconcileSubscriptionEntitlement(options) {
  const {
    subscriptionId,
    hintedUserId = null,
    retrieveCurrent,
    findBySubscriptionId,
    findByUserId,
    findByCustomerId,
    updateExisting,
    insertMissing,
    tierFromPriceId,
  } = options;
  let current;
  try {
    current = await retrieveCurrent(subscriptionId);
  } catch (error) {
    if (error?.code === 'resource_missing') {
      return { applied: false, reason: 'subscription-not-found', current: null };
    }
    throw error;
  }
  const priceId = current?.items?.data?.[0]?.price?.id;
  const state = {
    tier: tierFromPriceId(priceId),
    status: normalizeSubscriptionStatus(current.status),
    stripe_customer_id: relationId(current.customer),
    stripe_subscription_id: current.id,
    stripe_price_id: priceId,
    trial_ends_at: toIso(current.trial_end),
    current_period_start: toIso(current.current_period_start),
    current_period_end: toIso(current.current_period_end),
  };
  let row = await findBySubscriptionId(subscriptionId);
  if (!row && isTerminalStripeSubscriptionStatus(current.status)) {
    return {
      applied: false,
      reason: 'terminal-subscription-already-removed',
      current,
      state,
    };
  }
  let expectedSubscriptionId = subscriptionId;
  const userId = current?.metadata?.user_id || hintedUserId;
  if (!row && state.stripe_customer_id) {
    row = await findByCustomerId(state.stripe_customer_id);
    expectedSubscriptionId = row?.stripe_subscription_id ?? null;
  }
  if (!row && userId) {
    row = await findByUserId(userId);
    expectedSubscriptionId = null;
  }
  if (row?.stripe_subscription_id && row.stripe_subscription_id !== subscriptionId) {
    let assigned = null;
    try {
      assigned = await retrieveCurrent(row.stripe_subscription_id);
    } catch (error) {
      if (error?.code !== 'resource_missing') throw error;
    }
    const incomingCreated = Number(current?.created);
    const assignedCreated = Number(assigned?.created);
    const timestampsComparable = Number.isFinite(incomingCreated)
      && Number.isFinite(assignedCreated);
    const assignedWins = timestampsComparable
      ? assignedCreated >= incomingCreated
      : !!assigned && !isTerminalStripeSubscriptionStatus(assigned.status);
    if (assignedWins) {
      return {
        applied: false,
        reason: 'newer-subscription-assigned',
        current,
        state,
      };
    }
    // The stored subscription is older and terminal/missing. Compare-and-set
    // against that exact ID so a concurrent newer checkout cannot be replaced.
    expectedSubscriptionId = row.stripe_subscription_id;
  }
  if (row) {
    await updateExisting(row, state, expectedSubscriptionId);
  } else {
    await insertMissing(userId, state);
  }
  return { applied: true, current, state };
}
