// Enterprise seats bought by a company workspace (stripe-webhook). Plain JS
// so the node tests run it as is.

// Only events our own checkout tagged with a company carry org_id.
export function companyIdOf(event) {
  const obj = event?.data?.object;
  if (obj?.object !== 'subscription' && obj?.object !== 'checkout.session') return null;
  const id = obj.metadata?.org_id;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

// Stripe's subscription status as the company's billing_status.
export function companyBillingStatus(status) {
  if (status === 'active' || status === 'trialing') return status;
  if (status === 'past_due' || status === 'unpaid') return 'past_due';
  if (status === 'canceled' || status === 'incomplete_expired') return 'canceled';
  return 'none';
}
