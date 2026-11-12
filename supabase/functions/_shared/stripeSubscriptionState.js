// Personal plan state for stripe-webhook. Plain JS so the node tests run it
// as is.

// user_subscriptions.status is the enum subscription_status: active,
// trialing, past_due, canceled, incomplete. Stripe has three more. Writing
// one of those raw fails the update, the webhook answers 500, and Stripe
// resends the same doomed event for three days while the row stays stale.
export function subscriptionDbStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
    case 'past_due':
    case 'canceled':
    case 'incomplete':
      return stripeStatus;
    case 'unpaid':
    case 'paused':
      return 'past_due';
    case 'incomplete_expired':
      return 'canceled';
    default:
      return null;
  }
}

// A payment-failed email only makes sense while the plan still owes money:
// a late or replayed invoice.payment_failed after a retry paid must stay quiet.
export function paymentStillOwed(dbStatus) {
  return dbStatus === 'past_due' || dbStatus === 'incomplete';
}
